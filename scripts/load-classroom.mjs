// Exploratory, local-only load exercise using real accounts, API sessions and
// queue results. This does not claim a capacity result for the school server.
// Requires the disposable database named campus_test and a localhost API.
import { randomUUID, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';
import { createPool, transaction } from '../packages/domain/src/db.mjs';
import { hashPassword } from '../packages/domain/src/security.mjs';

const isLocal = (hostname) => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname);
const dbUrl = new URL(process.env.CAMPUS_LOAD_DB_URL ?? 'invalid:');
const apiUrl = new URL(process.env.CAMPUS_LOAD_API ?? 'invalid:');
const originUrl = new URL(process.env.CAMPUS_LOAD_ORIGIN ?? 'http://127.0.0.1:3000');
if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol) || !isLocal(dbUrl.hostname) || dbUrl.pathname !== '/campus_test' || dbUrl.search || dbUrl.hash) throw new Error('Use an explicit localhost CAMPUS_LOAD_DB_URL for the disposable database campus_test.');
if (!['http:', 'https:'].includes(apiUrl.protocol) || !isLocal(apiUrl.hostname) || apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) throw new Error('Use an explicit localhost CAMPUS_LOAD_API origin.');
if (!['http:', 'https:'].includes(originUrl.protocol) || !isLocal(originUrl.hostname) || originUrl.href !== `${originUrl.origin}/`) throw new Error('CAMPUS_LOAD_ORIGIN must be a localhost browser origin.');
const students = Number(process.env.CAMPUS_LOAD_STUDENTS ?? 50);
if (!Number.isInteger(students) || students < 1 || students > 50) throw new Error('The cohort must contain 1–50 synthetic students.');
const timeoutMs = 300000;
const run = randomBytes(6).toString('hex');
const password = `Load-${run}-${randomBytes(8).toString('hex')}!`;
const base = apiUrl.origin;
const origin = originUrl.origin;
const pool = createPool(dbUrl.href);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
timer.unref();
const begun = performance.now();
const stats = { loginMs: [], readMs: [], receiptMs: [], completionObservedMs: [], errors: [] };
const fixtures = { accounts: [], identities: [], classId: null, assignmentId: null };
const pending = new Map();
const terminal = new Map();
let problem, cohort = [], sessions = 0, receipts = 0, reads = 0;

function quantiles(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const ordered = [...values].sort((a, b) => a - b);
  const rounded = (value) => Math.round(value * 100) / 100;
  return { count: values.length, p50: rounded(ordered[Math.ceil(ordered.length * 0.5) - 1]),
    p95: rounded(ordered[Math.ceil(ordered.length * 0.95) - 1]), max: rounded(ordered.at(-1)) };
}

async function request(student, path, body, phase) {
  const start = performance.now();
  try {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      headers: { Origin: origin, ...(student.cookie ? { Cookie: student.cookie, 'X-CSRF-Token': student.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) {
      stats.errors.push({ phase, status: response.status, code: data.error?.code ?? 'HTTP_ERROR' });
      return null;
    }
    if (phase === 'login') {
      student.cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
      student.csrfToken = data.csrfToken;
      if (!student.cookie || !student.csrfToken) throw new Error('SESSION_MISSING');
      sessions++; stats.loginMs.push(performance.now() - start);
    } else if (phase === 'read') { reads++; stats.readMs.push(performance.now() - start); }
    else if (phase === 'receipt') { receipts++; stats.receiptMs.push(performance.now() - start); }
    return data;
  } catch (error) {
    stats.errors.push({ phase, status: null, code: error.message === 'SESSION_MISSING' ? 'SESSION_MISSING' : controller.signal.aborted ? 'COHORT_TIMEOUT' : 'REQUEST_FAILED' });
    return null;
  }
}

async function sleep(ms) {
  if (controller.signal.aborted) return;
  await new Promise((resolve) => {
    const done = () => { clearTimeout(wait); controller.signal.removeEventListener('abort', done); resolve(); };
    const wait = setTimeout(done, ms);
    controller.signal.addEventListener('abort', done, { once: true });
  });
}

async function setup() {
  let problemId = process.env.CAMPUS_LOAD_PROBLEM_ID;
  if (!problemId) {
    try { problemId = JSON.parse(await readFile('/private/tmp/campus-judge-smoke.json', 'utf8')).problemId; }
    catch { throw new Error('Set CAMPUS_LOAD_PROBLEM_ID to a published lightweight test problem.'); }
  }
  if (!/^[0-9a-f-]{36}$/i.test(problemId)) throw new Error('Invalid CAMPUS_LOAD_PROBLEM_ID.');
  const selected = await pool.query(`SELECT v.*,p.owner_account_id,(SELECT count(*)::int FROM test_cases t WHERE t.version_id=v.id) testcase_count
    FROM problems p JOIN problem_versions v ON v.id=p.current_version_id WHERE p.id=$1 AND p.archived_at IS NULL AND v.published_at IS NOT NULL AND v.validation_status='AC'`, [problemId]);
  if (!selected.rows.length) throw new Error('The chosen local test problem must already be published and reference-validated.');
  problem = selected.rows[0];
  if (problem.testcase_count > 10 || problem.time_limit_ms > 1000 || problem.memory_limit_mb > 128) throw new Error('Use a lightweight known test problem: at most 10 cases, 1000 ms and 128 MiB.');
  const hashed = await hashPassword(password); // Same synthetic secret, hashed once; real logins still verify it 50 times.
  await transaction(pool, async (db) => {
    fixtures.classId = (await db.query("INSERT INTO classes(name,type,owner_account_id) VALUES($1,'training',$2) RETURNING id", [`Local load ${run}`, problem.owner_account_id])).rows[0].id;
    await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)', [fixtures.classId, problem.owner_account_id]);
    fixtures.assignmentId = (await db.query(`INSERT INTO assignments(title,class_id,owner_account_id,due_at) VALUES($1,$2,$3,now()+interval '15 minutes') RETURNING id`, [`Local load ${run}`, fixtures.classId, problem.owner_account_id])).rows[0].id;
    await db.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)', [fixtures.assignmentId, problem.problem_id, problem.id]);
    for (let index = 0; index < students; index++) {
      const suffix = String(index + 1).padStart(2, '0');
      const identity = (await db.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$2) RETURNING id", [`LOAD-${run}-${suffix}`, `Synthetic student ${suffix}`])).rows[0].id;
      const username = `load.${run}.student.${suffix}`;
      const account = (await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, username, hashed])).rows[0].id;
      fixtures.identities.push(identity); fixtures.accounts.push(account);
      await db.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [account]);
      await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [fixtures.classId, identity]);
      await db.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)', [fixtures.assignmentId, identity]);
      cohort.push({ username, cookie: '', csrfToken: '', accountId: account });
    }
  });
}

async function exercise() {
  await Promise.all(cohort.map((student) => request(student, 'auth/login', { username: student.username, password }, 'login')));
  console.log(JSON.stringify({ phase: 'login', syntheticStudents: students, authenticatedSessions: sessions, latencyMs: quantiles(stats.loginMs) }));
  const active = cohort.filter((student) => student.cookie && student.csrfToken);
  await Promise.all(active.map(async (student) => {
    for (const path of [`problems/${problem.problem_id}`, 'assignments', 'submissions', 'classes']) {
      const data = await request(student, path, undefined, 'read');
      if (path.startsWith('problems/') && data && (Object.hasOwn(data, 'tests') || Object.hasOwn(data, 'referenceCode'))) stats.errors.push({ phase: 'read', status: 200, code: 'PRIVATE_CONTENT_EXPOSED' });
    }
  }));
  console.log(JSON.stringify({ phase: 'reads', successfulReads: reads, latencyMs: quantiles(stats.readMs) }));
  await Promise.all(active.map(async (student) => {
    const data = await request(student, 'submissions', { problemId: problem.problem_id, versionId: problem.id, assignmentId: fixtures.assignmentId,
      kind: 'submit', code: problem.reference_code, idempotencyKey: randomUUID() }, 'receipt');
    if (data?.id) pending.set(data.id, { student, receivedAt: performance.now() });
  }));
  console.log(JSON.stringify({ phase: 'queue_receipts', accepted: receipts, latencyMs: quantiles(stats.receiptMs) }));
  while (pending.size && !controller.signal.aborted) {
    await Promise.all([...pending].map(async ([id, item]) => {
      const result = await request(item.student, `submissions/${id}`, undefined, 'poll');
      if (result && !['Waiting', 'Judging', 'System Error'].includes(result.status)) {
        terminal.set(id, { status: result.status, score: result.score });
        stats.completionObservedMs.push(performance.now() - item.receivedAt);
        pending.delete(id);
      } else if (result?.status === 'System Error') {
        // Automatic retries retain this status during backoff; query the job
        // state in the disposable DB to distinguish a final infrastructure failure.
        const task = (await pool.query('SELECT state FROM judge_tasks WHERE submission_id=$1', [id.replace(/^SUB/, '')])).rows[0];
        if (task?.state === 'failed') { terminal.set(id, { status: result.status, score: result.score }); pending.delete(id); }
      }
    }));
    if (pending.size) await sleep(1000);
  }
}

async function cleanup() {
  if (!fixtures.accounts.length) return;
  await transaction(pool, async (db) => {
    await db.query('DELETE FROM sessions WHERE account_id=ANY($1::uuid[])', [fixtures.accounts]);
    if (pending.size) {
      // Keep unfinished jobs intact for recovery; remove interactive access.
      await db.query('UPDATE accounts SET disabled_at=now() WHERE id=ANY($1::uuid[])', [fixtures.accounts]);
      return;
    }
    const subquery = 'SELECT id FROM submissions WHERE account_id=ANY($1::uuid[])';
    await db.query(`DELETE FROM review_entries WHERE submission_id IN (${subquery})`, [fixtures.accounts]);
    await db.query(`DELETE FROM judge_runs WHERE submission_id IN (${subquery})`, [fixtures.accounts]);
    await db.query(`DELETE FROM judge_tasks WHERE submission_id IN (${subquery})`, [fixtures.accounts]);
    await db.query('DELETE FROM submissions WHERE account_id=ANY($1::uuid[])', [fixtures.accounts]);
    await db.query('DELETE FROM assignment_participants WHERE assignment_id=$1', [fixtures.assignmentId]);
    await db.query('DELETE FROM assignment_problems WHERE assignment_id=$1', [fixtures.assignmentId]);
    await db.query('DELETE FROM assignments WHERE id=$1', [fixtures.assignmentId]);
    await db.query('DELETE FROM class_members WHERE class_id=$1', [fixtures.classId]);
    await db.query('DELETE FROM teacher_classes WHERE class_id=$1', [fixtures.classId]);
    await db.query('DELETE FROM classes WHERE id=$1', [fixtures.classId]);
    // Login audit retains its event but removes the synthetic actor FK before
    // deleting only our own fixtures, without touching unrelated audit records.
    await db.query('UPDATE audit_events SET actor_account_id=NULL WHERE actor_account_id=ANY($1::uuid[])', [fixtures.accounts]);
    await db.query('DELETE FROM account_roles WHERE account_id=ANY($1::uuid[])', [fixtures.accounts]);
    await db.query('DELETE FROM accounts WHERE id=ANY($1::uuid[])', [fixtures.accounts]);
    await db.query('DELETE FROM identities WHERE id=ANY($1::uuid[])', [fixtures.identities]);
  });
}

try {
  await setup(); await exercise();
  const verdicts = {};
  for (const result of terminal.values()) verdicts[result.status] = (verdicts[result.status] ?? 0) + 1;
  const summary = { scenario: 'local_exploratory_50_student_classroom', syntheticStudents: students, authenticatedSessions: sessions,
    successfulReads: reads, acceptedSubmissions: receipts, completedSubmissions: terminal.size, unfinishedSubmissions: pending.size,
    verdicts, fullScores: [...terminal.values()].filter((result) => result.status === 'AC' && result.score === 100).length,
    loginMs: quantiles(stats.loginMs), readMs: quantiles(stats.readMs), receiptMs: quantiles(stats.receiptMs),
    completionObservedMs: quantiles(stats.completionObservedMs), elapsedSeconds: Math.round((performance.now() - begun) / 10) / 100,
    timeoutSeconds: timeoutMs / 1000, errors: stats.errors, schoolHardwareCapacityVerified: false };
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.CAMPUS_LOAD_OUTPUT) await writeFile(process.env.CAMPUS_LOAD_OUTPUT, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  if (sessions !== students || receipts !== students || terminal.size !== students || summary.fullScores !== students || stats.errors.length) process.exitCode = 1;
} catch {
  console.error('Classroom load exercise failed. Verify the explicit disposable local DB, API origin, known published problem and running worker. No secret values were logged.');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try { await cleanup(); }
  catch { console.error('Synthetic fixture cleanup failed; only this run’s test fixtures may remain in campus_test.'); process.exitCode = 1; }
  await pool.end();
}
