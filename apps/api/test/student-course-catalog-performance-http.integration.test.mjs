import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {applicationDatabaseUrl} from './support/workspace-accounts.mjs';
import {publishedSchoolProblems} from './support/school-problems.mjs';
import {createPool,transaction} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {createDomainServices,loadConfig} from '../../../packages/domain/src/application.mjs';
import {platformCourseAdmission,platformCourseAdmissions} from '../../../packages/domain/src/platform-course-access.mjs';
import {courseAccess} from '../../../packages/domain/src/course-access.mjs';
import {provisionPlatformAdministrator} from '../../../packages/domain/src/platform-governance.mjs';
import {createApiApplication} from '../dist/application.js';

test('student course catalogs batch admission and learner history without widening access', {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='student_course_catalog_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(scoped.href);let runtime,app;
 try{
  await migrate(owner);const password=randomBytes(24).toString('base64url');
  await bootstrap(owner,{schoolSlug:'tianxing-chuangshiji',username:'catalog-admin',password,number:'ADMIN',name:'Catalog admin'});
  const admin=(await owner.query("SELECT id FROM accounts WHERE username='catalog-admin'")).rows[0];
  const {rows:[school]}=await owner.query('SELECT school_id AS id FROM school_memberships WHERE account_id=$1',[admin.id]);
  const createIdentity=async(username)=>{
   const id=(await owner.query("INSERT INTO identities(kind,number,name) VALUES('personal',$1,$1) RETURNING id",[username])).rows[0].id;
   const account=(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[id,username,await hashPassword(password)])).rows[0];
   return {...account,identityId:id,roles:[]};
  };
  const learner=await createIdentity('catalog-learner'), platform=await createIdentity('catalog-publisher');
  await provisionPlatformAdministrator(owner,{username:'catalog-publisher'});
  await owner.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[school.id,learner.id]);
  const dossier=(await owner.query(`INSERT INTO school_identities(school_id,account_id,kind,name,number)
   VALUES($1,$2,'student','Catalog learner','CAT01') RETURNING id`,[school.id,learner.id])).rows[0];
  const makeCourse=async({mode='direct',target='all',rule=true}={})=>{
   const course=(await owner.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,published_at,platform_audience_scope,cover_image,localizations)
    VALUES($1,'Student catalog course',$2,now(),$3,$4,$5) RETURNING id`,[platform.id,'platform',target==='all'?'all':'custom','data:image/png;base64,'+'x'.repeat(50000),{en:{title:'Translated catalog course',description:'Translated description'}}])).rows[0];
   if(rule)course.rule=(await owner.query(`INSERT INTO platform_course_rules(course_id,rule_key,target_kind,school_id,admission_mode)
    VALUES($1,$2,$2,$3,$4) RETURNING *`,[course.id,target,target==='school'?school.id:null,mode])).rows[0];
   return course;
  };
  const courses=[];for(let i=0;i<40;i++)courses.push(await makeCourse());
  const application=await makeCourse({target:'school',mode:'application'}),independent=await makeCourse({target:'independent'}),legacy=await makeCourse({rule:false});
  const runtimeUrl=await applicationDatabaseUrl(owner,scoped,schema);
  runtime=createPool(runtimeUrl);
  let trace=[];
  const query=async(db,sql,values)=>{const response=await db.query(sql,values);trace.push({sql,values,bytes:Buffer.byteLength(JSON.stringify(response.rows))});return response;};
  const observed={get totalCount(){return runtime.totalCount},query:(sql,values)=>query(runtime,sql,values),connect:async()=>{const db=await runtime.connect();return{query:(sql,values)=>query(db,sql,values),release:()=>db.release()};}};
  const config=loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:'http://student-course-catalog.test',COOKIE_SECURE:'false'});
  const services=await createDomainServices(observed,config);
  app=await createApiApplication({databaseUrl:runtimeUrl,logger:false,config});await app.listen(0,'127.0.0.1');const endpoint=(await app.getUrl())+'/api/v1';let cookie;
  const request=async(path,{method='GET',body,csrf,status=200}={})=>{
   const response=await fetch(endpoint+path,{method,headers:{Origin:'http://student-course-catalog.test',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data.error??{})}`);assert.match(response.headers.get('cache-control')??'',/no-store/);
   if(path==='/auth/login')cookie=response.headers.get('set-cookie').split(';')[0];return data;
  };
  const signIn=await request('/auth/login',{method:'POST',body:{username:'catalog-learner',password}});
  const schoolCourses=`/schools/${school.id}/courses`;
  const list=async()=>{const context=await services.prepareRequest({url:'/api/v1'+schoolCourses,method:'GET',headers:{cookie}});trace=[];return(await services.execute('schools',context)).body;};
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
   const catalog=await request('/practice/courses');
   assert.equal(catalog.courses.find(row=>row.id===application.id).admission,'apply');assert.equal(catalog.courses.find(row=>row.id===application.id).completedExercises,undefined);
   assert.ok(!catalog.courses.some(row=>row.id===independent.id||row.id===courses[0].id||row.id===courses[1].id));
   t.diagnostic(JSON.stringify({smallQueries,largeQueries,courses:40}));
  });
  await t.test('school course progress batches repeated links, applies language cutoffs, and preserves chapter credit',async()=>{
   const {bankId,links}=await publishedSchoolProblems(owner,school.id,admin.id,40);
   const chapters=[1,2].map(n=>({id:randomUUID(),title:'Chapter '+n,body:'Read this chapter.',problems:links}));
   const properties={coverImage:'data:image/png;base64,'+'x'.repeat(50000),localizations:{en:{title:'Translated catalog course'}}};
   const schoolWrite=work=>transaction(owner,async db=>{
    await db.query("SELECT set_config('campus.school_id',$1,true)",[school.id]);
    return work(db);
   });
   const course=await schoolWrite(async db=>{
    const {rows:[course]}=await db.query(`INSERT INTO school_courses(school_id,owner_account_id,title,access_scope,create_request_id,create_request_hash,chapters,properties)
     VALUES($1,$2,'School catalog course','school',gen_random_uuid(),'fixture',$3,$4) RETURNING id`,[school.id,admin.id,JSON.stringify(chapters),properties]);
    await db.query(`INSERT INTO school_course_publications(school_id,course_id,revision,title,description,access_scope,chapters,published_by,properties,required_language,language_credit_cutoffs)
     VALUES($1,$2,1,'School catalog course','','school',$3,$4,$5,'python',$6)`,[school.id,course.id,JSON.stringify(chapters),admin.id,properties,{javascript:'2025-01-01T00:00:00.000Z'}]);
    await db.query('UPDATE school_courses SET published=true,published_revision=1 WHERE school_id=$1 AND id=$2',[school.id,course.id]);
    for(const [index,language,date] of [[0,'python','2026-01-01'],[1,'javascript','2024-01-01'],[2,'javascript','2026-01-01']]){
     await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,identity_id,account_id,kind,access_context,
      request_id,request_hash,payload,state,result,created_at,completed_at)
      VALUES($1,$2,$3,$4,$5,'submit','school',gen_random_uuid(),'fixture',$6,'completed',$7,$8,$8)`,
      [school.id,links[index].problemId,links[index].versionId,dossier.id,learner.id,{language},{status:'AC',score:100},date]);
    }
    return course;
   });
   const detailPath=schoolCourses+'/'+course.id;
   await request(detailPath+'/chapters/'+chapters[0].id+'/read',{method:'POST',csrf:signIn.csrfToken,body:{expectedRevision:1,read:true}});
   let item=(await list()).items.find(row=>row.id===course.id);
   // The current course reader counts each chapter's exercises, even when
   // two chapters reference the same problem; one AC gives credit in both.
   assert.equal(item.totalExercises,80);assert.equal(item.completedExercises,4);
   assert.equal(item.chapterCount,2);assert.equal(item.completedChapters,1);
   assert.equal(item.localizations.en.title,'Translated catalog course');assert.equal(item.coverImage,properties.coverImage);
   const historyQueries=trace.filter(row=>row.sql.includes('FROM school_judge_jobs'));
   assert.equal(historyQueries.length,1,'the complete course reads exercise history in one SQL request');
   const lookup=historyQueries[0];
   const plan=await transaction(runtime,async db=>{
    await db.query("SELECT set_config('campus.school_id',$1,true)",[school.id]);
    return (await db.query('EXPLAIN (ANALYZE,FORMAT JSON) '+lookup.sql,lookup.values)).rows[0]['QUERY PLAN'][0];
   });
   const scans=name=>{
    let count=0;const walk=node=>{if(node['Relation Name']===name)count+=node['Actual Loops'];for(const child of node.Plans??[])walk(child);};
    walk(plan.Plan);return count;
   };
   assert.equal(scans('school_judge_jobs'),1,'school submission history should be scanned once');
   assert.ok(scans('school_problem_versions')<=links.length,'repeated links must not repeat version lookups');
   await schoolWrite(db=>db.query("UPDATE school_problems SET revision=revision+1,draft=draft||$3::jsonb WHERE school_id=$1 AND id=$2",
    [school.id,links[0].problemId,{title:'Private newer draft'}]));
   const detail=await request(detailPath);
   assert.equal(detail.chapters[0].problems[0].versionId,links[0].versionId);
   assert.ok(detail.chapters[0].problems[0].available);
   assert.ok(!JSON.stringify(detail).includes('Private newer draft'));
   await schoolWrite(db=>db.query('UPDATE school_problem_banks SET archived=true WHERE school_id=$1 AND id=$2',[school.id,bankId]));
   const archived=await request(detailPath);
   assert.ok(archived.chapters.every(chapter=>chapter.problems.every(p=>!p.available)));
   assert.equal(archived.completedChapters,1);
   t.diagnostic(JSON.stringify({linkedProblems:40,repeatedChapters:2,schoolHistoryScans:scans('school_judge_jobs')}));
  });
 }finally{if(app)await app.close();if(runtime)await runtime.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
