import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { validatePaperDefinition } from '../src/acsl-grading.mjs';
import { acslGradingContract } from '../src/acsl-presentation.mjs';

// KaTeX remains owned by the web application; this is a content publishing check.
const katex = createRequire(new URL('../../../apps/web/package.json', import.meta.url))('katex');
const directory = new URL('../content/acsl/', import.meta.url);
const files = ['sample.json', ...readdirSync(new URL('editions/', directory), { recursive: true })
  .filter(name => name.endsWith('/paper.json')).map(name => `editions/${name}`)];
const papers = files.map(file => JSON.parse(readFileSync(new URL(file, directory), 'utf8')));
const fingerprints = JSON.parse(readFileSync(new URL('fixtures/acsl-grading-contracts.json', import.meta.url), 'utf8'));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

test('the native ACSL collection has every season/division/round and retains its reviewed grading data', () => {
  assert.equal(papers.length, 96);
  assert.equal(new Set(papers.map(p => p.slug)).size, 96);
  assert.equal(papers.reduce((sum, p) => sum + p.questions.length, 0), 512);
  assert.equal(papers.filter(p => p.programming).length, 72);
  assert.deepEqual(papers.map(p => p.slug).sort(), Object.keys(fingerprints).sort());
  for (let year = 2020; year <= 2025; year++) for (const division of ['Elementary', 'Junior', 'Intermediate', 'Senior']) {
    const group = papers.filter(p => p.season === `${year}-${year + 1}` && p.division === division);
    assert.deepEqual(group.map(p => p.round).sort(), [1, 2, 3, 4], `${year} ${division}`);
    for (const paper of group) {
      validatePaperDefinition(paper);
      assert.equal(Boolean(paper.programming), division !== 'Elementary', paper.slug);
      const digest = createHash('sha256').update(JSON.stringify(stable(acslGradingContract(paper)))).digest('hex');
      assert.equal(digest, fingerprints[paper.slug], `${paper.slug}: answer keys, option IDs/order and official judge cases must not change during presentation repair`);
    }
  }
});

test('every written and programming presentation is native, has valid math and resolves its own diagrams', () => {
  let mathCount = 0;
  const check = (text, diagrams, label) => {
    assert.ok(text.trim(), label);
    // TeX escapes must never turn into control characters during transcription.
    assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, `${label}: unexpected control character`);
    assert.doesNotMatch(text, /!\[[^\]]*\]\(|<img\b|data:image\/|\/acsl\/[^\s]*\/assets\/|\{\{embedded:|Read the original question|Open original page|The official English explanation is reproduced below|下方为原卷配套的官方英文解析/i, label);
    const ids = new Set((diagrams ?? []).map(diagram => diagram.id));
    for (const match of text.matchAll(/\{\{diagram:([^}]+)\}\}/g)) assert.ok(ids.has(match[1]), `${label}: unresolved diagram ${match[1]}`);
    const prose = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`|\\\$/g, '');
    assert.doesNotMatch(prose, /\t/, `${label}: unexpected tab outside code`);
    for (const match of prose.matchAll(/\$\$([\s\S]*?)\$\$|\$([^\n$]+)\$/g)) {
      mathCount++;
      assert.doesNotThrow(() => katex.renderToString(match[1] ?? match[2], { throwOnError: true, strict: 'ignore' }), label);
    }
  };
  for (const paper of papers) {
    assert.equal((paper.assets ?? []).length, 0, paper.slug);
    for (const question of paper.questions) {
      assert.equal(question.statementAssets, undefined, paper.slug);
      assert.equal(question.explanationAssets, undefined, paper.slug);
      for (const language of ['en', 'zh']) {
        const label = `${paper.slug}/${question.id}/${language}`;
        check(question.statement[language], question.statementDiagrams?.[language], `${label}/statement`);
        check(question.explanation[language], question.explanationDiagrams?.[language], `${label}/explanation`);
        for (const option of question.options) {
          assert.doesNotMatch(option.text[language], /^Option [A-E]$/, `${label}/${option.id}`);
          check(option.text[language], option.diagrams?.[language], `${label}/${option.id}`);
        }
      }
    }
    if (paper.programming) {
      assert.equal(paper.programming.statementAssets, undefined, paper.slug);
      check(paper.programming.definition.statement, paper.programming.statementDiagrams?.en, `${paper.slug}/programming/en`);
      check(paper.programming.statementZh, paper.programming.statementDiagrams?.zh, `${paper.slug}/programming/zh`);
    }
  }
  assert.ok(mathCount > 100, 'the complete collection retains its mathematical expressions as native KaTeX');
});
