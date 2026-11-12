// Original tutorial fixtures only. No learner code or document expressions are executed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../../../../apps/web/src/components/teacher/learning-document.ts';
import { validAcslDiagrams } from '../../../../apps/web/src/components/acsl/diagram-validation.ts';

const here = new URL('./', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, here), 'utf8'));
const machines = {
  suffix: { start: 'S', finals: ['B'], edges: { S: { 0: 'A', 1: 'S' }, A: { 0: 'A', 1: 'B' }, B: { 0: 'A', 1: 'S' } } },
  cycle: { start: 'P', finals: ['F'], edges: { P: { m: 'Q' }, Q: { n: 'R', q: 'F' }, R: { p: 'Q' }, F: {} } },
  missing: { start: 'U', finals: ['W'], edges: { U: { 0: 'V' }, V: { 1: 'W' }, W: {} } },
};
function run(machine, input) {
  let state = machine.start;
  const states = [state];
  for (let i = 0; i < input.length; i++) {
    const next = machine.edges[state]?.[input[i]];
    if (next === undefined) return { accepted: false, states, blockedAt: i + 1 };
    states.push(state = next);
  }
  return { accepted: machine.finals.includes(state), states, blockedAt: null };
}

// A small independent recognizer for the explicitly taught single-line subset.
// Character classes consume one character; only the leading class ^ negates.
function parse(source) {
  let i = 0;
  const choice = () => {
    const nodes = [sequence()];
    while (source[i] === '|') { i++; nodes.push(sequence()); }
    return { kind: 'choice', nodes };
  };
  const sequence = () => {
    const nodes = [];
    while (i < source.length && source[i] !== ')' && source[i] !== '|') {
      let node = atom();
      if ('*+?'.includes(source[i] ?? '\0')) node = { kind: source[i++], node };
      nodes.push(node);
    }
    return { kind: 'sequence', nodes };
  };
  const atom = () => {
    const symbol = source[i++];
    if (symbol === '(') { const node = choice(); assert.equal(source[i++], ')'); return node; }
    if (symbol === 'λ') return { kind: 'sequence', nodes: [] };
    if (symbol === '.') return { kind: 'any' };
    if (symbol === '[') {
      const negate = source[i] === '^'; if (negate) i++;
      const characters = new Set();
      while (i < source.length && source[i] !== ']') {
        const a = source[i++];
        if (source[i] === '-' && source[i + 1] !== ']') {
          i++; const b = source[i++]; assert.ok(a.charCodeAt(0) <= b.charCodeAt(0));
          for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) characters.add(String.fromCharCode(c));
        } else characters.add(a);
      }
      assert.equal(source[i++], ']'); assert.ok(characters.size);
      return { kind: 'class', negate, characters };
    }
    assert.ok(symbol && !'()*+?]'.includes(symbol));
    return { kind: 'literal', symbol };
  };
  const result = choice(); assert.equal(i, source.length); return result;
}
function ends(node, input, start) {
  if (node.kind === 'literal') return new Set(input[start] === node.symbol ? [start + 1] : []);
  if (node.kind === 'any') return new Set(start < input.length ? [start + 1] : []);
  if (node.kind === 'class') return new Set(start < input.length && node.characters.has(input[start]) !== node.negate ? [start + 1] : []);
  if (node.kind === 'choice') return new Set(node.nodes.flatMap(child => [...ends(child, input, start)]));
  if (node.kind === 'sequence') return node.nodes.reduce((positions, child) => new Set([...positions].flatMap(pos => [...ends(child, input, pos)])), new Set([start]));
  if (node.kind === '?') return new Set([start, ...ends(node.node, input, start)]);
  const reached = node.kind === '+' ? ends(node.node, input, start) : new Set([start]);
  const queue = [...reached];
  for (const pos of queue) for (const next of ends(node.node, input, pos)) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  return reached;
}
const accepts = (pattern, input) => ends(parse(pattern), input, 0).has(input.length);
const allStrings = (alphabet, max) => {
  const result = ['']; let layer = [''];
  for (let n = 1; n <= max; n++) { layer = layer.flatMap(prefix => [...alphabet].map(c => prefix + c)); result.push(...layer); }
  return result;
};
const code = value => '`' + value + '`';
const tableBlocks = text => [...text.matchAll(/(?:^\|[^\n]*\|\n?)+/gm)].map(match => match[0].trim().split('\n').slice(2).map(line => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim().replaceAll('\\|', '|').replace(/^`(.*)`$/, '$1'))));

export async function checkTutorial() {
  let cases = 0, modelComparisons = 0;
  const documents = await Promise.all(['en', 'zh'].map(async language => {
    const text = await readFile(new URL(`course.${language}.md`, here), 'utf8');
    return { language, text, document: parseLearningMarkdown(text) };
  }));
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); cases++; };
  const contains = (chapter, field, anchor) => {
    for (const { language, document } of documents) assert.ok(document.chapters[chapter][field].includes(anchor), `${language}/${chapter + 1}/${field}: ${anchor}`);
  };
  const localized = (chapter, field, en, zh) => {
    for (const { language, document } of documents) assert.ok(document.chapters[chapter][field].includes(language === 'en' ? en : zh), `${language}/${chapter + 1}/${field}: localized assertion`);
    cases++;
  };
  const table = (chapter, index, expected, numericColumns = null) => {
    for (const { language, document } of documents) {
      let rows = tableBlocks(document.chapters[chapter].content)[index]; assert.ok(rows, `${language}: missing table`);
      if (numericColumns) rows = rows.map(row => numericColumns.map(i => row[i]));
      equal(`${language}/${chapter + 1}: table ${index}`, rows, expected);
    }
  };
  const regexCases = (pattern, inputs, decisions) => {
    equal(pattern, inputs.map(input => accepts(pattern, input)), decisions);
    // Independent engine only checks fixtures using the shared, explicitly scoped subset.
    // Comparing the returned match length also rejects a final newline accepted by JS $.
    if (!pattern.includes('λ')) for (const input of inputs) {
      const match = new RegExp(`^(?:${pattern})$`, 'u').exec(input);
      assert.equal(Boolean(match && match[0].length === input.length), accepts(pattern, input)); modelComparisons++;
    }
  };
  for (const { document, text } of documents) {
    assert.equal(document.chapters.length, 4);
    for (const chapter of document.chapters) {
      equal('four self-checks per lesson', [...chapter.checkpoint.matchAll(/^\*\*([1-4])\.\*\*/gm)].map(m => m[1]), ['1', '2', '3', '4']);
      equal('four worked answer groups', [...chapter.checkpointAnswer.matchAll(/^\*\*([1-4])\.\*\*/gm)].map(m => m[1]), ['1', '2', '3', '4']);
    }
    assert.ok(!/!\[[^\]]*\]\(|<img|\.pdf|Option [A-E]|Correct answer/.test(text));
    for (const leaked of ['[J-PT-V]', '[^c^f-m]', 'KULaazzz24', '[a-ct-v]', '1-321-']) assert.ok(!text.includes(leaked));
  }

  // A complete transition table is compared independently with each displayed graph.
  table(0, 0, Object.entries(machines.suffix.edges).map(([state, edges]) => [state, edges[0], edges[1]]));
  table(0, 1, [['$\\lambda$', '—', 'S'], ['1', '1', 'S'], ['10', '0', 'A'], ['100', '0', 'A'], ['1001', '1', 'B']]);
  table(1, 0, Object.entries(machines.cycle.edges).map(([state, edges]) => [state, ...['m', 'n', 'p', 'q'].map(s => edges[s] ?? '—')]));
  const diagrams = documents.map(({ text }) => [...text.matchAll(/```diagram\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1])));
  equal('native diagrams identical in both documents', diagrams[0], diagrams[1]);
  equal('two diagrams with stable ids', diagrams[0].map(d => d.id), ['suffix-01', 'paired-cycle']);
  assert.ok(validAcslDiagrams({ en: diagrams[0], zh: diagrams[1] })); cases++;
  const [suffixDiagram, cycleDiagram] = diagrams[0];
  equal('suffix graph states and accepting double circle', suffixDiagram.elements.filter(e => e.type === 'circle').map(({ cx, cy, r }) => [cx, cy, r]), [[90,140,27],[270,140,27],[450,140,27],[450,140,21]]);
  equal('cycle graph states and accepting double circle', cycleDiagram.elements.filter(e => e.type === 'circle').map(({ cx, cy, r }) => [cx, cy, r]), [[80,110,27],[250,110,27],[430,110,27],[250,285,27],[250,285,21]]);
  equal('suffix start arrow and straight transitions', suffixDiagram.elements.filter(e => e.type === 'line').map(e => [e.x1,e.y1,e.x2,e.y2]), [[25,140,63,140],[117,140,243,140],[297,140,423,140]]);
  equal('suffix self loops, B to A, B to S', suffixDiagram.elements.filter(e => e.type === 'path').map(e => e.d), ['M 72 120 C 30 45 150 45 108 120','M 252 120 C 210 45 330 45 288 120','M 432 160 C 405 211 315 211 288 160','M 455 167 C 470 290 70 290 85 167']);
  equal('suffix state and edge labels in geometry order', suffixDiagram.elements.filter(e => e.type === 'text').map(e => [e.x,e.y,e.text]), [[90,146,'S'],[270,146,'A'],[450,146,'B'],[180,129,'0'],[360,129,'1'],[90,55,'1'],[270,55,'0'],[360,225,'0'],[270,287,'1']]);
  equal('cycle start, entry, exit arrows', cycleDiagram.elements.filter(e => e.type === 'line').map(e => [e.x1,e.y1,e.x2,e.y2]), [[20,110,53,110],[107,110,223,110],[250,137,250,258]]);
  equal('cycle forward and return arcs', cycleDiagram.elements.filter(e => e.type === 'path').map(e => e.d), ['M 270 92 C 320 35 360 35 410 92','M 410 128 C 360 185 320 185 270 128']);
  equal('cycle state and edge labels in geometry order', cycleDiagram.elements.filter(e => e.type === 'text').map(e => [e.x,e.y,e.text]), [[80,116,'P'],[250,116,'Q'],[430,116,'R'],[250,291,'F'],[165,99,'m'],[340,40,'n'],[340,197,'p'],[270,204,'q']]);
  for (const [diagram, expected] of [[suffixDiagram, [[63,140],[243,140],[423,140],[108,120],[288,120],[288,160],[85,167]]],[cycleDiagram, [[53,110],[223,110],[410,92],[270,128],[250,258]]]]) {
    equal('arrowheads point to the intended destination', diagram.elements.filter(e => e.type === 'polyline').map(e => e.points[1]), expected);
    for (const e of diagram.elements.filter(e => e.type === 'text')) assert.ok(e.x > 0 && e.x < diagram.width && e.y > 0 && e.y < diagram.height);
  }
  localized(0,'content','every input symbol has been consumed','全部符号已经读完');
  for (const [input, expected, field] of [['1001',true,'content'],['010',false,'content'],['10101',true,'checkpointAnswer'],['011',false,'checkpointAnswer'],['0',false,'checkpointAnswer'],['01',true,'checkpointAnswer'],['001',true,'checkpointAnswer']]) {
    const trace = run(machines.suffix,input); equal(`suffix ${input}`,trace.accepted,expected);
    contains(0,field,code(trace.states.join(' → '))); contains(0,field,code(input));
  }
  equal('empty and out of alphabet', ['', '2'].map(s => run(machines.suffix,s).accepted), [false,false]);
  equal('missing arrows do not imply a self-loop', ['01','010','0'].map(s => run(machines.missing,s)), [
    {accepted:true,states:['U','V','W'],blockedAt:null}, {accepted:false,states:['U','V','W'],blockedAt:3}, {accepted:false,states:['U','V'],blockedAt:null}]);
  for(const trace of ['U → V → W','U → V']) contains(0,'checkpointAnswer',code(trace));
  localized(0,'checkpointAnswer','reject at symbol 3','在第 3 个符号上拒绝');
  // Exhaustive finite checks support (but do not replace) the invariant explained in prose.
  for (const input of allStrings('01',9)) {
    assert.equal(run(machines.suffix,input).accepted, input.endsWith('01'));
    assert.equal(accepts('(0|1)*01',input), input.endsWith('01')); modelComparisons+=2;
  }
  cases++;
  for (const input of ['mq','mnpq','mnpnpq','mnpnpnpq']) {
    const trace = run(machines.cycle,input); equal(`cycle ${input}`,trace.accepted,true);
    contains(1,input==='mnpnpnpq'?'checkpointAnswer':'content',code(trace.states.join(' → ')));
    equal('cycle length',input.length,2+2*(input.match(/np/g)?.length??0));
  }
  equal('blocked halfway versus extra p', ['mnq','mnppq'].map(s=>run(machines.cycle,s).blockedAt),[3,4]);
  regexCases('m(np)*q',['mq','mnpq','mnpnpq','mpq','mnq'],[true,true,true,false,false]);
  regexCases('mn*pq',['mq','mpq'],[false,true]);
  regexCases('(np)*',['nnpp','npnp',''],[false,true,true]);
  regexCases('n*p*',['nnpp'],[true]);
  for (const input of allStrings('mnpq',6)) {
    const cycles = input.length >= 2 && input[0] === 'm' && input.at(-1) === 'q' && input.slice(1,-1).length % 2 === 0 && [...input.slice(1,-1)].every((s,i)=>s==='np'[i%2]);
    assert.equal(run(machines.cycle,input).accepted, cycles); assert.equal(accepts('m(np)*q',input), cycles); modelComparisons+=2;
  }
  cases++;
  const addedR = {...machines.cycle,finals:['R','F']};
  equal('additional accepting R checkpoint', ['mn','mnpn','mnp','mq'].map(s=>run(addedR,s).accepted),[true,true,false,true]);
  regexCases('m(np)*q|m(np)*n',['mn','mnpn','mnp','mq'],[true,true,false,true]);
  for (const s of ['mn','mnpn','mnp','mq']) contains(1,'checkpointAnswer',code(run(addedR,s).states.join(' → ')));
  equal('accepting start adds empty but not m', ['', 'm','mq'].map(s=>run({...machines.cycle,finals:['P','F']},s).accepted),[true,false,true]);
  contains(1,'checkpointAnswer','\\lambda\\;|\\;m(np)^*q');

  regexCases('ka?b+',['kb','kab','kabb','kaab','ka'],[true,true,true,false,false]);
  regexCases('[D-F][2-5]*[^mx]',['D2','F44!','E3x','D','F55^'],[true,true,false,false,true]);
  for (const { language, document } of documents) {
    const rows=tableBlocks(document.chapters[2].content)[0];
    equal('example class verdicts',rows.map(row=>row.at(-1)),[true,true,false,false,true].map(v=>language==='en'?(v?'Accept':'Reject'):(v?'接受':'拒绝')));
    equal('example input order',rows.map(row=>row[0]),['D2','F44!','E3x','D','F55^']);
  }
  regexCases('[D-F2-4]',['D','F','2','4','D2','d'],[true,true,true,true,false,false]);
  regexCases('[D-F][2-4]',['D2','F4','D'],[true,true,false]);
  regexCases('[^mx]',['5','!','m','x',''],[true,true,false,false,false]);
  regexCases('[^mx]*',['','55!','m'],[true,true,false]);
  regexCases('[g^j]',['g','^','j','k'],[true,true,true,false]);
  regexCases('[^g^j]',['g','^','j','k'],[false,false,false,true]);
  regexCases('[r|t]',['r','|','t','rt'],[true,true,true,false]);
  regexCases('r|t',['r','|','t'],[true,false,true]);
  regexCases('[M-P][3-6]*[^az]',['N','M3','P66?','Q4!','N5z'],[false,true,true,false,false]);
  regexCases('[r^u]',['r','^','u','v','7'],[true,true,true,false,false]);
  regexCases('[^r^u]',['r','^','u','v','7'],[false,false,false,true,true]);
  regexCases('h(i|jk)*l',['hl','hijkl','hjkjkl','hi','jkl'],[true,true,true,false,false]);
  regexCases('hi|jkl',['hl','hijkl','hjkjkl','hi','jkl'],[false,false,false,true,true]);
  regexCases('ve?f+',['vf','veff','veef','v'],[true,true,false,false]);
  regexCases('(uv)+',['uvuv','uvv'],[true,false]);
  regexCases('uv+',['uvuv','uvv'],[false,true]);
  regexCases('a.b',['a7b','ab','a!!b'],[true,false,false]);
  for (const pattern of ['[M-P][3-6]*[^az]','[r^u]','[^r^u]','h(i|jk)*l','hi|jkl','ve?f+']) contains(2,'checkpoint',code(pattern));
  for (const s of ['M3','P66?','N5z','r','^','u','v','7','hl','hijkl','hjkjkl','hi','jkl','vf','veff','veef','uvuv','uvv']) contains(2,'checkpointAnswer',code(s));
  localized(2,'content','not the first class character is literal','不处于首字符位置的 `^` 是字面字符');
  localized(2,'checkpointAnswer','accepts exactly `hi` or `jkl`','只接受 `hi` 或 `jkl`');
  localized(2,'checkpointAnswer','`veef` rejects','`veef` 拒绝');
  const boundaryFixtures=[['a*',true,'a','b'],['aa*',false,'a',''],['(ab)*',true,'ab','aba'],['a|bc',false,'a','ac'],['(a|b)c',false,'ac','a']];
  for (const [pattern,empty,yes,no] of boundaryFixtures) regexCases(pattern,['',yes,no],[empty,true,false]);
  for (const {language,document} of documents) {
    const rows=tableBlocks(document.chapters[3].content)[0];
    equal('boundary table patterns',rows.map(r=>r[0]),boundaryFixtures.map(r=>r[0]));
    equal('boundary table empty decisions',rows.map(r=>r[1]),boundaryFixtures.map(r=>language==='en'?(r[1]?'Yes':'No'):(r[1]?'是':'否')));
  }
  regexCases('[3-6]*[5-8]',['5','56','58','65','79'],[true,true,true,true,false]);
  regexCases('[4-7]*[6-9]',['6','46','679','89'],[true,true,true,false]);
  regexCases('a*b*',['','abba','bbb','aaab','ba'],[true,false,true,true,false]);
  regexCases('(a|b)*',['','abba','bbb','aaab','ba'],[true,true,true,true,true]);
  for(const s of allStrings('ab',1)) assert.equal(accepts('a*b*',s),accepts('(a|b)*',s));
  regexCases('(0|1)*01',['001','0011','','01'],[true,false,false,true]);
  regexCases('λ|cd',['','cd','c','cdd','λ'],[true,true,false,false,false]);
  regexCases('ab',['ab','cabd','ab\n'],[true,false,false]);
  for(const s of ['001','0011','01']) contains(3,'checkpointAnswer',code(run(machines.suffix,s).states.join(' → ')));
  for(const s of ['6','46','679','89','abba','bbb','aaab','ba','cd','c','cdd','λ']) contains(3,'checkpointAnswer',code(s));
  localized(3,'content','cannot by itself prove equivalence','不能单凭这一点证明');
  localized(3,'checkpointAnswer','A shortest counterexample is `ba`, length 2','一个最短反例是长度为 2 的 `ba`');
  localized(3,'checkpointAnswer','literal input `λ`','字面输入 `λ`');

  const practice=await json('practice-map.json'), curriculum=await json('../../curriculum.json');
  equal('practice version and unit',[practice.version,practice.unitId],[1,'automata-regex']);
  equal('four positions',practice.chapters.map(c=>c.position),[0,1,2,3]);
  equal('reference distribution',practice.chapters.map(c=>c.references.length),[2,1,3,3]);
  const key=r=>`${r.paperSlug}/${r.questionId}`, mapped=practice.chapters.flatMap(c=>c.references).map(key).sort();
  equal('nine unique references',[mapped.length,new Set(mapped).size],[9,9]);
  equal('curriculum identity',mapped,curriculum.units.find(u=>u.id==='automata-regex').practiceReferences.map(key).sort());
  return { cases, modelComparisons, diagrams: diagrams[0].length, checkpoints: 16 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTutorial(),null,2));
