import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {schoolPracticeOperation} from '../../../packages/domain/src/school-practice.mjs';
import {handleSchoolScholarship} from '../../../packages/domain/src/school-scholarship.mjs';
import {claimSchoolTask,finishSchoolTask} from '../../../packages/domain/school-worker.mjs';
import {seedPublicScholarshipLearner} from '../../../packages/domain/test/helpers/public-scholarship.mjs';

// Explicit regression boundaries for globally reviewed help on a new school's
// public exercise. This uses a disposable database, never the local pilot data.
test('public scholarship respects school assessment and submission assistance boundaries',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const connection=new URL(process.env.TEST_DATABASE_URL);
 assert.match(connection.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 assert.ok(['localhost','127.0.0.1'].includes(connection.hostname));
 const schema='public_aid_security_'+randomBytes(5).toString('hex'),manager=createPool(connection.href);
 await manager.query(`CREATE SCHEMA ${schema}`);
 connection.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(connection.href);let runtime,worker;
 try {
  await migrate(owner);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const asRole=role=>{const u=new URL(connection);u.searchParams.set('options',`-crole=${role} -csearch_path=${schema}`);return createPool(u.href);};
  runtime=asRole('campus_app');worker=asRole('campus_worker');
  async function fixture(){
   const learner=await seedPublicScholarshipLearner(owner),author=await seedPublicScholarshipLearner(owner);
   const school=(await owner.query('INSERT INTO schools(slug,name) VALUES($1,$2) RETURNING id',['review-'+randomBytes(5).toString('hex'),'Review school'])).rows[0];
   await owner.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student'),($1,$3,'school_admin')",[school.id,learner.id,author.id]);
   const identity=(await owner.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student',$2,'Learner',$3) RETURNING id",[school.id,randomUUID(),learner.id])).rows[0];
   const bank=(await owner.query("INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,'Reviewed bank',gen_random_uuid()) RETURNING id",[school.id,author.id])).rows[0];
   const definition={title:'Reviewed public problem',statement:'Print five.',mode:'stdio',comparator:'tokens',time_limit_ms:1000,memory_limit_mb:128,reference_code:'PRIVATE_REFERENCE',starter_code:'',samples:[{position:1,input:'',expected:'5'}],tests:[{position:1,input:'HIDDEN',expected:'5',weight:100}]};
   const problem=(await owner.query("INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,gen_random_uuid()) RETURNING id",[school.id,bank.id,author.id,definition])).rows[0];
   const version=(await owner.query('INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,1,$3) RETURNING id',[school.id,problem.id,definition])).rows[0];
   await owner.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[school.id,problem.id,version.id]);
   await owner.query('INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by) VALUES($1,$2,$3,$4)',[school.id,problem.id,version.id,author.id]);
   const subject=`public-school:${school.id}:problem:${problem.id}`;
   await owner.query(`INSERT INTO luq_assistance_contents(subject_key,version_id,kind,language,body,author_account_id,status,reviewer_account_id,published_at)
    VALUES($1,$2,'FULL_SOLUTION','','Reviewed solution', $3,'published',$3,clock_timestamp())`,[subject,version.id,author.id]);
   await owner.query("INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,rule_version,created_by) VALUES('problem',$1,'FULL_SOLUTION','free',1,$2)",[problem.id,author.id]);
   await owner.query(`INSERT INTO school_scholarship_contents(school_id,subject_key,version_id,kind,language,body,author_account_id,status,reviewer_account_id,published_at)
    VALUES($1,$2,$3,'FULL_SOLUTION','','Reviewed school solution',$4,'published',$4,clock_timestamp())`,[school.id,'problem:'+problem.id,version.id,author.id]);
   return {learner,author,schoolId:school.id,identityId:identity.id,problemId:problem.id,versionId:version.id};
  }
  const publicAid=async(f,action)=>{const route='/practice/luq/assistance/'+action;return(await schoolPracticeOperation({pool:runtime,user:f.learner,route,url:new URL('http://qa.test'+route),method:'POST',body:{problemId:f.problemId,versionId:f.versionId,kind:'FULL_SOLUTION'}})).body;};
  const schoolAid=async(f,action)=>{const route=`/schools/${f.schoolId}/scholarship/assistance/${action}`;return(await handleSchoolScholarship({pool:runtime,user:f.learner,route,url:new URL('http://qa.test'+route),method:'POST',body:{type:'problem',problemId:f.problemId,versionId:f.versionId,kind:'FULL_SOLUTION'}})).body;};
  async function assertPublicBlocked(f){
   let quote;
   try {quote=await publicAid(f,'quote');}catch(error){assert.equal(error.status,403);return;}
   assert.equal(quote.available,false,'school restrictions must also block the public assistance entry');
   await assert.rejects(publicAid(f,'provide'),error=>error.status===403);
  }
  async function assessment(f,{ended=false,attempt=false}={}){
   const a=(await owner.query(`INSERT INTO school_activities(school_id,owner_account_id,kind,title,state,request_id,request_hash,starts_at,ends_at,duration_minutes)
    VALUES($1,$2,'timed','Assessment','Published',gen_random_uuid(),'fixture',clock_timestamp()-interval '2 hours',clock_timestamp()+$3::interval,30) RETURNING id`,[f.schoolId,f.author.id,ended?'-1 hour':'1 hour'])).rows[0];
   await owner.query('INSERT INTO school_activity_problems(school_id,activity_id,problem_id,version_id,position,points) VALUES($1,$2,$3,$4,1,100)',[f.schoolId,a.id,f.problemId,f.versionId]);
   await owner.query('INSERT INTO school_activity_participants(school_id,activity_id,identity_id) VALUES($1,$2,$3)',[f.schoolId,a.id,f.identityId]);
   if(attempt)await owner.query("INSERT INTO school_activity_attempts(school_id,activity_id,identity_id,account_id,started_at,deadline_at) VALUES($1,$2,$3,$4,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '90 minutes')",[f.schoolId,a.id,f.identityId,f.learner.id]);
  }
  await t.test('subject-disabled help cannot be retrieved from public practice',async()=>{
   const f=await fixture();
   await owner.query("INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode) VALUES($1,'subject',$2,'FULL_SOLUTION','disabled')",[f.schoolId,'problem:'+f.problemId]);
   assert.equal((await schoolAid(f,'quote')).available,false);
   await assertPublicBlocked(f);
  });
  await t.test('a future source-school opening time also blocks free public help',async()=>{
   const f=await fixture();
   await owner.query("INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode,opens_at) VALUES($1,'subject',$2,'FULL_SOLUTION','free',clock_timestamp()+interval '1 hour')",[f.schoolId,'problem:'+f.problemId]);
   assert.equal((await schoolAid(f,'quote')).available,false);
   await assertPublicBlocked(f);
  });
  await t.test('an assigned assessment blocks help before the student starts an attempt',async()=>{
   const f=await fixture();await assessment(f);
   assert.equal((await schoolAid(f,'quote')).available,false);
   await assertPublicBlocked(f);
  });
  await t.test('an ended assessment keeps help blocked until results are published',async()=>{
   const f=await fixture();await assessment(f,{ended:true,attempt:true});
   assert.equal((await schoolAid(f,'quote')).available,false);
   await assertPublicBlocked(f);
  });
  async function submit(f,context='school'){
   const route=context==='school'?`/schools/${f.schoolId}/problems/${f.problemId}/submissions`:`/practice/problems/${f.problemId}/submissions`;
   return(await schoolPracticeOperation({pool:runtime,user:f.learner,route,url:new URL('http://qa.test'+route),method:'POST',body:{kind:'submit',code:'print(5)',requestId:randomUUID()}})).body;
  }
  async function finish(job){
   const claimed=await claimSchoolTask(worker);assert.equal(claimed.id,job.id);
   assert.equal(await finishSchoolTask(worker,claimed,{status:'AC',score:100,total:1,passed:1,privateResults:[]}),true);
  }
  async function freeSchoolContent(f){await owner.query("INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode) VALUES($1,'subject',$2,'FULL_SOLUTION','free')",[f.schoolId,'problem:'+f.problemId]);}
  await t.test('public AC enables the reviewed public solution while preserving school content policy',async()=>{
   const f=await fixture();
   await owner.query("INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,rule_version,created_by) VALUES('problem',$1,'FULL_SOLUTION','paid',2,$2)",[f.problemId,f.author.id]);
   assert.equal((await publicAid(f,'quote')).price,8);
   await finish(await submit(f,'public'));
   assert.equal((await publicAid(f,'quote')).price,0);
   assert.equal((await publicAid(f,'provide')).body,'Reviewed solution');
   assert.equal((await schoolAid(f,'quote')).price,8);
   await assessment(f);
   await assertPublicBlocked(f);
  });
  await t.test('a public solution delivery also excludes the later school submission reward',async()=>{
   const f=await fixture();assert.equal((await publicAid(f,'provide')).body,'Reviewed solution');
   const job=await submit(f);await finish(job);
   const receipt=(await owner.query('SELECT assisted FROM school_scholarship_receipts WHERE school_id=$1 AND job_id=$2',[f.schoolId,job.id])).rows[0];
   const rewarded=Number((await owner.query("SELECT count(*) AS n FROM school_scholarship_ledger WHERE school_id=$1 AND identity_id=$2 AND kind='first_ac'",[f.schoolId,f.identityId])).rows[0].n);
   assert.deepEqual({assisted:receipt.assisted,firstAcRewards:rewarded},{assisted:true,firstAcRewards:0},'public answer must be captured in the school submission assistance snapshot');
  });
  await t.test('public and school delivery during judging never revoke an earlier clean receipt',async()=>{
   const schoolFirst=await fixture();let job=await submit(schoolFirst);
   await publicAid(schoolFirst,'provide');await finish(job);
   const schoolReceipt=(await owner.query('SELECT assisted FROM school_scholarship_receipts WHERE school_id=$1 AND job_id=$2',[schoolFirst.schoolId,job.id])).rows[0];
   assert.equal(schoolReceipt.assisted,false);
   const schoolBalance=(await owner.query('SELECT balance FROM school_scholarship_accounts WHERE school_id=$1 AND identity_id=$2',[schoolFirst.schoolId,schoolFirst.identityId])).rows[0].balance;
   assert.equal(schoolBalance,104);
   const publicFirst=await fixture();await freeSchoolContent(publicFirst);await publicAid(publicFirst,'quote');
   job=await submit(publicFirst,'public');await schoolAid(publicFirst,'provide');await finish(job);
   const publicReceipt=(await owner.query('SELECT solution_assisted FROM public_luq_receipts WHERE school_id=$1 AND job_id=$2',[publicFirst.schoolId,job.id])).rows[0];
   assert.equal(publicReceipt.solution_assisted,false);
   assert.equal((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[publicFirst.learner.identityId])).rows[0].balance,104);
  });
  await t.test('an earlier school solution excludes public first-AC without merging wallets',async()=>{
   const f=await fixture();await freeSchoolContent(f);await schoolAid(f,'provide');
   await publicAid(f,'quote');const job=await submit(f,'public');await finish(job);
   const receipt=(await owner.query('SELECT solution_assisted FROM public_luq_receipts WHERE school_id=$1 AND job_id=$2',[f.schoolId,job.id])).rows[0];
   assert.equal(receipt.solution_assisted,true);
   assert.equal((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[f.learner.identityId])).rows[0].balance,100);
   assert.equal((await owner.query('SELECT balance FROM school_scholarship_accounts WHERE school_id=$1 AND identity_id=$2',[f.schoolId,f.identityId])).rows[0].balance,100);
  });
  await t.test('public free views and purchases never create school rights or spend school money',async()=>{
   const f=await fixture();await publicAid(f,'provide');
   assert.equal((await owner.query('SELECT count(*)::int n FROM luq_assistance_entitlements WHERE identity_id=$1',[f.learner.identityId])).rows[0].n,0,'free public view gives no permanent rights');
   await owner.query("INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,rule_version,created_by) VALUES('problem',$1,'FULL_SOLUTION','paid',2,$2)",[f.problemId,f.author.id]);
   const q=await publicAid(f,'quote');assert.equal(q.price,8);
   const route='/practice/luq/assistance/unlock';
   await schoolPracticeOperation({pool:runtime,user:f.learner,route,url:new URL('http://qa.test'+route),method:'POST',body:{problemId:f.problemId,versionId:f.versionId,kind:'FULL_SOLUTION',requestKey:randomUUID(),confirmedPrice:q.price,confirmedContentId:q.contentId}});
   assert.equal((await publicAid(f,'quote')).unlocked,true);
   const school=await schoolAid(f,'quote');assert.equal(school.unlocked,false);assert.equal(school.price,8);assert.equal(school.balance,100);
   assert.equal((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[f.learner.identityId])).rows[0].balance,92);
   assert.equal((await owner.query('SELECT count(*)::int n FROM school_scholarship_entitlements WHERE school_id=$1 AND identity_id=$2',[f.schoolId,f.identityId])).rows[0].n,0);
   await owner.query("INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode) VALUES($1,'subject',$2,'FULL_SOLUTION','disabled')",[f.schoolId,'problem:'+f.problemId]);
   const blocked=await publicAid(f,'quote');assert.equal(blocked.unlocked,true);assert.equal(blocked.available,false);
   await assert.rejects(publicAid(f,'provide'),error=>error.status===403);
   assert.equal((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[f.learner.identityId])).rows[0].balance,92);
  });
 } finally {await runtime?.end();await worker?.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
