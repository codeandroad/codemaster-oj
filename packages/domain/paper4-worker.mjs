// The Paper 4 queue shares the ordinary judge worker's concurrency budget,
// node heartbeat and already-verified executor. Formal Paper 4 runs can
// trigger their own fixed rank award; they never write ordinary OJ
// submissions, AC rewards or teacher-assigned Paper 4 marks.
import { randomUUID } from 'node:crypto';
import { transaction } from './src/db.mjs';
import { InfrastructureError } from './judge.mjs';
import { runPaper4Snapshot } from './paper4-runner.mjs';

const DEFAULT_LEASE_SECONDS = 90;
const DEFAULT_MAX_ATTEMPTS = 3;
const SYSTEM_MESSAGE = '运行服务暂不可用，正在重试；多次失败后请联系管理员。';

function systemResult(environmentVersion) {
  return { status: 'System Error', publicOutput: '', publicMessage: SYSTEM_MESSAGE,
    privateResults: [], environmentVersion };
}

async function saveRun(client, task, result) {
  const saved = await client.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,reference_snapshot_id,status,public_output,public_message,private_results,environment_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(lease_id) DO NOTHING RETURNING id`,
  [task.id, task.lease_id, task.snapshot_id, task.reference_snapshot_id, result.status, result.publicOutput, result.publicMessage,
    JSON.stringify(result.privateResults), result.environmentVersion]);
  return saved.rows[0]?.id ?? (await client.query('SELECT id FROM paper4_runs WHERE lease_id=$1', [task.lease_id])).rows[0]?.id;
}

export async function claimPaper4Task(pool, { leaseSeconds = DEFAULT_LEASE_SECONDS, maxAttempts = DEFAULT_MAX_ATTEMPTS,
  environmentVersion = 'unavailable', nodeId = null } = {}) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 600 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error('Invalid Paper 4 worker lease configuration.');
  return transaction(pool, async client => {
    if (nodeId) {
      // Same lock and capacity count as the ordinary OJ queue. This avoids
      // doubling executor pressure when the two queues are both busy.
      await client.query('SELECT pg_advisory_xact_lock(798945)');
      const settings = (await client.query('SELECT settings FROM site_settings WHERE id=true')).rows[0]?.settings;
      const concurrency = settings?.runtime?.workerConcurrency ?? 2;
      const active = await client.query(`SELECT
        (SELECT count(*) FROM judge_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)
        +(SELECT count(*) FROM paper4_run_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1) AS count`, [nodeId]);
      if (Number(active.rows[0].count) >= concurrency) return null;
    }
    const expired = await client.query(`SELECT * FROM paper4_run_tasks WHERE state='leased' AND lease_expires_at<=now()
      ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 20`);
    for (const task of expired.rows) {
      const exhausted = task.attempts >= maxAttempts;
      if (exhausted) await saveRun(client, task, systemResult(environmentVersion));
      await client.query(`UPDATE paper4_run_tasks SET state=$2,lease_id=NULL,lease_expires_at=NULL,
        last_error='Worker lease expired',available_at=now() WHERE id=$1`, [task.id, exhausted ? 'failed' : 'queued']);
    }
    const next = await client.query(`SELECT * FROM paper4_run_tasks WHERE state='queued' AND available_at<=now() AND attempts<$1
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [maxAttempts]);
    if (!next.rows.length) return null;
    const leased = await client.query(`UPDATE paper4_run_tasks SET state='leased',lease_id=$2,
      lease_expires_at=now()+($3::integer*interval '1 second'),attempts=attempts+1,node_id=$4
      WHERE id=$1 RETURNING *`, [next.rows[0].id, randomUUID(), leaseSeconds, nodeId]);
    return leased.rows[0];
  });
}

export async function renewPaper4Lease(pool, task, leaseSeconds = DEFAULT_LEASE_SECONDS) {
  const result = await pool.query(`UPDATE paper4_run_tasks SET lease_expires_at=now()+($3::integer*interval '1 second')
    WHERE id=$1 AND lease_id=$2 AND state='leased' AND lease_expires_at>now() RETURNING id`,
  [task.id, task.lease_id, leaseSeconds]);
  return result.rowCount === 1;
}

export async function loadPaper4Task(pool, task) {
  if (task.reference_snapshot_id) {
    const row = (await pool.query(`SELECT source_code,question,runner_cases,stage_key
      FROM paper4_reference_snapshots WHERE id=$1`, [task.reference_snapshot_id])).rows[0];
    if (!row || !row.question || !Array.isArray(row.runner_cases) || !row.stage_key || !row.runner_cases.length)
      throw new InfrastructureError('Paper 4 reference snapshot is invalid.');
    return { sourceCode: row.source_code, question: row.question,
      runnerCases: row.runner_cases.map(testCase => ({ ...testCase, stageId: row.stage_key })) };
  }
  const row = (await pool.query(`SELECT s.source_code,s.question_key,s.stage_key,v.definition,v.runner_cases
    FROM paper4_snapshots s JOIN paper4_attempts a ON a.id=s.attempt_id
    JOIN paper4_versions v ON v.id=a.version_id WHERE s.id=$1`, [task.snapshot_id])).rows[0];
  if (!row) throw new InfrastructureError('Paper 4 snapshot is missing.');
  const question = row.definition?.questions?.find(candidate => candidate.key === row.question_key);
  if (!question) throw new InfrastructureError('Paper 4 question is missing.');
  const autoStages = (question.stages ?? []).filter(stage => stage.judgeMode === 'auto' &&
    (!row.stage_key || stage.id === row.stage_key));
  if (row.stage_key && !autoStages.length) throw new InfrastructureError('Paper 4 automatic stage is missing.');
  let runnerCases = autoStages.flatMap(stage => {
    const cases = row.runner_cases?.[stage.id];
    if (!Array.isArray(cases) || !cases.length) throw new InfrastructureError('Paper 4 automatic stage cases are invalid.');
    return cases.map(testCase => ({ ...testCase, stageId: stage.id }));
  });
  // Versions created before stage-level judging remain manually reviewed.
  // Preserve their old per-question functional hints without awarding AC.
  if (!autoStages.length && !row.stage_key && (question.stages ?? []).every(stage => !stage.judgeMode)) {
    const legacy = row.runner_cases?.[question.key] ?? [];
    if (!Array.isArray(legacy)) throw new InfrastructureError('Legacy Paper 4 cases are invalid.');
    runnerCases = legacy;
  }
  return { sourceCode: row.source_code, question, runnerCases };
}

export async function completePaper4Task(pool, task, result) {
  return transaction(pool, async client => {
    const current = await client.query(`SELECT id FROM paper4_run_tasks WHERE id=$1 AND lease_id=$2 AND state='leased'
      AND lease_expires_at>now() FOR UPDATE`, [task.id, task.lease_id]);
    if (!current.rowCount) return false;
    await saveRun(client, task, result);
    await client.query(`UPDATE paper4_run_tasks SET state='completed',lease_expires_at=NULL,last_error=NULL
      WHERE id=$1 AND lease_id=$2`, [task.id, task.lease_id]);
    return true;
  });
}

export async function failPaper4Task(pool, task, { maxAttempts = DEFAULT_MAX_ATTEMPTS,
  environmentVersion = 'unavailable' } = {}) {
  return transaction(pool, async client => {
    const current = await client.query(`SELECT attempts FROM paper4_run_tasks WHERE id=$1 AND lease_id=$2
      AND state='leased' AND lease_expires_at>now() FOR UPDATE`, [task.id, task.lease_id]);
    if (!current.rowCount) return false;
    const exhausted = current.rows[0].attempts >= maxAttempts;
    if (exhausted) await saveRun(client, task, systemResult(environmentVersion));
    await client.query(`UPDATE paper4_run_tasks SET state=$3,lease_expires_at=NULL,
      last_error='Executor unavailable',available_at=now()+($4::integer*interval '1 second')
      WHERE id=$1 AND lease_id=$2`,
    [task.id, task.lease_id, exhausted ? 'failed' : 'queued', Math.min(30, 2 ** current.rows[0].attempts)]);
    return true;
  });
}

export async function processPaper4One({ pool, judge, leaseSeconds = DEFAULT_LEASE_SECONDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS, signal, logger = console, heartbeatMs = 20000, nodeId = null }) {
  const environmentVersion = judge.runtimeVersion ?? judge.environmentVersion;
  const task = await claimPaper4Task(pool, { leaseSeconds, maxAttempts, environmentVersion, nodeId });
  if (!task) return false;
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let heartbeating = false;
  const timer = setInterval(async () => {
    if (heartbeating || controller.signal.aborted) return;
    heartbeating = true;
    try { if (!await renewPaper4Lease(pool, task, leaseSeconds)) controller.abort(); }
    catch { controller.abort(); }
    finally { heartbeating = false; }
  }, Math.min(heartbeatMs, leaseSeconds * 1000 / 3));
  timer.unref();
  try {
    const loaded = await loadPaper4Task(pool, task);
    const result = await runPaper4Snapshot(loaded, judge, { signal: combinedSignal });
    if (!combinedSignal.aborted) {
      const accepted = await completePaper4Task(pool, task, result);
      if (nodeId) await pool.query('UPDATE judge_nodes SET executor_ready=true WHERE id=$1', [nodeId]);
      logger.info?.(JSON.stringify({ event: accepted ? 'paper4_completed' : 'paper4_stale_result',
        taskId: task.id, leaseId: task.lease_id, status: result.status }));
    }
  } catch {
    if (nodeId) await pool.query('UPDATE judge_nodes SET executor_ready=false WHERE id=$1', [nodeId]).catch(() => {});
    if (!combinedSignal.aborted) await failPaper4Task(pool, task, { maxAttempts, environmentVersion });
    logger.error?.(JSON.stringify({ event: 'paper4_infrastructure_failure', taskId: task.id, leaseId: task.lease_id }));
  } finally { clearInterval(timer); }
  return true;
}
