import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool, LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

const migration='102_platform_courses.sql';
const deferredMigrations=[migration,'105_acsl_platform_course.sql','106_platform_course_admissions.sql','108_platform_points_and_requirement_modes.sql','109_python_practice_problem_metadata.sql','110_platform_content_ownership.sql','111_platform_problem_banks.sql','112_platform_editor_account_lookup.sql','116_platform_course_problem_review.sql'];
test('platform courses retain original data and enforce audiences through NestJS and real runtime grants',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.equal(base.pathname,'/campus_qa');assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='platform_course_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection=new URL(base);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let app;
 const password=randomBytes(24).toString('base64url'),origin='http://platform-course.test';
 try{
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('INSERT INTO schema_migrations(name) SELECT unnest($1::text[])',[deferredMigrations]);await migrate(pool);
  await bootstrap(pool,{name:'Original school administrator',number:'A',username:'school-admin',password});
  const admin=(await pool.query("SELECT id,identity_id FROM accounts WHERE username='school-admin'")).rows[0];
  const hash=await hashPassword(password),actors={};
  for(const name of ['platform','student-a','student-b','personal','school-teacher']){
   const i=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$1) RETURNING id",[name])).rows[0];
   const a=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[i.id,name,hash])).rows[0];
   await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[a.id]);actors[name]={id:a.id,identityId:i.id};
  }
  const originals=[];
  for(const title of ['Python 专项训练 · 全目录学习路线','9618 Paper 4 Practical Programming with Python','Unrelated school course']){
   const p=(await pool.query('INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,$2,now()) RETURNING *',[admin.id,title])).rows[0];
   const c=(await pool.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Original chapter','Original **content**',0) RETURNING *",[p.id])).rows[0];
   await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[actors['student-a'].identityId,c.id]);
   originals.push({p,c});
  }
  await pool.query("SELECT set_config('campus.school_id',$1,false)",[LEGACY_SCHOOL_ID]);
  const first=originals[0];
  const problem=(await pool.query("INSERT INTO problems(bank_id,owner_account_id) VALUES('00000000-0000-4000-8000-000000000001',$1) RETURNING *",[admin.id])).rows[0];
  const version=(await pool.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,time_limit_ms,memory_limit_mb,validation_status,
   published_at,school_visible_at,rank_review_status,rank_approved_at)
   VALUES($1,'Platform linked exercise','Read a value and print it.','stdio','tokens','print(input())',$2,1000,128,'AC',NULL,now(),'approved',now()) RETURNING *`,
   [problem.id,JSON.stringify([{input:'7',expected:'7'}])])).rows[0];
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);
  await pool.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,'secret-case','secret-case',100)",[version.id]);
  version.published_at=(await pool.query('UPDATE problem_versions SET published_at=now() WHERE id=$1 RETURNING published_at',[version.id])).rows[0].published_at;
  await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[first.c.id,problem.id,version.id]);
  await pool.query(`INSERT INTO legacy_course_publication_versions(school_id,course_id,revision,source_version,title,description,access_scope,chapters)
   SELECT school_id,id,1,extract(epoch FROM updated_at)::text,title,description,access_scope,$2 FROM learning_paths WHERE id=$1`,[first.p.id,JSON.stringify([{id:first.c.id,title:first.c.title,body:first.c.content,problems:[]}])]);
  const listing=(await pool.query('INSERT INTO public_course_listings(school_id,course_id,revision,approved_by) VALUES($1,$2,1,$3) RETURNING id',[LEGACY_SCHOOL_ID,first.p.id,admin.id])).rows[0];
  await provisionPlatformAdministrator(pool,{username:'platform'});
  await pool.query('DELETE FROM schema_migrations WHERE name=ANY($1::text[])',[deferredMigrations]);await migrate(pool);
  await t.test('migration changes only ownership fields of the two named courses',async()=>{
   for(const [index,{p,c}] of originals.entries()){
    const after=(await pool.query('SELECT * FROM learning_paths WHERE id=$1',[p.id])).rows[0];
    assert.equal(after.owner_scope,index<2?'platform':'school');
    for(const key of Object.keys(p))assert.deepEqual(after[key],p[key],key);
    assert.deepEqual((await pool.query('SELECT * FROM learning_chapters WHERE id=$1',[c.id])).rows[0],c);
   }
   assert.equal((await pool.query('SELECT count(*)::int n FROM learning_progress WHERE completed')).rows[0].n,3);
   await migrate(pool);assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.course.source_migrated'")).rows[0].n,2);
  });
  const alpha=await provisionSchool(pool,{slug:'platform-alpha',name:'Alpha school',adminUsername:'student-a'});
  const beta=await provisionSchool(pool,{slug:'platform-beta',name:'Beta school',adminUsername:'student-b'});
  await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'teacher')",[alpha.id,actors['school-teacher'].id]);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtime=new URL(connection);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  app=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const endpoint=await app.getUrl();
  async function client(name){
   let cookie='',csrf='';
   const send=async(path,body,method=body===undefined?'GET':'POST',status=200,validCsrf=true)=>{
    const response=await fetch(endpoint+'/api/v1'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie,'X-CSRF-Token':validCsrf?csrf:'invalid'}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??data)}`);
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;return data;
   };
   await send('/auth/login',{username:name,password});return {send};
  }
  const platform=await client('platform'),school=await client('school-admin'),a=await client('student-a'),b=await client('student-b'),personal=await client('personal'),teacher=await client('school-teacher');
  const list=async api=>(await api.send('/practice/courses')).courses;
  let course;
  const change=async(patch,status=200)=>{const next=await platform.send('/platform/courses/'+course.id,{...patch,expectedRevision:course.revision,sourceVersion:course.sourceVersion},'PATCH',status);if(status===200)course=next;return next;};
  const action=async(name,status=200)=>{const next=await platform.send(`/platform/courses/${course.id}/${name}`,{expectedRevision:course.revision,sourceVersion:course.sourceVersion},'POST',status);if(status===200)course=next;return next;};
  await t.test('course-only discovery works before any problem materialization and matches the compatible catalog',async()=>{
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_problems WHERE id=$1',[problem.id])).rows[0].n,0);
   const onlyCourses=await personal.send('/practice/courses');
   assert.deepEqual(Object.keys(onlyCourses),['courses']);
   assert.equal(onlyCourses.courses.find(c=>c.id===listing.id).totalExercises,1);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_problems WHERE id=$1',[problem.id])).rows[0].n,0);
   const compatible=await personal.send('/practice/catalog');
   assert.deepEqual(onlyCourses.courses,compatible.courses);assert.ok(Array.isArray(compatible.problems));
  });
  await t.test('platform-only administrator manages migrated sources; school administrator cannot',async()=>{
   const managed=await platform.send('/platform/courses');assert.equal(managed.items.length,2);
   const entry=(await list(personal)).find(c=>c.id===listing.id);assert.equal(entry.sourceSchool,'平台管理员');
   assert.equal((await a.send('/practice/courses/'+listing.id)).completedChapters,1);
   assert.ok(!(await school.send('/learning-paths')).items.some(c=>c.id===first.p.id));
   for(const operation of ['publish','unpublish','restore'])await school.send(`/learning-paths/${first.p.id}/${operation}`,{},'POST',403);
   await school.send('/learning-paths/'+first.p.id,{title:'steal'},'PATCH',403);
   await school.send('/chapters/'+first.c.id,{content:'steal'},'PATCH',403);
   assert.deepEqual((await school.send('/platform/courses')).items,[]);
   await personal.send('/platform/courses',{},'POST',403);
   assert.ok(!(await platform.send('/platform/course-publications')).items.some(c=>c.courseId===first.p.id));
   await school.send(`/schools/${LEGACY_SCHOOL_ID}/course-admissions/${first.p.id}`,undefined,'GET',404);
   await platform.send('/platform/courses',{requestId:randomUUID(),title:'CSRF'},'POST',403,false);
  });
  await t.test('linked problem ownership, learner access and private judge data survive migration',async()=>{
   assert.equal((await pool.query('SELECT owner_scope FROM problems WHERE id=$1',[problem.id])).rows[0].owner_scope,'platform');
   assert.deepEqual((await pool.query('SELECT * FROM problem_versions WHERE id=$1',[version.id])).rows[0],{...version,course_only_published:false});
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_problem_publications WHERE problem_id=$1',[problem.id])).rows[0].n,0);
   const reader=await personal.send('/practice/courses/'+listing.id);
   assert.equal(reader.totalExercises,1);assert.equal(reader.chapters[0].problems[0].problemId,problem.id);
   const detail=await personal.send(`/practice/problems/${problem.id}?courseId=${listing.id}&chapterId=${first.c.id}&versionId=${version.id}`);
   assert.equal(detail.definition.title,version.title);assert.ok(!JSON.stringify(detail).includes('secret-case'));
   assert.equal(detail.definition.tests,undefined);assert.equal(detail.definition.referenceCode,undefined);
   const job=await personal.send(`/practice/problems/${problem.id}/submissions`,{requestId:randomUUID(),kind:'submit',language:'python',code:'print(input())',versionId:version.id,courseId:listing.id,chapterId:first.c.id},'POST',202);
   if(process.env.GO_JUDGE_TEST_URL){
    const workerUrl=new URL(connection);workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
    const worker=createPool(workerUrl.href),judge=new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'platform-course-qa'});
    try{assert.equal(await processSchoolOne({pool:worker,judge}),true);}finally{await worker.end();}
    const result=await personal.send(`/practice/problems/${problem.id}/submissions/${job.id}`);assert.equal(result.status,'AC');
    assert.ok(!JSON.stringify(result).includes('secret-case'));
    assert.equal((await personal.send('/practice/courses/'+listing.id)).completedExercises,1);
   }
   await school.send(`/problems/${problem.id}/versions`,{title:'steal'},'POST',403);
   await school.send(`/admin/problems/${problem.id}`,{archived:true},'PATCH',403);
   const source=await platform.send('/platform/courses/'+first.p.id);
   await platform.send('/platform/courses/'+source.id,{expectedRevision:source.revision,sourceVersion:source.sourceVersion,audienceScope:'schools',schoolIds:[alpha.id]},'PATCH');
   await personal.send(`/practice/problems/${problem.id}?versionId=${version.id}`,undefined,'GET',404);
   await personal.send(`/practice/problems/${problem.id}/submissions`,{requestId:randomUUID(),kind:'submit',language:'python',code:'',versionId:version.id,courseId:listing.id,chapterId:first.c.id},'POST',404);
   await a.send(`/practice/problems/${problem.id}?courseId=${listing.id}&chapterId=${first.c.id}&versionId=${version.id}`);
   const restricted=await platform.send('/platform/courses/'+first.p.id);
   await platform.send('/platform/courses/'+restricted.id,{expectedRevision:restricted.revision,sourceVersion:restricted.sourceVersion,audienceScope:'all'},'PATCH');
  });
  await t.test('per-resource grants allow editing but never publication, audience changes or delegation',async()=>{
   const grantPath=`/platform/content-editors/course/${first.p.id}`,grant={accountId:actors['student-a'].id,schoolId:alpha.id};
   await a.send('/platform/courses/'+first.p.id,undefined,'GET',403);
   await platform.send(grantPath,{accountId:actors.personal.id,schoolId:alpha.id},'POST',400);
   await platform.send(grantPath,grant);
   assert.ok((await a.send('/platform/content-access')).canEdit);
   const source=await a.send('/platform/courses/'+first.p.id);assert.equal(source.canManage,false);
   const edited=await a.send('/platform/courses/'+source.id,{expectedRevision:source.revision,sourceVersion:source.sourceVersion,description:'Authorized teacher edit'},'PATCH');
   await a.send('/platform/courses/'+source.id,{expectedRevision:edited.revision,sourceVersion:edited.sourceVersion,audienceScope:'students',studentIds:[actors.personal.identityId]},'PATCH',403);
   await a.send('/platform/courses/'+source.id+'/unpublish',{expectedRevision:edited.revision,sourceVersion:edited.sourceVersion},'POST',403);
   await a.send(grantPath,{accountId:actors['student-b'].id,schoolId:beta.id},'POST',403);
   assert.equal((await a.send('/platform/source-problems/'+problem.id)).canEdit,true,'course edit grants include currently linked problems');
   const problemGrant=`/platform/content-editors/problem/${problem.id}`;
   await platform.send(problemGrant,grant);
   const draft=await a.send('/platform/source-problems/'+problem.id);assert.equal(draft.tests[0].input,'secret-case');
   const revised=await a.send('/platform/source-problems/'+problem.id+'/versions',{...draft,title:'Authorized problem edit',saveDraft:true,referenceCode:'',expectedVersionId:draft.versionId,expectedRevision:draft.editRevision},'POST',201);
   assert.equal(revised.versionId,version.id);
   assert.equal(revised.editRevision,draft.editRevision+1);
   await a.send('/platform/source-problems/'+problem.id+'/publish',{expectedVersionId:revised.versionId},'POST',403);
   await platform.send('/platform/source-problems/'+problem.id+'/publish',{expectedVersionId:revised.versionId},'POST',409);
   const reader=await personal.send('/practice/courses/'+listing.id);assert.equal(reader.chapters[0].problems[0].versionId,version.id);
   const oldSchoolView=await school.send('/problems/'+problem.id);assert.equal(oldSchoolView.canEdit,false);assert.equal(oldSchoolView.versionId,version.id);
   assert.equal((await school.send('/problems')).items.find(item=>item.id===problem.id)?.canEdit,false);
   const teacherGrant={accountId:actors['school-teacher'].id,schoolId:alpha.id};
   await platform.send(problemGrant,teacherGrant);
   assert.equal((await teacher.send('/platform/source-problems/'+problem.id)).canEdit,true);
   await teacher.send(`/platform/content-editors/problem/${problem.id}`,grant,'POST',403);
   await platform.send(problemGrant,teacherGrant,'DELETE');
   await teacher.send('/platform/source-problems/'+problem.id,undefined,'GET',403);
   await platform.send(problemGrant,grant,'DELETE');assert.equal((await a.send('/platform/source-problems/'+problem.id)).canEdit,true,'course grant remains after a direct problem grant is revoked');
   await platform.send(grantPath,grant,'DELETE');await a.send('/platform/courses/'+source.id,undefined,'GET',403);await a.send('/platform/source-problems/'+problem.id,undefined,'GET',403);
   await platform.send(grantPath,{accountId:actors['student-b'].id,schoolId:beta.id});
   await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2',[beta.id,actors['student-b'].id]);
   await b.send('/platform/courses/'+source.id,undefined,'GET',403);
   await pool.query('UPDATE school_memberships SET revoked_at=NULL WHERE school_id=$1 AND account_id=$2',[beta.id,actors['student-b'].id]);
  });
  await t.test('create, edit and publish use stale-write checks and retain chapter IDs',async()=>{
   const create={requestId:randomUUID(),title:'Platform course',audienceScope:'all',chapters:[{title:'Lesson',content:'Platform **lesson**'}]};
   course=await platform.send('/platform/courses',create,'POST',201);
   assert.equal((await platform.send('/platform/courses',create,'POST',201)).id,course.id);
   await platform.send('/platform/courses',{...create,title:'Conflicting retry'},'POST',409);
   assert.ok(!(await list(personal)).some(c=>c.id===course.id));
   await personal.send('/practice/courses/'+course.id,undefined,'GET',404);
   await action('publish');
   assert.ok((await list(personal)).some(c=>c.id===course.id));
   const old={...course};await change({title:'Updated platform course'});
   await platform.send('/platform/courses/'+course.id,{title:'stale',expectedRevision:old.revision,sourceVersion:old.sourceVersion},'PATCH',409);
   assert.equal(course.chapters[0].id,old.chapters[0].id);
   await change({chapters:[{id:randomUUID(),title:'Foreign',content:'no'}]},400);
   await change({chapters:[]},409);
  });
  await t.test('platform lessons round-trip every bilingual teaching field without erasing omitted fields',async()=>{
   const chapter=course.chapters[0],fields={title:'Complete lesson',content:'Native $2^3=8$ explanation',objective:'Trace the state',checkpoint:'Original self-check',checkpointAnswer:'Original lesson-only answer'};
   const localizations={en:{...fields},zh:{title:'完整课时',content:'原生 $2^3=8$ 讲解',objective:'追踪状态',checkpoint:'原创自测',checkpointAnswer:'仅课内参考答案'}};
   await change({chapters:[{id:chapter.id,...fields,localizations,acslLinks:[]}]});
   const saved=(await platform.send('/platform/courses/'+course.id)).chapters[0];
   for(const [key,value] of Object.entries(fields))assert.equal(saved[key],value,key);
   assert.deepEqual(saved.localizations,localizations);assert.deepEqual(saved.acslLinks,[]);
   await change({chapters:[{id:chapter.id,title:'Retitled without losing teaching material'}]});
   const preserved=(await platform.send('/platform/courses/'+course.id)).chapters[0];
   for(const key of ['content','objective','checkpoint','checkpointAnswer','localizations','acslLinks'])assert.deepEqual(preserved[key],saved[key],key);
   const reader=(await personal.send('/practice/courses/'+course.id)).chapters[0];
   assert.equal(reader.id,chapter.id);assert.equal(reader.body,fields.content);
   for(const key of ['objective','checkpoint','checkpointAnswer','localizations'])assert.deepEqual(reader[key],saved[key],key);
  });
  await t.test('the shared course editor offers only public Paper 4 metadata and preserves pinned references',async()=>{
   const paper=(await pool.query("INSERT INTO paper4_papers(owner_account_id,title,status,published_at,delivery_kind) VALUES($1,'Shared editor Paper 4','published',now(),'catalog') RETURNING id",[admin.id])).rows[0];
   const definition={exam:{examYear:2026},questions:[{key:'Q1',title:'Visible question title',stages:[{id:'s1',judgeMode:'auto',markingScheme:'PRIVATE_PAPER4_MARKSCHEME'}]}]};
   const runnerCases={s1:[{id:'hidden-case',input:'PRIVATE_PAPER4_INPUT',expected:'PRIVATE_PAPER4_OUTPUT'}]};
   const paperVersion=(await pool.query("INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,reference_solutions,published_at) VALUES($1,'Shared editor Paper 4','',$2,$3,$4,now()) RETURNING id",[paper.id,definition,runnerCases,{s1:'PRIVATE_PAPER4_SOLUTION'}])).rows[0];
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[paper.id,paperVersion.id]);
   const hidden=(await pool.query("INSERT INTO paper4_papers(owner_account_id,title) VALUES($1,'PRIVATE_PAPER4_DRAFT') RETURNING id",[admin.id])).rows[0];
   const grantPath=`/platform/content-editors/course/${course.id}`,grant={accountId:actors['school-teacher'].id,schoolId:alpha.id};
   await teacher.send(`/platform/courses/paper4-options?courseId=${course.id}`,undefined,'GET',403);
   await platform.send(grantPath,grant);
   const options=await teacher.send(`/platform/courses/paper4-options?courseId=${course.id}`);
   assert.ok(options.items.some(item=>item.id===paper.id));assert.ok(!options.items.some(item=>item.id===hidden.id));
   const detail=await teacher.send(`/platform/courses/paper4-options?courseId=${course.id}&paperId=${paper.id}`);
   assert.deepEqual(detail.questions,[{key:'Q1',title:'Visible question title'}]);assert.equal(detail.versionId,paperVersion.id);
   assert.ok(!JSON.stringify(detail).includes('PRIVATE_PAPER4'));assert.ok(!JSON.stringify(options).includes('PRIVATE_PAPER4'));
   await teacher.send(`/platform/courses/paper4-options?courseId=${course.id}&paperId=${hidden.id}`,undefined,'GET',404);
   await personal.send(`/platform/courses/paper4-options?courseId=${course.id}`,undefined,'GET',403);
   course=await teacher.send(`/platform/courses/${course.id}`,{expectedRevision:course.revision,sourceVersion:course.sourceVersion,
    chapters:course.chapters.map(chapter=>({...chapter,paper4Links:[{paperId:paper.id,versionId:paperVersion.id,questionKey:'Q1'}]}))},'PATCH');
   const chapter=course.chapters[0];assert.equal(chapter.paper4Links[0].versionId,paperVersion.id);
   const newer=(await pool.query("INSERT INTO paper4_versions(paper_id,version_number,title,description,definition,runner_cases,published_at) VALUES($1,2,'Newer public Paper 4','',$2,$3,now()) RETURNING id",[paper.id,definition,runnerCases])).rows[0];
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[paper.id,newer.id]);
   await change({chapters:course.chapters.map(item=>({...item,title:'Shared editor retained links'}))});
   assert.equal(course.chapters[0].id,chapter.id);assert.deepEqual(course.chapters[0].localizations,chapter.localizations);
   assert.equal(course.chapters[0].paper4Links[0].versionId,paperVersion.id);
   assert.equal((await pool.query('SELECT version_id FROM chapter_paper4_links WHERE chapter_id=$1',[chapter.id])).rows[0].version_id,paperVersion.id);
   await platform.send(grantPath,grant,'DELETE');
   await teacher.send(`/platform/courses/paper4-options?courseId=${course.id}`,undefined,'GET',403);
  });
  await t.test('school audiences block discovery, entry, chapter reads and applications outside the selected schools',async()=>{
   await change({audienceScope:'schools',schoolIds:[alpha.id]});
   assert.ok((await list(a)).some(c=>c.id===course.id));
   for(const denied of [b,personal,school]){
    assert.ok(!(await list(denied)).some(c=>c.id===course.id));
    for(const suffix of ['', '/entry'])await denied.send('/practice/courses/'+course.id+suffix,undefined,'GET',404);
    await denied.send(`/practice/courses/${course.id}/chapters/${course.chapters[0].id}/read`,{read:true,expectedRevision:course.revision},'POST',404);
    await denied.send(`/practice/courses/${course.id}/applications`,{expectedRevision:course.revision},'POST',404);
   }
   await a.send(`/practice/courses/${course.id}/chapters/${course.chapters[0].id}/read`,{read:true,expectedRevision:course.revision});
   assert.equal((await a.send('/practice/courses/'+course.id)).completedChapters,1);
   await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2',[alpha.id,actors['student-a'].id]);
   await a.send('/practice/courses/'+course.id,undefined,'GET',404);
   assert.ok(!(await list(a)).some(c=>c.id===course.id));
   await change({audienceScope:'schools',schoolIds:[]},400);
   await change({audienceScope:'schools',schoolIds:[randomUUID()]},400);
  });
  await t.test('student audiences use stable identities and cannot be bypassed through legacy school routes',async()=>{
   await change({audienceScope:'students',studentIds:[actors.personal.identityId]});
   await personal.send('/practice/courses/'+course.id);
   await b.send('/practice/courses/'+course.id,undefined,'GET',404);
   await school.send('/learning-paths/'+course.id,undefined,'GET',404);
   await school.send('/chapters/'+course.chapters[0].id+'/progress',{completed:true},'POST',403);
   await change({audienceScope:'students',studentIds:[admin.identity_id]},400);
   const candidates=await platform.send('/platform/courses/audience?kind=students&q=personal');
   assert.ok(candidates.items.some(c=>c.id===actors.personal.identityId));
   await personal.send('/platform/courses/audience?kind=students&q=personal',undefined,'GET',403);
  });
  await t.test('withdrawal and restoration preserve progress, contents and original source records',async()=>{
   await change({audienceScope:'all'});
   assert.equal((await a.send('/practice/courses/'+course.id)).completedChapters,1);
   await action('unpublish');await a.send('/practice/courses/'+course.id,undefined,'GET',404);
   await action('publish');await action('archive');await a.send('/practice/courses/'+course.id,undefined,'GET',404);
   await action('restore');assert.equal((await a.send('/practice/courses/'+course.id)).completedChapters,1);
   assert.equal((await pool.query('SELECT content FROM learning_chapters WHERE id=$1',[first.c.id])).rows[0].content,first.c.content);
   const workerConnection=new URL(connection);workerConnection.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
   const worker=createPool(workerConnection.href);try{await assert.rejects(worker.query('SELECT platform_student_ids FROM learning_paths'),/permission denied/);}finally{await worker.end();}
   await pool.query('UPDATE platform_admins SET revoked_at=now() WHERE account_id=$1',[actors.platform.id]);
   assert.deepEqual((await platform.send('/platform/courses')).items,[]);
  });
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
