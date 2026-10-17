import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaper4EntryLoader} from '../src/components/paper4/paper4-entry.ts';
import {paper4ShortTitle} from '../src/components/paper4/model.ts';
const missing=reason=>reason.code==='ATTEMPT_NOT_FOUND';

test('opening an existing submitted paper uses the saved answer and never starts or restarts it',async()=>{
 const open=createPaper4EntryLoader();let starts=0;const attempt={id:'old',status:'submitted',files:[{content:'saved code'}]};
 assert.equal(await open('student:paper',{existing:async()=>attempt,start:async()=>{starts++;return{id:'new'};},missing}),attempt);
 assert.equal(starts,0);
});

test('a new paper automatically starts after only a missing-attempt response',async()=>{
 const open=createPaper4EntryLoader();let starts=0;
 const result=await open('student:paper',{existing:async()=>{throw{code:'ATTEMPT_NOT_FOUND'};},start:async()=>{starts++;return{id:'first'};},missing});
 assert.equal(result.id,'first');assert.equal(starts,1);
 for(const code of ['NOT_STARTED','DEADLINE_PASSED','FORBIDDEN','NOT_FOUND']){
  await assert.rejects(open(`student:${code}`,{existing:async()=>{throw{code};},start:async()=>{starts++;return{};},missing}),reason=>reason.code===code);
 }
 assert.equal(starts,1);
});

test('concurrent entry effects share one request while different students stay isolated and later retries are fresh',async()=>{
 const open=createPaper4EntryLoader();let loads=0,starts=0;let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const request={existing:async()=>{loads++;await gate;throw{code:'ATTEMPT_NOT_FOUND'};},start:async()=>{starts++;return{id:'answer'};},missing};
 const first=open('student-a:paper',request),repeat=open('student-a:paper',request),other=open('student-b:paper',request);
 assert.equal(first,repeat);assert.notEqual(first,other);assert.equal(loads,2);release();
 await Promise.all([first,repeat,other]);assert.equal(starts,2);
 await open('student-a:paper',{existing:async()=>{loads++;return{id:'saved'};},start:async()=>{starts++;return{};},missing});
 assert.equal(loads,3);assert.equal(starts,2);
});

test('short titles preserve explicit wording and derive compact summer/autumn names with spaces',()=>{
 const paper={title:'A very long full examination paper title',examYear:2025,examSession:'summer',examVariant:41};
 assert.equal(paper4ShortTitle(paper),'9618/41 mj 25');
 assert.equal(paper4ShortTitle({...paper,examSession:'autumn',examVariant:43}),'9618/43 on 25');
 assert.equal(paper4ShortTitle({...paper,shortTitle:' Custom practice '}),'Custom practice');
 assert.equal(paper4ShortTitle({title:'x'.repeat(70)}).length,60);
});
