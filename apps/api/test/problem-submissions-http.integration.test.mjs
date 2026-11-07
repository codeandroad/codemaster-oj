import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool,transaction} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {provisionSchool} from '../../../packages/domain/src/schools.mjs';

const forbidden=['source_code','code','private_results','privateResults','payload','identityId','accountId','studentName','publicOutput','expected','stderr','note'];
function safe(data){for(const item of data.items){assert.deepEqual(Object.keys(item).sort(),['id','displayName','createdAt','language','status','isOwn','runtimeMs','memoryKb'].sort());for(const field of forbidden)assert.equal(item[field],undefined);}assert.ok(!JSON.stringify(data).includes('SECRET'));}

test('problem submission metadata: real Nest, scoped runtime DB, no private records',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const url=new URL(process.env.TEST_DATABASE_URL);assert.match(url.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const owner=createPool(url.href),schema=`history_http_${randomBytes(5).toString('hex')}`;url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);let app;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),hash=await hashPassword(password),users={};
  for(const [name,kind] of Object.entries({admin:'admin',student:'student',peer:'student',newadmin:'personal',newstudent:'personal',newpeer:'personal',outsider:'personal'})){
   users[name]=await transaction(pool,async db=>{const identityId=(await db.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0].id;
    const id=(await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,name,hash])).rows[0].id;
    if(kind!=='personal')await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[id,kind]);return{id,identityId};});
  }
  const runtime=new URL(url);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const origin='http://history.test';app=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});await app.listen(0,'127.0.0.1');const base=await app.getUrl(),auth={};
  const req=async(path,{user='student',status=200,method='GET',body}={})=>{const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(auth[user]?{Cookie:auth[user].cookie,'X-CSRF-Token':auth[user].csrf}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(d.error??{})}`);if(method==='GET'&&status===200)assert.match(r.headers.get('cache-control'),/no-store/);return{data:d,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  for(const name of Object.keys(users)){const r=await req('/auth/login',{user:name,method:'POST',body:{username:name,password}});auth[name]={cookie:r.cookie,csrf:r.data.csrfToken};}
  const problem=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[users.admin.id])).rows[0].id;
  async function version(){return(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,samples,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at,school_visible_at) VALUES($1,'Metadata','stdio','Public statement','[]',1000,64,'SECRET reference','AC',now(),now()) RETURNING id",[problem])).rows[0].id;}
  const v=await version();await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem,v]);
  async function submission(who='student',{status='AC',kind='submit',versionId=v,timed=null,language='python',metrics=null,assignment=null,rejudge=false}={}){
   const u=users[who],s=(await pool.query("INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score,passed,total,timed_attempt_id,language,assignment_id) VALUES($1,$2,$3,$4,$5,'SECRET student code',$6,'fixture',$7,$8,1,1,$9,$10,$11) RETURNING id",[u.id,u.identityId,problem,versionId,kind,randomUUID(),status,status==='AC'?100:0,timed,language,assignment])).rows[0];
   if(metrics){const task=(await pool.query("INSERT INTO judge_tasks(submission_id,version_id,purpose,state,rejudge) VALUES($1,$2,'submission','completed',$3) RETURNING id",[s.id,versionId,rejudge])).rows[0];
    const run=(await pool.query("INSERT INTO judge_runs(task_id,lease_id,submission_id,version_id,status,score,passed,total,private_results,environment_version) VALUES($1,$2,$3,$4,$5,$6,1,1,$7,'qa') RETURNING id",[task.id,randomUUID(),s.id,versionId,status,status==='AC'?100:0,JSON.stringify(metrics)])).rows[0];s.runId=run.id;}
   return s;
  }
  const own=await submission('student',{status:'WA',metrics:[{cpuMs:3,memoryBytes:1025,stdout:'SECRET output',input:'SECRET input'},{cpuMs:5,memoryBytes:4096}]}),peer=await submission('peer',{language:'cpp',metrics:[{cpuMs:1,memoryBytes:2048}]});
  await pool.query('INSERT INTO review_entries(submission_id,author_account_id,note) VALUES($1,$2,$3)',[peer.id,users.admin.id,'SECRET teacher note']);
  await submission('student',{kind:'samples'});await submission('student',{versionId:await version()});
  const route=`/problems/${problem}/submissions?versionId=${v}`;
  await t.test('formal exact-version metadata sorts/paginates without student code or identities',async()=>{
   const data=(await req(route+'&sort=runtimeMs&order=asc&pageSize=1')).data;safe(data);assert.equal(data.total,2);assert.equal(data.hasMore,true);assert.equal(data.solved,false);assert.equal(data.items[0].id,'SUB'+peer.id);assert.equal(data.items[0].isOwn,false);assert.equal(data.items[0].memoryKb,2);
   const second=(await req(route+'&sort=runtimeMs&order=asc&pageSize=1&page=2')).data;assert.equal(second.items[0].id,'SUB'+own.id);assert.equal(second.items[0].runtimeMs,8);assert.equal(second.items[0].memoryKb,4);assert.equal(second.hasMore,false);
   assert.equal((await req(`/problems/${problem}?versionId=${v}`)).data.solved,false);
   await req('/submissions/SUB'+peer.id,{status:403});
   await req(route,{user:'anonymous',status:401});
   await req(route+'&sort=code',{status:400});await req(route+'&sort=status');await req(route+'&pageSize=101',{status:400});await req(route+'&order=desc%3Bdrop',{status:400});
   await req(route,{user:'outsider',status:403});
  });
  await t.test('school history uses identity names unless a nickname is explicitly enabled',async()=>{
   await pool.query("UPDATE identities SET name='Peer learner' WHERE id=$1",[users.peer.identityId]);
   await pool.query("UPDATE accounts SET nickname='Peer alias',leaderboard_use_nickname=false WHERE id=$1",[users.peer.id]);
   let data=(await req(route)).data;safe(data);assert.equal(data.items.find(r=>!r.isOwn).displayName,'Peer learner');
   await pool.query('UPDATE accounts SET leaderboard_use_nickname=true WHERE id=$1',[users.peer.id]);
   data=(await req(route)).data;assert.equal(data.items.find(r=>!r.isOwn).displayName,'Peer alias');
   await pool.query("UPDATE accounts SET nickname=' ' WHERE id=$1",[users.peer.id]);
   assert.equal((await req(route)).data.items.find(r=>!r.isOwn).displayName,'Peer learner');
  });
  await t.test('AC feedback stays an accepted submission and creates an owner-only notification',async()=>{
   const {data:feedback}=await req('/review-notebook',{
    method:'POST',user:'admin',status:201,body:{submissionId:'SUB'+peer.id,note:'Good work'},
   });
   assert.equal(feedback.teacherFeedback,true);
   assert.equal(feedback.feedbackPending,false);
   const notebook=(await req('/review-notebook',{user:'peer'})).data.items;
   assert.equal(notebook.find(entry=>entry.id===feedback.id).originalStatus,'AC');
   assert.equal(notebook.find(entry=>entry.id===feedback.id).teacherFeedback,true);
   const detail=(await req('/review-notebook/'+feedback.id,{user:'peer'})).data;
   assert.equal(detail.note,'Good work');
   assert.equal(detail.originalStatus,'AC');
   assert.equal(detail.relatedNotes.find(entry=>entry.id===feedback.id).note,'Good work');
   const original=(await req('/submissions/SUB'+peer.id,{user:'peer'})).data;
   assert.equal(original.status,'AC');
   assert.equal(original.reviews.find(entry=>entry.id===feedback.id).teacherFeedback,true);
   const inbox=(await req('/student-notifications',{user:'peer'})).data;
   assert.equal(inbox.unreadCount,1);
   assert.equal(inbox.items.filter(item=>item.kind==='teacher_feedback').length,1);
   assert.ok(!JSON.stringify(inbox).includes('Good work'));
   const unrelated=(await req('/student-notifications')).data;
   assert.equal(unrelated.unreadCount,0);
   await req('/student-notifications/'+inbox.items[0].id+'/read',{method:'POST',status:404});
   await req('/review-notebook/'+feedback.id,{status:403});
   await req('/review-notebook',{method:'POST',status:403,body:{submissionId:'SUB'+peer.id,note:'Unauthorized'}});
   const ownNote=(await req('/review-notebook',{
    method:'POST',user:'peer',status:201,body:{submissionId:'SUB'+peer.id,note:'My own note'},
   })).data;
   assert.equal(ownNote.teacherFeedback,false);
   assert.equal((await req('/student-notifications',{user:'peer'})).data.unreadCount,1);
  });
  const cls=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('QA',$1) RETURNING id",[users.admin.id])).rows[0].id;
  const practice=(await pool.query("INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes,state) VALUES('Exam',$1,$2,now()-interval '1 minute',now()+interval '1 hour',30,'Draft') RETURNING id",[cls,users.admin.id])).rows[0].id;
  await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)',[practice,problem,v]);
  await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[practice,users.student.identityId]);
  await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[practice]);
  const timed=(await pool.query("INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at) VALUES($1,$2,$3,now(),now()+interval '30 minutes') RETURNING id",[practice,users.student.identityId,users.student.id])).rows[0].id;
  const held=await submission('student',{timed,metrics:[{cpuMs:0,memoryBytes:0}]});
  await t.test('unreleased exams stay absent across free/assignment/timed entry; solved is persistent formal current-version only',async()=>{
   for(const path of [route,route+'&timedPracticeId='+practice]){const data=(await req(path)).data;assert.equal(data.total,2);assert.equal(data.solved,false);assert.ok(!data.items.some(r=>r.id==='SUB'+held.id));}
   await req(route+'&timedPracticeId='+practice,{user:'peer',status:404});
   await req(route+'&assignmentId='+randomUUID(),{status:404});
   const {data:feedback}=await req('/review-notebook',{
    method:'POST',user:'admin',status:201,body:{submissionId:'SUB'+held.id,note:'Review after release'},
   });
   assert.equal(feedback.feedbackPending,true);
   await req('/review-notebook/'+feedback.id,{status:404});
   assert.equal((await req('/review-notebook')).data.items.some(entry=>entry.id===feedback.id),false);
   assert.equal((await req('/submissions/SUB'+held.id)).data.reviews.some(entry=>entry.id===feedback.id),false);
   assert.equal((await req('/student-notifications')).data.unreadCount,0);
   await req('/student-notifications/read-all',{method:'POST'});
   await pool.query('UPDATE timed_practices SET results_published_at=now() WHERE id=$1',[practice]);
   assert.equal((await req('/student-notifications')).data.unreadCount,1);
   assert.equal((await req('/review-notebook/'+feedback.id)).data.note,'Review after release');
   const data=(await req(route)).data;assert.equal(data.total,2);assert.equal(data.solved,true);assert.equal(data.items.find(r=>r.id==='SUB'+held.id).runtimeMs,0);
   assert.equal((await req(`/problems/${problem}?versionId=${v}`)).data.solved,true);
  });
  await t.test('latest per stable student precedes sorting and pagination; a newer WA keeps historical solved',async()=>{
   await pool.query("UPDATE submissions SET created_at=now()-interval '1 day' WHERE problem_id=$1 AND version_id=$2",[problem,v]);
   const mine=await submission('student',{status:'WA',language:'javascript',metrics:[{cpuMs:5,memoryBytes:4096}]}),oldPeer=await submission('peer',{status:'WA',metrics:[{cpuMs:800,memoryBytes:1024}]}),latestPeer=await submission('peer',{status:'WA',metrics:[{cpuMs:900,memoryBytes:2048}]});
   // The numeric ID breaks equal server-received timestamps, independently of
   // the requested sort; a later inserted but backdated fixture is not latest.
   await pool.query('UPDATE submissions SET created_at=(SELECT created_at FROM submissions WHERE id=$1) WHERE id=$2',[oldPeer.id,latestPeer.id]);
   const backdated=await submission('peer',{status:'AC',metrics:[{cpuMs:1,memoryBytes:1}]});await pool.query("UPDATE submissions SET created_at=now()-interval '1 day' WHERE id=$1",[backdated.id]);
   const before=(await pool.query("SELECT count(*)::integer n FROM submissions WHERE problem_id=$1 AND version_id=$2 AND kind='submit'",[problem,v])).rows[0].n;
   const first=(await req(route+'&sort=runtimeMs&order=asc&pageSize=1')).data;safe(first);assert.equal(first.total,2);assert.equal(first.solved,true);assert.equal(first.items[0].id,'SUB'+mine.id);assert.equal(first.items[0].isOwn,true);assert.equal(first.items[0].status,'WA');assert.equal(first.hasMore,true);
   const second=(await req(route+'&sort=runtimeMs&order=asc&pageSize=1&page=2')).data;assert.equal(second.items[0].id,'SUB'+latestPeer.id);assert.equal(second.items[0].isOwn,false);assert.equal(second.items[0].runtimeMs,900);assert.equal(second.hasMore,false);
   assert.deepEqual((await req(route+'&pageSize=1&page=3')).data.items,[]);
   const asPeer=(await req(route+'&sort=language&order=asc',{user:'peer'})).data;assert.equal(asPeer.solved,true);assert.equal(asPeer.items.filter(r=>r.isOwn).length,1);assert.equal(asPeer.items.find(r=>r.isOwn).id,'SUB'+latestPeer.id);
   assert.equal((await req(`/problems/${problem}?versionId=${v}`)).data.solved,true);
   assert.equal((await pool.query("SELECT count(*)::integer n FROM submissions WHERE problem_id=$1 AND version_id=$2 AND kind='submit'",[problem,v])).rows[0].n,before);
  });
  await t.test('unconfirmed rejudge metrics and absent/partial measurement remain null',async()=>{
   const hidden=await submission('peer',{status:'WA',rejudge:true,metrics:[{cpuMs:900,memoryBytes:9000}]});
   let data=(await req(route)).data;safe(data);let item=data.items.find(r=>r.id==='SUB'+hidden.id);assert.equal(item.runtimeMs,null);assert.equal(item.memoryKb,null);
   await pool.query("INSERT INTO audit_events(actor_account_id,action,resource_id,metadata) VALUES($1,'submission.rejudge_confirm',$2,$3)",[users.admin.id,String(hidden.id),{runId:hidden.runId}]);
   assert.equal((await req(route)).data.items.find(r=>r.id==='SUB'+hidden.id).runtimeMs,900);
   const partial=await submission('peer',{status:'WA',metrics:[{cpuMs:1,memoryBytes:1024},{}]});data=(await req(route)).data;item=data.items.find(r=>r.id==='SUB'+partial.id);assert.equal(item.runtimeMs,null);assert.equal(item.memoryKb,null);assert.equal(data.total,2);assert.ok(!data.items.some(r=>r.id==='SUB'+hidden.id));
  });
  await t.test('bank made private retains only accessible activity history despite old publication timestamp',async()=>{
   const assignments=[];
   for(let i=0;i<2;i++){
    const id=(await pool.query("INSERT INTO assignments(title,class_id,owner_account_id,due_at,state) VALUES('Assignment',$1,$2,now()+interval '1 day','Published') RETURNING id",[cls,users.admin.id])).rows[0].id;
    await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)',[id,problem,v]);
    await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[id,users.peer.identityId]);
    if(i===0)await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[id,users.student.identityId]);
    assignments.push(id);
   }
   const visible=await submission('peer',{assignment:assignments[0]}),invisible=await submission('peer',{assignment:assignments[1]});
   await pool.query("UPDATE problem_banks SET visibility='private' WHERE id=(SELECT bank_id FROM problems WHERE id=$1)",[problem]);
   const data=(await req(route+'&assignmentId='+assignments[0])).data;safe(data);assert.ok(data.items.some(r=>r.id==='SUB'+visible.id));assert.ok(!data.items.some(r=>r.id==='SUB'+invisible.id));assert.ok(!data.items.some(r=>r.id==='SUB'+peer.id));
   await req(route+'&assignmentId='+assignments[1],{status:403});
  });
  const school=await provisionSchool(pool,{slug:'history-alpha',name:'History alpha',adminUsername:'newadmin'}),beta=await provisionSchool(pool,{slug:'history-beta',name:'History beta',adminUsername:'outsider'});
  for(const who of ['newstudent','newpeer'])await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[school.id,users[who].id]);
  const bank=(await pool.query("INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,'Bank',$3) RETURNING id",[school.id,users.newadmin.id,randomUUID()])).rows[0].id;
  const def={title:'School problem',statement:'Public',mode:'stdio',samples:[],tests:[],reference_code:'SECRET',starter_code:'',time_limit_ms:1000,memory_limit_mb:64,comparator:'exact'};
  const sp=(await pool.query('INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[school.id,bank,users.newadmin.id,def,randomUUID()])).rows[0].id;
  const sv=(await pool.query('INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,1,$3) RETURNING id',[school.id,sp,def])).rows[0].id;
  await pool.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[school.id,sp,sv]);
  await pool.query('INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by) VALUES($1,$2,$3,$4)',[school.id,sp,sv,users.admin.id]);
  async function schoolJob(who,context,status='AC',kind='submit',{identityId=null,cpuMs=2}={}){return(await pool.query("INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result,identity_id) VALUES($1,$2,$3,$4,$5,'qa',$6,$7,$8,'completed',$9,$10) RETURNING id",[school.id,sp,sv,users[who].id,randomUUID(),kind,context,{language:'python',code:'SECRET school code',version:def},{status,privateResults:[{cpuMs,memoryBytes:1024,stdout:'SECRET'}]},identityId])).rows[0].id;}
  const sj=await schoolJob('newstudent','school','WA');await schoolJob('newpeer','school');const pj=await schoolJob('newstudent','public');await schoolJob('newpeer','school','AC','samples');
  const sr=`/schools/${school.id}/problems/${sp}/submissions`,pr=`/practice/problems/${sp}/submissions`;
  await t.test('school and explicitly public lists remain separate with strict publication/member gates',async()=>{
   const s=(await req(sr,{user:'newstudent'})).data;safe(s);assert.equal(s.total,2);assert.equal(s.solved,false);assert.ok(s.items.some(r=>r.id===sj));assert.ok(!s.items.some(r=>r.id===pj));
   const p=(await req(pr,{user:'newstudent'})).data;safe(p);assert.equal(p.total,1);assert.equal(p.solved,true);assert.equal(p.items[0].id,pj);
   assert.equal((await req(`/schools/${school.id}/problems/${sp}`,{user:'newstudent'})).data.solved,false);assert.equal((await req(`/practice/problems/${sp}`,{user:'newstudent'})).data.solved,true);
   await req(sr,{user:'anonymous',status:401});await req(pr,{user:'anonymous',status:401});
   await req(sr,{user:'outsider',status:404});await req(`/schools/${beta.id}/problems/${sp}/submissions`,{user:'newstudent',status:404});await req(sr+'?versionId='+randomUUID(),{user:'newstudent',status:404});
  });
  await t.test('school grouping freezes receipt identity and does not assign unlinked history to a later student',async()=>{
   const identityId=(await pool.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student','Student','Student',$2) RETURNING id",[school.id,users.newstudent.id])).rows[0].id;
   const oldUnlinked=await schoolJob('newstudent','school','AC','submit',{cpuMs:2});
   assert.equal((await req(sr,{user:'newstudent'})).data.solved,false);
   assert.equal((await req(`/schools/${school.id}/problems/${sp}`,{user:'newstudent'})).data.solved,false);
   await schoolJob('newstudent','school','AC','submit',{identityId,cpuMs:1});
   // A replacement credential still belongs to the recorded school identity.
   const mine=await schoolJob('newadmin','school','WA','submit',{identityId,cpuMs:20}),other=await schoolJob('newpeer','school','WA','submit',{cpuMs:40});
   const first=(await req(sr+'?sort=runtimeMs&order=asc&pageSize=2',{user:'newstudent'})).data;safe(first);assert.equal(first.total,3);assert.equal(first.solved,true);assert.deepEqual(first.items.map(r=>r.id),[oldUnlinked,mine]);assert.ok(first.items.every(r=>r.isOwn));assert.equal(first.items[1].status,'WA');
   const second=(await req(sr+'?sort=runtimeMs&order=asc&pageSize=2&page=2',{user:'newstudent'})).data;assert.equal(second.items[0].id,other);assert.equal(second.items[0].isOwn,false);assert.equal(second.hasMore,false);
   const peerView=(await req(sr,{user:'newpeer'})).data;assert.equal(peerView.solved,true);assert.equal(peerView.items.filter(r=>r.isOwn).length,1);assert.equal(peerView.items.find(r=>r.isOwn).id,other);
   // Unlink then bind a different person. Neither that old identity nor the
   // account-only history may grant the replacement person's solved status.
   await pool.query('UPDATE school_identities SET account_id=NULL WHERE school_id=$1 AND id=$2',[school.id,identityId]);
   assert.equal((await req(sr,{user:'newstudent'})).data.total,3);
   const replacement=(await pool.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student','Replacement','Replacement',$2) RETURNING id",[school.id,users.newstudent.id])).rows[0].id;
   const after=(await req(sr,{user:'newstudent'})).data;assert.equal(after.total,3);assert.equal(after.solved,false);assert.equal(after.items.find(r=>r.id===mine).isOwn,false);
   const problemAfter=(await req(`/schools/${school.id}/problems/${sp}`,{user:'newstudent'})).data;assert.equal(problemAfter.solved,false);assert.equal(problemAfter.attempts,0);
   await schoolJob('newstudent','school','AC','submit',{identityId:replacement,cpuMs:3});assert.equal((await req(sr,{user:'newstudent'})).data.solved,true);assert.equal((await req(`/schools/${school.id}/problems/${sp}`,{user:'newstudent'})).data.solved,true);
  });
  await t.test('public latest uses the stable person, keeps historical AC, and cannot pull school submissions',async()=>{
   await schoolJob('newpeer','public','AC','submit',{cpuMs:1});
   const mine=await schoolJob('newstudent','public','WA','submit',{cpuMs:5}),other=await schoolJob('newpeer','public','WA','submit',{cpuMs:30});
   await schoolJob('newstudent','public','AC','samples',{cpuMs:0});
   const first=(await req(pr+'?sort=runtimeMs&order=asc&pageSize=1',{user:'newstudent'})).data;safe(first);assert.equal(first.total,2);assert.equal(first.solved,true);assert.equal(first.items[0].id,mine);assert.equal(first.items[0].isOwn,true);assert.equal(first.items[0].status,'WA');
   const second=(await req(pr+'?sort=runtimeMs&order=asc&pageSize=1&page=2',{user:'newstudent'})).data;assert.equal(second.items[0].id,other);assert.equal(second.items[0].isOwn,false);assert.equal(second.hasMore,false);
   const peerView=(await req(pr,{user:'newpeer'})).data;assert.equal(peerView.solved,true);assert.equal(peerView.items.find(r=>r.isOwn).id,other);
   await pool.query('UPDATE school_problem_publications SET withdrawn_at=now() WHERE problem_id=$1',[sp]);await req(pr,{user:'newstudent',status:404});await req(sr,{user:'newstudent'});
   await pool.query("UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2",[school.id,users.newstudent.id]);await req(sr,{user:'newstudent',status:404});
  });
  const question={key:'Q1',title:'Question',statement:'Public',stages:[{id:'stage1',judgeMode:'auto',title:'Auto',maxMarks:75}]};
  async function paper(kind='catalog'){
   const pid=(await pool.query("INSERT INTO paper4_papers(owner_account_id,title,status,published_at,delivery_kind,activity_kind) VALUES($1,'Paper','published',now(),$2,$3) RETURNING id",[users.admin.id,kind,kind==='catalog'?null:'exam'])).rows[0].id;
   const vid=(await pool.query("INSERT INTO paper4_versions(paper_id,version_number,title,description,definition,runner_cases,published_at) VALUES($1,1,'Paper','',$2,$3,now()) RETURNING id",[pid,{questions:[question],totalMarks:75},{stage1:[{id:'hidden1',public:false,driverCode:'SECRET driver'}]}])).rows[0].id;
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[pid,vid]);return{pid,vid};
  }
  async function paperAttempt(p,who='student',origin='formal',results=[{stageId:'stage1',caseId:'hidden1',status:'AC'}]){
   if(p.kind==='activity')await pool.query('INSERT INTO paper4_activity_participants(paper_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.pid,users[who].identityId]);
   const a=(await pool.query("INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at,attempt_number) VALUES($1,$2,$3,$4,'submitted',now(),(SELECT count(*)+1 FROM paper4_attempts WHERE paper_id=$1 AND version_id=$2 AND identity_id=$3)) RETURNING id",[p.pid,p.vid,users[who].identityId,users[who].id])).rows[0].id;
   const snap=(await pool.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin) VALUES($1,'Q1','SECRET paper code',1,$2) RETURNING id",[a,origin])).rows[0].id;
   const lease=randomUUID(),task=(await pool.query("INSERT INTO paper4_run_tasks(snapshot_id,state,lease_id,lease_expires_at) VALUES($1,'leased',$2,now()+interval '1 hour') RETURNING id",[snap,lease])).rows[0].id;
   await pool.query("INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,private_results,environment_version) VALUES($1,$2,$3,'AC',$4,'qa')",[task,lease,snap,JSON.stringify(results)]);await pool.query("UPDATE paper4_run_tasks SET state='completed' WHERE id=$1",[task]);return{a,snap};
  }
  await t.test('Paper4 counts full formal AC, excludes practice and incomplete verdicts, exposes no hidden drivers',async()=>{
   const p=await paper(),mine=await paperAttempt(p,'student','formal',[]);await paperAttempt(p,'peer');await paperAttempt(p,'student','practice');
   const path=`/paper4/attempts/${mine.a}/questions/Q1/submissions`,data=(await req(path)).data;safe(data);assert.equal(data.total,2);assert.equal(data.solved,false);assert.equal(data.items.find(r=>r.id===mine.snap).status,'NotPassed');assert.equal(data.items[0].runtimeMs,null);
   const accepted=await paperAttempt(p);let latest=(await req(path)).data;assert.equal(latest.solved,true);assert.equal(latest.total,2);assert.ok(latest.items.some(r=>r.id===accepted.snap));assert.ok(!latest.items.some(r=>r.id===mine.snap));
   const failed=await paperAttempt(p,'student','formal',[]);latest=(await req(path+'?sort=status&order=desc&pageSize=1')).data;safe(latest);assert.equal(latest.total,2);assert.equal(latest.solved,true);assert.equal(latest.items[0].id,failed.snap);assert.equal(latest.items[0].status,'NotPassed');assert.equal(latest.items[0].isOwn,true);assert.equal(latest.hasMore,true);
   const second=(await req(path+'?sort=status&order=desc&pageSize=1&page=2')).data;assert.equal(second.items[0].isOwn,false);assert.equal(second.items[0].status,'AC');assert.equal(second.hasMore,false);
   await req(path,{user:'anonymous',status:401});await req(path,{user:'outsider',status:403});await req(path,{user:'peer',status:403});await req(`/paper4/attempts/${mine.a}/questions/Other/submissions`,{status:404});
  });
  await t.test('Paper4 unpublished exam results do not leak in all-submissions or solved',async()=>{
   const p={...await paper('activity'),kind:'activity'},mine=await paperAttempt(p),path=`/paper4/attempts/${mine.a}/questions/Q1/submissions`;
   let data=(await req(path)).data;assert.equal(data.total,0);assert.equal(data.solved,false);
   await pool.query('UPDATE paper4_attempts SET released_at=now() WHERE id=$1',[mine.a]);data=(await req(path)).data;assert.equal(data.total,1);assert.equal(data.solved,true);
   const hidden=await paperAttempt(p,'student','formal',[]);data=(await req(path)).data;assert.equal(data.total,1);assert.equal(data.solved,true);assert.equal(data.items[0].id,mine.snap);assert.ok(!data.items.some(r=>r.id===hidden.snap));
   await pool.query('UPDATE paper4_attempts SET released_at=now() WHERE id=$1',[hidden.a]);data=(await req(path)).data;assert.equal(data.total,1);assert.equal(data.solved,true);assert.equal(data.items[0].id,hidden.snap);assert.equal(data.items[0].status,'NotPassed');
  });
 }finally{await app?.close();await pool.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.end();}
});
