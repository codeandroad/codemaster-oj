import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/migrate.mjs';
import { claimTask, completeTask } from '../worker.mjs';
import { claimPaper4Task, completePaper4Task, failPaper4Task, loadPaper4Task,
  renewPaper4Lease, processPaper4One } from '../paper4-worker.mjs';
import { claimSchoolTask, finishSchoolTask } from '../school-worker.mjs';
import { GoJudge } from '../judge.mjs';

// A disposable schema on an explicitly provided test database. Production
// tables, volumes, accounts and scores are never truncated or reset.
const databaseUrl = process.env.JUDGE_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const realEnabled = Boolean(databaseUrl && process.env.GO_JUDGE_TEST_URL && process.env.GO_JUDGE_TEST_TOKEN);
let adminPool, pool, schema, accountId, identityId, ordinaryVersionId, problemId, paperId, paperVersionId, attemptId;
let schoolId, schoolProblemId, schoolVersionId;
const result = { status: 'Executed', publicOutput: 'ok\n', publicMessage: 'No score',
  privateResults: [{ caseId: 'sample', public: true, status: 'Executed', checks: [] }], environmentVersion: 'test-runtime' };

test.before(async () => {
  if (!enabled) return;
  schema = `paper4_worker_${randomUUID().replaceAll('-', '_')}`;
  adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 8 });
  await migrate(pool);
  identityId = (await pool.query("INSERT INTO identities(kind,number,name) VALUES('student','paper4-worker-test','Paper 4 Worker') RETURNING id")).rows[0].id;
  accountId = (await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'paper4-worker-test','unused-test-hash') RETURNING id", [identityId])).rows[0].id;
  problemId = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [accountId])).rows[0].id;
  ordinaryVersionId = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code)
    VALUES($1,'Ordinary','stdio','Ordinary',500,64,'print(1)') RETURNING id`, [problemId])).rows[0].id;
  paperId = (await pool.query("INSERT INTO paper4_papers(owner_account_id,title) VALUES($1,'Paper 4 Worker') RETURNING id", [accountId])).rows[0].id;
  paperVersionId = (await pool.query(`INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases)
    VALUES($1,'Paper 4 Worker','', $2::jsonb,$3::jsonb) RETURNING id`, [paperId,
    JSON.stringify({ language: 'python', totalMarks: 75, questions: [{ key: 'Q2', title: 'Files',
      initialFiles: { 'TheData.txt': '1,Blue\n', 'Blue.txt': '' }, outputFiles: ['Blue.txt'], stages: [{ id: 's1', maxMarks: 75, judgeMode: 'auto' }] }] }),
    JSON.stringify({ s1: [{ id: 'sample', public: true, stdin: '', expectedFiles: { 'Blue.txt': '1\n' } }] })])).rows[0].id;
  await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1', [paperId, paperVersionId]);
  attemptId = (await pool.query('INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id) VALUES($1,$2,$3,$4) RETURNING id',
    [paperId, paperVersionId, identityId, accountId])).rows[0].id;
  await pool.query(`UPDATE site_settings SET settings=settings || '{"runtime":{"workerConcurrency":1}}'::jsonb WHERE id=true`);
});
test.after(async () => {
  if (pool) await pool.end();
  if (schema) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  if (adminPool) await adminPool.end();
});

async function enqueuePaper() {
  const snapshot = (await pool.query(`INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision)
    VALUES($1,'Q2','print("ok")',0) RETURNING id`, [attemptId])).rows[0];
  return (await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING *', [snapshot.id])).rows[0];
}
async function enqueueOrdinary() {
  const submission = (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,'custom','print(1)',$5,'test') RETURNING id`,
  [accountId, identityId, problemId, ordinaryVersionId, randomUUID()])).rows[0];
  return (await pool.query("INSERT INTO judge_tasks(submission_id,version_id,purpose) VALUES($1,$2,'submission') RETURNING *",
    [submission.id, ordinaryVersionId])).rows[0];
}
const ordinaryResult = { status: 'Executed', score: null, passed: null, total: 1, publicOutput: '1\n',
  publicMessage: 'Custom', privateResults: [], environmentVersion: 'test-runtime' };

test('Paper 4 claim first consumes shared node capacity; ordinary can claim after it completes', { skip: !enabled }, async () => {
  const paper = await enqueuePaper(); await enqueueOrdinary();
  const nodeId = 'paper4-shared-node-a';
  const leased = await claimPaper4Task(pool, { nodeId });
  assert.equal(leased.id, paper.id);
  assert.equal(await claimTask(pool, { nodeId }), null);
  assert.equal(await renewPaper4Lease(pool, leased), true);
  const loaded = await loadPaper4Task(pool, leased);
  assert.equal(loaded.question.key, 'Q2');
  assert.equal(loaded.runnerCases[0].stageId, 's1');
  assert.equal(loaded.runnerCases[0].expectedFiles['Blue.txt'], '1\n');
  assert.equal(await completePaper4Task(pool, leased, result), true);
  assert.equal(await completePaper4Task(pool, leased, result), false);
  const ordinary = await claimTask(pool, { nodeId });
  assert.ok(ordinary);
  await completeTask(pool, ordinary, ordinaryResult);
  assert.equal((await pool.query('SELECT count(*) FROM paper4_runs WHERE task_id=$1', [paper.id])).rows[0].count, '1');
  assert.equal((await pool.query('SELECT count(*) FROM school_rank_ledger')).rows[0].count, '0');
});

test('reference tasks load frozen source and stage cases and persist only their own result source', { skip: !enabled }, async () => {
  const frozen = (await pool.query(`INSERT INTO paper4_reference_snapshots
    (version_id,question_key,stage_key,source_code,question,runner_cases,draft_revision)
    VALUES($1,'Q2','s1','print("reference")',$2::jsonb,$3::jsonb,0) RETURNING id`,
  [paperVersionId, JSON.stringify({ key: 'Q2', initialFiles: {}, outputFiles: [] }),
    JSON.stringify([{ id: 'reference', public: false, expectedStdout: 'reference\n' }])])).rows[0];
  const queued = (await pool.query('INSERT INTO paper4_run_tasks(reference_snapshot_id) VALUES($1) RETURNING *', [frozen.id])).rows[0];
  const leased = await claimPaper4Task(pool);
  assert.equal(leased.id, queued.id);
  const loaded = await loadPaper4Task(pool, leased);
  assert.equal(loaded.sourceCode, 'print("reference")');
  assert.equal(loaded.runnerCases[0].stageId, 's1');
  assert.equal(loaded.runnerCases[0].expectedStdout, 'reference\n');
  assert.equal(await completePaper4Task(pool, leased, { ...result, status: 'AC' }), true);
  const saved = (await pool.query('SELECT snapshot_id,reference_snapshot_id,status FROM paper4_runs WHERE task_id=$1', [queued.id])).rows[0];
  assert.equal(saved.snapshot_id, null);
  assert.equal(saved.reference_snapshot_id, frozen.id);
  assert.equal(saved.status, 'AC');
});

test('ordinary claim first consumes shared capacity; Paper 4 can claim after it completes', { skip: !enabled }, async () => {
  const paper = await enqueuePaper(); await enqueueOrdinary();
  const nodeId = 'paper4-shared-node-b';
  const ordinary = await claimTask(pool, { nodeId });
  assert.ok(ordinary);
  assert.equal(await claimPaper4Task(pool, { nodeId }), null);
  await completeTask(pool, ordinary, ordinaryResult);
  const leased = await claimPaper4Task(pool, { nodeId });
  assert.equal(leased.id, paper.id);
  await completePaper4Task(pool, leased, result);
});

test('Paper 4 infrastructure retries are fenced and never become zero or AC', { skip: !enabled }, async () => {
  const queued = await enqueuePaper();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const task = await claimPaper4Task(pool);
    assert.equal(task.id, queued.id);
    assert.equal(task.attempts, attempt);
    assert.equal(await failPaper4Task(pool, task, { environmentVersion: 'test-runtime' }), true);
    assert.equal(await failPaper4Task(pool, task), false);
    await pool.query('UPDATE paper4_run_tasks SET available_at=now() WHERE id=$1', [queued.id]);
  }
  assert.equal((await pool.query('SELECT state FROM paper4_run_tasks WHERE id=$1', [queued.id])).rows[0].state, 'failed');
  const runs = (await pool.query('SELECT status FROM paper4_runs WHERE task_id=$1', [queued.id])).rows;
  assert.deepEqual(runs.map(run => run.status), ['System Error']);
  assert.equal((await pool.query('SELECT count(*) FROM submissions')).rows[0].count, '2');
});

async function enqueueSchool() {
  if (!schoolId) {
    schoolId = (await pool.query("INSERT INTO schools(slug,name) VALUES('shared-queue-school','Shared queue test') RETURNING id")).rows[0].id;
    const bankId = (await pool.query("INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,'Test bank',$3) RETURNING id", [schoolId,accountId,randomUUID()])).rows[0].id;
    schoolProblemId = (await pool.query("INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,'{}',$4) RETURNING id", [schoolId,bankId,accountId,randomUUID()])).rows[0].id;
    schoolVersionId = (await pool.query("INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,1,'{}') RETURNING id", [schoolId,schoolProblemId])).rows[0].id;
  }
  // This fixture tests leasing only; it is never passed to the executor.
  return (await pool.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload)
    VALUES($1,$2,$3,$4,$5,'shared-capacity-test','samples','school','{}') RETURNING *`,
  [schoolId,schoolProblemId,schoolVersionId,accountId,randomUUID()])).rows[0];
}

test('school claim consumes shared capacity and fences both ordinary and Paper 4 claims', { skip: !enabled }, async () => {
  const school = await enqueueSchool(); const paper = await enqueuePaper(); const ordinary = await enqueueOrdinary();
  const nodeId = 'three-queues-school-first';
  const leasedSchool = await claimSchoolTask(pool, { nodeId });
  assert.equal(leasedSchool.id, school.id);
  assert.deepEqual(await Promise.all([claimTask(pool,{nodeId}),claimPaper4Task(pool,{nodeId})]), [null,null]);
  assert.equal(await finishSchoolTask(pool,leasedSchool,ordinaryResult),true);
  const [leasedOrdinary,leasedPaper] = await Promise.all([claimTask(pool,{nodeId}),claimPaper4Task(pool,{nodeId})]);
  assert.equal(Number(Boolean(leasedOrdinary))+Number(Boolean(leasedPaper)),1,'one newly freed slot cannot be claimed twice');
  if(leasedOrdinary){
    assert.equal(leasedOrdinary.id,ordinary.id);await completeTask(pool,leasedOrdinary,ordinaryResult);
    const next=await claimPaper4Task(pool,{nodeId});assert.equal(next.id,paper.id);await completePaper4Task(pool,next,result);
  }else{
    assert.equal(leasedPaper.id,paper.id);await completePaper4Task(pool,leasedPaper,result);
    const next=await claimTask(pool,{nodeId});assert.equal(next.id,ordinary.id);await completeTask(pool,next,ordinaryResult);
  }
});

test('ordinary and Paper 4 leases also block school jobs until their shared slot is free', { skip: !enabled }, async () => {
  const school = await enqueueSchool(); await enqueuePaper(); await enqueueOrdinary();
  const nodeId = 'three-queues-ordinary-first';
  const ordinary = await claimTask(pool,{nodeId});assert.ok(ordinary);
  assert.equal(await claimSchoolTask(pool,{nodeId}),null);assert.equal(await claimPaper4Task(pool,{nodeId}),null);
  await completeTask(pool,ordinary,ordinaryResult);
  const paper = await claimPaper4Task(pool,{nodeId});assert.ok(paper);
  assert.equal(await claimSchoolTask(pool,{nodeId}),null);
  await completePaper4Task(pool,paper,result);
  const leased = await claimSchoolTask(pool,{nodeId});assert.equal(leased.id,school.id);
  await finishSchoolTask(pool,leased,ordinaryResult);
});

test('real Paper 4 worker + go-judge persists a genuine automatic-stage AC', { skip: !realEnabled, timeout: 90000 }, async () => {
  const snapshot = (await pool.query(`INSERT INTO paper4_snapshots(attempt_id,question_key,stage_key,source_code,revision)
    VALUES($1,'Q2','s1',$2,0) RETURNING id`, [attemptId,"open('Blue.txt','w').write('1\\n')"])).rows[0];
  const queued = (await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[snapshot.id])).rows[0];
  const judge = new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'paper4-worker-test'});
  await judge.ready();
  assert.equal(await processPaper4One({pool,judge,logger:{info(){},error(){}}}),true);
  const saved=(await pool.query('SELECT t.state,r.status,r.private_results FROM paper4_run_tasks t JOIN paper4_runs r ON r.task_id=t.id WHERE t.id=$1',[queued.id])).rows[0];
  assert.equal(saved.state,'completed');assert.equal(saved.status,'AC');
  assert.equal(saved.private_results[0].stageId,'s1');assert.equal(saved.private_results[0].status,'AC');
  assert.equal(saved.private_results[0].generatedFiles['Blue.txt'],'1\n');
});
