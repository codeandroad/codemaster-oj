import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { provisionSchool } from '../src/schools.mjs';
import { handleSchoolPaper4 } from '../src/school-paper4.mjs';
import { claimSchoolPaper4Task,finishSchoolPaper4Task,processSchoolPaper4One } from '../school-paper4-worker.mjs';
import { claimSchoolTask } from '../school-worker.mjs';
import { GoJudge } from '../judge.mjs';

const definition=()=>({title:'School practical paper',shortTitle:'9618/41 mj 26',description:'Practice',examYear:2026,examSession:'summer',examVariant:41,
 questions:[{key:'Q1',title:'Values',statement:'Print 1.',starterCode:'',initialFiles:{'Data.txt':'1\n'},outputFiles:[],stages:[{id:'auto1',title:'Print',description:'Run the program.',judgeMode:'auto',maxMarks:70},{id:'review1',title:'Explanation',judgeMode:'manual',maxMarks:5}]}],
 runnerCases:{auto1:[{id:'sample',stdin:'',expectedStdout:'1\n',public:true},{id:'private',stdin:'HIDDEN_INPUT',driverCode:'print(1) # HIDDEN_DRIVER',expectedStdout:'1\n',public:false}]},referenceSolutions:{Q1:'print(1) # PRIVATE_REFERENCE'}});
function fakeJudge(){return new GoJudge({url:'http://isolated.test',token:'unused',environmentVersion:'test',fetchImpl:async()=>new Response(JSON.stringify([{status:'Accepted',exitStatus:0,time:1000000,runTime:1000000,memory:8192,files:{stdout:'1\n',stderr:''}}]),{status:200})});}
const safe=value=>{const text=JSON.stringify(value);for(const secret of ['HIDDEN_INPUT','HIDDEN_DRIVER','PRIVATE_REFERENCE','PRIVATE_NOTE','runnerCases','referenceSolutions','privateResults'])assert.equal(text.includes(secret),false,secret);};

test('isolated school Paper 4 workflow, fixed identities, reference review and safe grading',{skip:!process.env.TEST_DATABASE_URL,timeout:180000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);const manager=createPool(base.href),schema='school_paper4_'+randomBytes(5).toString('hex');const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(scoped.href);let app,worker;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];assert.ok(grants);await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const asRole=role=>{const u=new URL(scoped);u.searchParams.set('options',`-crole=${role} -csearch_path=${schema}`);return createPool(u.href);};app=asRole('campus_app');worker=asRole('campus_worker');
  const users={};for(const name of ['admin','teacher','teacher2','student','unassigned','excluded','outside']){const i=randomUUID();await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$2)",[i,name]);users[name]=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[i,name,'unusable-qa-hash'])).rows[0];}
  const school=await provisionSchool(pool,{slug:'p4-school-alpha',name:'Alpha',adminUsername:'admin'}),other=await provisionSchool(pool,{slug:'p4-school-beta',name:'Beta',adminUsername:'outside'});
  const identityIds={};for(const name of ['teacher','teacher2','student','unassigned','excluded']){const role=name.startsWith('teacher')?'teacher':'student';await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[school.id,users[name].id,role]);identityIds[name]=(await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4) RETURNING id',[school.id,role,name,users[name].id])).rows[0].id;}
  const c1=(await pool.query("INSERT INTO school_classes(school_id,name) VALUES($1,'First') RETURNING id",[school.id])).rows[0].id,c2=(await pool.query("INSERT INTO school_classes(school_id,name) VALUES($1,'Second') RETURNING id",[school.id])).rows[0].id;
  for(const [c,n] of [[c1,'teacher'],[c1,'student'],[c2,'teacher2'],[c2,'excluded']])await pool.query('INSERT INTO school_class_roster(school_id,class_id,identity_id) VALUES($1,$2,$3)',[school.id,c,identityIds[n]]);
  const prefix=`/schools/${school.id}/paper4`,call=async(who,path,method='GET',body={})=>(await handleSchoolPaper4({pool:app,user:users[who],route:new URL('http://unit.test'+path).pathname,url:new URL('http://unit.test'+path),method,body}))?.body;
  const baseline=(await pool.query('SELECT (SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM luq_ledger)::int luq')).rows[0];
  let paper,versionId,practice,exam,attemptId,formalJob;
  await t.test('draft import preview, idempotency, school boundary and explicit reference validation',async()=>{
   const body={...definition(),requestId:randomUUID()};paper=await call('teacher',prefix+'/papers','POST',body);assert.equal((await call('teacher',prefix+'/papers','POST',body)).id,paper.id);
   await assert.rejects(call('teacher',prefix+'/papers','POST',{...body,title:'Changed'}),e=>e.status===409);
   await assert.rejects(call('student',prefix+'/papers/'+paper.id),e=>e.status===404);await assert.rejects(call('teacher2',prefix+'/papers/'+paper.id),e=>e.status===404);await assert.rejects(call('outside',prefix+'/papers/'+paper.id),e=>e.status===404);
   assert.equal((await call('outside',`/schools/${other.id}/paper4/papers`)).items.length,0);
   await assert.rejects(call('teacher',prefix+'/papers/publish','POST',{items:[{id:paper.id,expectedRevision:1}]}),e=>e.status===403);
   await assert.rejects(call('admin',prefix+'/papers/publish','POST',{items:[{id:paper.id,expectedRevision:1}]}),e=>e.code==='VALIDATION_REQUIRED');
   const request={requestId:randomUUID(),items:[{id:paper.id,expectedRevision:1}]};const results=await Promise.all([call('teacher',prefix+'/papers/validate','POST',request),call('teacher',prefix+'/papers/validate','POST',request)]);assert.equal(results[0].items[0].id,results[1].items[0].id);
   await processSchoolPaper4One({pool:worker,judge:fakeJudge()});const v=await call('teacher',prefix+'/jobs/'+results[0].items[0].id);assert.equal(v.status,'AC');safe(v);
   versionId=(await call('admin',prefix+'/papers/publish','POST',{items:[{id:paper.id,expectedRevision:1}]})).items[0].versionId;
   const studentView=await call('student',prefix+'/papers/'+paper.id);safe(studentView);assert.equal(studentView.published,true);
   const exported=await call('teacher',prefix+'/papers/export','POST',{paperIds:[paper.id]});assert.equal(exported.paperCount,1);
   const files=[{filename:exported.filename,contentBase64:exported.contentBase64}];assert.equal((await call('teacher',prefix+'/papers/import-preview','POST',{files})).totalPapers,1);
   const imported=await call('teacher',prefix+'/papers/import','POST',{requestId:randomUUID(),files});assert.equal(imported.items[0].published,false);assert.notEqual(imported.items[0].id,paper.id);
  });
  await t.test('cross-class recipients include unassigned identities and exclude another teacher classes',async()=>{
   const a=await call('teacher',prefix+'/audience');assert.deepEqual(new Set(a.students.map(i=>i.id)),new Set([identityIds.student,identityIds.unassigned]));
   await assert.rejects(call('teacher',prefix+'/activities','POST',{requestId:randomUUID(),paperIds:[paper.id],studentIdentityIds:[identityIds.excluded],kind:'practice'}),e=>e.status===403);
   const body={requestId:randomUUID(),paperIds:[paper.id],studentIdentityIds:[identityIds.student,identityIds.unassigned],kind:'practice',scholarshipRule:{amount:7,minimumAc:1,minimumScore:75,taskKind:'challenge',allowSolutionAssisted:false}};practice=(await call('teacher',prefix+'/activities','POST',body)).items[0];assert.equal((await call('teacher',prefix+'/activities','POST',body)).items[0].id,practice.id);
   assert.deepEqual(practice.scholarshipRule,{amount:7,minimumAc:1,minimumScore:75,taskKind:'challenge',allowSolutionAssisted:false,revision:1});assert.equal(practice.canConfigureRule,false);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_scholarship_activity_rules WHERE school_id=$1 AND activity_id=$2',[school.id,practice.id])).rows[0].n,1);
   const before=(await pool.query('SELECT count(*)::int n FROM school_paper4_activities WHERE school_id=$1',[school.id])).rows[0].n;
   await assert.rejects(call('teacher',prefix+'/activities','POST',{...body,requestId:randomUUID(),scholarshipRule:{amount:1001}}),e=>e.status===400);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_paper4_activities WHERE school_id=$1',[school.id])).rows[0].n,before,'invalid rule rolls back the activity and participants');
   assert.equal((await call('excluded',prefix+'/activities')).items.length,0);await assert.rejects(call('excluded',prefix+'/activities/'+practice.id),e=>e.status===404);
   await assert.rejects(call('teacher',prefix+'/activities','POST',{...body,requestId:randomUUID(),kind:'exam'}),e=>e.status===400);
   exam=(await call('teacher',prefix+'/activities','POST',{...body,requestId:randomUUID(),kind:'exam',startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString()})).items[0];
   assert.equal(exam.canConfigureRule,true);
   await assert.rejects(call('student',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id,activityId:exam.id}),e=>e.code==='NOT_STARTED');
   await call('teacher',prefix+'/papers/'+paper.id,'PATCH',{...definition(),title:'Draft changed',expectedRevision:1});assert.equal((await call('teacher',prefix+'/activities/'+practice.id)).versionId,versionId);
  });
  await t.test('optimistic saves, own stable identity, stage run, one formal snapshot and manual review privacy',async()=>{
   const request={requestId:randomUUID(),paperId:paper.id,activityId:practice.id};attemptId=(await call('student',prefix+'/attempts','POST',request)).id;
   assert.equal((await call('student',prefix+'/attempts','POST',{...request,requestId:randomUUID()})).id,attemptId);
   await assert.rejects(call('unassigned',prefix+'/attempts/'+attemptId),e=>e.status===404);await assert.rejects(call('teacher2',prefix+'/attempts/'+attemptId),e=>e.status===404);
   const save=await Promise.allSettled([call('student',prefix+'/attempts/'+attemptId+'/files/Q1','PUT',{code:'print(1) # first',expectedRevision:1}),call('student',prefix+'/attempts/'+attemptId+'/files/Q1','PUT',{code:'print(1) # second',expectedRevision:1})]);assert.equal(save.filter(x=>x.status==='fulfilled').length,1);assert.equal(save.find(x=>x.status==='rejected').reason.status,409);
   const saved=save.find(x=>x.status==='fulfilled').value;assert.deepEqual(await call('student',prefix+'/attempts/'+attemptId+'/files/Q1','PUT',{code:saved.code,expectedRevision:1}),saved,'lost save response can be retried without overwriting newer code');
   const running=await call('student',prefix+'/attempts/'+attemptId+'/run','POST',{requestId:randomUUID(),questionKey:'Q1',stageId:'auto1'});await processSchoolPaper4One({pool:worker,judge:fakeJudge()});assert.equal((await call('student',prefix+'/jobs/'+running.id)).publicOutput,'1\n');
   const submission={requestId:randomUUID()};formalJob=await call('student',prefix+'/attempts/'+attemptId+'/submit','POST',submission);assert.equal((await call('student',prefix+'/attempts/'+attemptId+'/submit','POST',submission)).id,formalJob.id);
   await assert.rejects(call('student',prefix+'/attempts/'+attemptId+'/submit','POST',{requestId:randomUUID()}),e=>e.status===409);
   await assert.rejects(call('student',prefix+'/attempts/'+attemptId+'/files/Q1','PUT',{code:'changed',expectedRevision:2}),e=>e.status===409);
   const leased=await claimSchoolPaper4Task(worker);assert.equal(leased.id,formalJob.id);assert.equal(await finishSchoolPaper4Task(worker,{...leased,lease_id:randomUUID()},{status:'AC'}),false);
   await pool.query("UPDATE school_paper4_jobs SET state='queued',lease_id=NULL,lease_expires_at=NULL WHERE school_id=$1 AND id=$2",[school.id,leased.id]);await processSchoolPaper4One({pool:worker,judge:fakeJudge()});
   const result=await call('student',prefix+'/attempts/'+attemptId);safe(result);assert.equal(result.jobs.find(j=>j.id===formalJob.id).status,'AC');assert.equal(result.marks,undefined);
   await assert.rejects(call('teacher',prefix+'/activities/'+practice.id+'/results/publish','POST'),e=>e.code==='REVIEW_REQUIRED');
   await call('teacher',prefix+'/attempts/'+attemptId+'/marks','PATCH',{marks:[{stageKey:'review1',marks:4,note:'PRIVATE_NOTE'}]});
   assert.equal((await call('teacher',prefix+'/attempts/'+attemptId)).marks.find(m=>m.stageKey==='review1').note,'PRIVATE_NOTE');
   await call('teacher',prefix+'/activities/'+practice.id+'/results/publish','POST');const published=await call('student',prefix+'/attempts/'+attemptId);safe(published);assert.equal(published.marks.reduce((n,m)=>n+m.marks,0),74);
   await call('teacher',prefix+'/activities/'+practice.id+'/results/publish','POST');assert.equal((await pool.query("SELECT count(*)::int n FROM school_scholarship_activity_awards WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3",[school.id,practice.id,identityIds.student])).rows[0].n,1);
   await assert.rejects(call('teacher',prefix+'/attempts/'+attemptId+'/marks','PATCH',{marks:[{stageKey:'review1',marks:5}]}),e=>e.code==='RESULTS_FROZEN');
   const row=(await pool.query('SELECT identity_id FROM school_paper4_jobs WHERE school_id=$1 AND id=$2',[school.id,formalJob.id])).rows[0];assert.equal(row.identity_id,identityIds.student);
   await pool.query('UPDATE school_identities SET account_id=NULL WHERE school_id=$1 AND id=$2',[school.id,identityIds.student]);await assert.rejects(call('student',prefix+'/attempts/'+attemptId),e=>e.code==='STUDENT_IDENTITY_REQUIRED');await pool.query('UPDATE school_identities SET account_id=$3 WHERE school_id=$1 AND id=$2',[school.id,identityIds.student,users.student.id]);
  });
  await t.test('exam server deadline, version freeze and delayed formal results',async()=>{
   const free=(await call('student',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id})).id;
   const freeRun=await call('student',prefix+'/attempts/'+free+'/run','POST',{requestId:randomUUID(),questionKey:'Q1'});await processSchoolPaper4One({pool:worker,judge:fakeJudge()});
   await call('admin',prefix+'/papers/'+paper.id+'/unpublish','POST',{expectedRevision:2});
   await pool.query("UPDATE school_paper4_activities SET starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour' WHERE school_id=$1 AND id=$2",[school.id,exam.id]);
   const id=(await call('student',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id,activityId:exam.id})).id;
   assert.equal((await call('student',prefix+'/attempts/'+id)).versionId,versionId,'assigned frozen paper survives catalog withdrawal');
   await pool.query('UPDATE school_paper4_papers SET published=true WHERE school_id=$1 AND id=$2',[school.id,paper.id]);
   await assert.rejects(call('student',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id}),e=>e.code==='ASSESSMENT_ACTIVE');
   await assert.rejects(call('student',prefix+'/attempts/'+free+'/run','POST',{requestId:randomUUID(),questionKey:'Q1'}),e=>e.code==='ASSESSMENT_ACTIVE');
   await assert.rejects(call('student',prefix+'/attempts/'+free+'/submit','POST',{requestId:randomUUID()}),e=>e.code==='ASSESSMENT_ACTIVE');
   assert.equal((await call('student',prefix+'/jobs/'+freeRun.id)).status,null);
   const pastPractice=await call('student',prefix+'/attempts/'+attemptId);assert.equal(pastPractice.marks,undefined);assert.ok(pastPractice.jobs.every(j=>j.status===null));
   await call('student',prefix+'/attempts/'+id+'/files/Q1','PUT',{code:'print(1)',expectedRevision:1});const job=await call('student',prefix+'/attempts/'+id+'/submit','POST',{requestId:randomUUID()});await processSchoolPaper4One({pool:worker,judge:fakeJudge()});
   const hidden=await call('student',prefix+'/jobs/'+job.id);assert.equal(hidden.status,null);assert.deepEqual(hidden.questions,[]);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_scholarship_activity_awards WHERE school_id=$1 AND activity_id=$2',[school.id,exam.id])).rows[0].n,0,'exam reward waits for results publication');
   await assert.rejects(call('teacher',prefix+'/activities/'+exam.id+'/results/publish','POST'),e=>e.code==='EXAM_ACTIVE');
   await pool.query("UPDATE school_paper4_activities SET ends_at=clock_timestamp()+interval '100 milliseconds' WHERE school_id=$1 AND id=$2",[school.id,exam.id]);
   await new Promise(resolve=>setTimeout(resolve,180));
   await assert.rejects(call('unassigned',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id,activityId:exam.id}),e=>e.code==='DEADLINE_PASSED');
   await call('teacher',prefix+'/attempts/'+id+'/marks','PATCH',{marks:[{stageKey:'review1',marks:5,note:'PRIVATE_NOTE'}]});await call('teacher',prefix+'/activities/'+exam.id+'/results/publish','POST');assert.equal((await call('student',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id,activityId:exam.id})).id,id);const shown=await call('student',prefix+'/jobs/'+job.id);safe(shown);assert.equal(shown.status,'AC');
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_scholarship_activity_awards WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3',[school.id,exam.id,identityIds.student])).rows[0].n,1);
  });
  await t.test('a paper author cannot inspect another teachers assigned students',async()=>{
   const assigned=(await call('admin',prefix+'/activities','POST',{requestId:randomUUID(),paperIds:[paper.id],studentIdentityIds:[identityIds.excluded],kind:'practice'})).items[0];
   const id=(await call('excluded',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:paper.id,activityId:assigned.id})).id;
   await assert.rejects(call('teacher',prefix+'/attempts/'+id),e=>e.status===404);await assert.rejects(call('teacher2',prefix+'/attempts/'+id),e=>e.status===404);
   assert.equal((await call('teacher',prefix+'/papers/'+paper.id+'/attempts')).items.some(a=>a.id===id),false);
   assert.equal((await call('admin',prefix+'/papers/'+paper.id+'/attempts')).items.some(a=>a.id===id),true);
   assert.equal((await call('admin',prefix+'/attempts/'+id)).studentName,'excluded');
  });
  await t.test('shared worker capacity, stale completion and least privilege protect fixed snapshots',async()=>{
   const pending=await call('teacher',prefix+'/papers/validate','POST',{requestId:randomUUID(),items:[{id:paper.id,expectedRevision:2}]});
   await pool.query("UPDATE site_settings SET settings=jsonb_set(settings,'{runtime,workerConcurrency}','1') WHERE id=true");
   const leased=await claimSchoolPaper4Task(worker,{nodeId:'school-p4-test'});assert.equal(leased.id,pending.items[0].id);assert.equal(await claimSchoolTask(worker,{nodeId:'school-p4-test'}),null);assert.equal(await claimSchoolPaper4Task(worker,{nodeId:'school-p4-test'}),null);
   assert.equal(await finishSchoolPaper4Task(worker,leased,{status:'AC',questions:[]}),true);assert.equal(await finishSchoolPaper4Task(worker,leased,{status:'WA'}),false);
   for(const name of ['school_paper4_papers','school_paper4_versions','school_paper4_activities','school_paper4_participants','school_paper4_attempts','school_paper4_files','school_paper4_reviews','school_paper4_requests','school_paper4_jobs'])assert.equal((await app.query(`SELECT * FROM ${name}`)).rowCount,0,name);
   await assert.rejects(app.query('UPDATE school_paper4_versions SET content=content'),{code:'42501'});await assert.rejects(app.query("UPDATE school_paper4_jobs SET state='completed'"),{code:'42501'});await assert.rejects(worker.query('UPDATE school_paper4_jobs SET payload=payload'),{code:'42501'});await assert.rejects(worker.query('SELECT * FROM school_paper4_files'),{code:'42501'});
   assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM luq_ledger)::int luq')).rows[0],baseline);
  });
  await t.test('real isolated Paper 4 executor on frozen new-school snapshots',{skip:!process.env.GO_JUDGE_TEST_URL},async()=>{
   const judge=new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'school-paper4-qa'});await judge.ready();
   const body={...definition(),requestId:randomUUID(),title:'Real sandbox'};const p=await call('teacher',prefix+'/papers','POST',body);const job=(await call('teacher',prefix+'/papers/validate','POST',{requestId:randomUUID(),items:[{id:p.id,expectedRevision:1}]})).items[0];await processSchoolPaper4One({pool:worker,judge});assert.equal((await call('teacher',prefix+'/jobs/'+job.id)).status,'AC');
   await call('admin',prefix+'/papers/publish','POST',{items:[{id:p.id,expectedRevision:1}]});
   for(const [code,expected] of [['print(2)','WA'],['print(1)','AC']]){
    const id=(await call('student',prefix+'/attempts','POST',{requestId:randomUUID(),paperId:p.id})).id;
    await call('student',prefix+'/attempts/'+id+'/files/Q1','PUT',{code,expectedRevision:1});
    const run=await call('student',prefix+'/attempts/'+id+'/run','POST',{requestId:randomUUID(),questionKey:'Q1',stageId:'auto1'});await processSchoolPaper4One({pool:worker,judge});const result=await call('student',prefix+'/jobs/'+run.id);assert.equal(result.status,expected);safe(result);
    const submit=await call('student',prefix+'/attempts/'+id+'/submit','POST',{requestId:randomUUID()});await processSchoolPaper4One({pool:worker,judge});const formal=await call('student',prefix+'/jobs/'+submit.id);assert.equal(formal.status,expected);safe(formal);
   }
  });
 }finally{await app?.end();await worker?.end();await pool.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
