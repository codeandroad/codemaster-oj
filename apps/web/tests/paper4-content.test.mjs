import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentBlocks, inlineTokens } from '../src/components/content-parser.ts';
import { formatPaper4Statement } from '../src/components/paper4/paper4-content-format.ts';

test('Paper 4 keeps authored Markdown structure and inline formatting', () => {
  const source = '## Task\n\nUse **Queue** and `Enqueue()`:\n\n1. Initialise state\n2. Print the result\n\n```python\nprint("done")\n```';
  assert.equal(formatPaper4Statement(source), source);
  const blocks = contentBlocks(source);
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'paragraph', 'list', 'code']);
  assert.equal(blocks[0].level, 2);
  assert.deepEqual(inlineTokens(blocks[1].text).filter(token => token.kind !== 'text').map(token => token.kind), ['strong', 'code']);
  assert.equal(blocks[3].text, 'print("done")');
});

test('long single-line imported statements gain paragraph breaks without losing sentences', () => {
  const source = 'Declare a global array with twenty positions and initialise every element before the program starts. Write Enqueue(InputData) so it stores a new integer if the queue has room and returns True. In the main program, call Enqueue for every integer from one to twenty-five in ascending order. Print one line for each attempt, showing whether that value was stored successfully. Write Dequeue() so it removes the next value or returns minus one when the queue is empty. Extend the main program to call Dequeue twice and print the returned values.';
  const formatted = formatPaper4Statement(source);
  assert.ok(formatted.includes('\n\n'));
  assert.ok(contentBlocks(formatted).length >= 2);
  assert.equal(formatted.replace(/\s+/g, ' ').trim(), source);
});

test('short plain text and multiline material are left unchanged', () => {
  assert.equal(formatPaper4Statement('Write a program.'), 'Write a program.');
  const lines = 'Input:\nTheData.txt\n\nOutput:\nRed.txt';
  assert.equal(formatPaper4Statement(lines), lines);
});

test('untrusted HTML and Markdown links remain text, never executable markup', () => {
  const source = 'Read <img src=x onerror=alert(1)> and [help](javascript:alert(1)).';
  const block = contentBlocks(formatPaper4Statement(source))[0];
  assert.equal(block.kind, 'paragraph');
  assert.deepEqual(inlineTokens(block.text), [{ kind: 'text', text: source }]);
});
