import test from 'node:test';
import assert from 'node:assert/strict';
import { includesOriginalSolution } from '../src/components/scholarship/solution-source.ts';

test('reference import stays available when an existing code block lacks the original explanation', () => {
 const code = '```python\nprint(1)\n```';
 for (const explanation of ['- Keep both records.\n- Sort names.', '| Value | Meaning |\n| --- | --- |\n| 1 | Smallest |']) {
  const source = {body: explanation + '\n\n' + code};
  assert.equal(includesOriginalSolution([{body: code}], source), false);
  assert.equal(includesOriginalSolution([{body: '# Extra context\n\n' + source.body}], source), true);
 }
});

test('reference import recognizes complete fenced code despite fence length and line endings', () => {
 assert.equal(includesOriginalSolution([{body: '## Reference\n\n````python\r\nprint(1)\r\n````'}], {body:'```python\nprint(1)\n```'}), true);
 assert.equal(includesOriginalSolution([{body: '```python\nprint(10)\n```'}], {body:'```python\nprint(1)\n```'}), false);
 assert.equal(includesOriginalSolution([{body: 'anything'}], {body:' '}), false);
});
