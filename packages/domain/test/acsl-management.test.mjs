import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { canonicalHash } from '../src/security.mjs';
import { acslExportDocument, mergeAcslManagementEdit } from '../src/acsl-management.mjs';

const sample = JSON.parse(await readFile(new URL('../content/acsl/sample.json', import.meta.url), 'utf8'));
const request = () => ({ expectedContentHash: canonicalHash(sample), requestId: randomUUID(), reason: 'Reviewed content edit' });

test('management patches existing field IDs, keeps grading programs immutable, and exports purpose-specific documents', () => {
  const edited = mergeAcslManagementEdit(sample, { ...request(), questions: [{ id: 'q1', correctOptionIds: ['A'],
    options: [{ id: 'A', text: { en: 'Revised option', zh: '修订选项' } }] }] });
  assert.deepEqual(edited.questions[0].correctOptionIds, ['A']);
  assert.deepEqual(edited.questions.map(q => [q.id,q.type,q.number,q.options.map(o => o.id)]), sample.questions.map(q => [q.id,q.type,q.number,q.options.map(o => o.id)]));
  assert.deepEqual(edited.programming, sample.programming);
  for (const patch of [ { versionId: randomUUID() }, { questions: [{ id: 'q1', number: 9 }] }, { questions: [{ id: 'q1' }, { id: 'q1' }] },
    { programming: { tests: [] } }, { programming: { referenceCode: 'print(1)' } } ]) {
    assert.throws(() => mergeAcslManagementEdit(sample, { ...request(), ...patch }));
  }
  const exported = acslExportDocument(edited, 'questions', 'zh');
  assert.equal(exported.questions[0].options[0].text, '修订选项');
  assert.doesNotMatch(JSON.stringify(exported), /correctOptionIds|explanation|solutionPages|referenceCode|"tests"/);
  assert.deepEqual(acslExportDocument(edited, 'answers', 'en').questions[0].correctOptionIds, ['A']);
  assert.deepEqual(acslExportDocument(edited, 'package', 'en'), edited);
});

test('the SQL edit boundary accepts every shipped native drawing and rejects executable or malformed geometry', { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async () => {
  const base = new URL(process.env.TEST_DATABASE_URL); assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const schema = `acsl_diagrams_${randomBytes(5).toString('hex')}`, manager = createPool(base.href);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`); const pool = createPool(scoped.href);
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const files = [];
    const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) await walk(child); else if (entry.name === 'paper.json') files.push(child);
    } };
    await walk(new URL('../content/acsl/editions/', import.meta.url));
    const papers = [sample, ...await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8'))))];
    assert.equal(papers.length, 96);
    let count = 0;
    for (const paper of papers) {
      const drawings = paper.questions.flatMap(q => [q.statementDiagrams, q.explanationDiagrams, ...q.options.map(o => o.diagrams)]);
      drawings.push(paper.programming?.statementDiagrams);
      const values = drawings.filter(Boolean); count += values.length;
      const checks = (await pool.query('SELECT ordinal,acsl_edit_diagrams(value) valid FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY items(value,ordinal)', [JSON.stringify(values)])).rows;
      assert.ok(checks.every(row => row.valid), `${paper.slug}: ${JSON.stringify(checks.filter(row => !row.valid))}`);
    }
    assert.ok(count > 200, 'the shipped corpus includes substantial native geometry');
    const diagram = element => ({ en: [{ id: 'test', width: 100, height: 100, alt: { en: 'Test figure', zh: '测试图' }, elements: [element] }], zh: [] });
    for (const element of [ { type: 'path', d: 'M0' }, { type: 'path', d: 'M0 0 C1 1 2 2' }, { type: 'path', d: 'M0 0 L99999 0' },
      { type: 'path', d: 'M0 0 H10' }, { type: 'path', d: 'M0 0', onload: 'alert(1)' }, { type: 'foreignObject', text: '<script/>' },
      { type: 'circle', cx: 2, cy: 2, r: 1, fill: 'url(https://example.test)' }, { type: 'text', x: 2, y: 2, text: 'x', font: null } ]) {
      assert.equal((await pool.query('SELECT acsl_edit_diagrams($1::jsonb) valid', [JSON.stringify(diagram(element))])).rows[0].valid, false);
    }
  } finally {
    await pool.end(); await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
