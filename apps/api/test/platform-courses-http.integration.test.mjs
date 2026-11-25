import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { applicationDatabaseUrl } from './support/workspace-accounts.mjs';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/test/fixtures/pre-workspace/legacy-school.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

// Create an approved school edition using the schema that existed before platform ownership.
async function approvedExercise(db, bankId, ownerId, title, hiddenInput) {
  const { rows: [problem] } = await db.query(
    'INSERT INTO problems(bank_id,owner_account_id) VALUES($1,$2) RETURNING *', [bankId, ownerId]);
  const { rows: [draft] } = await db.query(`
    INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,
      time_limit_ms,memory_limit_mb,validation_status,school_visible_at,rank_review_status,rank_approved_at)
    VALUES($1,$2,'Read a value and print it.','stdio','tokens','print(input())',$3,1000,128,'AC',now(),'approved',now())
    RETURNING id`, [problem.id, title, JSON.stringify([{input:'7',expected:'7'}])]);
  await db.query('INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,$2,$2,100)', [draft.id, hiddenInput]);
  const { rows: [version] } = await db.query('UPDATE problem_versions SET published_at=now() WHERE id=$1 RETURNING *', [draft.id]);
  await db.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [problem.id, version.id]);
  return { problem, version };
}

test('platform courses retain original data and enforce audiences through NestJS and real runtime grants',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.equal(base.pathname,'/campus_qa');assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='platform_course_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection=new URL(base);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let app;
 const password=randomBytes(24).toString('base64url'),origin='http://platform-course.test';
 try{
  // Insert the original records while the pre-ownership schema is still in effect.
  await migrate(pool,{through:'101_course_required_language.sql'});
  const hash=await hashPassword(password),actors={};
  for(const [name,kind] of [['school-admin','admin'],['platform','personal'],['student-a','student'],['student-b','student'],['personal','personal'],['school-teacher','teacher']]){
   const i=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0];
   const a=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[i.id,name,hash])).rows[0];
   if(kind!=='personal')await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[a.id,kind]);
   actors[name]={id:a.id,identityId:i.id};
  }
  const admin=actors['school-admin'];
  const originals=[];
  for(const title of ['Python 专项训练 · 全目录学习路线','9618 Paper 4 Practical Programming with Python','Unrelated school course']){
   const p=(await pool.query('INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,$2,now()) RETURNING *',[admin.id,title])).rows[0];
   const c=(await pool.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Original chapter','Original **content**',0) RETURNING *",[p.id])).rows[0];
   await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[actors['student-a'].identityId,c.id]);
   originals.push({p,c});
  }
  await pool.query("SELECT set_config('campus.school_id',$1,false)",[LEGACY_SCHOOL_ID]);
  const first=originals[0];
  const schoolBank='00000000-0000-4000-8000-000000000001';
  const {problem,version}=await approvedExercise(pool,schoolBank,admin.id,'Platform linked exercise','secret-case');
  const historical=await approvedExercise(pool,schoolBank,admin.id,'Historical assignment exercise','prior-case');
  const bank=(await pool.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'School exercises','school') RETURNING id",[admin.id])).rows[0];
  const {problem:localProblem,version:localVersion}=await approvedExercise(pool,bank.id,admin.id,'School echo','training');
  const pinChapter='INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)';
  await pool.query(pinChapter,[first.c.id,problem.id,version.id,0]);
  await pool.query(pinChapter,[originals[1].c.id,historical.problem.id,historical.version.id,0]);
  const {rows:[priorAssignment]}=await pool.query(`INSERT INTO assignments(title,owner_account_id,due_at,state,published_at,course_path_id)
    VALUES('Before migration',$1,now()+interval '1 day','Published',now(),$2) RETURNING id`,[admin.id,originals[1].p.id]);
  await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,20,0)',[priorAssignment.id,historical.problem.id,historical.version.id]);
  await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[priorAssignment.id,actors['student-a'].identityId]);
  await pool.query(`INSERT INTO legacy_course_publication_versions(school_id,course_id,revision,source_version,title,description,access_scope,chapters)
   SELECT school_id,id,1,extract(epoch FROM updated_at)::text,title,description,access_scope,$2 FROM learning_paths WHERE id=$1`,[first.p.id,JSON.stringify([{id:first.c.id,title:first.c.title,body:first.c.content,problems:[]}])]);
  const listing=(await pool.query('INSERT INTO public_course_listings(school_id,course_id,revision,approved_by) VALUES($1,$2,1,$3) RETURNING id',[LEGACY_SCHOOL_ID,first.p.id,admin.id])).rows[0];
  await provisionPlatformAdministrator(pool,{username:'platform'});
  await migrate(pool,{through:'102_platform_courses.sql'});
  await t.test('migration changes only ownership fields of the two named courses',async()=>{
   for(const [index,{p,c}] of originals.entries()){
    const after=(await pool.query('SELECT * FROM learning_paths WHERE id=$1',[p.id])).rows[0];
    assert.equal(after.owner_scope,index<2?'platform':'school');
    for(const key of Object.keys(p))assert.deepEqual(after[key],p[key],key);
    assert.deepEqual((await pool.query('SELECT * FROM learning_chapters WHERE id=$1',[c.id])).rows[0],c);
   }
   assert.equal((await pool.query('SELECT count(*)::int n FROM learning_progress WHERE completed')).rows[0].n,3);
   assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.course.source_migrated'")).rows[0].n,2);
  });
  // A later course reference keeps the edition's established school ownership.
  await migrate(pool,{through:'110_platform_content_ownership.sql'});
  await pool.query(pinChapter,[originals[1].c.id,localProblem.id,localVersion.id,1]);
  await migrate(pool);
  await t.test('current workspaces preserve migrated chapters, pinned editions and student reading history',async()=>{
   for(const {p,c} of originals.slice(0,2)){
    const migrated=(await pool.query('SELECT p.owner_scope,c.id,c.content FROM learning_paths p JOIN learning_chapters c ON c.path_id=p.id WHERE p.id=$1',[p.id])).rows;
    assert.deepEqual(migrated,[{owner_scope:'platform',id:c.id,content:c.content}]);
    assert.equal((await pool.query('SELECT completed FROM learning_progress WHERE chapter_id=$1 AND identity_id=$2',[c.id,actors['student-a'].identityId])).rows[0].completed,true);
   }
   for(const [chapter,editions] of [
    [first.c,[[problem.id,version.id]]],
    [originals[1].c,[[historical.problem.id,historical.version.id],[localProblem.id,localVersion.id]]],
   ]){
    const pins=await pool.query('SELECT problem_id,version_id FROM chapter_problems WHERE chapter_id=$1 ORDER BY position',[chapter.id]);
    assert.deepEqual(pins.rows.map(pin=>[pin.problem_id,pin.version_id]),editions);
   }
   assert.equal((await pool.query('SELECT owner_scope FROM problems WHERE id=$1',[localProblem.id])).rows[0].owner_scope,'school');
   const unchanged=originals[2];
   const local=(await pool.query('SELECT title,chapters FROM school_courses WHERE school_id=$1 AND id=$2',[LEGACY_SCHOOL_ID,unchanged.p.id])).rows[0];
   assert.equal(local.title,unchanged.p.title);assert.equal(local.chapters[0].id,unchanged.c.id);assert.equal(local.chapters[0].body,unchanged.c.content);
   assert.equal((await pool.query('SELECT read FROM school_course_progress WHERE school_id=$1 AND course_id=$2 AND chapter_id=$3 AND identity_id=$4',[LEGACY_SCHOOL_ID,unchanged.p.id,unchanged.c.id,actors['student-a'].identityId])).rows[0].read,true);
   await migrate(pool);
   assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.course.source_migrated'")).rows[0].n,2);
  });
  const alpha=await provisionSchool(pool,{slug:'platform-alpha',name:'Alpha school',adminUsername:'student-a'});
  const beta=await provisionSchool(pool,{slug:'platform-beta',name:'Beta school',adminUsername:'student-b'});
  await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'teacher')",[alpha.id,actors['school-teacher'].id]);
  const databaseUrl=await applicationDatabaseUrl(pool,connection,schema);
  app=await createApiApplication({databaseUrl,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const endpoint=await app.getUrl();
  async function client(name,registerPersonal=false){
   let cookie='',csrf='';
   const send=async(path,body,method=body===undefined?'GET':'POST',status=200,validCsrf=true)=>{
    const response=await fetch(endpoint+'/api/v1'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie,'X-CSRF-Token':validCsrf?csrf:'invalid'}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;return data;
   };
   const {user}=registerPersonal
    ? await send('/auth/register-personal',{username:name,displayName:name,password},'POST',201)
    : await send('/auth/login',{username:name,password});
   return {send,user};
  }
  async function gradeNext(){
   const workerUrl=new URL(connection);workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
   const worker=createPool(workerUrl.href),judge=new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'platform-course-qa'});
   try{assert.equal(await processSchoolOne({pool:worker,judge}),true);}finally{await worker.end();}
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
   for(const operation of ['publish','unpublish','restore']){
    assert.equal((await school.send(`/learning-paths/${first.p.id}/${operation}`,{},'POST',410)).error.code,'SCHOOL_WORKSPACE_REQUIRED');
    await school.send(`/platform/courses/${first.p.id}/${operation}`,{},'POST',403);
    await school.send(`/schools/${LEGACY_SCHOOL_ID}/courses/${first.p.id}/${operation}`,{},'POST',404);
   }
   await school.send('/learning-paths/'+first.p.id,{title:'unauthorized'},'PATCH',410);
   await school.send('/chapters/'+first.c.id,{content:'unauthorized'},'PATCH',410);
   await school.send('/platform/courses/'+first.p.id,{title:'unauthorized'},'PATCH',403);
   assert.deepEqual((await school.send('/platform/courses')).items,[]);
   await personal.send('/platform/courses',{},'POST',403);
   assert.ok(!(await platform.send('/platform/course-publications')).items.some(c=>c.courseId===first.p.id));
   await school.send(`/schools/${LEGACY_SCHOOL_ID}/course-admissions/${first.p.id}`,undefined,'GET',404);
   await platform.send('/platform/courses',{requestId:randomUUID(),title:'CSRF'},'POST',403,false);
  });
  await t.test('linked problem ownership, learner access and private judge data survive migration',async t=>{
   assert.equal((await pool.query('SELECT owner_scope FROM problems WHERE id=$1',[problem.id])).rows[0].owner_scope,'platform');
   const migratedVersion=(await pool.query('SELECT * FROM problem_versions WHERE id=$1',[version.id])).rows[0];
   for(const [key,value] of Object.entries(version))assert.deepEqual(migratedVersion[key],value,key);
   assert.equal(migratedVersion.course_only_published,false);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_problem_publications WHERE problem_id=$1',[problem.id])).rows[0].n,0);
   const reader=await personal.send('/practice/courses/'+listing.id);
   assert.equal(reader.totalExercises,1);assert.equal(reader.chapters[0].problems[0].problemId,problem.id);
   const detail=await personal.send(`/practice/problems/${problem.id}?courseId=${listing.id}&chapterId=${first.c.id}&versionId=${version.id}`);
   assert.equal(detail.definition.title,version.title);assert.ok(!JSON.stringify(detail).includes('secret-case'));
   assert.equal(detail.definition.tests,undefined);assert.equal(detail.definition.referenceCode,undefined);
   const job=await personal.send(`/practice/problems/${problem.id}/submissions`,{requestId:randomUUID(),kind:'submit',language:'python',code:'print(input())',versionId:version.id,courseId:listing.id,chapterId:first.c.id},'POST',202);
   await t.test('the isolated judge credits the migrated course exercise',{skip:!process.env.GO_JUDGE_TEST_URL},async()=>{
    await gradeNext();
    const result=await personal.send(`/practice/problems/${problem.id}/submissions/${job.id}`);assert.equal(result.status,'AC');
    assert.ok(!JSON.stringify(result).includes('secret-case'));
    assert.equal((await personal.send('/practice/courses/'+listing.id)).completedExercises,1);
   });
   await school.send(`/problems/${problem.id}/versions`,{title:'unauthorized'},'POST',410);
   await school.send(`/admin/problems/${problem.id}`,{archived:true},'PATCH',410);
   await school.send(`/platform/source-problems/${problem.id}/versions`,{title:'unauthorized'},'POST',403);
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
   const bookmark=await school.send('/problems/'+problem.id);
   assert.equal(bookmark.versionId,version.id);assert.equal(bookmark.definition.referenceCode,undefined);
   assert.ok(!JSON.stringify(bookmark).includes('secret-case'));
   await school.send('/platform/source-problems/'+problem.id,undefined,'GET',403);
   assert.ok(!(await school.send(`/schools/${LEGACY_SCHOOL_ID}/problems?view=management`)).items.some(item=>item.id===problem.id));
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
  await t.test('an existing school assignment keeps its platform-owned problem and original version',async t=>{
   const path=`/schools/${LEGACY_SCHOOL_ID}/activities/${priorAssignment.id}`;
   const assignment=await a.send(path);
   assert.equal(assignment.courseId,originals[1].p.id);
   assert.equal(assignment.problems[0].id,historical.problem.id);
   assert.equal(assignment.problems[0].versionId,historical.version.id);
   assert.equal((await pool.query('SELECT owner_scope FROM problems WHERE id=$1',[historical.problem.id])).rows[0].owner_scope,'platform');
   await b.send(path,undefined,'GET',404);
   await t.test('the isolated judge grades the pre-migration assignment',{skip:!process.env.GO_JUDGE_TEST_URL},async()=>{
    const job=await a.send(`${path}/problems/${historical.problem.id}/submissions`,{kind:'submit',language:'python',code:'print(input())',requestId:randomUUID()},'POST',202);
    await gradeNext();
    assert.equal((await a.send(path+'/jobs/'+job.id)).status,'AC');
    assert.equal((await a.send(path)).grade.score,20);
   });
  });
  await t.test('a school teacher assigns the actual platform exercise from the granted Python training course',async t=>{
   assert.equal(first.p.title,'Python 专项训练 · 全目录学习路线');
   const path=`/schools/${LEGACY_SCHOOL_ID}/activities`,options=path+'/options?view=assignment';
   const grantPath=`/platform/content-editors/course/${first.p.id}`;
   const grant={accountId:actors['school-teacher'].id,schoolId:LEGACY_SCHOOL_ID};
   const pin={problemId:problem.id,versionId:version.id,points:30};
   const create={kind:'assignment',audienceMode:'selected',title:'Granted Python exercise',courseId:first.p.id,
    identityIds:[actors['student-a'].identityId,actors['student-b'].identityId],problems:[pin]};
   const draft=(changes={},status=201)=>teacher.send(path,{...create,...changes,requestId:randomUUID()},'POST',status);
   const discover=async()=> (await teacher.send(options)).platformProblems.find(p=>p.problemId===problem.id);
   assert.equal(await discover(),undefined);
   await draft({},409);
   await platform.send(grantPath,grant);
   const candidate=await discover();
   assert.equal(candidate.versionId,version.id);assert.equal(candidate.title,version.title);
   assert.ok(!JSON.stringify(candidate).includes('secret-case'));
   assert.equal(candidate.referenceCode,undefined);
   assert.equal((await teacher.send(options)).problems.some(p=>p.problemId===problem.id),false);
   await draft({courseId:null},404);
   await draft({problems:[{...pin,versionId:historical.version.id}]},404);
   await draft({problems:[{...pin,problemId:historical.problem.id,versionId:historical.version.id}]},404);
   const sourcePath='/platform/courses/'+first.p.id,source=await platform.send(sourcePath);
   const restricted=await platform.send(sourcePath,{expectedRevision:source.revision,sourceVersion:source.sourceVersion,
    audienceScope:'students',studentIds:[actors['student-a'].identityId]},'PATCH');
   const saved=await draft(),activity=path+'/'+saved.id;
   assert.deepEqual(saved.problems.map(p=>[p.id,p.versionId]),[[problem.id,version.id]]);
   const revised=await teacher.send(activity,{...create,expectedRevision:saved.revision},'PATCH');
   const publish={expectedRevision:revised.revision};
   await pool.query('DELETE FROM chapter_problems WHERE chapter_id=$1 AND problem_id=$2',[first.c.id,problem.id]);
   assert.equal(await discover(),undefined);
   await teacher.send(activity+'/publish',publish,'POST',404);
   await pool.query(pinChapter,[first.c.id,problem.id,version.id,0]);
   await platform.send(grantPath,grant,'DELETE');
   assert.equal(await discover(),undefined);
   await teacher.send(activity+'/publish',publish,'POST',409);
   await platform.send(grantPath,grant);
   await teacher.send(activity+'/publish',publish);
   await platform.send(grantPath,grant,'DELETE');
   assert.equal((await a.send(activity)).courseId,first.p.id);
   assert.equal((await b.send(activity)).courseId,null);
   await b.send('/practice/courses/'+first.p.id,undefined,'GET',404);
   const exercise=await b.send(activity+'/problems/'+problem.id);
   assert.equal(exercise.versionId,version.id);
   assert.ok(!JSON.stringify(exercise).includes('secret-case'));
   await t.test('an assigned student earns 30 points using the platform edition in the isolated judge',{skip:!process.env.GO_JUDGE_TEST_URL},async()=>{
    const job=await b.send(activity+'/problems/'+problem.id+'/submissions',{kind:'submit',language:'python',code:'print(input())',requestId:randomUUID()},'POST',202);
    await gradeNext();
    assert.equal((await b.send(activity+'/jobs/'+job.id)).status,'AC');
    assert.equal((await b.send(activity)).grade.score,30);
   });
   await platform.send(sourcePath,{expectedRevision:restricted.revision,sourceVersion:restricted.sourceVersion,audienceScope:'all'},'PATCH');

   // A grant in another school cannot export a source-school-only edition. An
   // explicit release to that school permits an activity pin, never a library copy.
   const remoteGrant={...grant,schoolId:alpha.id},remote=`/schools/${alpha.id}/activities`;
   const remoteOptions=async()=> (await teacher.send(remote+'/options?view=assignment')).platformProblems;
   await platform.send(grantPath,remoteGrant);
   assert.equal(await discover(),undefined);
   assert.ok(!(await remoteOptions()).some(p=>p.problemId===problem.id));
   const remoteDraft=()=>({...create,identityIds:[],requestId:randomUUID()});
   await teacher.send(remote,remoteDraft(),'POST',404);
   const audience={problemIds:[problem.id],targets:[{kind:'school',id:alpha.id}]};
   await platform.send('/platform/problem-audiences',{...audience,operation:'grant'});
   assert.ok((await remoteOptions()).some(p=>p.problemId===problem.id && p.versionId===version.id));
   const remoteSaved=await teacher.send(remote,remoteDraft(),'POST',201);
   assert.equal(remoteSaved.problems[0].versionId,version.id);
   const copy=(await pool.query(`SELECT b.resource_kind,p.published,v.definition FROM school_problems p
     JOIN school_problem_banks b ON (b.school_id,b.id)=(p.school_id,p.bank_id)
     JOIN school_problem_versions v ON (v.school_id,v.problem_id)=(p.school_id,p.id)
     WHERE p.school_id=$1 AND p.id=$2 AND v.id=$3`,[alpha.id,problem.id,version.id])).rows[0];
   assert.equal(copy.resource_kind,'publication');assert.equal(copy.published,false);
   assert.equal(copy.definition.reference_code,undefined);
   await platform.send('/platform/problem-audiences',{...audience,operation:'revoke'});
   assert.ok(!(await remoteOptions()).some(p=>p.problemId===problem.id));
   await teacher.send(remote+'/'+remoteSaved.id+'/publish',{expectedRevision:remoteSaved.revision},'POST',404);
   await platform.send(grantPath,remoteGrant,'DELETE');
  });
  await t.test('a legacy school administrator can assign a granted platform course without changing its learner audience',async t=>{
   const root=`/schools/${LEGACY_SCHOOL_ID}`;
   async function register(name){
    const account=await client(name,true);
    const identity=await school.send(root+'/identities',{kind:'student',number:name,name},'POST',201);
    const {activationCode}=await school.send(`${root}/identities/${identity.id}/activation-code`,{},'POST',201);
    const claim=await account.send('/auth/claim-identity',{schoolSlug:'tianxing-chuangshiji',kind:'student',number:name,name,activationCode});
    assert.equal(claim.identityId,identity.id);
    return {...account,schoolIdentityId:identity.id};
   }
   const student=await register('assignment-learner'),other=await register('assignment-outside-course');
   const courseId=originals[1].p.id,sourcePath='/platform/courses/'+courseId;
   const activities=root+'/activities',options=activities+'/options?view=assignment';
   const editorPath=`/platform/content-editors/course/${courseId}`,editor={accountId:admin.id,schoolId:LEGACY_SCHOOL_ID};
   const initial=await school.send(options);
   assert.ok(!initial.courses.some(item=>item.id===courseId));
   assert.ok(initial.courses.some(item=>item.id===originals[2].p.id && item.scope==='school'));
   await student.send(options,undefined,'GET',403);
   const pin={problemId:localProblem.id,versionId:localVersion.id,points:20};
   const homework={kind:'assignment',audienceMode:'selected',courseId,title:'Platform Python homework',
    endsAt:new Date(Date.now()+86400000).toISOString(),identityIds:[student.schoolIdentityId,other.schoolIdentityId],problems:[pin]};
   assert.equal((await school.send(activities,{...homework,requestId:randomUUID()},'POST',409)).error.code,'COURSE_UNAVAILABLE');

   const source=await platform.send(sourcePath);
   const restricted=await platform.send(sourcePath,{expectedRevision:source.revision,sourceVersion:source.sourceVersion,
    audienceScope:'students',studentIds:[student.user.identityId],requiredLanguage:'python'},'PATCH');
   await platform.send(editorPath,editor);
   const choices=await school.send(options);
   assert.deepEqual(choices.courses.find(item=>item.id===courseId),{id:courseId,title:source.title,requiredLanguage:'python',scope:'platform',problemIds:[historical.problem.id,pin.problemId]});
   assert.equal(choices.problems.find(item=>item.problemId===pin.problemId)?.versionId,pin.versionId);
   assert.ok(!(await school.send(root+'/courses')).items.some(item=>item.id===courseId));
   await student.send('/practice/courses/'+courseId);
   await other.send('/practice/courses/'+courseId,undefined,'GET',404);

   const privateProblem=(await pool.query("INSERT INTO problems(bank_id,owner_account_id,owner_scope) VALUES($1,$2,'platform') RETURNING id",[problem.bank_id,actors.platform.id])).rows[0];
   const privateVersion=(await pool.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,time_limit_ms,memory_limit_mb,
    reference_code,validation_status,published_at,course_only_published)
    VALUES($1,'Restricted exercise','Private prompt','stdio',1000,128,'print(input())','AC',now(),true) RETURNING id`,[privateProblem.id])).rows[0];
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[privateProblem.id,privateVersion.id]);
   await platform.send(`/platform/content-editors/problem/${privateProblem.id}`,editor);
   await pool.query(pinChapter,[originals[1].c.id,privateProblem.id,privateVersion.id,2]);
   const editedOptions=await school.send(options);
   assert.ok(editedOptions.courses.find(c=>c.id===courseId).problemIds.includes(privateProblem.id));
   assert.ok(!editedOptions.platformProblems.some(item=>item.problemId===privateProblem.id));
   assert.equal((await school.send(activities,{...homework,requestId:randomUUID(),problems:[{...pin,problemId:privateProblem.id,versionId:privateVersion.id}]},'POST',404)).error.code,'PROBLEM_UNAVAILABLE');

   const draft=await school.send(activities,{...homework,requestId:randomUUID()},'POST',201);
   assert.equal(draft.courseId,courseId);assert.equal(draft.requiredLanguage,'python');
   const draftPath=activities+'/'+draft.id,publish={expectedRevision:draft.revision};
   await platform.send(editorPath,editor,'DELETE');
   assert.ok(!(await school.send(options)).courses.some(item=>item.id===courseId));
   assert.equal((await school.send(draftPath+'/publish',publish,'POST',409)).error.code,'COURSE_UNAVAILABLE');
   await platform.send(editorPath,editor);
   const assigned=await school.send(draftPath+'/publish',publish);
   assert.equal(assigned.courseId,courseId);assert.equal(assigned.courseScope,'platform');
   assert.equal(assigned.requiredLanguage,'python');assert.equal(assigned.participantCount,2);
   assert.equal(assigned.problems[0].versionId,pin.versionId);
   assert.equal((await student.send(draftPath)).courseId,courseId);
   assert.equal((await other.send(draftPath)).courseId,null);
   await other.send('/practice/courses/'+courseId,undefined,'GET',404);
   const submissions=`${draftPath}/problems/${pin.problemId}/submissions`;
   const wrongLanguage=await student.send(submissions,{kind:'submit',language:'cpp',code:'int main(){}',requestId:randomUUID()},'POST',400);
   assert.equal(wrongLanguage.error.code,'COURSE_LANGUAGE_REQUIRED');
   const job=await student.send(submissions,{kind:'submit',language:'python',code:'print(input())',requestId:randomUUID()},'POST',202);
   await platform.send(editorPath,editor,'DELETE');
   assert.equal((await school.send(draftPath)).courseId,courseId,'revocation retains the published assignment link');
   assert.equal((await student.send(draftPath)).courseId,courseId);
   assert.equal((await other.send(draftPath)).courseId,null);
   await t.test('the isolated judge awards 20 points for the assigned edition after revocation',{skip:!process.env.GO_JUDGE_TEST_URL},async()=>{
    await gradeNext();
    assert.equal((await student.send(draftPath+'/jobs/'+job.id)).status,'AC');
    assert.equal((await student.send(draftPath)).grade.score,20);
    assert.equal((await other.send(draftPath)).grade.score,0);
   });
   await platform.send(sourcePath,{expectedRevision:restricted.revision,sourceVersion:restricted.sourceVersion,audienceScope:'all',requiredLanguage:null},'PATCH');
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
   const paper=(await pool.query("INSERT INTO paper4_papers(owner_account_id,school_id,title,status,published_at,delivery_kind) VALUES($1,$2,'Shared editor Paper 4','published',now(),'catalog') RETURNING id",[admin.id,LEGACY_SCHOOL_ID])).rows[0];
   const definition={exam:{examYear:2026},questions:[{key:'Q1',title:'Visible question title',stages:[{id:'s1',judgeMode:'auto',markingScheme:'PRIVATE_PAPER4_MARKSCHEME'}]}]};
   const runnerCases={s1:[{id:'hidden-case',input:'PRIVATE_PAPER4_INPUT',expected:'PRIVATE_PAPER4_OUTPUT'}]};
   const paperVersion=(await pool.query("INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,reference_solutions,published_at) VALUES($1,'Shared editor Paper 4','',$2,$3,$4,now()) RETURNING id",[paper.id,definition,runnerCases,{s1:'PRIVATE_PAPER4_SOLUTION'}])).rows[0];
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[paper.id,paperVersion.id]);
   const hidden=(await pool.query("INSERT INTO paper4_papers(owner_account_id,school_id,title) VALUES($1,$2,'PRIVATE_PAPER4_DRAFT') RETURNING id",[admin.id,LEGACY_SCHOOL_ID])).rows[0];
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
   await school.send('/learning-paths/'+course.id,undefined,'GET',410);
   await school.send('/practice/courses/'+course.id,undefined,'GET',404);
   await school.send('/chapters/'+course.chapters[0].id+'/progress',{completed:true},'POST',410);
   await school.send(`/practice/courses/${course.id}/chapters/${course.chapters[0].id}/read`,{read:true,expectedRevision:course.revision},'POST',404);
   await change({audienceScope:'students',studentIds:[admin.identityId]},400);
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
