import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePaper4Import } from '../src/paper4-import.mjs';

const sample = new URL('../../../examples/paper4-english-practice/', import.meta.url);
const packageBody = (filename, buffer) => ({ filename, contentBase64: buffer.toString('base64') });
const errorCode = code => error => error?.code === code && error?.status === 400;

test('self-contained JSON and ZIP preview the same original three-question paper', async () => {
  const json = await readFile(new URL('paper4-english-practice.json', sample));
  const zip = await readFile(new URL('paper4-english-practice.zip', sample));
  const fromJson = parsePaper4Import(packageBody('practice.json', json));
  const fromZip = parsePaper4Import(packageBody('practice.zip', zip));
  assert.deepEqual(fromZip, fromJson);
  assert.equal(fromJson.preview.questionCount, 3);
  assert.equal(fromJson.preview.totalMarks, 75);
  assert.equal(fromJson.preview.caseCount, 13);
  assert.equal(fromJson.preview.referenceSolutionCount, 3);
  assert.deepEqual(fromJson.createBody.questions.map(question => question.key), ['Q1', 'Q2', 'Q3']);
  assert.equal(fromJson.createBody.questions[1].initialFiles['TheData.txt'].trim().split('\n').length, 72);
  assert.equal(fromJson.createBody.runnerCases.Q3_insert[0].driverCode.includes('/w/main.py'), true);
});

test('the importer rejects raw source archives, unsafe paths, corrupt files and large claims', async () => {
  const zip = await readFile(new URL('paper4-english-practice.zip', sample));
  const json = await readFile(new URL('paper4-english-practice.json', sample));
  assert.throws(() => parsePaper4Import(packageBody('source.zip', Buffer.from('not a zip'))), errorCode('PAPER4_IMPORT'));
  assert.throws(() => parsePaper4Import(packageBody('paper.pdf', json)), errorCode('PAPER4_IMPORT'));
  assert.throws(() => parsePaper4Import({ filename: 'paper.json', contentBase64: '@@@@' }), errorCode('PAPER4_IMPORT'));
  const traversal = Buffer.from(zip);
  let position = 0;
  while ((position = traversal.indexOf('manifest.json', position)) >= 0) {
    traversal.write('../secret.txt', position, 'ascii');
    position += 13;
  }
  assert.throws(() => parsePaper4Import(packageBody('traversal.zip', traversal)), errorCode('PAPER4_IMPORT'));
  const corrupt = Buffer.from(zip);
  const center = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(center > 0);
  corrupt.writeUInt32LE(3 * 1024 * 1024, center + 24);
  assert.throws(() => parsePaper4Import(packageBody('bomb.zip', corrupt)), errorCode('PAPER4_IMPORT'));
});

test('JSON cannot smuggle references or extra fields into a draft', async () => {
  const json = JSON.parse(await readFile(new URL('paper4-english-practice.json', sample), 'utf8'));
  json.questions[0].statement = { file: 'assets/secret.md' };
  assert.throws(() => parsePaper4Import(packageBody('refs.json', Buffer.from(JSON.stringify(json)))), errorCode('PAPER4_IMPORT'));
  json.questions[0].statement = 'Original text';
  json.questions[0].unexpected = true;
  assert.throws(() => parsePaper4Import(packageBody('extra.json', Buffer.from(JSON.stringify(json)))), errorCode('PAPER4_IMPORT'));
});
