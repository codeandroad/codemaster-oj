import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { handlePlatformCourses } from '../src/platform-courses.mjs';
import { provisionPlatformAdministrator } from '../src/platform-governance.mjs';

test('platform course lists batch metadata and never load chapter bodies or exercise definitions', {skip:!process.env.TEST_DATABASE_URL,timeout:90000}, async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(base.href),schema='course_list_'+randomBytes(6).toString('hex');await manager.query(`CREATE SCHEMA ${schema}`);
 const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const owner=createPool(scoped.href);let runtime;
 try{
  await migrate(owner);await bootstrap(owner,{name:'List owner',number:'LIST',username:'list-owner',password:randomBytes(24).toString('base64url')});
  await provisionPlatformAdministrator(owner,{username:'list-owner'});const user=(await owner.query("SELECT id FROM accounts WHERE username='list-owner'")).rows[0];
  const grants=(await readFile(new URL('../grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const url=new URL(scoped);url.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);runtime=createPool(url.href);
  let trace=[];
  const pool={connect:async()=>{const db=await runtime.connect();return {release:()=>db.release(),query:async(sql,values)=>{const start=performance.now(),result=await db.query(sql,values);trace.push({sql,values,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(result.rows))});return result;}};}};
  const call=async(suffix='')=>{trace=[];const start=performance.now();const response=await handlePlatformCourses({pool,user,route:'/platform/courses',method:'GET',url:new URL('/platform/courses'+suffix,'http://qa.local')});return {body:response.body,trace:[...trace],ms:performance.now()-start};};
  const create=async(count)=>{
   const ids=[];for(let i=0;i<count;i++){
    const id=randomUUID();ids.push(id);
    await owner.query("INSERT INTO learning_paths(id,owner_account_id,title,owner_scope,cover_image,localizations) VALUES($1,$2,$3,'platform',$4,$5)",[id,user.id,`Course ${id}`,`data:image/png;base64,${'x'.repeat(60000)}`,{en:{title:'Translated course',description:'Translated summary'}}]);
    await owner.query("INSERT INTO platform_course_rules(course_id,rule_key,target_kind) VALUES($1,'all','all')",[id]);
    await owner.query("INSERT INTO learning_chapters(path_id,title,content,position,localizations) SELECT $1,'Chapter '||i,$2,i,$3 FROM generate_series(0,2) i",[id,'LESSON_BODY_MUST_NOT_LOAD'.repeat(1600),{en:{title:'Chapter',content:'HIDDEN_CHAPTER_LOCALIZATION'.repeat(1000)}}]);
   }return ids;
  };
  const [first]=await create(1),small=await call('?view=summary');await create(29);const large=await call('?view=summary');
  await t.test('database work stays bounded when a catalog grows from one course to thirty',()=>{
   assert.equal(small.body.items.length,1);assert.equal(large.body.items.length,30);assert.equal(large.trace.length,small.trace.length);
   assert.ok(large.trace.length<=12,`too many database round trips: ${large.trace.length}`);
   assert.ok(large.trace.every(entry=>!entry.sql.includes('chapter_problems')&&!entry.sql.includes('problem_versions')));
   assert.ok(large.trace.reduce((sum,entry)=>sum+entry.bytes,0)<100000,'list fetched bulky lesson/cover data');
   assert.ok(large.body.items.every(course=>course.chapterCount===3&&course.chapters===undefined&&course.coverImage===null&&course.sections.length===0));
  });
  await t.test('catalog metadata and editor details retain full covers, translations and lesson content',async()=>{
   const full=await call(),item=full.body.items.find(course=>course.id===first),summary=large.body.items.find(course=>course.id===first);
   for(const key of ['id','title','description','chapterCount','audiencePolicy','schools','students','pendingApplications','revision','sourceVersion','published','archived','canEdit','canManage'])assert.deepEqual(summary[key],item[key],key);
   assert.equal(item.coverImage.length,60022);assert.equal(item.localizations.en.title,'Translated course');
   const detail=(await handlePlatformCourses({pool,user,route:`/platform/courses/${first}`,method:'GET',url:new URL(`http://qa.local/platform/courses/${first}`)})).body;
   assert.equal(detail.chapters.length,3);assert.ok(detail.chapters[0].content.startsWith('LESSON_BODY_MUST_NOT_LOAD'));assert.equal(detail.coverImage,item.coverImage);
  });
  await t.test('editor version lookups and save round trips stay bounded for 120 linked problems',async()=>{
   const id=randomUUID();
   await owner.query("INSERT INTO learning_paths(id,owner_account_id,title,owner_scope) VALUES($1,$2,'Large course','platform')",[id,user.id]);
   const chapter=(await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Lesson','Keep this lesson',0) RETURNING id",[id])).rows[0];
   const problems=[];
   for(let i=0;i<120;i++){
    const problem=(await owner.query("INSERT INTO problems(owner_account_id,owner_scope) VALUES($1,'platform') RETURNING id",[user.id])).rows[0];
    const version=(await owner.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb)
     VALUES($1,$2,'Read and print a value.','stdio','tokens','print(input())','[{"input":"2","expected":"2"}]','AC',1000,128) RETURNING id`,[problem.id,`Exercise ${i}`])).rows[0];
    await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,'7','7',100)",[version.id]);
    await owner.query("UPDATE problem_versions SET published_at=now(),school_visible_at=now(),rank_review_status='approved',rank_approved_at=now() WHERE id=$1",[version.id]);
    await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);
    problems.push({problemId:problem.id,versionId:version.id});
   }
   const route=`/platform/courses/${id}`,url=new URL(route,'http://qa.local');
   const detail=async()=>{trace=[];return (await handlePlatformCourses({pool,user,route,url,method:'GET'})).body;};
   const save=async(course,links)=>{trace=[];return (await handlePlatformCourses({pool,user,route,url,method:'PATCH',body:{expectedRevision:course.revision,sourceVersion:course.sourceVersion,
    chapters:[{id:chapter.id,title:'Lesson',content:'Keep this lesson',problems:links}]}})).body;};
   let course=await detail();course=await save(course,problems.slice(0,1));const smallQueries=trace.length;
   course=await save(course,problems);const largeQueries=trace.length;
   assert.equal(largeQueries,smallQueries,'saving more links must not add per-problem database round trips');
   assert.equal(course.chapters[0].problemCount,120);
   assert.deepEqual(course.chapters[0].problems.map(({problemId,versionId})=>({problemId,versionId})),problems);
   assert.ok(course.chapters[0].problems.every(link=>link.canEdit&&link.published&&link.readyForCourse));
   const returned=await detail();assert.deepEqual(returned,course);
   const lookup=trace.find(entry=>entry.sql.includes('live_version'));
   const plan=(await owner.query('EXPLAIN (ANALYZE,FORMAT JSON) '+lookup.sql,lookup.values)).rows[0]['QUERY PLAN'][0];
   let versionScans=0;
   const inspect=node=>{if(node.Alias==='live_version')versionScans+=node['Actual Loops'];for(const child of node.Plans??[])inspect(child);};inspect(plan.Plan);
   assert.ok(versionScans>0&&versionScans<=120,`live versions were scanned ${versionScans} times for 120 problems`);
   const before=(await owner.query('SELECT * FROM chapter_problems WHERE chapter_id=$1 ORDER BY position',[chapter.id])).rows;
   await assert.rejects(save(course,[...problems.slice(0,119),{problemId:problems[119].problemId,versionId:problems[0].versionId}]),error=>error.code==='UNAVAILABLE_COURSE_PROBLEM');
   assert.deepEqual(await detail(),course,'invalid bulk link must roll back course revision and content');
   assert.deepEqual((await owner.query('SELECT * FROM chapter_problems WHERE chapter_id=$1 ORDER BY position',[chapter.id])).rows,before);
   course=await save(course,[]);assert.equal(course.chapters[0].problemCount,0);
   t.diagnostic(JSON.stringify({linkedProblems:120,smallQueries,largeQueries,versionScans}));
  });
  t.diagnostic(JSON.stringify({courses:30,chapters:90,queries:large.trace.length,summaryDbBytes:large.trace.reduce((sum,entry)=>sum+entry.bytes,0),summaryResponseBytes:Buffer.byteLength(JSON.stringify(large.body)),oneCourseMs:Math.round(small.ms),thirtyCourseMs:Math.round(large.ms)}));
 }finally{await runtime?.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
