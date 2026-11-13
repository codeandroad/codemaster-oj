import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { canonicalHash } from '../src/security.mjs';
import { LEGACY_SCHOOL_ID } from '../src/schools.mjs';
import { handlePublicLearning } from '../src/public-learning.mjs';

test('course-only discovery reads shallow statistics without materializing a problem catalog',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='public_course_list_'+randomBytes(6).toString('hex');await manager.query(`CREATE SCHEMA ${schema}`);
 const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const owner=createPool(scoped.href);let runtime;
 try{
  await migrate(owner);await bootstrap(owner,{name:'Course fixture',number:'COURSE',username:'course-fixture',password:randomBytes(24).toString('base64url')});
  const user={...(await owner.query('SELECT id,identity_id AS "identityId" FROM accounts WHERE username=$1',['course-fixture'])).rows[0],roles:['admin']};
  await owner.query("SELECT set_config('campus.school_id',$1,false)",[LEGACY_SCHOOL_ID]);
  const bank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Course fixture','school') RETURNING id",[user.id])).rows[0];
  const problem=(await owner.query("INSERT INTO problems(bank_id,owner_account_id,owner_scope) VALUES($1,$2,'platform') RETURNING id",[bank.id,user.id])).rows[0];
  const version=async(title,published=true)=>{
   const item=(await owner.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,time_limit_ms,memory_limit_mb,validation_status)
    VALUES($1,$2,'Statement','stdio','tokens','PRIVATE_REFERENCE',1000,128,'AC') RETURNING id`,[problem.id,title])).rows[0];
   if(published)await owner.query("UPDATE problem_versions SET published_at=clock_timestamp(),school_visible_at=clock_timestamp(),rank_review_status='approved',rank_approved_at=clock_timestamp() WHERE id=$1",[item.id]);
   await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,item.id]);return item;
  };
  const firstVersion=await version('Original exercise');await version('Current exercise');await version('Private draft',false);
  await owner.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,'submit','PRIVATE_CODE',$5,'fixture','AC',100)`,[user.id,user.identityId,problem.id,firstVersion.id,randomUUID()]);
  const courses=[];
  for(let index=0;index<2;index++){
   const course=(await owner.query("INSERT INTO learning_paths(owner_account_id,title,owner_scope,published_at) VALUES($1,$2,'platform',now()) RETURNING *",[user.id,`Public course ${index}`])).rows[0];
   await owner.query("INSERT INTO platform_course_rules(course_id,rule_key,target_kind) VALUES($1,'all','all')",[course.id]);courses.push(course);
  }
  const chapters=[];
  for(let index=0;index<3;index++)chapters.push((await owner.query(`INSERT INTO learning_chapters(path_id,title,content,position,checkpoint_answer,localizations)
   VALUES($1,$2,$3,$4,'PRIVATE_CHAPTER_ANSWER',$5) RETURNING *`,[courses[0].id,`Lesson ${index}`,'PRIVATE_LESSON_PROSE'.repeat(3000),index,
   {en:{title:'Translated lesson',content:'PRIVATE_CHAPTER_TRANSLATION'.repeat(2000)}}])).rows[0]);
  await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapters[0].id,problem.id,firstVersion.id]);
  await owner.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[user.identityId,chapters[0].id]);
  const paper=(await owner.query(`INSERT INTO acsl_papers(school_id,slug,content_hash,definition,programming_problem_id,programming_version_id)
   VALUES($1,'shared-course-paper','fixture',$2,NULL,NULL) RETURNING *`,[LEGACY_SCHOOL_ID,{title:'Shared paper',questions:[{id:'q1',number:1}]}])).rows[0];
  await owner.query(`INSERT INTO acsl_paper_grades(school_id,paper_id,version_id,account_id,answers,correct_count,question_count)
   VALUES($1,$2,$3,$4,'[{"questionId":"q1","correct":true}]',1,1)`,[LEGACY_SCHOOL_ID,paper.id,paper.version_id,user.id]);
  const acslLink={paperSlug:paper.slug,versionId:paper.version_id,kind:'question',questionId:'q1'};
  for(const [index,chapter] of chapters.entries())await owner.query('UPDATE learning_chapters SET acsl_links=$2 WHERE id=$1',
   [chapter.id,JSON.stringify([acslLink,...(index===0?[{...acslLink,versionId:randomUUID()}]:[])])]);
  const grants=(await readFile(new URL('../grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtimeUrl=new URL(scoped);runtimeUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);runtime=createPool(runtimeUrl.href);
  let trace=[];
  const measured={connect:async()=>{const db=await runtime.connect();return {release:()=>db.release(),query:async(sql,values)=>{
   const result=await db.query(sql,values),json=JSON.stringify(result.rows);trace.push({sql,bytes:Buffer.byteLength(json),prose:/PRIVATE_LESSON_PROSE|PRIVATE_CHAPTER_TRANSLATION|PRIVATE_CHAPTER_ANSWER/.test(json)});return result;
  }};}};
  const call=async(route='/practice/courses')=>{trace=[];const start=performance.now();const response=await handlePublicLearning({pool:measured,user,route,method:'GET',url:new URL(route,'http://course-list.test')});return {body:response.body,trace:[...trace],ms:Math.round(performance.now()-start)};};
  const initial=await call(),entry=initial.body.courses.find(course=>course.id===courses[0].id);
  await t.test('first request counts linked exercises and historical AC without school problem snapshots',async()=>{
   assert.deepEqual(Object.keys(initial.body),['courses']);assert.equal(entry.chapterCount,3);assert.equal(entry.completedChapters,1);
   assert.equal(entry.totalExercises,4);assert.equal(entry.completedExercises,4,'ordinary historical AC and duplicate chapter ACSL links retain credit');
   assert.equal((await owner.query('SELECT count(*)::int n FROM school_problems WHERE id=$1',[problem.id])).rows[0].n,0);
   assert.ok(initial.trace.every(row=>!/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(row.sql)),'discovery must not materialize public problems');
   assert.ok(initial.trace.every(row=>!row.prose),'normal platform discovery must not retrieve chapter text, translations or answers');
   assert.equal(initial.trace.filter(row=>row.sql.includes('SELECT * FROM acsl_papers')).length,1,'one paper shared across chapters is loaded once');
   assert.equal(initial.trace.filter(row=>row.sql.includes('SELECT a.id,a.identity_id AS "identityId",i.name')).length,1,'admission identity context is shared within this request');
   assert.deepEqual(entry.totalExercises,(await call('/practice/courses/'+courses[0].id)).body.totalExercises);
   const compatible=await call('/practice/catalog');assert.deepEqual(compatible.body.courses,initial.body.courses);assert.ok(Array.isArray(compatible.body.problems));
  });
  await t.test('migrated reading hashes retain credit and native read/unread records take precedence',async()=>{
   await owner.query(`INSERT INTO legacy_course_publication_versions(school_id,course_id,revision,source_version,title,description,access_scope,chapters)
    SELECT school_id,id,1,extract(epoch FROM updated_at)::text,title,description,access_scope,$2 FROM learning_paths WHERE id=$1`,
    [courses[0].id,JSON.stringify([{id:chapters[1].id,title:chapters[1].title,body:chapters[1].content}])]);
   const listing=(await owner.query('INSERT INTO public_course_listings(school_id,course_id,revision,approved_by) VALUES($1,$2,1,$3) RETURNING id',[LEGACY_SCHOOL_ID,courses[0].id,user.id])).rows[0];
   await owner.query('INSERT INTO public_course_progress(listing_id,account_id,chapter_id,content_hash,read) VALUES($1,$2,$3,$4,true)',
    [listing.id,user.id,chapters[1].id,canonicalHash({title:chapters[1].title,body:chapters[1].content})]);
   const progress=async()=>{const value=await call();return value.body.courses.find(course=>course.id===listing.id).completedChapters;};
   assert.equal(await progress(),2);
   await owner.query("UPDATE learning_chapters SET content='Revised lesson' WHERE id=$1",[chapters[1].id]);assert.equal(await progress(),1,'changed text invalidates the historical reading hash');
   await owner.query('UPDATE public_course_progress SET content_hash=$2 WHERE listing_id=$1',[listing.id,canonicalHash({title:chapters[1].title,body:'Revised lesson'})]);
   await owner.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,false)',[user.identityId,chapters[1].id]);
   assert.equal(await progress(),1,'native unread must not fall back to old public read');
   assert.ok(trace.every(row=>!row.sql.includes('SELECT id,title,content body')),'native progress needs no prose fallback');
   await owner.query('UPDATE learning_progress SET completed=true WHERE identity_id=$1 AND chapter_id=$2',[user.identityId,chapters[1].id]);assert.equal(await progress(),2);
   const detail=(await call('/practice/courses/'+listing.id)).body;assert.equal(detail.completedChapters,2);assert.equal(detail.chapters[0].checkpointAnswer,'PRIVATE_CHAPTER_ANSWER');
  });
  t.diagnostic(JSON.stringify({courses:initial.body.courses.length,queries:initial.trace.length,dbBytes:initial.trace.reduce((sum,row)=>sum+row.bytes,0),responseBytes:Buffer.byteLength(JSON.stringify(initial.body)),ms:initial.ms}));
 }finally{await runtime?.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
