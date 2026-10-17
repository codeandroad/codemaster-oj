import {test} from 'node:test';import assert from 'node:assert/strict';import {validateLearningDocument} from '../src/learning-document.mjs';import {handleEducation} from '../src/education.mjs';
const doc={format:'codemaster-learning-path',version:1,title:'Python',description:'课程',category:'Python',estimatedMinutes:90,chapters:[{title:'开始',content:'print(1)',objective:'运行',checkpoint:'练习',checkpointAnswer:'1',problemIds:[]}]};
test('server validates document and drops foreign IDs/progress/published status',()=>{const d=validateLearningDocument({...doc,published:true,completed:true,id:'foreign'});assert.equal(d.chapters.length,1);assert.equal(d.published,undefined);assert.equal(d.id,undefined);});
test('bad version, empty content and invalid UUID are rejected server-side',()=>{assert.throws(()=>validateLearningDocument({...doc,version:2}));assert.throws(()=>validateLearningDocument({...doc,chapters:[{...doc.chapters[0],content:''}]}));assert.throws(()=>validateLearningDocument({...doc,chapters:[{...doc.chapters[0],problemIds:['fake']}]}));});
function context(failChapter=false,role='teacher') {const calls=[],id='11111111-1111-4111-8111-111111111111';const db={release(){},async query(sql,params){calls.push({sql,params});if(sql.startsWith('INSERT INTO learning_paths'))return {rowCount:1,rows:[{id,estimated_minutes:90,title:'Python'}]};if(sql.startsWith('INSERT INTO learning_chapters')){if(failChapter)throw Error('database failure');return {rowCount:1,rows:[{id}]};}return {rowCount:0,rows:[]};}};return {calls,ctx:{route:'/learning-paths/import',method:'POST',body:doc,user:{id,identityId:id,roles:[role]},pool:{connect:async()=>db},helpers:{audit:async()=>{calls.push({sql:'AUDIT'});}},url:new URL('https://example.test/api/v1/learning-paths/import')}};}
test('import commits the path and chapters together as a draft',async()=>{const {ctx,calls}=context();const r=await handleEducation(ctx);assert.equal(r.status,201);assert.equal(r.body.published,false);assert.equal(r.body.chapterCount,1);assert.equal(calls.at(-1).sql,'COMMIT');assert.ok(!calls.some(c=>c.sql.includes('published_at')));});
test('database failure rolls back the entire import',async()=>{const {ctx,calls}=context(true);await assert.rejects(handleEducation(ctx));assert.equal(calls.at(-1).sql,'ROLLBACK');assert.ok(!calls.some(c=>c.sql==='COMMIT'));});
test('student cannot import learning paths',async()=>{const {ctx,calls}=context(false,'student');await assert.rejects(handleEducation(ctx),e=>e.status===403);assert.equal(calls.length,0);});

test('course document permits bounded embedded covers and rejects oversize documents and unsafe image types',()=>{
 const header=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB','base64');
 const bounded=Buffer.alloc(524288);header.copy(bounded);
 const coverImage='data:image/png;base64,'+bounded.toString('base64');
 const imported=validateLearningDocument({...doc,coverImage,authorName:'Author',authoredAt:'2024-01-01T00:00:00Z',classIds:['foreign'],accessScope:'classes',listed:false});
 assert.equal(imported.coverImage,coverImage);assert.equal(imported.authorName,'Author');assert.equal(imported.accessScope,undefined);assert.equal(imported.classIds,undefined);assert.equal(imported.listed,undefined);
 assert.throws(()=>validateLearningDocument({...doc,coverImage:'data:image/png;base64,'+Buffer.concat([bounded,Buffer.from([0])]).toString('base64')}),error=>error.code==='INVALID_COVER');
 assert.throws(()=>validateLearningDocument({...doc,extra:'x'.repeat(1572864)}),error=>error.status===413);
 assert.throws(()=>validateLearningDocument({...doc,coverImage:'data:image/svg+xml;base64,PHN2Zy8+'}),error=>error.code==='INVALID_COVER');
});
