import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';
import {completePaper4Task} from '../paper4-worker.mjs';

const upgrade='039_paper4_activity_audiences.sql';
const questions=[{key:'Q1',title:'A fixed queue',statement:'Implement the queue in English.',starterCode:'# Start here\n',initialFiles:{'Data.txt':'original\n'},outputFiles:[],stages:[{id:'Q1a',title:'Queue operations',maxMarks:75,judgeMode:'auto'}]}];
const runnerCases={Q1a:[{id:'public',public:true,expectedStdout:'1\n'},{id:'hidden',public:false,expectedStdout:'2\n',driverCode:'print("private-driver")'}]};
const referenceSolutions={Q1:'print("private-reference")'};
const ac=runnerCases.Q1a.map(c=>({stageId:'Q1a',caseId:c.id,public:c.public,status:'AC',checks:[]}));
const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};

async function fixture(run,{beforeUpgrade=false}={}){
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`paper4_audience_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let server;
 try{
  if(beforeUpgrade){await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[upgrade]);}
  await migrate(pool);const password=`fixture-${randomUUID()}`;
  await bootstrap(pool,{name:'Administrator',number:'P4-AUDIENCE-ADMIN',username:'p4-audience-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='',user;const send=async(path,body,method=body===undefined?'GET':'POST',status=200,token)=>{
   const response=await fetch(base+path,{method,headers:{Origin:'http://paper4.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':token??csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;if(data.user)user=data.user;return data;
  };return{send,get user(){return user;}};}
  const admin=client();await admin.send('/auth/login',{username:'p4-audience-admin',password});
  const actors={admin};
  for(const [tag,kind] of [['teacher','teacher'],['otherTeacher','teacher'],['classmate','student'],['cross','student'],['unassigned','student'],['excluded','student']]){
   const api=client(),person=await admin.send('/people',{kind,number:`P4-${tag}`,name:tag},'POST',201);
   await api.send('/auth/register',{kind,number:person.person.number,name:tag,activationCode:person.activationCode,username:`p4-${tag.toLowerCase()}`,password},'POST',201);actors[tag]=api;
  }
  const classA=await admin.send('/classes',{name:'Class A',teacherIds:[actors.teacher.user.identityId],studentIds:[actors.classmate.user.identityId]},'POST',201);
  const classB=await admin.send('/classes',{name:'Class B',teacherIds:[actors.otherTeacher.user.identityId],studentIds:[actors.cross.user.identityId]},'POST',201);
  async function finish(taskId,results=ac){
   const task=(await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *",[taskId,randomUUID()])).rows[0];
   const result={status:'AC',publicOutput:'',publicMessage:'',privateResults:results,environmentVersion:'fixture'};
   assert.equal(await completePaper4Task(pool,task,result),true);assert.equal(await completePaper4Task(pool,task,result),false);
  }
  async function source(){
   const paper=await actors.teacher.send('/paper4/papers',{title:'Recipient source',questions,runnerCases,referenceSolutions},'POST',201);
   const validation=await actors.teacher.send(`/paper4/papers/${paper.id}/reference-runs`,{questionKey:'Q1'},'POST',201);
   for(const task of validation.items)await finish(task.id);
   return actors.teacher.send(`/paper4/papers/${paper.id}/publish`,{});
  }
  await run({...actors,pool,classA,classB,finish,source});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}

test('Paper 4 recipients, rather than class membership, authorize every student HTTP access path',options,async()=>{
 await fixture(async f=>{
  const {pool,teacher,admin,classmate,cross,unassigned,excluded,classA,classB,source,finish}=f;
  const paper=await source(),participants=[cross.user.identityId,unassigned.user.identityId];
  const body={activityKind:'practice',classIds:[classA.id],participants};
  const activity=await teacher.send(`/paper4/papers/${paper.id}/activities`,body,'POST',201);
  assert.deepEqual(new Set(activity.participants),new Set(participants));assert.equal(activity.participantCount,2);assert.deepEqual(activity.classIds,[classA.id]);
  assert.equal(activity.startsAt,null);assert.equal(activity.endsAt,null);
  const noClass=await teacher.send(`/paper4/papers/${paper.id}/activities`,{activityKind:'practice',classIds:[],participants},'POST',201);
  assert.deepEqual(noClass.classIds,[]);assert.equal(noClass.classId,null);
  const count=Number((await pool.query('SELECT count(*) n FROM paper4_papers')).rows[0].n);
  for(const invalid of [{...body,participants:[]},{...body,participants:[teacher.user.identityId]},{...body,participants:[randomUUID()]},{activityKind:'exam',participants}])
   await teacher.send(`/paper4/papers/${paper.id}/activities`,invalid,'POST',400);
  await teacher.send(`/paper4/papers/${paper.id}/activities`,{...body,classIds:[classB.id]},'POST',403);
  await teacher.send(`/paper4/papers/${paper.id}/activities`,body,'POST',403,'invalid-csrf');
  assert.equal(Number((await pool.query('SELECT count(*) n FROM paper4_papers')).rows[0].n),count);
  for(const api of [cross,unassigned]){
   const listing=await api.send('/paper4/papers?scope=activities');assert.ok(listing.items.some(p=>p.id===activity.id));
   const visible=await api.send(`/paper4/papers/${activity.id}`);assert.equal(visible.runnerCases,undefined);assert.equal(visible.referenceSolutions,undefined);
   assert.equal(visible.participants,undefined);assert.equal(visible.participantDetails,undefined);
   const other=api===cross?unassigned:cross;assert.equal(JSON.stringify(visible).includes(other.user.identityId),false,'student paper payload cannot reveal another recipient identity');
  }
  await cross.send(`/classes/${classA.id}`,undefined,'GET',403);
  assert.equal((await classmate.send(`/classes/${classA.id}`)).paper4Activities.some(p=>p.id===activity.id),false,'a class hub does not reveal activities to unselected class members');
  for(const api of [classmate,excluded]){
   assert.equal((await api.send('/paper4/papers?scope=activities')).items.some(p=>p.id===activity.id),false);
   await api.send(`/paper4/papers/${activity.id}`,undefined,'GET',403);await api.send(`/paper4/papers/${activity.id}/attempt`,{},'POST',403);
  }
  // Being unassigned or excluded from this activity never closes the public source.
  for(const api of [classmate,unassigned,excluded])assert.equal((await api.send(`/paper4/papers/${paper.id}`)).deliveryKind,'catalog');
  const attempt=await cross.send(`/paper4/papers/${activity.id}/attempt`,{},'POST',201);
  assert.equal((await cross.send(`/paper4/papers/${activity.id}/attempt`)).id,attempt.id);
  await cross.send(`/paper4/attempts/${attempt.id}/files/Q1`,{content:'print(1)',revision:0},'PATCH');
  await cross.send(`/paper4/attempts/${attempt.id}/checkpoints`,{stageId:'Q1a'},'POST',201);
  const run=await cross.send(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q1'},'POST',201);await finish(run.id);
  assert.equal((await cross.send(`/paper4/runs/${run.id}`)).result.questionStatus,'AC');
  for(const api of [classmate,excluded]){
   await api.send(`/paper4/attempts/${attempt.id}`,undefined,'GET',403);await api.send(`/paper4/runs/${run.id}`,undefined,'GET',403);
   await api.send(`/paper4/attempts/${attempt.id}/files/Q1`,{content:'replace',revision:1},'PATCH',403);
   await api.send(`/paper4/attempts/${attempt.id}/checkpoints`,{stageId:'Q1a'},'POST',403);
   await api.send(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q1'},'POST',403);await api.send(`/paper4/attempts/${attempt.id}/submit`,{},'POST',403);
  }
  await cross.send(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q1a',marks:75},'PATCH',403);
  await cross.send(`/paper4/attempts/${attempt.id}/release`,{},'POST',403);
  await cross.send(`/paper4/attempts/${attempt.id}/submit`,{});
  await teacher.send(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q1a',marks:70,note:'Teacher feedback'},'PATCH');
  assert.equal((await cross.send(`/paper4/attempts/${attempt.id}`)).score,null);
  await teacher.send(`/paper4/attempts/${attempt.id}/release`,{});assert.equal((await cross.send(`/paper4/attempts/${attempt.id}`)).score,70);
  // Fail closed if a recipient row is removed by a future administrative path.
  await pool.query('DELETE FROM paper4_activity_participants WHERE paper_id=$1 AND identity_id=$2',[activity.id,cross.user.identityId]);
  await cross.send(`/paper4/attempts/${attempt.id}`,undefined,'GET',403);await cross.send(`/paper4/runs/${run.id}`,undefined,'GET',403);
  assert.equal((await cross.send('/paper4/papers?scope=activities')).items.some(p=>p.id===activity.id),false);
  const otherAttempt=await unassigned.send(`/paper4/papers/${noClass.id}/attempt`,{},'POST',201);
  await unassigned.send(`/paper4/attempts/${otherAttempt.id}/files/Q1`,{content:'print(2)',revision:0},'PATCH');
  const free=await unassigned.send(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);assert.equal(free.files[0].content,questions[0].starterCode);
  await pool.query('DELETE FROM paper4_activity_participants WHERE paper_id=$1 AND identity_id=$2',[noClass.id,unassigned.user.identityId]);
  await unassigned.send(`/paper4/papers/${noClass.id}/attempt`,undefined,'GET',403);
  await unassigned.send(`/paper4/attempts/${otherAttempt.id}`,undefined,'GET',403);
  await unassigned.send(`/paper4/attempts/${otherAttempt.id}/files/Q1`,{content:'after recipient removal',revision:1},'PATCH',403);
  await unassigned.send(`/paper4/attempts/${otherAttempt.id}/checkpoints`,{stageId:'Q1a'},'POST',403);
  await unassigned.send(`/paper4/attempts/${otherAttempt.id}/runs`,{fileKey:'Q1'},'POST',403);
  await unassigned.send(`/paper4/attempts/${otherAttempt.id}/submit`,{},'POST',403);
  await pool.query('DELETE FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[classA.id,teacher.user.id]);
  assert.equal((await teacher.send(`/paper4/papers/${activity.id}`)).canManage,true,'optional class tags do not revoke activity ownership');
  assert.equal((await admin.send(`/paper4/attempts/${attempt.id}`)).score,70);
 });
});

test('classless named-recipient mock exams freeze exactly once and share canonical AC credit with free practice',options,async()=>{
 await fixture(async({pool,teacher,unassigned,excluded,source,finish})=>{
  const paper=await source(),participants=[unassigned.user.identityId];
  const exam=await teacher.send(`/paper4/papers/${paper.id}/activities`,{activityKind:'exam',classIds:[],participants,
   startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()},'POST',201);
  const attempt=await unassigned.send(`/paper4/papers/${exam.id}/attempt`,{},'POST',201);
  await unassigned.send(`/paper4/attempts/${attempt.id}/files/Q1`,{content:'print("frozen exam")',revision:0},'PATCH');
  await pool.query('ALTER TABLE paper4_versions DISABLE TRIGGER paper4_version_immutable');
  await pool.query("UPDATE paper4_versions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[attempt.versionId]);
  await pool.query('ALTER TABLE paper4_versions ENABLE TRIGGER paper4_version_immutable');
  const closed=await Promise.all([unassigned.send(`/paper4/attempts/${attempt.id}`),unassigned.send(`/paper4/attempts/${attempt.id}`)]);
  assert.ok(closed.every(a=>a.status==='submitted'));assert.equal(closed[0].snapshots[0].sourceCode,'print("frozen exam")');
  const tasks=(await pool.query("SELECT t.id FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id WHERE s.attempt_id=$1 AND s.origin='formal'",[attempt.id])).rows;
  assert.equal(tasks.length,1);await finish(tasks[0].id);
  await excluded.send(`/paper4/attempts/${attempt.id}`,undefined,'GET',403);
  await unassigned.send(`/paper4/attempts/${attempt.id}/files/Q1`,{content:'late',revision:1},'PATCH',409);
  const free=await unassigned.send(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);await unassigned.send(`/paper4/attempts/${free.id}/submit`,{});
  const formal=(await pool.query("SELECT t.id FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id WHERE s.attempt_id=$1 AND s.origin='formal'",[free.id])).rows;assert.equal(formal.length,1);await finish(formal[0].id);
  const ledger=(await pool.query('SELECT * FROM paper4_rank_ledger WHERE identity_id=$1',[unassigned.user.identityId])).rows;
  assert.equal(ledger.length,1);assert.equal(ledger[0].paper_id,paper.id);assert.equal(ledger[0].attempt_id,attempt.id);assert.equal(ledger[0].points,10);
  assert.equal((await unassigned.send('/points/me')).rankPoints,10);
 });
});

test('recipient migration preserves legacy work and points while later class changes do not expand the audience',options,async()=>{
 await fixture(async({pool,teacher,classmate,cross,unassigned,excluded,classA})=>{
  const definition={language:'python',totalMarks:75,questions};
  async function legacy(title,classId,kind='activity'){
   const p=(await pool.query(`INSERT INTO paper4_papers(owner_account_id,class_id,title,status,published_at,delivery_kind,activity_kind)
    VALUES($1,$2,$3,'published',now(),$4,$5) RETURNING id`,[teacher.user.id,classId,title,kind,kind==='activity'?'practice':null])).rows[0].id;
   const v=(await pool.query(`INSERT INTO paper4_versions(paper_id,title,description,class_id,definition,runner_cases,reference_solutions,published_at)
    VALUES($1,$2,'',$3,$4::jsonb,$5::jsonb,$6::jsonb,now()) RETURNING id`,[p,title,classId,JSON.stringify(definition),JSON.stringify(runnerCases),JSON.stringify(referenceSolutions)])).rows[0].id;
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[p,v]);return{id:p,versionId:v};
  }
  const activity=await legacy('Legacy class activity',classA.id),global=await legacy('Legacy global activity',null),catalog=await legacy('Legacy free catalogue',null,'catalog');
  const attempt=(await pool.query(`INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at,released_at)
   VALUES($1,$2,$3,$4,'submitted',now(),now()) RETURNING id`,[activity.id,activity.versionId,cross.user.identityId,cross.user.id])).rows[0].id;
  await pool.query("INSERT INTO paper4_attempt_files(attempt_id,question_key,content,revision) VALUES($1,'Q1','legacy saved code',7)",[attempt]);
  const snapshot=(await pool.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin) VALUES($1,'Q1','legacy saved code',7,'formal') RETURNING id",[attempt])).rows[0].id;
  const task=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[snapshot])).rows[0].id;
  const lease=randomUUID();await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",[task,lease]);
  const leased=(await pool.query('SELECT * FROM paper4_run_tasks WHERE id=$1',[task])).rows[0];
  assert.equal(await completePaper4Task(pool,leased,{status:'AC',publicOutput:'',publicMessage:'',privateResults:ac,environmentVersion:'legacy-fixture'}),true);
  await pool.query("INSERT INTO paper4_stage_marks(attempt_id,stage_key,marks,note,reviewer_account_id) VALUES($1,'Q1a',70,'legacy feedback',$2)",[attempt,teacher.user.id]);
  async function evidence(){return{attempts:(await pool.query('SELECT * FROM paper4_attempts ORDER BY id')).rows,files:(await pool.query('SELECT * FROM paper4_attempt_files ORDER BY attempt_id,question_key')).rows,
   versions:(await pool.query('SELECT * FROM paper4_versions ORDER BY id')).rows,snapshots:(await pool.query('SELECT * FROM paper4_snapshots ORDER BY id')).rows,
   marks:(await pool.query('SELECT * FROM paper4_stage_marks ORDER BY attempt_id,stage_key')).rows,runs:(await pool.query('SELECT * FROM paper4_runs ORDER BY id')).rows,ledger:(await pool.query('SELECT * FROM paper4_rank_ledger ORDER BY identity_id,paper_id')).rows};}
  const before=await evidence();assert.equal(before.ledger.length,1);
  await pool.query('DELETE FROM schema_migrations WHERE name=$1',[upgrade]);await migrate(pool);
  assert.deepEqual(await evidence(),before);
  const recipients=(await pool.query('SELECT identity_id FROM paper4_activity_participants WHERE paper_id=$1',[activity.id])).rows.map(r=>r.identity_id);
  assert.deepEqual(new Set(recipients),new Set([classmate.user.identityId,cross.user.identityId]),'snapshot class members and preserve an old attempt owner from another class');
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_activity_participants WHERE paper_id=$1',[catalog.id])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_activity_participants WHERE paper_id=$1',[global.id])).rows[0].n,4);
  assert.equal((await cross.send(`/paper4/attempts/${attempt}`)).score,70);
  await pool.query('DELETE FROM class_members WHERE class_id=$1 AND identity_id=$2',[classA.id,classmate.user.identityId]);
  await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classA.id,excluded.user.identityId]);
  assert.equal((await classmate.send(`/paper4/papers/${activity.id}`)).id,activity.id);
  await excluded.send(`/paper4/papers/${activity.id}`,undefined,'GET',403);
  assert.equal((await excluded.send('/paper4/papers?scope=activities')).items.some(p=>p.id===activity.id),false);
  for(const api of [classmate,cross,unassigned,excluded])assert.equal((await api.send(`/paper4/papers/${catalog.id}`)).deliveryKind,'catalog');
  assert.deepEqual(await evidence(),before,'access checks do not rewrite the preserved legacy attempt or ledger');
 },{beforeUpgrade:true});
});
