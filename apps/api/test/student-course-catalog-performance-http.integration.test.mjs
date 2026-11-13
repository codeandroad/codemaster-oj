import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool,transaction} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {createDomainServices,loadConfig} from '../../../packages/domain/src/application.mjs';
import {platformCourseAdmission,platformCourseAdmissions} from '../../../packages/domain/src/platform-course-access.mjs';
import {courseAccess} from '../../../packages/domain/src/course-access.mjs';
import {LEGACY_SCHOOL_ID} from '../../../packages/domain/src/schools.mjs';
import {createApiApplication} from '../dist/application.js';

test('student course catalogs batch admission and learner history without widening access', {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='student_course_catalog_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(scoped.href);let runtime,app;
 try{
  await migrate(owner);const password=randomBytes(24).toString('base64url');
  await bootstrap(owner,{username:'catalog-admin',password,number:'ADMIN',name:'Catalog admin'});
  const admin=(await owner.query("SELECT id FROM accounts WHERE username='catalog-admin'")).rows[0];
  const identity=(await owner.query("INSERT INTO identities(kind,number,name) VALUES('student','catalog-learner','Catalog learner') RETURNING id")).rows[0];
  const learner={...(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,'catalog-learner',await hashPassword(password)])).rows[0],identityId:identity.id,roles:['student']};
  await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[learner.id]);
  await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[learner.id]);
  const makeCourse=async({scope='platform',mode='direct',target='all',rule=true}={})=>{
   const course=(await owner.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,published_at,platform_audience_scope,cover_image,localizations)
    VALUES($1,'Student catalog course',$2,now(),$3,$4,$5) RETURNING id`,[admin.id,scope,target==='all'?'all':'custom','data:image/png;base64,'+'x'.repeat(50000),{en:{title:'Translated catalog course',description:'Translated description'}}])).rows[0];
   if(rule&&scope==='platform')course.rule=(await owner.query(`INSERT INTO platform_course_rules(course_id,rule_key,target_kind,school_id,admission_mode)
    VALUES($1,$2,$2,$3,$4) RETURNING *`,[course.id,target,target==='school'?LEGACY_SCHOOL_ID:null,mode])).rows[0];
   return course;
  };
  const courses=[];for(let i=0;i<40;i++)courses.push(await makeCourse());
  const application=await makeCourse({target:'school',mode:'application'}),independent=await makeCourse({target:'independent'}),legacy=await makeCourse({rule:false});
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtimeUrl=new URL(scoped);runtimeUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);runtime=createPool(runtimeUrl.href);
  let trace=[];
  const query=async(db,sql,values)=>{const response=await db.query(sql,values);trace.push({sql,values,bytes:Buffer.byteLength(JSON.stringify(response.rows))});return response;};
  const observed={get totalCount(){return runtime.totalCount},query:(sql,values)=>query(runtime,sql,values),connect:async()=>{const db=await runtime.connect();return{query:(sql,values)=>query(db,sql,values),release:()=>db.release()};}};
  const config=loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:'http://student-course-catalog.test',COOKIE_SECURE:'false'});
  const services=await createDomainServices(observed,config);
  app=await createApiApplication({databaseUrl:runtimeUrl.href,logger:false,config});await app.listen(0,'127.0.0.1');const endpoint=(await app.getUrl())+'/api/v1';let cookie;
  const request=async(path,{method='GET',body,status=200}={})=>{
   const response=await fetch(endpoint+path,{method,headers:{Origin:'http://student-course-catalog.test',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data.error??{})}`);assert.match(response.headers.get('cache-control')??'',/no-store/);
   if(path==='/auth/login')cookie=response.headers.get('set-cookie').split(';')[0];return data;
  };
  await request('/auth/login',{method:'POST',body:{username:'catalog-learner',password}});
  const list=async()=>{const context=await services.prepareRequest({url:'/api/v1/learning-paths?includeAdmission=true',method:'GET',headers:{cookie}});trace=[];return(await services.execute('education',context)).body;};
  await t.test('one or forty platform courses use fixed metadata queries and scoped admissions',async()=>{
   trace=[];await platformCourseAdmissions(observed,[courses[0].id],learner.id);const smallQueries=trace.length;
   trace=[];const entries=await platformCourseAdmissions(observed,courses.map(c=>c.id),learner.id),largeQueries=trace.length;
   assert.equal(largeQueries,smallQueries);assert.ok(largeQueries<=10);assert.ok([...entries.values()].every(entry=>entry.admission==='direct'));
   assert.ok(trace.reduce((sum,row)=>sum+row.bytes,0)<50000,'admission checks fetched cover or source payloads');
   const ids=[courses[0].id,application.id,independent.id,legacy.id];
   const compare=async()=>{const batched=await platformCourseAdmissions(runtime,ids,learner.id);for(const id of ids)assert.deepEqual(batched.get(id),await platformCourseAdmission(runtime,id,learner.id));return batched;};
   let access=await compare();assert.equal(access.get(application.id).admission,'apply');assert.equal(access.get(independent.id).admission,'denied');assert.equal(access.get(legacy.id).admission,'direct');
   const record=(await owner.query(`INSERT INTO platform_course_admissions(course_id,rule_id,generation,account_id,origin,status)
    VALUES($1,$2,$3,$4,'application','approved') RETURNING id`,[application.id,application.rule.id,application.rule.generation,learner.id])).rows[0];
   assert.equal((await compare()).get(application.id).admission,'direct');
   await owner.query("UPDATE platform_course_admissions SET status='revoked' WHERE id=$1",[record.id]);assert.equal((await compare()).get(application.id).admission,'rejected');
   await owner.query('UPDATE platform_course_rules SET generation=gen_random_uuid() WHERE id=$1',[application.rule.id]);assert.equal((await compare()).get(application.id).admission,'apply');
   await transaction(runtime,async db=>{
    await db.query("SELECT set_config('campus.account_id',$1,true)",[admin.id]);await platformCourseAdmissions(db,ids,learner.id);
    assert.equal((await db.query("SELECT current_setting('campus.account_id',true) account")).rows[0].account,admin.id);
   });
   await owner.query('UPDATE learning_paths SET listed=false WHERE id=$1',[courses[0].id]);
   assert.equal((await courseAccess(runtime,learner,[courses[0].id],{listed:true})).readable.size,0);
   assert.equal((await courseAccess(runtime,learner,[courses[0].id])).readable.size,1);
   for(const change of ["available_from=now()+interval '1 day'",'archived_at=now()','withdrawn_at=now()']){
    await owner.query('UPDATE learning_paths SET available_from=NULL,archived_at=NULL,withdrawn_at=NULL WHERE id=$1',[courses[1].id]);
    await owner.query(`UPDATE learning_paths SET ${change} WHERE id=$1`,[courses[1].id]);
    assert.equal((await platformCourseAdmissions(runtime,[courses[1].id],learner.id)).get(courses[1].id).admission,'denied');
   }
   await owner.query('UPDATE platform_course_rules SET active=false WHERE course_id=$1',[courses[2].id]);
   assert.equal((await platformCourseAdmissions(runtime,[courses[2].id],learner.id)).get(courses[2].id).admission,'denied');
   const catalog=await request('/learning-paths?includeAdmission=true');
   assert.equal(catalog.items.find(row=>row.id===application.id).admission,'apply');assert.equal(catalog.items.find(row=>row.id===application.id).completedTasks,undefined);
   assert.ok(!catalog.items.some(row=>row.id===independent.id||row.id===courses[0].id||row.id===courses[1].id));
   t.diagnostic(JSON.stringify({smallQueries,largeQueries,courses:40}));
  });
  await t.test('course task credit scans visible history once and retains live versions, language and chapter progress',async()=>{
   const course=await makeCourse({scope:'school'});
   await owner.query("UPDATE learning_paths SET required_language='python',language_credit_cutoffs=$2 WHERE id=$1",[course.id,{javascript:'2025-01-01T00:00:00.000Z'}]);
   const chapters=[];for(let i=0;i<2;i++)chapters.push((await owner.query("INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'Repeated practice',$2) RETURNING id",[course.id,i])).rows[0]);
   const bank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Course exercises','school') RETURNING id",[admin.id])).rows[0];
   const problems=[];
   for(let i=0;i<40;i++){
    const problem=(await owner.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[admin.id,bank.id])).rows[0];
    const version=(await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,validation_status,time_limit_ms,memory_limit_mb,published_at,school_visible_at,rank_review_status,rank_approved_at)
     VALUES($1,'Practice','stdio','Print one','print(1)','AC',1000,64,now(),now(),'approved',now()) RETURNING id`,[problem.id])).rows[0];
    await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);problems.push({...problem,versionId:version.id});
    for(const chapter of chapters)await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)',[chapter.id,problem.id,version.id,i]);
   }
   for(const [position,language,createdAt] of [[0,'python','2026-01-01'],[1,'javascript','2024-01-01'],[2,'javascript','2026-01-01']]){
    const problem=problems[position];await owner.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,language,code,idempotency_key,request_hash,status,score,created_at)
     VALUES($1,$2,$3,$4,'submit',$5,'private code',$6,'fixture','AC',100,$7)`,[learner.id,learner.identityId,problem.id,problem.versionId,language,randomUUID(),createdAt]);
   }
   await owner.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[learner.identityId,chapters[0].id]);
   let item=(await list()).items.find(row=>row.id===course.id);assert.equal(item.taskCount,40);assert.equal(item.completedTasks,2);assert.equal(item.chapterCount,2);assert.equal(item.completedChapters,1);
   assert.equal(item.localizations.en.title,'Translated catalog course');assert.ok(item.coverImage.endsWith('x'.repeat(50000)));
   const lookup=trace.find(row=>row.sql.includes('visible_progress AS MATERIALIZED'));
   const plan=await transaction(runtime,async db=>{await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);return(await db.query('EXPLAIN (ANALYZE,FORMAT JSON) '+lookup.sql,lookup.values)).rows[0]['QUERY PLAN'][0];});
   let historyScans=0,versionScans=0;const inspect=node=>{if(node.RelationName==='submissions'||node['Relation Name']==='submissions')historyScans+=node['Actual Loops'];if(node.Alias==='live_version')versionScans+=node['Actual Loops'];for(const child of node.Plans??[])inspect(child);};inspect(plan.Plan);
   assert.equal(historyScans,1);assert.ok(versionScans<=40);
   await owner.query("INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,'Private newer draft','stdio','Private draft','print(2)','Incomplete',1000,64)",[problems[0].id]);
   item=(await request('/learning-paths?includeAdmission=true')).items.find(row=>row.id===course.id);assert.equal(item.taskCount,40);assert.equal(item.completedTasks,2);
   await owner.query('UPDATE problems SET archived_at=now() WHERE id=$1',[problems[0].id]);
   item=(await list()).items.find(row=>row.id===course.id);assert.equal(item.taskCount,39);assert.equal(item.completedTasks,1);
   await owner.query("UPDATE problem_banks SET visibility='private' WHERE id=$1",[bank.id]);
   item=(await list()).items.find(row=>row.id===course.id);assert.equal(item.taskCount,0);assert.equal(item.completedTasks,0);assert.equal(item.completedChapters,1);
   t.diagnostic(JSON.stringify({linkedProblems:40,repeatedChapters:2,historyScans,versionScans}));
  });
 }finally{if(app)await app.close();if(runtime)await runtime.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
