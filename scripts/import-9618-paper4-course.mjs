// Import the reviewed 9618 Paper 4 preparation course into the separate local
// preview. This creates only drafts; it does not publish, approve or deploy.
// Run --check first, then --import once the authoring package has been reviewed.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../apps/web/src/components/teacher/learning-document.ts';
import { validateLearningDocument } from '../packages/domain/src/learning-document.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const contentDir = resolve(root, 'content/9618-paper4-course');
const statePath = resolve(root, '.campus-local/9618-paper4-course-import.json');
const schoolBankId = '00000000-0000-4000-8000-000000000001';
const configuredOrigin = process.env.CAMPUS_LOCAL_ORIGIN ?? 'http://127.0.0.1:3002';
const base = new URL(configuredOrigin);
if (base.origin !== 'http://127.0.0.1:3002' || base.pathname !== '/' ||
    base.search || base.hash)
  throw Error('Import is restricted to the separate local Paper 4 preview at http://127.0.0.1:3002.');
const origin = base.origin;
const mode = process.argv[2] ?? '--check';
if (!['--check', '--import'].includes(mode)) throw Error('Use --check or --import.');

function runReference(code, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('python3', ['-I', '-c', code], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let diagnostics = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-600); });
    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      if (exitCode !== 0) reject(Error(`Reference exited with ${exitCode}: ${diagnostics}`));
      else resolvePromise(output);
    });
    child.stdin.end(input);
  });
}

const markdown = await readFile(resolve(contentDir, 'course.md'), 'utf8');
const source = await readFile(resolve(contentDir, 'problems.json'), 'utf8');
const course = validateLearningDocument(parseLearningMarkdown(markdown));
const problems = JSON.parse(source);
assert.ok(course.chapters.length >= 12 && course.chapters.length <= 100,
  'A complete Paper 4 course should contain at least 12 chapters.');
assert.ok(Array.isArray(problems) && problems.length >= 24 && problems.length <= 100,
  'Expect 24–100 exercises; the bulk import API accepts at most 100.');
assert.ok(Buffer.byteLength(source) <= 2 * 1024 * 1024, 'Problem pack exceeds the import limit.');
const titles = new Set();
const exerciseCounts = new Array(course.chapters.length).fill(0);
let caseCount = 0;
for (const [index, problem] of problems.entries()) {
  const label = `Problem ${index + 1}`;
  assert.equal(problem.mode, 'stdio', `${label} must use standard input/output.`);
  assert.equal(problem.referenceLanguage ?? 'python', 'python', `${label}: Python 3 is required.`);
  assert.ok(typeof problem.title === 'string' && problem.title.trim() && !titles.has(problem.title),
    `${label} has an empty or duplicate title.`);
  titles.add(problem.title);
  assert.ok(Number.isInteger(problem.chapterNumber) && problem.chapterNumber >= 1 &&
    problem.chapterNumber <= course.chapters.length, `${label} has an invalid chapterNumber.`);
  assert.equal(problem.chapterTitle, course.chapters[problem.chapterNumber - 1].title,
    `${label} chapterTitle does not match its assigned lesson.`);
  exerciseCounts[problem.chapterNumber - 1]++;
  assert.ok(problem.statement?.trim() && problem.referenceCode?.trim(), `${label} lacks a statement or reference.`);
  assert.ok(problem.title.length <= 200 && Buffer.byteLength(problem.statement) <= 262144,
    `${label} title or statement exceeds the API limit.`);
  assert.ok(Number.isInteger(problem.timeLimitMs ?? 2000) &&
    (problem.timeLimitMs ?? 2000) >= 100 && (problem.timeLimitMs ?? 2000) <= 5000,
    `${label} has an invalid time limit.`);
  assert.ok(Number.isInteger(problem.memoryLimitMb ?? 256) &&
    (problem.memoryLimitMb ?? 256) >= 32 && (problem.memoryLimitMb ?? 256) <= 256,
    `${label} has an invalid memory limit.`);
  assert.ok(['tokens', 'exact'].includes(problem.comparator ?? 'tokens'), `${label} has an invalid comparator.`);
  assert.ok(Array.isArray(problem.samples) && problem.samples.length >= 2 && problem.samples.length <= 20,
    `${label} needs 2–20 public samples.`);
  assert.ok(Array.isArray(problem.tests) && problem.tests.length >= 5 && problem.tests.length <= 100,
    `${label} needs 5–100 formal tests.`);
  const enabled = problem.tests.filter(test => test.enabled !== false);
  assert.ok(Math.abs(enabled.reduce((sum, test) => sum + Number(test.weight), 0) - 100) < 0.00001,
    `${label} formal test weights must total 100.`);
  for (const [caseIndex, test] of [...problem.samples, ...problem.tests].entries()) {
    assert.equal(typeof test.input, 'string', `${label}, case ${caseIndex + 1}: input must be text.`);
    assert.equal(typeof test.expected, 'string', `${label}, case ${caseIndex + 1}: expected must be text.`);
    const actual = await runReference(problem.referenceCode, test.input);
    const normalize = value => problem.comparator === 'exact' ? value : value.trim().split(/\s+/).join(' ');
    assert.equal(normalize(actual), normalize(test.expected),
      `${label}, case ${caseIndex + 1}: reference output differs from expected output.`);
    caseCount++;
  }
}
assert.ok(exerciseCounts.every(count => count > 0), 'Every chapter needs at least one exercise.');
console.log(`Checked ${course.chapters.length} lessons, ${problems.length} exercises and ${caseCount} reference cases.`);
if (mode === '--check') process.exit(0);

const hash = createHash('sha256').update(markdown).update('\0').update(source).digest('hex');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (state && (state.schema !== 1 || state.hash !== hash))
  throw Error('An import has already started with different content. Review the saved local state before changing or retrying it.');
state ??= { schema: 1, hash, idempotencyKey: randomUUID(), courseId: null, groupId: null, problems: [] };
async function save() {
  await mkdir(resolve(root, '.campus-local'), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporary, statePath);
}
await save();

const credentials = JSON.parse(await readFile(resolve(root, '.campus-local/test-accounts.json'), 'utf8'));
let cookie = '';
let csrfToken = '';
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw Error(`${method} ${path}: HTTP ${response.status}${payload.error?.code ? ` (${payload.error.code})` : ''}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  if (payload.csrfToken) csrfToken = payload.csrfToken;
  return payload;
}
await request('auth/login', { username: credentials.accounts.teacher.username, password: credentials.accounts.teacher.password });

if (!state.courseId) {
  // Reconcile a crash after the course was committed but before its ID was saved.
  const candidates = (await request('learning-paths')).items.filter(item => item.title === course.title && !item.published);
  for (const candidate of candidates) {
    const detail = await request(`learning-paths/${candidate.id}`);
    if (detail.chapters.length === course.chapters.length && detail.description === course.description &&
        detail.chapters.every((chapter, index) => chapter.title === course.chapters[index].title &&
          chapter.content === course.chapters[index].content &&
          chapter.objective === course.chapters[index].objective && !chapter.problems.length)) {
      state.courseId = candidate.id;
      break;
    }
  }
  if (!state.courseId) state.courseId = (await request('learning-paths/import', {
    format: 'codemaster-learning-path', version: 1, ...course,
  })).id;
  await save();
}
const draftCourse = await request(`learning-paths/${state.courseId}`);
assert.equal(draftCourse.published, false, 'Course was already published; do not modify it through this importer.');
assert.equal(draftCourse.chapters.length, course.chapters.length, 'Course chapter count changed after import.');
assert.ok(draftCourse.chapters.every((chapter, index) =>
  chapter.title === course.chapters[index].title && chapter.content === course.chapters[index].content),
  'Course content changed after import; do not overwrite teacher edits.');
if (!state.problems.length) {
  const importBody = {
    bankId: schoolBankId,
    idempotencyKey: state.idempotencyKey,
    filename: '9618-paper4-course/problems.json',
    rows: problems.map(({ chapterNumber, chapterTitle, ...problem }) => ({ ...problem, saveDraft: true })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(importBody)) < 2_097_152,
    'The problem import request exceeds the API 2 MiB body limit. Split the package before importing.');
  const receipt = await request('problems/import', importBody);
  if (receipt.summary.failed || receipt.items.length !== problems.length)
    throw Error(`Problem import created ${receipt.summary.created} and failed ${receipt.summary.failed}; inspect the import receipt before retrying.`);
  state.problems = receipt.items.map((item, index) => ({
    chapterNumber: problems[index].chapterNumber,
    id: item.problem.id,
    versionId: item.problem.versionId,
  }));
  await save();
}
assert.equal(state.problems.length, problems.length, 'Saved import state is incomplete.');
if (!state.groupId) {
  const groups = (await request('problem-groups')).items;
  const existing = groups.find(group => group.name === course.title && group.bankId === schoolBankId &&
    state.problems.every(problem => group.problemIds.includes(problem.id)));
  state.groupId = existing?.id ?? (await request('problem-groups', {
    bankId: schoolBankId, name: course.title, problemIds: state.problems.map(problem => problem.id),
  })).id;
  await save();
}

const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  const latest = await Promise.all(state.problems.map(item => request(`problems/${item.id}?versionId=${item.versionId}`)));
  assert.ok(latest.every(problem => problem.canEdit && !problem.published),
    'One of the imported problem versions was changed or published. Review it manually.');
  const pending = latest.filter(problem => ['Waiting', 'Judging'].includes(problem.validationStatus));
  if (!pending.length) {
    const failed = latest.filter(problem => problem.validationStatus !== 'AC');
    if (failed.length) throw Error(`${failed.length} reference solutions did not pass real isolated judge validation.`);
    const live = await request(`learning-paths/${state.courseId}`);
    assert.equal(live.published, false, 'Course was unexpectedly published.');
    assert.equal(live.chapters.length, course.chapters.length);
    for (const [index, chapter] of live.chapters.entries()) {
      assert.equal(chapter.title, course.chapters[index].title, 'A chapter title changed after import.');
      assert.equal(chapter.content, course.chapters[index].content, 'Chapter content changed after import.');
      const wanted = state.problems.filter(item => item.chapterNumber === index + 1).map(item => item.id);
      const current = chapter.problems.map(item => item.problemId);
      if (JSON.stringify(current) === JSON.stringify(wanted)) continue;
      if (current.length) throw Error(`Chapter ${index + 1} has manually edited links; not overwriting them.`);
      await request(`chapters/${chapter.id}`, { problemIds: wanted }, 'PATCH');
    }
    const readBack = await request(`learning-paths/${state.courseId}`);
    assert.equal(readBack.chapters.reduce((n, chapter) => n + chapter.problems.length, 0), problems.length);
    const studentLogin = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: credentials.accounts.student.username, password: credentials.accounts.student.password }),
    });
    assert.equal(studentLogin.status, 200, 'Student demo login failed.');
    const studentCookie = studentLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(studentCookie);
    const [studentCourse, studentProblem] = await Promise.all([
      fetch(`${origin}/api/v1/learning-paths/${state.courseId}`, { headers: { Origin: origin, Cookie: studentCookie } }),
      fetch(`${origin}/api/v1/problems/${state.problems[0].id}`, { headers: { Origin: origin, Cookie: studentCookie } }),
    ]);
    assert.equal(studentCourse.status, 404, 'Draft course is unexpectedly visible to students.');
    assert.ok([403, 404].includes(studentProblem.status), 'Draft problem is unexpectedly visible to students.');
    console.log(`Imported draft course ${state.courseId} with ${state.problems.length} validated, linked exercises; group ${state.groupId}.`);
    console.log('Student access denied as expected. No course or problem was published.');
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
}
throw Error('Judge validation did not finish in four minutes. Run --import again to resume without duplicates.');
