import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paper4ExportBytes, paper4ExportFilename } from '../src/components/paper4/paper4-export.ts';

test('Paper 4 export bytes retain non-ASCII UTF-8 JSON for reimport', () => {
  const packageJson = JSON.stringify({ format: 'codemaster-paper4', version: 1, title: '编程实践', questions: [] });
  const base64 = Buffer.from(packageJson, 'utf8').toString('base64');
  assert.equal(new TextDecoder().decode(paper4ExportBytes(base64)), packageJson);
});

test('export filenames cannot escape the download directory', () => {
  assert.equal(paper4ExportFilename('../../Q1:answer.json'), '-..-Q1-answer.json');
  assert.equal(paper4ExportFilename('.json'), 'paper4-export.json');
  assert.equal(paper4ExportFilename('Paper 4.json'), 'Paper 4.json');
});
