import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';

test('credential relink preserves immutable authors and identity-owned teaching content',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async t=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`relink_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);let server;
 try{
  await migrate(pool);await bootstrap(pool,{name:'关联测试管理员',number:'ADMIN',username:'relink-admin',password:'Relink-admin-2026!'});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:'relink-test-secret-with-at-least-32-bytes',APP_ORIGIN:'http://relink.test',COOKIE_SECURE:'false'})));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='';return async(path,body,method=body===undefined?'GET':'POST',expected=200)=>{const result=await fetch(base+path,{method,headers:{Origin:'http://relink.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await result.json();assert.equal(result.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);if(result.headers.get('set-cookie'))cookie=result.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;return data;};}
  const admin=client(),source=client(),target=client(),student=client();await admin('/auth/login',{username:'relink-admin',password:'Relink-admin-2026!'});
  const a=await admin('/people',{kind:'teacher',number:'TA',name:'同名教师'},'POST',201),b=await admin('/people',{kind:'teacher',number:'TB',name:'同名教师'},'POST',201),s=await admin('/people',{kind:'student',number:'S1',name:'学生'},'POST',201);
  const claim=(person,username)=>({kind:person.person.kind,number:person.person.number,name:person.person.name,activationCode:person.activationCode,username,password:'Relink-member-2026!'});
  const a1=(await source('/auth/register',claim(a,'relink-source-old'),'POST',201)).user;
  const b1=(await target('/auth/register',claim(b,'relink-target-old'),'POST',201)).user;
  const learner=(await student('/auth/register',claim(s,'relink-student'),'POST',201)).user;
  await admin(`/accounts/${a1.id}`,{roles:['teacher','admin']},'PATCH');await source('/auth/login',{username:a1.username,password:'Relink-member-2026!'});
  await source('/auth/profile',{email:'source@example.test'},'PATCH');await target('/auth/profile',{email:'target@example.test'},'PATCH');
  const cls=await source('/classes',{name:'源教师班级',studentIds:[s.person.id]},'POST',201);
  const sourceBank=await source('/problem-banks',{name:'源私有题库',visibility:'private'},'POST',201),targetBank=await target('/problem-banks',{name:'目标私有题库',visibility:'private'},'POST',201);
  const problem=await source('/problems',{bankId:sourceBank.id,title:'真实关联试题',mode:'stdio',statement:'输出一',referenceCode:'print(1)',samples:[{input:'',expected:'1'}],tests:[{input:'',expected:'1',weight:100}]},'POST',201);await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[problem.versionId]);await source(`/problems/${problem.id}/publish`,{versionId:problem.versionId});
  const dueAt=new Date(Date.now()+86400000).toISOString();const assignment=await source('/assignments',{title:'源教师作业',classId:cls.id,dueAt,problems:[{problemId:problem.id,points:100}],participants:[s.person.id]},'POST',201);
  const submission=await student('/submissions',{problemId:problem.id,assignmentId:assignment.id,kind:'submit',code:'print(0)',idempotencyKey:randomUUID()},'POST',201);await pool.query("UPDATE submissions SET status='WA',score=25 WHERE id=$1",[submission.id.slice(3)]);
  const personal=await student('/review-notebook',{submissionId:submission.id,note:'个人笔记'},'POST',201);const feedback=await source('/review-notebook',{submissionId:submission.id,note:'教师反馈'},'POST',201);
  const sourcePath=await source('/learning-paths',{title:'源私有学习路径'},'POST',201),targetPath=await target('/learning-paths',{title:'目标私有学习路径'},'POST',201);
  const sourceResource=await source('/learning-resources',{title:'源教师资料',type:'note',content:'私有资料',scope:'private',pathId:sourcePath.id},'POST',201),targetResource=await target('/learning-resources',{title:'目标教师资料',type:'note',content:'目标私有资料',scope:'private',pathId:targetPath.id},'POST',201);
  const practice=await source('/timed-practices',{title:'源教师训练',classId:cls.id,startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:dueAt,durationMinutes:30,problems:[{problemId:problem.id,points:100}],participants:[s.person.id]},'POST',201);
  const revision=(await pool.query("INSERT INTO timed_result_revisions(practice_id,revision,grades,reason,actor_account_id) VALUES($1,1,'[]','历史作者核验',$2) RETURNING id",[practice.id,a1.id])).rows[0];
  await t.test('restoring an older same-identity account recovers content moved to later credentials',async()=>{
   const release=await admin(`/people/${a.person.id}/unbind`,{});const a2=(await source('/auth/register',{...claim(a,'relink-source-later'),activationCode:release.activationCode},'POST',201)).user;
   assert.equal((await pool.query('SELECT owner_account_id FROM learning_resources WHERE id=$1',[sourceResource.id])).rows[0].owner_account_id,a2.id);
   await admin(`/people/${a.person.id}/unbind`,{});await admin(`/people/${a.person.id}/link`,{accountId:a1.id,reason:'恢复最初账号'});await source('/auth/login',{username:a1.username,password:'Relink-member-2026!'});
   assert.equal((await source(`/problems/${problem.id}`)).canEdit,true);assert.equal((await source(`/learning-paths/${sourcePath.id}`)).canEdit,true);
   assert.equal((await source('/learning-resources')).items.find(r=>r.id===sourceResource.id).canEdit,true);
   assert.equal((await pool.query('SELECT owner_account_id FROM assignments WHERE id=$1',[assignment.id])).rows[0].owner_account_id,a1.id);
  });
  const targetRelease=await admin(`/people/${b.person.id}/unbind`,{}),sourceRelease=await admin(`/people/${a.person.id}/unbind`,{});
  let newTarget;
  await t.test('cross-identity relink moves only visible credentials and target content',async()=>{
   assert.equal((await admin('/accounts')).items.find(account=>account.id===a1.id).canLink,true);
   const linked=await admin(`/people/${b.person.id}/link`,{accountId:a1.id,reason:'管理员核实后调整登录凭据'});assert.notEqual(linked.accountId,a1.id);
   newTarget=(await target('/auth/login',{username:a1.username,password:'Relink-member-2026!'})).user;
   assert.equal(newTarget.identityId,b.person.id);assert.deepEqual(newTarget.roles,['teacher']);assert.equal(newTarget.email,null);
   const preserved=(await pool.query('SELECT * FROM accounts WHERE id=$1',[a1.id])).rows[0];assert.equal(preserved.identity_id,a.person.id);assert.equal(preserved.original_username,a1.username);assert.equal(preserved.credentials_moved_to_account_id,newTarget.id);assert.ok(preserved.disabled_at&&preserved.binding_released_at);
   const historical=(await admin('/accounts')).items.find(account=>account.id===a1.id);assert.equal(historical.originalUsername,a1.username);assert.equal(historical.canLink,false);assert.equal(historical.credentialsTransferred,true);
   await target(`/problem-banks/${sourceBank.id}`,{name:'不能修改源题库'},'PATCH',403);await target(`/problems/${problem.id}`,undefined,'GET',404);
   assert.equal((await target('/classes')).items.some(c=>c.id===cls.id),false);assert.equal((await target('/learning-resources')).items.some(r=>r.id===sourceResource.id),false);
   assert.equal((await target('/problem-banks')).items.find(bank=>bank.id===targetBank.id).canEdit,true);assert.equal((await target('/learning-resources')).items.find(r=>r.id===targetResource.id).canEdit,true);
   const reviews=(await student(`/submissions/${submission.id}`)).reviews;assert.equal(reviews.find(r=>r.id===feedback.id).authorIdentityId,a.person.id);
   assert.equal((await pool.query('SELECT identity_id FROM submissions WHERE id=$1',[submission.id.slice(3)])).rows[0].identity_id,s.person.id);
   assert.equal((await pool.query('SELECT a.identity_id FROM timed_result_revisions r JOIN accounts a ON a.id=r.actor_account_id WHERE r.id=$1',[revision.id])).rows[0].identity_id,a.person.id);
   const sourceAudit=(await pool.query("SELECT a.identity_id FROM audit_events e JOIN accounts a ON a.id=e.actor_account_id WHERE e.action='bank.create' AND e.resource_id=$1",[sourceBank.id])).rows[0];assert.equal(sourceAudit.identity_id,a.person.id);
   await assert.rejects(()=>pool.query('UPDATE accounts SET identity_id=$1 WHERE id=$2',[b.person.id,a1.id]),/historical account identity is immutable/);
   await admin(`/people/${a.person.id}/link`,{accountId:a1.id,reason:'不能复用已转移凭据'},'POST',409);
   assert.equal((await pool.query('SELECT count(*)::int n FROM activation_tokens WHERE identity_id=$1',[b.person.id])).rows[0].n,0);
   await source('/auth/me',undefined,'GET',401);
  });
  await t.test('source identity claims fresh credentials without losing its records or teaching rights',async()=>{
   const reclaimed=(await source('/auth/register',{...claim(a,'relink-source-reclaimed'),activationCode:sourceRelease.activationCode},'POST',201)).user;
   assert.equal(reclaimed.identityId,a.person.id);assert.ok(reclaimed.roles.includes('admin'));assert.equal(reclaimed.email,'source@example.test');
   assert.equal((await source(`/problems/${problem.id}`)).canEdit,true);assert.equal((await source('/learning-resources')).items.find(r=>r.id===sourceResource.id).canEdit,true);
   assert.equal((await source(`/assignments/${assignment.id}`)).grades[0].score,25);assert.equal((await source('/classes')).items.some(c=>c.id===cls.id),true);
   assert.equal((await student(`/submissions/${submission.id}`)).reviews.find(r=>r.id===feedback.id).authorIdentityId,a.person.id);
   await target(`/problems/${problem.id}`,undefined,'GET',404);assert.equal((await pool.query('SELECT count(*)::int n FROM teacher_classes WHERE account_id=$1 AND class_id=$2',[newTarget.id,cls.id])).rows[0].n,0);
  });
  await t.test('notebook direct detail remains scoped after older entries fall outside list cap',async()=>{
   await pool.query("INSERT INTO review_entries(submission_id,author_account_id,note,created_at) SELECT $1,$2,'后续反馈 '||n,clock_timestamp()+n*interval '1 second' FROM generate_series(1,205) n",[submission.id.slice(3),a1.id]);
   assert.equal((await student('/review-notebook')).items.some(entry=>entry.id===personal.id),false);
   const correction=await student('/submissions',{problemId:problem.id,kind:'correction',originalSubmissionId:submission.id,code:'print(1)',idempotencyKey:randomUUID()},'POST',201);
   const detail=await student(`/review-notebook/${personal.id}`);assert.equal(detail.id,personal.id);assert.equal(detail.authorIdentityId,learner.identityId);assert.equal(detail.latestCorrectionId,correction.id);assert.equal(detail.originalSubmissionId,submission.id);assert.ok(detail.relatedNotes.length>200);assert.ok(detail.relatedNotes.some(note=>note.id===feedback.id&&note.authorIdentityId===a.person.id));
   await target(`/review-notebook/${personal.id}`,undefined,'GET',403);assert.equal((await source(`/review-notebook/${personal.id}`)).id,personal.id);
   const unrelated=await admin('/people',{kind:'student',number:'S2',name:'其他学生'},'POST',201),other=client();await other('/auth/register',claim(unrelated,'relink-other'),'POST',201);await other(`/review-notebook/${personal.id}`,undefined,'GET',403);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
