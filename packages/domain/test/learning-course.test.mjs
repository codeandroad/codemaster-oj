import {test} from 'node:test';import assert from 'node:assert/strict';import {pythonPractice} from '../src/python-practice.mjs';import {handleEducation} from '../src/education.mjs';
const id='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
test('20 exercises map to chapters and carry weighted tests, real code and samples',()=>{assert.equal(pythonPractice.length,20);assert.equal(new Set(pythonPractice.map(p=>p.chapterTitle)).size,20);for(const p of pythonPractice){assert.equal(p.mode,'stdio');assert.equal(p.tests.length,5);assert.equal(p.tests.reduce((s,t)=>s+t.weight,0),100);assert.equal(p.samples.length,2);assert.ok(p.referenceCode&&p.statement);}});
function ctx(route,{role='teacher',status='Waiting',bundle=true}={}){const calls=[],path={id,owner_account_id:id,title:'Python',category:'Python',published_at:'now',practice_bundle:bundle?[{chapterId:id,problemId:id,versionId:version,title:'练习',bankId:id}]:[],difficulty:'beginner',cover_key:'python'};const query=async(sql,args=[])=>{calls.push({sql,args});if(sql.startsWith('SELECT * FROM learning_paths'))return {rowCount:1,rows:[path]};if(sql.startsWith('SELECT id,problem_id,validation_status'))return {rowCount:1,rows:[{id:version,problem_id:id,validation_status:status}]};if(sql.startsWith('SELECT c.*'))return {rowCount:1,rows:[{id,path_id:id,position:0,completed:true,title:'章节',content:'内容'}]};if(sql.startsWith('SELECT cp.*'))return {rowCount:1,rows:[{chapter_id:id,problem_id:id,version_id:version,title:'练习',published_at:'now',school_visible_at:'now',rank_review_status:'approved',bank_visibility:'school',bank_archived_at:null,problem_archived_at:null}]};if(sql.startsWith('SELECT DISTINCT version_id'))return {rowCount:1,rows:[{version_id:version}]};if(sql.startsWith('SELECT id,validation_status'))return {rowCount:1,rows:[{id:version,validation_status:status,published_at:null}]};return {rowCount:0,rows:[]};};const client={query,release(){}};return {calls,context:{route,method:route.endsWith('/python-exercises/publish')?'POST':'GET',body:{},user:{id,identityId:id,roles:[role]},pool:{query,connect:async()=>client},helpers:{audit:async()=>{},versionAccess:async()=>({p:{bank_id:id},v:{published_at:'now'}})},url:new URL('https://example.test'+route)}};}
test('practice cannot publish before real validation is AC, transaction rolls back',async()=>{const {context,calls}=ctx(`/learning-paths/${id}/python-exercises/publish`);await assert.rejects(handleEducation(context),e=>e.code==='NOT_VALIDATED');assert.equal(calls.at(-1).sql,'ROLLBACK');assert.ok(!calls.some(c=>c.sql.startsWith('UPDATE problem_versions')));});
test('legacy exercises can publish for review without linking into an already public course',async()=>{
 const {context,calls}=ctx(`/learning-paths/${id}/python-exercises/publish`,{status:'AC'});
 const base=context.pool.query;
 const query=async(sql,args)=>sql.startsWith('SELECT id FROM learning_chapters')?{rowCount:1,rows:[{id}]}:base(sql,args);
 context.pool.query=query;context.pool.connect=async()=>({query,release(){}});
 const response=await handleEducation(context);
 assert.equal(response.status,200);
 assert.ok(calls.some(call=>call.sql.startsWith('UPDATE problem_versions')));
 assert.ok(!calls.some(call=>call.sql.startsWith('DELETE FROM chapter_problems')));
});
test('student cannot generate or publish exercises',async()=>{const {context,calls}=ctx(`/learning-paths/${id}/python-exercises/publish`,{role:'student'});await assert.rejects(handleEducation(context),e=>e.status===403);assert.equal(calls.length,0);});
test('reading and formal AC task counts are independent and version scoped',async()=>{const {context,calls}=ctx(`/learning-paths/${id}`,{role:'student'});const r=await handleEducation(context);assert.equal(r.body.completedChapters,1);assert.equal(r.body.taskCount,1);assert.equal(r.body.completedTasks,1);assert.equal(r.body.chapters[0].problems[0].completed,true);assert.equal(r.body.practiceBundle,undefined);const sql=calls.find(c=>c.sql.startsWith('SELECT DISTINCT version_id'));assert.ok(sql.sql.includes("kind IN ('submit','correction')"));assert.ok(sql.sql.includes("status='AC'"));assert.equal(sql.args[0],id);assert.deepEqual(sql.args[1],[version]);});
test('inaccessible linked versions do not leak into student task totals',async()=>{const {context}=ctx(`/learning-paths/${id}`,{role:'student'});context.helpers.versionAccess=async()=>{throw {status:403};};const r=await handleEducation(context);assert.equal(r.body.taskCount,0);assert.equal(r.body.completedTasks,0);assert.equal(r.body.chapters[0].problems.length,0);});

test('uploaded Python pack creates 20 validated versions transactionally and keeps chapter mapping',async()=>{
 const {context}=ctx(`/learning-paths/${id}/python-exercises`,{bundle:false});context.method='POST';context.body={document:{format:'codemaster-python-practice',version:1,problems:pythonPractice.map(x=>({...x}))}};
 const inserted=[];const base=context.pool.query;const query=async(sql,args)=>{
 if(sql.startsWith('SELECT id,title FROM learning_chapters'))return {rows:pythonPractice.map(x=>({id,title:x.chapterTitle})),rowCount:20};
 if(sql.startsWith('INSERT INTO problem_banks')||sql.startsWith('INSERT INTO problems'))return {rows:[{id}],rowCount:1};
 return base(sql,args);
 };context.pool.query=query;context.pool.connect=async()=>({query,release(){}});
 context.helpers.problemInput=x=>x;context.helpers.insertVersion=async(db,user,problemId,input)=>{inserted.push(input);return {id:version};};
 await handleEducation(context);assert.equal(inserted.length,20);assert.equal(inserted[0].referenceCode,pythonPractice[0].referenceCode);assert.equal(inserted[19].tests.length,5);
});
test('bad uploaded pack rolls back before creating any bank or exercise',async()=>{
 const {context,calls}=ctx(`/learning-paths/${id}/python-exercises`,{bundle:false});context.method='POST';context.body={document:{format:'codemaster-python-practice',version:2,problems:pythonPractice}};
 await assert.rejects(handleEducation(context),e=>e.status===400);assert.equal(calls.at(-1).sql,'ROLLBACK');assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));
});
test('upload to a course with existing practice rejects duplicate creation',async()=>{
 const {context,calls}=ctx(`/learning-paths/${id}/python-exercises`);context.method='POST';context.body={document:{format:'codemaster-python-practice',version:1,problems:pythonPractice}};
 await assert.rejects(handleEducation(context),e=>e.status===409);assert.equal(calls.at(-1).sql,'ROLLBACK');
});
