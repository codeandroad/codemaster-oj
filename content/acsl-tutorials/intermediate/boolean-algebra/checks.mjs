// Trusted calculations for original lessons. Never evaluate document or learner code.
// Notation source: https://www.categories.acsl.org/wiki/index.php?title=Boolean_Algebra
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';

const here = new URL('./', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
const inputs = Array.from({ length: 8 }, (_, value) => [(value >> 2) & 1, (value >> 1) & 1, value & 1]);
const pairs = [[0, 0], [0, 1], [1, 0], [1, 1]];
const and = (...values) => Number(values.every(value => value === 1));
const or = (...values) => Number(values.some(value => value === 1));
const not = value => 1 - value;
const xor = (a, b) => Number(a !== b);
const satisfying = expression => inputs.filter(input => expression(...input) === 1);
const matches = (input, pattern) => input.every((value, i) => pattern[i] === '*' || value === Number(pattern[i]));
const tables = text => [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(match => match[0].trim().split('\n').slice(2)
  .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim())));
const tuple = input => '`(' + input.join(',') + ')`';

// Boolean predicates and bitwise integer formulas are separately written. Their
// agreement checks all three-variable inputs, including the zero/one boundaries.
const expressions = {
  F: [(p, q, r) => and(or(p, not(q)), r), (p, q, r) => (p | (q ^ 1)) & r],
  G: [(p, q, r) => or(and(p, not(q)), and(q, r)), (p, q, r) => (p & (q ^ 1)) | (q & r)],
  H: [(p, q) => xor(p, q), (p, q) => p ^ q],
  K: [(p, q, r) => not(or(not(p), and(q, not(r)))), (p, q, r) => ((p ^ 1) | (q & (r ^ 1))) ^ 1],
  E: [(p, q) => or(and(p, not(q)), and(p, q), and(not(p), q)), (p, q) => (p & (q ^ 1)) | (p & q) | ((p ^ 1) & q)],
  M: [(p, q, r) => or(and(not(p), q), and(p, r)), (p, q, r) => ((p ^ 1) & q) | (p & r)],
  N: [(p, q, r) => or(and(p, q), and(q, r), and(r, p)), (p, q, r) => (p & q) | (q & r) | (r & p)],
  S: [(p, q, r) => and(or(p, not(q)), not(r)), (p, q, r) => (p | (q ^ 1)) & (r ^ 1)],
  J: [(p, q) => or(p, not(q)), (p, q) => p | (q ^ 1)],
  U: [(p, q, r) => and(or(p, q), or(not(p), r)), (p, q, r) => (p | q) & ((p ^ 1) | r)],
  V: [(p, q, r) => or(and(p, r), and(not(p), q)), (p, q, r) => (p & r) | ((p ^ 1) & q)],
  W: [(p, q, r) => or(p, and(q, r)), (p, q, r) => p | (q & r)],
  complementScope: [(p, q, r) => and(not(or(p, q)), r), (p, q, r) => ((p | q) ^ 1) & r],
  firstCheckpoint: [(p, q, r) => or(not(p), and(q, r)), (p, q, r) => (p ^ 1) | (q & r)],
  groupedOr: [(p, q, r) => and(or(p, q), r), (p, q, r) => (p | q) & r],
  nestedComplement: [(p, q, r) => not(or(p, and(not(q), r))), (p, q, r) => (p | ((q ^ 1) & r)) ^ 1],
  distribution: [(p, q) => and(or(p, q), or(p, not(q))), (p, q) => (p | q) & (p | (q ^ 1))],
  factoredComplement: [(p, q, r) => or(and(q, or(p, r)), and(q, not(p), not(r))), (p, q, r) => (q & (p | r)) | (q & (p ^ 1) & (r ^ 1))],
  correctedDeMorgan: [(p, q, r) => not(or(and(p, q), r)), (p, q, r) => ((p & q) | r) ^ 1],
  wrongDeMorgan: [(p, q, r) => or(and(not(p), not(q)), not(r)), (p, q, r) => ((p ^ 1) & (q ^ 1)) | (r ^ 1)]
};
const expression = name => expressions[name][0];

export async function checkTutorial() {
  const documents = await Promise.all(['en', 'zh'].map(async language => ({ language,
    document: parseLearningMarkdown(await readFile(new URL(`course.${language}.md`, here), 'utf8')) })));
  let cases = 0, modelComparisons = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const contains = (chapter, field, anchor) => {
    for (const { language, document } of documents)
      assert.ok(document.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: missing calculated anchor ${anchor}`);
    cases++;
  };
  const anchors = (chapter, field, values) => values.forEach(value => contains(chapter, field, value));
  const table = (chapter, field, index, expected) => {
    for (const { language, document } of documents)
      assert.deepEqual(tables(document.chapters[chapter][field])[index], expected.map(row => row.map(String)), `${language}/${chapter + 1}/${field}: displayed table ${index}`);
    cases++;
  };
  const chain = (label, functions) => {
    for (const input of inputs) {
      const result = functions[0](...input);
      for (const fn of functions.slice(1)) { assert.equal(fn(...input), result, `${label}: ${input}`); modelComparisons++; }
    }
    cases++;
  };
  const displayedSolutions = (chapter, field, name, expected) => {
    equal(name + ' complete satisfying input list', satisfying(expression(name)), expected);
    expected.forEach(input => contains(chapter, field, tuple(input)));
  };
  for (const { document, language } of documents) {
    equal(language + ' chapters', document.chapters.length, 3);
    for (const chapter of document.chapters) {
      equal(language + ' self-check labels', [...chapter.checkpoint.matchAll(/^\*\*(\d+)\.\*\*/gm)].map(match => match[1]), ['1', '2', '3', '4']);
      equal(language + ' answer labels', [...chapter.checkpointAnswer.matchAll(/^\*\*(\d+)\.\*\*/gm)].map(match => match[1]), ['1', '2', '3', '4']);
    }
  }
  for (const [name, [predicate, numeric]] of Object.entries(expressions)) {
    for (const input of inputs) { assert.equal(predicate(...input), numeric(...input), `${name}: independent bitwise model for ${input}`); modelComparisons++; }
    cases++;
  }

  // Lesson 1: operator meanings, scopes, the worked table, and all four self-checks.
  table(0, 'content', 0, pairs.map(([p, q]) => [p, q, not(p), and(p, q), or(p, q), xor(p, q), not(xor(p, q))]));
  equal('inclusive OR is not arithmetic addition or XOR', [or(1, 1), 1 + 1, xor(1, 1)], [1, 2, 0]);
  contains(0, 'content', '$1+1=1$');
  equal('bar scope counterexample', [not(and(0, 1)), and(not(0), not(1))], [1, 0]);
  anchors(0, 'content', [String.raw`\overline{PQ}=\overline{0\cdot1}=\overline0=1`, String.raw`\overline P\,\overline Q=1\cdot0=0`, String.raw`$T=P+Q$`, String.raw`$\overline T R$`]);
  table(0, 'content', 1, inputs.map(([p, q, r]) => [p, q, r, not(q), or(p, not(q)), expression('F')(p, q, r)]));
  contains(0, 'content', String.raw`F=(P+\overline Q)R`);
  displayedSolutions(0, 'content', 'F', [[0, 0, 1], [1, 0, 1], [1, 1, 1]]);
  equal('F false rows', 8 - satisfying(expression('F')).length, 5); contains(0, 'content', '$8-3=5$');
  equal('R alone is insufficient', expression('F')(0, 1, 1), 0);
  equal('wildcard means both inputs, not multiplication', inputs.filter(input => matches(input, '1*0')), [[1, 0, 0], [1, 1, 0]]);
  anchors(0, 'content', ['`(1,*,0)`', '`(1,0,0)`', '`(1,1,0)`']);
  equal('checkpoint 1, separate scopes', [expression('firstCheckpoint')(0, 1, 1), expression('complementScope')(0, 1, 1)], [1, 0]);
  anchors(0, 'checkpointAnswer', [String.raw`$\overline P+QR=1+1=1$`, String.raw`$P+Q=0+1=1$`, String.raw`$\overline{P+Q}R=0\cdot1=0$`]);
  table(0, 'checkpointAnswer', 0, inputs.map(([p, q, r]) => [p, q, r, and(p, not(q)), and(q, r), expression('G')(p, q, r)]));
  contains(0, 'checkpoint', String.raw`$G=P\overline Q+QR$`);
  displayedSolutions(0, 'checkpointAnswer', 'G', [[0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 1]]);
  equal('G false rows', 8 - satisfying(expression('G')).length, 4); contains(0, 'checkpointAnswer', '$8-4=4$');
  displayedSolutions(0, 'checkpointAnswer', 'H', [[0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1]]);
  equal('XOR patterns describe exactly all triples', inputs.filter(input => matches(input, '01*') || matches(input, '10*')), satisfying(expression('H')));
  anchors(0, 'checkpointAnswer', ['`(0,1,*)`', '`(1,0,*)`', '$2+2=4$']);
  equal('precedence counterexample', [expression('W')(1, 0, 0), expression('groupedOr')(1, 0, 0)], [1, 0]);
  anchors(0, 'checkpointAnswer', [String.raw`$P+QR=1+(0\cdot0)=1$`, String.raw`$(P+Q)R=(1+0)\cdot0=0$`]);

  // Lesson 2: each printed law and each intermediate equality is verified for
  // the complete input domain, not merely the boundary example in the prose.
  const laws = [
    [String.raw`$X+0=X$`, x => or(x, 0), x => x],
    [String.raw`$X\cdot1=X$`, x => and(x, 1), x => x],
    [String.raw`$X+1=1$`, x => or(x, 1), () => 1],
    [String.raw`$X\cdot0=0$`, x => and(x, 0), () => 0],
    [String.raw`$X+X=X$`, x => or(x, x), x => x],
    [String.raw`$XX=X$`, x => and(x, x), x => x],
    [String.raw`$X+\overline X=1$`, x => or(x, not(x)), () => 1],
    [String.raw`$X\overline X=0$`, x => and(x, not(x)), () => 0],
    [String.raw`$X+XY=X$`, (x, y) => or(x, and(x, y)), x => x],
    [String.raw`$X(X+Y)=X$`, (x, y) => and(x, or(x, y)), x => x],
    [String.raw`$X(Y+Z)=XY+XZ$`, (x, y, z) => and(x, or(y, z)), (x, y, z) => or(and(x, y), and(x, z))],
    [String.raw`$(X+Y)(X+Z)=X+YZ$`, (x, y, z) => and(or(x, y), or(x, z)), (x, y, z) => or(x, and(y, z))],
    [String.raw`$\overline{X+Y}=\overline X\,\overline Y$`, (x, y) => not(or(x, y)), (x, y) => and(not(x), not(y))],
    [String.raw`$\overline{XY}=\overline X+\overline Y$`, (x, y) => not(and(x, y)), (x, y) => or(not(x), not(y))],
    [String.raw`$\overline{\overline X}=X$`, x => not(not(x)), x => x],
    [String.raw`$\overline0=1$`, () => not(0), () => 1],
    [String.raw`$\overline1=0$`, () => not(1), () => 0]
  ];
  for (const [anchor, left, right] of laws) { contains(1, 'content', anchor); chain(anchor, [left, right]); }
  chain('commutative OR', [(p, q) => or(p, q), (p, q) => or(q, p)]);
  chain('commutative AND', [(p, q) => and(p, q), (p, q) => and(q, p)]);
  chain('associative OR', [(p, q, r) => or(or(p, q), r), (p, q, r) => or(p, or(q, r))]);
  chain('associative AND', [(p, q, r) => and(and(p, q), r), (p, q, r) => and(p, and(q, r))]);
  chain('derived absorption with a complement', [(x, y) => or(x, and(not(x), y)), (x, y) => and(or(x, not(x)), or(x, y)), (x, y) => and(1, or(x, y)), (x, y) => or(x, y)]);
  contains(1, 'content', String.raw`X+\overline X Y=(X+\overline X)(X+Y)=1\cdot(X+Y)=X+Y.`);
  chain('K, every displayed De Morgan step', [expression('K'), (p, q, r) => and(not(not(p)), not(and(q, not(r)))), (p, q, r) => and(p, or(not(q), not(not(r)))), (p, q, r) => and(p, or(not(q), r))]);
  anchors(1, 'content', [String.raw`K=\overline{\overline P+Q\overline R}`, String.raw`K&=\overline{\overline P}\,\overline{Q\overline R}`, String.raw`&=P(\overline Q+\overline{\overline R})`, String.raw`&=P(\overline Q+R)`]);
  equal('K boundary checks', [expression('K')(1, 1, 0), expression('K')(1, 0, 0)], [0, 1]);
  anchors(1, 'content', [String.raw`$0+1\cdot1=1$`, '$1(0+0)=0$']);
  chain('E, every displayed factoring step', [expression('E'), (p, q) => or(and(p, or(not(q), q)), and(not(p), q)), (p, q) => or(p, and(not(p), q)), (p, q) => and(or(p, not(p)), or(p, q)), (p, q) => or(p, q)]);
  anchors(1, 'content', [String.raw`E=P\overline Q+PQ+\overline P Q`, String.raw`E&=P(\overline Q+Q)+\overline P Q`, String.raw`&=P+\overline P Q`, String.raw`&=(P+\overline P)(P+Q)`, String.raw`&=P+Q.`]);
  equal('AND cancellation counterexample', [and(0, 0), and(0, 1), 0 === 1], [0, 0, false]);
  equal('OR cancellation counterexample', [or(1, 0), or(1, 1), 0 === 1], [1, 1, false]);
  contains(1, 'content', '$P=0,Q=0,R=1$');
  chain('checkpoint 1 complement chain', [expression('nestedComplement'), (p, q, r) => and(not(p), not(and(not(q), r))), (p, q, r) => and(not(p), or(not(not(q)), not(r))), (p, q, r) => and(not(p), or(q, not(r)))]);
  anchors(1, 'checkpointAnswer', [String.raw`\overline{P+\overline Q R}`, String.raw`&=\overline P\,\overline{\overline Q R}`, String.raw`&=\overline P(\overline{\overline Q}+\overline R)`, String.raw`&=\overline P(Q+\overline R)`]);
  chain('checkpoint 2 distribution chain', [expression('distribution'), (p, q) => or(p, and(q, not(q))), p => or(p, 0), p => p]);
  contains(1, 'checkpointAnswer', String.raw`(P+Q)(P+\overline Q)=P+Q\overline Q=P+0=P.`);
  chain('checkpoint 3 factored complete complement', [expression('factoredComplement'), (p, q, r) => and(q, or(or(p, r), and(not(p), not(r)))), (p, q, r) => and(q, or(or(p, r), not(or(p, r)))), (p, q) => and(q, 1), (p, q) => q]);
  anchors(1, 'checkpointAnswer', [String.raw`Q(P+R)+Q\overline P\,\overline R`, String.raw`&=Q\bigl[(P+R)+\overline P\,\overline R\bigr]`, String.raw`&=Q\bigl[(P+R)+\overline{P+R}\bigr]`, String.raw`&=Q\cdot1=Q.`]);
  chain('checkpoint 4 corrected De Morgan', [expression('correctedDeMorgan'), (p, q, r) => and(not(and(p, q)), not(r)), (p, q, r) => and(or(not(p), not(q)), not(r))]);
  contains(1, 'checkpointAnswer', String.raw`\overline{PQ+R}=\overline{PQ}\,\overline R=(\overline P+\overline Q)\overline R.`);
  equal('checkpoint 4 wrong transformation disagrees', [expression('correctedDeMorgan')(1, 1, 0), expression('wrongDeMorgan')(1, 1, 0)], [0, 1]);
  anchors(1, 'checkpointAnswer', [String.raw`$\overline{1\cdot1+0}=0$`, String.raw`$0\cdot0+1=1$`]);

  // Lesson 3: complete equivalence, disjoint counting and free-input factors.
  equal('same true count does not imply equality: P and Q', [satisfying(p => p).length, satisfying((p, q) => q).length], [4, 4]);
  const counterexample = inputs.find(([p, q]) => p !== q && p === 1);
  equal('P and Q counterexample', counterexample, [1, 0, 0]); contains(2, 'content', tuple(counterexample));
  displayedSolutions(2, 'content', 'M', [[0, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]]);
  equal('M disjoint case enumeration', [0, 1].map(p => satisfying(expression('M')).filter(input => input[0] === p).length), [2, 2]);
  chain('M is Q if P=0 and R if P=1', [expression('M'), (p, q, r) => p === 0 ? q : r]);
  anchors(2, 'content', [String.raw`M=\overline P Q+PR.`, '`(0,1,*)`', '`(1,*,1)`', '$2+2=4$']);
  for (const { language, document } of documents) {
    const rows = tables(document.chapters[2].content)[0];
    equal(language + ' disjoint table fixed inputs and reduced forms', rows.map(row => row.slice(0, 2)), [['$P=0$', '$Q$'], ['$P=1$', '$R$']]);
    [['(0,1,0)', '(0,1,1)'], ['(1,0,1)', '(1,1,1)']].forEach((values, index) => values.forEach(value => assert.ok(rows[index][3].includes(value))));
  }
  table(2, 'content', 1, inputs.map(([p, q, r]) => [p, q, r, and(p, q), and(q, r), and(r, p), expression('N')(p, q, r)]));
  contains(2, 'content', 'N=PQ+QR+RP.');
  displayedSolutions(2, 'content', 'N', [[0, 1, 1], [1, 0, 1], [1, 1, 0], [1, 1, 1]]);
  equal('N product terms overlap on 111', [satisfying((p, q) => and(p, q)).length, satisfying((p, q, r) => and(q, r)).length, satisfying((p, q, r) => and(r, p)).length, satisfying(expression('N')).length], [2, 2, 2, 4]);
  equal('N disjoint Q cases', [0, 1].map(q => satisfying(expression('N')).filter(input => input[1] === q).length), [1, 3]);
  chain('N conditional reduction', [expression('N'), (p, q, r) => q === 0 ? and(p, r) : or(p, r)]);
  anchors(2, 'content', ['$2+2+2$', '$1+3=4$']);
  equal('M and N have equal counts but differ at 010', [satisfying(expression('M')).length, satisfying(expression('N')).length, expression('M')(0, 1, 0), expression('N')(0, 1, 0)], [4, 4, 1, 0]);
  equal('contradiction and tautology still have eight inputs', [satisfying(p => and(p, not(p))).length, satisfying(p => or(p, not(p))).length], [0, 8]);
  displayedSolutions(2, 'checkpointAnswer', 'S', [[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
  equal('S pattern partition is complete', inputs.filter(input => matches(input, '1*0') || matches(input, '000')), satisfying(expression('S')));
  equal('S false count', 8 - satisfying(expression('S')).length, 5);
  anchors(2, 'checkpoint', [String.raw`$S=(P+\overline Q)\overline R$`]);
  anchors(2, 'checkpointAnswer', ['`(1,*,0)`', '`(0,0,0)`', '$2+1=3$', '$8-3=5$']);
  equal('J one false pair', pairs.filter(input => expression('J')(...input) === 0), [[0, 1]]);
  const fourInputs = inputs.flatMap(input => [0, 1].map(s => [...input, s]));
  equal('J has one and two independent free inputs', [satisfying(expression('J')).length, fourInputs.filter(input => expression('J')(...input)).length], [6, 12]);
  anchors(2, 'checkpoint', [String.raw`$J=P+\overline Q$`]);
  for (const field of ['content', 'checkpointAnswer']) anchors(2, field, [String.raw`$3\cdot2=6$`, String.raw`$3\cdot2^2=12$`]);
  table(2, 'checkpointAnswer', 0, inputs.map(([p, q, r]) => [p, q, r, expression('U')(p, q, r), expression('V')(p, q, r)]));
  chain('U expansion and removal of redundant term', [expression('U'), (p, q, r) => or(and(p, not(p)), and(p, r), and(not(p), q), and(q, r)), (p, q, r) => or(and(p, r), and(not(p), q), and(q, r)), expression('V')]);
  chain('expansion of the consensus term', [(p, q, r) => and(q, r), (p, q, r) => and(q, r, or(p, not(p))), (p, q, r) => or(and(p, q, r), and(not(p), q, r))]);
  chain('consensus absorbed into existing terms', [(p, q, r) => or(and(p, r), and(not(p), q), and(q, r)), (p, q, r) => or(and(p, r), and(p, q, r), and(not(p), q), and(not(p), q, r)), expression('V')]);
  anchors(2, 'checkpointAnswer', [String.raw`U&=P\overline P+PR+\overline P Q+QR`, String.raw`&=PR+\overline P Q+QR.`, String.raw`QR&=QR(P+\overline P)=PQR+\overline P QR`, String.raw`&=PR+PQR+\overline P Q+\overline P QR`, String.raw`&=PR+\overline P Q=V.`]);
  equal('U and V full lists agree', satisfying(expression('U')), satisfying(expression('V')));
  equal('W true and false counts', [satisfying(expression('W')).length, 8 - satisfying(expression('W')).length], [5, 3]);
  equal('W P cases are disjoint', [1, 0].map(p => satisfying(expression('W')).filter(input => input[0] === p).length), [4, 1]);
  equal('W overlap is exactly 111', inputs.filter(([p, q, r]) => p === 1 && and(q, r) === 1), [[1, 1, 1]]);
  anchors(2, 'checkpointAnswer', ['`(1,*,*)`', '`(0,1,1)`', '$4+1=5$', '$8-5=3$', '$4+2$', '`(1,1,1)`']);

  for (const { language, document } of documents) {
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'NOT precedes AND, followed by XOR/XNOR, then OR' : '非的优先级高于与，其后是异或／同或，最后是或'));
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'Same-level operators are evaluated left to right' : '同级运算从左向右进行'));
  }
  const practice = await json('practice-map.json'), curriculum = await json('../../curriculum.json');
  equal('practice positions', practice.chapters.map(chapter => chapter.position), [0, 1, 2]);
  equal('practice chapter coverage', practice.chapters.map(chapter => chapter.references.length), [3, 4, 4]);
  equal('practice metadata', [practice.version, practice.unitId], [1, 'boolean-algebra']);
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  const mapped = practice.chapters.flatMap(chapter => chapter.references).map(key).sort();
  equal('all eleven references appear once', [mapped.length, new Set(mapped).size], [11, 11]);
  equal('reference identity matches curriculum', mapped, curriculum.units.find(unit => unit.id === 'boolean-algebra').practiceReferences.map(key).sort());
  return { cases, modelComparisons, workedExamples: 5, selfChecks: 12 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial(), null, 2));
