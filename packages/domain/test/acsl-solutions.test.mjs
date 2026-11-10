import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { addAcslProgrammingSolution } from '../src/acsl-solutions.mjs';
import { validateAcslProgrammingSolution } from '../src/acsl-grading.mjs';
import { assertAcslPresentationOnly } from '../src/acsl-presentation.mjs';
import { acslExportDocument, mergeAcslManagementEdit } from '../src/acsl-management.mjs';
import { canonicalHash } from '../src/security.mjs';
import { randomUUID } from 'node:crypto';

const root = new URL('../content/acsl/', import.meta.url);
const sample = JSON.parse(readFileSync(new URL('sample.json', root), 'utf8'));
const solution = { language: 'python', provenance: 'independent', code: sample.programming.definition.referenceCode,
  explanation: { en: 'Follow the card rules in priority order.', zh: '按优先顺序执行出牌规则。' },
  complexity: { en: 'O(n²) time, O(n) space.', zh: '时间 O(n²)，空间 O(n)。' } };

test('solution publication preserves teacher content and every existing grading field', () => {
  const before = structuredClone(sample); delete before.programming.solution;
  before.questions[0].explanation.zh = '保留教师已编辑的解析。';
  before.programming.definition.title = 'Teacher title';
  const authored = structuredClone(sample); authored.programming.solution = solution;
  const after = addAcslProgrammingSolution(before, authored);
  assert.deepEqual(after.programming.solution, solution);
  assert.match(assertAcslPresentationOnly(before, after), /^[a-f0-9]{64}$/);
  const stripped = structuredClone(after); delete stripped.programming.solution;
  assert.deepEqual(stripped, before);
  after.programming.solution.code += '\n# changed';
  assert.equal(authored.programming.solution.code, solution.code);
  for (const change of [p => p.definition.tests[0].expected += 'wrong', p => p.definition.statement += 'new rule', p => p.statementZh += '规则变化']) {
    const changed = structuredClone(before); change(changed.programming);
    assert.throws(() => addAcslProgrammingSolution(changed, authored), /changed since solution review/);
  }
});

test('only teaching exports carry programming implementations and teacher edits cannot replace them', () => {
  const content = structuredClone(sample); content.programming.solution = solution;
  for (const language of ['en', 'zh']) {
    const questions = acslExportDocument(content, 'questions', language);
    assert.equal(questions.programming.solution, undefined);
    assert.ok(!JSON.stringify(questions).includes(solution.code));
    const answers = acslExportDocument(content, 'answers', language);
    assert.equal(answers.programming.solution.code, solution.code);
    assert.equal(answers.programming.solution.explanation, solution.explanation[language]);
    assert.equal(answers.programming.solution.complexity, solution.complexity[language]);
    assert.equal(answers.programming.tests, undefined);
  }
  assert.throws(() => mergeAcslManagementEdit(content, { expectedContentHash: canonicalHash(content), requestId: randomUUID(),
    reason: 'Attempt to modify code', programming: { solution } }), /Invalid programming/);
  for (const bad of [null, { ...solution, language: 'shell' }, { ...solution, code: '' }, { ...solution, complexity: { en: 'Only one language' } }, { ...solution, tests: [] }]) {
    assert.throws(() => validateAcslProgrammingSolution(bad), /Invalid ACSL programming solution/);
  }
});

test('all 72 programming papers have bilingual runnable implementations and independent boundary cases', () => {
  const files = ['sample.json', ...readdirSync(new URL('editions/', root), { recursive: true })
    .filter(name => name.endsWith('/paper.json')).map(name => `editions/${name}`)];
  const checks = readdirSync(new URL('solution-checks/', root)).filter(name => name.endsWith('.json'))
    .flatMap(name => JSON.parse(readFileSync(new URL(`solution-checks/${name}`, root), 'utf8')));
  let count = 0;
  for (const file of files) {
    const paper = JSON.parse(readFileSync(new URL(file, root), 'utf8'));
    if (!paper.programming) continue;
    count++;
    assert.doesNotThrow(() => validateAcslProgrammingSolution(paper.programming.solution), paper.slug);
    assert.ok(checks.some(check => check.slug === paper.slug && check.reason && typeof check.input === 'string' && typeof check.expected === 'string'), paper.slug);
  }
  assert.equal(count, 72);
});
