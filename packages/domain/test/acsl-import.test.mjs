import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAcslPackage, readAcslPackage } from '../src/acsl-import.mjs';

const sample = JSON.parse(await readFile(new URL('../content/acsl/sample.json', import.meta.url), 'utf8'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=', 'base64');
const hash = createHash('sha256').update(png).digest('hex');
function fixture() {
  const content = structuredClone(sample);
  content.division = 'Elementary'; content.programming = null;
  content.assets = [{ id: 'q1-statement', path: 'source.png', sha256: hash, mimeType: 'image/png', width: 1, height: 1,
    source: { path: 'test.pdf', sha256: '0'.repeat(64), page: 1, bbox: [0, 0, 1, 1] } }];
  content.questions[0].statementAssets = { en: ['q1-statement'], zh: [] };
  return { content, assets: [{ id: 'q1-statement', content: png }] };
}

test('written-only editions and official coding cases do not invent a reference solution', () => {
  assert.equal(prepareAcslPackage(fixture()).definition, null);
  const content = structuredClone(sample);
  delete content.programming.definition.referenceCode;
  assert.throws(() => prepareAcslPackage({ content }), /provenance/);
  content.programming.testProvenance = 'official';
  const prepared = prepareAcslPackage({ content });
  assert.equal(Object.hasOwn(prepared.definition, 'reference_code'), false);
  assert.equal(prepared.definition.tests.length, 6);
  content.programming.definition.tests[0].weight = 99;
  assert.throws(() => prepareAcslPackage({ content }));
});

test('source assets reject corruption, missing bytes, unknown IDs and solution aliasing', () => {
  assert.equal(prepareAcslPackage(fixture()).assets[0].purpose, 'statement');
  for (const mutate of [
    item => { item.assets = []; },
    item => { item.content.assets[0].sha256 = '1'.repeat(64); },
    item => { item.content.assets[0].width = 2; },
    item => { item.assets[0].content = Buffer.from('This is not a PNG image.'); },
    item => { item.content.questions[0].statementAssets.en = ['missing']; },
    item => { item.content.questions[0].explanationAssets = { en: ['q1-statement'], zh: [] }; },
    item => { item.content.assets.push({ ...item.content.assets[0], id: 'solution' }); item.assets.push({ id: 'solution', content: png }); item.content.questions[0].explanationAssets = { en: ['solution'], zh: [] }; },
    item => { item.content.assets[0].path = '../outside.png'; },
  ]) {
    const item = fixture(); mutate(item);
    assert.throws(() => prepareAcslPackage(item), undefined, mutate.toString());
  }
});

test('package reader hashes local PNGs and rejects symlink escapes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'acsl-source-'));
  const outside = await mkdtemp(join(tmpdir(), 'acsl-outside-'));
  try {
    const { content } = fixture(), filename = join(directory, 'paper.json');
    await writeFile(filename, JSON.stringify(content)); await writeFile(join(directory, 'source.png'), png);
    assert.deepEqual((await readAcslPackage(filename)).assets[0].content, png);
    await rm(join(directory, 'source.png')); await writeFile(join(outside, 'source.png'), png);
    await symlink(join(outside, 'source.png'), join(directory, 'source.png'));
    await assert.rejects(readAcslPackage(filename), /inside their package directory/);
  } finally { await rm(directory, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
