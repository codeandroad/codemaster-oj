// Trusted, bounded calculations for original first-party teaching examples.
// Course strings are read as text and asserted, never evaluated as code.
// No student programs, official answer keys, or judge implementations are run.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';

const here = new URL('./', import.meta.url);
const binary = (op, left, right) => ({ op, left, right });
const operators = new Set(['+', '-', '*', '/', '^', '=']);
const gcd = (a, b) => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
function fraction(n, d = 1n) {
  assert.notEqual(d, 0n, 'division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}
function operation(op, a, b) {
  if (op === '+') return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
  if (op === '-') return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
  if (op === '*') return fraction(a.n * b.n, a.d * b.d);
  if (op === '/') return fraction(a.n * b.d, a.d * b.n);
  assert.equal(op, '^');
  assert.ok(b.d === 1n && b.n >= 0n && b.n <= 12n, 'bounded integer exponent');
  return fraction(a.n ** b.n, a.d ** b.n);
}
function value(token, environment) {
  if (/^-?\d+$/.test(token)) return fraction(BigInt(token));
  assert.match(token, /^[A-Za-z]+$/);
  assert.ok(Object.hasOwn(environment, token), `missing original-example variable ${token}`);
  return fraction(BigInt(environment[token]));
}
const display = ({ n, d }) => d === 1n ? String(n)
  : d === 2n ? `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / 2n}.5` : `${n}/${d}`;
function evaluate(tree, environment = {}) {
  if (typeof tree === 'string') return value(tree, environment);
  if (tree.op === '=') {
    assert.equal(typeof tree.left, 'string');
    assert.match(tree.left, /^[A-Za-z]+$/);
    // Validate assignment structure and compute its RHS without mutating state.
    return evaluate(tree.right, environment);
  }
  return operation(tree.op, evaluate(tree.left, environment), evaluate(tree.right, environment));
}
const prefix = tree => typeof tree === 'string' ? tree : `${tree.op} ${prefix(tree.left)} ${prefix(tree.right)}`;
const postfix = tree => typeof tree === 'string' ? tree : `${postfix(tree.left)} ${postfix(tree.right)} ${tree.op}`;
const infix = tree => typeof tree === 'string' ? tree : `(${infix(tree.left)} ${tree.op} ${infix(tree.right)})`;
function tokens(text) {
  const result = text.split(/\s+/);
  assert.ok(result.length > 0 && result.length <= 100);
  assert.ok(result.every(token => operators.has(token) || /^-?\d+$|^[A-Za-z]+$/.test(token)));
  return result;
}
function parsePrefix(text) {
  const input = tokens(text);
  let position = 0;
  function take() {
    assert.ok(position < input.length, 'prefix missing operand');
    const token = input[position++];
    return operators.has(token) ? binary(token, take(), take()) : token;
  }
  const result = take();
  assert.equal(position, input.length, 'prefix extra operand');
  return result;
}
function parsePostfix(text) {
  const stack = [];
  for (const token of tokens(text)) {
    if (!operators.has(token)) stack.push(token);
    else {
      assert.ok(stack.length >= 2, 'postfix missing operand');
      const right = stack.pop(), left = stack.pop();
      stack.push(binary(token, left, right));
    }
  }
  assert.equal(stack.length, 1, 'postfix extra operand');
  return stack[0];
}
// This value-stack algorithm is independent of recursive tree evaluation.
function stackTrace(text, mode, environment = {}) {
  const input = tokens(text), stack = [], rows = [];
  if (mode === 'prefix') input.reverse();
  for (const token of input) {
    if (!operators.has(token)) stack.push(value(token, environment));
    else {
      assert.notEqual(token, '=', 'numeric stack does not evaluate assignments');
      assert.ok(stack.length >= 2, 'stack missing operand');
      const first = stack.pop(), second = stack.pop();
      stack.push(mode === 'prefix' ? operation(token, first, second) : operation(token, second, first));
    }
    rows.push([token, `[${stack.map(display).join(', ')}]`]);
  }
  assert.equal(stack.length, 1, 'stack extra operand');
  return { rows, result: stack[0] };
}
function nativeTree(tree) {
  const label = node => typeof node === 'string' ? node : node.op;
  const lines = [label(tree)];
  function visit(node, indentation) {
    if (typeof node === 'string') return;
    for (const [index, child] of [node.left, node.right].entries()) {
      lines.push(`${indentation}${index ? '└─ ' : '├─ '}${label(child)}`);
      visit(child, `${indentation}${index ? '   ' : '│  '}`);
    }
  }
  visit(tree, '');
  return lines.join('\n');
}
function counts(tree) {
  if (typeof tree === 'string') return [1, 0];
  const left = counts(tree.left), right = counts(tree.right);
  return [left[0] + right[0], left[1] + right[1] + 1];
}
const tables = text => [...text.matchAll(/^\|[^\n]*\|(?:\n\|[^\n]*\|)*/gm)].map(match =>
  match[0].split('\n').slice(2).map(row => row.slice(1, -1).split('|').map(cell => cell.trim())));
const unquote = text => text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1) : text;
const b = binary;

export async function checkTutorial() {
  const docs = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => {
    const source = await readFile(new URL(`course.${language}.md`, here), 'utf8');
    const document = parseLearningMarkdown(source);
    assert.equal(document.chapters.length, 3);
    return [language, document];
  })));
  let cases = 0;
  const contains = (chapter, field, anchor) => {
    for (const [language, doc] of Object.entries(docs))
      assert.ok(doc.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: ${anchor}`);
  };
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const forms = (tree, chapter, field, { withInfix = true } = {}) => {
    contains(chapter, field, `\`${prefix(tree)}\``);
    contains(chapter, field, `\`${postfix(tree)}\``);
    if (withInfix) contains(chapter, field, `\`${infix(tree)}\``);
    equal('prefix and postfix reconstruct the same ordered tree', [parsePrefix(prefix(tree)), parsePostfix(postfix(tree))], [tree, tree]);
  };
  const calculate = (label, tree, expected, environment = {}) => {
    const actual = evaluate(tree, environment);
    equal(label, display(actual), String(expected));
    if (tree.op !== '=') {
      assert.deepEqual(stackTrace(prefix(tree), 'prefix', environment).result, actual);
      assert.deepEqual(stackTrace(postfix(tree), 'postfix', environment).result, actual);
    }
    return actual;
  };
  const traceTable = (chapter, field, tableIndex, rows) => {
    for (const doc of Object.values(docs)) {
      const table = tables(doc.chapters[chapter][field])[tableIndex];
      assert.ok(table, 'missing displayed table');
      assert.deepEqual(table.map(row => [unquote(row[0]), unquote(row.at(-1))]), rows);
    }
  };

  const first = b('*', b('+', '7', '5'), b('-', '9', '4'));
  forms(first, 0, 'content');
  contains(0, 'content', `\n${nativeTree(first)}\n`);
  equal('first tree leaf/operator count', counts(first), [4, 3]);
  calculate('first tree value', first, 60);
  for (const anchor of ['$7+5=12$', '$9-4=5$', '$12\\cdot5=60$']) contains(0, 'content', anchor);
  for (const doc of Object.values(docs)) {
    const rows = tables(doc.chapters[0].content)[0];
    assert.deepEqual(rows.map(row => row.slice(1).map(unquote)), [first.left, first.right, first].map(tree => [prefix(tree), infix(tree), postfix(tree)]));
  }
  const leftPower = b('^', b('^', '2', '3'), '2'), rightPower = b('^', '2', b('^', '3', '2'));
  calculate('explicit left-grouped power', leftPower, 64); contains(0, 'content', '$(2^3)^2=64$');
  calculate('explicit right-grouped power', rightPower, 512); contains(0, 'content', '$2^{(3^2)}=512$');

  const timesFirst = b('+', '6', b('*', '3', '4')), sumFirst = b('*', b('+', '6', '3'), '4');
  contains(0, 'checkpoint', '`6 + 3 * 4`'); contains(0, 'checkpoint', '`(6 + 3) * 4`');
  forms(timesFirst, 0, 'checkpointAnswer'); forms(sumFirst, 0, 'checkpointAnswer');
  calculate('precedence checkpoint', timesFirst, 18); contains(0, 'checkpointAnswer', '$6+3\\cdot4=6+12=18$');
  calculate('changed-parentheses checkpoint', sumFirst, 36); contains(0, 'checkpointAnswer', '$(6+3)\\cdot4=9\\cdot4=36$');
  for (const [tree, result, equation] of [
    [b('-', b('-', '12', '5'), '1'), 6, '$(12-5)-1=6$'],
    [b('-', '12', b('-', '5', '1')), 8, '$12-(5-1)=8$'],
    [b('/', '8', b('+', '2', '2')), 2, '$8/(2+2)=8/4=2$'],
    [b('+', b('/', '8', '2'), '2'), 6, '$8/2+2=4+2=6$']
  ]) {
    calculate('grouping checkpoint', tree, result);
    contains(0, 'checkpointAnswer', equation);
    contains(0, 'checkpointAnswer', `\`${tree.op === '-' ? prefix(tree) : postfix(tree)}\``);
  }

  const worked = b('/', b('*', b('-', '9', '4'), b('+', '6', '2')), '5');
  forms(worked, 1, 'content', { withInfix: false });
  calculate('shared prefix/postfix worked value', worked, 8);
  const postTrace = stackTrace(postfix(worked), 'postfix'), preTrace = stackTrace(prefix(worked), 'prefix');
  traceTable(1, 'content', 0, postTrace.rows);
  traceTable(1, 'content', 1, preTrace.rows);
  equal('postfix full stack trace', postTrace.rows.map(row => row[1]), ['[9]', '[9, 4]', '[5]', '[5, 6]', '[5, 6, 2]', '[5, 8]', '[40]', '[40, 5]', '[8]']);
  equal('prefix full stack trace', preTrace.rows.map(row => row[1]), ['[5]', '[5, 2]', '[5, 2, 6]', '[5, 8]', '[5, 8, 4]', '[5, 8, 4, 9]', '[5, 8, 5]', '[5, 40]', '[8]']);
  contains(1, 'content', '\\frac{(9-4)(6+2)}5=\\frac{5\\cdot8}{5}=8.');
  for (const anchor of ['$l=9$', '$r=4$', '$9-4=5$', '$l=6$', '$r=2$', '$6+2=8$', '$l=5$', '$r=8$', '$5\\cdot8=40$', '$l=40$', '$r=5$', '$40/5=8$']) contains(1, 'content', anchor);
  calculate('ordinary division convention', b('/', '7', '2'), '3.5'); contains(1, 'content', '$7/2=3.5$');
  calculate('negative variable operand', b('-', 'u', 'v'), -5, { u: -3, v: 2 });
  contains(1, 'content', '$u=-3$'); contains(1, 'content', '$v=2$'); contains(1, 'content', '$(-3)-2=-5$');

  const powerCheck = b('+', b('^', b('-', '8', '3'), '2'), '6');
  contains(1, 'checkpoint', `\`${postfix(powerCheck)}\``);
  calculate('postfix exponent checkpoint', powerCheck, 31);
  traceTable(1, 'checkpointAnswer', 0, stackTrace(postfix(powerCheck), 'postfix').rows);
  contains(1, 'checkpointAnswer', '$(8-3)^2+6=25+6=31$');
  const prefixCheck = b('-', b('/', '18', '3'), b('+', '2', '1'));
  contains(1, 'checkpoint', `\`${prefix(prefixCheck)}\``);
  calculate('prefix operand-order checkpoint', prefixCheck, 3);
  contains(1, 'checkpointAnswer', '`1 2 + 3 18 / -`');
  for (const [, stack] of stackTrace(prefix(prefixCheck), 'prefix').rows) contains(1, 'checkpointAnswer', `\`${stack}\``);
  contains(1, 'checkpointAnswer', '$18/3-(2+1)=6-3=3$');
  const negativeCheck = b('*', b('-', 'u', 'v'), 'u');
  contains(1, 'checkpoint', `\`${postfix(negativeCheck)}\``);
  calculate('negative-variable checkpoint', negativeCheck, 15, { u: -3, v: 2 });
  for (const [, stack] of stackTrace(postfix(negativeCheck), 'postfix', { u: -3, v: 2 }).rows) contains(1, 'checkpointAnswer', `\`${stack}\``);
  contains(1, 'checkpointAnswer', '$(u-v)u=(-3-2)(-3)=15$');
  const fractionalCheck = b('+', b('/', '7', '2'), '3');
  contains(1, 'checkpoint', `\`${postfix(fractionalCheck)}\``);
  calculate('noninteger postfix checkpoint', fractionalCheck, '6.5');
  for (const [, stack] of stackTrace(postfix(fractionalCheck), 'postfix').rows) contains(1, 'checkpointAnswer', `\`${stack}\``);
  contains(1, 'checkpointAnswer', '$7/2+3=6.5$');
  for (const [invalid, error, anchor] of [['4 + 2', /missing operand/, '`[4]`'], ['4 2', /extra operand/, '`[4, 2]`']]) {
    contains(1, 'checkpoint', `\`${invalid}\``);
    contains(1, 'checkpointAnswer', `\`${invalid}\``); contains(1, 'checkpointAnswer', anchor);
    assert.throws(() => stackTrace(invalid, 'postfix'), error);
    assert.throws(() => parsePostfix(invalid), error);
    cases++;
  }
  assert.throws(() => parsePrefix('+ 4'), /missing operand/); contains(0, 'content', '`+ 4`'); cases++;

  const assignment = b('=', 'R', b('/', b('-', 'u', 'v'), b('^', b('+', 'w', '2'), '2')));
  forms(assignment, 2, 'content', { withInfix: false });
  contains(2, 'content', `\n${nativeTree(assignment)}\n`);
  contains(2, 'content', 'R=\\frac{u-v}{(w+2)^2}.');
  contains(2, 'content', '`R = ((u - v) / ((w + 2) ^ 2))`');
  equal('assignment tree leaf/operator counts', counts(assignment), [6, 5]);
  equal('assignment RHS leaf/operator counts', counts(assignment.right), [5, 4]);
  calculate('assignment example value', assignment, 1, { u: 14, v: 5, w: 1 });
  for (const anchor of ['$u=14$', '$v=5$', '$w=1$', '$14-5=9$', '$(1+2)^2=9$', '$R=9/9=1$']) contains(2, 'content', anchor);
  assert.throws(() => evaluate(assignment, { u: 14, v: 5, w: -2 }), /division by zero/); contains(2, 'content', '$w=-2$'); cases++;
  const parts = [assignment.right.left, assignment.right.right.left, assignment.right.right, assignment.right, assignment];
  for (const doc of Object.values(docs)) {
    assert.deepEqual(tables(doc.chapters[2].content)[0].map(row => row.slice(1).map(unquote)), parts.map(tree => [prefix(tree), postfix(tree)]));
  }
  const fragments = [], fragmentRows = [];
  for (const token of tokens(postfix(assignment.right))) {
    if (!operators.has(token)) fragments.push(token);
    else {
      const right = fragments.pop(), left = fragments.pop();
      fragments.push(`(${left} ${token} ${right})`);
      fragmentRows.push([token, `[${fragments.join(', ')}]`]);
    }
  }
  traceTable(2, 'content', 1, fragmentRows);
  equal('fragment reconstruction', fragments, [infix(assignment.right)]);

  const convert = b('-', b('*', 'a', b('+', 'b', 'c')), b('/', 'd', 'e'));
  contains(2, 'checkpoint', `\`${prefix(convert)}\``);
  contains(2, 'checkpointAnswer', `\`${infix(convert)}\``);
  contains(2, 'checkpointAnswer', `\`${postfix(convert)}\``);
  equal('symbolic prefix conversion', parsePrefix(prefix(convert)), parsePostfix(postfix(convert)));
  calculate('symbolic conversion example', convert, 18, { a: 3, b: 2, c: 5, d: 18, e: 6 });
  contains(2, 'checkpointAnswer', '$3(2+5)-18/6=21-3=18$');
  const implicit = b('=', 'S', b('+', b('*', '3', 't'), '1'));
  contains(2, 'checkpoint', '$S=3t+1$'); contains(2, 'checkpoint', '$t=4$');
  forms(implicit, 2, 'checkpointAnswer', { withInfix: false });
  contains(2, 'checkpointAnswer', '`S = ((3 * t) + 1)`');
  calculate('implicit multiplication assignment', implicit, 13, { t: 4 });
  contains(2, 'checkpointAnswer', '$S=3\\cdot4+1=13$');
  const original = b('*', b('+', 'a', 'b'), 'c'), incorrect = b('+', 'a', b('*', 'b', 'c'));
  forms(original, 2, 'checkpointAnswer');
  contains(2, 'checkpoint', `\`${prefix(incorrect)}\``);
  contains(2, 'checkpointAnswer', `\`${infix(incorrect)}\``);
  assert.notDeepEqual(original, incorrect);
  equal('coincidental equal values are not structural proof', [display(evaluate(original, { a: 0, b: 3, c: 4 })), display(evaluate(incorrect, { a: 0, b: 3, c: 4 }))], ['12', '12']);
  for (const field of ['content', 'checkpoint']) for (const anchor of ['$a=0$', '$b=3$', '$c=4$']) contains(2, field, anchor);
  calculate('discriminating input original tree', original, 20, { a: 2, b: 3, c: 4 });
  calculate('discriminating input incorrect tree', incorrect, 14, { a: 2, b: 3, c: 4 });
  contains(2, 'checkpointAnswer', '$(2+3)4=20$'); contains(2, 'checkpointAnswer', '$2+3\\cdot4=14$');

  // Bilingual examples must retain identical complete trees and displayed states.
  for (let index = 0; index < 3; index++) {
    const en = docs.en.chapters[index], zh = docs.zh.chapters[index];
    for (const field of ['checkpoint', 'checkpointAnswer']) {
      const labels = text => [...text.matchAll(/^\*\*(\d+)\.\*\*/gm)].map(match => Number(match[1]));
      assert.deepEqual(labels(en[field]), Array.from({ length: [3, 4, 3][index] }, (_, i) => i + 1));
      assert.deepEqual(labels(zh[field]), labels(en[field]));
    }
    assert.deepEqual([...en.content.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match => match[1]), [...zh.content.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match => match[1]));
  }
  const map = JSON.parse(await readFile(new URL('practice-map.json', here), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../../curriculum.json', here), 'utf8'));
  assert.equal(map.version, 1); assert.equal(map.unitId, 'expressions'); assert.equal(map.chapters.length, 3);
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  const mapped = map.chapters.flatMap((chapter, position) => {
    assert.equal(chapter.position, position); assert.ok(chapter.key.trim()); return chapter.references;
  }).map(key);
  assert.equal(mapped.length, 12); assert.equal(new Set(mapped).size, 12);
  assert.deepEqual(mapped.toSorted(), manifest.units.find(unit => unit.id === 'expressions').practiceReferences.map(key).toSorted());
  return { cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await checkTutorial(), null, 2));
