// Trusted, bounded arithmetic for original teaching examples only.
// No document strings are executed. Each result is also checked against both
// authored Markdown files, so editing a displayed result cannot evade validation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';

const here = new URL('./', import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));

function aTable(maximum) {
  const values = [3];
  for (let n = 1; n <= maximum; n++) values.push(values.at(-1) + 2 * n);
  return values;
}
function bTable(maximum) {
  const values = [1, 2];
  for (let n = 2; n <= maximum; n++) values.push(values[n - 1] + values[n - 2] + 1);
  return values;
}
function bTree(n, calls = []) {
  calls.push(n);
  if (n <= 1) return n + 1;
  return bTree(n - 1, calls) + bTree(n - 2, calls) + 1;
}
function mTrace(x, y) {
  assert.ok(Number.isInteger(x) && x >= 0 && x <= 10 && Number.isInteger(y));
  const states = [], pending = [];
  while (x > 0) {
    states.push([x, y]);
    if (x % 2 === 0) { pending.push(x); x -= 1; y += 2; }
    else { pending.push(-y); x -= 1; y -= 1; }
  }
  states.push([x, y]);
  let value = y + 2;
  const returning = [value];
  for (const term of pending.toReversed()) { value += term; returning.push(value); }
  return { states, pending, returning, value };
}
// Separate short formulas obtained by substituting the original M rules for
// x=0..4. These check the explicit state-stack calculation independently.
function mSmall(x, y) {
  return [() => y + 2, () => 1, () => 3, () => 3 - y, () => 5 - y][x]();
}
function jTrace(n) {
  assert.ok(Number.isInteger(n) && n >= 0 && n < 100);
  const inputs = [];
  for (let current = n; current > 0; current = Math.floor(current / 2)) inputs.push(current);
  inputs.push(0);
  const returning = [1];
  for (const current of inputs.toReversed().slice(1)) returning.push(returning.at(-1) + current);
  return { inputs, returning, value: returning.at(-1) };
}
const arrows = values => values.join('\\to');
const stateArrows = values => values.map(([x, y]) => `(${x},${y})`).join('\\to');

export async function checkTutorial() {
  const docs = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => {
    const raw = await readFile(new URL(`course.${language}.md`, here), 'utf8');
    const doc = parseLearningMarkdown(raw);
    assert.equal(doc.chapters.length, 3);
    return [language, doc];
  })));
  let cases = 0;
  const contains = (chapter, field, anchor) => {
    for (const [language, doc] of Object.entries(docs))
      assert.ok(doc.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: missing computed anchor ${anchor}`);
  };
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const definition = (chapter, fragments) => fragments.forEach(fragment => contains(chapter, 'content', fragment));
  definition(0, ['3 & n=0,', 'A(n-1)+2n & n\\ge1.']);
  definition(1, ['1 & n=0,', '2 & n=1,', 'B(n-1)+B(n-2)+1 & n\\ge2.']);
  definition(2, ['y+2 & x=0,', 'M(x-1,y+2)+x & x>0', 'M(x-1,y-1)-y & x', '1 & n=0,', 'J\\!\\left(\\left\\lfloor n/2\\right\\rfloor\\right)+n & n\\ge1.']);
  assert.ok(docs.en.chapters[2].content.includes('x\\text{ is even}'));
  assert.ok(docs.en.chapters[2].content.includes('x\\text{ is odd}'));
  assert.ok(docs.zh.chapters[2].content.includes('x\\text{ 为偶数}'));
  assert.ok(docs.zh.chapters[2].content.includes('x\\text{ 为奇数}'));

  equal('prerequisite function', 3 * 2 + 1, 7);
  contains(0, 'content', '$g(x)=3x+1$'); contains(0, 'content', '$g(2)=7$');

  const a = aTable(4);
  equal('A return values independently checked by arithmetic-series sum', a, Array.from({ length: 5 }, (_, n) => 3 + n * (n + 1)));
  a.forEach((value, n) => contains(0, 'checkpointAnswer', `$A(${n})=${value}$`));
  for (let n = 1; n <= 3; n++) contains(0, 'content', `A(${n})&=${a[n - 1]}+${2 * n}=${a[n]}`);
  equal('A(4) total', a[4], 23);
  contains(0, 'checkpoint', '$A(4)$'); contains(0, 'checkpointAnswer', `$3+2+4+6+8=${a[4]}$`);
  equal('A(3) independent card total', 3 + [2, 4, 6].reduce((n, x) => n + x, 0), a[3]);
  contains(0, 'content', `$3+2+4+6=${a[3]}$`);
  const aInputs = Array.from({ length: 4 }, (_, i) => 3 - i);
  equal('A(3) call count and transitions', [aInputs.length, aInputs.length - 1], [4, 3]);
  contains(0, 'content', `$${arrows(aInputs)}$`);
  assert.ok(docs.en.chapters[0].checkpointAnswer.includes('4 calls and 3 recursive transitions'));
  assert.ok(docs.zh.chapters[0].checkpointAnswer.includes('4 个调用，其中有 3 次递归转移'));
  equal('caller uses its own parameter in A(2)', a[1] + 2 * 2, 9);
  contains(0, 'checkpointAnswer', '$A(2)=A(1)+2\\cdot2=5+4=9$');

  const b = bTable(5), calls = [];
  equal('B(4) recursive tree against forward table', bTree(4, calls), b[4]);
  for (const doc of Object.values(docs)) {
    const tree = doc.chapters[1].content.match(/```text\n([\s\S]*?)\n```/)[1];
    assert.deepEqual([...tree.matchAll(/B\((\d)\)/g)].map(match => Number(match[1])), calls);
    for (const line of tree.split('\n').filter(line => line.includes(' = '))) {
      const [, input, value] = line.match(/B\((\d)\) = (\d+)/);
      assert.equal(Number(value), b[Number(input)]);
    }
  }
  const counts = Array.from({ length: 5 }, (_, n) => calls.filter(value => value === n).length);
  equal('B call multiplicities', counts, [2, 3, 2, 1, 1]);
  equal('B calls versus distinct inputs', [calls.length, new Set(calls).size], [9, 5]);
  assert.ok(docs.en.chapters[1].checkpointAnswer.includes('2, 3, 2, 1, and 1, totaling 9'));
  assert.ok(docs.zh.chapters[1].checkpointAnswer.includes('2、3、2、1、1，合计 9'));
  equal('B(0..4) table', b.slice(0, 5), [1, 2, 4, 7, 12]);
  contains(1, 'content', `| $B(n)$ | ${b.slice(0, 5).join(' | ')} |`);
  for (let n = 2; n <= 4; n++) contains(1, 'content', `B(${n})&=${b[n - 1]}+${b[n - 2]}+1=${b[n]}`);
  equal('B(5) checkpoint', bTree(5), b[5]);
  contains(1, 'checkpoint', '$B(5)$'); contains(1, 'checkpointAnswer', `$B(5)=${b[4]}+${b[3]}+1=${b[5]}$`);
  equal('composition B(B(2))', b[b[2]], 12);
  contains(1, 'content', `B(B(2))=B(${b[2]})=${b[b[2]]}.`);
  equal('twice B(2)', 2 * b[2], 8); contains(1, 'content', `$2B(2)=${2 * b[2]}$`);
  equal('square of B(2)', b[2] ** 2, 16); contains(1, 'content', `$[B(2)]^2=${b[2] ** 2}$`);
  equal('inside-parentheses addition', b[b[1] + 1], 7);
  contains(1, 'checkpointAnswer', `$B(B(1)+1)=B(${b[1] + 1})=${b[b[1] + 1]}$`);
  equal('outside-parentheses addition', b[b[1]] + 1, 5);
  contains(1, 'checkpointAnswer', `$B(B(1))=B(${b[1]})=${b[b[1]]}$`);
  assert.ok(docs.en.chapters[1].checkpointAnswer.includes('outside the parentheses to obtain 5'));
  assert.ok(docs.zh.chapters[1].checkpointAnswer.includes('括号外的 1，结果为 5'));
  equal('diagnosed missing-branch value', b[3] + 1, 8);
  contains(1, 'checkpointAnswer', `$B(4)=${b[3]}+${b[2]}+1=${b[4]}$`);

  const mWorked = mTrace(3, 5);
  equal('M(3,5) full state and return trace', mWorked, {
    states: [[3, 5], [2, 4], [1, 6], [0, 5]], pending: [-5, 2, -6], returning: [7, 1, 3, -2], value: mSmall(3, 5)
  });
  contains(2, 'content', '| $(3,5)$ |'); contains(2, 'content', '| $(2,4)$ |');
  contains(2, 'content', '| $(1,6)$ |'); contains(2, 'content', '| $(0,5)$ |');
  for (const anchor of ['M(0,5)&=7', 'M(1,6)&=7-6=1', 'M(2,4)&=1+2=3', 'M(3,5)&=3-5=-2']) contains(2, 'content', anchor);
  contains(2, 'content', '$7-6+2-5=-2$');
  const mFirst = mTrace(2, 3);
  equal('M(2,3) checkpoint', mFirst, { states: [[2, 3], [1, 5], [0, 4]], pending: [2, -5], returning: [6, 1, 3], value: mSmall(2, 3) });
  contains(2, 'checkpoint', '$M(2,3)$'); contains(2, 'checkpointAnswer', `$${stateArrows(mFirst.states)}$`);
  for (const anchor of ['$M(0,4)=6$', '$M(1,5)=6-5=1$', '$M(2,3)=1+2=3$']) contains(2, 'checkpointAnswer', anchor);
  const mSecond = mTrace(4, 2);
  equal('M(4,2) checkpoint', mSecond, { states: [[4, 2], [3, 4], [2, 3], [1, 5], [0, 4]], pending: [4, -4, 2, -5], returning: [6, 1, 3, -1, 3], value: mSmall(4, 2) });
  contains(2, 'checkpoint', '$M(4,2)$'); contains(2, 'checkpointAnswer', `$${stateArrows(mSecond.states)}$`);
  contains(2, 'checkpointAnswer', `$${arrows(mSecond.returning)}$`);
  contains(2, 'checkpointAnswer', '$M(3,4)=M(2,3)-4=3-4=-1$');
  contains(2, 'checkpointAnswer', '$M(4,2)=M(3,4)+4=-1+4=3$');
  const mNegative = mTrace(1, -2);
  equal('M negative-y checkpoint', mNegative, { states: [[1, -2], [0, -3]], pending: [2], returning: [-1, 1], value: mSmall(1, -2) });
  contains(2, 'checkpoint', '$M(1,-2)$'); contains(2, 'checkpointAnswer', '$M(1,-2)=M(0,-3)-(-2)$');
  contains(2, 'checkpointAnswer', '$M(0,-3)=-1$'); contains(2, 'checkpointAnswer', '$-1+2=1$');
  equal('M x decreases while y may increase', mSecond.states.every(([x], i, all) => i === all.length - 1 ? x === 0 : x - all[i + 1][0] === 1), true);

  for (const [input, inputs, returning] of [
    [7, [7, 3, 1, 0], [1, 2, 5, 12]],
    [8, [8, 4, 2, 1, 0], [1, 2, 4, 8, 16]],
    [9, [9, 4, 2, 1, 0], [1, 2, 4, 8, 17]]
  ]) {
    const trace = jTrace(input);
    equal(`J(${input}) input and return trace`, trace, { inputs, returning, value: returning.at(-1) });
    // For nonnegative integers, sum floor(n/2^k) = 2n - popcount(n).
    assert.equal(trace.value, 1 + 2 * input - input.toString(2).replaceAll('0', '').length);
    const field = input === 9 ? 'checkpointAnswer' : 'content';
    contains(2, field, input === 7 ? 'J(7)&=5+7=12.' : `$J(${input})=${trace.value}$`);
    if (input !== 7) contains(2, field, `$${arrows(trace.inputs)}$`);
    if (input === 9) contains(2, field, `$${arrows(trace.returning)}$`);
  }
  for (const anchor of ['| 7 | 3 | 7 |', '| 3 | 1 | 3 |', '| 1 | 0 | 1 |', 'J(0)&=1', 'J(1)&=1+1=2', 'J(3)&=2+3=5']) contains(2, 'content', anchor);
  equal('positive floor', Math.floor(7 / 2), 3); contains(2, 'content', '$\\lfloor7/2\\rfloor=3$');
  equal('negative floor differs from truncation', [Math.floor(-3 / 2), Math.trunc(-3 / 2)], [-2, -1]);
  contains(2, 'content', '$\\lfloor-3/2\\rfloor=-2$');

  const map = await readJson('practice-map.json');
  assert.equal(map.version, 1); assert.equal(map.unitId, 'recursion'); assert.equal(map.chapters.length, 3);
  const references = map.chapters.flatMap((chapter, position) => {
    assert.equal(chapter.position, position); assert.ok(chapter.key.trim()); return chapter.references;
  });
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  const manifest = await readJson('../../curriculum.json');
  const expected = manifest.units.find(unit => unit.id === 'recursion').practiceReferences;
  assert.equal(references.length, 12); assert.equal(new Set(references.map(key)).size, 12);
  assert.deepEqual(references.map(key).sort(), expected.map(key).sort());
  return { cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await checkTutorial(), null, 2));
