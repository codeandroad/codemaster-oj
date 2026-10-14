import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';

test('learning and reports: real persistence, publication, progress isolation and class authorization', {skip:!process.env.TEST_DATABASE_URL,timeout:60000}, async t=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`education_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const uri=new URL(process.env.TEST_DATABASE_URL);uri.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(uri.href);let server;
 try {
  await migrate(pool);
  await bootstrap(pool,{name:'Admin',number:'A1',username:'education-admin',password:'Education-test-2026'});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:'education-secret-at-least-32-characters',APP_ORIGIN:'http://education.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='';return async(path,body,method=body===undefined?'GET':'POST',status=200)=>{
   const r=await fetch(`${base}${path}`,{method,headers:{Origin:'http://education.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);
   if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;return data;
  };}
  const admin=client(),teacher=client(),otherTeacher=client(),student=client(),otherStudent=client();
  await admin('/auth/login',{username:'education-admin',password:'Education-test-2026'});
  const people={};
  for(const [key,kind,request] of [['teacher','teacher',teacher],['otherTeacher','teacher',otherTeacher],['student','student',student],['otherStudent','student',otherStudent]]){
   const p=await admin('/people',{kind,number:key,name:key},'POST',201);people[key]=p.person;
   await request('/auth/register',{kind,number:key,name:key,activationCode:p.activationCode,username:`edu-${key.toLowerCase()}`,password:'Education-test-2026'},'POST',201);
  }
  const cls=await admin('/classes',{name:'Education class',teacherIds:[people.teacher.id],studentIds:[people.student.id]},'POST',201);
  const outside=await admin('/classes',{name:'Other class',teacherIds:[people.otherTeacher.id],studentIds:[people.otherStudent.id]},'POST',201);
  const draft=await teacher('/learning-paths',{title:'Python Foundations',description:'Learn lists',category:'ACSL'},'POST',201);
  await t.test('unpublished content and editing are scoped',async()=>{
   await student(`/learning-paths/${draft.id}`,undefined,'GET',404);
   assert.equal((await student('/learning-paths')).items.length,0);
   await student('/learning-paths',{title:'Fake'},'POST',403);
   await otherTeacher(`/learning-paths/${draft.id}`,{title:'Overwrite'},'PATCH',403);
   await teacher(`/learning-paths/${draft.id}/publish`,{},'POST',409);
  });
  const chapter=await teacher(`/learning-paths/${draft.id}/chapters`,{title:'2D Lists',content:'Return one sum for each row.\nDo not modify grid.',problemIds:[]},'POST',201);
  const chapter2=await teacher(`/learning-paths/${draft.id}/chapters`,{title:'Checkpoint',content:'Try several examples.',problemIds:[]},'POST',201);
  await t.test('publication and independent progress survive later requests',async()=>{
   const published=await teacher(`/learning-paths/${draft.id}/publish`,{});assert.equal(published.published,true);assert.equal(published.chapters.length,2);
   assert.equal((await student('/learning-paths')).items[0].chapterCount,2);
   await student(`/chapters/${chapter.id}/progress`,{completed:true});
   assert.equal((await student(`/learning-paths/${draft.id}`)).completedChapters,1);
   assert.equal((await otherStudent(`/learning-paths/${draft.id}`)).completedChapters,0);
   await otherStudent(`/chapters/${chapter.id}/progress`,{completed:'true'},'POST',400);
   await teacher(`/chapters/${chapter.id}/progress`,{completed:true},'POST',403);
   await teacher(`/chapters/${chapter2.id}`,{position:0},'PATCH');
   assert.equal((await student(`/learning-paths/${draft.id}`)).chapters[0].id,chapter2.id);
   await teacher(`/chapters/${chapter2.id}`,undefined,'DELETE');
   assert.equal((await pool.query('SELECT count(*)::int n FROM learning_progress WHERE chapter_id=$1',[chapter.id])).rows[0].n,1);
   await teacher(`/chapters/${chapter.id}`,undefined,'DELETE',409);
  });
  const problem=await teacher('/problems',{title:'Report Sum',mode:'stdio',statement:'Print 3',samples:[{input:'',expected:'3'}],tests:[{input:'',expected:'3',weight:100}],referenceCode:'print(3)',starterCode:''},'POST',201);
  await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[problem.versionId]);await teacher(`/problems/${problem.id}/publish`,{versionId:problem.versionId});
  await teacher(`/chapters/${chapter.id}`,{problemIds:[problem.id]},'PATCH');
  assert.equal((await student(`/learning-paths/${draft.id}`)).chapters[0].problems[0].versionId,problem.versionId);
  await t.test('published lessons cannot grant private-bank access',async()=>{
   const bank=await teacher('/problem-banks',{name:'Private lessons',visibility:'private'},'POST',201);
   const hidden=await teacher('/problems',{bankId:bank.id,title:'Private Sum',mode:'stdio',statement:'Print 3',samples:[{input:'',expected:'3'}],tests:[{input:'',expected:'3',weight:100}],referenceCode:'print(3)',starterCode:''},'POST',201);
   await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[hidden.versionId]);await teacher(`/problems/${hidden.id}/publish`,{versionId:hidden.versionId});
   await teacher(`/chapters/${chapter.id}`,{problemIds:[hidden.id]},'PATCH',409);
   assert.equal((await student(`/learning-paths/${draft.id}`)).chapters[0].problems[0].problemId,problem.id);
  });
  const assignment=await teacher('/assignments',{title:'Class exercise',classId:cls.id,dueAt:new Date(Date.now()+3600000).toISOString(),problems:[{problemId:problem.id,points:50}]},'POST',201);
  const receipt=await student('/submissions',{problemId:problem.id,versionId:problem.versionId,assignmentId:assignment.id,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()},'POST',201);
  await t.test('reports enforce class ownership and pending results are absent from averages',async()=>{
   await student('/reports',undefined,'GET',403);
   await teacher(`/reports?classId=${outside.id}`,undefined,'GET',403);
   await otherTeacher(`/reports?assignmentId=${assignment.id}`,undefined,'GET',403);
   const report=await teacher(`/reports?classId=${cls.id}`);assert.equal(report.summary.participants,1);assert.equal(report.summary.pendingStudents,1);assert.equal(report.summary.averageScore,null);
   assert(!JSON.stringify(report).includes('password_hash'));assert(!('code' in report.submissions[0]));
   await pool.query("UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[receipt.id.slice(3)]);
   const graded=await teacher(`/reports?assignmentId=${assignment.id}`);assert.equal(graded.summary.gradedStudents,1);assert.equal(graded.summary.averageScore,50);assert.equal(graded.summary.averagePercent,100);assert.equal(graded.problems[0].denominator,1);
   await admin(`/people/${people.student.id}`,{name:'=IMPORTXML("bad")'},'PATCH');
   const exported=await teacher(`/reports/export?assignmentId=${assignment.id}`);assert(exported.rows[0][1].startsWith("'="));assert.equal(exported.rows[0][3],50);
  });
  await t.test('timed reports use authorized provisional grades and published snapshots',async()=>{
   const activity=await teacher('/timed-practices',{title:'Timed report',classId:cls.id,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+300000).toISOString(),durationMinutes:1,showVerdict:false,problems:[{problemId:problem.id,versionId:problem.versionId,points:100}]},'POST',201);
   await teacher(`/timed-practices/${activity.id}/publish`,{});await student(`/timed-practices/${activity.id}/start`,{});
   const timed=await student('/submissions',{problemId:problem.id,versionId:problem.versionId,timedPracticeId:activity.id,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()},'POST',201);
   const pending=await teacher(`/reports?timedPracticeId=${activity.id}`);assert.equal(pending.summary.pendingStudents,1);assert.equal(pending.summary.averageScore,null);assert.equal(pending.students[0].assignments[0].type,'timed');
   await otherTeacher(`/reports?timedPracticeId=${activity.id}`,undefined,'GET',403);
   await pool.query("UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[timed.id.slice(3)]);
   const embargo=await student(`/submissions/${timed.id}`);assert.equal(embargo.score,null);assert.equal(embargo.status,'AC');
   assert.equal((await teacher(`/reports?timedPracticeId=${activity.id}`)).summary.averagePercent,100);
   await student(`/timed-practices/${activity.id}/finish`,{});await teacher(`/timed-practices/${activity.id}/results`,{});
   await pool.query("UPDATE submissions SET status='WA',score=0 WHERE id=$1",[timed.id.slice(3)]);
   const frozen=await teacher(`/reports?timedPracticeId=${activity.id}`);assert.equal(frozen.summary.averagePercent,100);
   assert.equal((await student(`/timed-practices/${activity.id}`)).grade.score,100);
  });
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
