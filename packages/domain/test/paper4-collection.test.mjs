import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parsePaper4Import } from '../src/paper4-import.mjs';
import { parsePaper4BatchImport, exportPaper4Collection } from '../src/paper4-collection.mjs';
import { writePaper4Archive, readPaper4Archive } from '../src/paper4-archive.mjs';
import { paper4RequestBodyLimit } from '../src/paper4-request-limit.mjs';
const source = new URL('../../../content/paper4-pastpapers/', import.meta.url);
const sample = new URL('../../../examples/paper4-english-practice/',import.meta.url);
const file = (filename,bytes) => ({filename,contentBase64:bytes.toString('base64')});
const invalid = error => error.status===400;
async function allPapers(){
 const result=[];
 for(const year of ['2021','2022','2023','2024','2025','2026'])for(const filename of (await readdir(new URL(`${year}/`,source))).filter(name=>/^9618_[sw]\d\d_4[123]\.json$/.test(name)).sort()){
  const buffer=await readFile(new URL(`${year}/${filename}`,source));result.push(file(filename,buffer));
 }
 return result;
}
test('all 32 original Paper 4 packages roundtrip through a clearly named indexed collection ZIP',async()=>{
 const files=await allPapers();assert.equal(files.length,32);
 const parsed=parsePaper4BatchImport({files});assert.equal(parsed.totalPapers,32);
 const papers=parsed.items.map((item,index)=>({id:`paper-${index}`,version_number:1,title:item.createBody.title,description:item.createBody.description,
  definition:{questions:item.createBody.questions,exam:{examYear:item.createBody.examYear,examSession:item.createBody.examSession,examVariant:item.createBody.examVariant}},
  runner_cases:item.createBody.runnerCases,reference_solutions:item.createBody.referenceSolutions}));
 const exported=exportPaper4Collection(papers);assert.equal(exported.filename,'paper4-papers.zip');assert.equal(exported.contentType,'application/zip');
 const entries=readPaper4Archive(Buffer.from(exported.contentBase64,'base64'),{maxEntries:500,maxEntryBytes:1024*1024,maxExpandedBytes:16*1024*1024});
 assert.equal(JSON.parse(entries.get('paper4-index.json')).format,'codemaster-paper4-collection');assert.equal(entries.size,33);
 const imported=parsePaper4BatchImport({files:[{filename:exported.filename,contentBase64:exported.contentBase64}]});
 assert.deepEqual(imported.items.map(item=>item.createBody),parsed.items.map(item=>({...item.createBody,shortTitle:item.preview.shortTitle})));
 assert.equal(imported.items.reduce((n,item)=>n+item.preview.caseCount,0),712);
});
test('multiple JSON, asset-backed ZIP, nested single packages and folder packages are accepted without delivery settings',async()=>{
 const json=await readFile(new URL('paper4-english-practice.json',sample)),zip=await readFile(new URL('paper4-english-practice.zip',sample));
 const multiple=parsePaper4BatchImport({files:[file('paper.json',json),file('paper.zip',zip)]});
 assert.deepEqual(multiple.items[0].createBody,multiple.items[1].createBody);
 const folder=writePaper4Archive([...readPaper4Archive(zip)].map(([name,bytes])=>[`2025/paper41/${name}`,bytes]));
 const collection=writePaper4Archive([['papers/one.json',json],['papers/two.zip',zip]]);
 for(const bytes of [folder,collection])assert.ok(parsePaper4BatchImport({files:[file('collection.zip',bytes)]}).items.length>0);
 const manifest=JSON.parse(json);Object.assign(manifest.paper,{classId:'a-class',startsAt:'2026-01-01',endsAt:'2026-12-31'});
 const result=parsePaper4BatchImport({files:[file('scheduled.json',Buffer.from(JSON.stringify(manifest)))]}).items[0];
 assert.equal(result.createBody.classId,null);assert.equal(result.createBody.startsAt,null);assert.equal(result.createBody.endsAt,null);
});
test('unsafe, ambiguous, ordinary OJ and excessive batch packages fail as a whole',async()=>{
 const json=await readFile(new URL('paper4-english-practice.json',sample));
 for(const files of [[],[file('a.json',json),file('A.json',json)],Array.from({length:101},(_,i)=>file(`${i}.json`,json)),
  [file('problems.json',Buffer.from('{"problems":[]}'))],[file('../paper.json',json)]])assert.throws(()=>parsePaper4BatchImport({files}),invalid);
 assert.throws(()=>parsePaper4BatchImport({files:[file('problems.json',Buffer.from('{"problems":[]}'))]}),/Problem banks/);
 const indexed=path=>writePaper4Archive([['paper4-index.json',JSON.stringify({format:'codemaster-paper4-collection',version:1,papers:[{path},{path}]})],['papers/a.json',json]]);
 assert.throws(()=>parsePaper4BatchImport({files:[file('duplicate.zip',indexed('papers/a.json'))]}),invalid);
 const unused=writePaper4Archive([['papers/a.json',json],['assets/extra.txt','unused']]);
 assert.throws(()=>parsePaper4BatchImport({files:[file('unused.zip',unused)]}),invalid);
 const raw=writePaper4Archive([['Question.pdf','raw PDF']]);assert.throws(()=>parsePaper4BatchImport({files:[file('source.zip',raw)]}),invalid);
 const safe=writePaper4Archive([['papers/a.json',json]]),unsafe=Buffer.from(safe);
 let offset=0;while((offset=unsafe.indexOf('papers/a.json',offset))>=0){unsafe.write('../bad/a.json',offset);offset+=13;}
 assert.throws(()=>parsePaper4BatchImport({files:[file('unsafe.zip',unsafe)]}),invalid);
 const corrupt=Buffer.from(safe),central=corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));corrupt.writeUInt32LE(2*1024*1024,central+24);
 assert.throws(()=>parsePaper4BatchImport({files:[file('large.zip',corrupt)]}),invalid);
 assert.throws(()=>writePaper4Archive([['papers/A.json',json],['papers/a.json',json]]),invalid);
 const existing=parsePaper4Import(file('paper.json',json));assert.equal(existing.preview.totalMarks,75);
});
test('only the two bounded Paper 4 import routes receive the larger HTTP body limit',()=>{
 for(const path of ['/api/v1/paper4/imports/batch-preview','/api/v1/paper4/papers/batch-import'])assert.equal(paper4RequestBodyLimit(path,'POST'),12*1024*1024);
 for(const path of ['/api/v1/paper4/imports/preview','/api/v1/paper4/papers/batch-export','/api/v1/submissions','/api/v1/paper4/papers/batch-import/extra'])assert.equal(paper4RequestBodyLimit(path,'POST'),2*1024*1024);
 assert.equal(paper4RequestBodyLimit('/api/v1/paper4/papers/batch-import','GET'),2*1024*1024);
});
