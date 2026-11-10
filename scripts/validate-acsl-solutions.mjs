// Maintenance-only verification: authored programs execute in go-judge, never in API/web.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { GoJudge } from '../packages/domain/judge.mjs';
import { normalizeSchoolProblem } from '../packages/domain/src/school-practice.mjs';
import { validateAcslProgrammingSolution } from '../packages/domain/src/acsl-grading.mjs';

const root = new URL('../packages/domain/content/acsl/', import.meta.url);
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const files = ['sample.json', ...(await readdir(new URL('editions/', root), { recursive: true }))
  .filter(name => name.endsWith('/paper.json')).map(name => `editions/${name}`)];
const checks = (await Promise.all((await readdir(new URL('solution-checks/', root)))
  .filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(new URL(`solution-checks/${name}`, root), 'utf8'))))).flat();
const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL ?? process.env.GO_JUDGE_URL,
  token: process.env.GO_JUDGE_TEST_TOKEN ?? process.env.GO_JUDGE_TOKEN, environmentVersion: 'acsl-solutions-2026-11-11' });
const results = [];
for (const file of files.sort()) {
  const paper = JSON.parse(await readFile(new URL(file, root), 'utf8'));
  if (!paper.programming || option('--season') && paper.season !== option('--season') || option('--slug') && paper.slug !== option('--slug')) continue;
  const { solution, definition } = paper.programming;
  validateAcslProgrammingSolution(solution);
  const extra = checks.filter(item => item.slug === paper.slug);
  assert.ok(extra.length, `${paper.slug}: independent boundary checks are required`);
  for (const item of extra) assert.ok(typeof item.input === 'string' && typeof item.expected === 'string' && item.reason?.trim(), `${paper.slug}: invalid boundary case`);
  const version = normalizeSchoolProblem({ ...definition, referenceCode: solution.code });
  const groups = {};
  for (const [name, cases] of [['samples', version.samples], ['official', version.tests], ['boundary', extra]]) {
    const tests = cases.map(({ input, expected }, i) => ({ id: `${name}-${i + 1}`, input, expected,
      weight: (Math.floor(1000000 / cases.length) + (i < 1000000 % cases.length ? 1 : 0)) / 10000 }));
    const result = await judge.judge({ kind: 'submit', language: solution.language, version, code: solution.code, tests });
    groups[name] = { status: result.status, passed: result.passed, total: result.total,
      ...(result.status !== 'AC' ? { details: result.privateResults, message: result.publicMessage } : {}) };
    console.log(`${paper.slug} ${name}: ${result.status} ${result.passed}/${result.total}`);
  }
  results.push({ slug: paper.slug, codeSha256: createHash('sha256').update(solution.code).digest('hex'), groups });
}
assert.ok(results.length, 'No matching programming papers');
const report = { checkedAt: new Date().toISOString(), executor: 'isolated go-judge', problems: results.length,
  cases: results.reduce((sum, row) => sum + Object.values(row.groups).reduce((n, group) => n + group.total, 0), 0),
  passed: results.every(row => Object.values(row.groups).every(group => group.status === 'AC')), results };
if (option('--report')) await writeFile(option('--report'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ problems: report.problems, cases: report.cases, passed: report.passed }));
if (!report.passed) process.exitCode = 1;
