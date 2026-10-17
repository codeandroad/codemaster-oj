import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';
import {canReviewActivitySubmission} from '../src/library.mjs';

// HTTP-level authorization fixture. Candidate code is never executed here;
// ordinary sandbox execution and grade-worker tests remain separate checks.
test('explicit cross-class recipients and class-private resources have independent access boundaries',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`audience_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);const database=new URL(process.env.TEST_DATABASE_URL);database.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(database.href);let server;
 try{
  await migrate(pool);const password=`Audience-${randomUUID()}!`;
  await bootstrap(pool,{name:'Admin',number:'AUD-ADMIN',username:'aud-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://audience.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='';return async(path,body,method=body===undefined?'GET':'POST',status=200)=>{
   const response=await fetch(base+path,{method,headers:{Origin:'http://audience.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();
   assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(result)}`);if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(result.csrfToken)csrf=result.csrfToken;return result;
  };}
  const admin=client();await admin('/auth/login',{username:'aud-admin',password});
  const users={};for(const [tag,kind] of [['teacher','teacher'],['colleague','teacher'],['own','student'],['other','student'],['unassigned','student'],['outsider','student']]){
   const api=client(),number=`AUD-${tag}`,created=await admin('/people',{kind,number,name:number},'POST',201);
   const registered=await api('/auth/register',{kind,number,name:number,activationCode:created.activationCode,username:number.toLowerCase(),password},'POST',201);users[tag]={api,...registered.user};
  }
  const teacher=users.teacher.api,colleague=users.colleague.api,own=users.own.api,other=users.other.api,unassigned=users.unassigned.api,outsider=users.outsider.api;
  const classA=await admin('/classes',{name:'Audience A',teacherIds:[users.teacher.identityId,users.colleague.identityId],studentIds:[users.own.identityId]},'POST',201);
  const classB=await admin('/classes',{name:'Audience B',teacherIds:[users.colleague.identityId],studentIds:[users.other.identityId]},'POST',201);
  const picker=await teacher('/teaching/audience');assert(picker.items.some(i=>i.id===users.unassigned.identityId&&i.classIds.length===0));assert(picker.items.some(i=>i.id===users.other.identityId));assert.equal(picker.classes.find(c=>c.id===classB.id).canAssociate,false);
  const pending=await admin('/people',{kind:'student',number:'AUD-pending',name:'Pending activation'},'POST',201);await admin(`/accounts/${users.outsider.id}`,{disabled:true},'PATCH');const activePicker=await teacher('/teaching/audience');assert(activePicker.items.some(i=>i.id===pending.person.id&&!i.activated));assert(!activePicker.items.some(i=>i.id===users.outsider.identityId));
  assert((await teacher('/teaching/audience?unassigned=true')).items.every(i=>!i.classIds.length));await own('/teaching/audience',undefined,'GET',403);
  assert.equal((await unassigned('/classes')).items.length,0);await unassigned(`/classes/${classA.id}`,undefined,'GET',403);
  const bank=(await pool.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Audience private','private') RETURNING id",[users.teacher.id])).rows[0];
  const problem=(await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[users.teacher.id,bank.id])).rows[0];
  const version=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,validation_status,samples)
   VALUES($1,'Audience private task','stdio','Read and print one integer.',1000,64,'print(input())',now(),'AC','[{"input":"1","expected":"1"}]') RETURNING id`,[problem.id])).rows[0];
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);
  const course=(await pool.query("INSERT INTO learning_paths(owner_account_id,title,description,published_at) VALUES($1,'Audience course','Published course',now()) RETURNING id",[users.teacher.id])).rows[0];
  const dueAt=new Date(Date.now()+3600000).toISOString();
  const assignment=await teacher('/assignments',{title:'Cross-class assignment',classIds:[classA.id],participants:[users.other.identityId,users.unassigned.identityId],coursePathId:course.id,dueAt,problems:[{problemId:problem.id,points:100}]},'POST',201);
  assert.deepEqual(assignment.classIds,[classA.id]);assert.equal((await other(`/assignments/${assignment.id}`)).id,assignment.id);assert.equal((await unassigned(`/assignments/${assignment.id}`)).id,assignment.id);
  await own(`/assignments/${assignment.id}`,undefined,'GET',403);await colleague(`/assignments/${assignment.id}`,undefined,'GET',403);assert.equal((await colleague('/assignments')).items.some(i=>i.id===assignment.id),false);
  assert.equal((await own(`/classes/${classA.id}`)).assignments.some(a=>a.id===assignment.id),false);
  const noClass=await teacher('/assignments',{title:'No-class assignment',classIds:[],participants:[users.unassigned.identityId],dueAt,problems:[{problemId:problem.id,points:100}]},'POST',201);assert.equal(noClass.classId,null);assert.deepEqual(noClass.classIds,[]);
  assert.equal((await teacher(`/reports?classId=&timedPracticeId=&assignmentId=${noClass.id}`)).summary.participants,1);await colleague(`/reports?assignmentId=${noClass.id}`,undefined,'GET',403);
  const submitted=await unassigned('/submissions',{kind:'submit',problemId:problem.id,assignmentId:noClass.id,code:'print(input())',idempotencyKey:randomUUID()},'POST',201);
  assert.equal((await teacher(`/submissions/${submitted.id}`)).id,submitted.id);await colleague(`/submissions/${submitted.id}`,undefined,'GET',403);assert((await teacher('/submissions')).items.some(s=>s.id===submitted.id));assert(!(await colleague('/submissions')).items.some(s=>s.id===submitted.id));
  // A notebook correction inherits the original activity's privacy even when
  // its own assignment_id is absent and the student has joined another class.
  await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classB.id,users.unassigned.identityId]);
  const correction=await unassigned('/submissions',{kind:'correction',problemId:problem.id,originalSubmissionId:submitted.id,code:'print(input()) # private correction',idempotencyKey:randomUUID()},'POST',201);
  assert((await teacher(`/submissions?assignmentId=${noClass.id}`)).items.some(item=>item.id===correction.id));assert(!(await colleague('/submissions')).items.some(item=>item.id===correction.id));await colleague(`/submissions/${correction.id}`,undefined,'GET',403);
  const secondCorrection=await unassigned('/submissions',{kind:'correction',problemId:problem.id,originalSubmissionId:correction.id,code:'print(input()) # second private correction',idempotencyKey:randomUUID()},'POST',201);
  assert((await teacher(`/submissions?assignmentId=${noClass.id}`)).items.some(item=>item.id===secondCorrection.id));assert(!(await colleague('/submissions')).items.some(item=>item.id===secondCorrection.id));await colleague(`/submissions/${secondCorrection.id}`,undefined,'GET',403);assert.equal((await teacher(`/submissions/${secondCorrection.id}`)).id,secondCorrection.id);
  const correctionRow=(await pool.query('SELECT * FROM submissions WHERE id=$1',[secondCorrection.id.slice(3)])).rows[0];assert.equal(await canReviewActivitySubmission(pool,users.teacher,correctionRow),true);assert.equal(await canReviewActivitySubmission(pool,users.colleague,correctionRow),false);assert.equal((await teacher(`/reports?assignmentId=${noClass.id}`)).summary.participants,1);
  const timed=await teacher('/timed-practices',{title:'Cross-class timed',classIds:[],participants:[users.unassigned.identityId,users.other.identityId],coursePathId:course.id,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:dueAt,durationMinutes:30,problems:[{problemId:problem.id,points:100}]},'POST',201);
  assert.equal(timed.classId,null);await teacher(`/timed-practices/${timed.id}/publish`,{});const started=await unassigned(`/timed-practices/${timed.id}/start`,{});assert(started.id);await own(`/timed-practices/${timed.id}`,undefined,'GET',403);await colleague(`/timed-practices/${timed.id}`,undefined,'GET',403);
  assert.equal((await teacher(`/reports?classId=&assignmentId=&timedPracticeId=${timed.id}`)).summary.participants,2);
  const progress=await teacher(`/learning-paths/${course.id}/progress`);assert(progress.items.some(i=>i.id===users.unassigned.identityId));
  const classAssignment=await teacher('/assignments',{title:'Visible class course assignment',classIds:[classA.id],participants:[users.own.identityId],coursePathId:course.id,dueAt,problems:[{problemId:problem.id,points:100}]},'POST',201);
  const resource=await teacher('/learning-resources',{title:'Published course note',type:'note',scope:'school',pathId:course.id,content:'School-visible course material.'},'POST',201);
  const privateResource=await teacher('/learning-resources',{title:'Teacher private note',type:'note',scope:'private',pathId:course.id,content:'Private teacher answer.'},'POST',201);
  const hub=await own(`/classes/${classA.id}`);assert(hub.assignments.some(a=>a.id===classAssignment.id));assert(hub.resources.some(r=>r.id===resource.id));assert(!hub.resources.some(r=>r.id===privateResource.id));
  assert(!(await unassigned('/learning-resources')).items.some(r=>r.id===privateResource.id));await other(`/classes/${classA.id}`,undefined,'GET',403);
  await pool.query('UPDATE classes SET archived_at=now() WHERE id=$1',[classA.id]);await own(`/classes/${classA.id}`,undefined,'GET',404);
  assert.equal((await unassigned(`/assignments/${noClass.id}`)).id,noClass.id,'optional class metadata must not govern explicit recipient access');
  await pool.query('DELETE FROM class_members WHERE class_id=$1 AND identity_id=$2',[classB.id,users.other.identityId]);assert.equal((await other(`/assignments/${assignment.id}`)).id,assignment.id,'leaving a source class does not remove an explicitly named recipient');
  await admin(`/accounts/${users.other.id}`,{disabled:true},'PATCH');
  const renamed=await teacher(`/assignments/${assignment.id}`,{title:'Keep historical recipients',participants:[users.other.identityId,users.unassigned.identityId],expectedRevision:assignment.editRevision},'PATCH');assert(renamed.participants.includes(users.other.identityId));
  await pool.query('UPDATE problems SET archived_at=now() WHERE id=$1',[problem.id]);assert.equal((await teacher(`/problems/${problem.id}?versionId=${version.id}`)).versionId,version.id,'no-class activity owner retains historical fixed version access');await colleague(`/problems/${problem.id}?versionId=${version.id}`,undefined,'GET',404);

 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
