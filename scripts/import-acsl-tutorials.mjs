// Local-only draft import through the existing teacher course API. Never publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertTutorialUnit, readAcslTutorial, checkAcslTutorials, parseTutorialOptions } from './check-acsl-tutorials.mjs';
import { readAcslBilingualTutorial } from './lib/acsl-tutorial-document.mjs';

export function tutorialJournalKey({ origin, username, language, unitId = 'number-systems' }) {
  assertTutorialUnit(unitId);
  const original = `${origin}\0${username}\0${language}`;
  // Keep the existing number-systems journals usable, including monolingual drafts.
  return createHash('sha256').update(unitId === 'number-systems' ? original : `${original}\0${unitId}`).digest('hex');
}

const referenceIdentity = ({ paperSlug, kind, questionId, versionId }) => ({ paperSlug, kind,
  ...(questionId ? { questionId } : {}), ...(versionId ? { versionId } : {}) });
const chapterReferences = course => course.chapters.map(chapter => (chapter.acslLinks ?? []).map(referenceIdentity));
export function matchesTutorialDraft(course, document, state = {}) {
  return course.canEdit === true && !course.published && !course.archived
    && (!state.courseId || course.id === state.courseId)
    && ['title', 'description', 'category', 'estimatedMinutes', 'difficulty', 'coverKey'].every(field => course[field] === document[field])
    && isDeepStrictEqual(course.localizations ?? {}, document.localizations ?? {})
    && course.chapters?.length === document.chapters.length
    && (!state.chapterIds || isDeepStrictEqual(course.chapters.map(chapter => chapter.id), state.chapterIds))
    && (!state.acslReferences || isDeepStrictEqual(chapterReferences(course), state.acslReferences))
    && course.chapters.every((chapter, i) => {
      const expected = document.chapters[i];
      const refs = (chapter.acslLinks ?? []).map((reference, position) => {
        const input = expected.acslLinks?.[position];
        return referenceIdentity({ ...reference, versionId: input?.versionId ? reference.versionId : undefined });
      });
      return ['title', 'content', 'objective', 'checkpoint', 'checkpointAnswer'].every(field => chapter[field] === expected[field])
        && isDeepStrictEqual(chapter.localizations ?? {}, expected.localizations ?? {})
        && isDeepStrictEqual(refs, expected.acslLinks ?? [])
        && !chapter.problems?.length && !chapter.paper4Links?.length;
    });
}

export async function importAcslTutorials(argv = process.argv.slice(2)) {
  const options = parseTutorialOptions(argv, { importing: true });
  const { unitId, language } = options;
  const document = language === 'bilingual' ? await readAcslBilingualTutorial(unitId) : await readAcslTutorial(language, unitId);
  console.log(JSON.stringify(await checkAcslTutorials(unitId)));
  if (!options.import) {
    console.log(`Validated only (${unitId}, ${language}). Default: one bilingual course with shared chapter IDs and ACSL links. Use --import --origin http://localhost:PORT --auth-file PRIVATE_JSON to create a local draft.`);
    return;
  }
  assert.ok(options.origin && options.authFile, 'Local origin and private auth file are required.');
  const origin = new URL(options.origin);
  assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)
    && origin.port && origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password,
    'Only an explicit local HTTP origin is allowed.');
  const auth = JSON.parse(await readFile(resolve(options.authFile), 'utf8'));
  assert.ok(typeof auth.username === 'string' && auth.username && typeof auth.password === 'string' && auth.password,
    'Private auth file needs username and password.');
  const directory = resolve('.campus-local/acsl-tutorial-import');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = tutorialJournalKey({ origin: origin.origin, username: auth.username, language, unitId });
  const filename = resolve(directory, `${key}.json`);
  const hash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  // Serialize imports sharing one journal. An interrupted process leaves a lock
  // for explicit review rather than risking another course after a lost response.
  let lock;
  try { lock = await open(`${filename}.lock`, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('This tutorial import is already running or was interrupted. Review its private journal before retrying.');
    throw error;
  }
  try {
    let state;
    try { state = JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state) {
      assert.equal(state.hash, hash, 'A previous draft import has different content. Review it in the teacher editor.');
      assert.equal(state.unitId ?? 'number-systems', unitId, 'Import journal belongs to another tutorial unit.');
      if (state.language) assert.equal(state.language, language, 'Import journal language changed.');
      if (state.origin) assert.equal(state.origin, origin.origin, 'Import journal origin changed.');
      if (state.courseId) assert.match(state.courseId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i, 'Invalid journal course ID.');
    }
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
    const save = course => writeFile(filename, JSON.stringify({ hash, courseId: course.id, language, unitId, origin: origin.origin,
      chapterIds: course.chapters.map(chapter => chapter.id), acslReferences: chapterReferences(course) }) + '\n', { mode: 0o600 });
    await request('auth/login', { username: auth.username, password: auth.password });
    if (state?.courseId) {
      const course = await request(`learning-paths/${state.courseId}`);
      assert.ok(matchesTutorialDraft(course, document, state), 'The imported draft has since changed. It will not be overwritten or re-created.');
      await save(course);
      console.log(JSON.stringify({ imported: false, unitId, courseId: course.id, published: false }));
    } else {
      // A lost response must not create a second course. Reconcile against exact
      // draft content before the initial POST, then refuse ambiguous recovery.
      const candidates = (await request('learning-paths')).items.filter(course => !course.published && !course.archived && course.title === document.title && course.canEdit);
      const matching = [];
      for (const candidate of candidates) {
        const detail = await request(`learning-paths/${candidate.id}`);
        if (detail.id === candidate.id && matchesTutorialDraft(detail, document)) matching.push(detail);
      }
      assert.ok(matching.length <= 1, 'Multiple identical drafts exist; choose the intended one in the teacher course list.');
      assert.ok(matching.length || !candidates.length, 'A same-title draft already exists with different content. Review or upgrade it; no duplicate course was created.');
      if (!matching.length && state?.started) throw Error('A previous import was interrupted. Check the teacher course list before retrying; no new draft was created.');
      if (!matching.length) await writeFile(filename, JSON.stringify({ hash, started: true, unitId, language, origin: origin.origin }) + '\n', { mode: 0o600 });
      let course = matching[0];
      if (!course) {
        const created = await request('learning-paths/import', document);
        await writeFile(filename, JSON.stringify({ hash, courseId: created.id, language, unitId, origin: origin.origin }) + '\n', { mode: 0o600 });
        course = await request(`learning-paths/${created.id}`);
        assert.equal(course.id, created.id, 'The imported course identity changed.');
      }
      assert.ok(matchesTutorialDraft(course, document), 'The imported course does not match the validated draft.');
      await save(course);
      console.log(JSON.stringify({ imported: !matching.length, unitId, courseId: course.id, published: false,
        preview: `${origin.origin}/teacher/courses/${course.id}?preview=1` }));
    }
  } finally {
    await lock.close();
    await unlink(`${filename}.lock`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importAcslTutorials();
