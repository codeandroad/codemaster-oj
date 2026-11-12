// Trusted, finite calculations for this unit's original teaching examples.
// Inputs below are authored literals; Markdown is only read and compared.
// This is not a Lisp interpreter and never evaluates document or student code.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';

const here = new URL('./', import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
const nil = [];

function bounded(value, depth = 0) {
  assert.ok(depth <= 8, 'Only small, bounded teaching values are allowed');
  if (Array.isArray(value)) {
    assert.ok(value.length <= 12);
    value.forEach(child => bounded(child, depth + 1));
  } else assert.ok(typeof value === 'string' ? /^[A-Z]+$/.test(value)
    : typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000);
  return value;
}
function list(value) { bounded(value); assert.ok(Array.isArray(value), 'A proper list is required'); return value; }
function car(value) { const items = list(value); assert.ok(items.length > 0, 'Examples do not apply CAR to the empty list'); return items[0]; }
const cdr = value => list(value).slice(1);
const reverse = value => list(value).toReversed();
const cons = (first, rest) => bounded([bounded(first), ...list(rest)]);
const atom = value => { bounded(value); return !Array.isArray(value) || value.length === 0; };
function show(value) {
  bounded(value);
  return Array.isArray(value) ? value.length ? `(${value.map(show).join(' ')})` : 'NIL' : String(value);
}
function selector(name, input) {
  assert.match(name, /^C[AD]{1,4}R$/);
  return [...name.slice(1, -1)].toReversed().reduce((value, operation) => operation === 'A' ? car(value) : cdr(value), input);
}
const sum = (...values) => values.reduce((total, value) => total + value, 0);
const product = (...values) => values.reduce((total, value) => total * value, 1);
const sub = (a, b) => a - b;
const div = (a, b) => { assert.notEqual(b, 0); return a / b; };
const codeBlocks = text => [...text.matchAll(/```(?:lisp|text)\n([\s\S]*?)\n```/g)].map(match => match[1]);

export async function checkTutorial() {
  const docs = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => {
    const raw = await readFile(new URL(`course.${language}.md`, here), 'utf8');
    const doc = parseLearningMarkdown(raw);
    assert.equal(doc.chapters.length, 3);
    return [language, doc];
  })));
  let cases = 0;
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); cases++; };
  const portion = (doc, chapter, field, number) => {
    const text = doc.chapters[chapter][field];
    if (!number) return text;
    const sections = text.split(/^\*\*(\d+)\.\*\* /m);
    const index = sections.findIndex((value, index) => index % 2 === 1 && value === String(number));
    assert.ok(index > 0, `${chapter + 1}/${field}: checkpoint ${number} exists`);
    return sections[index + 1];
  };
  const contains = (chapter, field, anchor, number) => {
    for (const [language, doc] of Object.entries(docs))
      assert.ok(portion(doc, chapter, field, number).includes(anchor),
        `${language}/${chapter + 1}/${field}/${number ?? 'body'}: missing computed anchor ${anchor}`);
  };
  const inline = (chapter, field, expression, number) => contains(chapter, field, `\`${expression}\``, number);
  const block = (chapter, field, code, number) => {
    for (const [language, doc] of Object.entries(docs))
      assert.ok(codeBlocks(portion(doc, chapter, field, number)).includes(code), `${language}/${chapter + 1}: exact displayed code block`);
  };
  const resultRow = (chapter, expression, value) => contains(chapter, 'content', `| \`${expression}\` | \`${value}\` |`);
  const answerValues = (chapter, number, values) => values.forEach(value => inline(chapter, 'checkpointAnswer', show(value), number));
  const checkpointCall = (chapter, number, expression) => inline(chapter, 'checkpoint', expression, number);

  for (let chapter = 0; chapter < 3; chapter++) {
    for (const field of ['content', 'checkpoint', 'checkpointAnswer'])
      assert.deepEqual(codeBlocks(docs.en.chapters[chapter][field]), codeBlocks(docs.zh.chapters[chapter][field]),
        `${chapter + 1}/${field}: bilingual code, tree and trace blocks must agree`);
    for (const doc of Object.values(docs)) {
      for (const field of ['checkpoint', 'checkpointAnswer'])
        assert.deepEqual([...doc.chapters[chapter][field].matchAll(/^\*\*(\d+)\.\*\* /gm)].map(match => Number(match[1])), [1, 2, 3, 4]);
    }
  }

  const directions = ['NORTH', ['EAST', 'WEST'], 'SOUTH', nil];
  equal('outer list length and shape', directions.length, 4);
  block(0, 'content', "'(NORTH (EAST WEST) SOUTH ())");
  block(0, 'content', 'outer list\n├─ NORTH\n├─ (EAST WEST)\n│  ├─ EAST\n│  └─ WEST\n├─ SOUTH\n└─ ()');
  directions.forEach((value, index) => contains(0, 'content', `| ${index + 1} | \`${index === 3 ? '()' : show(value)}\` |`));
  const directionOperations = [
    ["(CAR '(NORTH (EAST WEST) SOUTH ()))", car(directions), 'NORTH'],
    ["(CDR '(NORTH (EAST WEST) SOUTH ()))", cdr(directions), [['EAST', 'WEST'], 'SOUTH', []]],
    ["(CAR (CDR '(NORTH (EAST WEST) SOUTH ())))", car(cdr(directions)), ['EAST', 'WEST']]
  ];
  for (const [expression, value, expected] of directionOperations) {
    equal(expression, value, expected);
    // This table chooses () rather than NIL to show the empty nested element.
    resultRow(0, expression, show(value).replaceAll(' NIL)', ' ())'));
  }
  block(0, 'content', "(CAR (CDR '(NORTH (EAST WEST) SOUTH ())))\nCDR result: ((EAST WEST) SOUTH ())\nCAR result: (EAST WEST)");
  equal('singleton outer and singleton inner list differ', [cdr(['NORTH']), car([['NORTH']])], [[], ['NORTH']]);
  block(0, 'content', `(CDR '(NORTH))       => ${show(cdr(['NORTH']))}\n(CAR '((NORTH)))     => ${show(car([['NORTH']]))}`);
  equal('ATOM symbol, nonempty list, and NIL', [atom('NORTH'), atom(['NORTH']), atom(nil)], [true, false, true]);
  for (const [expression, value] of [["(ATOM 'NORTH)", atom('NORTH')], ["(ATOM '(NORTH))", atom(['NORTH'])], ['(ATOM NIL)', atom(nil)]])
    resultRow(0, expression, value ? 'true' : 'NIL');
  assert.throws(() => car('NORTH'), /proper list/);
  inline(0, 'content', "(CAR 'NORTH)");

  const colors = [['RED', 'BLUE'], 'GREEN', ['GOLD'], 'WHITE'];
  equal('chapter 1 checkpoint 1', [colors.length, car(colors), cdr(colors)], [4, ['RED', 'BLUE'], ['GREEN', ['GOLD'], 'WHITE']]);
  checkpointCall(0, 1, "'((RED BLUE) GREEN (GOLD) WHITE)");
  answerValues(0, 1, [...colors, car(colors), cdr(colors)]);
  assert.ok(portion(docs.en, 0, 'checkpointAnswer', 1).includes('**4 top-level elements**'));
  assert.ok(portion(docs.zh, 0, 'checkpointAnswer', 1).includes('**4 个顶层元素**'));
  equal('chapter 1 checkpoint 2', [atom('RED'), atom(['RED']), cdr(['RED']), car(['RED'])], [true, false, [], 'RED']);
  for (const expression of ["(ATOM 'RED)", "(ATOM '(RED))", "(CDR '(RED))", "(CAR 'RED)", "(CAR '(RED))"])
    checkpointCall(0, 2, expression);
  assert.throws(() => car('RED'), /proper list/);
  answerValues(0, 2, [[], 'RED']); inline(0, 'checkpointAnswer', 'true', 2);
  const animals = [['FOX', 'OWL']];
  equal('chapter 1 checkpoint 3', [animals.length, cdr(animals), car(animals)], [1, [], ['FOX', 'OWL']]);
  checkpointCall(0, 3, "(CDR '((FOX OWL)))"); checkpointCall(0, 3, "(CAR '((FOX OWL)))");
  answerValues(0, 3, [cdr(animals), car(animals)]);
  const emptyFirst = [nil, 'EAST'];
  equal('chapter 1 checkpoint 4', [emptyFirst.length, car(emptyFirst), cdr(emptyFirst)], [2, [], ['EAST']]);
  checkpointCall(0, 4, "(CAR '(() EAST))"); checkpointCall(0, 4, "(CDR '(() EAST))");
  answerValues(0, 4, [car(emptyFirst), cdr(emptyFirst)]);
  assert.ok(portion(docs.en, 0, 'checkpointAnswer', 4).includes('**2 top-level elements**'));
  assert.ok(portion(docs.zh, 0, 'checkpointAnswer', 4).includes('**2 个顶层元素**'));

  const bag = [['MAP', ['KEY', 'COIN'], 'PEN'], ['CUP', 'BOOK'], 'HAT'];
  const trace = [car(bag)]; trace.push(cdr(trace.at(-1))); trace.push(reverse(trace.at(-1))); trace.push(car(trace.at(-1)));
  equal('four-step nested CAR/CDR/REVERSE/CAR trace', trace,
    [['MAP', ['KEY', 'COIN'], 'PEN'], [['KEY', 'COIN'], 'PEN'], ['PEN', ['KEY', 'COIN']], 'PEN']);
  block(1, 'content', "(CAR (REVERSE (CDR (CAR '((MAP (KEY COIN) PEN) (CUP BOOK) HAT)))))");
  for (const doc of Object.values(docs)) {
    const rows = doc.chapters[1].content.split('\n').filter(line => /^\| [1-4] \|/.test(line));
    assert.equal(rows.length, 4);
    rows.forEach((row, index) => assert.equal(row.split('|')[3].trim(), `\`${show(trace[index])}\``));
  }
  equal('reverse changes only outer order', reverse(bag), ['HAT', ['CUP', 'BOOK'], ['MAP', ['KEY', 'COIN'], 'PEN']]);
  equal('reverse explicitly selected sublist', reverse(['KEY', 'COIN']), ['COIN', 'KEY']);
  block(1, 'content', `(REVERSE '((MAP (KEY COIN) PEN) (CUP BOOK) HAT))\n=> ${show(reverse(bag))}\n\n(REVERSE '(KEY COIN))\n=> ${show(reverse(['KEY', 'COIN']))}`);
  const consExamples = [
    ["(CONS 'KEY '(COIN PEN))", cons('KEY', ['COIN', 'PEN']), ['KEY', 'COIN', 'PEN']],
    ["(CONS '(KEY COIN) '(PEN))", cons(['KEY', 'COIN'], ['PEN']), [['KEY', 'COIN'], 'PEN']],
    ["(CONS '(KEY COIN) NIL)", cons(['KEY', 'COIN'], nil), [['KEY', 'COIN']]]
  ];
  for (const [expression, value, expected] of consExamples) { equal(expression, value, expected); resultRow(1, expression, show(value)); }
  assert.throws(() => cons('KEY', 'COIN'), /proper list/); inline(1, 'content', "(CONS 'KEY 'COIN)");
  block(1, 'content', '(CADR x)  = (CAR (CDR x))\n(CADAR x) = (CAR (CDR (CAR x)))');
  const notes = [['NOTE', ['PAGE', 'LINE'], 'TAB'], 'DESK'];
  equal('CADAR expanded trace', [car(notes), cdr(car(notes)), car(cdr(car(notes)))],
    [['NOTE', ['PAGE', 'LINE'], 'TAB'], [['PAGE', 'LINE'], 'TAB'], ['PAGE', 'LINE']]);
  equal('CADAR abbreviation agrees with explicit nested calls', selector('CADAR', notes), car(cdr(car(notes))));
  block(1, 'content', `(CADAR '((NOTE (PAGE LINE) TAB) DESK))\nCAR result: ${show(car(notes))}\nCDR result: ${show(cdr(car(notes)))}\nCAR result: ${show(selector('CADAR', notes))}`);

  const desk = ['LAMP', ['KEY', 'RING'], 'DESK'];
  equal('chapter 2 checkpoint 1', [cdr(desk), car(cdr(desk)), selector('CADR', desk)],
    [[['KEY', 'RING'], 'DESK'], ['KEY', 'RING'], ['KEY', 'RING']]);
  checkpointCall(1, 1, "(CAR (CDR '(LAMP (KEY RING) DESK)))");
  answerValues(1, 1, [cdr(desk), selector('CADR', desk)]); inline(1, 'checkpointAnswer', "(CADR '(LAMP (KEY RING) DESK))", 1);
  const reverseColors = [['RED', 'BLUE'], 'GREEN', ['GOLD', 'WHITE']];
  equal('chapter 2 checkpoint 2', [reverse(reverseColors), cdr(reverse(reverseColors))],
    [[['GOLD', 'WHITE'], 'GREEN', ['RED', 'BLUE']], ['GREEN', ['RED', 'BLUE']]]);
  checkpointCall(1, 2, "(CDR (REVERSE '((RED BLUE) GREEN (GOLD WHITE))))");
  answerValues(1, 2, [reverse(reverseColors), cdr(reverse(reverseColors))]);
  const insertedList = cons(['RED', 'BLUE'], ['GREEN']), insertedAtom = cons('RED', ['BLUE', 'GREEN']);
  equal('chapter 2 checkpoint 3', [insertedList, insertedList.length, insertedAtom, insertedAtom.length],
    [[['RED', 'BLUE'], 'GREEN'], 2, ['RED', 'BLUE', 'GREEN'], 3]);
  checkpointCall(1, 3, "(CONS '(RED BLUE) '(GREEN))"); checkpointCall(1, 3, "(CONS 'RED '(BLUE GREEN))");
  answerValues(1, 3, [insertedList, insertedAtom]);
  for (const n of [2, 3]) {
    assert.ok(portion(docs.en, 1, 'checkpointAnswer', 3).includes(`**${n} top-level elements**`));
    assert.ok(portion(docs.zh, 1, 'checkpointAnswer', 3).includes(`**${n} 个顶层元素**`));
  }
  const stationery = [['INK', ['PEN', 'PAPER'], 'CLIP'], 'CUP'];
  const stationeryTrace = [car(stationery), cdr(car(stationery)), car(cdr(car(stationery)))];
  equal('chapter 2 checkpoint 4', stationeryTrace,
    [['INK', ['PEN', 'PAPER'], 'CLIP'], [['PEN', 'PAPER'], 'CLIP'], ['PEN', 'PAPER']]);
  equal('extra CAR is required to obtain PEN', car(stationeryTrace.at(-1)), 'PEN');
  checkpointCall(1, 4, "(CAR (CDR (CAR '((INK (PEN PAPER) CLIP) CUP))))");
  answerValues(1, 4, [...stationeryTrace, car(stationeryTrace.at(-1))]);

  const inner = [product(3, 7), sub(14, 5), div(15, 2)];
  equal('arithmetic worked example inner values and sum', [...inner, sum(...inner, 4)], [21, 9, 7.5, 41.5]);
  equal('independent exact numerator check', (3 * 7 * 2 + (14 - 5) * 2 + 15 + 4 * 2) / 2, sum(...inner, 4));
  block(2, 'content', '(ADD (MULT 3 7) (SUB 14 5) (DIV 15 2) 4)');
  block(2, 'content', `(${['ADD', '(MULT 3 7)', '(SUB 14 5)', '(DIV 15 2)', 4].join(' ')})\n=> (ADD ${[...inner, 4].join(' ')})\n=> ${sum(...inner, 4)}`);
  block(2, 'content', '(+ (* 3 7) (- 14 5) (/ 15 2) 4)');
  contains(2, 'content', '| `(MULT 3 7)` | $3\\cdot7$ | 21 |');
  contains(2, 'content', '| `(SUB 14 5)` | $14-5$ | 9 |');
  contains(2, 'content', '| `(DIV 15 2)` | $15/2$ | 7.5 |');
  contains(2, 'content', '$21+9+15/2+4=83/2=41.5$');
  equal('reversed SUB arguments have the opposite result', sub(5, 14), -9);
  inline(2, 'content', '(SUB 5 14)'); contains(2, 'content', '$-9$');

  // This binding model looks up fixed data and separately calculates the fixed
  // formula. It deliberately provides no general EVAL or Markdown parser.
  const form = ['ADD', 4, ['MULT', 2, 6]], formValue = sum(4, product(2, 6));
  const bindings = new Map([['FORM', structuredClone(form)]]);
  equal('quoted expression is a three-element list; arithmetic returns 16', [form.length, atom(form), formValue], [3, false, 16]);
  block(2, 'content', `(ADD 4 (MULT 2 6))   => ${formValue}\n'(ADD 4 (MULT 2 6))  => ${show(form)}`);
  block(2, 'content', "(SETQ FORM '(ADD 4 (MULT 2 6)))\n(ATOM 'FORM)\n(ATOM FORM)\n(EVAL 'FORM)\n(EVAL FORM)");
  const statementValues = [
    ["(SETQ FORM '(ADD 4 (MULT 2 6)))", show(bindings.get('FORM'))],
    ["(ATOM 'FORM)", atom('FORM') ? 'true' : 'NIL'],
    ['(ATOM FORM)', atom(bindings.get('FORM')) ? 'true' : 'NIL'],
    ["(EVAL 'FORM)", show(bindings.get('FORM'))],
    ['(EVAL FORM)', String(formValue)]
  ];
  equal('fixed binding trace return values', statementValues.map(([, value]) => value),
    ['(ADD 4 (MULT 2 6))', 'true', 'NIL', '(ADD 4 (MULT 2 6))', '16']);
  for (const [statement, value] of statementValues)
    contains(2, 'content', `| \`${statement}\` | \`${value}\` | \`${show(bindings.get('FORM'))}\` |`);
  equal('returning evaluated value does not reassign FORM', bindings.get('FORM'), form);

  const selfInner = [sum(3, 4, 1), sub(11, 6), div(9, 2)];
  equal('chapter 3 checkpoint 1', [...selfInner, product(...selfInner)], [8, 5, 4.5, 180]);
  assert.equal(product(...selfInner), (3 + 4 + 1) * (11 - 6) * 9 / 2);
  block(2, 'checkpoint', '(MULT (ADD 3 4 1) (SUB 11 6) (DIV 9 2))', 1);
  inline(2, 'checkpointAnswer', `(MULT ${selfInner.join(' ')})`, 1);
  contains(2, 'checkpointAnswer', '$8\\cdot5\\cdot4.5=180$', 1);
  contains(2, 'checkpointAnswer', '$8\\cdot5\\cdot9/2=180$', 1);
  const quotedSub = ['SUB', 12, 5], subValue = sub(12, 5);
  equal('chapter 3 checkpoint 2', [quotedSub.length, atom(quotedSub), subValue, atom(subValue)], [3, false, 7, true]);
  checkpointCall(2, 2, "'(SUB 12 5)"); checkpointCall(2, 2, '(SUB 12 5)');
  answerValues(2, 2, [quotedSub, [], subValue]); inline(2, 'checkpointAnswer', 'true', 2);
  const p = ['MULT', 3, ['ADD', 2, 4]], pBindings = new Map([['P', structuredClone(p)]]), pValue = product(3, sum(2, 4));
  equal('chapter 3 checkpoint 3', [pBindings.get('P'), pValue, atom(pBindings.get('P'))], [p, 18, false]);
  block(2, 'checkpoint', "(SETQ P '(MULT 3 (ADD 2 4)))", 3);
  for (const expression of ["(EVAL 'P)", '(EVAL P)', '(ATOM P)']) checkpointCall(2, 3, expression);
  answerValues(2, 3, [p, pValue, []]); contains(2, 'checkpointAnswer', '$3\\cdot6=18$', 3);
  equal('P is still the original expression after evaluation', pBindings.get('P'), p);
  const repaired = [div(5, 2), sub(3, 8)];
  equal('chapter 3 checkpoint 4', [...repaired, sum(...repaired)], [2.5, -5, -2.5]);
  assert.equal(sum(...repaired), (5 + (3 - 8) * 2) / 2);
  checkpointCall(2, 4, '(ADD (DIV 5 2) (SUB 3 8))');
  inline(2, 'checkpointAnswer', '(DIV 5 2)', 4); inline(2, 'checkpointAnswer', '(SUB 3 8)', 4);
  inline(2, 'checkpointAnswer', `(ADD ${repaired.join(' ')})`, 4);
  contains(2, 'checkpointAnswer', '$3-8=-5$', 4); contains(2, 'checkpointAnswer', '$-2.5$', 4);

  const map = await readJson('practice-map.json'), manifest = await readJson('../../curriculum.json');
  assert.equal(map.version, 1); assert.equal(map.unitId, 'lisp'); assert.equal(map.chapters.length, 3);
  const references = map.chapters.flatMap((chapter, position) => {
    assert.equal(chapter.position, position); assert.ok(chapter.key.trim()); return chapter.references;
  });
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  assert.equal(references.length, 8); assert.equal(new Set(references.map(key)).size, 8);
  assert.deepEqual(references.map(key).sort(), manifest.units.find(unit => unit.id === 'lisp').practiceReferences.map(key).sort());
  return { cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await checkTutorial(), null, 2));
