import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { field } from '../../../packages/domain/src/security.mjs';
import { paper4OriginalPaperKey, parsePaper4OriginalManifest, paper4OriginalStagePart, paper4OriginalSegments, paper4OriginalStatement } from '../src/components/paper4/paper4-original-question-model.ts';

const segment = (src, page = 2) => ({ src, width: 1260, height: 500, page });
const fixture = () => ({ version: 1, paperKey: '9618_s25_41', sourceSha256: 'a'.repeat(64), pdf: 'question-paper.pdf', questions: { Q1: { statementSha256: 'b'.repeat(64), stem: [segment('Q1-stem-0.webp')], parts: [{ key: 'a', label: '(a)', segments: [segment('Q1-a-0.webp')] }, { key: 'b', label: '(b)', segments: [segment('Q1-b-0.webp', 3)] }] } } });
const fingerprint = statement => createHash('sha256').update(statement, 'utf8').digest('hex');

test('all catalog question fingerprints agree with actual domain import normalization and the offline generator', () => {
  const root = new URL('../../../', import.meta.url);
  const catalog = JSON.parse(readFileSync(new URL('content/paper4-pastpapers/catalog.json', root), 'utf8'));
  const statements = catalog.papers.flatMap(paper => JSON.parse(readFileSync(new URL(`content/paper4-pastpapers/${paper.path}`, root), 'utf8')).questions.map(question => question.statement));
  assert.equal(catalog.papers.length, 32);
  assert.equal(statements.length, 96);
  // The failing 2026 source has a final newline removed by the API on import.
  assert.ok(statements.some(statement => statement.endsWith('\n')));
  const unicodeEdges = ['\ufeff', '\u00a0', '\u1680', '\u2000', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\u001c', '\u0085', '\u200b'];
  const samples = [...statements, ...unicodeEdges.map(edge => `${edge}Question\n    code()\n${edge}`)];
  const expected = samples.map(statement => {
    const stored = field(statement, 'statement', { min: 0, max: 100000 });
    assert.equal(paper4OriginalStatement(statement), stored);
    assert.equal(fingerprint(paper4OriginalStatement(stored)), fingerprint(paper4OriginalStatement(statement)));
    return fingerprint(stored);
  });
  // No PDF libraries or rendering are needed to exercise the generator's hash contract.
  const result = spawnSync('python3', ['-c', 'import json, runpy, sys; tool = runpy.run_path(sys.argv[1]); print(json.dumps([tool["statement_sha256"](s) for s in json.load(sys.stdin)]))', fileURLToPath(new URL('scripts/render-paper4-originals.py', root))], { input: JSON.stringify(samples), encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

test('statement matching tolerates only imported edge whitespace, retaining wording and internal layout', () => {
  const statement = 'Write a queue.\n\n    return value\n';
  const original = fingerprint(paper4OriginalStatement(statement));
  assert.equal(fingerprint(paper4OriginalStatement(`\ufeff \r\n${statement}\t`)), original);
  for (const changed of [statement.replace('queue', 'stack'), statement.replace('\n\n', '\n'), statement.replace('    return', '  return'), statement.replace('return value', 'return  value')]) {
    assert.notEqual(fingerprint(paper4OriginalStatement(changed)), original);
  }
});

test('original paper matching requires exact supported exam metadata and never guesses from a custom title', () => {
  assert.equal(paper4OriginalPaperKey({ examYear: 2025, examSession: 'summer', examVariant: 41 }), '9618_s25_41');
  assert.equal(paper4OriginalPaperKey({ examYear: 2021, examSession: 'autumn', examVariant: 43 }), '9618_w21_43');
  for (const value of [{ title: '9618 Paper 4 May/June 2025 Paper 41' }, { examYear: 2025, examSession: 'winter', examVariant: 41 }, { examYear: 2025, examSession: 'summer', examVariant: 44 }, { examYear: 1999, examSession: 'summer', examVariant: 41 }, { examYear: 2025.5, examSession: 'summer', examVariant: 41 }]) assert.equal(paper4OriginalPaperKey(value), null);
});

test('manifest accepts only bounded same-folder original PDF and WebP excerpts', () => {
  assert.deepEqual(parsePaper4OriginalManifest(fixture(), '9618_s25_41'), fixture());
  for (const invalid of ['https://evil.example/q.webp', '//evil.example/q.webp', '../q.webp', '/q.webp', 'q%2Fsecret.webp', 'q.svg', 'q.webp?download=1', 'q\\secret.webp', '..q.webp']) {
    const value = fixture(); value.questions.Q1.stem[0].src = invalid;
    assert.equal(parsePaper4OriginalManifest(value, '9618_s25_41'), null, invalid);
  }
  for (const invalid of ['https://evil.example/qp.pdf', '../qp.pdf', 'qp.html', 'qp.pdf#page=1']) {
    const value = fixture(); value.pdf = invalid;
    assert.equal(parsePaper4OriginalManifest(value, '9618_s25_41'), null, invalid);
  }
});

test('manifest fails closed on wrong versions, paper keys, hashes, dimensions and ambiguous parts', () => {
  const mutations = [value => { value.version = 2; }, value => { value.paperKey = '9618_w25_41'; }, value => { value.sourceSha256 = 'not-a-hash'; }, value => { value.questions.Q1.statementSha256 = 'x'.repeat(64); }, value => { value.questions.Q1.stem[0].width = 0; }, value => { value.questions.Q1.stem[0].height = 20001; }, value => { value.questions.Q1.stem[0].page = 0; }, value => { value.questions.Q1.parts.push(value.questions.Q1.parts[0]); }, value => { value.questions.Q1.parts[0].key = 'a(i)'; }, value => { value.questions.Q1.parts[0].label = '(i)'; }, value => { value.questions.Q1.parts[0].segments = []; }, value => { value.questions.Q1.stem = Array(65).fill(segment('q.webp')); }];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value);
    assert.equal(parsePaper4OriginalManifest(value, '9618_s25_41'), null);
  }
});

test('letter sections retain the stem and all Roman subparts of that letter', () => {
  const question = parsePaper4OriginalManifest(fixture(), '9618_s25_41').questions.Q1;
  assert.deepEqual(paper4OriginalSegments(question, 'a').map(item => item.src), ['Q1-stem-0.webp', 'Q1-a-0.webp']);
  assert.deepEqual(paper4OriginalSegments(question, 'full').map(item => item.src), ['Q1-stem-0.webp', 'Q1-a-0.webp', 'Q1-b-0.webp']);
  assert.deepEqual(paper4OriginalSegments(question, 'missing'), paper4OriginalSegments(question, 'full'));
  assert.equal(paper4OriginalStagePart('1(a) Queue state'), 'a');
  assert.equal(paper4OriginalStagePart('1(b)(iii) Output'), 'b');
  assert.equal(paper4OriginalStagePart('Q3(c)(ii) Test evidence'), 'c');
  assert.equal(paper4OriginalStagePart('Run all stages'), null);
});
