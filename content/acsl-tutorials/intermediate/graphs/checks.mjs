// Trusted original examples, independently enumerated; never execute document or learner code.
// ACSL path/cycle convention: https://www.categories.acsl.org/wiki/index.php?title=Graph_Theory
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';
import { validateAcslDiagrams } from '../../../../packages/domain/src/acsl-diagrams.mjs';
const here = new URL('./', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, here), 'utf8'));
const graph = (vertices, edges) => ({ vertices: [...vertices], edges: edges.split(',').map(edge => [...edge]) });
const G = graph('PQRS', 'PQ,PR,QR,QS,RS');
const H = graph('UVW', 'UU,UV,VW,WU,WV');
const J = graph('JKL', 'JK,KJ,KL,LL');
const C = graph('PQRST', 'PQ,QP,QR,RP,RR,RS,SQ,ST');
const out = (g, v) => g.edges.filter(([a]) => a === v).map(([, b]) => b);
const incoming = (g, v) => g.edges.filter(([, b]) => b === v).map(([a]) => a);
const legal = (g, route) => route.every((v, i) => i === 0 || g.edges.some(([a, b]) => a === route[i - 1] && b === v));
const simple = route => new Set(route).size === route.length;
const isCycle = (g, route) => route.length >= 2 && route[0] === route.at(-1) && simple(route.slice(0, -1)) && legal(g, route);
const name = route => route.join('→');
const sorted = routes => routes.map(name).sort();
const matrix = g => g.vertices.map(a => g.vertices.map(b => Number(g.edges.some(([u, v]) => u === a && v === b))));
const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const identity = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
function walks(g, length, start) {
  let routes = (start === undefined ? g.vertices : [start]).map(v => [v]);
  for (let i = 0; i < length; i++) routes = routes.flatMap(route => out(g, route.at(-1)).map(v => [...route, v]));
  return routes;
}
function paths(g, start, target) {
  const result = [];
  function visit(route) {
    if (route.at(-1) === target) { result.push(route); return; }
    for (const v of out(g, route.at(-1))) if (!route.includes(v)) visit([...route, v]);
  }
  visit([start]); return result;
}
function cyclesFrom(g, start) {
  const result = [];
  function visit(route) {
    for (const v of out(g, route.at(-1))) {
      if (v === start) result.push([...route, v]);
      else if (!route.includes(v)) visit([...route, v]);
    }
  }
  visit([start]); return result;
}
const canonical = route => { const body = route.slice(0, -1); return body.map((_, i) => [...body.slice(i), ...body.slice(0, i)].join('')).sort()[0]; };
const allCycles = g => [...new Set(g.vertices.flatMap(v => cyclesFrom(g, v)).map(canonical))].sort();
function permutations(values, length) {
  if (!length) return [[]];
  return values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j), length - 1).map(rest => [v, ...rest]));
}
const add = (g, edge) => ({ vertices: g.vertices, edges: [...g.edges, [...edge]] });
const without = (g, excluded) => ({ vertices: g.vertices.filter(v => !excluded.includes(v)), edges: g.edges.filter(([a, b]) => !excluded.includes(a) && !excluded.includes(b)) });
const difference = (a, b) => a.filter(route => !new Set(sorted(b)).has(name(route)));
const degreeCount = g => g.vertices.reduce((sum, v) => sum + incoming(g, v).length * out(g, v).length, 0);
const tables = text => [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(m => m[0].trim().split('\n').slice(2).map(line => line.slice(1, -1).split('|').map(cell => cell.trim().replaceAll('`', ''))));
const texMatrices = text => [...text.matchAll(/\\begin\{(pmatrix|array)\}(?:\{[^}]+\})?([\s\S]*?)\\end\{\1\}/g)].map(m => m[2].split('\\\\').map(row => row.replaceAll('\\hline', '').trim().split('&').map(cell => cell.trim())).map(row => m[1] === 'array' ? row.slice(1) : row).filter(row => row.length && row.every(cell => /^\d+$/.test(cell))).map(row => row.map(Number)));

export async function checkTutorial() {
  const documents = await Promise.all(['en', 'zh'].map(async language => ({ language, document: parseLearningMarkdown(await readFile(new URL(`course.${language}.md`, here), 'utf8')) })));
  let cases = 0, modelComparisons = 0, diagramEdges = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const contains = (chapter, field, anchor) => { for (const { language, document } of documents) assert.ok(document.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: missing ${anchor}`); cases++; };
  const anchors = (c, f, list) => list.forEach(value => contains(c, f, value));
  const shownRoutes = (c, f, routes) => routes.forEach(route => contains(c, f, '`' + name(route) + '`'));
  const table = (c, index, expected) => { for (const { language, document } of documents) assert.deepEqual(tables(document.chapters[c].content)[index], expected.map(row => row.map(String)), `${language}/${c + 1}: table ${index}`); cases++; };
  for (const { language, document } of documents) {
    equal(language + ' chapter count', document.chapters.length, 3);
    for (const chapter of document.chapters) for (const field of ['checkpoint', 'checkpointAnswer']) equal(language + ' numbered ' + field, [...chapter[field].matchAll(/^\*\*(\d+)\.\*\*/gm)].map(m => Number(m[1])), [1, 2, 3, 4]);
  }

  // Separate matrix multiplication and route enumeration check every endpoint
  // pair for lengths 0..5, including repeated edges and self-loops.
  const graphs = [G, H, J, C, add(H, 'VU'), add(H, 'VV'), add(G, 'SQ'), without(H, 'V'), without(C, 'P'), without(C, 'Q'), graph('UVW', 'UV,VU,UW,WU,VW,WV')];
  for (const g of graphs) {
    let power = identity(g.vertices.length);
    for (let length = 0; length <= 5; length++) {
      for (let i = 0; i < g.vertices.length; i++) for (let j = 0; j < g.vertices.length; j++) {
        assert.equal(power[i][j], walks(g, length, g.vertices[i]).filter(route => route.at(-1) === g.vertices[j]).length); modelComparisons++;
      }
      power = multiply(power, matrix(g));
    }
    equal('two-edge degree identity', degreeCount(g), walks(g, 2).length);
    const independentCycles = [];
    for (let length = 1; length <= g.vertices.length; length++) for (const route of permutations(g.vertices, length)) {
      const closed = [...route, route[0]];
      if (legal(g, closed)) independentCycles.push(canonical(closed));
    }
    equal('cycle DFS agrees with distinct-vertex permutation enumeration', allCycles(g), [...new Set(independentCycles)].sort());
  }

  // Lesson 1: every actual adjacency row and matrix, route, degree and checkpoint.
  table(0, 0, G.vertices.map(v => [v, out(G, v).join(',') || '—', incoming(G, v).join(',') || '—', out(G, v).length, incoming(G, v).length]));
  const gRoutes = paths(G, 'P', 'S').sort((a, b) => a.length - b.length || name(a).localeCompare(name(b)));
  equal('complete G paths', sorted(gRoutes), ['P→Q→R→S', 'P→Q→S', 'P→R→S']);
  table(0, 1, gRoutes.map(route => [name(route), route.length - 1]));
  for (const { document } of documents) {
    equal('displayed G matrix', texMatrices(document.chapters[0].content), [matrix(G)]);
    equal('displayed checkpoint J matrix', texMatrices(document.chapters[0].checkpoint), [matrix(J)]);
  }
  equal('G row R', matrix(G)[2], [0, 0, 0, 1]); equal('G column R', matrix(G).map(row => row[2]), [1, 1, 0, 0]);
  equal('G Q and S degree pairs', ['Q', 'S'].map(v => [incoming(G, v).length, out(G, v).length]), [[1, 2], [2, 0]]);
  anchors(0, 'checkpointAnswer', ['`0,0,0,1`', '`1,1,0,0`', '$2+2+1+0=5$', '$0+1+2+2=5$']);
  equal('candidate routes', [['P','Q','S'],['P','R','Q'],['Q','R','S'],['S','Q','P']].map(route => legal(G, route)), [true, false, true, false]);
  anchors(0, 'checkpointAnswer', ['`RQ`', '`SQ`']);
  const undirected = graph('UVWX', 'UV,VU,VW,WV,WU,UW,WX,XW');
  equal('undirected degrees', undirected.vertices.map(v => out(undirected, v).length), [2, 2, 3, 1]);
  equal('undirected adjacency ones', matrix(undirected).flat().reduce((a, b) => a + b, 0), 8);
  anchors(0, 'checkpointAnswer', ['`U:V,W`', '`V:U,W`', '`W:U,V,X`', '`X:W`', String.raw`$2+2+3+1=8=2\cdot4$`]);
  equal('J outgoing degrees', J.vertices.map(v => out(J, v).length), [1, 2, 1]); equal('J incoming degrees', J.vertices.map(v => incoming(J, v).length), [1, 1, 2]);
  anchors(0, 'checkpointAnswer', ['`JK,KJ,KL,LL`', '`1,2,1`', '`1,1,2`', '`KL`', '`LK`']);

  // Lesson 2: bind middle groups, all powers and the target-vector recurrence.
  table(1, 0, H.vertices.map(v => [v, out(H, v).join(','), incoming(H, v).length, out(H, v).length]));
  const h2 = walks(H, 2);
  table(1, 1, H.vertices.map(v => { const routes = h2.filter(route => route[1] === v); return [v, routes.map(name).join(', '), routes.length]; }));
  equal('H count and simple subset', [h2.length, h2.filter(simple).length], [8, 3]);
  shownRoutes(1, 'content', h2.filter(simple));
  contains(1, 'content', String.raw`$N_2=2\cdot2+2\cdot1+1\cdot2=8$`);
  const m = matrix(H), m2 = multiply(m, m), m3 = multiply(m2, m);
  for (const { document } of documents) equal('displayed H matrices exactly match all computed entries', texMatrices(document.chapters[1].content), [m, m2, m3]);
  equal('H M cubed', m3, [[2,2,1],[1,1,1],[2,2,1]]);
  equal('length-3 U endpoints', H.vertices.map(v => walks(H, 3, 'U').filter(route => route.at(-1) === v).length), [2,2,1]);
  shownRoutes(1, 'content', walks(H, 3, 'U')); contains(1, 'content', '`2,2,1`');
  let vector = [0, 0, 1];
  const vectors = [vector];
  for (let step = 0; step < 3; step++) { vector = H.vertices.map(v => out(H, v).reduce((sum, w) => sum + vector[H.vertices.indexOf(w)], 0)); vectors.push(vector); }
  equal('target W vectors, including exact length 3', vectors, [[0,0,1],[0,1,0],[1,0,1],[1,1,1]]);
  vectors.forEach(v => contains(1, 'content', '`' + v.join(',') + '`'));
  equal('V reaches W at 1 and 3 but not 2', [1,2,3].map(k => walks(H, k, 'V').filter(route => route.at(-1) === 'W').length), [1,0,1]);
  contains(1, 'content', '`V→W→V→W`');
  const hAdded = difference(walks(add(H, 'VU'), 2), h2);
  equal('new VU paths', sorted(hAdded), ['U→V→U','V→U→U','V→U→V','W→V→U']); shownRoutes(1, 'content', hAdded);
  equal('old-degree VU increment', incoming(H, 'V').length + out(H, 'U').length, hAdded.length); contains(1, 'content', '$8+4=12$');
  equal('J two-step list', sorted(walks(J, 2)), ['J→K→J','J→K→L','K→J→K','K→L→L','L→L→L']);
  shownRoutes(1, 'checkpointAnswer', walks(J, 2)); equal('J simple list', sorted(walks(J, 2).filter(simple)), ['J→K→L']);
  contains(1, 'checkpointAnswer', String.raw`$1\cdot1+1\cdot2+2\cdot1=5$`);
  const uv3 = walks(H, 3, 'U').filter(route => route.at(-1) === 'V');
  equal('U to V length 3', sorted(uv3), ['U→U→U→V','U→V→W→V']); equal('U to V length 3 simple', uv3.filter(simple), []); shownRoutes(1, 'checkpointAnswer', uv3);
  const gAdded = difference(walks(add(G, 'SQ'), 2), walks(G, 2));
  equal('SQ added list', sorted(gAdded), ['Q→S→Q','R→S→Q','S→Q→R','S→Q→S']); shownRoutes(1, 'checkpointAnswer', gAdded); shownRoutes(1, 'checkpointAnswer', walks(G, 2));
  equal('SQ totals and simple increment', [walks(add(G, 'SQ'), 2).length, gAdded.filter(simple).length], [8,2]);
  anchors(1, 'checkpointAnswer', ['$2+2=4$', '$4+4=8$']);
  equal('forbidden V removes incident edges', without(H, 'V').edges, [['U','U'],['W','U']]);
  equal('forbidden V paths', sorted(walks(without(H, 'V'), 2)), ['U→U→U','W→U→U']); shownRoutes(1, 'checkpointAnswer', walks(without(H, 'V'), 2));
  const loopAdded = difference(walks(add(H, 'VV'), 2), h2);
  equal('new self-loop paths', sorted(loopAdded), ['U→V→V','V→V→V','V→V→W','W→V→V']); shownRoutes(1, 'checkpointAnswer', loopAdded);
  equal('new self-loop old-degree adjustment', incoming(H, 'V').length + out(H, 'V').length + 1, loopAdded.length); contains(1, 'checkpointAnswer', '$2+1+1=4$');

  // Lesson 3: independently normalized cycles and exhaustive weighted DAG paths.
  table(2, 0, C.vertices.map(v => [v, out(C, v).join(',') || '—']));
  const cCycles = allCycles(C).map(s => [...s, s[0]]);
  equal('C global representatives', cCycles.map(name), ['P→Q→P','P→Q→R→P','Q→R→S→Q','R→R']);
  table(2, 1, cCycles.map(route => [name(route), route.length - 1, route.slice(0, -1).join(',')]));
  equal('C P-based cycles', sorted(cyclesFrom(C, 'P')), ['P→Q→P','P→Q→R→P']);
  equal('C cycles counted separately at every possible start', C.vertices.map(v => cyclesFrom(C, v).length), [2,3,3,1,0]);
  equal('C cycles excluding P', allCycles(without(C, 'P')), ['QRS','R']);
  equal('C noncyclic vertices', C.vertices.filter(v => !allCycles(C).some(cycle => cycle.includes(v))), ['T']);
  const weights = { PQ:2, PR:8, QR:1, QS:7, RS:2 };
  const cost = (route, values) => route.slice(1).reduce((sum, v, i) => sum + values[route[i] + v], 0);
  table(2, 2, G.edges.map(([a,b]) => [a+b, weights[a+b]]));
  table(2, 3, gRoutes.map(route => [name(route), route.length-1, '$' + route.slice(1).map((v,i) => weights[route[i]+v]).join('+') + '=' + cost(route, weights) + '$']));
  equal('weighted worked totals', gRoutes.map(route => cost(route, weights)), [9,10,5]);
  equal('C R-based cycles', sorted(cyclesFrom(C, 'R')), ['R→P→Q→R','R→R','R→S→Q→R']); shownRoutes(2, 'checkpointAnswer', cyclesFrom(C, 'R'));
  equal('a closing endpoint is allowed, an internal repetition is not', [isCycle(C,['R','P','Q','R']),isCycle(C,['R','P','Q','R','R'])], [true,false]);
  equal('a twice-used loop is a closed walk but not a two-edge cycle', [legal(H,['U','U','U']),isCycle(H,['U','U','U'])], [true,false]);
  contains(2, 'checkpointAnswer', '`R→P→Q→R→R`');
  const noQ = without(C, 'Q'); equal('C surviving edges after Q', noQ.edges.map(e => e.join('')), ['RP','RR','RS','ST']);
  equal('C cycles after Q', allCycles(noQ), ['R']); equal('C noncyclic vertices after Q', noQ.vertices.filter(v => !allCycles(noQ).some(cycle => cycle.includes(v))), ['P','S','T']);
  anchors(2, 'checkpointAnswer', ['`RP,RR,RS,ST`', '`P,S,T`']);
  const complete = graph('UVW', 'UV,VU,UW,WU,VW,WV');
  equal('complete directed triangle global cycles', allCycles(complete), ['UV','UVW','UW','UWV','VW']);
  equal('global length groups and cycles from U', [allCycles(complete).filter(c => c.length === 2).length, allCycles(complete).filter(c => c.length === 3).length, cyclesFrom(complete, 'U').length], [3,2,4]);
  shownRoutes(2, 'checkpointAnswer', allCycles(complete).map(s => [...s, s[0]])); anchors(2, 'checkpointAnswer', ['$3+2=5$', '$2+2=4$']);
  const newWeights = { PQ:5, PR:3, QR:2, QS:1, RS:4 };
  equal('weighted checkpoint totals', gRoutes.map(route => cost(route, newWeights)), [6,7,11]);
  anchors(2, 'checkpointAnswer', ['$5+1=6$', '$3+4=7$', '$5+2+4=11$']);

  // Validate native drawing schema and infer actual edge directions from each
  // line/curve's source/end points plus its arrowhead, including loops and pairs.
  const diagrams = documents.map(({ document }) => document.chapters.map(chapter => [...chapter.content.matchAll(/```diagram\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]))));
  equal('bilingual drawings', diagrams[0], diagrams[1]);
  for (const [chapter, g] of [G,H,C].entries()) {
    equal('one complete drawing per lesson', diagrams[0][chapter].length, 1);
    const d = diagrams[0][chapter][0]; validateAcslDiagrams({ en:[d], zh:[d] });
    const nodes = d.elements.filter(e => e.type === 'circle').map(e => ({ ...e, label: d.elements.find(t => t.type === 'text' && t.x === e.cx && Math.abs(t.y-e.cy) <= 7)?.text }));
    equal('drawing vertex labels', nodes.map(n => n.label).sort(), [...g.vertices].sort());
    const nearest = p => [...nodes].sort((a,b) => Math.hypot(a.cx-p[0],a.cy-p[1])-Math.hypot(b.cx-p[0],b.cy-p[1]))[0];
    const bodies = d.elements.filter(e => e.fill === 'none'); const renderedEdges = [];
    for (const body of bodies) {
      let start,end,previous;
      if (body.type === 'line') { start=[body.x1,body.y1]; end=[body.x2,body.y2]; previous=start; }
      else { const nums=body.d.match(/-?\d+(?:\.\d+)?/g).map(Number); start=nums.slice(0,2); end=nums.slice(-2); previous=nums.slice(-4,-2); }
      const source=nearest(start),target=nearest(end); renderedEdges.push(source.label+target.label);
      const arrow=d.elements[d.elements.indexOf(body)+1]; assert.equal(arrow.type,'path'); assert.equal(arrow.fill,'ink');
      const nums=arrow.d.match(/-?\d+(?:\.\d+)?/g).map(Number); assert.ok(Math.hypot(nums[0]-end[0],nums[1]-end[1])<0.02);
      const back=[(nums[2]+nums[4])/2,(nums[3]+nums[5])/2]; assert.ok((end[0]-back[0])*(end[0]-previous[0])+(end[1]-back[1])*(end[1]-previous[1])>0,'arrow points in travel direction');
      for (const [point,node] of [[start,source],[end,target]]) assert.ok(Math.hypot(point[0]-node.cx,point[1]-node.cy)>node.r+5,'arrows leave space outside node labels');
      diagramEdges++;
    }
    equal('rendered directed edge list', renderedEdges.sort(), g.edges.map(edge => edge.join('')).sort());
  }
  // Shared numerical/route text catches bilingual omissions without requiring
  // identical prose or identical numbers of references to a single variable.
  for (let c=0;c<3;c++) for (const field of ['checkpoint','checkpointAnswer']) {
    const tokens=documents.map(({document}) => [...new Set([...document.chapters[c][field].matchAll(/`([^`\n]+)`/g)].map(m=>m[1]))].sort());
    equal('bilingual checkpoint technical tokens',tokens[0],tokens[1]);
  }
  const practice=await json('practice-map.json'), curriculum=await json('../../curriculum.json');
  equal('chapter map positions',practice.chapters.map(c=>c.position),[0,1,2]); equal('primary reference distribution',practice.chapters.map(c=>c.references.length),[1,5,6]);
  equal('practice metadata',[practice.version,practice.unitId],[1,'graphs']);
  const key=ref=>`${ref.paperSlug}/${ref.questionId}`, refs=practice.chapters.flatMap(c=>c.references).map(key).sort();
  equal('all twelve references used once',[refs.length,new Set(refs).size],[12,12]);
  equal('reference identities match curriculum',refs,curriculum.units.find(unit=>unit.id==='graphs').practiceReferences.map(key).sort());
  return { cases, modelComparisons, diagramEdges, selfChecks:12 };
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial(),null,2));
