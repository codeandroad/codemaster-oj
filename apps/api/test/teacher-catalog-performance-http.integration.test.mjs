import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool,transaction} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {createDomainServices,loadConfig} from '../../../packages/domain/src/application.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {provisionPlatformAdministrator} from '../../../packages/domain/src/platform-governance.mjs';
import {LEGACY_SCHOOL_ID} from '../../../packages/domain/src/schools.mjs';

test('teacher catalogs stay compact and course reads do not fetch every exercise source', {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='teacher_catalog_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(scoped.href);let app,runtime;
 try{
  await migrate(owner);const password=randomBytes(24).toString('base64url');
  await bootstrap(owner,{username:'catalog-admin',password,number:'ADMIN',name:'Catalog admin'});
  await provisionPlatformAdministrator(owner,{username:'catalog-admin'});
  const admin=(await owner.query("SELECT id FROM accounts WHERE username='catalog-admin'")).rows[0];
  const passwordHash=await hashPassword(password),users={};
  for(const name of ['teacher','peer','student']){
   const kind=name==='student'?'student':'teacher';
   const identity=(await owner.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0];
   users[name]=(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,name,passwordHash])).rows[0];
   await owner.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[users[name].id,kind]);
   await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[users[name].id]);
  }
  const bank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Course exercises','school') RETURNING id",[users.teacher.id])).rows[0];
  const otherBank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Private exercises','private') RETURNING id",[users.peer.id])).rows[0];
  const statement='PUBLIC_STATEMENT_PAYLOAD '.repeat(1000),reference='PRIVATE_REFERENCE_PAYLOAD '.repeat(1000);
  const problems=[];
  for(let i=0;i<40;i++){
   const problem=(await owner.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[users.teacher.id,bank.id])).rows[0];
   const version=(await owner.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb,metadata)
    VALUES($1,$2,$3,'stdio','tokens',$4,'[{"input":"2","expected":"2"}]','AC',1000,128,'{"difficulty":"easy"}') RETURNING id`,[problem.id,`Exercise ${i}`,statement,reference])).rows[0];
   await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,'7','7',100)",[version.id]);
   await owner.query("UPDATE problem_versions SET published_at=now(),school_visible_at=now(),rank_review_status='approved',rank_approved_at=now() WHERE id=$1",[version.id]);
   await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);problems.push({...problem,versionId:version.id});
  }
  const hidden=(await owner.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[users.peer.id,otherBank.id])).rows[0];
  const hiddenVersion=(await owner.query("INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,'Hidden repair link','Hidden draft','stdio','tokens','print(1)','[]','Incomplete',1000,128) RETURNING id",[hidden.id])).rows[0];
  const course=(await owner.query("INSERT INTO learning_paths(owner_account_id,title,cover_image,localizations) VALUES($1,'Teacher course',$2,$3) RETURNING id",[users.teacher.id,'data:image/png;base64,cover',{en:{title:'Bilingual catalog title',description:'Searchable translation'}}])).rows[0];
  const chapter=(await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Lesson','Retained bilingual lesson',0) RETURNING id",[course.id])).rows[0];
  await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapter.id,problems[0].id,problems[0].versionId]);
  const platform=(await owner.query("INSERT INTO learning_paths(owner_account_id,title,owner_scope) VALUES($1,'Platform course','platform') RETURNING id",[admin.id])).rows[0];
  await owner.query("UPDATE problems SET owner_scope='platform' WHERE id=$1",[problems[39].id]);
  await owner.query("INSERT INTO platform_content_editors(resource_kind,resource_id,account_id,school_id,granted_by) VALUES('problem',$1,$2,$3,$4)",[problems[39].id,users.teacher.id,LEGACY_SCHOOL_ID,admin.id]);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtimeUrl=new URL(scoped);runtimeUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);runtime=createPool(runtimeUrl.href);
  const origin='http://teacher-catalog.test',config=loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'});
  app=await createApiApplication({databaseUrl:runtimeUrl.href,logger:false,config});await app.listen(0,'127.0.0.1');const endpoint=(await app.getUrl())+'/api/v1',sessions={};
  const request=async(path,{actor='teacher',method='GET',body,status=200}={})=>{
   const response=await fetch(endpoint+path,{method,headers:{Origin:origin,...(sessions[actor]?{Cookie:sessions[actor]}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data.error??{})}`);assert.match(response.headers.get('cache-control')??'',/no-store/);
   if(path==='/auth/login')sessions[actor]=response.headers.get('set-cookie').split(';')[0];return data;
  };
  for(const actor of Object.keys(users))await request('/auth/login',{actor,method:'POST',body:{username:actor,password}});
  await t.test('summary transport retains versions, status, filtering and permissions without source bodies',async()=>{
   const full=await request('/problems'),summary=await request('/problems?view=summary');
   assert.deepEqual(summary.items.map(p=>p.id),full.items.map(p=>p.id));
   for(const item of summary.items){
    const previous=full.items.find(p=>p.id===item.id);
    for(const key of ['title','mode','difficulty','versionId','publishedVersionId','publishedTitle','publishedDifficulty','formalTestCount','validationStatus','rankReviewStatus','bankId','canEdit','canPublish','canManageTutorial'])assert.deepEqual(item[key],previous[key],key);
    for(const key of ['statement','samples','starterCode','starterCodes','referenceCode','ownProgress'])assert.equal(item[key],undefined,key);
   }
   assert.ok(!summary.items.some(p=>p.id===hidden.id));
   assert.equal((await request(`/problems?view=summary&bankId=${otherBank.id}`)).items.length,0);
   assert.ok(Buffer.byteLength(JSON.stringify(summary))<Buffer.byteLength(JSON.stringify(full))/10);
   await request('/problems?view=summary',{actor:'student',status:403});
   const sources=await request('/platform/source-problems?view=summary');assert.deepEqual(sources.items.map(p=>p.id),[problems[39].id]);assert.equal(sources.items[0].canPublish,false);assert.equal(sources.items[0].statement,undefined);assert.equal(sources.items[0].formalTestCount,1);
   assert.equal((await request('/platform/source-problems?view=summary',{actor:'peer'})).items.length,0);
   await owner.query('UPDATE platform_content_editors SET revoked_at=now() WHERE resource_id=$1',[problems[39].id]);
   assert.equal((await request('/platform/source-problems?view=summary')).items.length,0);
   t.diagnostic(JSON.stringify({problemRows:summary.items.length,fullBytes:Buffer.byteLength(JSON.stringify(full)),summaryBytes:Buffer.byteLength(JSON.stringify(summary))}));
  });
  let trace=[];
  const query=async(db,sql,values)=>{const response=await db.query(sql,values);trace.push({sql,values,bytes:Buffer.byteLength(JSON.stringify(response.rows))});return response;};
  const observed={query:(sql,values)=>query(runtime,sql,values),connect:async()=>{const db=await runtime.connect();return{query:(sql,values)=>query(db,sql,values),release:()=>db.release()};}};
  const services=await createDomainServices(observed,config);
  const domainRead=async(path,area='education')=>{const context=await services.prepareRequest({url:'/api/v1'+path,method:'GET',headers:{cookie:sessions.teacher}});trace=[];return(await services.execute(area,context)).body;};
  await t.test('course catalog preserves covers and bilingual search without learner projections or unrelated platform courses',async()=>{
   const list=await request('/learning-paths?view=summary');assert.equal(list.items.length,1);assert.equal(list.items[0].id,course.id);assert.equal(list.items[0].coverImage,'data:image/png;base64,cover');assert.equal(list.items[0].localizations.en.title,'Bilingual catalog title');
   assert.ok(!list.items.some(p=>p.id===platform.id));await request('/learning-paths?view=summary',{actor:'student',status:403});
   await domainRead('/learning-paths?view=summary');assert.ok(trace.every(entry=>!entry.sql.includes('FROM chapter_problems')&&!entry.sql.includes('FROM problem_versions')));
  });
  await t.test('editor round trips stay bounded, live versions remain correct and private repair links stay hidden',async()=>{
   const small=await domainRead(`/learning-paths/${course.id}`),smallQueries=trace.length;assert.equal(small.chapters[0].problems.length,1);
   for(const [position,problem] of problems.slice(1,39).entries())await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)',[chapter.id,problem.id,problem.versionId,position+1]);
   const large=await domainRead(`/learning-paths/${course.id}`),largeQueries=trace.length;assert.equal(large.chapters[0].problems.length,39);assert.equal(largeQueries,smallQueries);
   assert.ok(trace.every(entry=>!entry.sql.includes('SELECT * FROM problem_versions')));
   assert.ok(trace.reduce((sum,item)=>sum+item.bytes,0)<100000,'course details fetched exercise source payloads');
   const lookup=trace.find(entry=>entry.sql.includes('course_versions AS MATERIALIZED'));
   const plan=(await owner.query('EXPLAIN (ANALYZE,FORMAT JSON) '+lookup.sql,lookup.values)).rows[0]['QUERY PLAN'][0];let versionScans=0;
   const inspect=node=>{if(node.Alias==='live_version')versionScans+=node['Actual Loops'];for(const child of node.Plans??[])inspect(child);};inspect(plan.Plan);assert.ok(versionScans<=39);
   await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,100)',[chapter.id,hidden.id,hiddenVersion.id]);
   const checked=await request(`/learning-paths/${course.id}`);assert.equal(checked.chapters[0].problems.length,39);assert.ok(!checked.chapters[0].problems.some(p=>p.problemId===hidden.id));
   await request(`/learning-paths/${course.id}`,{actor:'peer',status:404});await request(`/learning-paths/${course.id}`,{actor:'student',status:404});
   t.diagnostic(JSON.stringify({linkedProblems:39,smallQueries,largeQueries,versionScans}));
  });
  await t.test('group listing batches metadata while preserving drafts, grants, student views and archival rules',async()=>{
   const makeGroup=async(bankId,accountId,name,ids)=>{
    const group=(await owner.query('INSERT INTO problem_groups(bank_id,owner_account_id,name) VALUES($1,$2,$3) RETURNING id',[bankId,accountId,name])).rows[0];
    for(const [position,id] of ids.entries())await owner.query('INSERT INTO problem_group_members(group_id,problem_id,position) VALUES($1,$2,$3)',[group.id,id,position]);return group;
   };
   const publicGroup=await makeGroup(bank.id,users.teacher.id,'Course group',[problems[0].id]);
   const privateGroup=await makeGroup(otherBank.id,users.peer.id,'Private group',[hidden.id]);
   let groups=await domainRead('/problem-groups','library');const smallQueries=trace.length;
   assert.deepEqual(groups.items.map(group=>group.id),[publicGroup.id]);assert.equal(groups.items[0].canEdit,true);
   for(const [position,problem] of problems.slice(1,39).entries())await owner.query('INSERT INTO problem_group_members(group_id,problem_id,position) VALUES($1,$2,$3)',[publicGroup.id,problem.id,position+1]);
   groups=await domainRead('/problem-groups','library');const largeQueries=trace.length;
   assert.equal(largeQueries,smallQueries);assert.ok(largeQueries<=6,`group listing made ${largeQueries} queries`);assert.equal(groups.items[0].problems.length,39);
   assert.ok(trace.reduce((sum,item)=>sum+item.bytes,0)<60000,'groups fetched full exercise sources');
   const repeatedGroup=await makeGroup(bank.id,users.teacher.id,'Repeated course group',problems.slice(0,39).map(p=>p.id));
   const repeated=await domainRead('/problem-groups','library');assert.equal(trace.length,largeQueries);assert.deepEqual(repeated.items.find(g=>g.id===repeatedGroup.id).problems,repeated.items.find(g=>g.id===publicGroup.id).problems);
   const draft=(await owner.query("INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,'Unpublished revision','Private revision','stdio','tokens','print(1)','[]','Incomplete',1000,128) RETURNING id",[problems[0].id])).rows[0];
   const own=await request('/problem-groups');assert.equal(own.items.find(g=>g.id===publicGroup.id).problems[0].versionId,draft.id);assert.equal(own.items.find(g=>g.id===publicGroup.id).problems[0].published,false);
   for(const actor of ['peer','student']){
    const view=await request('/problem-groups',{actor}),group=view.items.find(g=>g.id===publicGroup.id);assert.equal(group.problems[0].versionId,problems[0].versionId);assert.equal(group.canEdit,false);
    if(actor==='student')assert.ok(!view.items.some(g=>g.id===privateGroup.id));
   }
   await request(`/problem-groups?bankId=${otherBank.id}`,{status:403});
   await owner.query("INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,'read')",[otherBank.id,users.teacher.id]);
   let shared=(await request(`/problem-groups?bankId=${otherBank.id}`)).items[0];assert.equal(shared.id,privateGroup.id);assert.equal(shared.canEdit,false);assert.deepEqual(shared.problemIds,[hidden.id]);assert.equal(shared.problems[0].versionId,hiddenVersion.id);
   await owner.query("UPDATE bank_permissions SET permission='edit' WHERE bank_id=$1 AND account_id=$2",[otherBank.id,users.teacher.id]);
   shared=(await request('/problem-groups')).items.find(g=>g.id===privateGroup.id);assert.equal(shared.canEdit,true);
   await owner.query('DELETE FROM bank_permissions WHERE bank_id=$1 AND account_id=$2',[otherBank.id,users.teacher.id]);assert.ok(!(await request('/problem-groups')).items.some(g=>g.id===privateGroup.id));
   await owner.query("INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,'edit')",[otherBank.id,users.student.id]);assert.ok(!(await request('/problem-groups',{actor:'student'})).items.some(g=>g.id===privateGroup.id));
   const platformGroup=await makeGroup(bank.id,users.teacher.id,'Platform reference group',[problems[39].id]);
   const platformDraft=(await owner.query("INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,'Platform draft','Platform private draft','stdio','tokens','print(1)','[]','Incomplete',1000,128) RETURNING id",[problems[39].id])).rows[0];
   await owner.query('UPDATE platform_content_editors SET revoked_at=NULL WHERE resource_id=$1',[problems[39].id]);
   assert.equal((await request('/problem-groups')).items.find(g=>g.id===platformGroup.id).problems[0].versionId,platformDraft.id);
   await owner.query('UPDATE platform_content_editors SET revoked_at=now() WHERE resource_id=$1',[problems[39].id]);
   assert.equal((await request('/problem-groups')).items.find(g=>g.id===platformGroup.id).problems[0].versionId,problems[39].versionId);
   await owner.query('UPDATE problems SET current_version_id=NULL WHERE id=$1',[problems[39].id]);
   // The published version remains available through the live-version resolver;
   // losing a draft grant must never project the newer unpublished title.
   assert.equal((await request('/problem-groups')).items.find(g=>g.id===platformGroup.id).problems[0].versionId,problems[39].versionId);
   await request('/problem-groups?bankId=not-a-uuid',{status:400});
   await owner.query('UPDATE problems SET archived_at=now() WHERE id=$1',[problems[1].id]);assert.ok(!(await request('/problem-groups')).items.find(g=>g.id===publicGroup.id).problemIds.includes(problems[1].id));
   await owner.query('UPDATE problem_groups SET archived_at=now() WHERE id=$1',[publicGroup.id]);assert.ok(!(await request('/problem-groups')).items.some(g=>g.id===publicGroup.id));
   await owner.query('UPDATE problem_banks SET archived_at=now() WHERE id=$1',[otherBank.id]);assert.ok(!(await request('/problem-groups',{actor:'peer'})).items.some(g=>g.id===privateGroup.id));await request(`/problem-groups?bankId=${otherBank.id}`,{actor:'peer',status:404});
   t.diagnostic(JSON.stringify({groupProblems:39,smallQueries,largeQueries}));
  });
  await t.test('platform group batching rechecks course links, direct grants and teaching roles without per-exercise queries',async()=>{
   const storage=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Platform storage','school') RETURNING id",[admin.id])).rows[0];
   const group=(await owner.query("INSERT INTO problem_groups(bank_id,owner_account_id,name) VALUES($1,$2,'Platform group') RETURNING id",[storage.id,admin.id])).rows[0];
   const lesson=(await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Platform lesson','Lesson',0) RETURNING id",[platform.id])).rows[0];
   await owner.query("INSERT INTO platform_content_editors(resource_kind,resource_id,account_id,school_id,granted_by) VALUES('course',$1,$2,$3,$4)",[platform.id,users.teacher.id,LEGACY_SCHOOL_ID,admin.id]);
   const entries=[];
   const append=async position=>{
    const p=(await owner.query("INSERT INTO problems(owner_account_id,bank_id,owner_scope) VALUES($1,$2,'platform') RETURNING id",[admin.id,storage.id])).rows[0];
    const v=(await owner.query("INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,$2,'Public statement','stdio','tokens','print(1)','[]','AC',1000,128) RETURNING id",[p.id,`Platform ${position}`])).rows[0];
    await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,'','1',100)",[v.id]);
    await owner.query("UPDATE problem_versions SET published_at=now(),school_visible_at=now(),rank_review_status='approved',rank_approved_at=now() WHERE id=$1",[v.id]);
    await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);
    await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)',[lesson.id,p.id,v.id,position]);
    await owner.query('INSERT INTO problem_group_members(group_id,problem_id,position) VALUES($1,$2,$3)',[group.id,p.id,position]);
    let draft;
    if(position<2)draft=(await owner.query("INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,$2,'Private draft','stdio','tokens','print(1)','[]','Incomplete',1000,128) RETURNING id",[p.id,`PRIVATE_PLATFORM_DRAFT_${position}`])).rows[0];
    entries.push({id:p.id,versionId:v.id,draftId:draft?.id});
   };
   await append(0);let response=await domainRead('/problem-groups','library');const smallQueries=trace.length;
   assert.equal(response.items.find(g=>g.id===group.id).problems[0].versionId,entries[0].draftId);
   for(let i=1;i<123;i++)await append(i);
   response=await domainRead('/problem-groups','library');const largeQueries=trace.length;
   assert.equal(largeQueries,smallQueries);assert.ok(largeQueries<=4,`mixed group listing made ${largeQueries} queries`);
   const listed=response.items.find(g=>g.id===group.id);assert.equal(listed.problems.length,123);assert.deepEqual(listed.problemIds,entries.map(p=>p.id));assert.equal(listed.canEdit,false);
   const platformDetail=await domainRead(`/platform/courses/${platform.id}`,'platform');assert.equal(platformDetail.chapters[0].problemCount,123);
   assert.deepEqual(platformDetail.chapters[0].problems.map(p=>({problemId:p.problemId,versionId:p.versionId})),entries.map(p=>({problemId:p.id,versionId:p.versionId})));
   const platformLookup=trace.find(entry=>entry.sql.includes('course_versions AS MATERIALIZED'));assert.ok(platformLookup,'course read must resolve live versions before joining chapter links');
   const plan=await transaction(owner,async db=>{
    await db.query("SELECT set_config('campus.account_id',$1,true)",[users.teacher.id]);
    return(await db.query('EXPLAIN (ANALYZE,FORMAT JSON) '+platformLookup.sql,platformLookup.values)).rows[0]['QUERY PLAN'][0];
   });let versionScans=0;
   const inspect=node=>{if(node.Alias==='live_version')versionScans+=node['Actual Loops'];for(const child of node.Plans??[])inspect(child);};inspect(plan.Plan);assert.ok(versionScans>0&&versionScans<=123,`platform course scanned live versions ${versionScans} times`);
   await owner.query("INSERT INTO platform_content_editors(resource_kind,resource_id,account_id,school_id,granted_by) VALUES('problem',$1,$2,$3,$4)",[entries[1].id,users.teacher.id,LEGACY_SCHOOL_ID,admin.id]);
   await owner.query("UPDATE platform_content_editors SET revoked_at=now() WHERE resource_kind='course' AND resource_id=$1",[platform.id]);
   let current=(await request('/problem-groups')).items.find(g=>g.id===group.id);
   assert.equal(current.problems[0].versionId,entries[0].versionId);assert.equal(current.problems[1].versionId,entries[1].draftId);
   await owner.query("UPDATE platform_content_editors SET revoked_at=NULL WHERE resource_kind='course' AND resource_id=$1",[platform.id]);
   await owner.query('DELETE FROM chapter_problems WHERE chapter_id=$1 AND problem_id=$2',[lesson.id,entries[0].id]);
   current=(await request('/problem-groups')).items.find(g=>g.id===group.id);assert.equal(current.problems[0].versionId,entries[0].versionId);assert.equal(current.problems[1].versionId,entries[1].draftId);
   await owner.query("DELETE FROM account_roles WHERE account_id=$1 AND role='teacher'",[users.teacher.id]);
   await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[users.teacher.id]);
   current=(await request('/problem-groups')).items.find(g=>g.id===group.id);
   assert.equal(current.problems[0].versionId,entries[0].versionId);assert.equal(current.problems[1].versionId,entries[1].versionId);assert.ok(!JSON.stringify(current).includes('PRIVATE_PLATFORM_DRAFT'));
   await owner.query('UPDATE problems SET archived_at=now() WHERE id=$1',[entries[2].id]);
   await owner.query("UPDATE problem_versions SET school_visible_at=NULL,rank_review_status='revoked' WHERE id=$1",[entries[3].versionId]);
   current=(await request('/problem-groups')).items.find(g=>g.id===group.id);assert.ok(!current.problemIds.includes(entries[2].id));assert.ok(!current.problemIds.includes(entries[3].id));
   t.diagnostic(JSON.stringify({platformGroupProblems:123,smallQueries,largeQueries,platformCourseVersionScans:versionScans}));
  });
 }finally{await app?.close();await runtime?.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
