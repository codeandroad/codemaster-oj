import test from 'node:test';
import {paper4RequestBodyLimit} from '../src/paper4-request-limit.mjs';
import assert from 'node:assert/strict';
import sample from '../../../content/written-papers/cambridge-9618/2025-summer-12.mjs';
import {automaticSuggestions,validateAnswers,validateMarks,publicDefinition,pngBytes,validateWrittenPackage,sha256} from '../src/written-paper-model.mjs';

test('Paper 1 sample has every scoring part, 75 marks and valid response fields',()=>{
 assert.equal(sample.questions.length,29);assert.equal(sample.questions.reduce((s,q)=>s+q.maxMarks,0),75);
 const a=validateAnswers(sample,{});assert.equal(Object.keys(a).length,29);assert.equal(Object.keys(a.q4b.values).length,16);assert.equal(Object.keys(a.q7ai.values).length,56);
 assert.throws(()=>validateAnswers(sample,{q2a:{values:{secret:'x'}}}));
});
test('automatic suggestions normalize only explicit exact-answer rules',()=>{
 const a=validateAnswers(sample,{});a.q2a.values={binary:'0010 0010 1110',hex:'22e'};a.q2bi.values.answer='-30';a.q2bii.values={smallest:'-128',largest:'127'};
 const s=automaticSuggestions(sample,a);assert.deepEqual(s.q2a,{p1:1,p2:1});assert.deepEqual(s.q2bi,{p1:1});assert.deepEqual(s.q2bii,{p1:0,p2:0});assert.deepEqual(s.q1c,{});
});
test('marking caps alternative points, rejects invalid marks and requires complete review',()=>{
 const marks=Object.fromEntries(sample.questions.map(q=>[q.id,{points:Object.fromEntries(q.rubric.points.map(p=>[p.id,1])),feedback:''}]));
 assert.equal(validateMarks(sample,marks,true).score,75);
 assert.equal(validateMarks(sample,marks,true).marks.q1c.score,4);
 delete marks.q1c.points.p1;assert.throws(()=>validateMarks(sample,marks,true));
 marks.q1c.points.p1=0.5;assert.throws(()=>validateMarks(sample,marks));
 marks.q1c.points.p1=2;assert.throws(()=>validateMarks(sample,marks));
});
test('student projection strips marking material and source assets',()=>{
 const definition={...sample,assets:[{id:'qp',purpose:'question'},{id:'ms',purpose:'marking'}]};
 const output=publicDefinition(definition);assert.equal(output.assets.length,1);
 const text=JSON.stringify(output);for(const privateKey of ['rubric','guidance','accepted','normalization'])assert.ok(!text.includes(`"${privateKey}"`));
});
test('packages validate both sources, checksum, total score and image bounds',()=>{
 const pdf=Buffer.from('%PDF-1.4\nfixture\n%%EOF');
 const assets=['question','marking'].map((purpose,i)=>{const content=Buffer.concat([pdf,Buffer.from(String(i))]);return {id:purpose,filename:`${purpose}.pdf`,purpose,mimeType:'application/pdf',sha256:sha256(content),contentBase64:content.toString('base64')};});
 const input=structuredClone(sample);input.questions.find(q=>q.id==='q4a').images=[];input.assets=assets;
 assert.equal(validateWrittenPackage(input).definition.questions.length,29);
 const bad=structuredClone(input);bad.questions[0].maxMarks=4;assert.throws(()=>validateWrittenPackage(bad));
 bad.questions[0].maxMarks=3;bad.assets[0].sha256='0'.repeat(64);assert.throws(()=>validateWrittenPackage(bad));
 assert.throws(()=>pngBytes(Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')));
});

test('written import limits do not expand answer or ordinary route body limits',()=>{
 const root='/api/v1/schools/00000000-0000-4000-8000-000000000052/written-papers';
 for(const path of ['/import','/import-preview'])assert.equal(paper4RequestBodyLimit(root+path,'POST'),12*1024*1024);
 for(const [path,method] of [['/import','PATCH'],['/import/extra','POST'],['/attempts/attempt/answers','PATCH'],['/attempts/attempt/attachments','POST']])assert.equal(paper4RequestBodyLimit(root+path,method),2*1024*1024);
});
