import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Luq real Nest transport: role/CSRF boundary, idempotent grants, content privacy and frozen rules',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const connection=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(connection.hostname)&&/^\/campus_(qa|test)(_[a-z0-9_]+)?$/i.test(connection.pathname),'Use a dedicated local QA database');
 const manager=createPool(connection.href),schema=`luq_http_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let app;
 try{
  await migrate(pool);await migrate(pool);
  // Exercise exact spending and insufficient balances independently of the
  // one-time initial allowance, which has dedicated integration coverage.
  await pool.query('UPDATE luq_settings SET initial_grant=0,rule_version=rule_version+1 WHERE singleton');
  const password=randomBytes(32).toString('base64url'),hash=await hashPassword(password),actors={};
  for(const [name,kind] of [['admin','admin'],['teacher','teacher'],['stranger','teacher'],['student','student'],['other','student']]){
   const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0].id;
   const id=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,`luq-${name}`,hash])).rows[0].id;
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[id,kind]);actors[name]={id,identityId};
  }
  const problemId=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[actors.teacher.id])).rows[0].id;
  const versionId=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at,metadata)
   VALUES($1,'Luq boundary','stdio','Public statement',1000,64,'PRIVATE_REFERENCE_SENTINEL','AC',now(),now(),'approved',now(),$2) RETURNING id`,[problemId,{editorial:'LEGACY_EDITORIAL_SENTINEL',hints:['LEGACY_HINT_SENTINEL'],hintPolicy:'always'}])).rows[0].id;
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,versionId]);
  const assignmentId=(await pool.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Rule fixture',$1,now()+interval '1 day','Draft') RETURNING id",[actors.teacher.id])).rows[0].id;
  await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignmentId,actors.student.identityId]);
  await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[assignmentId,problemId,versionId]);
  app=await createApiApplication({databaseUrl:connection.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://luq.test',COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  function client(){let cookie='',csrf='';return async(path,{method='GET',body,expected=200,badCsrf=false}={})=>{
   const response=await fetch(`${base}/api/v1${path}`,{method,headers:{Origin:'http://luq.test',Cookie:cookie,'X-CSRF-Token':badCsrf?'invalid':csrf,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);
   assert.equal(response.headers.get('cache-control'),'no-store');
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;
   return data;
  };}
  const anonymous=client();await anonymous('/scholarship/me',{expected:401});
  await anonymous('/luq/me',{expected:401});
  for(const [name,actor] of Object.entries(actors)){actor.call=client();await actor.call('/auth/login',{method:'POST',body:{username:`luq-${name}`,password}});}
  const {admin,teacher,stranger,student,other}=actors;
  assert.equal((await student.call('/scholarship/me')).balance,0);
  assert.deepEqual(await student.call('/luq/me'),await student.call('/scholarship/me'));
  await student.call('/scholarship/ledger',{expected:403});await teacher.call('/scholarship/ledger',{expected:403});
  await student.call('/scholarship/settings',{method:'PATCH',body:{solutionPrice:0},expected:403});
  const grant={requestId:randomUUID(),identityIds:[student.identityId],amount:8,reason:'QA fixture grant'};
  await admin.call('/scholarship/grants',{method:'POST',body:grant,badCsrf:true,expected:403});
  await teacher.call('/scholarship/grants',{method:'POST',body:grant,expected:403});
  await admin.call('/scholarship/grants',{method:'POST',body:grant});await admin.call('/scholarship/grants',{method:'POST',body:grant});
  assert.equal((await student.call('/scholarship/me')).balance,8);
  const inbox=await student.call('/student-notifications');
  assert.equal(inbox.unreadCount,1,'replaying the grant does not resend the notice');
  const [notice]=inbox.items;
  assert.equal(notice.kind,'scholarship_grant');
  assert.equal(notice.amount,8);
  assert.equal(notice.reason,grant.reason);
  assert.equal((await other.call('/student-notifications')).total,0);
  await other.call(`/student-notifications/${notice.id}/read`,{method:'POST',expected:404});
  await student.call(`/student-notifications/${notice.id}/read`,{method:'POST'});
  assert.equal((await student.call('/student-notifications')).unreadCount,0);

  await admin.call('/scholarship/grants',{method:'POST',body:{...grant,amount:9},expected:409});
  assert.equal((await other.call('/scholarship/me')).balance,0);
  const input={problemId,versionId,kind:'FULL_SOLUTION',language:''};
  const details=await student.call(`/problems/${problemId}?versionId=${versionId}`);
  for(const secret of ['PRIVATE_REFERENCE_SENTINEL','LEGACY_EDITORIAL_SENTINEL','LEGACY_HINT_SENTINEL'])assert.equal(JSON.stringify(details).includes(secret),false);
  await student.call('/scholarship/contents?'+new URLSearchParams({problemId,versionId}),{expected:403});
  await stranger.call('/scholarship/contents',{method:'POST',body:{...input,body:'UNAUTHORIZED'},expected:403});
  const content=await teacher.call('/scholarship/contents',{method:'POST',body:{...input,body:'REVIEWED_SOLUTION_SENTINEL'},expected:201});
  let quote=await student.call('/scholarship/assistance/quote',{method:'POST',body:input});assert.equal(quote.available,false);
  await student.call('/scholarship/assistance/provide',{method:'POST',body:input,expected:404});
  await teacher.call(`/scholarship/contents/${content.id}/publish`,{method:'POST',body:{reviewed:true}});
  quote=await student.call('/scholarship/assistance/quote',{method:'POST',body:input});
  assert.equal(quote.price,8);assert.equal(quote.balanceAfter,0);assert.equal(JSON.stringify(quote).includes('REVIEWED_SOLUTION_SENTINEL'),false);
  await student.call('/scholarship/assistance/provide',{method:'POST',body:input,expected:403});
  const unlock={...input,requestKey:randomUUID(),confirmedPrice:8,confirmedContentId:content.id};
  await student.call('/scholarship/assistance/unlock',{method:'POST',body:{...unlock,confirmedPrice:0},expected:409});
  const bought=await student.call('/scholarship/assistance/unlock',{method:'POST',body:unlock});assert.equal(bought.balance,0);
  assert.equal(JSON.stringify(bought).includes('REVIEWED_SOLUTION_SENTINEL'),false);
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n,0,'purchase is not answer delivery');
  assert.equal((await student.call('/scholarship/assistance/provide',{method:'POST',body:input})).body,'REVIEWED_SOLUTION_SENTINEL');
  await other.call('/scholarship/assistance/provide',{method:'POST',body:input,expected:403});
  const rule={activityType:'assignment',activityId:assignmentId,amount:5,minimumAc:1,minimumScore:100,taskKind:'challenge',allowSolutionAssisted:false,expectedVersion:0};
  await stranger.call('/scholarship/reward-rules',{method:'POST',body:rule,expected:404});
  const saved=await teacher.call('/scholarship/reward-rules',{method:'POST',body:rule});assert.equal(saved.rule.version,1);
  await teacher.call('/scholarship/reward-rules',{method:'POST',body:rule,expected:409});
  await pool.query("UPDATE assignments SET state='Published',published_at=clock_timestamp() WHERE id=$1",[assignmentId]);
  const publicRule=await student.call('/scholarship/reward-rules?'+new URLSearchParams({activityType:'assignment',activityId:assignmentId}));
  assert.equal(publicRule.rule.amount,5);assert.equal(publicRule.frozen,true);
  await other.call('/scholarship/reward-rules?'+new URLSearchParams({activityType:'assignment',activityId:assignmentId}),{expected:403});
  await teacher.call('/scholarship/reward-rules',{method:'POST',body:{...rule,expectedVersion:1},expected:409});
  const oldPoints=await pool.query('SELECT count(*)::int n FROM point_ledger');assert.equal(oldPoints.rows[0].n,0,'Luq purchases never write the old points ledger');

  await t.test('a formal AC allows the owner to read reviewed content without purchasing it',async()=>{
   const before=await other.call('/scholarship/assistance/quote',{method:'POST',body:input});
   assert.equal(before.price,8);
   const {rows:[submission]}=await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,'submit','print(1)',$5,'fixture') RETURNING id`,[other.id,other.identityId,problemId,versionId,randomUUID()]);
   assert.equal((await other.call('/scholarship/assistance/quote',{method:'POST',body:input})).mode,'paid');
   await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[submission.id]);
   const free=await other.call('/scholarship/assistance/quote',{method:'POST',body:input});
   assert.deepEqual([free.mode,free.price,free.requiresConfirmation,free.body],['free',0,false,undefined]);
   const stale=await other.call('/scholarship/assistance/unlock',{method:'POST',body:{...unlock,requestKey:randomUUID()}});
   assert.equal(stale.charged,0);
   assert.equal((await other.call('/scholarship/assistance/provide',{method:'POST',body:input})).body,'REVIEWED_SOLUTION_SENTINEL');
   assert.equal((await pool.query('SELECT 1 FROM luq_assistance_entitlements WHERE identity_id=$1',[other.identityId])).rowCount,0);
  });

  await t.test('disabling a ranked account hides its identity until re-enabled',async()=>{
   const rank=async()=> (await admin.call('/points/leaderboard')).items.find(item=>item.id===other.identityId);
   const before=await rank();assert.ok(before);
   await admin.call(`/accounts/${other.id}`,{method:'PATCH',body:{disabled:true}});
   assert.equal(await rank(),undefined);
   await admin.call(`/accounts/${other.id}`,{method:'PATCH',body:{disabled:false}});
   assert.equal((await rank()).points,before.points);
  });

  await t.test('assignment completion rules save and publish atomically with their draft',async()=>{
   const rulesUrl='/scholarship/reward-rules?activityType=assignment';
   await anonymous(rulesUrl,{expected:401});
   await student.call(rulesUrl,{expected:403});
   const defaults=await teacher.call(rulesUrl);
   assert.equal(defaults.canManage,true);
   assert.equal(defaults.frozen,false);
   assert.equal(defaults.rule.requireAll,true);
   assert.equal(defaults.rule.version,0);
   assert.equal(defaults.cap,(await admin.call('/scholarship/settings')).activityRewardCap);

   const completionReward={amount:15,requireAll:true,taskKind:'challenge',allowSolutionAssisted:false,expectedVersion:0};
   const body={title:'Completion reward draft',state:'Draft',dueAt:new Date(Date.now()+3600000).toISOString(),
    problems:[{problemId,points:100,rewardPoints:3}],participants:[student.identityId],completionReward};
   await teacher.call('/assignments',{method:'POST',body,badCsrf:true,expected:403});
   await student.call('/assignments',{method:'POST',body,expected:403});
   await teacher.call('/assignments',{method:'POST',body:{...body,completionReward:{...completionReward,amount:defaults.cap+1}},expected:400});
   assert.equal((await pool.query('SELECT id FROM assignments WHERE title=$1',[body.title])).rowCount,0);

   const draft=await teacher.call('/assignments',{method:'POST',body,expected:201});
   const draftUrl=`/assignments/${draft.id}`;
   const draftRulesUrl=`${rulesUrl}&activityId=${draft.id}`;
   assert.equal(draft.completionReward.rule.amount,15);
   assert.equal(draft.completionReward.rule.requireAll,true);
   assert.equal(draft.completionReward.rule.version,1);
   assert.equal(draft.completionReward.frozen,false);
   assert.equal(draft.problems[0].rewardPoints,3);
   const change={expectedRevision:draft.editRevision,title:'Saved completion reward',completionReward:{...completionReward,amount:16,expectedVersion:1}};
   await stranger.call(draftUrl,{method:'PATCH',body:change,expected:404});
   const revised=await teacher.call(draftUrl,{method:'PATCH',body:change});
   assert.equal(revised.completionReward.rule.version,2);
   assert.equal(revised.completionReward.rule.amount,16);
   const publishUrl=`${draftUrl}/publish`;
   const incomplete=await teacher.call(publishUrl,{method:'POST',body:{expectedRevision:revised.editRevision,participants:[],
    completionReward:{...completionReward,amount:17,expectedVersion:2}},expected:409});
   assert.equal(incomplete.error.code,'INCOMPLETE');
   const fresh=await teacher.call(draftUrl);
   assert.equal(fresh.editRevision,revised.editRevision);
   assert.equal(fresh.state,'Draft');
   assert.deepEqual(fresh.participants,[student.identityId]);
   assert.deepEqual((await teacher.call(draftRulesUrl)).rule,revised.completionReward.rule);

   const concurrentEdit=await teacher.call('/scholarship/reward-rules',{method:'POST',body:{...completionReward,amount:18,
    activityType:'assignment',activityId:draft.id,expectedVersion:2}});
   assert.equal(concurrentEdit.rule.version,3);
   const stale=await teacher.call(publishUrl,{method:'POST',body:{expectedRevision:revised.editRevision,expectedCompletionRewardVersion:2},expected:409});
   assert.equal(stale.error.code,'LUQ_RULE_CONFLICT');
   assert.equal((await teacher.call(draftUrl)).state,'Draft');
   const published=await teacher.call(publishUrl,{method:'POST',body:{expectedRevision:revised.editRevision,expectedCompletionRewardVersion:3}});
   assert.equal(published.state,'Published');
   assert.equal(published.completionReward.frozen,true);
   assert.deepEqual(published.completionReward.rule,concurrentEdit.rule);
   const frozen=await teacher.call(draftUrl,{method:'PATCH',body:{expectedRevision:published.editRevision,
    completionReward:{...completionReward,expectedVersion:3}},expected:409});
   assert.equal(frozen.error.code,'LUQ_RULE_FROZEN');
   assert.deepEqual((await student.call(draftRulesUrl)).rule,concurrentEdit.rule);

   const direct=await teacher.call('/assignments',{method:'POST',body:{...body,title:'Publish with completion reward',state:'Published'},expected:201});
   assert.equal(direct.state,'Published');
   assert.equal(direct.completionReward.frozen,true);
   assert.equal(direct.completionReward.rule.amount,15);
  });
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
