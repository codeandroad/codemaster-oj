import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { claimTask, completeTask, failTask, renewLease, processOne } from '../worker.mjs';
import { GoJudge } from '../judge.mjs';
import { migrate } from '../src/migrate.mjs';

// Every row/table belongs to a fresh, randomly named test schema. Production
// tables are never truncated or dropped; opt in with a disposable test DB URL.
const databaseUrl = process.env.JUDGE_TEST_DATABASE_URL;
const realEnabled = Boolean(databaseUrl && process.env.GO_JUDGE_TEST_URL && process.env.GO_JUDGE_TEST_TOKEN);
const enabled = Boolean(databaseUrl);
let adminPool, pool, schema, accountId, identityId, problemId, versionId;

test.before(async () => {
  if (!enabled) return;
  schema = `judge_test_${randomUUID().replaceAll('-', '_')}`;
  adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 });
  await migrate(pool);
  identityId = (await pool.query("INSERT INTO identities(kind,number,name) VALUES('student','judge-worker-test','Worker Test') RETURNING id")).rows[0].id;
  accountId = (await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'judge-worker-test','unused-test-hash') RETURNING id", [identityId])).rows[0].id;
  problemId = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [accountId])).rows[0].id;
  versionId = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,samples,time_limit_ms,memory_limit_mb,comparator,reference_code)
    VALUES($1,'Worker Test','stdio','Test','[{"input":"","expected":"42"}]',500,64,'tokens','print(42)') RETURNING id`, [problemId])).rows[0].id;
  await pool.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'','42',100)", [versionId]);
});
test.after(async () => {
  if (pool) await pool.end();
  if (schema) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  if (adminPool) await adminPool.end();
});

async function enqueue(kind = 'submit', code = 'print(42)', language = 'python') {
  const submission = (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,language,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'test-hash') RETURNING id`, [accountId, identityId, problemId, versionId, kind, code, language, randomUUID()])).rows[0];
  return (await pool.query("INSERT INTO judge_tasks(submission_id,version_id,purpose) VALUES($1,$2,'submission') RETURNING *", [submission.id, versionId])).rows[0];
}
const ac = { status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: 'Passed', privateResults: [], environmentVersion: 'test-runtime' };

test('real PostgreSQL leases: concurrent claims differ and duplicate completion is idempotent', { skip: !enabled }, async () => {
  await enqueue(); await enqueue();
  const [first, second] = await Promise.all([claimTask(pool), claimTask(pool)]);
  assert.notEqual(first.id, second.id); assert.equal(first.attempts, 1); assert.equal(second.attempts, 1);
  assert.equal(await claimTask(pool), null); assert.equal(await renewLease(pool, first), true);
  assert.equal(await completeTask(pool, first, ac), true); assert.equal(await completeTask(pool, first, ac), false);
  assert.equal(await completeTask(pool, second, ac), true);
  assert.equal((await pool.query('SELECT count(*) FROM judge_runs WHERE task_id=$1', [first.id])).rows[0].count, '1');
});

test('real PostgreSQL leases: an expired callback and heartbeat cannot overwrite a new lease', { skip: !enabled }, async () => {
  await enqueue();
  const stale = await claimTask(pool);
  await pool.query("UPDATE judge_tasks SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [stale.id]);
  assert.equal(await completeTask(pool, stale, ac), false); assert.equal(await renewLease(pool, stale), false);
  const next = await claimTask(pool);
  assert.equal(next.id, stale.id); assert.notEqual(next.lease_id, stale.lease_id); assert.equal(next.attempts, 2);
  assert.equal(await completeTask(pool, stale, { ...ac, score: 0, status: 'WA' }), false);
  assert.equal(await completeTask(pool, next, ac), true);
  assert.equal((await pool.query('SELECT score FROM submissions WHERE id=$1', [next.submission_id])).rows[0].score, '100.0000');
});

test('real PostgreSQL retries: infrastructure failure gets two retries, no zero score and one run per lease', { skip: !enabled }, async () => {
  const queued = await enqueue();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const task = await claimTask(pool);
    assert.equal(task.id, queued.id); assert.equal(task.attempts, attempt);
    assert.equal(await failTask(pool, task, { environmentVersion: 'test-runtime' }), true);
    assert.equal(await failTask(pool, task), false);
    await pool.query('UPDATE judge_tasks SET available_at=now() WHERE id=$1', [queued.id]);
  }
  assert.equal(await claimTask(pool), null);
  const task = (await pool.query('SELECT state,attempts FROM judge_tasks WHERE id=$1', [queued.id])).rows[0];
  assert.equal(task.state, 'failed'); assert.equal(task.attempts, 3);
  const result = (await pool.query('SELECT status,score FROM submissions WHERE id=$1', [queued.submission_id])).rows[0];
  assert.equal(result.status, 'System Error'); assert.equal(result.score, null);
  assert.equal((await pool.query('SELECT count(*) FROM judge_runs WHERE task_id=$1', [queued.id])).rows[0].count, '3');
});

test('real PostgreSQL recovery: a final crashed lease is failed and fenced', { skip: !enabled }, async () => {
  const queued = await enqueue(); const task = await claimTask(pool);
  await pool.query("UPDATE judge_tasks SET attempts=3,lease_expires_at=now()-interval '1 second' WHERE id=$1", [queued.id]);
  assert.equal(await claimTask(pool), null); assert.equal(await completeTask(pool, task, ac), false);
  const result = (await pool.query('SELECT status,score FROM submissions WHERE id=$1', [queued.submission_id])).rows[0];
  assert.equal(result.status, 'System Error'); assert.equal(result.score, null);
});

async function enqueueRejudge() {
  const original = await enqueue();
  const initial = await claimTask(pool);
  await completeTask(pool, initial, { ...ac, status: 'WA', score: 40, passed: 0, publicMessage: 'Original result' });
  return (await pool.query("INSERT INTO judge_tasks(submission_id,version_id,purpose,rejudge,requested_by,reason) VALUES($1,$2,'submission',true,$3,'Verify corrected tests') RETURNING *", [original.submission_id, versionId, accountId])).rows[0];
}

test('real PostgreSQL rejudge: candidate completion preserves the current result until explicit confirmation', { skip: !enabled }, async () => {
  const queued = await enqueueRejudge();
  const task = await claimTask(pool);
  assert.equal(task.id, queued.id); assert.equal(task.rejudge, true);
  assert.deepEqual((await pool.query('SELECT status,score,public_message FROM submissions WHERE id=$1', [task.submission_id])).rows[0],
    { status: 'WA', score: '40.0000', public_message: 'Original result' });
  assert.equal(await completeTask(pool, task, ac), true);
  const submission = (await pool.query('SELECT status,score,public_message,pending_judge_run_id FROM submissions WHERE id=$1', [task.submission_id])).rows[0];
  assert.equal(submission.status, 'WA'); assert.equal(submission.score, '40.0000'); assert.equal(submission.public_message, 'Original result');
  assert.ok(submission.pending_judge_run_id);
  const candidate = (await pool.query('SELECT task_id,status,score FROM judge_runs WHERE id=$1', [submission.pending_judge_run_id])).rows[0];
  assert.equal(candidate.task_id, task.id); assert.equal(candidate.status, 'AC'); assert.equal(candidate.score, '100.0000');
});

test('real PostgreSQL rejudge: retry and final crashed lease never overwrite an accepted current result', { skip: !enabled }, async () => {
  const queued = await enqueueRejudge();
  const first = await claimTask(pool);
  await failTask(pool, first);
  let submission = (await pool.query('SELECT status,score,pending_judge_run_id FROM submissions WHERE id=$1', [queued.submission_id])).rows[0];
  assert.equal(submission.status, 'WA'); assert.equal(submission.score, '40.0000'); assert.ok(submission.pending_judge_run_id);
  assert.equal((await pool.query('SELECT status FROM judge_runs WHERE id=$1', [submission.pending_judge_run_id])).rows[0].status, 'System Error');
  await pool.query('UPDATE judge_tasks SET available_at=now() WHERE id=$1', [queued.id]);
  const next = await claimTask(pool);
  await pool.query("UPDATE judge_tasks SET attempts=3,lease_expires_at=now()-interval '1 second' WHERE id=$1", [queued.id]);
  assert.equal(await claimTask(pool), null); assert.equal(await completeTask(pool, next, ac), false);
  submission = (await pool.query('SELECT status,score,pending_judge_run_id FROM submissions WHERE id=$1', [queued.submission_id])).rows[0];
  assert.equal(submission.status, 'WA'); assert.equal(submission.score, '40.0000');
  assert.equal((await pool.query('SELECT state FROM judge_tasks WHERE id=$1', [queued.id])).rows[0].state, 'failed');
  assert.equal((await pool.query('SELECT count(*) FROM judge_runs WHERE task_id=$1', [queued.id])).rows[0].count, '2');
});

test('real worker + go-judge: committed queue reaches a persistent genuine AC, custom never gets AC', { skip: !realEnabled }, async () => {
  const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'test-runtime' });
  await judge.ready();
  const queued = await enqueue();
  assert.equal(await processOne({ pool, judge, logger: { info() {}, error() {} } }), true);
  const result = (await pool.query('SELECT status,score FROM submissions WHERE id=$1', [queued.submission_id])).rows[0];
  assert.equal(result.status, 'AC'); assert.equal(result.score, '100.0000');
  const custom = await enqueue('custom');
  assert.equal(await processOne({ pool, judge, logger: { info() {}, error() {} } }), true);
  const customResult = (await pool.query('SELECT status,score,public_output FROM submissions WHERE id=$1', [custom.submission_id])).rows[0];
  assert.equal(customResult.status, 'Executed'); assert.equal(customResult.score, null); assert.match(customResult.public_output, /42/);
});

test('real worker + go-judge: reference must pass formal tests and samples before publication', { skip: !realEnabled }, async () => {
  const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'test-runtime' });
  await judge.ready();
  await pool.query("UPDATE problem_versions SET samples='[{\"input\":\"\",\"expected\":\"99\"}]' WHERE id=$1", [versionId]);
  await pool.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')", [versionId]);
  assert.equal(await processOne({ pool, judge, logger: { info() {}, error() {} } }), true);
  const result = (await pool.query('SELECT validation_status FROM problem_versions WHERE id=$1', [versionId])).rows[0];
  assert.equal(result.validation_status, 'WA');
});

test('real worker + go-judge: disabled public samples are excluded from runs and reference validation', { skip: !realEnabled }, async () => {
  const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'test-runtime' });
  await judge.ready();
  await pool.query('UPDATE problem_versions SET samples=$1 WHERE id=$2',[JSON.stringify([
    {input:'',expected:'99',name:'停用的错误样例',enabled:false},
    {input:'',expected:'42',name:'启用样例',enabled:true},
    {input:'',expected:'42',name:'旧版默认启用样例'}
  ]),versionId]);
  await pool.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')", [versionId]);
  assert.equal(await processOne({ pool, judge, logger: { info() {}, error() {} } }), true);
  assert.equal((await pool.query('SELECT validation_status FROM problem_versions WHERE id=$1',[versionId])).rows[0].validation_status,'AC');
  const samples=await enqueue('samples');
  assert.equal(await processOne({ pool, judge, logger: { info() {}, error() {} } }), true);
  const result=(await pool.query('SELECT status,passed,total FROM submissions WHERE id=$1',[samples.submission_id])).rows[0];
  assert.equal(result.status,'AC');assert.equal(result.passed,2);assert.equal(result.total,2);
});

test('real worker + go-judge: C++ and JavaScript submissions persist language, genuine scores and compiler fingerprint', { skip: !realEnabled, timeout: 90000 }, async () => {
  const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'test-runtime' });
  await judge.ready();
  for(const [language,code] of [
    ['cpp','#include <iostream>\nint main(){std::cout<<42;}'],
    ['javascript','console.log(42)'],
  ]) {
    const queued=await enqueue('submit',code,language);
    assert.equal(await processOne({pool,judge,logger:{info(){},error(){}}}),true);
    const submission=(await pool.query('SELECT status,score,language FROM submissions WHERE id=$1',[queued.submission_id])).rows[0];
    assert.equal(submission.status,'AC');assert.equal(submission.score,'100.0000');assert.equal(submission.language,language);
    const run=(await pool.query('SELECT environment_version FROM judge_runs WHERE submission_id=$1',[queued.submission_id])).rows[0];
    assert.match(run.environment_version,/clang-19\..*libstdc\+\+14.*node-22\./);
  }
});

test('real worker + go-judge: a JavaScript reference is validated before publishing without changing old Python rows', { skip: !realEnabled, timeout: 90000 }, async () => {
  const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'test-runtime' });
  await judge.ready();
  const published=(await pool.query('SELECT reference_language FROM problem_versions WHERE id=$1',[versionId])).rows[0];
  assert.equal(published.reference_language,'python');
  await pool.query("UPDATE problem_versions SET reference_language='javascript',reference_code='console.log(42)' WHERE id=$1",[versionId]);
  await pool.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')",[versionId]);
  assert.equal(await processOne({pool,judge,logger:{info(){},error(){}}}),true);
  assert.equal((await pool.query('SELECT validation_status FROM problem_versions WHERE id=$1',[versionId])).rows[0].validation_status,'AC');
});
