import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { LEGACY_SCHOOL_ID,provisionSchool,lockSchoolTeaching } from '../src/schools.mjs';
import { schoolPracticeOperation } from '../src/school-practice.mjs';
import { resourceArea } from '../src/application.mjs';
import { claimSchoolTask,finishSchoolTask,processSchoolOne } from '../school-worker.mjs';
import { GoJudge } from '../judge.mjs';

test('isolated school and public practice lifecycle, authorization, queue and feedback',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.equal(base.pathname,'/campus_qa');const manager=createPool(base.href),schema=`school_practice_${randomBytes(5).toString('hex')}`;const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(scoped.href);let app,worker;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];assert.ok(grants);await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const asRole=role=>{const url=new URL(scoped);url.searchParams.set('options',`-crole=${role} -csearch_path=${schema}`);return createPool(url.href);};app=asRole('campus_app');worker=asRole('campus_worker');
  const users={};for(const name of ['admin','teacher','student','outsider','platform']){const identity=randomUUID();await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2)",[identity,name]);users[name]=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity,name,'unusable-test-hash'])).rows[0];}
  await pool.query('INSERT INTO platform_admins(account_id) VALUES($1)',[users.platform.id]);
  const alpha=await provisionSchool(pool,{slug:'practice-alpha',name:'Alpha',adminUsername:'admin'}),beta=await provisionSchool(pool,{slug:'practice-beta',name:'Beta',adminUsername:'outsider'});
  for(const role of ['teacher','student']){await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[alpha.id,users[role].id,role]);await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$2,$2,$3)',[alpha.id,role,users[role].id]);}
  const call=async(user,route,method='GET',body={})=>(await schoolPracticeOperation({pool:app,user:users[user],route:route.split('?')[0],url:new URL('http://unit.test'+route),method,body}))?.body;
  const prefix=`/schools/${alpha.id}`;
  const baseline=(await pool.query('SELECT (SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM luq_ledger)::int luq')).rows[0];
  let p,bank,request;
  const definition={title:'Sum pair',statement:'Read two numbers and print their sum.',mode:'stdio',referenceCode:'a,b=map(int,input().split())\nprint(a+b)',samples:[{input:'2 3',expected:'5'}],tests:[{input:'999 10',expected:'1009',weight:100}]};
  const approvedResult={status:'AC',score:100,passed:1,total:1,publicMessage:'',privateResults:[{position:1,status:'AC',stdout:'HIDDEN_OUTPUT',stderr:'HIDDEN_ERROR',cpuMs:1,memoryBytes:1024}]};
  await t.test('private draft, school isolation, stable idempotency and admin review',async()=>{
   bank=await call('teacher',`${prefix}/problem-banks`,'POST',{name:'Python',requestId:randomUUID()});
   p=await call('teacher',`${prefix}/problems`,'POST',{...definition,bankId:bank.id,requestId:randomUUID()});
   assert.equal((await call('student',`${prefix}/problems`)).items.length,0);
   await assert.rejects(call('student',`${prefix}/problems/${p.id}`),e=>e.status===404);
   await assert.rejects(call('outsider',`${prefix}/problems/${p.id}`),e=>e.status===404||e.status===403);
   await assert.rejects(call('outsider',`/schools/${beta.id}/problems/${p.id}`),e=>e.status===404);
   await assert.rejects(call('teacher',`${prefix}/problems/${p.id}/publish`,'POST',{expectedRevision:1}),e=>e.status===403);
   await assert.rejects(call('admin',`${prefix}/problems/${p.id}/publish`,'POST',{expectedRevision:1}),e=>e.status===409);
   request={expectedRevision:1,requestId:randomUUID()};const jobs=await Promise.all(Array.from({length:3},()=>call('teacher',`${prefix}/problems/${p.id}/validate`,'POST',request)));assert.equal(new Set(jobs.map(j=>j.id)).size,1);
   let calls=0;await processSchoolOne({pool:worker,judge:{judge:async()=>{calls++;return approvedResult;}}});assert.equal(calls,2,'validation includes public samples');
   p=await call('admin',`${prefix}/problems/${p.id}/publish`,'POST',{expectedRevision:1});assert.equal(p.published,true);
  });
  await t.test('public approval is explicit and no private test or reference reaches student projections',async()=>{
   const student=await call('student',`${prefix}/problems/${p.id}`);assert.equal(student.definition.referenceCode,undefined);assert.equal(student.definition.tests,undefined);assert.ok(!JSON.stringify(student).includes('999 10'));
   assert.equal((await call('outsider','/practice/problems')).items.length,0);
   await assert.rejects(call('outsider',`/practice/problems/${p.id}`),e=>e.status===404);
   await assert.rejects(call('admin','/platform/problem-publications','POST',{schoolId:alpha.id,problemId:p.id,versionId:p.versionId}),e=>e.status===403);
   const preview=await call('platform',`/platform/problem-publications/${p.id}?schoolId=${alpha.id}`);assert.equal(preview.definition.tests,undefined);
   await call('platform','/platform/problem-publications','POST',{schoolId:alpha.id,problemId:p.id,versionId:p.versionId});
   assert.equal((await call('outsider','/practice/problems')).items.length,1);const detail=await call('outsider',`/practice/problems/${p.id}`);assert.equal(detail.definition.referenceCode,undefined);
  });
  await t.test('formal feedback cannot disclose hidden cases, jobs are owner-scoped and stale leases cannot finish',async()=>{
   const body={requestId:randomUUID(),kind:'submit',code:'print(5)'};const job=await call('student',`${prefix}/problems/${p.id}/submissions`,'POST',body);assert.equal((await call('student',`${prefix}/problems/${p.id}/submissions`,'POST',body)).id,job.id);
   await assert.rejects(call('student',`${prefix}/problems/${p.id}/submissions`,'POST',{...body,code:'print(6)'}),e=>e.status===409);
   const claimed=await claimSchoolTask(worker);assert.equal(claimed.id,job.id);assert.equal(await finishSchoolTask(worker,{...claimed,lease_id:randomUUID()},approvedResult),false);assert.equal(await finishSchoolTask(worker,claimed,approvedResult),true);assert.equal(await finishSchoolTask(worker,claimed,approvedResult),false);
   const view=await call('student',`${prefix}/judge-jobs/${job.id}`);assert.equal(view.status,'AC');assert.ok(!JSON.stringify(view).includes('HIDDEN_'));assert.equal(view.caseFeedback[0].input,undefined);
   await assert.rejects(call('teacher',`${prefix}/judge-jobs/${job.id}`),e=>e.status===404);
   const publicJob=await call('outsider',`/practice/problems/${p.id}/submissions`,'POST',{kind:'samples',code:'print(5)',requestId:randomUUID()});await processSchoolOne({pool:worker,judge:{judge:async()=>({...approvedResult,privateResults:[{position:1,status:'AC',stdout:'5',stderr:''}]})}});
   const publicView=await call('outsider',`/practice/problems/${p.id}/submissions/${publicJob.id}`);assert.equal(publicView.caseFeedback[0].input,'2 3');assert.equal(publicView.caseFeedback[0].expected,'5');
   await assert.rejects(call('student',`/practice/problems/${p.id}/submissions/${publicJob.id}`),e=>e.status===404);
   assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM luq_ledger)::int luq')).rows[0],baseline);
  });
  await t.test('real isolated executor judges school snapshots without legacy grading side effects',{skip:!process.env.GO_JUDGE_URL},async()=>{
   const judge=new GoJudge();await judge.ready();const code=definition.referenceCode;
   for(const kind of ['samples','submit']){const job=await call('student',`${prefix}/problems/${p.id}/submissions`,'POST',{kind,code,requestId:randomUUID()});await processSchoolOne({pool:worker,judge});const result=await call('student',`${prefix}/judge-jobs/${job.id}`);assert.equal(result.status,'AC');}
   const bad=await call('student',`${prefix}/problems/${p.id}/submissions`,'POST',{kind:'samples',code:'print(0)',requestId:randomUUID()});await processSchoolOne({pool:worker,judge});assert.equal((await call('student',`${prefix}/judge-jobs/${bad.id}`)).status,'WA');
  });
  await t.test('RLS, immutable versions and worker least privilege',async()=>{
   for(const table of ['school_problem_banks','school_problems','school_problem_versions','school_judge_jobs'])assert.equal((await app.query(`SELECT * FROM ${table}`)).rowCount,0,table);
   await assert.rejects(app.query('UPDATE school_problem_versions SET definition=definition'),{code:'42501'});
   await assert.rejects(app.query("UPDATE school_judge_jobs SET state='completed'"),{code:'42501'});
   for(const table of ['school_problem_banks','school_problems','school_problem_versions','school_problem_publications','school_identities','school_courses'])await assert.rejects(worker.query(`SELECT * FROM ${table}`),{code:'42501'});
   await assert.rejects(worker.query('UPDATE school_judge_jobs SET payload=payload'),{code:'42501'});
  });
  await t.test('a public request waiting behind withdrawal rechecks platform authorization',async()=>{
   const writer=await pool.connect();try{
    await writer.query('BEGIN');await lockSchoolTeaching(writer,alpha.id);
    const access=call('outsider',`/practice/problems/${p.id}`).then(()=>({allowed:true}),error=>({error}));
    let waiting=false;for(let i=0;i<100;i++){const count=await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%school-teaching:%'");if(count.rows[0].n>0){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,true,'reader must wait for school publication lock');
    await writer.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE problem_id=$1',[p.id]);await writer.query('COMMIT');
    const outcome=await access;assert.equal(outcome.error?.status,404);
   }finally{await writer.query('ROLLBACK');writer.release();}
   await call('platform','/platform/problem-publications','POST',{schoolId:alpha.id,problemId:p.id,versionId:p.versionId});
  });
  await t.test('withdrawal and newer school versions revoke public visibility immediately',async()=>{
   await call('admin',`${prefix}/problems/${p.id}/unpublish`,'POST',{expectedRevision:1});await assert.rejects(call('outsider',`/practice/problems/${p.id}`),e=>e.status===404);
   await call('admin',`${prefix}/problems/${p.id}/publish`,'POST',{expectedRevision:1});await call('platform',`/platform/problem-publications/${p.id}/withdraw`,'POST',{schoolId:alpha.id});assert.equal((await call('outsider','/practice/problems')).items.length,0);
  });
  await t.test('an original school version can enter public practice without exposing private content',async()=>{
   await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'admin')",[users.admin.id]);
   const { rows: [{ id: problemId }] } = await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[users.teacher.id]);
   const { rows: [{ id: versionId }] } = await pool.query(`INSERT INTO problem_versions
    (problem_id,title,mode,statement,reference_code,samples,metadata,time_limit_ms,memory_limit_mb,validation_status)
    VALUES($1,'Original sum','stdio','Print the sum.','PRIVATE_REFERENCE',
    '[{"input":"2 3","expected":"5","enabled":true},{"input":"PRIVATE_DISABLED_SAMPLE","expected":"5","enabled":false}]',
    '{"teacherNote":"PRIVATE_NOTE","inputDescription":"Two integers on one line."}',1000,128,'AC') RETURNING id`,[problemId]);
   await pool.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'PRIVATE_HIDDEN_INPUT','17',100)",[versionId]);
   await pool.query(`UPDATE problem_versions SET published_at=now(),rank_review_status='approved',
    school_visible_at=now(),rank_approved_at=now() WHERE id=$1`,[versionId]);
   await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[versionId,problemId]);

   const requestRoute = `/admin/problems/${problemId}/publication-request`;
   assert.equal(resourceArea(requestRoute),'schoolPractice');
   const publicRoute = `/practice/problems/${problemId}`;
   const approval = {schoolId:LEGACY_SCHOOL_ID,problemId,versionId};
   await assert.rejects(call('outsider',requestRoute,'POST',{versionId}),e=>e.status===403);
   await assert.rejects(call('outsider',publicRoute),e=>e.status===404);
   await assert.rejects(call('platform',`/platform/problem-publications/${problemId}/reject`,'POST',approval),e=>e.status===409);
   const unrequested = (await call('platform','/platform/problem-publications')).items.find(item=>item.id===problemId);
   assert.equal(unrequested.publicRequestStatus,null);
   const preview=await call('platform',`/platform/problem-publications/${problemId}?schoolId=${LEGACY_SCHOOL_ID}`);
   assert.deepEqual(preview.definition.samples,[{input:'2 3',expected:'5'}]);
   assert.match(preview.definition.statement,/Two integers on one line/);
   assert.doesNotMatch(JSON.stringify(preview),/PRIVATE_/);
   await call('platform','/platform/problem-publications','POST',approval);
   assert.equal((await call('outsider',publicRoute)).versionId,versionId);
   await call('platform',`/platform/problem-publications/${problemId}/withdraw`,'POST',approval);
   await assert.rejects(call('outsider',publicRoute),e=>e.status===404);
   for(const request of await Promise.all([1,2].map(()=>call('admin',requestRoute,'POST',{versionId})))){
    assert.equal(request.publicRequestStatus,'pending');
   }
   assert.equal((await call('admin',requestRoute+`?versionId=${versionId}`)).publicRequestStatus,'pending');
   await assert.rejects(call('admin','/platform/problem-publications','POST',approval),e=>e.status===403);
   await call('platform','/platform/problem-publications','POST',approval);
   const published=await call('outsider',publicRoute);
   assert.equal(published.versionId,versionId);
   assert.doesNotMatch(JSON.stringify(published),/PRIVATE_/);
   await assert.rejects(call('outsider',`/schools/${LEGACY_SCHOOL_ID}/problems/${problemId}`),e=>e.status===404);

   const job=await call('outsider',publicRoute+'/submissions','POST',{kind:'submit',code:'print(17)',requestId:randomUUID()});
   await processSchoolOne({pool:worker,judge:{judge:async task=>{
    assert.equal(task.tests[0].input,'PRIVATE_HIDDEN_INPUT');
    assert.equal(task.version.reference_code,undefined);
    return approvedResult;
   }}});
   assert.doesNotMatch(JSON.stringify(await call('outsider',publicRoute+'/submissions/'+job.id)),/PRIVATE_|HIDDEN_/);
   await assert.rejects(worker.query('SELECT * FROM legacy_public_problem_requests'),{code:'42501'});

   const { rows: [{id: classId}] } = await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Protected class',$1) RETURNING id",[users.teacher.id]);
   const { rows: [{id: practiceId}] } = await pool.query(`INSERT INTO timed_practices
    (title,class_id,owner_account_id,starts_at,ends_at,duration_minutes)
    VALUES('Protected task',$1,$2,now(),now()+interval '1 hour',60) RETURNING id`,[classId,users.teacher.id]);
   await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)',[practiceId,problemId,versionId]);
   await assert.rejects(call('outsider',publicRoute),e=>e.status===404);
   await assert.rejects(call('outsider',publicRoute+'/submissions','POST',{kind:'submit',code:'print(17)',requestId:randomUUID()}),e=>e.status===404);
   await call('platform',`/platform/problem-publications/${problemId}/withdraw`,'POST',approval);
   assert.equal((await call('outsider','/practice/problems')).items.some(item=>item.id===problemId),false);
   assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM luq_ledger)::int luq')).rows[0],baseline);
  });
 }finally{await app?.end();await worker?.end();await pool.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
