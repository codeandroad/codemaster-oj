import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleScholarshipLedger} from '../src/scholarship-ledger.mjs';
import {LEGACY_SCHOOL_ID} from '../src/schools.mjs';
import {schoolPracticeOperation} from '../src/school-practice.mjs';
import {claimSchoolTask,finishSchoolTask} from '../school-worker.mjs';
import {seedPublicScholarshipProblem,seedPublicScholarshipLearner} from './helpers/public-scholarship.mjs';

// Uses actual PostgreSQL roles and trigger transactions, with an isolated schema.
test('public scholarship reuses stable wallets and reviewed contents safely',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(base.href),schema=`public_aid_${randomBytes(5).toString('hex')}`;
 const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const owner=createPool(scoped.href);let app,worker;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(owner);
  const grants=(await readFile(new URL('../grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];assert.ok(grants);await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const asRole=role=>{const u=new URL(scoped);u.searchParams.set('options',`-crole=${role} -csearch_path=${schema}`);return createPool(u.href);};app=asRole('campus_app');worker=asRole('campus_worker');
  const call=async(user,route,body,method=body?'POST':'GET')=>(await schoolPracticeOperation({pool:app,user,route:route.split('?')[0],url:new URL('http://unit.test'+route),method,body:body??{}})).body;
  const aid=(user,p,action,kind='FULL_SOLUTION',more={})=>call(user,`/practice/scholarship/assistance/${action}`,{problemId:p.problemId,versionId:p.versionId,kind,...(kind==='FULL_TRANSLATION'?{language:'zh-CN'}:{}),...more});
  const buy=async(user,p,kind='FULL_SOLUTION')=>{const q=await aid(user,p,'quote',kind);return aid(user,p,'unlock',kind,{requestKey:randomUUID(),confirmedPrice:q.price,confirmedContentId:q.contentId});};
  const submit=(user,p,kind='submit')=>call(user,`/practice/problems/${p.problemId}/submissions`,{requestId:randomUUID(),kind,code:'print(5)'});
  const finish=async(job,status='AC')=>{const claimed=await claimSchoolTask(worker);assert.equal(claimed.id,job.id);assert.equal(await finishSchoolTask(worker,claimed,{status,score:status==='AC'?100:0,total:1,passed:status==='AC'?1:0,privateResults:[]}),true);return claimed;};
  const balance=async user=>Number((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[user.identityId])).rows[0]?.balance??0);
  let user,p;
  await t.test('wallet initializes only on use, once concurrently, with no school-local wallet',async()=>{
   user=await seedPublicScholarshipLearner(owner);p=await seedPublicScholarshipProblem(owner);
   assert.equal((await owner.query('SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1',[user.identityId])).rows[0].n,0);
   const results=await Promise.all(Array.from({length:4},()=>call(user,'/practice/scholarship/me')));assert.ok(results.every(r=>r.balance===100&&r.items.length===1));
   assert.equal((await owner.query('SELECT count(*)::int n FROM luq_initial_grants WHERE identity_id=$1',[user.identityId])).rows[0].n,1);
   assert.equal((await owner.query('SELECT count(*)::int n FROM school_scholarship_accounts')).rows[0].n,0);
  });
  await t.test('reviewed exact content, transaction-safe translation credit, replay and body separation',async()=>{
   const q=await aid(user,p,'quote','FULL_TRANSLATION');assert.equal(q.price,3);assert.equal(q.available,true);assert.equal(q.body,undefined);
   assert.doesNotMatch(JSON.stringify(q),/PRIVATE_|输出数字/);
   await assert.rejects(aid(user,p,'provide'),e=>e.status===403&&e.code==='UNLOCK_REQUIRED');
   const request={requestKey:randomUUID(),confirmedPrice:q.price,confirmedContentId:q.contentId};
   const bought=await Promise.all([1,2,3].map(()=>aid(user,p,'unlock','FULL_TRANSLATION',request)));assert.equal(bought.reduce((n,r)=>n+r.charged,0),3);assert.equal(await balance(user),97);
   assert.equal((await aid(user,p,'provide','FULL_TRANSLATION')).body,'输出数字五。');
   const solution=await aid(user,p,'quote');assert.equal(solution.basePrice,8);assert.equal(solution.translationCredit,3);assert.equal(solution.price,5);
   const requests=await Promise.all([1,2,3].map(()=>aid(user,p,'unlock','FULL_SOLUTION',{requestKey:randomUUID(),confirmedPrice:5,confirmedContentId:solution.contentId})));assert.equal(requests.reduce((n,r)=>n+r.charged,0),5);assert.equal(await balance(user),92);
   assert.equal((await aid(user,p,'quote')).price,0);const content=await aid(user,p,'provide');assert.match(content.body,/print\(5\)/);assert.doesNotMatch(JSON.stringify(content),/PRIVATE_|teacherNote|tests/);
   const jobs=await call(user,`/practice/problems/${p.problemId}`);assert.doesNotMatch(JSON.stringify(jobs),/PRIVATE_REFERENCE|PRIVATE_HIDDEN|PRIVATE_TEACHER|Return the required/);
   const missing=await seedPublicScholarshipProblem(owner,{publishContent:false});assert.equal((await aid(user,missing,'quote')).available,false);await assert.rejects(buy(user,missing),e=>e.status===404);assert.equal(await balance(user),92);
   await assert.rejects(aid(user,p,'quote','FULL_SOLUTION',{versionId:randomUUID()}),e=>e.status===404);
   await assert.rejects(aid(user,p,'quote','FULL_SOLUTION',{assignmentId:randomUUID()}),e=>e.status===400);
  });
  await t.test('competing purchases cannot overdraw and a refund is exactly once while rights remain',async()=>{
   const learner=await seedPublicScholarshipLearner(owner);await call(learner,'/practice/scholarship/me');
   await owner.query("SELECT luq_post_entry($1,-92,'admin_adjustment',$2,NULL,'fixture balance')",[learner.identityId,randomUUID()]);
   const left=await seedPublicScholarshipProblem(owner),right=await seedPublicScholarshipProblem(owner);
   const responses=await Promise.allSettled([buy(learner,left),buy(learner,right)]);assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);assert.equal(responses.filter(r=>r.status==='rejected'&&r.reason.code==='INSUFFICIENT_LUQ').length,1);assert.equal(await balance(learner),0);
   const purchase=(await owner.query("SELECT * FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[learner.identityId])).rows[0];
   const refunds=await Promise.all([1,2,3].map(()=>owner.query("SELECT (luq_post_entry($1,8,'refund',$2,NULL,'fixture refund','{}',$3)).id",[learner.identityId,`refund:${purchase.id}`,purchase.id])));assert.equal(new Set(refunds.map(r=>String(r.rows[0].id))).size,1);assert.equal(await balance(learner),8);
   const won=responses[0].status==='fulfilled'?left:right;assert.equal((await aid(learner,won,'quote')).unlocked,true);assert.match((await aid(learner,won,'provide')).body,/print/);
  });
  await t.test('delivery before submit removes first-AC reward; viewing during judging does not',async()=>{
   const before=await seedPublicScholarshipLearner(owner),after=await seedPublicScholarshipLearner(owner),unlockOnly=await seedPublicScholarshipLearner(owner);
   const p1=await seedPublicScholarshipProblem(owner),p2=await seedPublicScholarshipProblem(owner),p3=await seedPublicScholarshipProblem(owner);
   await buy(before,p1);await aid(before,p1,'provide');let job=await submit(before,p1);await finish(job);assert.equal(await balance(before),92);
   let receipt=(await owner.query('SELECT * FROM public_luq_receipts WHERE job_id=$1',[job.id])).rows[0];assert.equal(receipt.solution_assisted,true);
   await buy(after,p2);job=await submit(after,p2);await aid(after,p2,'provide');await finish(job);assert.equal(await balance(after),96);receipt=(await owner.query('SELECT * FROM public_luq_receipts WHERE job_id=$1',[job.id])).rows[0];assert.equal(receipt.solution_assisted,false);
   await buy(unlockOnly,p3);job=await submit(unlockOnly,p3);await finish(job);assert.equal(await balance(unlockOnly),96,'buying without delivery is not answer usage');
   const translated=await seedPublicScholarshipLearner(owner),p4=await seedPublicScholarshipProblem(owner);await buy(translated,p4,'FULL_TRANSLATION');await aid(translated,p4,'provide','FULL_TRANSLATION');job=await submit(translated,p4);await finish(job);assert.equal(await balance(translated),101,'translation preserves first AC reward');
  });
  await t.test('a public formal AC enables free delivery without charging or creating a purchase entitlement',async()=>{
   const learner=await seedPublicScholarshipLearner(owner),question=await seedPublicScholarshipProblem(owner);
   await finish(await submit(learner,question,'samples'));
   assert.equal((await aid(learner,question,'quote')).price,8);
   await finish(await submit(learner,question));
   assert.equal((await aid(learner,question,'quote')).mode,'free');
   assert.match((await aid(learner,question,'provide')).body,/print\(5\)/);
   assert.equal(await balance(learner),104);
   assert.equal((await owner.query('SELECT 1 FROM luq_assistance_entitlements WHERE identity_id=$1',[learner.identityId])).rowCount,0);
  });
  await t.test('answer delivered while an accepted submission waits for the assistance lock is not retroactive',async()=>{
   const learner=await seedPublicScholarshipLearner(owner),question=await seedPublicScholarshipProblem(owner);await buy(learner,question);
   const blocker=await owner.connect();let jobPromise;
   try{
    await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-assistance:'||$1::text,0))",[learner.identityId]);
    jobPromise=submit(learner,question);
    let waiting=false;
    for(let attempt=0;attempt<100;attempt++){
     waiting=(await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND position('INSERT INTO school_judge_jobs' IN query)>0")).rowCount>0;
     if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,'submit must reach the server before answer delivery');
    const delivery=(await blocker.query(`INSERT INTO luq_assistance_deliveries(identity_id,subject_key,version_id,kind,language,content_id,context_type)
     VALUES($1,$2,$3,'FULL_SOLUTION','',$4,'public') RETURNING provided_at`,[learner.identityId,'problem:'+question.problemId,question.versionId,question.contentIds.FULL_SOLUTION])).rows[0];
    await blocker.query('COMMIT');const job=await jobPromise;await finish(job);
    const receipt=(await owner.query('SELECT * FROM public_luq_receipts WHERE job_id=$1',[job.id])).rows[0];
    assert.ok(+new Date(receipt.received_at)<+new Date(delivery.provided_at));assert.equal(receipt.solution_assisted,false);assert.equal(await balance(learner),96);
   }finally{await blocker.query('ROLLBACK');blocker.release();if(jobPromise)await jobPromise.catch(()=>{});}
  });
  await t.test('free solution delivery still snapshots assistance without creating a purchased right',async()=>{
   const learner=await seedPublicScholarshipLearner(owner),question=await seedPublicScholarshipProblem(owner);
   await owner.query("INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,price,rule_version,created_by) VALUES('problem',$1,'FULL_SOLUTION','paid',0,1,$2)",[question.problemId,question.authorId]);
   assert.equal((await aid(learner,question,'quote')).mode,'free');await aid(learner,question,'provide');const job=await submit(learner,question);await finish(job);assert.equal(await balance(learner),100);
   assert.equal((await owner.query('SELECT 1 FROM luq_assistance_entitlements WHERE identity_id=$1',[learner.identityId])).rowCount,0);
   assert.equal((await owner.query('SELECT solution_assisted FROM public_luq_receipts WHERE job_id=$1',[job.id])).rows[0].solution_assisted,true);
  });
  await t.test('concurrent AC, duplicate callbacks and cross-entry historical claims cannot mint twice',async()=>{
   const learner=await seedPublicScholarshipLearner(owner),question=await seedPublicScholarshipProblem(owner);await call(learner,'/practice/scholarship/me');
   const jobs=await Promise.all([1,2].map(()=>submit(learner,question)));const claimed=await Promise.all([1,2].map(()=>claimSchoolTask(worker)));assert.deepEqual(new Set(claimed.map(j=>j.id)),new Set(jobs.map(j=>j.id)));
   const result={status:'AC',score:100,total:1,passed:1,privateResults:[]};await Promise.all(claimed.map(j=>finishSchoolTask(worker,j,result)));assert.equal(await balance(learner),104);assert.equal(await finishSchoolTask(worker,claimed[0],result),false);assert.equal(await balance(learner),104);
   await owner.query("UPDATE school_judge_jobs SET result=jsonb_set(result,'{status}','\"WA\"') WHERE school_id=$1 AND id=$2",[claimed[0].school_id,claimed[0].id]);
   assert.equal(await balance(learner),104);assert.equal((await owner.query("SELECT count(*)::int n FROM luq_review_cases WHERE source_key=$1 AND reason='public_result_changed'",['public-job:'+claimed[0].id])).rows[0].n,1);
   await owner.query('SELECT luq_claim_first_ac($1,$2,$3,true,4,$4)',[learner.identityId,'problem:'+question.problemId,'legacy-entry:'+randomUUID(),'legacy']);assert.equal(await balance(learner),104);
   const older=await seedPublicScholarshipProblem(owner);await owner.query('SELECT luq_claim_first_ac($1,$2,$3,false,0,$4)',[learner.identityId,'problem:'+older.problemId,'historical:'+randomUUID(),'historical_submission']);let job=await submit(learner,older);await finish(job);assert.equal(await balance(learner),104);
   const sample=await seedPublicScholarshipProblem(owner);job=await submit(learner,sample,'samples');await finish(job);assert.equal(await balance(learner),104);assert.equal((await owner.query('SELECT * FROM public_luq_receipts WHERE job_id=$1',[job.id])).rowCount,0);
  });
  await t.test('current policies and withdrawal beat already purchased rights',async()=>{
   await owner.query("INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,rule_version,created_by) VALUES('problem',$1,'FULL_SOLUTION','disabled',1,$2)",[p.problemId,p.authorId]);
   const blocked=await aid(user,p,'quote');assert.equal(blocked.available,false);assert.equal(blocked.unlocked,true);await assert.rejects(aid(user,p,'provide'),e=>e.status===403);
   await owner.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE problem_id=$1',[p.problemId]);await assert.rejects(aid(user,p,'quote'),e=>e.status===404);
  });
  await t.test('an assigned assessment restriction blocks public aid even with a paid right',async()=>{
   const learner=await seedPublicScholarshipLearner(owner,{kind:'student'}),question=await seedPublicScholarshipProblem(owner);await buy(learner,question);
   const id=(await owner.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Restricted',$1,now()+interval '1 hour','Draft') RETURNING id",[question.authorId])).rows[0].id;
   await owner.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)',[id,question.problemId,question.versionId]);
   await owner.query('INSERT INTO assignment_participants VALUES($1,$2,false)',[id,learner.identityId]);
   await owner.query("INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,rule_version,created_by) VALUES('assignment',$1,'FULL_SOLUTION','disabled',1,$2)",[id,question.authorId]);
   await owner.query("UPDATE assignments SET state='Published' WHERE id=$1",[id]);
   assert.equal((await aid(learner,question,'quote')).available,false);await assert.rejects(aid(learner,question,'provide'),e=>e.status===403&&e.code==='ASSISTANCE_LOCKED');
  });
  await t.test('school administrators cannot enumerate or refund a personal public wallet',async()=>{
   const purchase=(await owner.query("SELECT id FROM luq_ledger WHERE identity_id=$1 AND kind='purchase' LIMIT 1",[user.identityId])).rows[0];
   const admin={id:p.authorId,roles:['admin']};
   const ledger=await handleScholarshipLedger({pool:app,user:admin,route:'/scholarship/ledger',method:'GET',url:new URL('http://unit.test/scholarship/ledger?identityId='+user.identityId)});assert.equal(ledger.body.total,0);
   await assert.rejects(handleScholarshipLedger({pool:app,user:admin,route:'/scholarship/refunds',method:'POST',body:{ledgerId:String(purchase.id),requestId:randomUUID(),reason:'outside scope'}}),e=>e.status===404);
  });
  await t.test('worker cannot read or write money, assistance or immutable receipt tables',async()=>{
   for(const table of ['luq_ledger','luq_accounts','luq_assistance_contents','luq_assistance_deliveries','public_luq_receipts','public_luq_results'])await assert.rejects(worker.query(`SELECT * FROM ${table}`),{code:'42501'});
   await assert.rejects(worker.query('SELECT luq_grant_initial($1)',[user.identityId]),{code:'42501'});
   for(const table of ['public_luq_receipts','public_luq_results'])await assert.rejects(app.query(`SELECT * FROM ${table}`),{code:'42501'});
  });
 }finally{await app?.end();await worker?.end();await owner.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});


test('public scholarship migration consumes old AC without touching money or student jobs',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async()=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(base.href),schema='public_aid_history_'+randomBytes(5).toString('hex'),scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);const owner=createPool(scoped.href);
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);
  await owner.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  await owner.query("INSERT INTO schema_migrations(name) VALUES('080_public_scholarship.sql')");await migrate(owner);
  const learner=await seedPublicScholarshipLearner(owner),question=await seedPublicScholarshipProblem(owner),pendingQuestion=await seedPublicScholarshipProblem(owner);
  const enqueue=async(p,completed)=>(await owner.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result,completed_at)
   VALUES($1,$2,$3,$4,$5,'historical-fixture','submit','public','{}',$6,$7,CASE WHEN $6='completed' THEN clock_timestamp() ELSE NULL END) RETURNING *`,[LEGACY_SCHOOL_ID,p.problemId,p.versionId,learner.id,randomUUID(),completed?'completed':'queued',completed?{status:'AC',score:100}:null])).rows[0];
  const old=await enqueue(question,true),pending=await enqueue(pendingQuestion,false);
  const money=(await owner.query('SELECT * FROM luq_ledger ORDER BY id')).rows;
  await owner.query("DELETE FROM schema_migrations WHERE name='080_public_scholarship.sql'");await migrate(owner);
  assert.deepEqual((await owner.query('SELECT * FROM luq_ledger ORDER BY id')).rows,money);
  assert.deepEqual((await owner.query('SELECT * FROM school_judge_jobs WHERE school_id=$1 AND id=$2',[LEGACY_SCHOOL_ID,old.id])).rows[0],old);
  let claim=(await owner.query('SELECT * FROM luq_first_ac_claims WHERE identity_id=$1 AND subject_key=$2',[learner.identityId,'problem:'+question.problemId])).rows[0];assert.equal(claim.reason,'historical_public_ac');assert.equal(claim.eligible,false);assert.equal(claim.ledger_id,null);
  await owner.query('SELECT luq_claim_first_ac($1,$2,$3,true,4,$4)',[learner.identityId,'problem:'+question.problemId,'later-legacy-submission','legacy']);
  await owner.query(`UPDATE school_judge_jobs SET state='completed',completed_at=clock_timestamp(),result='{"status":"AC","score":100}' WHERE school_id=$1 AND id=$2`,[LEGACY_SCHOOL_ID,pending.id]);
  claim=(await owner.query('SELECT * FROM luq_first_ac_claims WHERE identity_id=$1 AND subject_key=$2',[learner.identityId,'problem:'+pendingQuestion.problemId])).rows[0];assert.equal(claim.reason,'historical_public_submission');assert.equal(claim.eligible,false);
  assert.deepEqual((await owner.query('SELECT * FROM luq_ledger ORDER BY id')).rows,money);
 }finally{await owner.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
