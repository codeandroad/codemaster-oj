// Local-only draft import through the existing teacher course API. Never publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readAcslTutorial, checkAcslTutorials } from './check-acsl-tutorials.mjs';
import { readAcslBilingualTutorial } from './lib/acsl-tutorial-document.mjs';

const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const language = option('--language') ?? 'bilingual';
const document = language === 'bilingual' ? await readAcslBilingualTutorial() : await readAcslTutorial(language);
console.log(JSON.stringify(await checkAcslTutorials()));
if (!process.argv.includes('--import')) {
  console.log('Validated only. Default: one bilingual course with shared chapter IDs and ACSL links. Use --import --origin http://localhost:PORT --auth-file PRIVATE_JSON to create a local draft.');
  process.exit(0);
}
assert.ok(option('--origin') && option('--auth-file'), 'Local origin and private auth file are required.');
const origin = new URL(option('--origin'));
assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)
  && origin.port && origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password,
  'Only an explicit local HTTP origin is allowed.');
const auth = JSON.parse(await readFile(resolve(option('--auth-file')), 'utf8'));
assert.ok(typeof auth.username === 'string' && typeof auth.password === 'string', 'Private auth file needs username and password.');
const directory = resolve('.campus-local/acsl-tutorial-import');
await mkdir(directory, { recursive: true, mode: 0o700 });
const key = createHash('sha256').update(`${origin.origin}\0${auth.username}\0${language}`).digest('hex');
const filename = resolve(directory, `${key}.json`);
const hash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
let state;
try { state = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (state) assert.equal(state.hash, hash, 'A previous draft import has different content. Review it in the teacher editor.');
let cookie = '', csrfToken = '';
async function request(path, body) {
  const response = await fetch(`${origin.origin}/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { Origin: origin.origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Error(`${path}: HTTP ${response.status} (${value.error?.code ?? 'REQUEST_FAILED'})`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  if (value.csrfToken) csrfToken = value.csrfToken;
  return value;
}
await request('auth/login', { username: auth.username, password: auth.password });
const matches = course => !course.published && course.title === document.title && course.description === document.description
  && isDeepStrictEqual(course.localizations ?? {}, document.localizations ?? {})
  && course.chapters?.length === document.chapters.length && course.chapters.every((chapter, i) =>
    ['title', 'content', 'objective', 'checkpoint', 'checkpointAnswer'].every(field => chapter[field] === document.chapters[i][field])
    && isDeepStrictEqual(chapter.localizations ?? {}, document.chapters[i].localizations ?? {})
    && isDeepStrictEqual((chapter.acslLinks ?? []).map(({ paperSlug, kind, questionId }) => ({ paperSlug, kind, ...(questionId ? { questionId } : {}) })), document.chapters[i].acslLinks ?? [])
    && !chapter.problems?.length && !chapter.paper4Links?.length);
if (state?.courseId) {
  const course = await request(`learning-paths/${state.courseId}`);
  assert.ok(matches(course), 'The imported draft has since changed. It will not be overwritten or re-created.');
  console.log(JSON.stringify({ imported: false, courseId: course.id, published: false }));
} else {
  // A lost response must not create a second course. Reconcile against exact
  // draft content before the initial POST, then refuse ambiguous recovery.
  const candidates = (await request('learning-paths')).items.filter(course => !course.published && course.title === document.title && course.canEdit);
  const matching = [];
  for (const candidate of candidates) { const detail = await request(`learning-paths/${candidate.id}`); if (matches(detail)) matching.push(detail); }
  assert.ok(matching.length <= 1, 'Multiple identical drafts exist; choose the intended one in the teacher course list.');
  assert.ok(matching.length || !candidates.length, 'A same-title draft already exists with different content. Review or upgrade it; no duplicate course was created.');
  if (!matching.length && state?.started) throw Error('A previous import was interrupted. Check the teacher course list before retrying; no new draft was created.');
  if (!matching.length) await writeFile(filename, JSON.stringify({ hash, started: true }) + '\n', { mode: 0o600 });
  let course = matching[0];
  if (!course) {
    const created = await request('learning-paths/import', document);
    await writeFile(filename, JSON.stringify({ hash, courseId: created.id, language, origin: origin.origin }) + '\n', { mode: 0o600 });
    course = await request(`learning-paths/${created.id}`);
  }
  assert.ok(matches(course), 'The imported course does not match the validated draft.');
  await writeFile(filename, JSON.stringify({ hash, courseId: course.id, language, origin: origin.origin }) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ imported: !matching.length, courseId: course.id, published: false,
    preview: `${origin.origin}/teacher/courses/${course.id}?preview=1` }));
}
