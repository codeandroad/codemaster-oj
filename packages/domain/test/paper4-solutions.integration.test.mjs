import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';
import {completePaper4Task} from '../paper4-worker.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};
const references={Q1:'print("REFERENCE_Q1_ORIGINAL")\n',Q2:'print("REFERENCE_Q2_PRIVATE")\n'};
const questions=[
 {key:'Q1',title:'Queue',statement:'Implement a queue.',starterCode:'# Q1\n',stages:[
  {id:'Q1_auto',title:'Behaviour',maxMarks:15,judgeMode:'auto'},
  {id:'Q1_manual',title:'Source review',maxMarks:15,judgeMode:'manual'}]},
 {key:'Q2',title:'Files',statement:'Process the supplied file.',starterCode:'# Q2\n',initialFiles:{'Data.txt':'candidate data\n'},outputFiles:['Result.txt'],stages:[
  {id:'Q2_auto',title:'File behaviour',maxMarks:35,judgeMode:'auto'},
  {id:'Q2_evidence',title:'Run evidence',maxMarks:10,judgeMode:'evidence'}]},
];
const cases=Object.fromEntries(['Q1_auto','Q2_auto'].map(stage=>[stage,[
 {id:'public',public:true,expectedStdout:'PUBLIC_EXPECTED'},
 {id:'hidden',public:false,expectedStdout:'HIDDEN_EXPECTED',driverCode:'print("PRIVATE_DRIVER")'},
]]));

async function fixture(run){
 const database=new URL(process.env.TEST_DATABASE_URL);
 // These tests create/drop only their own schema in the dedicated local QA DB.
 // Refuse the application database even if TEST_DATABASE_URL was misconfigured.
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(database.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(database.pathname),'Use a dedicated local campus_qa/campus_test database.');
 const manager=createPool(database.href),schema=`paper4_solutions_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);database.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(database.href);let server;
 try{
  await migrate(pool);const password=randomBytes(32).toString('base64url');
  await bootstrap(pool,{name:'Administrator',number:'SOLUTIONS-ADMIN',username:'solutions-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='',user;const send=async(path,body,method=body===undefined?'GET':'POST',status=200)=>{
   const response=await fetch(base+path,{method,headers:{Origin:'http://paper4.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;if(data.user)user=data.user;return data;
  };return{send,get user(){return user;}};}
  const admin=client();await admin.send('/auth/login',{username:'solutions-admin',password});
  const actors={admin};
  for(const [tag,kind]of [['teacher','teacher'],['otherTeacher','teacher'],['student','student'],['otherStudent','student'],['excluded','student']]){
   const api=client(),person=await admin.send('/people',{kind,number:`SOLUTIONS-${tag}`,name:tag},'POST',201);
   await api.send('/auth/register',{kind,number:person.person.number,name:tag,activationCode:person.activationCode,username:`solutions-${tag.toLowerCase()}`,password},'POST',201);actors[tag]=api;
  }
  async function validate(paperId){
   for(const question of questions){
    const queued=await actors.teacher.send(`/paper4/papers/${paperId}/reference-runs`,{questionKey:question.key},'POST',201);
    for(const item of queued.items){
     const task=(await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *",[item.id,randomUUID()])).rows[0];
     // This authorization fixture uses the production worker commit contract;
     // it never executes reference/student code or connects to an executor.
     assert.equal(await completePaper4Task(pool,task,{status:'AC',publicOutput:'',publicMessage:'',privateResults:cases[item.stageId].map(c=>({stageId:item.stageId,caseId:c.id,public:c.public,status:'AC',checks:[]})),environmentVersion:'fixture'}),true);
    }
   }
  }
  const body={title:'Frozen reference paper',questions,runnerCases:cases,referenceSolutions:references};
  async function source(){const paper=await actors.teacher.send('/paper4/papers',body,'POST',201);await validate(paper.id);return actors.teacher.send(`/paper4/papers/${paper.id}/publish`,{});}
  async function activity(paper,kind,extra={}){
   return actors.teacher.send(`/paper4/papers/${paper.id}/activities`,{activityKind:kind,classIds:[],participants:[actors.student.user.identityId,actors.otherStudent.user.identityId],...(kind==='exam'?{startsAt:new Date(Date.now()-60_000).toISOString(),endsAt:new Date(Date.now()+3_600_000).toISOString()}:{}),...extra},'POST',201);
  }
  const begin=(api,paper)=>api.send(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);
  const solution=(api,attempt,question='Q1',status=200)=>api.send(`/paper4/attempts/${attempt.id}/solutions/${question}`,undefined,'GET',status);
  await run({...actors,pool,source,validate,body,activity,begin,solution,anonymous:client()});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}

test('Paper 4 solutions are question-scoped, frozen to the attempt, and restricted to its owner or manager',options,async()=>{
 await fixture(async({teacher,otherTeacher,student,otherStudent,admin,anonymous,pool,source,validate,body,begin,solution})=>{
  const paper=await source(),attempt=await begin(student,paper);
  assert.deepEqual(await solution(student,attempt),{questionKey:'Q1',language:'python',code:references.Q1});
  assert.deepEqual(await solution(student,attempt,'Q2'),{questionKey:'Q2',language:'python',code:references.Q2});
  await solution(anonymous,attempt,'Q1',401);await solution(otherStudent,attempt,'Q1',403);await solution(otherTeacher,attempt,'Q1',403);
  for(const api of [teacher,admin])assert.deepEqual(await solution(api,attempt),{questionKey:'Q1',language:'python',code:references.Q1});
  for(const key of ['Q99','%20','q1'])assert.equal((await solution(student,attempt,key,404)).error.code,'NOT_FOUND');
  const ordinaryPaper=await student.send(`/paper4/papers/${paper.id}`),ordinaryAttempt=await student.send(`/paper4/attempts/${attempt.id}`);
  assert.equal(ordinaryPaper.referenceSolutions,undefined);assert.equal(ordinaryPaper.runnerCases,undefined);
  assert.equal(JSON.stringify(ordinaryAttempt).includes('REFERENCE_Q1_ORIGINAL'),false);
  assert.equal(JSON.stringify(await solution(student,attempt)).includes('HIDDEN_EXPECTED'),false);
  assert.equal(JSON.stringify(await solution(student,attempt)).includes('PRIVATE_DRIVER'),false);
  assert.equal(JSON.stringify(await solution(student,attempt)).includes('REFERENCE_Q2_PRIVATE'),false);

  // Releasing a different current version cannot alter an earlier attempt's answer.
  await teacher.send(`/paper4/papers/${paper.id}/draft`,{},'POST',201);
  const updatedReferences={...references,Q1:'print("REFERENCE_Q1_REPLACEMENT")\n'};
  await teacher.send(`/paper4/papers/${paper.id}`,{...body,referenceSolutions:updatedReferences},'PATCH');
  await validate(paper.id);const updated=await teacher.send(`/paper4/papers/${paper.id}/publish`,{});
  assert.notEqual(updated.versionId,attempt.versionId);
  assert.equal((await solution(student,attempt)).code,references.Q1);
  assert.equal((await solution(student,attempt,`Q1?versionId=${updated.versionId}`)).code,references.Q1,'a query cannot override the frozen attempt version');
  const nextAttempt=await begin(otherStudent,updated);assert.equal((await solution(otherStudent,nextAttempt)).code,updatedReferences.Q1);

  const untouched=async()=>{const rows={};for(const table of ['paper4_attempts','paper4_attempt_files','paper4_snapshots','paper4_run_tasks','paper4_runs','paper4_stage_marks','paper4_rank_ledger','submissions','point_ledger'])rows[table]=(await pool.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;return rows;};
  const before=await untouched();await solution(student,attempt);await solution(teacher,attempt,'Q2');
  assert.deepEqual(await untouched(),before,'reading solutions does not submit, execute, grade, award points or rewrite work');
 });
});

test('Paper 4 practice recipients may read solutions, while exam answers require the same student’s released result',options,async()=>{
 await fixture(async({teacher,otherTeacher,student,otherStudent,excluded,admin,pool,source,activity,begin,solution})=>{
  const paper=await source(),practice=await activity(paper,'practice'),practiceAttempt=await begin(student,practice);
  assert.equal((await solution(student,practiceAttempt)).code,references.Q1);
  await solution(otherStudent,practiceAttempt,'Q1',403);await solution(excluded,practiceAttempt,'Q1',403);await solution(otherTeacher,practiceAttempt,'Q1',403);
  await pool.query('DELETE FROM paper4_activity_participants WHERE paper_id=$1 AND identity_id=$2',[practice.id,student.user.identityId]);
  await solution(student,practiceAttempt,'Q1',403);assert.equal((await solution(teacher,practiceAttempt)).code,references.Q1);

  const exam=await activity(paper,'exam'),first=await begin(student,exam),second=await begin(otherStudent,exam);
  for(const [api,attempt]of [[student,first],[otherStudent,second]])assert.equal((await solution(api,attempt,'Q1',403)).error.code,'SOLUTION_LOCKED');
  assert.equal((await solution(teacher,first)).code,references.Q1);assert.equal((await solution(admin,first)).code,references.Q1);
  await student.send(`/paper4/attempts/${first.id}/submit`,{});await otherStudent.send(`/paper4/attempts/${second.id}/submit`,{});
  assert.equal((await solution(student,first,'Q1',403)).error.code,'SOLUTION_LOCKED','submission alone does not release answers');
  for(const stage of questions.flatMap(q=>q.stages))await teacher.send(`/paper4/attempts/${first.id}/marks`,{stageId:stage.id,marks:0},'PATCH');
  await teacher.send(`/paper4/attempts/${first.id}/release`,{});
  assert.equal((await solution(student,first)).code,references.Q1);
  assert.equal((await solution(otherStudent,second,'Q1',403)).error.code,'SOLUTION_LOCKED','another participant’s released marks do not unlock this attempt');
  await pool.query('DELETE FROM paper4_activity_participants WHERE paper_id=$1 AND identity_id=$2',[exam.id,student.user.identityId]);
  await solution(student,first,'Q1',403);
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger')).rows[0].n,0);
 });
});

test('Paper 4 solution access fails closed for unavailable papers, unpublished versions, future activities and missing answers',options,async()=>{
 await fixture(async({teacher,student,admin,pool,source,body,activity,begin,solution})=>{
  const paper=await source(),attempt=await begin(student,paper);
  await teacher.send(`/paper4/papers/${paper.id}/archive`,{});
  assert.equal((await solution(student,attempt,'Q1',404)).error.code,'NOT_FOUND');
  assert.equal((await solution(teacher,attempt)).code,references.Q1);assert.equal((await solution(admin,attempt)).code,references.Q1);
  await teacher.send(`/paper4/papers/${paper.id}/restore`,{});
  assert.equal((await solution(student,attempt)).code,references.Q1);

  // Legacy/inconsistent records must not expose an unpublished frozen version.
  const draft=await teacher.send('/paper4/papers',body,'POST',201);
  await pool.query("UPDATE paper4_papers SET status='published',published_at=now(),draft_version_id=NULL WHERE id=$1",[draft.id]);
  const unpublished=(await pool.query('INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id) VALUES($1,$2,$3,$4) RETURNING id',[draft.id,draft.versionId,student.user.identityId,student.user.id])).rows[0];
  await solution(student,unpublished,'Q1',404);assert.equal((await solution(teacher,unpublished)).code,references.Q1);

  const future=await activity(paper,'practice',{startsAt:new Date(Date.now()+3_600_000).toISOString()});
  const premature=(await pool.query('INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id) VALUES($1,$2,$3,$4) RETURNING id',[future.id,future.versionId,student.user.identityId,student.user.id])).rows[0];
  assert.equal((await solution(student,premature,'Q1',409)).error.code,'NOT_STARTED');
  assert.equal((await solution(teacher,premature)).code,references.Q1);

  // Old imported papers may be published without a reference for every question.
  const legacy=await teacher.send('/paper4/papers',{...body,referenceSolutions:{Q1:' \n'}},'POST',201);
  await pool.query('UPDATE paper4_versions SET published_at=now() WHERE id=$1',[legacy.versionId]);
  await pool.query("UPDATE paper4_papers SET status='published',published_at=now(),draft_version_id=NULL WHERE id=$1",[legacy.id]);
  const missing=await begin(student,legacy);
  for(const key of ['Q1','Q2'])assert.equal((await solution(student,missing,key,404)).error.code,'NOT_FOUND');
 });
});
