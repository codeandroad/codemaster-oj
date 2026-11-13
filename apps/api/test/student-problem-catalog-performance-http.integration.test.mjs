import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool,transaction} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {createDomainServices,loadConfig} from '../../../packages/domain/src/application.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {LEGACY_SCHOOL_ID} from '../../../packages/domain/src/schools.mjs';

// Exercise the lightweight student contract through Nest with real restricted
// database roles. The older full representation remains the parity reference.
test('student problem summaries preserve personal progress, publication and activity visibility with bounded scans',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='student_problems_'+randomBytes(6).toString('hex');await manager.query(`CREATE SCHEMA ${schema}`);
 const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const owner=createPool(scoped.href);let app,runtime;
 try{
  await migrate(owner);const password=randomBytes(24).toString('base64url');await bootstrap(owner,{username:'author',password,number:'AUTHOR',name:'Author'});
  const author=(await owner.query("SELECT id FROM accounts WHERE username='author'")).rows[0],users={};const hash=await hashPassword(password);
  for(const name of ['learner','other']){
   const identity=(await owner.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$1) RETURNING id",[name])).rows[0];
   users[name]={identityId:identity.id,...(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,name,hash])).rows[0]};
   await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[users[name].id]);await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[users[name].id]);
  }
  const bank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Public exercises','school') RETURNING id",[author.id])).rows[0];
  const privateBank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Assigned exercises','private') RETURNING id",[author.id])).rows[0];
  const entries=[],statement='LONG_PUBLIC_STATEMENT '.repeat(1000);
  const version=async(problemId,title,{published=true,schoolVisible=true}={})=>{
   const row=(await owner.query("INSERT INTO problem_versions(problem_id,title,statement,mode,reference_code,samples,metadata,validation_status,time_limit_ms,memory_limit_mb) VALUES($1,$2,$3,'stdio','PRIVATE_REFERENCE','[]',$4,'AC',1000,128) RETURNING id",[problemId,title,statement,{difficulty:'easy',editorial:'PRIVATE_EDITORIAL'}])).rows[0];
   await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,'1','1',100)",[row.id]);
   if(published){await owner.query("UPDATE problem_versions SET published_at=clock_timestamp(),school_visible_at=CASE WHEN $2 THEN clock_timestamp() END,rank_review_status=CASE WHEN $2 THEN 'approved' ELSE 'pending' END,rank_approved_at=CASE WHEN $2 THEN clock_timestamp() END WHERE id=$1",[row.id,schoolVisible]);await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,row.id]);}
   return row.id;
  };
  const add=async(title,bankId=bank.id)=>{const p=(await owner.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[author.id,bankId])).rows[0];const versionId=await version(p.id,title,{schoolVisible:bankId===bank.id});const row={id:p.id,versionId};entries.push(row);return row;};
  for(let i=0;i<48;i++)await add(`Exercise ${i}`);
  const assigned=await add('Private assignment',privateBank.id),timed=await add('Private timed exercise',privateBank.id);
  const draft=await version(entries[0].id,'PRIVATE_UNPUBLISHED_DRAFT',{published:false});assert.notEqual(draft,entries[0].versionId);
  for(const index of [0,1])await owner.query("INSERT INTO problem_public_statements(version_id,language,statement,metadata,source_hash,content_hash,author_account_id,reviewer_account_id) VALUES($1,'en',$2,'{\"difficulty\":\"hard\"}',$3,$3,$4,$4)",[entries[index].versionId,'REVIEWED_ENGLISH '.repeat(1000),'a'.repeat(64),author.id]);
  entries[1].versionId=await version(entries[1].id,'New publication awaiting English');
  const course=(await owner.query("INSERT INTO learning_paths(owner_account_id,title,published_at,localizations) VALUES($1,'Visible course',now(),'{\"zh\":{\"title\":\"可见课程\"}}') RETURNING id",[author.id])).rows[0];
  const blocked=(await owner.query("INSERT INTO learning_paths(owner_account_id,title,published_at,access_scope) VALUES($1,'Private course title',now(),'classes') RETURNING id",[author.id])).rows[0];
  for(const path of [course,blocked]){const c=(await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Lesson','Lesson',0) RETURNING id",[path.id])).rows[0];for(const [index,p]of entries.slice(0,5).entries())await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)',[c.id,p.id,p.versionId,index]);}
  const cls=(await owner.query("INSERT INTO classes(name,owner_account_id) VALUES('Class',$1) RETURNING id",[author.id])).rows[0];
  const assignment=(await owner.query("INSERT INTO assignments(title,class_id,owner_account_id,due_at,state) VALUES('Assignment',$1,$2,now()+interval '1 day','Published') RETURNING id",[cls.id,author.id])).rows[0];
  await owner.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[assignment.id,assigned.id,assigned.versionId]);await owner.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,users.learner.identityId]);
  const exam=(await owner.query("INSERT INTO timed_practices(title,owner_account_id,state,starts_at,ends_at,duration_minutes) VALUES('Exam',$1,'Draft',now()-interval '1 hour',now()+interval '1 hour',120) RETURNING id",[author.id])).rows[0];
  await owner.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[exam.id,timed.id,timed.versionId]);await owner.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[exam.id,users.learner.identityId]);
  await owner.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[exam.id]);
  const attempt=(await owner.query("INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at) VALUES($1,$2,$3,now(),now()+interval '1 hour') RETURNING id",[exam.id,users.learner.identityId,users.learner.id])).rows[0];
  const submit=async(index,name,status,score,{kind='submit',timedAttemptId=null}={})=>(await owner.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score,timed_attempt_id)
   VALUES($1,$2,$3,$4,$5,'PRIVATE_STUDENT_CODE',$6,'fixture',$7,$8,$9) RETURNING id`,[users[name].id,users[name].identityId,entries[index].id,entries[index].versionId,kind,randomUUID(),status,score,timedAttemptId])).rows[0];
  await submit(0,'learner','AC',100);const last=await submit(0,'learner','WA',25);await submit(1,'learner','AC',100,{kind:'samples'});await submit(2,'other','AC',100);await submit(3,'learner','AC',100,{timedAttemptId:attempt.id});await submit(4,'learner','System Error',null);
  await owner.query('INSERT INTO point_rewards(problem_id,points,updated_by) VALUES($1,7,$2)',[entries[0].id,author.id]);await owner.query('INSERT INTO problem_favorites(identity_id,problem_id) VALUES($1,$2)',[users.learner.identityId,entries[0].id]);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtimeUrl=new URL(scoped);runtimeUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);runtime=createPool(runtimeUrl.href);
  const origin='http://student-catalog.test',config=loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'});app=await createApiApplication({databaseUrl:runtimeUrl.href,logger:false,config});await app.listen(0,'127.0.0.1');const endpoint=(await app.getUrl())+'/api/v1',sessions={};
  const request=async(path,{name='learner',method='GET',body,status=200}={})=>{const response=await fetch(endpoint+path,{method,headers:{Origin:origin,...(sessions[name]?{Cookie:sessions[name]}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(data.error??{})}`);assert.match(response.headers.get('cache-control')??'',/no-store/);if(path==='/auth/login')sessions[name]=response.headers.get('set-cookie').split(';')[0];return data;};
  for(const name of Object.keys(users))await request('/auth/login',{name,method:'POST',body:{username:name,password}});
  const parity=async(suffix='',name='learner')=>{const query=new URLSearchParams({includeCourseFilters:'1'});if(suffix)query.set('courseId',suffix);const full=await request('/problems?'+query,{name});query.set('view','student-summary');const summary=await request('/problems?'+query,{name});assert.deepEqual(summary.items.map(p=>p.id),full.items.map(p=>p.id));assert.deepEqual(summary.courses,full.courses);assert.equal(summary.courseId,full.courseId);for(const [index,row]of summary.items.entries())for(const key of Object.keys(row))assert.deepEqual(row[key],full.items[index][key],`${key} for ${row.id}`);return{full,summary};};
  await t.test('summaries preserve exact published IDs, reviewed difficulty, progress, rewards, courses and bookmarks',async()=>{
   const {full,summary}=await parity();const byId=new Map(summary.items.map(p=>[p.id,p]));assert.equal(byId.get(entries[0].id).versionId,entries[0].versionId);assert.equal(byId.get(entries[0].id).difficulty,'hard');assert.equal(byId.get(entries[1].id).publicStatementPending,true);assert.equal(byId.get(entries[1].id).difficulty,'');
   assert.equal(byId.get(entries[0].id).ownProgress.status,'AC');assert.equal(byId.get(entries[0].id).ownProgress.bestScore,100);assert.equal(byId.get(entries[0].id).ownProgress.formalCount,2);assert.equal(byId.get(entries[0].id).ownProgress.lastSubmissionId,'SUB'+last.id);assert.equal(byId.get(entries[0].id).firstAcPoints,7);
   for(const i of [1,2,3])assert.equal(byId.get(entries[i].id).ownProgress.status,'NotStarted');assert.equal(byId.get(entries[4].id).ownProgress.status,'System Error');assert.equal(byId.get(entries[4].id).ownProgress.bestScore,null);
   assert.ok(byId.has(assigned.id)&&byId.has(timed.id));assert.ok(!JSON.stringify(summary).includes('PRIVATE_'));assert.ok(!JSON.stringify(summary).includes('LONG_PUBLIC_STATEMENT'));assert.ok(!JSON.stringify(summary).includes('REVIEWED_ENGLISH'));
   assert.deepEqual(summary.courses.map(c=>c.id),[course.id]);assert.deepEqual((await request('/problem-favorites')).items,[entries[0].id]);assert.deepEqual((await request('/problem-favorites',{name:'other'})).items,[]);
   assert.ok(Buffer.byteLength(JSON.stringify(summary))<Buffer.byteLength(JSON.stringify(full))/8);await request('/problems?view=summary',{status:403});
   const selected=await parity(course.id);assert.equal(selected.summary.items.length,5);const denied=await parity(blocked.id);assert.equal(denied.summary.items.length,0);assert.ok(!JSON.stringify(denied.summary).includes('Private course title'));
   const other=await parity('','other');assert.ok(!other.summary.items.some(p=>[assigned.id,timed.id].includes(p.id)));assert.equal(other.summary.items.find(p=>p.id===entries[0].id).ownProgress.status,'NotStarted');assert.equal(other.summary.items.find(p=>p.id===entries[2].id).ownProgress.status,'AC');
   t.diagnostic(JSON.stringify({rows:summary.items.length,fullBytes:Buffer.byteLength(JSON.stringify(full)),summaryBytes:Buffer.byteLength(JSON.stringify(summary))}));
  });
  await t.test('activity exemptions and exam-result release are rechecked without cross-learner state',async()=>{
   await owner.query('UPDATE assignment_participants SET exempt=true WHERE assignment_id=$1',[assignment.id]);let current=(await parity()).summary;assert.ok(!current.items.some(p=>p.id===assigned.id));
   await owner.query('UPDATE timed_practice_participants SET exempt=true WHERE practice_id=$1',[exam.id]);current=(await parity()).summary;assert.ok(!current.items.some(p=>p.id===timed.id));assert.equal(current.items.find(p=>p.id===entries[3].id).ownProgress.status,'NotStarted');
   await owner.query('UPDATE timed_practices SET results_published_at=now() WHERE id=$1',[exam.id]);current=(await parity()).summary;assert.equal(current.items.find(p=>p.id===entries[3].id).ownProgress.status,'AC');
  });
  await t.test('live publications and history are scanned once for a whole catalog',async()=>{
   const trace=[];const query=async(db,sql,values)=>{const result=await db.query(sql,values);trace.push({sql,values,bytes:Buffer.byteLength(JSON.stringify(result.rows))});return result;};const observed={get totalCount(){return runtime.totalCount},query:(sql,v)=>query(runtime,sql,v),connect:async()=>{const db=await runtime.connect();return{query:(sql,v)=>query(db,sql,v),release:()=>db.release()};}};
   const services=await createDomainServices(observed,config),context=await services.prepareRequest({url:'/api/v1/problems?includeCourseFilters=1&view=student-summary',method:'GET',headers:{cookie:sessions.learner}});trace.length=0;await services.execute('library',context);
   const catalog=trace.find(q=>q.sql.includes('catalog_problems AS MATERIALIZED')),progress=trace.find(q=>q.sql.includes('WITH visible AS'));assert.ok(catalog&&progress);assert.ok(!progress.sql.includes('unnest('));
   const plans=await transaction(owner,async db=>{await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);return Promise.all([catalog,progress].map(q=>db.query('EXPLAIN (ANALYZE,FORMAT JSON) '+q.sql,q.values).then(r=>r.rows[0]['QUERY PLAN'][0])));});
   let liveScans=0,historyScans=0;const scan=(node,callback)=>{callback(node);for(const child of node.Plans??[])scan(child,callback)};scan(plans[0].Plan,node=>{if(node.Alias==='live_version')liveScans+=node['Actual Loops']});scan(plans[1].Plan,node=>{if(node['Relation Name']==='submissions')historyScans+=node['Actual Loops']});assert.ok(liveScans>0&&liveScans<=entries.length);assert.equal(historyScans,1);assert.equal(plans[1].JIT,undefined,'catalog progress must not trigger JIT from per-problem scan costs');
   assert.ok(trace.reduce((n,q)=>n+q.bytes,0)<100000,'summary queries fetched body payloads');t.diagnostic(JSON.stringify({problems:entries.length,liveScans,historyScans,queries:trace.length}));
  });
 }finally{await app?.close();await runtime?.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
