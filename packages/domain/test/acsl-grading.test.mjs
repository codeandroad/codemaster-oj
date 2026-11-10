import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeAnswer, selectedOptions, validatePaperDefinition } from '../src/acsl-grading.mjs';
const question = { type: 'multiple', options: ['A','B','C'].map(id => ({ id })), correctOptionIds: ['A','C'] };
test('multiple answers compare complete unordered sets and reject duplicate or unknown options', () => {
  assert.equal(gradeAnswer(question, ['C','A']), true);
  assert.equal(gradeAnswer(question, ['A']), false);
  assert.equal(gradeAnswer(question, ['A','B','C']), false);
  assert.throws(() => gradeAnswer(question, ['A','A']), error => error.status === 400);
  assert.throws(() => gradeAnswer(question, ['D']), error => error.status === 400);
  assert.throws(() => gradeAnswer(question, []), error => error.status === 400);
  assert.deepEqual(selectedOptions(question, [], { allowEmpty: true }), []);
});
test('single answer mode enforces one selection', () => {
  const single = { ...question, type: 'single', correctOptionIds: ['A'] };
  assert.equal(gradeAnswer(single, ['A']), true);
  assert.equal(gradeAnswer(single, ['B']), false);
  assert.throws(() => gradeAnswer(single, ['A','C']), error => error.status === 400);
});

const sample = JSON.parse(readFileSync(new URL('../content/acsl/sample.json', import.meta.url), 'utf8'));

test('the reviewed sample and a multiple-choice edition satisfy the import contract', () => {
  assert.equal(validatePaperDefinition(sample), sample);
  const multiple = structuredClone(sample);
  multiple.questions[0].type = 'multiple';
  multiple.questions[0].correctOptionIds = ['A', 'C'];
  assert.equal(validatePaperDefinition(multiple), multiple);
});

test('malformed editions are rejected before they can become unrenderable school content', () => {
  const invalid = [
    content => { content.title.en = { text: 'Title' }; },
    content => { content.division = 'Unknown'; },
    content => { content.season = '2025-2027'; },
    content => { content.season = 2025; },
    content => { content.round = '3'; },
    content => { content.round = 0; },
    content => { content.questions[0] = null; },
    content => { content.questions[0].number = 1.5; },
    content => { content.questions[1].number = content.questions[0].number; },
    content => { content.questions[1].id = content.questions[0].id; },
    content => { content.questions[0].topic.zh = ''; },
    content => { content.questions[0].statement.en = 123; },
    content => { content.questions[0].explanation.zh = ['Explanation']; },
    content => { content.questions[0].options[0] = null; },
    content => { content.questions[0].options[0].id = { value: 'A' }; },
    content => { content.questions[0].options[1].id = 'A'; },
    content => { content.questions[0].options[0].text.zh = '   '; },
    content => { content.questions[0].correctOptionIds = ['Z']; },
    content => { content.questions[0].correctOptionIds = ['A', 'D']; },
    content => { content.questions[0].statement.en = 'x'.repeat(100001); },
    content => { content.programming = null; },
    content => { content.programming.statementZh = {}; },
    content => { content.programming.definition = []; },
    content => { content.notes = ['x'.repeat(2000000)]; },
  ];
  for (const mutate of invalid) {
    const content = structuredClone(sample);
    mutate(content);
    assert.throws(() => validatePaperDefinition(content), undefined, mutate.toString());
  }
});
