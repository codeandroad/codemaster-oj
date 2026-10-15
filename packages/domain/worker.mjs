import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPool, transaction } from './src/db.mjs';
import { GoJudge, InfrastructureError, createJudgingBudget } from './judge.mjs';
import { processPaper4One } from './paper4-worker.mjs';

const PUBLIC_SYSTEM_MESSAGE = '评测服务暂不可用，正在重试；多次失败后请联系管理员。';
const DEFAULT_LEASE_SECONDS = 90;
const DEFAULT_MAX_ATTEMPTS = 3; // One initial execution plus two infrastructure retries.

function systemResult(environmentVersion) {
  return { status: 'System Error', score: null, passed: null, total: null, publicOutput: '',
    publicMessage: PUBLIC_SYSTEM_MESSAGE, privateResults: [], environmentVersion };
}

async function saveRun(client, task, result) {
  const saved = await client.query(`INSERT INTO judge_runs(task_id,lease_id,submission_id,version_id,status,score,passed,total,public_output,public_message,private_results,environment_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) ON CONFLICT(lease_id) DO NOTHING RETURNING id`,
  [task.id, task.lease_id, task.submission_id, task.version_id, result.status, result.score, result.passed, result.total,
    result.publicOutput, result.publicMessage, JSON.stringify(result.privateResults), result.environmentVersion]);
  return saved.rows[0]?.id ?? (await client.query('SELECT id FROM judge_runs WHERE lease_id=$1', [task.lease_id])).rows[0]?.id;
}

async function applyResult(client, task, result, runId) {
  if (task.purpose === 'validation') {
    await client.query('UPDATE problem_versions SET validation_status=$2,validation_message=$3 WHERE id=$1', [task.version_id, result.status, result.publicMessage]);
  } else if (task.rejudge) {
    // A rejudge is a reviewable candidate. Only the audited API confirmation
    // may replace the student's current result, including during retries.
    if (!runId) throw new InfrastructureError('Rejudge candidate run is missing.');
    await client.query('UPDATE submissions SET pending_judge_run_id=$2 WHERE id=$1', [task.submission_id, runId]);
  } else {
    await client.query(`UPDATE submissions SET status=$2,score=$3,passed=$4,total=$5,public_output=$6,public_message=$7 WHERE id=$1`,
      [task.submission_id, result.status, result.score, result.passed, result.total, result.publicOutput, result.publicMessage]);
  }
}

export async function claimTask(pool, { leaseSeconds = DEFAULT_LEASE_SECONDS, maxAttempts = DEFAULT_MAX_ATTEMPTS,
  environmentVersion = 'unavailable', nodeId = null } = {}) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 600 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error('Invalid worker lease configuration.');
  return transaction(pool, async (client) => {
    if(nodeId){
      await client.query('SELECT pg_advisory_xact_lock(798945)');
      const settings=(await client.query('SELECT settings FROM site_settings WHERE id=true')).rows[0]?.settings;
      const concurrency=settings?.runtime?.workerConcurrency??2;
      const active = await client.query(`SELECT
        (SELECT count(*) FROM judge_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)
        +(SELECT count(*) FROM paper4_run_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1) AS count`, [nodeId]);
      if(Number(active.rows[0].count)>=concurrency)return null;
    }
    // Lock expired tasks before changing state. SKIP LOCKED allows separate
    // workers to recover/claim without blocking each other.
    const expired = await client.query(`SELECT * FROM judge_tasks WHERE state='leased' AND lease_expires_at<=now()
      ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 20`);
    for (const task of expired.rows) {
      const exhausted = task.attempts >= maxAttempts;
      await client.query(`UPDATE judge_tasks SET state=$2,lease_id=NULL,lease_expires_at=NULL,last_error='Worker lease expired',available_at=now() WHERE id=$1`,
        [task.id, exhausted ? 'failed' : 'queued']);
      if (exhausted) {
        const result = systemResult(environmentVersion);
        const runId = await saveRun(client, task, result);
        await applyResult(client, task, result, runId);
      }
    }
    const next = await client.query(`SELECT * FROM judge_tasks WHERE state='queued' AND available_at<=now() AND attempts<$1
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [maxAttempts]);
    if (!next.rows.length) return null;
    const leaseId = randomUUID();
    const leased = await client.query(`UPDATE judge_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+($3::integer*interval '1 second'),attempts=attempts+1
      WHERE id=$1 RETURNING *`, [next.rows[0].id, leaseId, leaseSeconds]);
    if(nodeId)await client.query('UPDATE judge_tasks SET node_id=$2 WHERE id=$1',[next.rows[0].id,nodeId]);
    const task = leased.rows[0];
    if (task.purpose === 'validation') {
      await client.query("UPDATE problem_versions SET validation_status='Judging',validation_message=NULL WHERE id=$1", [task.version_id]);
    } else if (!task.rejudge) {
      await client.query("UPDATE submissions SET status='Judging',public_message=NULL WHERE id=$1", [task.submission_id]);
    }
    return task;
  });
}

export async function renewLease(pool, task, leaseSeconds = DEFAULT_LEASE_SECONDS) {
  const result = await pool.query(`UPDATE judge_tasks SET lease_expires_at=now()+($3::integer*interval '1 second')
    WHERE id=$1 AND lease_id=$2 AND state='leased' AND lease_expires_at>now() RETURNING id`, [task.id, task.lease_id, leaseSeconds]);
  return result.rowCount === 1;
}

export async function loadTask(pool, task) {
  // Task identifiers come from the queue transaction, never from a browser.
  const versionResult = await pool.query('SELECT * FROM problem_versions WHERE id=$1', [task.version_id]);
  const version = versionResult.rows[0];
  if (!version) throw new InfrastructureError('Task problem version is missing.');
  version.samples=(version.samples||[]).filter(sample=>sample.enabled!==false);
  let submission;
  if (task.purpose === 'submission') {
    submission = (await pool.query('SELECT * FROM submissions WHERE id=$1 AND version_id=$2', [task.submission_id, task.version_id])).rows[0];
    if (!submission) throw new InfrastructureError('Task submission is missing.');
  }
  const kind = task.purpose === 'validation' ? 'validation' : submission.kind;
  const code = task.purpose === 'validation' ? version.reference_code : submission.code;
  const language = task.purpose === 'validation' ? version.reference_language || 'python' : submission.language || 'python';
  let tests;
  if (kind === 'custom') tests = [{ input: submission.custom_input ?? '' }];
  else if (kind === 'samples') tests = version.samples.map((test, position) => ({ ...test, id: `sample-${position + 1}` }));
  else tests = (await pool.query('SELECT id,input,expected,weight,position FROM test_cases WHERE version_id=$1 AND enabled ORDER BY position', [task.version_id])).rows;
  return { kind, version, code, language, tests };
}

export async function completeTask(pool, task, result) {
  return transaction(pool, async (client) => {
    const current = await client.query(`SELECT * FROM judge_tasks WHERE id=$1 AND lease_id=$2 AND state='leased' AND lease_expires_at>now() FOR UPDATE`, [task.id, task.lease_id]);
    if (!current.rows.length) return false; // A late/duplicate callback never overwrites a new run.
    const runId = await saveRun(client, task, result);
    await applyResult(client, task, result, runId);
    await client.query("UPDATE judge_tasks SET state='completed',lease_expires_at=NULL,last_error=NULL WHERE id=$1 AND lease_id=$2", [task.id, task.lease_id]);
    return true;
  });
}

export async function failTask(pool, task, { maxAttempts = DEFAULT_MAX_ATTEMPTS, environmentVersion = 'unavailable' } = {}) {
  return transaction(pool, async (client) => {
    const current = await client.query(`SELECT * FROM judge_tasks WHERE id=$1 AND lease_id=$2 AND state='leased' AND lease_expires_at>now() FOR UPDATE`, [task.id, task.lease_id]);
    if (!current.rows.length) return false;
    const exhausted = current.rows[0].attempts >= maxAttempts;
    const result = systemResult(environmentVersion);
    const runId = await saveRun(client, task, result);
    await applyResult(client, task, result, runId);
    // Error causes are never saved verbatim: they can contain hidden input,
    // executor credentials or host paths. Operational logs identify task/lease.
    await client.query(`UPDATE judge_tasks SET state=$3,lease_expires_at=NULL,last_error='Executor unavailable',
      available_at=now()+($4::integer*interval '1 second') WHERE id=$1 AND lease_id=$2`,
    [task.id, task.lease_id, exhausted ? 'failed' : 'queued', Math.min(30, 2 ** current.rows[0].attempts)]);
    return true;
  });
}

export async function processOne({ pool, judge, leaseSeconds = DEFAULT_LEASE_SECONDS, maxAttempts = DEFAULT_MAX_ATTEMPTS,
  signal, logger = console, heartbeatMs = 20000, nodeId = null }) {
  const task = await claimTask(pool, { leaseSeconds, maxAttempts, environmentVersion: judge.runtimeVersion ?? judge.environmentVersion, nodeId });
  if (!task) return false;
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let heartbeating = false;
  const timer = setInterval(async () => {
    if (heartbeating || controller.signal.aborted) return;
    heartbeating = true;
    try { if (!await renewLease(pool, task, leaseSeconds)) controller.abort(); }
    catch { controller.abort(); }
    finally { heartbeating = false; }
  }, Math.min(heartbeatMs, leaseSeconds * 1000 / 3));
  timer.unref();
  try {
    const loaded = await loadTask(pool, task);
    const budget = createJudgingBudget();
    let result = await judge.judge(loaded, { signal: combinedSignal, budget });
    if (task.purpose === 'validation' && result.status === 'AC' && loaded.version.samples.length) {
      const samples = await judge.judge({ ...loaded, kind: 'samples', tests: loaded.version.samples }, { signal: combinedSignal, budget });
      if (samples.status !== 'AC') result = { ...samples, publicOutput: '', publicMessage: '参考解答未通过公开样例；题目不能发布。' };
    }
    if (!combinedSignal.aborted) {
      const accepted = await completeTask(pool, task, result);
      if(nodeId)await pool.query('UPDATE judge_nodes SET executor_ready=true WHERE id=$1',[nodeId]);
      logger.info?.(JSON.stringify({ event: accepted ? 'judge_completed' : 'judge_stale_result', taskId: task.id, leaseId: task.lease_id, status: result.status }));
    }
  } catch {
    if(nodeId)await pool.query('UPDATE judge_nodes SET executor_ready=false WHERE id=$1',[nodeId]).catch(()=>{});
    if (!combinedSignal.aborted) await failTask(pool, task, { maxAttempts, environmentVersion: judge.runtimeVersion ?? judge.environmentVersion });
    logger.error?.(JSON.stringify({ event: 'judge_infrastructure_failure', taskId: task.id, leaseId: task.lease_id }));
  } finally { clearInterval(timer); }
  return true;
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function startWorker({ pool, judge, signal, concurrency = 2, logger = console, nodeId = process.env.WORKER_NODE_ID || process.env.HOSTNAME || 'judge-worker' } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error('Worker concurrency must be 1 or 2 for the initial deployment.');
  await judge.ready(signal); // Fail closed before taking a single student job.
  const heartbeat=()=>pool.query('INSERT INTO judge_nodes(id,concurrency,runtime_version,executor_ready,heartbeat_at) VALUES($1,$2,$3,true,now()) ON CONFLICT(id) DO UPDATE SET concurrency=EXCLUDED.concurrency,runtime_version=EXCLUDED.runtime_version,heartbeat_at=now()',[nodeId,concurrency,judge.runtimeVersion??judge.environmentVersion]);
  await heartbeat();await pool.query('UPDATE judge_nodes SET executor_ready=true WHERE id=$1',[nodeId]);const nodeTimer=setInterval(()=>heartbeat().catch(()=>{}),15000);nodeTimer.unref();
  try {await Promise.all(Array.from({ length: concurrency }, async (_, slot) => {
    let preferPaper4 = slot % 2 === 1;
    while (!signal.aborted) {
      try {
        const options = { pool, judge, signal, logger, nodeId };
        // Alternate first choice under sustained load, then try the other
        // queue immediately. Both claims count the same per-node leases.
        const handled = preferPaper4
          ? await processPaper4One(options) || await processOne(options)
          : await processOne(options) || await processPaper4One(options);
        preferPaper4 = !preferPaper4;
        if (!handled) await delay(1000, signal);
      } catch {
        logger.error?.(JSON.stringify({ event: 'judge_queue_unavailable' }));
        await delay(5000, signal);
      }
    }
  }));} finally {clearInterval(nodeTimer);await pool.query('UPDATE judge_nodes SET executor_ready=false,heartbeat_at=now() WHERE id=$1',[nodeId]).catch(()=>{});}
}

async function main() {
  if (!process.env.WORKER_DATABASE_URL) throw new Error('WORKER_DATABASE_URL is required for a dedicated limited-permission worker role.');
  const pool = createPool(process.env.WORKER_DATABASE_URL);
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  try {
    const roles = await pool.query('SELECT rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user');
    if (!roles.rows[0] || roles.rows[0].rolsuper || roles.rows[0].rolcreaterole || roles.rows[0].rolcreatedb) throw new Error('Judge worker must use a restricted database role.');
    await startWorker({ pool, judge: new GoJudge(), signal: controller.signal,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? process.env.JUDGE_CONCURRENCY ?? 2) });
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Judge worker startup failed. Check dedicated DB credentials, sandbox configuration and readiness.'); process.exitCode = 1; });
}
