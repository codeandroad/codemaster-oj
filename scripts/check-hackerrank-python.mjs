import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.CAMPUS_CONTENT_ROOT ?? resolve('content/hackerrank-python');
const problems = JSON.parse(await readFile(resolve(root, 'problems.json'), 'utf8'));
const coverage = JSON.parse(await readFile(resolve(root, 'coverage.json'), 'utf8'));
assert.equal(problems.length, 115);
assert.equal(coverage.items.length, 115);
assert.equal(new Set(problems.map(p => p.sourceId)).size, 115);
assert.equal(new Set(problems.map(p => p.title)).size, 115);
for (const [index, p] of problems.entries()) {
  const mapping = coverage.items[index];
  assert.equal(p.sourceId, mapping.sourceId);
  assert.equal(p.sourceSlug, mapping.slug);
  assert.equal(p.courseKey, mapping.courseKey);
  assert.equal(p.chapterNumber, mapping.chapterNumber);
  assert.ok(p.source.includes(mapping.sourceUrl));
  assert.ok(p.statement.includes('independently authored'));
  assert.equal(p.samples.length, 2);
  assert.equal(p.tests.length, 5);
  assert.equal(p.tests.reduce((s, t) => s + t.weight, 0), 100);
  assert.ok(new Set(p.tests.map(t => t.expected)).size > 1, p.title + ' needs discriminating cases');
  for (const c of [...p.samples, ...p.tests]) {
    assert.equal(typeof c.input, 'string');
    assert.equal(typeof c.expected, 'string');
    if (p.mode === 'function') {
      assert.equal(JSON.parse(c.input).length, 1);
      JSON.parse(c.expected);
    }
  }
}
console.log('PASS: 115 unique mappings, 17 chapters, 805 independent fixtures, complete draft metadata.');
if (!process.argv.includes('--judge')) {
  console.log('SKIPPED: real sandbox validation (run --judge with GO_JUDGE_TEST_URL/TOKEN).');
  process.exit(0);
}
assert.ok(process.env.GO_JUDGE_TEST_URL && process.env.GO_JUDGE_TEST_TOKEN, 'Real executor configuration required');
const domain = process.env.CAMPUS_DOMAIN_ROOT ?? resolve('packages/domain');
const { GoJudge } = await import(pathToFileURL(resolve(domain, 'judge.mjs')));
const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN,
  environmentVersion: 'numpy2.2.6-course-validation' });
console.log('Runtime:', await judge.ready());
const failures = [];
let mutations = 0;
for (const p of problems) {
  const version = { mode: p.mode, comparator: p.comparator, function_name: p.functionName,
    time_limit_ms: p.timeLimitMs, memory_limit_mb: p.memoryLimitMb };
  const cases = [...p.samples.map(c => ({ ...c, weight: 10 })), ...p.tests.map(c => ({ ...c, weight: 16 }))];
  const result = await judge.judge({ version, code: p.referenceCode, tests: cases, kind: 'validation' });
  if (result.status !== 'AC') failures.push({ title: p.title, status: result.status, results: result.privateResults, message: result.publicMessage });
  // A solution which only repeats the first visible sample must fail formal cases.
  const code = p.mode === 'function'
    ? `import json\ndef solve(data): return json.loads(${JSON.stringify(p.samples[0].expected)})`
    : `print(${JSON.stringify(p.samples[0].expected)}, end='')`;
  const mutant = await judge.judge({ version, code, tests: p.tests, kind: 'submit' });
  if (mutant.status === 'AC') failures.push({ title: p.title, error: 'sample-only mutant accepted' });
  else mutations++;
  console.log(`${result.status} ${p.courseKey} ${p.title}`);
}
console.log(JSON.stringify({ references: problems.length, cases: 805, rejectedSampleOnlyMutants: mutations, failures }, null, 2));
assert.equal(failures.length, 0, 'Review failed fixtures/references before import');
