import test from 'node:test';
import assert from 'node:assert/strict';
import { originalProblemSolution } from '../src/problem-solution-bundles.mjs';

test('original solution combines editorial and reference code without changing the source', () => {
 const source = {editorial: '  Explain the algorithm.\n', referenceCode: '  print(1)\n', referenceLanguage: 'python'};
 const before = structuredClone(source);
 assert.deepEqual(originalProblemSolution(source), {body: 'Explain the algorithm.\n\n```python\n  print(1)\n```'});
 assert.deepEqual(source, before);
 assert.deepEqual(originalProblemSolution({editorial: 'Explanation only'}), {body: 'Explanation only'});
 assert.equal(originalProblemSolution({editorial: ' \n', referenceCode: '\n\t'}), undefined);
 assert.equal(originalProblemSolution(), undefined);
});

test('reference source cannot close its Markdown fence or inject a language header', () => {
 const code = 'const value = `template`;\n```\n# still code\n````';
 assert.deepEqual(originalProblemSolution({referenceCode: code, referenceLanguage: 'javascript'}), {
  body: '`````javascript\n' + code + '\n`````',
 });
 assert.deepEqual(originalProblemSolution({referenceCode: 'int main() {}', referenceLanguage: 'cpp'}), {
  body: '```cpp\nint main() {}\n```',
 });
 assert.deepEqual(originalProblemSolution({referenceCode: 'print(1)', referenceLanguage: 'python\n```\ninjected'}), {
  body: '```python\nprint(1)\n```',
 });
});
