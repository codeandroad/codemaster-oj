// Independent logic, complete enumeration and wire connectivity checks for original content.
// No document text is executed and no formal-paper answer is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';
import { validAcslDiagrams } from '../../../../apps/web/src/components/acsl/diagram-validation.ts';
const here = new URL('./', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
const inputs = n => Array.from({ length: 2 ** n }, (_, i) => [...i.toString(2).padStart(n, '0')].map(Number));
const bit = value => { assert.ok(value === 0 || value === 1); return value; };
const gates = {
  NOT: a => Number(!bit(a)), AND: (a, b) => Number(Boolean(bit(a) && bit(b))),
  OR: (a, b) => Number(Boolean(bit(a) || bit(b))), NAND: (a, b) => Number(!(bit(a) && bit(b))),
  NOR: (a, b) => Number(!(bit(a) || bit(b))), XOR: (a, b) => Number(bit(a) !== bit(b)), XNOR: (a, b) => Number(bit(a) === bit(b)),
};
// Algebraic reference uses only arithmetic on 0/1, independent of the gate functions.
const algebra = { NOT: a => 1 - a, AND: (a, b) => a * b, OR: (a, b) => a + b - a * b,
  NAND: (a, b) => 1 - a * b, NOR: (a, b) => (1 - a) * (1 - b),
  XOR: (a, b) => a + b - 2 * a * b, XNOR: (a, b) => 1 - a - b + 2 * a * b };
const firstNodes = [{ name: 'p', kind: 'NOT', args: ['B'], x: 120, y: 190 },
  { name: 'q', kind: 'AND', args: ['A', 'p'], x: 280, y: 110 }, { name: 'Y', kind: 'OR', args: ['q', 'C'], x: 440, y: 180 }];
const countNodes = [{ name: 'p', kind: 'OR', args: ['A', 'B'], x: 160, y: 110 },
  { name: 'q', kind: 'NAND', args: ['B', 'C'], x: 160, y: 270 }, { name: 'Y', kind: 'XOR', args: ['p', 'q'], x: 350, y: 190 }];
const tiedNodes = [{ name: 'p', kind: 'NAND', args: ['A', 'B'], x: 130, y: 110 },
  { name: 'Y', kind: 'NAND', args: ['p', 'p'], x: 360, y: 110 }];
function calculate(nodes, values, implementation = gates) {
  const state = { ...values };
  for (const node of nodes) { assert.ok(node.args.every(arg => state[arg] !== undefined)); state[node.name] = implementation[node.kind](...node.args.map(arg => state[arg])); }
  return state;
}
const first = (A, B, C) => calculate(firstNodes, { A, B, C });
const count = (A, B, C) => calculate(countNodes, { A, B, C });
const triples = predicate => inputs(3).filter(row => predicate(...row)).map(row => row.join(''));
const tuple = row => '`(' + row.join(',') + ')`';
const tables = text => [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(match => match[0].trim().split('\n').slice(2)
  .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim().replace(/^`(.*)`$/, '$1'))));
function ports({ kind, x, y }) { return kind === 'NOT' ? [[x, y]] : [[x + (['OR', 'NOR', 'XOR'].includes(kind) ? 8 : 0), y - 12], [x + (['OR', 'NOR', 'XOR'].includes(kind) ? 8 : 0), y + 12]]; }
function output({ kind, x, y }) { return [x + { AND: 60, OR: 65, NOT: 60, NAND: 70, NOR: 75, XOR: 65 }[kind], y]; }
function shapePaths({ kind, x, y }) {
  const result = kind === 'AND' || kind === 'NAND'
    ? [`M ${x} ${y - 26} L ${x + 30} ${y - 26} C ${x + 46.57} ${y - 26} ${x + 60} ${y - 14.36} ${x + 60} ${y} C ${x + 60} ${y + 14.36} ${x + 46.57} ${y + 26} ${x + 30} ${y + 26} L ${x} ${y + 26} Z`]
    : kind === 'NOT' ? [`M ${x} ${y - 24} L ${x + 50} ${y} L ${x} ${y + 24} Z`]
      : [`M ${x} ${y - 26} Q ${x + 36} ${y - 26} ${x + 65} ${y} Q ${x + 36} ${y + 26} ${x} ${y + 26} Q ${x + 20} ${y} ${x} ${y - 26} Z`];
  if (kind === 'XOR') result.push(`M ${x - 8} ${y - 26} Q ${x + 12} ${y} ${x - 8} ${y + 26}`);
  return result;
}
const key = point => point.join(',');
// Derive connectivity from all polyline vertices. These circuit drawings intentionally
// use explicit junction vertices and no crossing wires. Check crossings separately below.
function wiring(diagram, originals, nodes, finalPoint) {
  const parent = new Map();
  const find = point => { const k = key(point); if (!parent.has(k)) parent.set(k, k); let root = k; while (parent.get(root) !== root) root = parent.get(root); return root; };
  const join = (a, b) => { parent.set(find(a), find(b)); };
  const wires = diagram.elements.filter(e => e.type === 'polyline');
  for (const wire of wires) for (let i = 1; i < wire.points.length; i++) join(wire.points[i - 1], wire.points[i]);
  const sources = [...Object.entries(originals), ...nodes.map(node => [node.name, output(node)])];
  const netNames = new Map();
  for (const [name, point] of sources) { assert.ok(parent.has(key(point)), `missing physical wire for ${name}`); const net = find(point); assert.ok(!netNames.has(net), 'two separately driven signals were shorted'); netNames.set(net, name); }
  const reconstructed = nodes.map(node => ({ ...node, args: ports(node).map(point => { assert.ok(parent.has(key(point))); const name = netNames.get(find(point)); assert.ok(name, 'gate input disconnected from a source'); return name; }) }));
  assert.equal(netNames.get(find(finalPoint)), 'Y');
  const segments = wires.flatMap(w => w.points.slice(1).map((point, i) => [w.points[i], point]));
  for (const [a, b] of segments) assert.ok(a[0] === b[0] || a[1] === b[1], 'wire must be orthogonal');
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    let [a, b] = segments[i], [c, d] = segments[j];
    if (a[0] === b[0] && c[1] === d[1]) [a, b, c, d] = [c, d, a, b];
    if (a[1] !== b[1] || c[0] !== d[0]) continue;
    const intersection = [c[0], a[1]];
    if (intersection[0] < Math.min(a[0], b[0]) || intersection[0] > Math.max(a[0], b[0]) || intersection[1] < Math.min(c[1], d[1]) || intersection[1] > Math.max(c[1], d[1])) continue;
    assert.ok([a, b].some(p => key(p) === key(intersection)) && [c, d].some(p => key(p) === key(intersection)), 'unmarked wire crossing or implicit T-junction');
  }
  return reconstructed;
}

export async function checkTutorial() {
  const documents = await Promise.all(['en', 'zh'].map(async language => {
    const text = await readFile(new URL(`course.${language}.md`, here), 'utf8');
    return { language, text, document: parseLearningMarkdown(text) };
  }));
  let cases = 0, modelComparisons = 0;
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); cases++; };
  const contains = (chapter, field, anchor) => {
    for (const { language, document } of documents) assert.ok(document.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: missing ${anchor}`);
    cases++;
  };
  const table = (chapter, index, expected) => {
    for (const { language, document } of documents) assert.deepEqual(tables(document.chapters[chapter].content)[index], expected.map(row => row.map(String)), `${language}/${chapter + 1}: table ${index}`);
    cases++;
  };
  const answer = (chapter, anchors) => anchors.forEach(anchor => contains(chapter, 'checkpointAnswer', anchor));
  for (const { language, document, text } of documents) {
    equal(`${language}: lesson count`, document.chapters.length, 3);
    assert.ok(!/@@|sourceimage|!\[.*?\]\(/.test(text));
    for (const chapter of document.chapters) for (const field of ['checkpoint', 'checkpointAnswer']) equal(`${language}: four ${field} items`, [...chapter[field].matchAll(/^\*\*(\d)\.\*\*/gm)].map(m => m[1]), ['1', '2', '3', '4']);
  }
  for (const kind of Object.keys(gates)) for (const [A, B] of inputs(2)) { equal(`${kind} Boolean and arithmetic definitions`, gates[kind](A, B), algebra[kind](A, B)); modelComparisons++; }
  for (const outer of ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']) for (const inner of ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']) for (const [A, B, C] of inputs(3)) {
    assert.equal(gates[outer](gates[inner](A, B), C), algebra[outer](algebra[inner](A, B), C)); modelComparisons++;
  }
  cases++;
  for (const row of inputs(3)) for (const net of [firstNodes, countNodes]) { assert.deepEqual(calculate(net, { A: row[0], B: row[1], C: row[2] }), calculate(net, { A: row[0], B: row[1], C: row[2] }, algebra)); modelComparisons++; }
  cases++;

  // Lesson 1: every displayed gate and intermediate output, then all four checks.
  table(0, 0, inputs(2).map(([A, B]) => [A, B, ...['AND', 'OR', 'NAND', 'NOR', 'XOR'].map(kind => gates[kind](A, B)), gates.NOT(A)]));
  const samples = [[1, 1, 0], [1, 0, 0], [0, 0, 1]];
  table(0, 1, samples.map(row => { const { p, q, Y } = first(...row); return [...row, p, q, Y]; }));
  for (const anchor of ['p=\\overline B', 'q=Ap', 'Y=q+C', '$Y=A\\overline B+C$']) contains(0, 'content', anchor);
  const gateCheck = ['AND', 'OR', 'NAND', 'NOR', 'XOR'].map(kind => gates[kind](1, 1)).concat(gates.NOT(1));
  equal('check 1 all-one gates', gateCheck, [1, 1, 0, 0, 0, 0]); answer(0, ['`' + gateCheck.join(',') + '`']);
  equal('check 2 C-only change', [[0, 1, 1], [0, 1, 0]].map(row => { const { p, q, Y } = first(...row); return [p, q, Y]; }), [[0, 0, 1], [0, 0, 0]]);
  answer(0, ['$p=\\overline1=0$', '$q=0\\cdot0=0$', '$Y=0+1=1$', '$Y=0+0=0$']);
  const newCircuit = (A, B, C) => { const u = gates.AND(A, B), v = gates.NOT(C); return { u, v, Z: gates.NOR(u, v) }; };
  equal('check 3 intermediate values', [newCircuit(1, 1, 0), newCircuit(0, 0, 1)], [{ u: 1, v: 1, Z: 0 }, { u: 0, v: 0, Z: 1 }]);
  answer(0, ['$Z=\\overline{AB+\\overline C}$', '`u=1,v=1,Z=0`', '`u=0,v=0,Z=1`']);
  for (const [A, B, C] of inputs(3)) { assert.equal(newCircuit(A, B, C).Z, (1 - A * B) * C); modelComparisons++; }
  const dependent = inputs(1).map(([A]) => { const p = gates.NOT(A); return [A, p, gates.AND(A, p), gates.OR(A, p)]; });
  equal('check 4 dependent complements', dependent, [[0, 1, 0, 1], [1, 0, 0, 1]]); answer(0, dependent.map(tuple));
  for (const [A] of inputs(1)) { equal('double inverter', gates.NOT(gates.NOT(A)), A); }

  // Lesson 2: independent inputs are enumerated before derived columns or restrictions.
  table(1, 0, inputs(3).map(row => { const { p, q, Y } = count(...row); return [...row, p, q, Y]; }));
  const yes = triples((...row) => count(...row).Y === 1), no = triples((...row) => count(...row).Y === 0);
  equal('count circuit true set', yes, ['000', '001', '011', '111']); equal('count circuit false set', no, ['010', '100', '101', '110']);
  [yes, no].forEach(rows => contains(1, 'content', '`' + rows.join(',') + '`'));
  equal('derived pair 00 cannot occur', triples((...row) => { const { p, q } = count(...row); return p === 0 && q === 0; }), []);
  equal('derived pair 11 has four preimages', triples((...row) => { const { p, q } = count(...row); return p === 1 && q === 1; }), no);
  const cOne = triples((A, B, C) => C === 1), cOneYes = triples((A, B, C) => C === 1 && count(A, B, C).Y === 1);
  equal('C=1 restriction', [cOne, cOneYes], [['001', '011', '101', '111'], ['001', '011', '111']]);
  [cOne, cOneYes].forEach(rows => contains(1, 'content', '`' + rows.join(',') + '`'));
  const acEqual = triples((A, B, C) => A === C), acEqualYes = triples((A, B, C) => A === C && count(A, B, C).Y === 1);
  equal('A=C restriction', [acEqual, acEqualYes], [['000', '010', '101', '111'], ['000', '111']]);
  [acEqual, acEqualYes].forEach(rows => contains(1, 'content', '`' + rows.join(',') + '`'));
  equal('four independent inputs with final AND', inputs(4).filter(([A, B, C, D]) => gates.AND(count(A, B, C).Y, D)).length, 4);
  equal('four independent inputs with final OR', inputs(4).filter(([A, B, C, D]) => gates.OR(count(A, B, C).Y, D)).length, 12);
  contains(1, 'content', '$H=YD$'); contains(1, 'content', '$J=Y+D$'); contains(1, 'content', '`12`');
  const tableFirst = inputs(3).map(row => { const { p, q, Y } = first(...row); return [...row, p, q, Y]; });
  answer(1, tableFirst.map(tuple));
  const firstYes = triples((...row) => first(...row).Y === 1), firstNo = triples((...row) => first(...row).Y === 0);
  equal('check 1 first circuit counts', [firstYes.length, firstNo.length], [5, 3]); answer(1, ['`' + firstYes.join(',') + '`', '`' + firstNo.join(',') + '`', '$5+3=8$']);
  const bZero = triples((A, B) => B === 0), bZeroYes = triples((A, B, C) => B === 0 && count(A, B, C).Y === 1);
  equal('check 2 B=0 constraint', [bZero, bZeroYes], [['000', '001', '100', '101'], ['000', '001']]);
  answer(1, ['`' + bZero.join(',') + '`', '`' + bZeroYes.join(',') + '`', '$Y=A\\oplus1=\\overline A$']);
  for (const [A, , C] of inputs(3)) assert.equal(count(A, 0, C).Y, algebra.NOT(A)); cases++;
  const xorNot = triples((A, B, C) => gates.AND(gates.XOR(A, B), gates.NOT(C)) === 1);
  equal('check 3 XOR plus inverted C', xorNot, ['010', '100']); answer(1, ['`' + xorNot.join(',') + '`']);
  const independent = inputs(4).filter(([A, B, C, D]) => gates.AND(gates.OR(A, B), gates.XOR(C, D))).map(row => row.join(''));
  equal('check 4 disjoint input-group product', independent, ['0101', '0110', '1001', '1010', '1101', '1110']);
  answer(1, ['`' + independent.join(',') + '`', '$3\\cdot2=6$', '$16-6=10$']);

  // Lesson 3: complete equivalence proofs and backwards constraints checked forwards.
  table(2, 0, inputs(2).map(([A, B]) => { const { p, Y } = calculate(tiedNodes, { A, B }); return [A, B, p, gates.AND(p, p), Y, gates.AND(A, B)]; }));
  table(2, 1, inputs(2).map(([A, B]) => [A, B, gates.NOR(A, B), gates.NOT(A), gates.NOT(B), gates.AND(gates.NOT(A), gates.NOT(B))]));
  for (const [A, B] of inputs(2)) {
    equal('tied NAND implements AND', calculate(tiedNodes, { A, B }).Y, algebra.AND(A, B));
    equal('NAND De Morgan', gates.NAND(A, B), gates.OR(gates.NOT(A), gates.NOT(B)));
    equal('NOR De Morgan', gates.NOR(A, B), gates.AND(gates.NOT(A), gates.NOT(B)));
  }
  contains(2, 'content', 'Y=\\overline{pp}=\\overline p=\\overline{\\overline{AB}}=AB');
  equal('wrong bubble-moving counterexample', [gates.NAND(0, 1), gates.AND(gates.NOT(0), gates.NOT(1))], [1, 0]);
  contains(2, 'content', '$\\overline A\\,\\overline B=1\\cdot0=0$');
  equal('backwards first-circuit failure condition', triples((A, B, C) => C === 0 && (A === 0 || B === 1)), firstNo);
  contains(2, 'content', '`' + firstNo.join(',') + '`');
  const caseA = triples((A, B) => A === 0 && B === 0), caseB = triples((A, B, C) => B === 1 && C === 1);
  equal('backwards XOR true cases reconstruct full set', [...caseA, ...caseB].sort(), yes);
  for (const rows of [caseA, caseB, yes]) contains(2, 'content', '`' + rows.join(',') + '`');
  const deMorganRows = inputs(2).map(([A, B]) => [A, B, gates.NOT(A), gates.NOT(B), gates.NAND(A, B), gates.OR(gates.NOT(A), gates.NOT(B))]);
  answer(2, deMorganRows.map(tuple));
  const agree = inputs(2).filter(([A, B]) => gates.XOR(A, B) === gates.OR(A, B)).map(row => row.join(''));
  equal('check 2 exactly three agreeing pairs', agree, ['00', '01', '10']); answer(2, ['`' + agree.join(',') + '`', '`(A,B)=(1,1)`']);
  const falseCaseB0 = triples((A, B) => B === 0 && A === 1), falseCaseB1 = triples((A, B, C) => B === 1 && C === 0);
  equal('check 3 backwards false cases', [...falseCaseB0, ...falseCaseB1].sort(), no);
  answer(2, [falseCaseB0, falseCaseB1, no].map(rows => '`' + rows.join(',') + '`'));
  const allNandOr = inputs(2).map(([A, B]) => { const p = gates.NAND(A, A), q = gates.NAND(B, B), Z = gates.NAND(p, q); assert.equal(Z, algebra.OR(A, B)); return [A, B, p, q, Z]; });
  answer(2, allNandOr.map(tuple)); answer(2, ['$Z=\\overline{\\overline A\\,\\overline B}=A+B$']);
  for (const [X] of inputs(1)) { equal('same-signal identities', [gates.XOR(X, X), gates.OR(X, X), gates.AND(X, X), gates.XOR(X, 1)], [0, X, X, 1 - X]); }

  // Geometry checks: conventional gate bodies, bubbles, all physical wire nets,
  // named intermediate labels, and exact same diagrams in both languages.
  const allDiagrams = documents.map(({ text }) => [...text.matchAll(/```diagram\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1])));
  equal('identical bilingual diagrams', allDiagrams[0], allDiagrams[1]);
  equal('four diagrams', allDiagrams[0].map(d => d.id), ['digital-gate-symbols', 'digital-trace-circuit', 'digital-table-circuit', 'digital-tied-nand']);
  assert.ok(validAcslDiagrams({ en: allDiagrams[0], zh: allDiagrams[1] })); cases++;
  const gallery = [['AND', 80, 80], ['OR', 300, 80], ['NOT', 520, 80], ['NAND', 80, 240], ['NOR', 300, 240], ['XOR', 520, 240]].map(([kind, x, y]) => ({ kind, x, y }));
  const configs = [gallery, firstNodes, countNodes, tiedNodes];
  const originalPorts = [null, { A: [35, 98], B: [35, 190], C: [35, 260] }, { A: [35, 98], B: [35, 200], C: [35, 340] }, { A: [35, 98], B: [35, 122] }];
  const finalPorts = [null, [565, 180], [485, 190], [495, 110]];
  const expectedDots = [[], [], [[80, 200]], [[260, 110]]];
  for (let i = 0; i < allDiagrams[0].length; i++) {
    const d = allDiagrams[0][i], config = configs[i];
    equal(`${d.id}: every gate body and XOR extra curve`, d.elements.filter(e => e.type === 'path').map(e => e.d), config.flatMap(shapePaths));
    const bubbles = d.elements.filter(e => e.type === 'circle' && e.r === 5);
    equal(`${d.id}: inversion bubbles attach to the correct output`, bubbles.map(e => [e.cx, e.cy]), config.filter(g => ['NOT', 'NAND', 'NOR'].includes(g.kind)).map(g => { const [x, y] = output(g); return [x - 5, y]; }));
    bubbles.forEach(b => assert.equal(b.fill, 'surface'));
    const dots = d.elements.filter(e => e.type === 'circle' && e.r === 3);
    equal(`${d.id}: branch junctions`, dots.map(e => [e.cx, e.cy]), expectedDots[i]); dots.forEach(dot => assert.equal(dot.fill, 'ink'));
    const texts = d.elements.filter(e => e.type === 'text');
    for (const node of config) assert.ok(texts.some(t => t.text === node.kind));
    if (i > 0) {
      const reconstructed = wiring(d, originalPorts[i], config, finalPorts[i]);
      equal(`${d.id}: physical wires reconstruct gate input identities`, reconstructed.map(n => n.args), config.map(n => n.args));
      for (const node of config) assert.ok(texts.some(t => t.text === node.name));
      for (const row of inputs(i === 3 ? 2 : 3)) {
        const values = Object.fromEntries(Object.keys(originalPorts[i]).map((name, j) => [name, row[j]]));
        assert.deepEqual(calculate(reconstructed, values), calculate(config, values, algebra)); modelComparisons++;
      }
    } else {
      equal('gallery input and output wire endpoints', d.elements.filter(e => e.type === 'polyline').map(e => e.points), gallery.flatMap(g => [...ports(g).map(p => [[g.x - 38, p[1]], p]), [output(g), [g.x + 105, g.y]]]));
    }
    for (const t of texts) assert.ok(t.x >= 15 && t.x <= d.width - 25 && t.y >= 20 && t.y <= d.height - 25, 'label too near clipping edge');
    assert.ok(d.alt.en.length > 70 && d.alt.zh.length > 30); cases++;
  }
  for (const { language, document } of documents) {
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'same** signal' : '同一个**信号'));
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'hollow circle' : '空心小圆'));
    assert.ok(document.chapters[1].content.includes(language === 'en' ? 'independent Boolean inputs' : '独立布尔输入'));
    assert.ok(document.chapters[2].content.includes(language === 'en' ? 'every assignment' : '每一种赋值'));
    cases++;
  }
  const practice = await json('practice-map.json'), curriculum = await json('../../curriculum.json');
  equal('practice positions', practice.chapters.map(c => c.position), [0, 1, 2]);
  equal('practice distribution by local question task', practice.chapters.map(c => c.references.length), [1, 7, 4]);
  assert.equal(practice.version, 1); assert.equal(practice.unitId, 'digital-electronics');
  const refKey = ref => `${ref.paperSlug}/${ref.questionId}`;
  const mapped = practice.chapters.flatMap(c => c.references).map(refKey).sort();
  equal('all twelve references exactly once', [mapped.length, new Set(mapped).size], [12, 12]);
  equal('curriculum reference identity', mapped, curriculum.units.find(u => u.id === 'digital-electronics').practiceReferences.map(refKey).sort());
  return { cases, modelComparisons, lessons: 3, selfChecks: 12, diagrams: 4 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial(), null, 2));
