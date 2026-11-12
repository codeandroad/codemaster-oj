import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseTutorialOptions, readAcslTutorial, checkAcslTutorials, tutorialCheckpointNumbers } from '../check-acsl-tutorials.mjs';
import { readAcslBilingualTutorial } from '../lib/acsl-tutorial-document.mjs';
import { matchesTutorialDraft, tutorialJournalKey } from '../import-acsl-tutorials.mjs';

test('CLI defaults preserve number systems and reject ambiguous or incomplete arguments', () => {
  assert.equal(parseTutorialOptions([]).unitId, 'number-systems');
  assert.equal(parseTutorialOptions(['--all']).all, true);
  for (const unit of ['recursion', 'expressions', 'bit-strings', 'lisp', 'boolean-algebra', 'data-structures', 'automata-regex']) {
    assert.equal(parseTutorialOptions(['--unit', unit]).unitId, unit);
  }
  assert.equal(parseTutorialOptions(['--unit', 'program-tracing', '--language', 'zh'], { importing: true }).language, 'zh');
  for (const args of [['--unit'], ['--unit', '--all'], ['--unit', 'unknown'], ['--unit', '../../private'],
    ['--all', '--unit', 'number-systems'], ['--unit', 'recursion', '--unit', 'recursion'], ['--wat'], ['recursion']]) {
    assert.throws(() => parseTutorialOptions(args), undefined, JSON.stringify(args));
  }
  for (const args of [['--origin'], ['--auth-file'], ['--language'], ['--language', 'fr'], ['--import', '--import'], ['--all']]) {
    assert.throws(() => parseTutorialOptions(args, { importing: true }), undefined, JSON.stringify(args));
  }
});

test('number-system journal keys remain byte-compatible while each unit has its own key', () => {
  const identity = { origin: 'http://127.0.0.1:3015', username: 'fixture', language: 'bilingual' };
  const legacy = createHash('sha256').update(`${identity.origin}\0${identity.username}\0${identity.language}`).digest('hex');
  assert.equal(tutorialJournalKey(identity), legacy);
  assert.equal(tutorialJournalKey({ ...identity, unitId: 'number-systems' }), legacy);
  const keys = ['number-systems', 'recursion', 'program-tracing', 'expressions', 'bit-strings', 'lisp', 'boolean-algebra', 'data-structures', 'automata-regex'].map(unitId => tutorialJournalKey({ ...identity, unitId }));
  assert.equal(new Set(keys).size, 9);
  assert.notEqual(tutorialJournalKey({ ...identity, unitId: 'recursion', language: 'en' }), keys[1]);
  assert.throws(() => tutorialJournalKey({ ...identity, unitId: 'other' }));
});

test('checkpoint labels survive code blocks without mixed styles or duplicate numbering', () => {
  assert.deepEqual(tutorialCheckpointNumbers('1. First\n\n2. Second'), [1, 2]);
  assert.deepEqual(tutorialCheckpointNumbers('**1.** First\n\n```text\n1. A code line\n```\n\n**2.** Second'), [1, 2]);
  assert.deepEqual(tutorialCheckpointNumbers('**1.** Answer', { answers: true }), [1]);
  for (const text of ['1. First\n**2.** Second', '1. First\n1. Duplicate', '**1.** First\n**3.** Skipped', 'No labels']) {
    assert.throws(() => tutorialCheckpointNumbers(text));
  }
  assert.throws(() => tutorialCheckpointNumbers('1. Answer', { answers: true }));
});

function fixture() {
  const ref = { paperSlug: 'acsl-2025-2026-intermediate-1', kind: 'question', questionId: 'q3' };
  const chapter = { title: 'Calls', content: 'Original lesson', objective: 'Trace calls', checkpoint: '1. Trace.', checkpointAnswer: '**1.** Original answer', problemIds: [], acslLinks: [ref],
    localizations: { zh: { title: '调用', content: '原创课文', objective: '跟踪', checkpoint: '1. 跟踪。', checkpointAnswer: '**1.** 原创答案' } } };
  const document = { title: 'Recursion', description: 'Original tutorial', category: 'ACSL', estimatedMinutes: 30,
    difficulty: 'intermediate', coverKey: 'algorithms', chapters: [chapter] };
  const versionId = randomUUID();
  const course = { ...structuredClone(document), id: randomUUID(), published: false, archived: false, canEdit: true,
    chapters: [{ ...structuredClone(chapter), id: randomUUID(), problems: [], paper4Links: [],
      acslLinks: [{ ...ref, versionId, available: true, status: 'not_started', completed: false }] }] };
  const state = { courseId: course.id, chapterIds: [course.chapters[0].id], acslReferences: [[{ ...ref, versionId }]] };
  return { document, course, state };
}

test('draft reconciliation refuses changed content, ownership, publication and exercise associations', () => {
  const { document, course, state } = fixture();
  assert.equal(matchesTutorialDraft(course, document), true, 'old journals remain usable');
  assert.equal(matchesTutorialDraft(course, document, state), true);
  const mutations = [
    value => { value.published = true; }, value => { value.archived = true; }, value => { value.canEdit = false; },
    value => { value.title += ' changed'; }, value => { value.category = 'Other'; },
    value => { value.chapters[0].content += ' changed'; },
    value => { value.chapters[0].localizations.zh.checkpointAnswer += ' changed'; },
    value => { value.chapters[0].acslLinks[0].questionId = 'q4'; },
    value => { value.chapters[0].acslLinks[0].paperSlug = 'acsl-2024-2025-intermediate-1'; },
    value => { value.chapters[0].acslLinks[0].kind = 'written'; },
    value => { value.chapters[0].problems = [{ id: randomUUID() }]; },
    value => { value.chapters[0].paper4Links = [{ paperId: randomUUID() }]; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(course); mutate(changed); assert.equal(matchesTutorialDraft(changed, document, state), false); }
});

test('journal course/chapter identities and pinned versions cannot silently change on retry', () => {
  const { document, course, state } = fixture();
  for (const mutate of [value => { value.id = randomUUID(); }, value => { value.chapters[0].id = randomUUID(); },
    value => { value.chapters[0].acslLinks[0].versionId = randomUUID(); }]) {
    const changed = structuredClone(course); mutate(changed); assert.equal(matchesTutorialDraft(changed, document, state), false);
  }
  const pinned = structuredClone(document); pinned.chapters[0].acslLinks[0].versionId = course.chapters[0].acslLinks[0].versionId;
  assert.equal(matchesTutorialDraft(course, pinned), true);
  pinned.chapters[0].acslLinks[0].versionId = randomUUID(); assert.equal(matchesTutorialDraft(course, pinned), false);
});

test('reader rejects unknown units before reading a manifest-controlled path', async () => {
  await assert.rejects(readAcslTutorial('en', '../../other'), /Unknown tutorial unit/);
  await assert.rejects(readAcslBilingualTutorial('other'), /Unknown tutorial unit/);
  await assert.rejects(readAcslTutorial('fr'), /Tutorial language/);
});

test('default number-system document and arithmetic validation remain unchanged', async () => {
  assert.deepEqual(await readAcslTutorial('en'), await readAcslTutorial('en', 'number-systems'));
  const document = await readAcslBilingualTutorial();
  assert.equal(document.chapters.length, 4);
  assert.equal(document.chapters.flatMap(chapter => chapter.acslLinks).length, 12);
  const result = await checkAcslTutorials('number-systems');
  assert.equal(result.formulas, 284); assert.equal(result.arithmeticCases, 78);
  assert.equal(result.practiceReferences, 128);
});

test('import CLI rejects a missing value before any auth or import operation', () => {
  assert.throws(() => execFileSync(process.execPath, [new URL('../import-acsl-tutorials.mjs', import.meta.url).pathname,
    '--import', '--unit', 'number-systems', '--auth-file'], { encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.match(error.stderr, /Missing value for --auth-file/);
    assert.doesNotMatch(error.stdout, /imported|Validated only/); return true;
  });
});

test('standalone checker completes without a circular top-level import', () => {
  const output = execFileSync(process.execPath, [new URL('../check-acsl-tutorials.mjs', import.meta.url).pathname,
    '--unit', 'number-systems'], { encoding: 'utf8', stdio: 'pipe' });
  const result = JSON.parse(output);
  assert.equal(result.checkedUnits[0].unitId, 'number-systems');
  assert.equal(result.arithmeticCases, 78);
});
