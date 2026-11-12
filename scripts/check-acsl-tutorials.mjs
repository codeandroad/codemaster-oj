// Validate authored course documents without connecting to a database or executing student programs.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown, serializeLearningMarkdown } from '../apps/web/src/components/teacher/learning-document.ts';
import { validateLearningDocument } from '../packages/domain/src/learning-document.mjs';

const root = new URL('../content/acsl-tutorials/', import.meta.url);
const katex = createRequire(new URL('../apps/web/package.json', import.meta.url))('katex');
const json = async url => JSON.parse(await readFile(url, 'utf8'));

export const tutorialUnitIds = ['number-systems', 'recursion', 'program-tracing', 'expressions', 'bit-strings', 'lisp', 'boolean-algebra', 'data-structures', 'automata-regex', 'graphs'];
export function assertTutorialUnit(unitId) {
  assert.ok(tutorialUnitIds.includes(unitId), `Unknown tutorial unit: ${unitId}`);
  return unitId;
}

export function parseTutorialOptions(argv, { importing = false } = {}) {
  const values = new Set(importing ? ['--unit', '--language', '--origin', '--auth-file'] : ['--unit']);
  const flags = new Set(importing ? ['--import'] : ['--all']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    assert.ok(values.has(name) || flags.has(name), `Unknown option: ${name}`);
    assert.ok(!(name in options), `Repeated option: ${name}`);
    if (flags.has(name)) options[name] = true;
    else {
      assert.ok(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value for ${name}`);
      options[name] = argv[++i];
    }
  }
  assert.ok(!(options['--all'] && options['--unit']), '--all and --unit cannot be combined');
  const unitId = assertTutorialUnit(options['--unit'] ?? 'number-systems');
  const language = options['--language'] ?? 'bilingual';
  assert.ok(['bilingual', 'en', 'zh'].includes(language), 'Tutorial language must be bilingual, en or zh');
  return { unitId, language, all: Boolean(options['--all']), import: Boolean(options['--import']),
    origin: options['--origin'], authFile: options['--auth-file'] };
}

export async function readAcslTutorial(language, unitId = 'number-systems') {
  assertTutorialUnit(unitId);
  assert.ok(['en', 'zh'].includes(language), 'Tutorial language must be en or zh');
  const manifest = await json(new URL('curriculum.json', root));
  const unit = manifest.units.find(unit => unit.id === unitId);
  assert.ok(unit?.documents, `${unitId}: authored tutorial documents are not available`);
  assert.equal(unit.documents[language], `intermediate/${unitId}/course.${language}.md`, 'Tutorial document must use its own unit directory');
  const document = parseLearningMarkdown(await readFile(new URL(unit.documents[language], root), 'utf8'));
  validateLearningDocument(document);
  return document;
}

export async function readTutorialPracticeMap(unitId = 'number-systems') {
  assertTutorialUnit(unitId);
  const manifest = await json(new URL('curriculum.json', root));
  const unit = manifest.units.find(item => item.id === unitId);
  assert.ok(Number.isInteger(unit?.plannedLessons) && unit.plannedLessons > 0, 'Planned lesson count is required');
  const practices = await json(new URL(`intermediate/${unitId}/practice-map.json`, root));
  assert.equal(practices.version, 1);
  assert.equal(practices.unitId, unitId);
  assert.equal(practices.chapters.length, unit.plannedLessons);
  assert.equal(new Set(practices.chapters.map(chapter => chapter.key)).size, unit.plannedLessons);
  const assigned = practices.chapters.flatMap((chapter, position) => {
    assert.equal(chapter.position, position);
    assert.ok(typeof chapter.key === 'string' && chapter.key.trim(), 'Chapter map key is required');
    assert.ok(Array.isArray(chapter.references), 'Chapter practice references are required');
    for (const ref of chapter.references) assert.deepEqual(Object.keys(ref).sort(), ['paperSlug', 'questionId']);
    return chapter.references;
  });
  const key = reference => `${reference.paperSlug}/${reference.questionId}`;
  assert.equal(new Set(assigned.map(key)).size, assigned.length, 'Each sample question has one primary lesson');
  assert.deepEqual(assigned.map(key).sort(), unit.practiceReferences.map(key).sort(), `Map every ${unitId} reference`);
  return practices;
}

export function tutorialCheckpointNumbers(text, { answers = false } = {}) {
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  const labels = [...prose.matchAll(/^(?:(\d+)\. |\*\*(\d+)\.\*\* )/gm)];
  assert.ok(labels.length, 'Numbered checkpoints and answers are required');
  assert.equal(new Set(labels.map(match => Boolean(match[2]))).size, 1, 'Do not mix ordinary and fixed checkpoint labels');
  if (answers) assert.ok(labels.every(match => match[2]), 'Answers require fixed bold number labels');
  const numbers = labels.map(match => Number(match[1] ?? match[2]));
  assert.deepEqual(numbers, numbers.map((_, index) => index + 1), 'Checkpoint labels must be consecutive without duplicates');
  return numbers;
}

function integer(digits, base) {
  assert.ok(Number.isInteger(base) && base >= 2 && base <= 16);
  assert.match(digits, /^[0-9A-F]+$/);
  return [...digits].reduce((value, digit) => {
    const n = '0123456789ABCDEF'.indexOf(digit);
    assert.ok(n < base, `${digits}: invalid digit in base ${base}`);
    return value * BigInt(base) + BigInt(n);
  }, 0n);
}

export async function checkAcslTutorials(unitId) {
  if (unitId !== undefined) assertTutorialUnit(unitId);
  const manifest = await json(new URL('curriculum.json', root));
  assert.equal(manifest.format, 'codemaster-acsl-curriculum');
  assert.equal(manifest.division, 'Intermediate');
  assert.equal(manifest.units.length, 12);
  assert.equal(new Set(manifest.units.map(unit => unit.id)).size, 12);
  const editions = new URL('../packages/domain/content/acsl/editions/', import.meta.url);
  const files = (await readdir(editions, { recursive: true })).filter(name => /\/intermediate\/contest-\d\/paper\.json$/.test(name));
  const papers = new Map(await Promise.all(files.map(async name => {
    const paper = await json(new URL(name, editions));
    return [paper.slug, paper];
  })));
  const referenced = new Set();
  for (const unit of manifest.units) {
    for (const ref of unit.practiceReferences) {
      assert.deepEqual(Object.keys(ref).sort(), ['paperSlug', 'questionId']);
      const paper = papers.get(ref.paperSlug);
      assert.ok(paper, ref.paperSlug);
      assert.equal(paper.round, unit.round);
      const question = paper.questions.find(question => question.id === ref.questionId);
      assert.ok(question && unit.sourceTopics.includes(question.topic.en), `${unit.id}/${ref.questionId}`);
      const key = `${paper.slug}/${question.id}`;
      assert.ok(!referenced.has(key), `Repeated practice reference: ${key}`);
      referenced.add(key);
    }
  }
  assert.equal(referenced.size, [...papers.values()].reduce((n, paper) => n + paper.questions.length, 0));
  const selected = unitId === undefined ? manifest.units.filter(unit => unit.documents)
    : [manifest.units.find(unit => unit.id === unitId)];
  const checkedUnits = [];
  for (const unit of selected) {
    assert.ok(unit?.documents && Number.isInteger(unit.plannedLessons) && unit.plannedLessons > 0,
      `${unit?.id}: planned lesson count and authored documents are required`);
    const documents = await Promise.all(['en', 'zh'].map(language => readAcslTutorial(language, unit.id)));
    let formulas = 0;
    for (const doc of documents) {
      assert.equal(doc.chapters.length, unit.plannedLessons, `${unit.id}: planned lesson count`);
      assert.ok(doc.title.trim() && doc.description.trim(), `${unit.id}: course title and description are required`);
      assert.deepEqual(parseLearningMarkdown(serializeLearningMarkdown(doc)), doc, 'Course Markdown must round-trip losslessly');
      for (const chapter of doc.chapters) {
        assert.deepEqual(chapter.problemIds, [], 'ACSL question IDs cannot be ordinary problem references');
        assert.ok(!chapter.paper4Links?.length);
        const questionNumbers = tutorialCheckpointNumbers(chapter.checkpoint);
        const answerNumbers = tutorialCheckpointNumbers(chapter.checkpointAnswer, { answers: true });
        assert.deepEqual(answerNumbers, questionNumbers, `${chapter.title}: fixed answer labels must match checkpoints across display formulas`);
        for (const field of ['title', 'objective', 'content', 'checkpoint', 'checkpointAnswer']) {
          const text = chapter[field];
          assert.ok(text.trim(), `${chapter.title}: ${field} is missing`);
          assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|!\[.*?\]\(|<img\b|correctOptionIds|\/api\/|\/assets\//);
          for (const match of text.matchAll(/\$\$([\s\S]*?)\$\$|\$([^\n$]+)\$/g)) {
            katex.renderToString(match[1] ?? match[2], { throwOnError: true, strict: 'ignore' });
            formulas++;
          }
        }
      }
      if (unit.id === 'number-systems') assert.ok(doc.chapters.some(chapter => chapter.content.includes('\\begin{array}') && chapter.content.includes('\\hline')), 'A worked vertical calculation is required');
    }
    assert.equal(documents[0].chapters.length, documents[1].chapters.length, `${unit.id}: bilingual lesson alignment`);
    for (const [position, chapter] of documents[0].chapters.entries()) {
      assert.equal(tutorialCheckpointNumbers(chapter.checkpoint).length,
        tutorialCheckpointNumbers(documents[1].chapters[position].checkpoint).length,
        `${unit.id}/${position + 1}: bilingual checkpoint alignment`);
    }
    // Validate chapter-to-practice mapping even when the caller only checks
    // documents rather than building an import payload.
    await readTutorialPracticeMap(unit.id);
    let cases;
    if (unit.id === 'number-systems') cases = await checkNumberSystems();
    else {
      // Only these reviewed, first-party validators may execute. Never import a
      // path supplied by a manifest, lesson, API response, or student program.
      const validators = {
        'graphs': () => import('../content/acsl-tutorials/intermediate/graphs/checks.mjs'),
        'boolean-algebra': () => import('../content/acsl-tutorials/intermediate/boolean-algebra/checks.mjs'),
        'data-structures': () => import('../content/acsl-tutorials/intermediate/data-structures/checks.mjs'),
        'automata-regex': () => import('../content/acsl-tutorials/intermediate/automata-regex/checks.mjs'),
        expressions: () => import('../content/acsl-tutorials/intermediate/expressions/checks.mjs'),
        'bit-strings': () => import('../content/acsl-tutorials/intermediate/bit-strings/checks.mjs'),
        lisp: () => import('../content/acsl-tutorials/intermediate/lisp/checks.mjs'),
        recursion: () => import('../content/acsl-tutorials/intermediate/recursion/checks.mjs'),
        'program-tracing': () => import('../content/acsl-tutorials/intermediate/program-tracing/checks.mjs'),
      };
      assert.ok(validators[unit.id], `${unit.id}: no approved tutorial validator`);
      const result = await (await validators[unit.id]()).checkTutorial();
      assert.ok(Number.isSafeInteger(result?.cases) && result.cases > 0, `${unit.id}: validator must report checked cases`);
      cases = result.cases;
    }
    checkedUnits.push({ unitId: unit.id, documents: 2, lessonsPerLanguage: unit.plannedLessons, formulas, cases });
  }
  return { units: manifest.units.length, practiceReferences: referenced.size,
    documents: checkedUnits.reduce((n, unit) => n + unit.documents, 0),
    lessonsPerLanguage: checkedUnits.reduce((n, unit) => n + unit.lessonsPerLanguage, 0),
    formulas: checkedUnits.reduce((n, unit) => n + unit.formulas, 0),
    arithmeticCases: checkedUnits.find(unit => unit.unitId === 'number-systems')?.cases ?? 0, checkedUnits };
}

async function checkNumberSystems() {
  const arithmetic = await json(new URL('intermediate/number-systems/arithmetic-checks.json', root));
  assert.equal(arithmetic.version, 1);
  assert.ok(arithmetic.cases.length > 0);
  assert.equal(new Set(arithmetic.cases.map(item => item.id)).size, arithmetic.cases.length);
  for (const item of arithmetic.cases) {
    if (item.kind === 'convert') {
      assert.equal(integer(item.input, item.fromBase), integer(item.expected, item.toBase), item.id);
    } else {
      assert.ok(['add', 'subtract'].includes(item.kind), item.id);
      assert.ok(item.operands.length >= 2);
      if (item.kind === 'subtract') assert.equal(item.operands.length, 2);
      const values = item.operands.map(value => integer(value, item.base));
      assert.equal(item.kind === 'add' ? values.reduce((sum, n) => sum + n, 0n) : values[0] - values[1], integer(item.expected, item.base), item.id);
      if (item.carries) {
        assert.equal(item.kind, 'add');
        const width = Math.max(...item.operands.map(value => value.length));
        const digits = item.operands.map(value => value.padStart(width, '0'));
        let carry = 0;
        const carries = [];
        for (let column = width - 1; column >= 0; column--) {
          carry = Math.floor((digits.reduce((sum, value) => sum + Number(integer(value[column], item.base)), 0) + carry) / item.base);
          carries.push(carry);
        }
        assert.deepEqual(carries, item.carries, `${item.id}: outgoing carries, units column first`);
      }
    }
  }
  return arithmetic.cases.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseTutorialOptions(process.argv.slice(2));
  console.log(JSON.stringify(await checkAcslTutorials(options.all ? undefined : options.unitId), null, 2));
}
