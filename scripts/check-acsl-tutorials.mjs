// Validate authored course documents without connecting to a database or executing code.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown, serializeLearningMarkdown } from '../apps/web/src/components/teacher/learning-document.ts';
import { validateLearningDocument } from '../packages/domain/src/learning-document.mjs';

const root = new URL('../content/acsl-tutorials/', import.meta.url);
const katex = createRequire(new URL('../apps/web/package.json', import.meta.url))('katex');
const json = async url => JSON.parse(await readFile(url, 'utf8'));

export async function readAcslTutorial(language) {
  assert.ok(['en', 'zh'].includes(language), 'Tutorial language must be en or zh');
  const manifest = await json(new URL('curriculum.json', root));
  const unit = manifest.units.find(unit => unit.id === 'number-systems');
  const document = parseLearningMarkdown(await readFile(new URL(unit.documents[language], root), 'utf8'));
  validateLearningDocument(document);
  return document;
}

function integer(digits, base) {
  assert.ok(Number.isInteger(base) && base >= 2 && base <= 16);
  assert.match(digits, /^[0-9A-F]+$/);
  return [...digits].reduce((value, digit) => {
    const n = '0123456789ABCDEF'.indexOf(digit);
    assert.ok(n < base, `${digits}: invalid digit in base ${base}`);
    return value * BigInt(base) + BigInt(n);
  }, 0n);
}

export async function checkAcslTutorials() {
  const manifest = await json(new URL('curriculum.json', root));
  assert.equal(manifest.format, 'codemaster-acsl-curriculum');
  assert.equal(manifest.division, 'Intermediate');
  assert.equal(manifest.units.length, 12);
  assert.equal(new Set(manifest.units.map(unit => unit.id)).size, 12);
  const editions = new URL('../packages/domain/content/acsl/editions/', import.meta.url);
  const files = (await readdir(editions, { recursive: true })).filter(name => /\/intermediate\/contest-\d\/paper\.json$/.test(name));
  const papers = new Map(await Promise.all(files.map(async name => {
    const paper = await json(new URL(name, editions));
    return [paper.slug, paper];
  })));
  const referenced = new Set();
  for (const unit of manifest.units) {
    for (const ref of unit.practiceReferences) {
      assert.deepEqual(Object.keys(ref).sort(), ['paperSlug', 'questionId']);
      const paper = papers.get(ref.paperSlug);
      assert.ok(paper, ref.paperSlug);
      assert.equal(paper.round, unit.round);
      const question = paper.questions.find(question => question.id === ref.questionId);
      assert.ok(question && unit.sourceTopics.includes(question.topic.en), `${unit.id}/${ref.questionId}`);
      const key = `${paper.slug}/${question.id}`;
      assert.ok(!referenced.has(key), `Repeated practice reference: ${key}`);
      referenced.add(key);
    }
  }
  assert.equal(referenced.size, [...papers.values()].reduce((n, paper) => n + paper.questions.length, 0));
  const documents = await Promise.all(['en', 'zh'].map(readAcslTutorial));
  let formulas = 0;
  for (const doc of documents) {
    assert.equal(doc.chapters.length, 4);
    assert.deepEqual(parseLearningMarkdown(serializeLearningMarkdown(doc)), doc, 'Course Markdown must round-trip losslessly');
    for (const chapter of doc.chapters) {
      assert.deepEqual(chapter.problemIds, [], 'ACSL question IDs cannot be ordinary problem references');
      assert.ok(!chapter.paper4Links?.length);
      const questionNumbers = [...chapter.checkpoint.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1]));
      const answerNumbers = [...chapter.checkpointAnswer.matchAll(/^\*\*(\d+)\.\*\* /gm)].map(match => Number(match[1]));
      assert.ok(questionNumbers.length > 0, `${chapter.title}: numbered checkpoints are required`);
      assert.deepEqual(questionNumbers, questionNumbers.map((_, index) => index + 1));
      assert.deepEqual(answerNumbers, questionNumbers, `${chapter.title}: fixed answer labels must match checkpoints across display formulas`);
      for (const field of ['objective', 'content', 'checkpoint', 'checkpointAnswer']) {
        const text = chapter[field];
        assert.ok(text.trim(), `${chapter.title}: ${field} is missing`);
        assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|!\[.*?\]\(|<img\b|correctOptionIds|\/api\/|\/assets\//);
        for (const match of text.matchAll(/\$\$([\s\S]*?)\$\$|\$([^\n$]+)\$/g)) {
          katex.renderToString(match[1] ?? match[2], { throwOnError: true, strict: 'ignore' });
          formulas++;
        }
      }
    }
    assert.ok(doc.chapters.some(chapter => chapter.content.includes('\\begin{array}') && chapter.content.includes('\\hline')), 'A worked vertical calculation is required');
  }
  const arithmetic = await json(new URL('intermediate/number-systems/arithmetic-checks.json', root));
  assert.equal(arithmetic.version, 1);
  assert.ok(arithmetic.cases.length > 0);
  assert.equal(new Set(arithmetic.cases.map(item => item.id)).size, arithmetic.cases.length);
  for (const item of arithmetic.cases) {
    if (item.kind === 'convert') {
      assert.equal(integer(item.input, item.fromBase), integer(item.expected, item.toBase), item.id);
    } else {
      assert.ok(['add', 'subtract'].includes(item.kind), item.id);
      assert.ok(item.operands.length >= 2);
      if (item.kind === 'subtract') assert.equal(item.operands.length, 2);
      const values = item.operands.map(value => integer(value, item.base));
      assert.equal(item.kind === 'add' ? values.reduce((sum, n) => sum + n, 0n) : values[0] - values[1], integer(item.expected, item.base), item.id);
      if (item.carries) {
        assert.equal(item.kind, 'add');
        const width = Math.max(...item.operands.map(value => value.length));
        const digits = item.operands.map(value => value.padStart(width, '0'));
        let carry = 0;
        const carries = [];
        for (let column = width - 1; column >= 0; column--) {
          carry = Math.floor((digits.reduce((sum, value) => sum + Number(integer(value[column], item.base)), 0) + carry) / item.base);
          carries.push(carry);
        }
        assert.deepEqual(carries, item.carries, `${item.id}: outgoing carries, units column first`);
      }
    }
  }
  return { units: manifest.units.length, practiceReferences: referenced.size, documents: documents.length,
    lessonsPerLanguage: documents[0].chapters.length, formulas, arithmeticCases: arithmetic.cases.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkAcslTutorials(), null, 2));
}
