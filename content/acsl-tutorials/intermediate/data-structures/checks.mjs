// Recompute original examples and self-checks; never execute text from a document.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';
import { validAcslDiagrams } from '../../../../apps/web/src/components/acsl/diagram-validation.ts';

const here = new URL('./', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
const show = values => `[${values.join(',')}]`;
const tables = text => [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(match => match[0].trim().split('\n').slice(2)
  .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim().replace(/^`(.*)`$/, '$1'))));
function linear(kind, commands, initial = []) {
  const state = [...initial], returned = [], rows = [];
  for (const command of commands) {
    let value = '—';
    if (command !== null) state.push(command);
    else { value = state.length ? (kind === 'stack' ? state.pop() : state.shift()) : 'NIL'; returned.push(value); }
    rows.push({ state: [...state], value });
  }
  return { state, returned, rows, next: state.length ? (kind === 'stack' ? state.at(-1) : state[0]) : 'NIL' };
}
function labelled(values) {
  const totals = new Map(), counts = new Map();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return values.map(value => {
    const occurrence = counts.get(value) ?? 0; counts.set(value, occurrence + 1);
    return { value, label: String(value) + (totals.get(value) > 1 ? String.fromCharCode(97 + occurrence) : '') };
  });
}
function tree(values, duplicatesLeft = true) {
  let root = null; const nodes = [], traces = [];
  for (const record of labelled(values)) {
    const node = { ...record, left: null, right: null, depth: 0 }, path = [];
    nodes.push(node);
    if (!root) { root = node; traces.push({ node, path, position: 'root' }); continue; }
    let parent = root;
    while (true) {
      const side = node.value < parent.value || (duplicatesLeft && node.value === parent.value) ? 'left' : 'right';
      path.push(`${parent.label}:${side === 'left' ? 'L' : 'R'}`);
      if (!parent[side]) { parent[side] = node; node.depth = parent.depth + 1; break; }
      parent = parent[side];
    }
    traces.push({ node, path, position: path.at(-1) });
  }
  return { root, nodes, traces };
}
// A second construction partitions the remaining insertion sequence recursively.
// It shares no insertion loop, child mutation, or stored depths with tree().
function partitionTree(records, duplicatesLeft = true) {
  if (!records.length) return null;
  const [root, ...rest] = records;
  const goesLeft = item => item.value < root.value || (duplicatesLeft && item.value === root.value);
  return { ...root, left: partitionTree(rest.filter(goesLeft), duplicatesLeft),
    right: partitionTree(rest.filter(item => !goesLeft(item)), duplicatesLeft) };
}
const shape = node => node ? [node.label, shape(node.left), shape(node.right)] : null;
function traverse(node, order) {
  if (!node) return [];
  const left = traverse(node.left, order), right = traverse(node.right, order);
  return order === 'pre' ? [node.label, ...left, ...right] : order === 'in' ? [...left, node.label, ...right] : [...left, ...right, node.label];
}
function breadth(root) {
  const queue = root ? [root] : [], visited = [], rows = [];
  while (queue.length) {
    const node = queue.shift(); visited.push(node.label);
    if (node.left) queue.push(node.left); if (node.right) queue.push(node.right);
    rows.push([node.label, show(queue.map(item => item.label))]);
  }
  return { visited, rows };
}
const height = node => node ? 1 + Math.max(height(node.left), height(node.right)) : -1;
const childCount = node => Number(Boolean(node.left)) + Number(Boolean(node.right));
const childRows = t => t.nodes.map(n => [n.label, n.left?.label ?? '—', n.right?.label ?? '—']);
const depthSum = t => t.nodes.reduce((sum, n) => sum + n.depth, 0);
function externalDepths(root, depth = 0) {
  return root ? [...externalDepths(root.left, depth + 1), ...externalDepths(root.right, depth + 1)] : [depth];
}
const sum = values => values.reduce((a, b) => a + b, 0);
const searchPath = (t, value) => {
  const path = []; let node = t.root;
  while (node) { path.push(node.label); if (node.value === value) break; node = value < node.value ? node.left : node.right; }
  return path;
};
function preserveTop(initial, additions) {
  const stack = [...initial], rows = [];
  for (const value of additions) { const top = stack.pop(); assert.notEqual(top, undefined); stack.push(value, top); rows.push([...stack]); }
  return rows;
}
const mainValues = [8, 4, 12, 2, 6, 10, 6, 9];

export async function checkTutorial() {
  const documents = await Promise.all(['en', 'zh'].map(async language => {
    const text = await readFile(new URL(`course.${language}.md`, here), 'utf8');
    return { language, text, document: parseLearningMarkdown(text) };
  }));
  let cases = 0, modelComparisons = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const contains = (chapter, field, anchor) => {
    for (const { language, document } of documents)
      assert.ok(document.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: missing calculated anchor ${anchor}`);
    cases++;
  };
  const table = (chapter, index, expected) => {
    for (const { language, document } of documents)
      assert.deepEqual(tables(document.chapters[chapter].content)[index], expected.map(row => row.map(String)), `${language}/${chapter + 1}: displayed table ${index}`);
    cases++;
  };
  const answers = (chapter, anchors) => anchors.forEach(anchor => contains(chapter, 'checkpointAnswer', anchor));
  for (const { language, document, text } of documents) {
    equal(`${language}: four lessons`, document.chapters.length, 4);
    assert.ok(!text.includes('@@')); assert.ok(!/sourceimage|!\[.*?\]\(/.test(text));
    for (const chapter of document.chapters) {
      equal(`${language}: four self-checks`, [...chapter.checkpoint.matchAll(/^\*\*(\d)\.\*\*/gm)].map(m => m[1]), ['1', '2', '3', '4']);
      equal(`${language}: four worked answers`, [...chapter.checkpointAnswer.matchAll(/^\*\*(\d)\.\*\*/gm)].map(m => m[1]), ['1', '2', '3', '4']);
    }
  }

  // Verify both algorithms and identities over every short sequence with duplicates.
  for (let length = 1; length <= 6; length++) for (let code = 0; code < 3 ** length; code++) {
    let n = code; const values = Array.from({ length }, () => { const value = n % 3; n = Math.floor(n / 3); return value; });
    for (const left of [true, false]) {
      const t = tree(values, left), independent = partitionTree(labelled(values), left);
      assert.deepEqual(shape(t.root), shape(independent));
      const sorted = traverse(t.root, 'in').map(label => t.nodes.find(node => node.label === label).value);
      assert.deepEqual(sorted, [...values].sort((a, b) => a - b));
      const external = externalDepths(t.root);
      assert.equal(external.length, length + 1); assert.equal(sum(external), depthSum(t) + 2 * length);
      assert.equal(t.nodes.filter(node => childCount(node) === 0).length, t.nodes.filter(node => childCount(node) === 2).length + 1);
      assert.equal(t.nodes.reduce((total, node) => total + childCount(node), 0), length - 1);
      assert.equal(height(t.root), Math.max(...t.nodes.map(node => node.depth)));
      modelComparisons += 7;
    }
  }
  cases++;

  // Lesson 1: independently computed state table and every original self-check.
  const commands = ['P', 'Q', null, 'R', 'S', null, 'T', null];
  const stack = linear('stack', commands), queue = linear('queue', commands);
  table(0, 0, commands.map((command, i) => [i + 1, command === null ? 'x = POP()' : `PUSH(${command})`, show(stack.rows[i].state), stack.rows[i].value, show(queue.rows[i].state), queue.rows[i].value]));
  equal('worked final states and next removals', [stack.state, queue.state, stack.next, queue.next], [['P', 'R'], ['S', 'T'], 'R', 'S']);
  for (const anchor of ['`R,P`', '`S,T`', '$5-3=2$']) contains(0, 'content', anchor);
  const arithmetic = [2, 5, 9], a = arithmetic.pop(), b = arithmetic.pop(); arithmetic.push(a - b);
  equal('worked variable order', [a, b, arithmetic], [9, 5, [2, 4]]);
  for (const anchor of ['`a=9`', '`b=5`', '$9-5=4$', '`[2,4]`', '$5-9=-4$']) contains(0, 'content', anchor);
  const originalLoop = preserveTop(['K', 'M'], ['R', 'T']);
  equal('worked loop intermediate states', originalLoop, [['K', 'R', 'M'], ['K', 'R', 'T', 'M']]);
  originalLoop.forEach(row => contains(0, 'content', '`' + show(row) + '`'));
  contains(0, 'content', '`' + originalLoop.at(-1).toReversed().join(',') + '`');
  contains(0, 'checkpoint', '`PUSH(A), PUSH(B), PUSH(A), POP, PUSH(C), POP`');
  const c1 = ['A', 'B', 'A', null, 'C', null], s1 = linear('stack', c1), q1 = linear('queue', c1);
  equal('check 1: duplicate value history', [s1.returned, q1.returned, s1.state, q1.state, s1.next, q1.next], [['A', 'C'], ['A', 'B'], ['A', 'B'], ['A', 'C'], 'B', 'A']);
  answers(0, ['`A,C`', '`A,B`', '`[A,B]`', '`[A,C]`', '`B`', '`A`']);
  const s2 = [4, 7, 3], a2 = s2.pop(), b2 = s2.pop(); s2.push(b2 - a2); s2.push(a2); const c2 = s2.pop();
  equal('check 2: variables and retained duplicate values', [a2, b2, c2, s2], [3, 7, 3, [4, 4]]);
  answers(0, ['`a=3`', '`b=7`', '`c=3`', '$7-3=4$', '`[4,4]`', '`[4,4,3]`']);
  const empty = linear('queue', [null, 'J', null, null]);
  equal('check 3: underflow leaves queue empty', [empty.returned, empty.state.length], [['NIL', 'J', 'NIL'], 0]);
  answers(0, ['`NIL,J,NIL`', '`[]`', '$1-1=0$']);
  const loop = preserveTop(['L', 'N'], ['P', 'R']);
  equal('check 4: preserved top', loop, [['L', 'P', 'N'], ['L', 'P', 'R', 'N']]);
  answers(0, loop.map(row => '`' + show(row) + '`').concat('`N,R,P,L`'));

  // Lesson 2: build the tree and validate every displayed comparison and edge.
  const main = tree(mainValues);
  contains(1, 'content', '`' + mainValues.join(',') + '`');
  table(1, 0, main.traces.map(({ node, path, position }) => [node.label, path.join(',') || '—', position, path.length]));
  table(1, 1, childRows(main));
  equal('main BST key searches', [searchPath(main, 9), searchPath(main, 11)], [['8', '12', '10', '9'], ['8', '12', '10']]);
  for (const anchor of ['`8,12,10,9`', '`8,12,10`']) contains(1, 'content', anchor);
  equal('insertion order alters search length', [searchPath(tree([2, 4, 6]), 6).length, searchPath(tree([4, 2, 6]), 6).length], [3, 2]);
  const leftDuplicate = tree([5, 3, 7, 3, 4]), rightDuplicate = tree([5, 3, 7, 3, 4], false);
  equal('check 1: duplicate-left child table', childRows(leftDuplicate), [['5', '3a', '7'], ['3a', '3b', '4'], ['7', '—', '—'], ['3b', '—', '—'], ['4', '—', '—']]);
  answers(1, childRows(leftDuplicate).map(([label, left, right]) => `\`${label}:(${left},${right})\``));
  answers(1, ['`5:L,3a:L`', '`5:L,3a:R`']);
  equal('check 2: duplicate-right paths', rightDuplicate.traces.slice(3).map(trace => trace.path.join(',')), ['5:L,3a:R', '5:L,3a:R,3b:R']);
  answers(1, rightDuplicate.traces.slice(3).map(trace => '`' + trace.path.join(',') + '`'));
  const letters = tree(['M', 'H', 'T', 'K', 'H']);
  equal('check 3: duplicate letters and search', [letters.traces[4].path.join(','), searchPath(letters, 'K'), searchPath(letters, 'J')], ['M:L,Ha:L', ['M', 'Ha', 'K'], ['M', 'Ha', 'K']]);
  answers(1, ['`M:L,Ha:L`', '`M,Ha,K`']);
  equal('check 4: inherited interval repair', childRows(tree([8, 12, 6]))[0], ['8', '6', '12']);
  answers(1, ['`8:(6,12)`']);
  contains(1, 'checkpoint', '`8,12,6`');

  // Lesson 3: depths/heights, missing-child positions and both sums.
  table(2, 0, main.nodes.map(node => [node.label, node.depth, childCount(node), height(node)]));
  equal('worked node classifications', [main.nodes.filter(n => childCount(n) === 0).map(n => n.label), main.nodes.filter(n => childCount(n) === 1).map(n => n.label), main.nodes.filter(n => childCount(n) === 2).map(n => n.label)], [['2', '6b', '9'], ['12', '6a', '10'], ['8', '4']]);
  for (const anchor of ['`2,6b,9`', '`12,6a,10`', '`8,4`', '`2,6a,10`']) contains(2, 'content', anchor);
  equal('worked internal and external lengths', [depthSum(main), externalDepths(main.root).toSorted((a, b) => a - b), sum(externalDepths(main.root))], [14, [2, 3, 3, 3, 3, 4, 4, 4, 4], 30]);
  for (const anchor of ['I=0+1+1+2+2+2+3+3=14', 'I=1\\cdot0+2\\cdot1+3\\cdot2+2\\cdot3=14', 'E=1\\cdot2+4\\cdot3+4\\cdot4=30', '$I+n=14+8=22$']) contains(2, 'content', anchor);
  const small = tree([5, 3, 7]);
  equal('worked three-node external example', [depthSum(small), externalDepths(small.root), sum(externalDepths(small.root))], [2, [2, 2, 2, 2], 8]);
  for (const anchor of ['$I=0+1+1=2$', '$E=2+2+2+2=8$']) contains(2, 'content', anchor);
  const cTree = tree([7, 3, 10, 1, 5, 9, 11, 4]);
  contains(2, 'checkpoint', '`7,3,10,1,5,9,11,4`');
  equal('check 1: node classes', [cTree.nodes.filter(n => childCount(n) === 0).map(n => n.label).sort((a, b) => +a - +b), cTree.nodes.filter(n => n.left && !n.right).map(n => n.label), cTree.nodes.filter(n => !n.left && n.right).map(n => n.label), cTree.nodes.filter(n => childCount(n) === 2).map(n => n.label)], [['1', '4', '9', '11'], ['5'], [], ['7', '3', '10']]);
  answers(2, ['`7:(3,10)`', '`3:(1,5)`', '`10:(9,11)`', '`5:(4,—)`', '$n_0=4,n_1=1,n_2=3$', '$8-1=7$']);
  equal('check 2: depths and height', [cTree.nodes.map(n => n.depth), height(cTree.root), depthSum(cTree)], [[0, 1, 1, 2, 2, 2, 2, 3], 3, 13]);
  answers(2, ['`1,5,9,11`', '`0,1,1,2,2,2,2,3`', '$I=0+1+1+2+2+2+2+3=13$', '$I=1\\cdot0+2\\cdot1+4\\cdot2+1\\cdot3=13$']);
  equal('check 3: external depth frequencies', externalDepths(cTree.root).toSorted((a, b) => a - b), [3, 3, 3, 3, 3, 3, 3, 4, 4]);
  answers(2, ['$E=7\\cdot3+2\\cdot4=29$', '$I+2n=13+2\\cdot8=29$']);
  const single = tree([2]), chain = tree([2, 4, 6, 8]);
  equal('check 4: single-node boundary', [height(single.root), depthSum(single), externalDepths(single.root)], [0, 0, [1, 1]]);
  equal('check 4: chain boundary', [height(chain.root), depthSum(chain), externalDepths(chain.root)], [3, 6, [1, 2, 3, 4, 4]]);
  answers(2, ['$E=1+1=2$', '$I=0+1+2+3=6$', '`1,2,3,4,4`', '$E=1+2+3+4+4=14=6+2\\cdot4$']);

  // Lesson 4: depth-first traversal and a separate queue algorithm for level order.
  const balanced = tree([5, 3, 8, 1, 4, 7, 9]);
  table(3, 0, [['Preorder', 'pre'], ['Inorder', 'in'], ['Postorder', 'post']].map(([name, order]) => [name, traverse(balanced.root.left, order).join(','), traverse(balanced.root.right, order).join(','), traverse(balanced.root, order).join(',')]));
  table(3, 1, breadth(balanced.root).rows);
  contains(3, 'content', '`' + breadth(balanced.root).visited.join(',') + '`');
  const waiting = [balanced.root], iterativePreorder = [], stackRows = [];
  while (waiting.length) {
    const node = waiting.pop(); iterativePreorder.push(node.label);
    if (node.right) waiting.push(node.right); if (node.left) waiting.push(node.left);
    stackRows.push(show(waiting.map(n => n.label)));
  }
  equal('stack preorder agrees with recursive traversal', iterativePreorder, traverse(balanced.root, 'pre'));
  stackRows.slice(0, 2).forEach(row => contains(3, 'content', '`' + row + '`'));
  const pipeline = tree([6, 2, 9, 4].toReversed());
  equal('worked pipeline', [childRows(pipeline), depthSum(pipeline), sum(externalDepths(pipeline.root))], [[['4', '2', '9'], ['9', '6', '—'], ['2', '—', '—'], ['6', '—', '—']], 4, 12]);
  for (const anchor of ['`4,9,2,6`', '`4:(2,9)`', '`9:(6,—)`', '$E=4+2\\cdot4=12$']) contains(3, 'content', anchor);
  for (const order of ['pre', 'in', 'post']) contains(3, 'content', '`' + traverse(pipeline.root, order).join(',') + '`');
  for (const order of ['pre', 'in', 'post']) answers(3, ['`' + traverse(main.root, order).join(',') + '`']);
  answers(3, ['`2,4,6,6,8,9,10,12`']);
  const level = breadth(main.root);
  answers(3, ['`' + level.visited.join(',') + '`', ...level.rows.slice(0, 3).map(row => '`' + row[1] + '`')]);
  const pipelineCheck = tree([7, 1, 5, 3].toReversed());
  equal('check 3: queue-stack-BST pipeline', [pipelineCheck.nodes.map(n => n.value), childRows(pipelineCheck), height(pipelineCheck.root), depthSum(pipelineCheck), externalDepths(pipelineCheck.root)], [[3, 5, 1, 7], [['3', '1', '5'], ['5', '—', '7'], ['1', '—', '—'], ['7', '—', '—']], 2, 4, [2, 2, 2, 3, 3]]);
  answers(3, ['`3,5,1,7`', '`3:(1,5)`', '`5:(—,7)`', '`1,3,5,7`', '$E=2+2+2+3+3=12$']);
  const shapeA = tree([5, 2, 8]), shapeB = tree([2, 5, 8]);
  equal('check 4: same inorder, different height', [traverse(shapeA.root, 'in'), traverse(shapeB.root, 'in'), height(shapeA.root), height(shapeB.root)], [['2', '5', '8'], ['2', '5', '8'], 1, 2]);
  answers(3, ['`5,2,8`', '`2,5,8`']);

  // Native diagrams: strict product schema, same bilingual geometry, node/edge
  // correspondence to the independently constructed trees, and visible bounds.
  const diagrams = documents.map(({ text }) => [...text.matchAll(/```diagram\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1])));
  equal('three identical bilingual diagram structures', diagrams[0], diagrams[1]);
  equal('diagram count', diagrams[0].length, 3);
  assert.ok(validAcslDiagrams({ en: diagrams[0], zh: diagrams[1] })); cases++;
  const diagramModels = [main, small, balanced];
  for (let i = 0; i < diagrams[0].length; i++) {
    const diagram = diagrams[0][i], model = diagramModels[i];
    const circles = diagram.elements.filter(e => e.type === 'circle'), boxes = diagram.elements.filter(e => e.type === 'rect');
    const texts = diagram.elements.filter(e => e.type === 'text'), lines = diagram.elements.filter(e => e.type === 'line');
    equal(`${diagram.id}: real node count`, circles.length, model.nodes.length);
    const nodes = new Map();
    for (const node of model.nodes) {
      const text = texts.find(e => e.text === node.label); assert.ok(text, `${diagram.id}: missing ${node.label}`);
      const circle = circles.find(e => e.cx === text.x && e.cy + 6 === text.y); assert.ok(circle);
      nodes.set(node.label, circle);
    }
    const expectedLines = model.nodes.flatMap(parent => [parent.left, parent.right].filter(Boolean).map(child => {
      const a = nodes.get(parent.label), b = nodes.get(child.label);
      assert.ok(child === parent.left ? b.cx < a.cx : b.cx > a.cx); assert.ok(b.cy > a.cy);
      return [a.cx, a.cy, b.cx, b.cy];
    }));
    if (i === 1) {
      equal('external diagram empty positions', boxes.length, 4);
      equal('external diagram empty labels', texts.filter(t => t.text === '∅').length, 4);
      for (const leaf of model.nodes.filter(n => !n.left && !n.right)) {
        const parent = nodes.get(leaf.label), children = boxes.filter(b => Math.abs(b.x + b.width / 2 - parent.cx) === 50);
        equal(`external positions under ${leaf.label}`, children.length, 2);
        for (const child of children) expectedLines.push([parent.cx, parent.cy, child.x + child.width / 2, child.y + child.height / 2]);
      }
    } else equal(`${diagram.id}: no fake external nodes`, boxes.length, 0);
    equal(`${diagram.id}: exact tree edge geometry`, lines.map(e => [e.x1, e.y1, e.x2, e.y2]).sort(), expectedLines.sort());
    for (const circle of circles) assert.ok(circle.cx - circle.r >= 20 && circle.cx + circle.r <= diagram.width - 20 && circle.cy - circle.r >= 15 && circle.cy + circle.r <= diagram.height - 15);
    for (const text of texts) assert.ok(text.x >= 30 && text.x <= diagram.width - 30 && text.y >= 20 && text.y <= diagram.height - 20);
    for (const box of boxes) assert.ok(box.x >= 20 && box.y >= 20 && box.x + box.width <= diagram.width - 20 && box.y + box.height <= diagram.height - 20);
    assert.ok(diagram.alt.en.length > 80 && diagram.alt.zh.length > 30); cases++;
  }
  for (const { language, document } of documents) {
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'bottom → top' : '栈底 → 栈顶'));
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'front → rear' : '队首 → 队尾'));
    assert.ok(document.chapters[0].content.includes(language === 'en' ? 'empty stack or queue returns `NIL`' : '空栈或空队列执行 POP 会返回 `NIL`'));
    assert.ok(document.chapters[2].content.includes(language === 'en' ? 'including leaves' : '叶子也包括在内'));
    assert.ok(document.chapters[2].content.includes(language === 'en' ? 'empty child position' : '空孩子位置'));
    assert.ok(document.chapters[3].content.includes(language === 'en' ? 'right child before its left child' : '右孩子，再压入左孩子'));
    cases++;
  }
  const practice = await json('practice-map.json'), curriculum = await json('../../curriculum.json');
  equal('practice positions', practice.chapters.map(chapter => chapter.position), [0, 1, 2, 3]);
  equal('practice coverage by lesson', practice.chapters.map(chapter => chapter.references.length), [6, 2, 3, 1]);
  assert.equal(practice.version, 1); assert.equal(practice.unitId, 'data-structures');
  const key = ref => `${ref.paperSlug}/${ref.questionId}`;
  const mapped = practice.chapters.flatMap(chapter => chapter.references).map(key).sort();
  equal('all twelve references appear once', [mapped.length, new Set(mapped).size], [12, 12]);
  equal('practice identity matches curriculum', mapped, curriculum.units.find(unit => unit.id === 'data-structures').practiceReferences.map(key).sort());
  return { cases, modelComparisons, lessons: 4, selfChecks: 16, diagrams: 3 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial(), null, 2));
