// Trusted calculations for original lessons. Never evaluate document or learner code.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';

const here = new URL('./', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
function bits(value) { assert.match(value, /^[01]{1,12}$/); return value; }
function binary(a, b, operation) {
  bits(a); bits(b); const width = Math.max(a.length, b.length);
  a = a.padStart(width, '0'); b = b.padStart(width, '0');
  return [...a].map((digit, i) => operation(Number(digit), Number(b[i]))).join('');
}
const and = (a, b) => binary(a, b, (x, y) => x === 1 && y === 1 ? 1 : 0);
const or = (a, b) => binary(a, b, (x, y) => x === 1 || y === 1 ? 1 : 0);
const xor = (a, b) => binary(a, b, (x, y) => x === y ? 0 : 1);
const not = value => [...bits(value)].map(bit => bit === '0' ? '1' : '0').join('');
function move(value, count, operation) {
  bits(value); assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 100);
  const width = value.length;
  if (operation.endsWith('SHIFT')) {
    const n = Math.min(count, width), zeros = '0'.repeat(n);
    return operation === 'LSHIFT' ? value.slice(n) + zeros : zeros + value.slice(0, width - n);
  }
  const offset = count % width;
  return [...value].map((_, i) => value[(i + (operation === 'LCIRC' ? offset : width - offset)) % width]).join('');
}
const ls = (s, n) => move(s, n, 'LSHIFT');
const rs = (s, n) => move(s, n, 'RSHIFT');
const lc = (s, n) => move(s, n, 'LCIRC');
const rc = (s, n) => move(s, n, 'RCIRC');
const number = value => BigInt('0b' + bits(value));
const mask = width => (1n << BigInt(width)) - 1n;
const format = (value, width) => value.toString(2).padStart(width, '0');
function numericMove(value, count, operation) {
  const width = value.length, n = BigInt(count), w = BigInt(width), v = number(value), k = n % w;
  const result = operation === 'LSHIFT' ? (v << n) & mask(width) : operation === 'RSHIFT' ? v >> n
    : operation === 'LCIRC' ? ((v << k) | (v >> (w - k))) & mask(width)
    : ((v >> k) | (v << (w - k))) & mask(width);
  return format(result, width);
}
const allSix = Array.from({ length: 64 }, (_, n) => n.toString(2).padStart(6, '0'));
const matchesPattern = (value, pattern) => [...value].every((bit, i) => pattern[i] === '*' || pattern[i] === bit);
const solutions = (operation, target) => allSix.filter(value => operation(value) === target);
const tables = text => [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(match => match[0].trim().split('\n').slice(2)
  .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim().replace(/^`(.*)`$/, '$1'))));

export async function checkTutorial() {
  const documents = await Promise.all(['en', 'zh'].map(async language => ({ language,
    document: parseLearningMarkdown(await readFile(new URL(`course.${language}.md`, here), 'utf8')) })));
  let cases = 0, modelComparisons = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const contains = (chapter, field, anchor) => {
    for (const { language, document } of documents)
      assert.ok(document.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: missing calculated anchor ${anchor}`);
  };
  const table = (chapter, index, expected, { dropFirst = false } = {}) => {
    for (const { language, document } of documents) {
      const actual = tables(document.chapters[chapter].content)[index];
      assert.ok(actual, `${language}/${chapter + 1}: missing table ${index}`);
      assert.deepEqual(dropFirst ? actual.map(row => row.slice(1)) : actual, expected.map(row => row.map(String)), `${language}/${chapter + 1}: displayed table ${index}`);
    }
    cases++;
  };
  for (const { document } of documents) assert.equal(document.chapters.length, 3);

  // A second, numeric implementation checks all bounded strings and boundaries;
  // it does not interpret any expression taken from the lesson.
  for (let width = 1; width <= 8; width++) for (let n = 0; n < 2 ** width; n++) {
    const value = n.toString(2).padStart(width, '0');
    assert.equal(not(value), format(number(value) ^ mask(width), width)); modelComparisons++;
    for (let count = 0; count <= width + 2; count++) for (const operation of ['LSHIFT', 'RSHIFT', 'LCIRC', 'RCIRC']) {
      const moved = move(value, count, operation);
      assert.equal(moved, numericMove(value, count, operation)); assert.equal(moved.length, width); modelComparisons++;
      if (operation.endsWith('CIRC')) assert.equal(moved.replaceAll('0', '').length, value.replaceAll('0', '').length);
    }
  }
  cases++;
  for (const a of allSix) for (const b of allSix) {
    assert.equal(and(a, b), format(number(a) & number(b), 6));
    assert.equal(or(a, b), format(number(a) | number(b), 6));
    assert.equal(xor(a, b), format(number(a) ^ number(b), 6)); modelComparisons += 3;
  }
  cases++;
  const truth = ['0', '1'].flatMap(a => ['0', '1'].map(b => [a, b, not(a), and(a, b), or(a, b), xor(a, b)]));
  table(0, 0, truth);
  const a = '101001', b = '011110';
  const pair = [and(a, b), or(a, b), xor(a, b), not(a)];
  table(0, 1, [[...a], [...b], ...pair.map(value => [...value])], { dropFirst: true });
  equal('NOT twice restores all six positions', not(not(a)), a);
  contains(0, 'content', `A = ${a}`); contains(0, 'content', `B = ${b}`);
  pair.forEach(value => contains(0, 'content', '`' + value + '`'));
  equal('padding agrees with the numeric AND', and('10101', '110'), format(21n & 6n, 5));
  contains(0, 'content', '`10101 AND 00110`'); contains(0, 'content', '`00100`');

  const p1 = and('011011', '110101'), p2 = xor(p1, '001100'), p3 = or('100010', p2);
  table(0, 2, [[1, '011011 AND 110101', p1], [2, `${p1} XOR 001100`, p2], [3, `100010 OR ${p2}`, p3]]);
  contains(0, 'content', '`100010 OR ((011011 AND 110101) XOR 001100)`');
  const wrongOrder = xor(and(or('100010', '011011'), '110101'), '001100');
  equal('wrong grouping is a different expression', [p3, wrongOrder], ['111111', '111101']);
  contains(0, 'content', '`' + wrongOrder + '`');
  for (const value of [not('010110'), and('010110', '101100'), or('010110', '101100'), xor('010110', '101100')]) contains(0, 'checkpointAnswer', '`' + value + '`');
  equal('checkpoint OR and XOR differ at fourth position', [or('010110', '101100')[3], xor('010110', '101100')[3]], ['1', '0']);
  contains(0, 'checkpoint', '`11011 AND 101`');
  contains(0, 'checkpointAnswer', `\`11011 AND 00101 = ${and('11011', '101')}\``);
  equal('new padding checkpoint', and('11011', '101'), '00001');
  const cp1 = and('100101', '001111'), cp2 = xor(cp1, '000011'), cp3 = or('010000', cp2);
  contains(0, 'checkpoint', '`010000 OR 100101 AND 001111 XOR 000011`');
  for (const equation of [`100101 AND 001111 = ${cp1}`, `${cp1} XOR 000011 = ${cp2}`, `010000 OR ${cp2} = ${cp3}`]) contains(0, 'checkpointAnswer', '`' + equation + '`');
  equal('checkpoint precedence independently in numeric form', cp3, format(16n | ((37n & 15n) ^ 3n), 6));
  equal('wrong checkpoint grouping loses the final OR bit', xor(and(or('010000', '100101'), '001111'), '000011'), '000110');

  table(1, 0, [['LSHIFT-2', 'cdef00'], ['RSHIFT-2', '00abcd'], ['LCIRC-2', 'cdefab'], ['RCIRC-2', 'efabcd']]);
  // A unique marker for each position provides an independent check of the displayed symbolic patterns.
  equal('symbolic positions', ['abcdef'.slice(2) + '00', '00' + 'abcdef'.slice(0, 4), 'abcdef'.slice(2) + 'abcdef'.slice(0, 2), 'abcdef'.slice(4) + 'abcdef'.slice(0, 4)], ['cdef00', '00abcd', 'cdefab', 'efabcd']);
  table(1, 1, ['LSHIFT', 'RSHIFT', 'LCIRC', 'RCIRC'].map(operation => [`${operation}-2 101101`, move('101101', 2, operation)]));
  const nested1 = not('001011'), nested2 = ls(nested1, 1), nested3 = rc(nested2, 2);
  contains(1, 'content', '`(RCIRC-2 (LSHIFT-1 (NOT 001011)))`');
  table(1, 2, [[1, 'NOT 001011', nested1], [2, `LSHIFT-1 ${nested1}`, nested2], [3, `RCIRC-2 ${nested2}`, nested3]]);
  table(1, 3, [['LCIRC-2 (RSHIFT-1 101101)', rs('101101', 1), lc(rs('101101', 1), 2)], ['RSHIFT-1 (LCIRC-2 101101)', lc('101101', 2), rs(lc('101101', 2), 1)]]);
  equal('rotation and zero-filled shift need not commute', [lc(rs('101101', 1), 2), rs(lc('101101', 2), 1)], ['011001', '011011']);
  for (const [operation, count, value] of [['LSHIFT', 6, ls('101101', 6)], ['LCIRC', 6, lc('101101', 6)], ['LCIRC', 8, lc('101101', 8)]]) {
    contains(1, 'content', `\`${operation}-${count} 101101 = ${value}\``);
    contains(1, 'checkpointAnswer', '`' + value + '`');
  }
  equal('whole-width shift versus rotation', [ls('101101', 6), lc('101101', 6), lc('101101', 8)], ['000000', '101101', '110110']);
  for (const operation of ['LSHIFT', 'RSHIFT', 'LCIRC', 'RCIRC']) equal(`${operation} zero count`, move('101101', 0, operation), '101101');
  contains(1, 'checkpoint', '`LSHIFT-3 0110101`'); contains(1, 'checkpoint', '`RCIRC-3 0110101`');
  for (const value of [ls('0110101', 3), rc('0110101', 3)]) contains(1, 'checkpointAnswer', '`' + value + '`');
  equal('seven-bit shift and rotation', [ls('0110101', 3), rc('0110101', 3)], ['0101000', '1010110']);
  const self1 = not('110010'), self2 = rs(self1, 2), self3 = lc(self2, 1);
  for (const equation of [`NOT 110010 = ${self1}`, `RSHIFT-2 ${self1} = ${self2}`, `LCIRC-1 ${self2} = ${self3}`]) contains(1, 'checkpointAnswer', '`' + equation + '`');
  equal('nested checkpoint', self3, '000110');
  contains(1, 'checkpointAnswer', `\`LSHIFT-2 110101 = ${ls('110101', 2)}\``);
  contains(1, 'checkpointAnswer', `\`RSHIFT-2 ${ls('110101', 2)} = ${rs(ls('110101', 2), 2)}\``);
  equal('opposite shifts do not reconstruct discarded bits', rs(ls('110101', 2), 2), '000101');

  const masked = value => or(and(value, '101100'), '000010');
  const maskedSolutions = solutions(masked, '100110');
  table(2, 0, [['abcdef'], ['a0cd00'], ['a0cd10'], ['100110']], { dropFirst: true });
  contains(2, 'content', '`(X AND 101100) OR 000010 = 100110`');
  equal('mask constraints exactly describe all original strings', maskedSolutions, allSix.filter(value => matchesPattern(value, '1*01**')));
  equal('mask independent free choices', maskedSolutions.length, 2 ** 3);
  contains(2, 'content', '`1*01**`'); contains(2, 'content', '$2^3=8$');
  maskedSolutions.forEach(value => contains(2, 'content', '`' + value + '`'));
  for (const value of allSix) assert.equal(masked(value), format((number(value) & 44n) | 2n, 6));
  cases++;

  const pipeline = value => xor(rc(ls(value, 2), 1), '001101');
  const reverse1 = xor('011011', '001101'), reverse2 = lc(reverse1, 1);
  table(2, 1, [['011011 XOR 001101', reverse1], [`LCIRC-1 ${reverse1}`, reverse2]]);
  const inverseSolutions = solutions(pipeline, '011011');
  equal('inverse pattern exactly matches enumeration', inverseSolutions, allSix.filter(value => matchesPattern(value, '**1011')));
  equal('lost leading bits give four independent possibilities', inverseSolutions.length, 2 ** 2);
  contains(2, 'content', '`(RCIRC-1 (LSHIFT-2 X)) XOR 001101 = 011011`');
  contains(2, 'content', '`**1011`'); contains(2, 'content', '$2^2=4$');
  inverseSolutions.forEach(value => contains(2, 'content', '`' + value + '`'));
  equal('forward representative trace', [ls('001011', 2), rc(ls('001011', 2), 1), pipeline('001011')], ['101100', '010110', '011011']);
  for (const value of allSix) assert.equal(pipeline(value), format(number(numericMove(numericMove(value, 2, 'LSHIFT'), 1, 'RCIRC')) ^ 13n, 6));
  cases++;
  equal('forced-zero mask contradiction', solutions(value => and(value, '001100'), '100000'), []);
  contains(2, 'checkpoint', '`X AND 001100 = 100000`');
  const unique = xor('010101', '101011');
  equal('XOR inversion is unique', solutions(value => xor(value, '101011'), '010101'), [unique]);
  contains(2, 'checkpointAnswer', `\`010101 XOR 101011 = ${unique}\``);
  contains(2, 'checkpointAnswer', `\`${unique} XOR 101011 = 010101\``);
  const orSolutions = solutions(value => or(value, '101010'), '111011');
  equal('OR mask pattern exactly matches enumeration', orSolutions, allSix.filter(value => matchesPattern(value, '*1*0*1')));
  equal('OR mask count', orSolutions.length, 2 ** 3);
  contains(2, 'checkpoint', '`X OR 101010 = 111011`'); contains(2, 'checkpointAnswer', '`*1*0*1`'); contains(2, 'checkpointAnswer', '$2^3=8$');
  for (const value of ['010001', '111011']) { assert.equal(or(value, '101010'), '111011'); contains(2, 'checkpointAnswer', '`' + value + '`'); }
  equal('changed target has no preimage under lossy pipeline', solutions(pipeline, '010110'), []);
  contains(2, 'checkpoint', '`(RCIRC-1 (LSHIFT-2 X)) XOR 001101 = 010110`');
  const bad1 = xor('010110', '001101'), bad2 = lc(bad1, 1);
  contains(2, 'checkpointAnswer', `\`010110 XOR 001101 = ${bad1}\``);
  contains(2, 'checkpointAnswer', `\`LCIRC-1 ${bad1} = ${bad2}\``);
  assert.notEqual(bad2.slice(-2), '00');
  equal('final forced bit proves the same contradiction', [...new Set(allSix.map(value => pipeline(value).at(-1)))], ['1']);

  for (const { language, document } of documents) {
    const content = document.chapters[1].content;
    assert.ok(content.includes(language === 'en' ? 'NOT, then SHIFT/CIRC, then AND, then XOR, then OR' : 'NOT、SHIFT/CIRC、AND、XOR、OR'));
    assert.ok(content.includes(language === 'en' ? 'unary operators bind from right to left' : '一元运算向右结合'));
    assert.ok(content.includes(language === 'en' ? 'binary operators are evaluated left to right' : '二元运算从左向右计算'));
    assert.ok(document.chapters[2].checkpointAnswer.includes(language === 'en' ? 'No solutions.' : '无解。'));
  }
  const practice = await json('practice-map.json'), curriculum = await json('../../curriculum.json');
  equal('practice positions', practice.chapters.map(chapter => chapter.position), [0, 1, 2]);
  equal('practice chapter coverage', practice.chapters.map(chapter => chapter.references.length), [2, 5, 5]);
  assert.equal(practice.version, 1); assert.equal(practice.unitId, 'bit-strings');
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  const mapped = practice.chapters.flatMap(chapter => chapter.references).map(key).sort();
  equal('all twelve references appear once', [mapped.length, new Set(mapped).size], [12, 12]);
  equal('reference identity matches the curriculum', mapped, curriculum.units.find(unit => unit.id === 'bit-strings').practiceReferences.map(key).sort());
  return { cases, modelComparisons };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial(), null, 2));
