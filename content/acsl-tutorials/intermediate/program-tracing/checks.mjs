// Trusted, independently written calculations. Never evaluate lesson/learner code.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = new URL('./', import.meta.url);
const result = (rows, values) => ({ rows, ...(values === undefined ? {} : { output: values.join(', ') }) });
function assignment(initialA, initialB, reversed = false) {
  let a = initialA, b = initialB;
  const rows = [[a, b]];
  if (reversed) { b = a - b; rows.push([a, b]); a = a + b; }
  else { a = a + b; rows.push([a, b]); b = a - b; }
  rows.push([a, b]);
  return result(rows, [a, b]);
}
function countBits(initial) {
  let n = initial, ones = 0, turns = 0;
  const rows = [];
  while (n > 0) {
    assert.ok(turns < 100, 'Bound the trusted checker loop.');
    const before = n, bit = n % 2;
    ones += bit; n = Math.floor(n / 2); turns++;
    rows.push([before, bit, ones, n, turns]);
  }
  if (initial > 0) {
    const notation = initial.toString(2);
    assert.equal(ones, [...notation].filter(digit => digit === '1').length);
    assert.equal(turns, notation.length);
  }
  return result(rows, [ones, turns]);
}
function descending(bound) {
  let total = 0;
  const rows = [];
  for (let k = 9; k >= bound; k -= 3) { total += k; rows.push([k, total]); }
  const terms = Math.floor((9 - bound) / 3) + 1;
  assert.equal(total, terms * (9 + (9 - (terms - 1) * 3)) / 2);
  return result(rows, [total]);
}
function halving(initial) {
  let n = initial, count = 0;
  const rows = [];
  while (n > 1) {
    assert.ok(count < 100);
    n = Math.floor(n / 2); count++; rows.push([n, count]);
  }
  return { ...result(rows, [n, count]), final: [n, count] };
}
const calculations = {
  'assignment-main': () => {
    let a = 9, b = 4; const rows = [[a, b]];
    a = a - b; rows.push([a, b]); b = a + 2 * b; rows.push([a, b]); a = b % a; rows.push([a, b]);
    assert.deepEqual([...new Set(rows.flat())].sort((x, y) => x - y), [3, 4, 5, 9, 13]);
    return result(rows, [a, b]);
  },
  'assignment-original': () => assignment(7, 2),
  'assignment-reordered': () => assignment(7, 2, true),
  'quotient-remainder': () => {
    const n = 31, q = Math.floor(n / 4), r = n % 4;
    assert.equal(n, 4 * q + r); assert.ok(r >= 0 && r < 4);
    return result([[n, q, r]], [q, r]);
  },
  'stored-values': () => {
    const values = [...new Set(assignment(7, 2).rows.flat())].sort((a, b) => a - b);
    assert.deepEqual(values, [2, 7, 9]); return result([], [values.length]);
  },
  'branches-main': () => {
    let score = 7, bonus = 2; const rows = [[score, bonus]];
    if (score < 6) bonus += 4; else if (score < 9) score += bonus; else bonus = 0;
    rows.push([score, bonus]); if (score % 3 === 0 && bonus > 0) score--;
    rows.push([score, bonus]); return result(rows, [score, bonus]);
  },
  'independent-ifs': () => {
    let x = 4; const rows = [[x]]; if (x < 5) x += 2; rows.push([x]);
    if (x > 5) x *= 3; rows.push([x]); return result(rows, [x]);
  },
  'single-chain': () => {
    let x = 4; const rows = [[x]]; if (x < 5) x += 2; else if (x > 5) x *= 3;
    rows.push([x]); return result(rows, [x]);
  },
  'branches-checkpoint': () => {
    let x = 6, y = 3; const rows = [[x, y]];
    if (x % 2 === 0) x += y; else y += 2; rows.push([x, y]);
    if (x > 8 && y === 3) y = x - y; rows.push([x, y]); return result(rows, [x, y]);
  },
  'candidate-inputs': () => {
    const candidates = [['A', 0, 3], ['B', 4, 1], ['C', 5, 0], ['D', 6, 2]];
    const rows = candidates.map(([label, n, token]) => {
      const output = [];
      if (n < 1) output.push('INVALID');
      else { output.push(n <= 4 ? 'SMALL' : 'LARGE'); if (token > 0) output.push('READY'); }
      return [label, n, token, output.join(', ')];
    });
    return result(rows, rows.filter(row => row[3] === 'LARGE, READY').map(row => row[0]));
  },
  'tier-boundaries': () => {
    const cost = pages => pages <= 2 ? 3 * pages : 6 + pages - 2;
    const rows = [1, 2, 3, 5].map(pages => [pages, cost(pages)]);
    for (let pages = 1; pages <= 30; pages++) {
      // Independent per-page charging, not a second copy of the piecewise formula.
      assert.equal(cost(pages), Array.from({ length: pages }, (_, index) => index < 2 ? 3 : 1).reduce((a, b) => a + b, 0));
    }
    assert.equal(cost(3), 7); assert.notEqual(6 + 3, cost(3));
    return result(rows, rows.map(row => row[1]));
  },
  'for-main': () => {
    let total = 1, step = 0; const rows = [];
    for (let k = 2; k <= 8; k += 3) { total += k; rows.push([++step, k, total]); }
    for (let k = 6; k >= 2; k -= 2) { total -= k / 2; rows.push([++step, k, total]); }
    assert.equal(total, 1 + 3 * (2 + 8) / 2 - 3 * (3 + 1) / 2);
    return result(rows, [total]);
  },
  'while-main': () => countBits(23),
  'descending-for': () => descending(3),
  'descending-boundary': () => descending(4),
  'while-halving': () => halving(10),
  'while-zero-iterations': () => result([1, 0].map(initial => [initial, ...halving(initial).final])),
  'saved-old-value': () => {
    let a = 3, b = 1, turns = 0; const rows = [];
    while (a < 15) {
      assert.ok(turns < 100); const old = a; a = 2 * a - b; b = old; turns++;
      rows.push([a, b, turns]); assert.equal(a - b, 2); assert.equal(a, 3 + 2 * turns);
    }
    assert.equal(turns, Math.ceil((15 - 3) / 2));
    // The incorrect update reaches a fixed point, independently confirming the warning.
    let wrongA = 3, wrongB = 1;
    wrongA = 2 * wrongA - wrongB; wrongB = wrongA;
    assert.deepEqual([wrongA, wrongB], [5, 5]); assert.equal(2 * wrongA - wrongB, wrongA);
    return result(rows, [a, b, turns]);
  },
};

function field(document, chapter, section) {
  const chapters = document.split(/^## 章节：.*$/m).slice(1);
  assert.equal(chapters.length, 3);
  const label = { body: '正文', checkpoint: '检查点', answer: '参考答案' }[section];
  const parts = chapters[chapter - 1].split(`### ${label}\n`);
  assert.equal(parts.length, 2, `Chapter ${chapter}: ${label}`);
  return parts[1].split('\n### ', 1)[0];
}
function block(document, chapter, section, anchor) {
  const text = field(document, chapter, section), start = text.indexOf(anchor);
  assert.ok(start >= 0 && text.indexOf(anchor, start + anchor.length) < 0, `Unique displayed anchor: ${anchor}`);
  const tail = text.slice(start + anchor.length), end = tail.search(/^(?:#### |\*\*\d+\.\*\* )/m);
  return anchor + tail.slice(0, end < 0 ? undefined : end);
}
function tables(text) {
  return [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(match => match[0].trim().split('\n').slice(2).map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim())));
}

export async function checkTutorial() {
  const [fixture, en, zh, practice, curriculum] = await Promise.all([
    readFile(new URL('trace-checks.json', directory), 'utf8').then(JSON.parse),
    readFile(new URL('course.en.md', directory), 'utf8'), readFile(new URL('course.zh.md', directory), 'utf8'),
    readFile(new URL('practice-map.json', directory), 'utf8').then(JSON.parse),
    readFile(new URL('../../curriculum.json', directory), 'utf8').then(JSON.parse),
  ]);
  assert.equal(fixture.version, 1);
  assert.deepEqual(fixture.cases.map(item => item.id).sort(), Object.keys(calculations).sort());
  const documents = { en, zh };
  for (const item of fixture.cases) {
    const computed = calculations[item.id]();
    assert.deepEqual(computed.rows, item.rows, `${item.id}: independent state calculation`);
    assert.equal(computed.output, item.output, `${item.id}: independent output calculation`);
    for (const [language, document] of Object.entries(documents)) {
      const displayed = block(document, item.chapter, item.section, item.anchor[language]);
      if (item.code) {
        const text = block(document, item.chapter, item.code.section, item.code.anchor[language]);
        const codes = [...text.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match => match[1]);
        assert.equal(codes[item.code.index], item.code.text, `${item.id}/${language}: actual displayed program`);
      }
      if (item.rows.length) {
        let rows = tables(displayed)[item.tableIndex]; assert.ok(rows, `${item.id}/${language}: displayed table`);
        if (item.lastColumns) rows = rows.map(row => row.slice(-item.lastColumns));
        assert.deepEqual(rows, computed.rows.map(row => row.map(String)), `${item.id}/${language}: actual table cells`);
      }
      if (item.output !== undefined) {
        const outputs = [...displayed.matchAll(/\*\*(?:Output:|输出：)\*\* `([^`]+)`/g)].map(match => match[1]);
        assert.equal(outputs[item.outputIndex], computed.output, `${item.id}/${language}: displayed answer`);
      }
    }
  }
  for (const [language, document] of Object.entries(documents)) {
    const first = field(document, 1, 'body'), last = field(document, 3, 'body');
    assert.ok(first.includes('\\{3,4,5,9,13\\}'));
    assert.ok(field(document, 1, 'answer').includes('\\{2,7,9\\}'));
    const negative = language === 'en'
      ? ['ACSL `int(-1.5)` is -2', 'Python `int(-1.5)` is -1']
      : ['ACSL 的 `int(-1.5)` 为 -2', 'Python 的 `int(-1.5)` 为 -1'];
    negative.forEach(text => assert.ok(first.includes(text), text));
    assert.equal(Math.floor(-1.5), -2); assert.equal(Math.trunc(-1.5), -1);
    assert.ok(last.includes(language === 'en' ? 'output `0, 0`' : '输出 `0, 0`'));
    assert.ok(field(document, 2, 'answer').includes('$6+(p-2)$'));
    assert.ok(field(document, 3, 'answer').includes('(5, 5)'));
    for (let chapter = 1; chapter <= 3; chapter++) {
      for (const section of ['checkpoint', 'answer']) {
        assert.deepEqual([...field(document, chapter, section).matchAll(/^\*\*(\d+)\.\*\*/gm)].map(match => Number(match[1])), [1, 2, 3]);
      }
    }
  }
  assert.equal(countBits(0).output, '0, 0');
  assert.equal(practice.version, 1); assert.equal(practice.unitId, 'program-tracing');
  assert.deepEqual(practice.chapters.map(chapter => chapter.position), [0, 1, 2]);
  assert.deepEqual(practice.chapters.map(chapter => chapter.references.length), [1, 5, 2]);
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  const actual = practice.chapters.flatMap(chapter => chapter.references).map(key).sort();
  assert.equal(new Set(actual).size, 8);
  assert.deepEqual(actual, curriculum.units.find(unit => unit.id === 'program-tracing').practiceReferences.map(key).sort());
  return { cases: fixture.cases.length + 2 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial()));
