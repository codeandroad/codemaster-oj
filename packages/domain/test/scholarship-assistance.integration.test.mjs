import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool,transaction} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleScholarshipAssistance} from '../src/scholarship-assistance.mjs';
import {postScholarshipEntry} from '../src/scholarship-ledger.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};
async function fixture(run){
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(url.pathname),'Requires a dedicated local QA database');
 const manager=createPool(url.href),schema=`luq_assistance_${randomBytes(5).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);
 try{
  await migrate(pool);
  // Keep exact-funds/insufficient-funds assertions independent of the initial
  // allowance, covered separately by luq-initial-grant.integration.test.mjs.
  await pool.query('UPDATE luq_settings SET initial_grant=0,rule_version=rule_version+1 WHERE singleton');
  const actor=async role=>{
   const identity=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[role,`${role}-${randomUUID()}`])).rows[0];
   const account=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,randomUUID(),'not-a-login-fixture'])).rows[0];
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[account.id,role]);return {id:account.id,identityId:identity.id,roles:[role]};
  };
  const teacher=await actor('teacher'),otherTeacher=await actor('teacher'),student=await actor('student'),otherStudent=await actor('student'),admin=await actor('admin');
  async function version(problemId){
   const v=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at)
    VALUES($1,'Test','stdio','Public statement',1000,128,'PRIVATE_REFERENCE','AC',clock_timestamp(),clock_timestamp(),'approved',clock_timestamp()) RETURNING id`,[problemId])).rows[0];
   return {problemId,versionId:v.id};
  }
  async function problem(){const p=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[teacher.id])).rows[0];const target=await version(p.id);await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.id,target.versionId]);return target;}
  async function call(user,route,body,method='POST'){
   const url=new URL(`http://luq.test${route}`);const result=await handleScholarshipAssistance({pool,user,route:url.pathname,url,method,body});assert.ok(result);return result.body;
  }
  async function publish(target,kind='FULL_SOLUTION',text='Published explanation\n```python\nprint(1)\n```'){
   const draft=await call(teacher,'/scholarship/contents',{...target,kind,body:text});
   await call(teacher,`/scholarship/contents/${draft.id}/publish`,{reviewed:true});return draft;
  }
  async function grant(user,amount){return transaction(pool,db=>postScholarshipEntry(db,{identityId:user.identityId,delta:amount,kind:'admin_grant',sourceKey:randomUUID(),reason:'Test grant',actorAccountId:admin.id}));}
  async function refund(user,entry){return transaction(pool,db=>postScholarshipEntry(db,{identityId:user.identityId,delta:-entry.delta,kind:'refund',sourceKey:`refund:${entry.id}`,refundOf:entry.id,reason:'Test refund',actorAccountId:admin.id}));}
  const quote=(user,target,kind='FULL_SOLUTION')=>call(user,'/scholarship/assistance/quote',{...target,kind});
  const provide=(user,target,kind='FULL_SOLUTION')=>call(user,'/scholarship/assistance/provide',{...target,kind});
  async function unlock(user,target,kind='FULL_SOLUTION',requestKey=randomUUID()){
   const q=await quote(user,target,kind);return call(user,'/scholarship/assistance/unlock',{...target,kind,requestKey,confirmedPrice:q.price,confirmedContentId:q.contentId});
  }
  async function submit(user,target){return (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','print(1)',$5,'fixture') RETURNING *`,[user.id,user.identityId,target.problemId,target.versionId,randomUUID()])).rows[0];}
  await run({pool,teacher,otherTeacher,student,otherStudent,admin,call,problem,version,publish,grant,refund,quote,provide,unlock,submit});
 }finally{await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('Luq solution credit follows the actual paid translation across versions and charges only once',options,async()=>fixture(async f=>{
 const target=await f.problem(),other=await f.problem();
 await f.publish(target,'FULL_TRANSLATION','中文题面');
 const next=await f.version(target.problemId);
 await f.publish(next);await f.publish(other);
 await f.grant(f.student,8);
 const original=await f.quote(f.student,next);
 assert.equal((await f.unlock(f.student,target,'FULL_TRANSLATION')).charged,3);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_TRANSLATION',mode:'paid',price:7});
 const discounted=await f.quote(f.student,next);
 assert.deepEqual([discounted.basePrice,discounted.translationCredit,discounted.price,discounted.balanceAfter],[8,3,5,0]);
 assert.equal((await f.quote(f.student,other)).price,8);
 assert.equal((await f.quote(f.otherStudent,next)).price,8);
 await rejects(f.call(f.student,'/scholarship/assistance/unlock',{...next,kind:'FULL_SOLUTION',requestKey:randomUUID(),
  confirmedPrice:original.price,confirmedContentId:original.contentId}),'QUOTE_CHANGED');
 const results=await Promise.all(Array.from({length:3},()=>f.unlock(f.student,next)));
 assert.equal(results.reduce((total,result)=>total+result.charged,0),5);
 assert.ok(results.every(result=>result.balance===0));
 const purchases=(await f.pool.query("SELECT id,delta,metadata FROM luq_ledger WHERE kind='purchase' ORDER BY id")).rows;
 assert.deepEqual(purchases.map(entry=>entry.delta),[-3,-5]);
 assert.equal(purchases[1].metadata.translationCreditLedgerId,purchases[0].id);
 await rejects(f.refund(f.student,purchases[0]),'LUQ_TRANSLATION_CREDIT_USED');
 assert.equal((await f.quote(f.student,next)).balance,0);
}));

test('Luq excludes refunded translations and preserves zero-charge credited unlocks with request-key replay',options,async()=>fixture(async f=>{
 const target=await f.problem(),other=await f.problem();
 await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');await f.publish(other);
 for(const user of [f.student,f.otherStudent]){
  await f.grant(user,3);await f.unlock(user,target,'FULL_TRANSLATION');
 }
 const refunded=(await f.pool.query("SELECT id,delta FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.otherStudent.identityId])).rows[0];
 await f.refund(f.otherStudent,refunded);
 assert.deepEqual([(await f.quote(f.otherStudent,target)).price,(await f.quote(f.otherStudent,target)).balance],[8,3]);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',price:2});
 const q=await f.quote(f.student,target);
 assert.deepEqual([q.price,q.translationCredit,q.mode,q.requiresConfirmation],[0,2,'paid',true]);
 await rejects(f.provide(f.student,target),'UNLOCK_REQUIRED');
 const requestKey=randomUUID();
 const first=await f.unlock(f.student,target,'FULL_SOLUTION',requestKey),replay=await f.unlock(f.student,target,'FULL_SOLUTION',requestKey);
 assert.equal(first.unlocked,true);assert.equal(first.charged,0);assert.equal(replay.entitlementId,first.entitlementId);
 await rejects(f.unlock(f.student,other,'FULL_SOLUTION',requestKey),'IDEMPOTENCY_CONFLICT');
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',price:8});
 assert.equal((await f.quote(f.student,target)).unlocked,true);assert.ok((await f.provide(f.student,target)).body);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0].n,1);
 const translation=(await f.pool.query("SELECT id,delta FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0];
 await rejects(f.refund(f.student,translation),'LUQ_TRANSLATION_CREDIT_USED');
}));

test('Luq serializes a translation refund against spending its credit',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');
 await f.grant(f.student,8);await f.unlock(f.student,target,'FULL_TRANSLATION');
 const translation=(await f.pool.query("SELECT id,delta FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0];
 const q=await f.quote(f.student,target);
 const [purchase,refund]=await Promise.allSettled([
  f.call(f.student,'/scholarship/assistance/unlock',{...target,kind:'FULL_SOLUTION',requestKey:randomUUID(),confirmedPrice:q.price,confirmedContentId:q.contentId}),
  f.refund(f.student,translation),
 ]);
 const after=await f.quote(f.student,target);
 if(purchase.status==='fulfilled'){
  assert.equal(purchase.value.charged,5);assert.equal(refund.reason?.code,'LUQ_TRANSLATION_CREDIT_USED');
  assert.equal(after.balance,0);assert.equal(after.unlocked,true);
 }else{
  assert.equal(refund.status,'fulfilled');assert.equal(purchase.reason.code,'QUOTE_CHANGED');
  assert.equal(after.balance,8);assert.equal(after.price,8);assert.equal(after.unlocked,false);
 }
}));

test('Luq reviewed assistance has no body in quotes/unlocks, exact funds and concurrent unlocks charge once',options,async()=>fixture(async f=>{
 const target=await f.problem();
 assert.equal((await f.quote(f.student,target)).available,false);
 await rejects(f.unlock(f.student,target),'ASSISTANCE_UNAVAILABLE');
 const draft=await f.call(f.teacher,'/scholarship/contents',{...target,kind:'FULL_SOLUTION',body:'APPROVED_ONLY_AFTER_REVIEW'});
 assert.equal((await f.quote(f.student,target)).available,false);
 await rejects(f.call(f.teacher,`/scholarship/contents/${draft.id}/publish`,{}),'REVIEW_REQUIRED');
 await f.call(f.teacher,`/scholarship/contents/${draft.id}/publish`,{reviewed:true});
 await rejects(f.call(f.otherTeacher,`/scholarship/contents?problemId=${target.problemId}&versionId=${target.versionId}`,undefined,'GET'),'FORBIDDEN');
 await rejects(f.call(f.student,`/scholarship/contents?problemId=${target.problemId}&versionId=${target.versionId}`,undefined,'GET'),'FORBIDDEN');
 const q=await f.quote(f.student,target);assert.equal(q.balance,0);assert.equal(q.price,8);assert.equal(JSON.stringify(q).includes('APPROVED_ONLY'),false);
 await rejects(f.unlock(f.student,target),'INSUFFICIENT_LUQ');await rejects(f.provide(f.student,target),'UNLOCK_REQUIRED');
 await f.grant(f.student,8);
 const results=await Promise.all(Array.from({length:6},()=>f.unlock(f.student,target)));
 assert.equal(results.reduce((n,r)=>n+r.charged,0),8);assert.ok(results.every(r=>r.balance===0));
 assert.equal(JSON.stringify(results).includes('APPROVED_ONLY'),false);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n,0,'purchase is not answer use');
 assert.equal((await f.submit(f.student,target)).luq_solution_assisted,false,'cancel after purchase does not consume independent-answer eligibility');
 const delivered=await f.provide(f.student,target);assert.equal(delivered.body,'APPROVED_ONLY_AFTER_REVIEW');
 assert.equal((await f.submit(f.student,target)).luq_solution_assisted,true);
 assert.equal((await f.quote(f.student,target)).price,0);
 await rejects(f.call(f.teacher,'/scholarship/contents',{...target,kind:'FULL_SOLUTION',body:'overwrite'}),'PUBLISHED_CONTENT_IMMUTABLE');
}));

test('Luq balance competition, request replay, version pinning, refund and cross-version entitlement',options,async()=>fixture(async f=>{
 const a=await f.problem(),b=await f.problem();await f.publish(a);await f.publish(b);await f.grant(f.student,8);
 const outcomes=await Promise.allSettled([f.unlock(f.student,a),f.unlock(f.student,b)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const won=outcomes[0].status==='fulfilled'?a:b,lost=won===a?b:a;
 assert.equal((await f.pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[f.student.identityId])).rows[0].balance,0);
 const next=await f.version(won.problemId);assert.equal((await f.quote(f.student,next)).available,false);
 await rejects(f.provide(f.student,next),'ASSISTANCE_UNAVAILABLE');await f.publish(next,'FULL_SOLUTION','NEW_VERSION_ONLY');
 assert.equal((await f.quote(f.student,next)).price,0);assert.equal((await f.provide(f.student,next)).body,'NEW_VERSION_ONLY');
 assert.notEqual((await f.provide(f.student,won)).body,'NEW_VERSION_ONLY');
 const purchase=(await f.pool.query("SELECT id FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0];
 await transaction(f.pool,db=>postScholarshipEntry(db,{identityId:f.student.identityId,delta:8,kind:'refund',sourceKey:`refund:${purchase.id}`,refundOf:purchase.id,actorAccountId:f.admin.id,reason:'Refund fixture'}));
 assert.equal((await f.quote(f.student,won)).unlocked,true,'refund keeps entitlement');
 const requestKey=randomUUID(),q=await f.quote(f.student,lost);
 const body={...lost,kind:'FULL_SOLUTION',requestKey,confirmedPrice:q.price,confirmedContentId:q.contentId};
 await f.call(f.student,'/scholarship/assistance/unlock',body);await f.call(f.student,'/scholarship/assistance/unlock',body);
 await rejects(f.call(f.student,'/scholarship/assistance/unlock',{...body,...won}),'IDEMPOTENCY_CONFLICT');
}));

test('Luq free task content gives no permanent entitlement, translation does not assist AC and activity policies freeze',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');
 const assignment=(await f.pool.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Learn',$1,now()+interval '1 day','Draft') RETURNING id",[f.teacher.id])).rows[0];
 await f.pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[assignment.id,target.problemId,target.versionId]);
 await f.pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,f.student.identityId]);
 for(const kind of ['FULL_SOLUTION','FULL_TRANSLATION'])await f.call(f.teacher,'/scholarship/policies',{targetType:'assignment',targetId:assignment.id,kind,mode:'free'});
 await f.pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[assignment.id]);
 const publicRules=await f.call(f.student,`/scholarship/policies?targetType=assignment&targetId=${assignment.id}`,undefined,'GET');
 assert.equal(publicRules.canManage,false);assert.equal(publicRules.frozen,true);assert.equal(publicRules.items.length,2);assert.equal(publicRules.items[0].mode,'free');
 const contextual={...target,assignmentId:assignment.id};
 assert.equal((await f.quote(f.student,contextual)).price,0);
 await f.provide(f.student,contextual,'FULL_TRANSLATION');assert.equal((await f.submit(f.student,target)).luq_solution_assisted,false);
 await f.provide(f.student,contextual);assert.equal((await f.quote(f.student,target)).price,8);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements')).rows[0].n,0);
 await rejects(f.call(f.teacher,'/scholarship/policies',{targetType:'assignment',targetId:assignment.id,kind:'FULL_SOLUTION',mode:'paid'}),'RULE_FROZEN');
 await rejects(f.quote(f.otherStudent,contextual),'NOT_FOUND');
 const usage=await f.call(f.teacher,`/scholarship/usage?targetType=assignment&targetId=${assignment.id}`,undefined,'GET');assert.equal(usage.items.length,2);
 await rejects(f.call(f.otherTeacher,`/scholarship/usage?targetType=assignment&targetId=${assignment.id}`,undefined,'GET'),'NOT_FOUND');
}));

test('Luq active exam restrictions beat balance, prior purchase, old versions and free-library entry',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.grant(f.student,8);await f.unlock(f.student,target);
 const newer=await f.version(target.problemId);await f.publish(newer);
 const exam=(await f.pool.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes,state)
  VALUES('Exam',$1,now()-interval '1 minute',now()+interval '1 hour',60,'Draft') RETURNING id`,[f.teacher.id])).rows[0];
 await f.pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[exam.id,target.problemId,newer.versionId]);
 await f.pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[exam.id,f.student.identityId]);
 await f.pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[exam.id]);
 assert.equal((await f.quote(f.student,target)).mode,'disabled');assert.equal((await f.quote(f.student,newer)).available,false);
 await rejects(f.provide(f.student,target),'ASSISTANCE_LOCKED');await rejects(f.unlock(f.student,newer),'ASSISTANCE_LOCKED');
 await f.pool.query('UPDATE timed_practices SET results_published_at=clock_timestamp() WHERE id=$1',[exam.id]);
 assert.equal((await f.quote(f.student,target)).available,true);assert.ok((await f.provide(f.student,target)).body);
}));

test('free after AC respects the student, exact version and paid activity policy',options,async()=>fixture(async f=>{
 const target=await f.problem(),newer=await f.version(target.problemId);
 await f.publish(target);await f.publish(newer);await f.publish(target,'FULL_TRANSLATION','中文题面');
 const ac=await f.submit(f.student,target);
 await f.pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[ac.id]);
 assert.equal((await f.quote(f.student,target)).mode,'free');
 assert.equal((await f.quote(f.student,newer)).mode,'paid');
 assert.equal((await f.quote(f.otherStudent,target)).mode,'paid');
 assert.equal((await f.quote(f.student,target,'FULL_TRANSLATION')).price,3);
 const {rows:[assignment]}=await f.pool.query(`INSERT INTO assignments(title,owner_account_id,due_at,state)
  VALUES('Paid policy',$1,now()+interval '1 hour','Draft') RETURNING id`,[f.teacher.id]);
 await f.pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[assignment.id,target.problemId,target.versionId]);
 await f.pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,f.student.identityId]);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'assignment',targetId:assignment.id,kind:'FULL_SOLUTION',mode:'paid'});
 await f.pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[assignment.id]);
 assert.equal((await f.quote(f.student,{...target,assignmentId:assignment.id})).mode,'paid');
 await rejects(f.provide(f.student,target),'UNLOCK_REQUIRED');
}));

test('Luq answer provision and submission share an acceptance lock; later viewing cannot revise an earlier snapshot',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'free'});
 const client=await f.pool.connect();let pending;
 try{
  await client.query('BEGIN');
  const earlier=(await client.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','print(1)',$5,'fixture') RETURNING id,luq_solution_assisted`,[f.student.id,f.student.identityId,target.problemId,target.versionId,randomUUID()])).rows[0];
  assert.equal(earlier.luq_solution_assisted,false);
  pending=f.provide(f.student,target);await client.query('COMMIT');await pending;
  assert.equal((await f.pool.query('SELECT luq_solution_assisted FROM submissions WHERE id=$1',[earlier.id])).rows[0].luq_solution_assisted,false);
  assert.equal((await f.submit(f.student,target)).luq_solution_assisted,true);
 }finally{await client.query('ROLLBACK');client.release();}
}));


test('Luq opening time beats owned access and configured zero prices do not create fake purchases',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.grant(f.student,8);await f.unlock(f.student,target);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',opensAt:new Date(Date.now()+60_000).toISOString()});
 assert.equal((await f.quote(f.student,target)).available,false);await rejects(f.provide(f.student,target),'ASSISTANCE_LOCKED');
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid'});
 await f.pool.query('UPDATE luq_settings SET solution_price=0,rule_version=rule_version+1,updated_by=$1 WHERE singleton',[f.admin.id]);
 const q=await f.quote(f.otherStudent,target);assert.equal(q.mode,'free');assert.equal(q.price,0);assert.equal(q.unlocked,false);
 await f.provide(f.otherStudent,target);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements WHERE identity_id=$1',[f.otherStudent.identityId])).rows[0].n,0);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.otherStudent.identityId])).rows[0].n,0);
}));
