import { transaction } from './db.mjs';
import { auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { bytes, canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';
import { validateTask } from '../judge.mjs';
import { submissionCaseFeedback } from './submission-feedback.mjs';
import { metadataPage } from './problem-submissions.mjs';

const reply = (body, status = 200) => ({ status, body });
const scope = (db, schoolId) => db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
const manages = (activity, user, role) => role === 'school_admin' || role === 'teacher' && activity.owner_account_id === user.id;
const canPreview = a => a.kind === 'assignment' && a.state !== 'Archived';
const instant = value => value == null || value === '' ? null : (() => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(400, 'VALIDATION', 'Invalid activity date.');
  return date.toISOString();
})();
const ids = (value, label, maximum = 2000) => {
  if (!Array.isArray(value) || value.length > maximum) fail(400, 'VALIDATION', `${label} must be a list of at most ${maximum} items.`);
  return [...new Set(value.map(item => uuid(item, label)))];
};
const safeDefinition = d => ({ title: d.title, statement: d.statement, mode: d.mode, functionName: d.function_name,
  comparator: d.comparator, timeLimitMs: d.time_limit_ms, memoryLimitMb: d.memory_limit_mb,
  starterCode: d.starter_code, samples: d.samples.map(t => ({ input: t.input, expected: t.expected })) });

/** Use in all non-activity projections, including solved and course progress. */
export function schoolActivityJobVisibleSql(alias = 'j') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  return `(${alias}.activity_id IS NULL OR ${alias}.kind <> 'submit' OR EXISTS (
    SELECT 1 FROM school_activities activity_visibility
    WHERE activity_visibility.school_id=${alias}.school_id AND activity_visibility.id=${alias}.activity_id
      AND (activity_visibility.kind='assignment' OR activity_visibility.results_published_at IS NOT NULL)))`;
}
async function jobActivity(db, job) {
  if (!job.activity_id || job.kind !== 'submit') return null;
  return (await db.query('SELECT kind,results_published_at FROM school_activities WHERE school_id=$1 AND id=$2', [job.school_id, job.activity_id])).rows[0];
}
const jobResultsVisible = (job, activity) => !job.activity_id || job.kind !== 'submit' ||
  Boolean(activity && (activity.kind === 'assignment' || activity.results_published_at));

export async function activityJobVisible(db, job) {
  return jobResultsVisible(job, await jobActivity(db, job));
}

export async function schoolJobFeedback(db, job, activity) {
  const context = activity ?? await jobActivity(db, job);
  const resultsVisible = jobResultsVisible(job, context);
  if (!resultsVisible) return { resultsVisible, caseFeedback: [] };
  const r = job.result;
  const showWrongAnswer = job.kind === 'submit' && job.state === 'completed' && r?.status === 'WA' &&
    (!job.activity_id || context?.kind === 'assignment');
  const caseFeedback = submissionCaseFeedback({ kind: job.kind, status: r?.status, context_resolved: showWrongAnswer,
    custom_input: job.payload.tests?.[0]?.input }, job.payload.version, r?.privateResults,
  { formalTests: showWrongAnswer ? job.payload.tests : [] });
  return { resultsVisible, caseFeedback };
}
/** A live timed attempt cannot be bypassed through a course/public/practice URL. */
export async function schoolActivityProblemAccess(db, { schoolId, problemId, user, activityId = null }) {
  const blocked = (await db.query(`SELECT a.id FROM school_activities a
    JOIN school_activity_problems p ON p.school_id=a.school_id AND p.activity_id=a.id
    JOIN school_activity_attempts t ON t.school_id=a.school_id AND t.activity_id=a.id
    JOIN school_identities i ON i.school_id=t.school_id AND i.id=t.identity_id
    WHERE a.school_id=$1 AND p.problem_id=$2 AND i.account_id=$3 AND a.kind='timed'
      AND a.state<>'Draft' AND a.results_published_at IS NULL AND a.id IS DISTINCT FROM $4::uuid
      AND clock_timestamp()<least(a.ends_at,coalesce(a.forced_ended_at,a.ends_at)) LIMIT 1`,
  [schoolId, problemId, user.id, activityId])).rows[0];
  if (blocked) fail(403, 'ACTIVITY_RESTRICTED', 'Open this problem from your timed practice until its assessment window closes.');
}

async function identity(db, schoolId, accountId) {
  return (await db.query("SELECT id,name,number FROM school_identities WHERE school_id=$1 AND account_id=$2 AND kind='student'", [schoolId, accountId])).rows[0];
}
async function load(db, schoolId, activityId, user, role, { management = false } = {}) {
  const a = (await db.query('SELECT *,ends_at::text AS exact_ends_at FROM school_activities WHERE school_id=$1 AND id=$2 FOR UPDATE', [schoolId, activityId])).rows[0];
  if (!a) fail(404, 'NOT_FOUND', 'Activity not found.');
  const canManage = manages(a, user, role);
  const student = role === 'student' ? await identity(db, schoolId, user.id) : null;
  const enrolled = student && (await db.query('SELECT 1 FROM school_activity_participants WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3', [schoolId, activityId, student.id])).rowCount;
  if (management ? !canManage : !canManage && (!enrolled || a.state !== 'Published')) fail(404, 'NOT_FOUND', 'Activity not found.');
  return { a, canManage, student };
}
const effectiveEnd = a => [a.ends_at, a.forced_ended_at].filter(Boolean).reduce((min, date) => !min || +new Date(date) < +new Date(min) ? date : min, null);
function phase(a, now = Date.now()) {
  if (a.state !== 'Published') return a.state;
  if (a.forced_ended_at) return 'Ended';
  if (a.starts_at && now < +new Date(a.starts_at)) return 'Upcoming';
  if (effectiveEnd(a) && now >= +new Date(effectiveEnd(a))) return 'Ended';
  return 'Open';
}
function acceptsActivityWork(a, now) {
  const currentPhase = phase(a, now);
  if (a.kind === 'timed') return currentPhase === 'Open';
  return !a.forced_ended_at && !a.results_published_at && (currentPhase === 'Open' || currentPhase === 'Ended');
}
function canSubmitActivityWork(a, attempt, now = Date.now()) {
  return acceptsActivityWork(a, now) && !attempt?.finishedAt && (a.kind === 'assignment' ||
    Boolean(attempt && (!attempt.deadlineAt || now < +new Date(attempt.deadlineAt))));
}
async function problems(db, a) {
  return (await db.query(`SELECT p.problem_id AS id,p.version_id AS "versionId",p.position,p.points,
    v.definition->>'title' AS title FROM school_activity_problems p
    JOIN school_problem_versions v ON v.school_id=p.school_id AND v.problem_id=p.problem_id AND v.id=p.version_id
    WHERE p.school_id=$1 AND p.activity_id=$2 ORDER BY p.position,p.problem_id`, [a.school_id, a.id])).rows;
}
async function attempt(db, a, studentId) {
  return (await db.query('SELECT * FROM school_activity_attempts WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3', [a.school_id, a.id, studentId])).rows[0] ?? null;
}
const publicAttempt = t => t ? { id: t.id, startedAt: t.started_at, deadlineAt: t.deadline_at, finishedAt: t.finished_at } : null;

export async function calculateSchoolActivityGrade(db, a, studentId) {
  const entries = await problems(db, a);
  const rows = (await db.query(`SELECT p.problem_id,
    count(j.id) FILTER(WHERE j.activity_id=a.id AND j.created_at<=coalesce(j.activity_deadline_at,'infinity'))::int AS activity_attempts,
    count(j.id) FILTER(WHERE j.created_at<=coalesce(a.ends_at,'infinity') AND ${schoolActivityJobVisibleSql('j')})::int AS all_attempts,
    max(CASE WHEN j.activity_id=a.id AND j.state='completed' AND j.created_at<=coalesce(j.activity_deadline_at,'infinity') THEN (j.result->>'score')::numeric END) AS best,
    bool_or(j.activity_id=a.id AND j.state='completed' AND j.result->>'status'='AC' AND j.created_at<=coalesce(j.activity_deadline_at,'infinity')) AS accepted,
    bool_or(a.kind='assignment' AND j.activity_id IS DISTINCT FROM a.id AND j.state='completed' AND j.result->>'status'='AC'
      AND j.created_at<=coalesce(a.ends_at,'infinity') AND ${schoolActivityJobVisibleSql('j')}) AS inherited
    FROM school_activities a JOIN school_activity_problems p ON p.school_id=a.school_id AND p.activity_id=a.id
    LEFT JOIN school_judge_jobs j ON j.school_id=p.school_id AND j.problem_id=p.problem_id AND j.version_id=p.version_id
      AND j.identity_id=$3 AND j.access_context='school' AND j.kind='submit'
    WHERE a.school_id=$1 AND a.id=$2 GROUP BY p.problem_id`, [a.school_id, a.id, studentId])).rows;
  return activityGrade(entries, rows, a.kind);
}
function activityGrade(entries, rows, kind) {
  const items = entries.map(p => {
    const r = rows.find(item => item.problem_id === p.id);
    const solved = Boolean(r?.accepted || r?.inherited);
    const percentage = solved ? 100 : Math.max(0, Math.min(100, Number(r?.best ?? 0)));
    return { ...p, status: solved ? 'AC' : r?.activity_attempts ? 'NotPassed' : 'NotStarted', solved,
      score: Math.round(percentage * p.points) / 100, attempts: kind === 'assignment' ? r?.all_attempts ?? 0 : r?.activity_attempts ?? 0,
      activityAttempts: r?.activity_attempts ?? 0, inherited: Boolean(r?.inherited && !r?.accepted) };
  });
  return { items, score: Math.round(items.reduce((n, p) => n + p.score, 0) * 100) / 100,
    total: items.reduce((n, p) => n + p.points, 0), solved: items.filter(p => p.solved).length,
    attempted: items.filter(p => p.attempts > 0 || p.solved).length };
}
async function detail(db, loaded, user) {
  const { a, canManage, student } = loaded;
  const items = await problems(db, a), ownAttempt = student ? await attempt(db, a, student.id) : null;
  let grade = null;
  if (student && (a.kind === 'assignment' || a.results_published_at)) {
    grade = a.kind === 'timed' ? (await db.query('SELECT grade FROM school_activity_results WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3', [a.school_id, a.id, student.id])).rows[0]?.grade ?? null : await calculateSchoolActivityGrade(db, a, student.id);
  }
  const participantCount = (await db.query('SELECT count(*)::int AS n FROM school_activity_participants WHERE school_id=$1 AND activity_id=$2', [a.school_id, a.id])).rows[0].n;
  const now = Date.now(), attemptView = publicAttempt(ownAttempt);
  return { id: a.id, schoolId: a.school_id, kind: a.kind, title: a.title, description: a.description,
    state: a.state, phase: phase(a, now), revision: a.revision, startsAt: a.starts_at, endsAt: effectiveEnd(a), durationMinutes: a.duration_minutes,
    publishedAt: a.published_at, resultsPublishedAt: a.results_published_at, canManage,
    canPreview: canManage && canPreview(a) && items.length > 0, participantCount, problems: items,
    attempt: attemptView, canSubmit: Boolean(student) && canSubmitActivityWork(a, attemptView, now), grade,
    ...(canManage ? { identityIds: (await db.query('SELECT identity_id FROM school_activity_participants WHERE school_id=$1 AND activity_id=$2 ORDER BY identity_id', [a.school_id, a.id])).rows.map(r => r.identity_id),
      classIds: (await db.query('SELECT class_id FROM school_activity_classes WHERE school_id=$1 AND activity_id=$2 ORDER BY class_id', [a.school_id, a.id])).rows.map(r => r.class_id) } : {}) };
}
function normalize(body, kind) {
  const startsAt = instant(body.startsAt), endsAt = instant(body.endsAt);
  const durationMinutes = kind === 'timed' ? integer(Number(body.durationMinutes), 1, 1440, 'Duration') : null;
  if (startsAt && endsAt && startsAt >= endsAt) fail(400, 'VALIDATION', 'Timed practice needs an opening time, later closing time and duration.');
  if (!Array.isArray(body.problems) || body.problems.length > 100) fail(400, 'VALIDATION', 'Select at most 100 problems.');
  const entries = body.problems.map((p, i) => ({ problemId: uuid(p.problemId), versionId: uuid(p.versionId), points: integer(Number(p.points ?? 100), 1, 1000, 'Points'), position: i + 1 }));
  if (new Set(entries.map(p => p.problemId)).size !== entries.length) fail(400, 'VALIDATION', 'A problem can appear only once.');
  return { title: field(body.title, 'Title', { max: 200 }), description: field(body.description ?? '', 'Description', { min: 0, max: 10000 }),
    startsAt, endsAt, durationMinutes, problems: entries, identityIds: ids(body.identityIds ?? [], 'Students'), classIds: ids(body.classIds ?? [], 'Classes', 100) };
}
async function validateSelections(db, schoolId, data) {
  for (const p of data.problems) {
    const valid = (await db.query(`SELECT 1 FROM school_problems p JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
      WHERE p.school_id=$1 AND p.id=$2 AND p.published_version_id=$3 AND p.published AND NOT b.archived`, [schoolId, p.problemId, p.versionId])).rowCount;
    if (!valid) fail(404, 'PROBLEM_UNAVAILABLE', 'A selected problem version is unavailable. Refresh the problem list.');
  }
  if (data.classIds.length) {
    const selected = (await db.query('SELECT id FROM school_classes WHERE school_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL', [schoolId, data.classIds])).rows;
    if (selected.length !== data.classIds.length) fail(404, 'NOT_FOUND', 'A selected class is unavailable.');
    const members = (await db.query(`SELECT r.identity_id FROM school_class_roster r JOIN school_identities i ON i.school_id=r.school_id AND i.id=r.identity_id
      WHERE r.school_id=$1 AND r.class_id=ANY($2::uuid[]) AND i.kind='student' AND i.archived_at IS NULL`, [schoolId, data.classIds])).rows;
    data.identityIds = [...new Set([...data.identityIds, ...members.map(r => r.identity_id)])];
  }
  if (data.identityIds.length > 2000) fail(400, 'VALIDATION', 'Select at most 2000 students.');
  if (data.identityIds.length && (await db.query("SELECT id FROM school_identities WHERE school_id=$1 AND id=ANY($2::uuid[]) AND kind='student' AND archived_at IS NULL", [schoolId, data.identityIds])).rowCount !== data.identityIds.length) fail(404, 'NOT_FOUND', 'A selected student is unavailable.');
}
async function storeSelections(db, schoolId, activityId, data) {
  for (const table of ['school_activity_problems', 'school_activity_participants', 'school_activity_classes']) await db.query(`DELETE FROM ${table} WHERE school_id=$1 AND activity_id=$2`, [schoolId, activityId]);
  for (const p of data.problems) await db.query('INSERT INTO school_activity_problems(school_id,activity_id,problem_id,version_id,position,points) VALUES($1,$2,$3,$4,$5,$6)', [schoolId, activityId, p.problemId, p.versionId, p.position, p.points]);
  for (const id of data.identityIds) await db.query('INSERT INTO school_activity_participants(school_id,activity_id,identity_id) VALUES($1,$2,$3)', [schoolId, activityId, id]);
  for (const id of data.classIds) await db.query('INSERT INTO school_activity_classes(school_id,activity_id,class_id) VALUES($1,$2,$3)', [schoolId, activityId, id]);
}
async function start(db, a, student, user) {
  if (!student) fail(403, 'STUDENT_REQUIRED', 'A selected student identity is required.');
  const old = await attempt(db, a, student.id);
  if (old) return old;
  const now = (await db.query('SELECT clock_timestamp() AS now')).rows[0].now;
  if (!acceptsActivityWork(a, +new Date(now))) fail(409, 'ACTIVITY_CLOSED', 'This activity is not open.');
  const end = effectiveEnd(a);
  let deadline = end;
  if (a.kind === 'timed') {
    deadline = new Date(Math.min(+new Date(end), +new Date(now) + a.duration_minutes * 60000));
  } else if (end && +new Date(now) > +new Date(end)) {
    // A new attempt cannot have a deadline before its start. The judge job still records the assignment deadline.
    deadline = null;
  }
  return (await db.query(`INSERT INTO school_activity_attempts(school_id,activity_id,identity_id,account_id,started_at,deadline_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [a.school_id, a.id, student.id, user.id, now, deadline])).rows[0];
}
function requireOpenAttempt(a, t) {
  if (!t || !canSubmitActivityWork(a, publicAttempt(t))) fail(409, 'ATTEMPT_CLOSED', 'This attempt has ended. Your saved submissions are preserved.');
}
async function activityProblem(db, a, problemId) {
  const p = (await db.query(`SELECT p.*,v.definition FROM school_activity_problems p JOIN school_problem_versions v
    ON v.school_id=p.school_id AND v.problem_id=p.problem_id AND v.id=p.version_id
    WHERE p.school_id=$1 AND p.activity_id=$2 AND p.problem_id=$3`, [a.school_id, a.id, problemId])).rows[0];
  if (!p) fail(404, 'NOT_FOUND', 'Problem not assigned.');
  return p;
}
async function enqueueActivity(db, loaded, problemId, user, body, { preview = false } = {}) {
  const { a, student } = loaded;
  if (!preview && !student) fail(403, 'STUDENT_REQUIRED', 'Only assigned students can submit.');
  const p = await activityProblem(db, a, problemId);
  if (preview && (integer(body.expectedRevision, 1, 2147483647, 'Revision') !== a.revision || uuid(body.versionId) !== p.version_id)) {
    fail(409, 'REVISION_CONFLICT', 'The assignment changed. Reopen the preview to use its saved version.');
  }
  const kind = enumValue(body.kind, ['submit', 'samples', 'custom'], 'Run type');
  const requestId = uuid(body.requestId), language = enumValue(body.language ?? 'python', ['python', 'cpp', 'javascript'], 'Language');
  const code = bytes(body.code, 'Code'), customInput = kind === 'custom' ? bytes(body.input ?? '', 'Input', 262144) : null;
  const hash = canonicalHash({ activityId: a.id, problemId, versionId: p.version_id, identityId: student?.id ?? null, kind, language, code, customInput,
    ...(preview && { previewRevision: a.revision }) });
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-submit:'||$1,0))", [user.id]);
  const old = (await db.query('SELECT id,state,request_hash FROM school_judge_jobs WHERE account_id=$1 AND request_id=$2', [user.id, requestId])).rows[0];
  if (old) { if (old.request_hash !== hash) fail(409, 'REQUEST_CONFLICT', 'Request ID already used.'); return { id: old.id, state: old.state }; }
  await schoolActivityProblemAccess(db, { schoolId: a.school_id, problemId, user, activityId: a.id });
  let t = null;
  if (!preview) {
    t = await attempt(db, a, student.id);
    if (!t && a.kind === 'assignment') t = await start(db, a, student, user);
    requireOpenAttempt(a, t);
  }
  const counts = (await db.query(`SELECT count(*) FILTER(WHERE state IN ('queued','leased'))::int AS pending,
    count(*) FILTER(WHERE created_at>clock_timestamp()-interval '5 minutes')::int AS recent FROM school_judge_jobs WHERE account_id=$1`, [user.id])).rows[0];
  if (counts.pending >= 5 || counts.recent >= 60) fail(429, 'RATE_LIMIT', 'Too many judge requests. Please wait.');
  const payload = { kind, version: { ...p.definition, reference_code: undefined, tests: undefined }, code, language,
    tests: kind === 'custom' ? [{ position: 1, input: customInput }] : kind === 'samples' ? p.definition.samples : p.definition.tests };
  try { validateTask(payload); } catch { fail(400, 'INVALID_CASES', 'Invalid code, language or input.'); }
  // Use one server receipt time at full database precision after locks and validation.
  const timed = !preview && a.kind === 'timed';
  const { received_at: receivedAt, closed } = (await db.query(`WITH receipt AS (SELECT clock_timestamp() AS received_at)
    SELECT received_at::text AS received_at, received_at>=least($1::timestamptz,$2::timestamptz) AS closed FROM receipt`,
  timed ? [t.deadline_at, effectiveEnd(a)] : [null, null])).rows[0];
  if (closed) fail(409, 'ATTEMPT_CLOSED', 'The submission arrived after your deadline.');
  const jobDeadline = !preview && a.kind === 'assignment' ? a.exact_ends_at : t?.deadline_at ?? null;
  return (await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,request_id,request_hash,kind,access_context,payload,
    activity_id,activity_attempt_id,activity_deadline_at,created_at,preview_activity_id,preview_revision)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id,state`,
  [a.school_id, problemId, p.version_id, user.id, student?.id ?? null, requestId, hash, kind, preview ? 'assignment_preview' : 'school', JSON.stringify(payload),
    preview ? null : a.id, t?.id ?? null, jobDeadline, receivedAt, preview ? a.id : null, preview ? a.revision : null])).rows[0];
}
async function projectJob(db, job, activity) {
  const feedback = await schoolJobFeedback(db, job, activity);
  const visible = feedback.resultsVisible;
  const r = visible ? job.result : null;
  return { id: job.id, problemId: job.problem_id, problemTitle: job.payload.version.title, code: job.payload.code, language: job.payload.language,
    kind: job.kind, state: job.state, createdAt: job.created_at, status: visible ? r?.status ?? (job.state === 'failed' ? 'System Error' : job.state === 'leased' ? 'Judging' : 'Waiting') : 'Submitted',
    score: visible ? r?.score ?? null : null, passed: visible ? r?.passed ?? 0 : 0, total: visible ? r?.total ?? 0 : 0,
    message: visible ? r?.publicMessage ?? '' : 'Formal results will be available after the teacher publishes them.',
    ...feedback };
}
async function assignmentPreview(db, { a, user, method, action, id, submissions, body, url }) {
  if (!canPreview(a)) fail(404, 'NOT_FOUND', 'This assignment is not available for preview.');
  const parameters = [a.school_id, a.id, user.id];
  const ownPreview = "j.school_id=$1 AND j.preview_activity_id=$2 AND j.account_id=$3 AND j.access_context='assignment_preview'";
  if (action === 'jobs' && method === 'GET') {
    const { rows: [job] } = await db.query(`SELECT j.* FROM school_judge_jobs j WHERE ${ownPreview} AND j.id=$4`, [...parameters, uuid(id)]);
    if (!job) fail(404, 'NOT_FOUND', 'Preview submission not found.');
    return reply(await projectJob(db, job, a));
  }
  const problemId = id ? uuid(id) : null;
  if (action === 'problems' && submissions && method === 'POST') {
    return reply(await enqueueActivity(db, { a, student: null }, problemId, user, body, { preview: true }), 202);
  }
  if (method !== 'GET') return null;
  const entries = await problems(db, a);
  if (problemId && !entries.some(problem => problem.id === problemId)) fail(404, 'NOT_FOUND', 'Problem not assigned.');
  const { rows } = await db.query(`SELECT j.problem_id, count(*)::int AS activity_attempts, count(*)::int AS all_attempts,
    max((j.result->>'score')::numeric) FILTER(WHERE j.state='completed') AS best,
    bool_or(j.state='completed' AND j.result->>'status'='AC') AS accepted
    FROM school_judge_jobs j WHERE ${ownPreview} AND j.preview_revision=$4 AND j.kind='submit'
    GROUP BY j.problem_id`, [...parameters, a.revision]);
  const grade = activityGrade(entries, rows, a.kind);
  if (!action) return reply({
    id: a.id, schoolId: a.school_id, kind: a.kind, title: a.title, description: a.description,
    state: a.state, phase: 'Open', revision: a.revision, startsAt: a.starts_at, endsAt: a.ends_at,
    durationMinutes: null, publishedAt: a.published_at, resultsPublishedAt: null, canManage: false,
    participantCount: 0, problems: entries, attempt: null, grade, preview: true,
  });
  const solved = Boolean(grade.items.find(item => item.id === problemId)?.solved);
  if (submissions) {
    const page = await metadataPage(db, `SELECT j.id::text,j.id received_id,j.account_id actor_key,j.created_at,
      coalesce(j.payload->>'language','python') language,
      CASE WHEN j.state='completed' THEN coalesce(j.result->>'status','System Error')
        WHEN j.state='failed' THEN 'System Error' WHEN j.state='leased' THEN 'Judging' ELSE 'Waiting' END status,
      true is_own, CASE WHEN j.state='completed' THEN j.result->'privateResults' END private_results,
      $6::text display_name
      FROM school_judge_jobs j WHERE ${ownPreview} AND j.preview_revision=$4 AND j.problem_id=$5 AND j.kind='submit'`,
    [...parameters, a.revision, problemId, user.name], url);
    return reply({ ...page, solved });
  }
  const p = await activityProblem(db, a, problemId);
  return reply({
    id: problemId, schoolId: a.school_id, versionId: p.version_id, title: p.definition.title,
    published: true, canManage: false, definition: safeDefinition(p.definition), solved,
    activity: { id: a.id, title: a.title, kind: a.kind, phase: 'Open', attempt: null,
      resultsPublishedAt: null, canSubmit: true, preview: true, revision: a.revision },
  });
}
async function options(db, schoolId) {
  const items = (await db.query(`SELECT p.id AS "problemId",p.published_version_id AS "versionId",v.definition->>'title' AS title,b.name AS "bankName",b.id AS "bankId"
    FROM school_problems p JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
    JOIN school_problem_versions v ON v.school_id=p.school_id AND v.id=p.published_version_id
    WHERE p.school_id=$1 AND p.published AND NOT b.archived ORDER BY b.name,v.definition->>'title',p.id LIMIT 2000`, [schoolId])).rows;
  const students = (await db.query(`SELECT i.id,i.name,i.number,i.account_id IS NOT NULL AS activated,
    coalesce((SELECT jsonb_agg(r.class_id ORDER BY r.class_id) FROM school_class_roster r JOIN school_classes c ON c.school_id=r.school_id AND c.id=r.class_id
      WHERE r.school_id=i.school_id AND r.identity_id=i.id AND c.archived_at IS NULL),'[]') AS "classIds"
    FROM school_identities i WHERE i.school_id=$1 AND i.kind='student' AND i.archived_at IS NULL ORDER BY i.name,i.number,i.id LIMIT 2001`, [schoolId])).rows;
  if (students.length > 2000) fail(409, 'AUDIENCE_TOO_LARGE', 'This activity selector supports schools with up to 2000 student identities.');
  return { problems: items, students, classes: (await db.query('SELECT id,name FROM school_classes WHERE school_id=$1 AND archived_at IS NULL ORDER BY name,id', [schoolId])).rows };
}
async function publishResults(db, loaded, user) {
  const { a } = loaded;
  if (a.kind !== 'timed') fail(409, 'NOT_TIMED', 'Assignment scores are available immediately.');
  if (a.results_published_at) return;
  if (phase(a) !== 'Ended') fail(409, 'ACTIVITY_OPEN', 'End the activity before publishing results.');
  const pending = (await db.query("SELECT 1 FROM school_judge_jobs WHERE school_id=$1 AND activity_id=$2 AND kind='submit' AND state IN ('queued','leased') LIMIT 1", [a.school_id, a.id])).rowCount;
  if (pending) fail(409, 'JUDGING_PENDING', 'Wait for all received formal submissions to finish judging.');
  for (const row of (await db.query('SELECT identity_id FROM school_activity_participants WHERE school_id=$1 AND activity_id=$2 ORDER BY identity_id', [a.school_id, a.id])).rows) {
    await db.query('INSERT INTO school_activity_results(school_id,activity_id,identity_id,grade) VALUES($1,$2,$3,$4)', [a.school_id, a.id, row.identity_id, JSON.stringify(await calculateSchoolActivityGrade(db, a, row.identity_id))]);
  }
  await db.query('UPDATE school_activities SET results_published_at=clock_timestamp(),revision=revision+1 WHERE school_id=$1 AND id=$2', [a.school_id, a.id]);
  await auditSchool(db, a.school_id, user.id, 'school.activity.publish-results', a.id);
}

export async function schoolActivitiesOperation({ pool, user, route, url, method, body = {} }) {
  route ??= url.pathname.replace(/^\/api\/v1/, '');
  const preview = route.match(/^\/schools\/([^/]+)\/activities\/([^/]+)\/preview(?:\/(problems|jobs)\/([^/]+)(?:\/(submissions))?)?$/);
  const match = preview ?? route.match(/^\/schools\/([^/]+)\/activities(?:\/(options|[^/]+)(?:\/(publish|archive|start|finish|end|publish-results|report|problems|jobs)(?:\/([^/]+)(?:\/(submissions))?)?)?)?$/);
  if (!match) return null;
  const schoolId = uuid(match[1]);
  if (schoolId === LEGACY_SCHOOL_ID) fail(404, 'NOT_FOUND', 'Use the existing school workspace.');
  return transaction(pool, async db => {
    // Match membership/roster mutation lock ordering; a revoke cannot race publication or submit.
    await lockSchoolTeaching(db, schoolId, { shared: method === 'GET' });
    const role = await schoolRole(db, schoolId, user.id);
    await scope(db, schoolId);
    if (preview) {
      const { a } = await load(db, schoolId, uuid(preview[2]), user, role, { management: true });
      return assignmentPreview(db, { a, user, method, action: preview[3], id: preview[4], submissions: preview[5], body, url });
    }
    const staff = role === 'school_admin' || role === 'teacher';
    if (match[2] === 'options' && method === 'GET') {
      if (!staff) fail(403, 'FORBIDDEN', 'Teaching role required.');
      return reply(await options(db, schoolId));
    }
    if (!match[2] && method === 'GET') {
      const kind = enumValue(url.searchParams.get('kind') ?? 'assignment', ['assignment', 'timed'], 'Activity type');
      const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, 'Page');
      const archived = url.searchParams.get('archived') === 'true' && staff;
      const student = role === 'student' ? await identity(db, schoolId, user.id) : null;
      const requestedCategory = url.searchParams.get('timingCategory');
      const category = role === 'student' && kind === 'timed' && requestedCategory !== null
        ? enumValue(requestedCategory, ['upcoming', 'available', 'completed'], 'Timed practice category')
        : null;
      const rows = (await db.query(`SELECT a.* FROM school_activities a WHERE a.school_id=$1 AND a.kind=$2 AND
        ($3='school_admin' OR $3='teacher' AND a.owner_account_id=$4 OR $3='student' AND a.state='Published' AND EXISTS(
          SELECT 1 FROM school_activity_participants p WHERE p.school_id=a.school_id AND p.activity_id=a.id AND p.identity_id=$5))
        AND (a.state='Archived')=$6 AND ($8::text IS NULL OR CASE
          WHEN a.results_published_at IS NOT NULL OR least(a.ends_at,a.forced_ended_at)<=statement_timestamp() OR EXISTS (
            SELECT 1 FROM school_activity_attempts t WHERE t.school_id=a.school_id AND t.activity_id=a.id AND t.identity_id=$5
            AND (t.finished_at IS NOT NULL OR t.deadline_at<=statement_timestamp())
          ) THEN 'completed'
          WHEN a.starts_at>statement_timestamp() THEN 'upcoming'
          ELSE 'available'
        END=$8)
        ORDER BY a.created_at DESC,a.id LIMIT 26 OFFSET $7`, [schoolId, kind, role, user.id, student?.id ?? null, archived, (page - 1) * 25, category])).rows;
      const items = [];
      for (const a of rows.slice(0, 25)) items.push(await detail(db, { a, student, canManage: manages(a, user, role) }, user));
      return reply({ items, page, hasMore: rows.length > 25, canCreate: staff });
    }
    if (!match[2] && method === 'POST') {
      if (!staff) fail(403, 'FORBIDDEN', 'Teaching role required.');
      const kind = enumValue(body.kind, ['assignment', 'timed'], 'Activity type'), data = normalize(body, kind), requestId = uuid(body.requestId);
      const hash = canonicalHash({ kind, ...data });
      const old = (await db.query('SELECT * FROM school_activities WHERE school_id=$1 AND owner_account_id=$2 AND request_id=$3', [schoolId, user.id, requestId])).rows[0];
      if (old) { if (old.request_hash !== hash) fail(409, 'REQUEST_CONFLICT', 'Request ID already used.'); return reply(await detail(db, { a: old, canManage: true, student: null }, user)); }
      await validateSelections(db, schoolId, data);
      const a = (await db.query(`INSERT INTO school_activities(school_id,owner_account_id,kind,title,description,starts_at,ends_at,duration_minutes,request_id,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [schoolId, user.id, kind, data.title, data.description, data.startsAt, data.endsAt, data.durationMinutes, requestId, hash])).rows[0];
      await storeSelections(db, schoolId, a.id, data); await auditSchool(db, schoolId, user.id, 'school.activity.create', a.id);
      return reply(await detail(db, { a, canManage: true, student: null }, user), 201);
    }
    if (!match[2]) return null;
    const activityId = uuid(match[2]), action = match[3];
    const loaded = await load(db, schoolId, activityId, user, role, { management: ['publish', 'archive', 'end', 'publish-results', 'report'].includes(action) || method === 'PATCH' });
    const { a, canManage, student } = loaded;
    if (!action && method === 'GET') return reply(await detail(db, loaded, user));
    if (!action && method === 'PATCH') {
      if (a.state !== 'Draft') fail(409, 'ACTIVITY_FROZEN', 'Published activity rules, recipients and problem versions are frozen.');
      if (integer(body.expectedRevision, 1, 2147483646, 'Revision') !== a.revision) fail(409, 'REVISION_CONFLICT', 'Activity changed. Refresh first.');
      const data = normalize(body, a.kind); await validateSelections(db, schoolId, data);
      await db.query(`UPDATE school_activities SET title=$3,description=$4,starts_at=$5,ends_at=$6,duration_minutes=$7,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2`, [schoolId, a.id, data.title, data.description, data.startsAt, data.endsAt, data.durationMinutes]);
      await storeSelections(db, schoolId, a.id, data); await auditSchool(db, schoolId, user.id, 'school.activity.update', a.id);
      return reply(await detail(db, await load(db, schoolId, activityId, user, role), user));
    }
    if (action === 'publish' && method === 'POST') {
      if (a.state === 'Published') return reply(await detail(db, loaded, user));
      if (a.state !== 'Draft' || integer(body.expectedRevision, 1, 2147483646, 'Revision') !== a.revision) fail(409, 'REVISION_CONFLICT', 'Refresh the draft before publishing.');
      const data = await detail(db, loaded, user);
      if (a.kind === 'timed' && (!a.starts_at || !a.ends_at || !a.duration_minutes)) fail(400, 'VALIDATION', 'Set an opening time, closing time and duration before publishing timed practice.');
      await validateSelections(db, schoolId, { problems: data.problems.map(p => ({ problemId: p.id, versionId: p.versionId })), identityIds: data.identityIds, classIds: [] });
      if (!data.problems.length || !data.participantCount) fail(400, 'VALIDATION', 'Select at least one problem and student before publishing.');
      if (a.ends_at && +new Date(a.ends_at) <= Date.now()) fail(400, 'VALIDATION', 'The closing time must be in the future.');
      await db.query("UPDATE school_activities SET state='Published',published_at=clock_timestamp(),revision=revision+1 WHERE school_id=$1 AND id=$2", [schoolId, a.id]);
      await auditSchool(db, schoolId, user.id, 'school.activity.publish', a.id);
    } else if (action === 'archive' && method === 'POST') {
      if (a.kind === 'timed' && a.state === 'Published' && !a.results_published_at) fail(409, 'RESULTS_REQUIRED', 'Publish timed results before archiving.');
      await db.query("UPDATE school_activities SET state='Archived',revision=revision+1 WHERE school_id=$1 AND id=$2 AND state<>'Archived'", [schoolId, a.id]);
      await auditSchool(db, schoolId, user.id, 'school.activity.archive', a.id);
    } else if (action === 'start' && method === 'POST') {
      return reply({ attempt: publicAttempt(await start(db, a, student, user)) });
    } else if (action === 'finish' && method === 'POST') {
      if (!student) fail(403, 'FORBIDDEN', 'Assigned student required.');
      const t = await attempt(db, a, student.id);
      if (!t) fail(409, 'NOT_STARTED', 'Start the activity first.');
      await db.query('UPDATE school_activity_attempts SET finished_at=coalesce(finished_at,clock_timestamp()) WHERE school_id=$1 AND id=$2', [schoolId, t.id]);
    } else if (action === 'end' && method === 'POST') {
      if (a.state !== 'Published' || a.kind !== 'timed') fail(409, 'NOT_TIMED', 'Only a published timed activity can be ended.');
      await db.query('UPDATE school_activities SET forced_ended_at=coalesce(forced_ended_at,clock_timestamp()),revision=revision+1 WHERE school_id=$1 AND id=$2', [schoolId, a.id]);
      await auditSchool(db, schoolId, user.id, 'school.activity.end', a.id);
    } else if (action === 'publish-results' && method === 'POST') {
      await publishResults(db, loaded, user);
    } else if (action === 'report' && method === 'GET') {
      const rows = (await db.query(`SELECT i.id,i.number,i.name FROM school_activity_participants p JOIN school_identities i ON i.school_id=p.school_id AND i.id=p.identity_id
        WHERE p.school_id=$1 AND p.activity_id=$2 ORDER BY i.name,i.number,i.id`, [schoolId, a.id])).rows;
      const items = [];
      for (const row of rows) items.push({ ...row, attempt: publicAttempt(await attempt(db, a, row.id)), grade: a.results_published_at ? (await db.query('SELECT grade FROM school_activity_results WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3', [schoolId, a.id, row.id])).rows[0]?.grade : await calculateSchoolActivityGrade(db, a, row.id) });
      return reply({ activity: await detail(db, loaded, user), items });
    } else if (action === 'problems' && match[4]) {
      const problemId = uuid(match[4]);
      if (match[5] === 'submissions' && method === 'POST') return reply(await enqueueActivity(db, loaded, problemId, user, body), 202);
      if (match[5] === 'submissions' && method === 'GET') {
        const pin = (await db.query('SELECT version_id FROM school_activity_problems WHERE school_id=$1 AND activity_id=$2 AND problem_id=$3', [schoolId, a.id, problemId])).rows[0];
        if (!pin) fail(404, 'NOT_FOUND', 'Problem not assigned.');
        const visible = a.kind !== 'timed' || Boolean(a.results_published_at);
        const page = await metadataPage(db, `SELECT j.id::text,j.id received_id,j.identity_id actor_key,j.created_at,
          coalesce(j.payload->>'language','python') language,
          CASE WHEN NOT $5 THEN 'Submitted' WHEN j.state='completed' THEN coalesce(j.result->>'status','System Error')
            WHEN j.state='failed' THEN 'System Error' WHEN j.state='leased' THEN 'Judging' ELSE 'Waiting' END status,
          j.identity_id=$4::uuid is_own,
          CASE WHEN $5 AND j.state='completed' THEN j.result->'privateResults' END private_results,
          coalesce(CASE WHEN profile.leaderboard_use_nickname THEN nullif(btrim(profile.nickname),'') END,nullif(btrim(person.name),''),'Student') display_name
          FROM school_judge_jobs j JOIN school_identities person ON person.school_id=j.school_id AND person.id=j.identity_id
          LEFT JOIN accounts profile ON profile.id=person.account_id
          WHERE j.school_id=$1 AND j.activity_id=$2 AND j.problem_id=$3 AND j.kind='submit'
            AND ($5 OR j.identity_id=$4::uuid)`, [schoolId, a.id, problemId, student?.id ?? null, visible], url);
        const grade = student && visible ? (a.kind === 'timed' ? (await db.query('SELECT grade FROM school_activity_results WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3', [schoolId, a.id, student.id])).rows[0]?.grade : await calculateSchoolActivityGrade(db, a, student.id)) : null;
        page.solved = Boolean(grade?.items.find(p => p.id === problemId)?.solved);
        return reply(page);
      }
      if (!match[5] && method === 'GET') {
        if (!canManage) {
          if (phase(a) === 'Upcoming') fail(403, 'NOT_OPEN', 'This activity has not opened yet.');
          if (a.kind === 'timed' && !a.results_published_at) requireOpenAttempt(a, student ? await attempt(db, a, student.id) : null);
        }
        await schoolActivityProblemAccess(db, { schoolId, problemId, user, activityId: a.id });
        const p = await activityProblem(db, a, problemId);
        const d = await detail(db, loaded, user);
        return reply({ id: problemId, schoolId, versionId: p.version_id, title: p.definition.title, published: true, canManage: false, definition: safeDefinition(p.definition),
          solved: d.grade?.items.find(item => item.id === problemId)?.solved ?? false, activity: { id: a.id, title: a.title, kind: a.kind, phase: d.phase, endsAt: d.endsAt, attempt: d.attempt, resultsPublishedAt: a.results_published_at, canSubmit: d.canSubmit } });
      }
      return null;
    } else if (action === 'jobs' && match[4] && method === 'GET') {
      const job = (await db.query('SELECT * FROM school_judge_jobs WHERE school_id=$1 AND activity_id=$2 AND id=$3 AND account_id=$4', [schoolId, a.id, uuid(match[4]), user.id])).rows[0];
      if (!job) fail(404, 'NOT_FOUND', 'Submission not found.');
      return reply(await projectJob(db, job, a));
    } else return null;
    return reply(await detail(db, await load(db, schoolId, activityId, user, role), user));
  });
}
