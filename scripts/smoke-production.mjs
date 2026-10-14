// Writes only to a dedicated local verification installation. Start the real
// API, PostgreSQL worker and go-judge first. Never point this at school data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createPool } from '../packages/domain/src/db.mjs';
import { bootstrap } from '../packages/domain/src/bootstrap.mjs';

const base = process.env.CAMPUS_SMOKE_API ?? 'http://127.0.0.1:3001';
const origin = process.env.CAMPUS_SMOKE_ORIGIN ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Smoke tests require a local disposable installation.');
const run = randomUUID().slice(0, 8);
const pass = `Campus-Test-${run}-password!`;
const adminLogin = process.env.CAMPUS_SMOKE_ADMIN ?? 'smoke.admin';
const adminPassword = process.env.CAMPUS_SMOKE_PASSWORD ?? pass;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.env.DATABASE_URL && !process.env.CAMPUS_SMOKE_PASSWORD) {
  const pool = createPool();
  try { await bootstrap(pool, { name: 'Smoke Administrator', number: 'SMOKE-ADMIN', username: adminLogin, password: adminPassword }); }
  finally { await pool.end(); }
}

function client() {
  let cookie = '', csrfToken = '';
  return async function request(path, body, expectedStatus = 200, extraHeaders = {}, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    // Failure diagnostics must not print activation/reset credentials, source
    // or cached encrypted responses returned by verification endpoints.
    assert.equal(response.status, expectedStatus, `${method} ${path}: HTTP ${response.status}${data.error?.code ? ` (${data.error.code})` : ''}`);
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrfToken = data.csrfToken;
    return data;
  };
}
const admin = client(), teacher = client(), student = client(), outsider = client();
await admin('auth/login', { username: adminLogin, password: adminPassword });
if (process.env.CAMPUS_SMOKE_OUTPUT) await writeFile(process.env.CAMPUS_SMOKE_OUTPUT, JSON.stringify({ adminLogin, adminPassword, password: pass, studentLogin: `smoke.student.${run}`, teacherLogin: `smoke.teacher.${run}` }), { mode: 0o600 });
const people = {};
for (const [key, kind] of [['teacher','teacher'], ['student','student'], ['outsider','student']]) {
  people[key] = await admin('people', { kind, number: `SMOKE-${key}-${run}`, name: `Smoke ${key} ${run}` }, 201);
}
const register = (key, request) => request('auth/register', { kind: people[key].person.kind, number: people[key].person.number, name: people[key].person.name, activationCode: people[key].activationCode, username: `smoke.${key}.${run}`, password: pass }, 201);
await register('teacher', teacher); await register('student', student); await register('outsider', outsider);
await student('people', undefined, 403);
const unauthenticated = client();
await unauthenticated('auth/me', undefined, 401);
await unauthenticated('auth/register', { kind: 'student', number: people.student.person.number, name: people.student.person.name, activationCode: people.student.activationCode, username: `smoke.reclaim.${run}`, password: pass }, 400);
console.log('PASS identity claim, consumed token and role isolation');

const cls = await admin('classes', { name: `Smoke class ${run}`, studentIds: [people.student.person.id], teacherIds: [people.teacher.person.id] }, 201);
await teacher(`classes/${cls.id}/members`, { identityIds: [people.student.person.id] });
// Use a separate roster so this imported student does not change the later
// assignment and timed-training score denominators.
const importClass = await teacher('classes', { name: `Smoke imported class ${run}`, studentIds: [] }, 201);
const memberImportBody = { idempotencyKey: randomUUID(), rows: [
  { number: `SMOKE-imported-${run}`, name: `Smoke imported ${run}` },
  { number: people.outsider.person.number, name: people.outsider.person.name },
] };
const memberImport = await teacher(`classes/${importClass.id}/import-members`, memberImportBody);
assert.deepEqual(memberImport.summary, { created: 1, added: 0, skipped: 0, failed: 1, total: 2 });
const importedPerson = memberImport.items[0], deniedPerson = memberImport.items[1];
assert.equal(importedPerson.status, 'created'); assert.equal(importedPerson.person.kind, 'student');
assert.equal(typeof importedPerson.activationCode, 'string'); assert.ok(importedPerson.activationCode.length >= 20);
assert.equal(deniedPerson.status, 'failed'); assert.equal(deniedPerson.person, undefined); assert.equal(deniedPerson.activationCode === undefined, true, 'Denied imported identity must expose no credential.');
const replayedMembers = await teacher(`classes/${importClass.id}/import-members`, memberImportBody);
assert.equal(JSON.stringify(replayedMembers) === JSON.stringify(memberImport), true, 'Member import replay must preserve its receipt and one-use credential.');
const importedStudent = client();
await importedStudent('auth/register', { kind: 'student', number: importedPerson.person.number, name: importedPerson.person.name,
  activationCode: importedPerson.activationCode, username: `smoke.imported.${run}`, password: pass }, 201);
const importedRoster = (await teacher('classes')).items.find(entry => entry.id === importClass.id);
assert.ok(importedRoster); assert.equal(importedRoster.members.length, 1); assert.equal(importedRoster.members[0].id, importedPerson.person.id);
assert.equal(importedRoster.members.some(entry => entry.id === people.outsider.person.id), false);
const ownImportedClass = (await importedStudent('classes')).items.find(entry => entry.id === importClass.id);
assert.ok(ownImportedClass); assert.equal(ownImportedClass.members[0].id, importedPerson.person.id);
console.log('PASS scoped teacher member import, credential-safe idempotent replay, genuine activation and class membership');

const settings = await admin('system-settings');
assert.equal(settings.siteName, 'Campus Judge'); assert.equal(settings.timezone, 'Asia/Shanghai');
assert.equal(settings.codeLimitBytes, 262144); assert.equal(settings.maxProblemMemoryMb, 256); assert.equal(settings.maxProblemCpuMs, 5000);
assert.equal(settings.judgeJobCpuBudgetMs, 30000); assert.equal(settings.judgeJobWallBudgetMs, 60000);
assert.equal(typeof settings.secureCookies, 'boolean'); assert.ok(Array.isArray(settings.origins) && settings.origins.includes(origin));
assert.ok(settings.judgeImage === null || typeof settings.judgeImage === 'string');
assert.deepEqual(settings.backup, { rpoHours: 24, rtoHours: 4, verifiedOnSchoolHost: false, operation: 'server-cli' });
const audit = await admin('audit-events?limit=20'); assert.ok(Array.isArray(audit.items) && audit.items.length > 0 && audit.items.length <= 20);
function assertAuditMetadataIsSafe(metadata) {
  for (const [key, value] of Object.entries(metadata ?? {})) {
    assert.doesNotMatch(key, /password|activation|reset|token|secret|code|hidden|input|output|reference|credential/i);
    if (value && typeof value === 'object') assertAuditMetadataIsSafe(value);
  }
}
for (const event of audit.items) {
  assert.equal(typeof event.id, 'string'); assert.equal(typeof event.actorName, 'string'); assert.equal(typeof event.action, 'string');
  assert.ok(event.resourceType === null || typeof event.resourceType === 'string'); assert.ok(event.resourceId === null || typeof event.resourceId === 'string');
  assert.ok(Number.isFinite(new Date(event.createdAt).getTime())); assertAuditMetadataIsSafe(event.metadata);
}
const importAudit = audit.items.find(event => event.action === 'class.members_import' && event.resourceId === importClass.id);
assert.ok(importAudit); assert.equal(importAudit.metadata.created, 1); assert.equal(importAudit.metadata.failed, 1);
for (const nonAdmin of [teacher, student]) {
  await nonAdmin('system-settings', undefined, 403); await nonAdmin('audit-events', undefined, 403);
}
console.log('PASS live administrator configuration/audit summaries, explicit backup verification limits and non-admin denial');

const problem = await teacher('problems', {
  title: `Smoke Row Sums ${run}`, mode: 'function', functionName: 'row_sums',
  statement: 'Return one sum for each row. Do not modify grid. Return the result; do not print it.',
  starterCode: 'def row_sums(grid):\n    return []\n',
  referenceCode: 'def row_sums(grid):\n    return [sum(row) for row in grid]\n',
  timeLimitMs: 1000, memoryLimitMb: 128,
  samples: [{ input: '[[[1,2,3],[4,5,6]]]', expected: '[6,15]' }],
  tests: [
    { input: '[[[1,2,3],[4,5,6]]]', expected: '[6,15]', weight: 25 },
    { input: '[[[]]]', expected: '[0]', weight: 25 },
    { input: '[[]]', expected: '[]', weight: 25 },
    { input: '[[[-2,2],[5,-1]]]', expected: '[0,4]', weight: 25 },
  ],
}, 201);
async function waitFor(request, path, field = 'status', timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await request(path);
    if (!['Waiting', 'Judging'].includes(result[field])) return result;
    await sleep(300);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${path}`);
}
const validation = await waitFor(teacher, `problems/${problem.id}`, 'validationStatus');
assert.equal(validation.validationStatus, 'AC');
await teacher(`problems/${problem.id}/publish`, { versionId: problem.versionId });
const visibleProblem = await student(`problems/${problem.id}`);
assert.equal(visibleProblem.tests, undefined); assert.equal(visibleProblem.referenceCode, undefined);
const assignment = await teacher('assignments', { title: `Smoke assignment ${run}`, classId: cls.id, dueAt: new Date(Date.now()+3600000).toISOString(), problems: [{ problemId: problem.id, points: 100 }] }, 201);
await outsider(`assignments/${assignment.id}`, undefined, 403);
console.log('PASS reference validation, immutable publish, hidden-test filtering and class assignment');

async function submit(kind, code, extra = {}) {
  const body = { problemId: problem.id, versionId: problem.versionId, kind, code, idempotencyKey: randomUUID(), ...extra };
  const receipt = await student('submissions', body, 201);
  const repeated = await student('submissions', body, 201);
  assert.equal(repeated.id, receipt.id);
  await student('submissions', { ...body, code: `${code}\n# changed` }, 409);
  return waitFor(student, `submissions/${receipt.id}`);
}
const correct = 'def row_sums(grid):\n    return [sum(row) for row in grid]\n';
const samples = await submit('samples', correct);
assert.equal(samples.status, 'AC'); assert.equal(samples.kind, 'samples');
const custom = await submit('custom', correct, { customInput: '[[[3,7]]]' });
assert.equal(custom.status, 'Executed'); assert.equal(custom.score, null); assert.match(custom.publicOutput, /10/);
const wrong = await submit('submit', 'def row_sums(grid):\n    return [sum(row) for row in grid if row]\n', { assignmentId: assignment.id });
assert.equal(wrong.status, 'WA'); assert.equal(wrong.score, 75);
assert.equal(wrong.publicOutput, null); assert.doesNotMatch(JSON.stringify(wrong), /private_results|reference_code|token_hash/);
await outsider(`submissions/${wrong.id}`, undefined, 403);
const correction = await submit('correction', correct, { assignmentId: assignment.id, originalSubmissionId: wrong.id });
assert.equal(correction.status, 'AC'); assert.equal(correction.score, 100);
const progressBefore = await teacher(`assignments/${assignment.id}`);
assert.equal(progressBefore.grades.find(row => row.identityId === people.student.person.id).score, 75);
await teacher('review-notebook', { submissionId: wrong.id, note: 'Remember empty rows; return one value per row.' }, 201);
const accepted = await submit('submit', correct, { assignmentId: assignment.id });
assert.equal(accepted.status, 'AC'); assert.equal(accepted.score, 100);
const progressAfter = await teacher(`assignments/${assignment.id}`);
assert.equal(progressAfter.grades.find(row => row.identityId === people.student.person.id).score, 100);
console.log('PASS real samples/custom/WA/AC, idempotency, correction grade separation and teacher feedback');

const path = await teacher('learning-paths', { title: `Smoke Python ${run}`, description: 'Practice 2D lists.', category: 'ACSL' }, 201);
const chapter = await teacher(`learning-paths/${path.id}/chapters`, { title: 'Row sums', content: 'Return one sum for each row, including an empty row. Do not print or modify grid.', problemIds: [problem.id] }, 201);
await student(`learning-paths/${path.id}`, undefined, 404);
await teacher(`learning-paths/${path.id}/publish`, {});
await student(`chapters/${chapter.id}/progress`, { completed: true });
assert.equal((await student(`learning-paths/${path.id}`)).completedChapters, 1);
assert.equal((await outsider(`learning-paths/${path.id}`)).completedChapters, 0);
const report = await teacher(`reports?assignmentId=${assignment.id}`);
assert.equal(report.summary.averagePercent, 100); assert.equal(report.summary.participants, 1);
await student('reports', undefined, 403);

const privateBank = await teacher('problem-banks', { name: `Smoke private ${run}`, visibility: 'private' }, 201);
const importBody = { bankId: privateBank.id, idempotencyKey: randomUUID(), rows: [
  { title: `Smoke private exam ${run}`, mode: 'function', functionName: 'row_sums', statement: 'Return the sum of each row.', starterCode: 'def row_sums(grid):\n    return []\n', referenceCode: correct, timeLimitMs: 1000, memoryLimitMb: 128,
    samples: [{ input: '[[[1,2],[3]]]', expected: '[3,3]' }], tests: [{ input: '[[[],[1,-1],[3,7]]]', expected: '[0,0,10]', weight: 100 }], tags: ['ACSL','Contest 1'], source: 'Locally authored verification fixture' },
  { title: 'Invalid fixture missing tests' },
] };
const imported = await teacher('problems/import', importBody);
assert.deepEqual(imported.summary, { created: 1, failed: 1, total: 2 });
assert.deepEqual(await teacher('problems/import', importBody), imported);
await teacher('problems/import', { ...importBody, rows: [] }, 400);
const exam = imported.items[0].problem;
assert.equal((await waitFor(teacher, `problems/${exam.id}`, 'validationStatus')).validationStatus, 'AC');
await teacher(`problems/${exam.id}/publish`, { versionId: exam.versionId });
await student(`problems/${exam.id}`, undefined, 404);
const group = await teacher('problem-groups', { bankId: privateBank.id, name: 'Smoke exam group', problemIds: [exam.id] }, 201);
assert.deepEqual(group.problemIds, [exam.id]);
await student(`problem-groups?bankId=${privateBank.id}`, undefined, 403);
console.log('PASS real lesson publication/progress, scoped reports, private banks/groups and idempotent partial JSON import');

const timed = await teacher('timed-practices', { title: `Smoke timed ${run}`, classId: cls.id, startsAt: new Date(Date.now()-60000).toISOString(), endsAt: new Date(Date.now()+300000).toISOString(), durationMinutes: 1, showVerdict: false, problems: [{ problemId: exam.id, versionId: exam.versionId, points: 100 }] }, 201);
await teacher(`timed-practices/${timed.id}/publish`, {});
await outsider(`timed-practices/${timed.id}`, undefined, 403);
await student(`timed-practices/${timed.id}/start`, {});
assert.equal((await student(`problems/${exam.id}?versionId=${exam.versionId}`)).referenceCode, undefined);
await student('submissions', { problemId: exam.id, versionId: exam.versionId, kind: 'submit', code: correct, idempotencyKey: randomUUID() }, 403);
const timedReceipt = await student('submissions', { problemId: exam.id, versionId: exam.versionId, timedPracticeId: timed.id, kind: 'submit', code: correct, idempotencyKey: randomUUID() }, 201);
const actualTimed = await waitFor(teacher, `submissions/${timedReceipt.id}`);
assert.equal(actualTimed.status, 'AC'); assert.equal(actualTimed.score, 100);
const embargo = await student(`submissions/${timedReceipt.id}`);
assert.equal(embargo.status, 'Executed'); assert.equal(embargo.score, null); assert.equal(embargo.passed, null);
await teacher(`timed-practices/${timed.id}/results`, {}, 409);
await teacher(`timed-practices/${timed.id}/end`, { reason: 'Local verification of explicit teacher end' });
await student('submissions', { problemId: exam.id, versionId: exam.versionId, timedPracticeId: timed.id, kind: 'submit', code: correct, idempotencyKey: randomUUID() }, 409);
await teacher(`timed-practices/${timed.id}/results`, {});
assert.equal((await student(`timed-practices/${timed.id}`)).grade.score, 100);
assert.equal((await teacher(`reports?timedPracticeId=${timed.id}`)).summary.averagePercent, 100);
const reviewed = await student('submissions', { problemId: exam.id, versionId: exam.versionId, kind: 'correction', originalSubmissionId: timedReceipt.id, code: correct, idempotencyKey: randomUUID() }, 201);
assert.equal((await waitFor(student, `submissions/${reviewed.id}`)).status, 'AC');
console.log('PASS private timed training, server start/end, genuine hidden AC, feedback embargo, result publication and post-training correction');

await admin(`submissions/${accepted.id}/rejudge`, { reason: 'Local verification of audited candidate results' });
let candidate;
for (let count=0;count<200;count++) {
  const current=await admin(`submissions/${accepted.id}`);
  assert.equal(current.status,'AC'); assert.equal(current.score,100);
  if(current.pendingRejudge?.status==='AC') { candidate=current.pendingRejudge; break; }
  await sleep(300);
}
assert(candidate,'Real rejudge candidate did not complete.');
await admin(`submissions/${accepted.id}/rejudge-confirm`, { runId:candidate.runId });
assert.equal((await teacher(`assignments/${assignment.id}`)).grades[0].score,100);
const reclaimed=await admin(`people/${people.student.person.id}/unbind`, { reason:'Local verification of identity continuity' });
await student('auth/me',undefined,401);
const replacement=client();
const replacementLogin=`smoke.reclaimed.${run}`;
await replacement('auth/register',{kind:'student',number:people.student.person.number,name:people.student.person.name,activationCode:reclaimed.activationCode,username:replacementLogin,password:pass},201);
assert.equal((await replacement(`submissions/${wrong.id}`)).score,75);
assert.equal((await replacement(`learning-paths/${path.id}`)).completedChapters,1);
assert.equal((await replacement(`timed-practices/${timed.id}`)).grade.score,100);
console.log('PASS live restricted-worker rejudge confirmation and reclaimed identity retains grades, code and learning progress');

if (process.env.CAMPUS_SMOKE_OUTPUT) await writeFile(process.env.CAMPUS_SMOKE_OUTPUT, JSON.stringify({ adminLogin, adminPassword, password: pass, studentLogin: replacementLogin, teacherLogin: `smoke.teacher.${run}`, problemId: problem.id, assignmentId: assignment.id, submissionId: wrong.id, correctionId: correction.id, classId: cls.id, learningPathId:path.id,timedPracticeId:timed.id }, null, 2), { mode: 0o600 });
console.log('Production teaching smoke passed against PostgreSQL + live isolated Python executor.');
