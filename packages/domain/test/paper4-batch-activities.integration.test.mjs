import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';
import {completePaper4Task,loadPaper4Task} from '../paper4-worker.mjs';

const upgrade='040_paper4_short_titles.sql';
const questions=[{key:'Q1',title:'A queue',statement:'Implement the queue.',starterCode:'# Start here\n',initialFiles:{},outputFiles:[],stages:[{id:'Q1a',title:'Queue operations',maxMarks:75,judgeMode:'auto'}]}];
const runnerCases={Q1a:[{id:'public',public:true,expectedStdout:'1\n'},{id:'hidden',public:false,expectedStdout:'2\n',driverCode:'print("private-driver")'}]};
const referenceSolutions={Q1:'print("private-reference")'};
const ac=runnerCases.Q1a.map(c=>({stageId:'Q1a',caseId:c.id,public:c.public,status:'AC',checks:[]}));
const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};

// Reference and candidate code never executes on the test host. Complete case
// evidence enters through the same leased-worker commit used in production.
async function fixture(run,{beforeUpgrade=false}={}){
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`paper4_batch_assign_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let server;
 try{
  if(beforeUpgrade){await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[upgrade]);}
  await migrate(pool);const password=`fixture-${randomUUID()}`;
  await bootstrap(pool,{name:'Administrator',number:'P4-BATCH-ADMIN',username:'p4-batch-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='',user;const send=async(path,body,method=body===undefined?'GET':'POST',status=200,token)=>{
   const response=await fetch(base+path,{method,headers:{Origin:'http://paper4.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':token??csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;if(data.user)user=data.user;return data;
  };return{send,get user(){return user;}};}
  const admin=client();await admin.send('/auth/login',{username:'p4-batch-admin',password});const actors={admin};
  for(const [tag,kind] of [['teacher','teacher'],['otherTeacher','teacher'],['student','student'],['cross','student'],['excluded','student']]){
   const api=client(),person=await admin.send('/people',{kind,number:`P4-BATCH-${tag}`,name:tag},'POST',201);
   await api.send('/auth/register',{kind,number:person.person.number,name:tag,activationCode:person.activationCode,username:`p4-batch-${tag.toLowerCase()}`,password},'POST',201);actors[tag]=api;
  }
  const classA=await admin.send('/classes',{name:'Class A',teacherIds:[actors.teacher.user.identityId],studentIds:[actors.excluded.user.identityId]},'POST',201);
  const classB=await admin.send('/classes',{name:'Class B',teacherIds:[actors.otherTeacher.user.identityId],studentIds:[actors.cross.user.identityId]},'POST',201);
  async function finish(taskId){
   const task=(await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *",[taskId,randomUUID()])).rows[0];
   assert.equal(await completePaper4Task(pool,task,{status:'AC',publicOutput:'',publicMessage:'',privateResults:ac,environmentVersion:'fixture'}),true);
  }
  async function draft(exam={}){return actors.teacher.send('/paper4/papers',{title:'9618 Paper 4 long formal title',questions,runnerCases,referenceSolutions,...exam},'POST',201);}
  async function source(exam={}){
   const paper=await draft(exam),validation=await actors.teacher.send(`/paper4/papers/${paper.id}/reference-runs`,{questionKey:'Q1'},'POST',201);
   for(const task of validation.items)await finish(task.id);return actors.teacher.send(`/paper4/papers/${paper.id}/publish`,{});
  }
  async function state(){const result={};for(const table of ['paper4_papers','paper4_versions','paper4_activity_participants','paper4_activity_classes','audit_events'])result[table]=(await pool.query(`SELECT to_jsonb(x) row FROM ${table} x ORDER BY to_jsonb(x)::text`)).rows;return result;}
  async function completeAttempt(api,paperId){
   const attempt=await api.send(`/paper4/papers/${paperId}/attempt`,{},'POST',201);await api.send(`/paper4/attempts/${attempt.id}/submit`,{});
   const tasks=(await pool.query('SELECT t.id FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id WHERE s.attempt_id=$1',[attempt.id])).rows;
   for(const task of tasks)await finish(task.id);return api.send(`/paper4/attempts/${attempt.id}`);
  }
  await run({...actors,pool,classA,classB,finish,draft,source,state,completeAttempt});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}

test('batch Paper 4 assignment validates all sources and one named audience before creating independent deliveries',options,async()=>{
 await fixture(async({pool,teacher,otherTeacher,admin,student,cross,excluded,classA,classB,draft,source,state,completeAttempt})=>{
  const first=await source({examYear:2025,examSession:'summer',examVariant:41}),second=await source({examYear:2024,examSession:'autumn',examVariant:42}),unpublished=await draft();
  assert.equal(first.shortTitle,'9618/41 mj 25');assert.equal(second.shortTitle,'9618/42 on 24');
  const body={paperIds:[first.id,second.id],participants:[student.user.identityId,cross.user.identityId],classIds:[],classId:null,activityKind:'practice'};
  const before=await state();
  for(const invalid of [{...body,paperIds:[]},{...body,paperIds:[first.id,first.id]},{...body,paperIds:Array(101).fill(first.id)},
   {...body,participants:[]},{...body,participants:[teacher.user.identityId]},{...body,activityKind:'exam'},
   {...body,activityKind:'exam',startsAt:new Date().toISOString()}])await teacher.send('/paper4/papers/batch-activities',invalid,'POST',400);
  await teacher.send('/paper4/papers/batch-activities',{...body,paperIds:[first.id,unpublished.id]},'POST',409);
  await otherTeacher.send('/paper4/papers/batch-activities',{...body,paperIds:[first.id,unpublished.id]},'POST',403);
  await teacher.send('/paper4/papers/batch-activities',{...body,classIds:[classB.id]},'POST',403);
  await student.send('/paper4/papers/batch-activities',body,'POST',403);
  await teacher.send('/paper4/papers/batch-activities',body,'POST',403,'invalid-csrf-token');
  assert.deepEqual(await state(),before,'invalid selection, reference, audience and CSRF checks cannot partially create deliveries');
  // Simulate a legacy published source with no accepted reference evidence.
  await pool.query("UPDATE paper4_papers SET status='published',draft_version_id=NULL,published_at=now() WHERE id=$1",[unpublished.id]);
  await pool.query('UPDATE paper4_versions SET published_at=now() WHERE id=$1',[unpublished.versionId]);
  const invalidReferences=await state();
  const failed=await teacher.send('/paper4/papers/batch-activities',{...body,paperIds:[first.id,unpublished.id]},'POST',409);
  assert.equal(failed.error.code,'REFERENCE_NOT_VALIDATED');assert.deepEqual(await state(),invalidReferences);
  const sourceRows=(await pool.query('SELECT * FROM paper4_papers WHERE id=ANY($1::uuid[]) ORDER BY id',[body.paperIds])).rows;
  const taskCount=(await pool.query('SELECT count(*)::int n FROM paper4_run_tasks')).rows[0].n;
  // Failure after an earlier valid copy was inserted must also undo its
  // version, participant rows and individual publication audit.
  await pool.query(`CREATE FUNCTION reject_batch_copy_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.source_paper_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'forced batch activity failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER reject_batch_copy_fixture BEFORE INSERT ON paper4_papers FOR EACH ROW EXECUTE FUNCTION reject_batch_copy_fixture('${second.id}')`);
  const beforeInsertFailure=await state();await teacher.send('/paper4/papers/batch-activities',body,'POST',500);
  assert.deepEqual(await state(),beforeInsertFailure,'a later insert failure rolls back every earlier copy and audit');
  await pool.query('DROP TRIGGER reject_batch_copy_fixture ON paper4_papers');
  const batch=await teacher.send('/paper4/papers/batch-activities',body,'POST',201);assert.equal(batch.count,2);
  assert.deepEqual(batch.items.map(p=>p.sourcePaperId),body.paperIds);
  for(const [index,activity] of batch.items.entries()){
   assert.equal(activity.deliveryKind,'activity');assert.equal(activity.status,'published');assert.equal(activity.classId,null);assert.deepEqual(activity.classIds,[]);
   assert.equal(activity.title,[first,second][index].title);assert.equal(activity.shortTitle,[first,second][index].shortTitle);
   assert.equal(activity.participantCount,2);assert.deepEqual([...activity.participants].sort(),[...body.participants].sort());
   assert.equal(activity.startsAt,null);assert.equal(activity.endsAt,null);assert.deepEqual(activity.questions,[first,second][index].questions);
   assert.ok(Object.values(activity.referenceValidation).every(v=>v.status==='AC'));
   const publicActivity=await student.send(`/paper4/papers/${activity.id}`);
   assert.equal(publicActivity.participants,undefined);assert.equal(publicActivity.participantDetails,undefined);assert.equal(publicActivity.referenceSolutions,undefined);assert.equal(publicActivity.runnerCases,undefined);
   await excluded.send(`/paper4/papers/${activity.id}`,undefined,'GET',403);
   await otherTeacher.send(`/paper4/papers/${activity.id}`,undefined,'GET',403);
   assert.equal((await admin.send(`/paper4/papers/${activity.id}`)).canManage,true);
  }
  assert.deepEqual((await pool.query('SELECT * FROM paper4_papers WHERE id=ANY($1::uuid[]) ORDER BY id',[body.paperIds])).rows,sourceRows);
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_run_tasks')).rows[0].n,taskCount,'unchanged validated content does not enqueue duplicate reference executions');
  const activityAttempt=await completeAttempt(student,batch.items[0].id);assert.equal(activityAttempt.paper.shortTitle,first.shortTitle);
  await completeAttempt(student,first.id);await completeAttempt(student,batch.items[1].id);
  assert.equal((await pool.query('SELECT sum(points)::int n FROM paper4_rank_ledger WHERE identity_id=$1',[student.user.identityId])).rows[0].n,20,'free practice and matching activity share canonical first AC credit');
  const startsAt=new Date(Date.now()-60000).toISOString(),endsAt=new Date(Date.now()+3600000).toISOString();
  const exams=await otherTeacher.send('/paper4/papers/batch-activities',{...body,classIds:[classB.id],activityKind:'exam',startsAt,endsAt},'POST',201);
  assert.equal(exams.count,2);for(const activity of exams.items){assert.equal(activity.activityKind,'exam');assert.equal(activity.startsAt,startsAt);assert.equal(activity.endsAt,endsAt);assert.deepEqual(activity.classIds,[classB.id]);}
  await teacher.send('/paper4/papers/batch-activities',{...body,paperIds:[first.id,batch.items[0].id]},'POST',409);
  await teacher.send(`/paper4/papers/${second.id}/archive`,{});const archivedBefore=await state();
  await teacher.send('/paper4/papers/batch-activities',body,'POST',409);assert.deepEqual(await state(),archivedBefore);
 });
});

test('short display titles change independently of immutable judging and roundtrip private content exports',options,async()=>{
 await fixture(async({pool,teacher,otherTeacher,admin,student,source,finish,completeAttempt})=>{
  const paper=await source({examYear:2025,examSession:'summer',examVariant:41}),attempt=await completeAttempt(student,paper.id);
  const evidence=async()=>{const result={};for(const table of ['paper4_versions','paper4_attempts','paper4_attempt_files','paper4_snapshots','paper4_run_tasks','paper4_runs','paper4_stage_marks','paper4_rank_ledger'])result[table]=(await pool.query(`SELECT to_jsonb(x) row FROM ${table} x ORDER BY to_jsonb(x)::text`)).rows;return result;};
  const before=await evidence();
  for(const shortTitle of [null,123,'x'.repeat(61)])await teacher.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle},'PATCH',400);
  await teacher.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle:'safe',questions:[]},'PATCH',400);
  await otherTeacher.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle:'Hijacked'},'PATCH',403);
  await student.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle:'Hijacked'},'PATCH',403);
  const changed=await teacher.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle:'  Queue practice 25  '},'PATCH');assert.equal(changed.shortTitle,'Queue practice 25');assert.equal(changed.title,paper.title);
  assert.equal((await student.send(`/paper4/attempts/${attempt.id}`)).paper.shortTitle,'Queue practice 25');
  assert.equal((await student.send('/paper4/papers?scope=catalog')).items.find(p=>p.id===paper.id).shortTitle,'Queue practice 25');
  assert.deepEqual(await evidence(),before,'a display-only edit preserves versions, validations, answers, marks and awards');
  const exported=await teacher.send(`/paper4/papers/${paper.id}/export`),manifest=JSON.parse(Buffer.from(exported.contentBase64,'base64'));
  assert.equal(manifest.paper.shortTitle,'Queue practice 25');assert.equal(manifest.paper.participants,undefined);
  const preview=await teacher.send('/paper4/imports/preview',{filename:'paper4.json',contentBase64:exported.contentBase64});assert.equal(preview.preview.shortTitle,'Queue practice 25');
  const imported=await teacher.send('/paper4/papers',preview.createBody,'POST',201);assert.equal(imported.shortTitle,'Queue practice 25');assert.equal(imported.status,'draft');assert.deepEqual(imported.questions,paper.questions);
  const collection=await teacher.send('/paper4/papers/batch-export',{paperIds:[paper.id]});
  const batchImport=await teacher.send('/paper4/papers/batch-import',{files:[{filename:'collection.zip',contentBase64:collection.contentBase64}]},'POST',201);assert.equal(batchImport.items[0].shortTitle,'Queue practice 25');
  const activity=await teacher.send(`/paper4/papers/${paper.id}/activities`,{activityKind:'practice',participants:[student.user.identityId]},'POST',201);assert.equal(activity.shortTitle,'Queue practice 25');
  await admin.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle:''},'PATCH');assert.equal((await teacher.send(`/paper4/papers/${paper.id}`)).shortTitle,'9618/41 mj 25');
  assert.equal((await student.send(`/paper4/papers/${activity.id}`)).shortTitle,'Queue practice 25','a delivery keeps the display label copied when it was assigned');
  await teacher.send(`/paper4/papers/${activity.id}/metadata`,{shortTitle:'Assigned queue'},'PATCH');assert.equal((await student.send(`/paper4/papers/${activity.id}`)).shortTitle,'Assigned queue');
  const plain=await source({title:'Original display label'}),plainAttempt=await student.send(`/paper4/papers/${plain.id}/attempt`,{},'POST',201);
  await teacher.send(`/paper4/papers/${plain.id}/draft`,{},'POST',201);
  await teacher.send(`/paper4/papers/${plain.id}`,{title:'Revised full paper title'},'PATCH');
  const checks=await teacher.send(`/paper4/papers/${plain.id}/reference-runs`,{questionKey:'Q1'},'POST',201);for(const task of checks.items)await finish(task.id);
  const revised=await teacher.send(`/paper4/papers/${plain.id}/publish`,{});
  assert.equal(revised.title,'Revised full paper title');assert.equal(revised.shortTitle,'Original display label');
  assert.equal((await student.send(`/paper4/attempts/${plainAttempt.id}`)).paper.shortTitle,revised.shortTitle,'short titles are global paper metadata even when an old attempt has a different full version title');
  await teacher.send(`/paper4/papers/${plain.id}/metadata`,{shortTitle:''},'PATCH');
  assert.equal((await student.send(`/paper4/attempts/${plainAttempt.id}`)).paper.shortTitle,'Revised full paper title');
  await teacher.send(`/paper4/papers/${paper.id}/archive`,{});await teacher.send(`/paper4/papers/${paper.id}/metadata`,{shortTitle:'Archived edit'},'PATCH',409);
 });
});

test('short-title migration backfills readable labels without rewriting prior answers, grades or points',options,async()=>{
 await fixture(async({pool,teacher,student,finish})=>{
  const definition={language:'python',totalMarks:75,questions,exam:{examYear:2025,examSession:'summer',examVariant:41}};
  const paperId=(await pool.query("INSERT INTO paper4_papers(owner_account_id,title,status,published_at) VALUES($1,'Legacy formal paper title','published',now()) RETURNING id",[teacher.user.id])).rows[0].id;
  const versionId=(await pool.query(`INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,reference_solutions,published_at)
   VALUES($1,'Legacy formal paper title','',$2::jsonb,$3::jsonb,$4::jsonb,now()) RETURNING id`,[paperId,JSON.stringify(definition),JSON.stringify(runnerCases),JSON.stringify(referenceSolutions)])).rows[0].id;
  await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[paperId,versionId]);
  const attemptId=(await pool.query("INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at) VALUES($1,$2,$3,$4,'submitted',now()) RETURNING id",[paperId,versionId,student.user.identityId,student.user.id])).rows[0].id;
  await pool.query("INSERT INTO paper4_attempt_files(attempt_id,question_key,content,revision) VALUES($1,'Q1','saved student program',4)",[attemptId]);
  const snapshot=(await pool.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin) VALUES($1,'Q1','saved student program',4,'formal') RETURNING id",[attemptId])).rows[0].id;
  const task=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[snapshot])).rows[0].id;await finish(task);
  const fallback=(await pool.query("INSERT INTO paper4_papers(owner_account_id,title) VALUES($1,$2) RETURNING id",[teacher.user.id,'A'.repeat(90)])).rows[0].id;
  const fallbackVersion=(await pool.query("INSERT INTO paper4_versions(paper_id,title,description,definition) VALUES($1,$2,'',$3::jsonb) RETURNING id",[fallback,'A'.repeat(90),JSON.stringify({...definition,exam:{}})])).rows[0].id;
  await pool.query('UPDATE paper4_papers SET current_version_id=$2,draft_version_id=$2 WHERE id=$1',[fallback,fallbackVersion]);
  const historical=async()=>{const result={};for(const table of ['paper4_papers','paper4_versions','paper4_attempts','paper4_attempt_files','paper4_snapshots','paper4_run_tasks','paper4_runs','paper4_stage_marks','paper4_rank_ledger'])result[table]=(await pool.query(`SELECT to_jsonb(x)-'short_title' row FROM ${table} x ORDER BY (to_jsonb(x)-'short_title')::text`)).rows;return result;};
  const before=await historical();assert.equal(before.paper4_rank_ledger.length,1);
  await pool.query('DELETE FROM schema_migrations WHERE name=$1',[upgrade]);await migrate(pool);
  assert.deepEqual(await historical(),before);assert.equal((await teacher.send(`/paper4/papers/${paperId}`)).shortTitle,'9618/41 mj 25');
  assert.equal((await student.send(`/paper4/attempts/${attemptId}`)).paper.shortTitle,'9618/41 mj 25');
  assert.equal((await teacher.send(`/paper4/papers/${fallback}`)).shortTitle,'A'.repeat(60));
 },{beforeUpgrade:true});
});

test('published catalogue version entry pins the attempt, saved source and worker tests across later revisions',options,async()=>{
 await fixture(async({pool,teacher,student,source,finish})=>{
  const firstQuestions=questions.map(q=>({...q,title:'Original queue question',starterCode:'# Version 1 starter\n'}));
  const paper=await source({questions:firstQuestions}),versionId=paper.versionId;
  const first=await student.send(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);
  await student.send(`/paper4/attempts/${first.id}/files/Q1`,{content:'print("original saved program")',revision:0},'PATCH');
  await teacher.send(`/paper4/papers/${paper.id}/draft`,{},'POST',201);
  const revisedQuestions=questions.map(q=>({...q,title:'Revised queue question',starterCode:'# Version 2 starter\n'}));
  const revisedCases={Q1a:runnerCases.Q1a.map(c=>({...c,expectedStdout:'revised expectation\n'}))};
  await teacher.send(`/paper4/papers/${paper.id}`,{questions:revisedQuestions,runnerCases:revisedCases,referenceSolutions:{Q1:'print("revised reference")'}},'PATCH');
  const checks=await teacher.send(`/paper4/papers/${paper.id}/reference-runs`,{questionKey:'Q1'},'POST',201);for(const task of checks.items)await finish(task.id);
  const revised=await teacher.send(`/paper4/papers/${paper.id}/publish`,{});assert.notEqual(revised.versionId,versionId);
  const historical=await student.send(`/paper4/papers/${paper.id}?versionId=${versionId}`);
  assert.equal(historical.versionId,versionId);assert.equal(historical.questions[0].title,'Original queue question');assert.equal(historical.runnerCases,undefined);assert.equal(historical.referenceSolutions,undefined);
  const reopened=await student.send(`/paper4/papers/${paper.id}/attempt?versionId=${versionId}`);
  assert.equal(reopened.id,first.id);assert.equal(reopened.files[0].content,'print("original saved program")');
  const same=await student.send(`/paper4/papers/${paper.id}/attempt`,{versionId},'POST');assert.equal(same.id,first.id);
  const current=await student.send(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);
  assert.equal(current.versionId,revised.versionId);assert.equal(current.files[0].content,'# Version 2 starter\n');
  assert.equal((await student.send(`/paper4/papers/${paper.id}/attempt`)).id,current.id);
  await student.send(`/paper4/attempts/${first.id}/submit`,{});
  const queued=(await pool.query('SELECT t.id FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id WHERE s.attempt_id=$1',[first.id])).rows[0];
  const task=(await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *",[queued.id,randomUUID()])).rows[0];
  const loaded=await loadPaper4Task(pool,task);assert.equal(loaded.sourceCode,'print("original saved program")');assert.equal(loaded.question.title,'Original queue question');
  assert.equal(loaded.runnerCases[0].expectedStdout,'1\n');assert.notEqual(loaded.runnerCases[0].expectedStdout,revisedCases.Q1a[0].expectedStdout);
  assert.equal(await completePaper4Task(pool,task,{status:'AC',publicOutput:'',publicMessage:'',privateResults:ac,environmentVersion:'fixture'}),true);
  const submitted=await student.send(`/paper4/papers/${paper.id}/attempt?versionId=${versionId}`);assert.equal(submitted.status,'submitted');assert.equal(submitted.versionId,versionId);
  const retries=await Promise.all([0,1,2].map(()=>student.send(`/paper4/papers/${paper.id}/attempt?versionId=${versionId}`,{},'POST')));assert.ok(retries.every(a=>a.id===first.id));
  const retry=await student.send(`/paper4/papers/${paper.id}/attempt`,{versionId,restart:true},'POST',201);
  assert.equal(retry.versionId,versionId);assert.equal(retry.attemptNumber,2);assert.equal(retry.files[0].content,'# Version 1 starter\n');
  assert.equal((await student.send(`/paper4/attempts/${first.id}`)).files[0].content,'print("original saved program")');
  assert.equal((await student.send(`/paper4/papers/${paper.id}/attempt`)).id,current.id,'resuming an old course version never overwrites current-version work');
  const award=(await pool.query('SELECT version_id,points FROM paper4_rank_ledger WHERE identity_id=$1',[student.user.identityId])).rows;
  assert.deepEqual(award,[{version_id:versionId,points:10}]);
 });
});

test('fixed-version entry rejects drafts, foreign versions and activity overrides without bypassing access checks',options,async()=>{
 await fixture(async({pool,teacher,otherTeacher,student,excluded,source,draft,finish})=>{
  const paper=await source(),foreign=await source(),unpublished=await draft();
  const paths=[`/paper4/papers/${paper.id}`,`/paper4/papers/${paper.id}/attempt`];
  for(const path of paths){
   await student.send(`${path}?versionId=${foreign.versionId}`,undefined,'GET',404);
   await student.send(`${path}?versionId=${unpublished.versionId}`,undefined,'GET',404);
   await student.send(`${path}?versionId=invalid`,undefined,'GET',400);
  }
  const revision=await teacher.send(`/paper4/papers/${paper.id}/draft`,{},'POST',201);
  await student.send(`/paper4/papers/${paper.id}?versionId=${revision.versionId}`,undefined,'GET',404);
  await student.send(`/paper4/papers/${paper.id}/attempt`,{versionId:revision.versionId},'POST',404);
  await teacher.send(`/paper4/papers/${paper.id}?versionId=${paper.versionId}&view=draft`,undefined,'GET',400);
  await student.send(`/paper4/papers/${paper.id}/attempt?versionId=${paper.versionId}`,{versionId:foreign.versionId},'POST',400);
  await student.send(`/paper4/papers/${paper.id}/attempt`,{versionId:null},'POST',400);
  await student.send(`/paper4/papers/${unpublished.id}/attempt`,{versionId:unpublished.versionId,learningPathId:paper.id,chapterId:paper.id},'POST',404);
  const active=await teacher.send(`/paper4/papers/${paper.id}/activities`,{activityKind:'practice',participants:[student.user.identityId]},'POST',201);
  const copy=await student.send(`/paper4/papers/${active.id}/attempt`,{versionId:active.versionId},'POST',201);assert.equal(copy.versionId,active.versionId);
  await excluded.send(`/paper4/papers/${active.id}/attempt`,{versionId:active.versionId},'POST',403);
  await otherTeacher.send(`/paper4/papers/${active.id}?versionId=${active.versionId}`,undefined,'GET',403);
  await student.send(`/paper4/papers/${active.id}/attempt`,{versionId:paper.versionId},'POST',404);
  const legacy=await teacher.send('/paper4/papers',{title:'Independent classroom activity',deliveryKind:'activity',participants:[student.user.identityId],questions,runnerCases,referenceSolutions},'POST',201);
  const validate=async id=>{const checks=await teacher.send(`/paper4/papers/${id}/reference-runs`,{questionKey:'Q1'},'POST',201);for(const task of checks.items)await finish(task.id);return teacher.send(`/paper4/papers/${id}/publish`,{});};
  await validate(legacy.id);const old=await student.send(`/paper4/papers/${legacy.id}/attempt`,{},'POST',201);
  await teacher.send(`/paper4/papers/${legacy.id}/draft`,{},'POST',201);const next=await validate(legacy.id);assert.notEqual(next.versionId,legacy.versionId);
  await student.send(`/paper4/papers/${legacy.id}/attempt?versionId=${legacy.versionId}`,undefined,'GET',409);
  await student.send(`/paper4/papers/${legacy.id}/attempt`,{versionId:legacy.versionId},'POST',409);
  assert.equal((await student.send(`/paper4/attempts/${old.id}`)).versionId,legacy.versionId,'existing historical classroom answers remain accessible through their own attempt');
  await teacher.send(`/paper4/papers/${paper.id}/archive`,{});
  for(const path of paths)await student.send(`${path}?versionId=${paper.versionId}`,undefined,'GET',404);
  await student.send(`/paper4/papers/${paper.id}/attempt`,{versionId:paper.versionId},'POST',404);
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_attempts WHERE version_id=$1',[revision.versionId])).rows[0].n,0);
 });
});
