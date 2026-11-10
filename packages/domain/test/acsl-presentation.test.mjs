import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertAcslPresentationOnly } from '../src/acsl-presentation.mjs';
import { validateAcslDiagrams } from '../src/acsl-diagrams.mjs';

const sample = JSON.parse(readFileSync(new URL('../content/acsl/sample.json', import.meta.url), 'utf8'));
const drawing = { en: [{ id: 'tree', width: 200, height: 100, alt: { en: 'Two tree nodes', zh: '两个树结点' }, elements: [
  { type: 'line', x1: 50, y1: 20, x2: 150, y2: 70, stroke: 'ink', strokeWidth: 2 },
  { type: 'circle', cx: 50, cy: 20, r: 10, fill: 'surface', stroke: 'accent' },
  { type: 'text', x: 50, y: 20, text: 'A', anchor: 'middle', font: 'mono', weight: 'bold' },
  { type: 'path', d: 'M 0 0 L 10 10 C 20 20 30 30 40 40 Q 50 50 60 60 Z', fill: 'none' },
] }], zh: [] };

test('native text, option labels and safe diagrams are display-only; grading fields and order are fixed', () => {
  const after = structuredClone(sample);
  after.title.zh += '（原生排版）'; after.questions[0].statement.en = 'Compute $a + b$.';
  after.questions[0].options[0].text.en = '$17$'; after.questions[0].statementDiagrams = drawing;
  after.questions[0].options[0].diagrams = drawing; after.questions[0].explanationDiagrams = drawing;
  after.programming.definition.statement += '\n\nNative layout.'; after.programming.statementDiagrams = drawing;
  assert.match(assertAcslPresentationOnly(sample, after), /^[a-f0-9]{64}$/);
  for (const mutate of [
    value => { value.questions[0].correctOptionIds = ['A']; },
    value => { value.questions[0].id = 'replaced'; },
    value => { value.questions[0].type = 'multiple'; },
    value => { value.questions.reverse(); },
    value => { value.questions[0].options.reverse(); },
    value => { value.questions[0].number = 99; },
    value => { value.questions[0].gradingRule = 'new'; },
    value => { value.programming.definition.tests[0].expected = 'wrong'; },
    value => { value.programming.definition.tests[0].weight += 1; },
    value => { value.programming.definition.samples[0].input += '\nchanged'; },
    value => { value.programming.definition.timeLimitMs += 1; },
    value => { value.programming.definition.memoryLimitMb += 1; },
    value => { value.programming.definition.referenceCode += '\n# changed'; },
    value => { value.programming.definition.starterCode += '\n# changed'; },
    value => { value.season = '2026-2027'; },
  ]) {
    const next = structuredClone(sample); mutate(next);
    assert.throws(() => assertAcslPresentationOnly(sample, next), /grading contract/, mutate.toString());
  }
});

test('diagram validation permits only bounded primitive data, never SVG markup or executable attributes', () => {
  assert.doesNotThrow(() => validateAcslDiagrams(drawing));
  const complexGraph = structuredClone(drawing);
  complexGraph.en[0].elements[3].d = 'M0 0 ' + 'L10 20 '.repeat(14000);
  complexGraph.en[0].elements[3].fill = 'orange';
  assert.doesNotThrow(() => validateAcslDiagrams(complexGraph), 'reviewed graph paths can exceed the old 20K limit');
  complexGraph.en[0].elements[3].d += 'L10 20 '.repeat(5000);
  assert.throws(() => validateAcslDiagrams(complexGraph), /diagram/, 'the 128K path bound remains enforced');
  for (const mutate of [
    value => { value.en[0].svg = '<svg/>'; },
    value => { value.en[0].elements[0].onClick = 'alert(1)'; },
    value => { value.en[0].elements[0].style = 'url(https://example.test)'; },
    value => { value.en[0].elements[0].stroke = 'url(#external)'; },
    value => { value.en[0].elements[0].x1 = Infinity; },
    value => { value.en[0].width = 5000; },
    value => { value.en[0].elements[2].font = 'url(example)'; },
    value => { value.en[0].elements[3].d = '<path onload="alert(1)" />'; },
    value => { value.en[0].elements[3].d = 'M0 0 H10'; },
    value => { value.en[0].elements[3].d = 'M0 0 L 1e999 1'; },
    value => { value.en[0].elements[3].d = 'M0'; },
    value => { value.en[0].elements[3].d = 'M0 0 C1 1 2 2'; },
    value => { value.en[0].elements.push({ type: 'foreignObject', text: 'HTML' }); },
  ]) {
    const next = structuredClone(drawing); mutate(next);
    assert.throws(() => validateAcslDiagrams(next), /diagram/, mutate.toString());
  }
});
