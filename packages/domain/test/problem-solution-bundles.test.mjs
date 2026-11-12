import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { originalProblemSolution, readAssistanceDraft, approvedAssistanceContent, editableAssistanceContent, pendingSolution } from '../src/problem-solution-bundles.mjs';

test('original solution combines editorial and reference code without changing the source', () => {
 const source = {editorial: '  Explain the algorithm.\n', referenceCode: '  print(1)\n', referenceLanguage: 'python'};
 const before = structuredClone(source);
 assert.deepEqual(originalProblemSolution(source), {body: 'Explain the algorithm.\n\n```python\n  print(1)\n```', programmingLanguage: 'python'});
 assert.deepEqual(source, before);
 assert.deepEqual(originalProblemSolution({editorial: 'Explanation only'}), {body: 'Explanation only'});
 assert.equal(originalProblemSolution({editorial: ' \n', referenceCode: '\n\t'}), undefined);
 assert.equal(originalProblemSolution(), undefined);
});

const scope = {subjectKey: 'problem:' + randomUUID(), kind: 'FULL_SOLUTION'};
test('programming languages round-trip across every article without mutating a legacy bundle', () => {
 const solutions = ['python', 'cpp', 'javascript', null].map((programmingLanguage, index) => ({
  id: randomUUID(), title: `Approach ${index}`, body: `Explanation ${index}`, programmingLanguage,
 }));
 const input = structuredClone(solutions);
 const draft = readAssistanceDraft({solutions}, scope);
 const row = {id: solutions[0].id, body: draft.body, solution_details: draft.details};
 assert.deepEqual(approvedAssistanceContent(row).solutions, solutions.map(({programmingLanguage, ...entry}) => ({
  ...entry, ...(programmingLanguage ? {programmingLanguage} : {}),
 })));
 assert.deepEqual(solutions, input);
 assert.equal(pendingSolution(row, draft), null);
 const legacy = {id: randomUUID(), body: 'Original body', solution_details: {primaryTitle: 'Original', alternatives: []}};
 assert.deepEqual(approvedAssistanceContent(legacy), {body: 'Original body', solutions: [{id: legacy.id, title: 'Original', body: 'Original body'}]});
 assert.deepEqual(approvedAssistanceContent({body:'Single old article'}), {body:'Single old article', solutions:undefined});
});

test('a language-only edit requires review and does not change student content before approval', () => {
 const row = {id: randomUUID(), body: 'Same explanation', solution_details: {primaryTitle: 'Approach', primaryLanguage: 'python', alternatives: []}};
 const approved = approvedAssistanceContent(row);
 const draft = readAssistanceDraft({solutions: approved.solutions.map(item => ({...item, programmingLanguage: 'cpp'}))}, {...scope, previous: row});
 row.pending_solution = pendingSolution(row, draft);
 assert.ok(row.pending_solution);
 assert.equal(editableAssistanceContent(row).solutions[0].programmingLanguage, 'cpp');
 assert.deepEqual(approvedAssistanceContent(row), approved);
 const general = readAssistanceDraft({solutions: approved.solutions.map(item => ({...item, programmingLanguage: null}))}, scope);
 assert.equal(approvedAssistanceContent({...row, solution_details: general.details}).solutions[0].programmingLanguage, undefined);
});

test('unknown and malformed language metadata is rejected for primary and alternative solutions', () => {
 for (const value of ['', 'ruby', 'Python', 'zh-CN', {}, [], 1, true]) {
  for (const index of [0, 1]) {
   const solutions = [{title: 'First', body: 'Body'}, {title: 'Second', body: 'Body'}];
   solutions[index].programmingLanguage = value;
   assert.throws(() => readAssistanceDraft({solutions}, scope), error => error.status === 400 && error.code === 'VALIDATION');
  }
 }
 assert.throws(() => readAssistanceDraft({solutions:[{title:'Translation',body:'Text',programmingLanguage:'python'}]}, {...scope,kind:'FULL_TRANSLATION'}), error=>error.status===400);
});

test('reference source cannot close its Markdown fence or inject a language header', () => {
 const code = 'const value = `template`;\n```\n# still code\n````';
 assert.deepEqual(originalProblemSolution({referenceCode: code, referenceLanguage: 'javascript'}), {
  body: '`````javascript\n' + code + '\n`````', programmingLanguage: 'javascript',
 });
 assert.deepEqual(originalProblemSolution({referenceCode: 'int main() {}', referenceLanguage: 'cpp'}), {
  body: '```cpp\nint main() {}\n```', programmingLanguage: 'cpp',
 });
 assert.deepEqual(originalProblemSolution({referenceCode: 'print(1)', referenceLanguage: 'python\n```\ninjected'}), {
  body: '```python\nprint(1)\n```', programmingLanguage: 'python',
 });
});
