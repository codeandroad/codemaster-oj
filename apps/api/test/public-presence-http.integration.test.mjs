import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool,transaction} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('public presence isolates explicitly present learners and public achievement summaries',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const connection=new URL(process.env.TEST_DATABASE_URL);
 assert.match(connection.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 assert.ok(['localhost','127.0.0.1'].includes(connection.hostname));
 const manager=createPool(connection.href),schema='public_presence_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 connection.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(connection.href);let app,runtime,worker;
 try {
  await migrate(owner);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const appUrl=new URL(connection);appUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const workerUrl=new URL(connection);workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
  runtime=createPool(appUrl.href);worker=createPool(workerUrl.href);
  const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password);
  async function account(kind,name,nickname='',useNickname=false) {
   const username='presence-'+randomBytes(5).toString('hex');
   const {rows:[identity]}=await owner.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',[kind,randomUUID(),name]);
   const {rows:[person]}=await owner.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname,leaderboard_use_nickname)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[identity.id,username,passwordHash,nickname,useNickname]);
   if(kind!=='personal')await owner.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[person.id,kind]);
   return {id:person.id,identityId:identity.id,username};
  }
  const learner=await account('personal','PRIVATE_LEGAL_NAME','PRIVATE_OPTED_OUT_NICKNAME');
  const nicknamed=await account('personal','OTHER_PRIVATE_LEGAL_NAME','Public nickname',true);
  const schoolOnly=await account('student','PRIVATE_SCHOOL_STUDENT');
  const teacher=await account('teacher','PRIVATE_TEACHER_NAME');
  const origin='http://public-presence.test';
  app=await createApiApplication({databaseUrl:appUrl.href,logger:false,
   config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  async function request(path,{auth,body,method='GET',status=200,csrf=true,requestOrigin=origin}={}) {
   const response=await fetch(base+'/api/v1'+path,{method,headers:{Origin:requestOrigin,
    ...(body!==undefined&&{'Content-Type':'application/json'}),...(auth&&{Cookie:auth.cookie,...(csrf&&{'X-CSRF-Token':auth.csrfToken})})},
   body:body===undefined?undefined:JSON.stringify(body)});
   const data=await response.json();
   assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);
   return {data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function login(person) {
   const response=await request('/auth/login',{method:'POST',body:{username:person.username,password}});
   return {cookie:response.cookie,csrfToken:response.data.csrfToken};
  }
  const first=await login(learner),second=await login(learner),other=await login(nicknamed),school=await login(schoolOnly),staff=await login(teacher);
  const heartbeat=auth=>request('/practice/presence/heartbeat',{auth,method:'POST',body:{}});
  const list=(auth=first,query='')=>request('/practice/presence'+query,{auth});
  const card=(person,auth=first,status=200)=>request('/practice/presence/students/'+person.id,{auth,status});

  await t.test('auth, CSRF, explicit context, aliases, search and multiple sessions',async()=>{
   await request('/practice/presence',{status:401});
   await request('/practice/presence/heartbeat',{method:'POST',body:{},status:401});
   await request('/practice/presence/heartbeat',{auth:first,method:'POST',body:{},csrf:false,status:403});
   await request('/practice/presence/heartbeat',{auth:first,method:'POST',body:{},requestOrigin:'https://evil.test',status:403});
   await request('/practice/presence/heartbeat',{auth:first,method:'POST',body:{accountId:schoolOnly.id},status:400});
   await request('/practice/presence/heartbeat',{auth:staff,method:'POST',body:{},status:403});
   await request('/presence/heartbeat',{auth:school,method:'POST',body:{}});
   assert.equal((await request('/presence',{auth:staff})).data.onlineCount,1);
   assert.equal((await list()).data.onlineCount,0,'a school heartbeat never opts a student into the public directory');
   await card(schoolOnly,first,404);
   await Promise.all([first,second,other].map(heartbeat));
   const found=await list();
   assert.equal(found.headers.get('cache-control'),'no-store');
   assert.deepEqual([found.data.onlineCount,found.data.total,found.data.items.length],[2,2,2]);
   const mine=found.data.items.find(item=>item.identityId===learner.id);
   assert.match(mine.displayName,/^Learner-[A-F0-9]{8}$/);
   assert.deepEqual(Object.keys(mine).sort(),['avatar','displayName','identityId']);
   assert.equal(found.data.items.find(item=>item.identityId===nicknamed.id).displayName,'Public nickname');
   assert.equal((await list(first,'?q=PUBLIC%20NICKNAME')).data.items[0].identityId,nicknamed.id);
   assert.equal((await list(first,'?q=PRIVATE')).data.total,0,'legal names and opted-out nicknames are not searchable');
   assert.equal((await list(first,'?page=2&pageSize=1')).data.items.length,1);
   assert.equal((await list(first,'?page=3&pageSize=1')).data.items.length,0);
   await request('/practice/presence?pageSize=51',{auth:first,status:400});
   await request('/practice/presence?page=0',{auth:first,status:400});
   await request('/practice/presence?q='+('x'.repeat(81)),{auth:first,status:400});
   await request('/practice/presence/students/not-an-id',{auth:first,status:400});
   await request('/practice/presence/students/'+randomUUID(),{auth:first,status:404});
   await request('/practice/presence/students/'+learner.identityId,{auth:first,status:404});
   const preview=await card(learner);
   assert.equal(preview.headers.get('cache-control'),'no-store');
   assert.equal(preview.data.student.isSelf,true);
   assert.deepEqual(preview.data.stats,{points:0,solvedProblems:0,acRate:null,scholarship:0});
   assert.equal((await card(learner,other)).data.student.isSelf,false);
   const serialized=JSON.stringify([found.data,preview.data]);
   for(const secret of [learner.identityId,learner.username,'PRIVATE_LEGAL_NAME','PRIVATE_OPTED_OUT_NICKNAME','token_hash','password'])assert.ok(!serialized.includes(secret));
   assert.equal((await owner.query('SELECT count(*)::int n FROM luq_accounts WHERE identity_id=$1',[learner.identityId])).rows[0].n,0,'read-only presence never initializes or rewards the public wallet');
  });

  const schools=(await owner.query(`INSERT INTO schools(slug,name) VALUES('presence-alpha','Private Alpha'),('presence-beta','Private Beta') RETURNING id`)).rows;
  const fixtures=[];
  for(const [index,s] of schools.entries()) {
   const fixture=await transaction(owner,async db=>{
    await db.query("SELECT set_config('campus.school_id',$1,true)",[s.id]);
    const {rows:[bank]}=await db.query(`INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id)
     VALUES($1,$2,'PRIVATE_BANK',gen_random_uuid()) RETURNING id`,[s.id,teacher.id]);
    const {rows:[problem]}=await db.query(`INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id)
     VALUES($1,$2,$3,'{"title":"PRIVATE_DRAFT"}',gen_random_uuid()) RETURNING id`,[s.id,bank.id,teacher.id]);
    const definition={title:'Public exercise '+index,referenceCode:'PRIVATE_REFERENCE',teacherNotes:'PRIVATE_NOTES',tests:[{input:'HIDDEN_INPUT',expected:'HIDDEN_EXPECTED'}]};
    const {rows:[version]}=await db.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
     VALUES($1,$2,1,$3) RETURNING id`,[s.id,problem.id,definition]);
    await db.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[s.id,problem.id,version.id]);
    await db.query(`INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by)
     VALUES($1,$2,$3,$4)`,[s.id,problem.id,version.id,teacher.id]);
    return {schoolId:s.id,bankId:bank.id,problemId:problem.id,versionId:version.id};
   });
   fixtures.push(fixture);
  }
  async function seedJob(fixture,{context='public',kind='submit',status='AC',state='completed',at,versionId=fixture.versionId,account=learner}={}) {
   return transaction(owner,async db=>{
    await db.query("SELECT set_config('campus.school_id',$1,true)",[fixture.schoolId]);
    // Admission snapshots the current ranking choice before the worker settles
    // the result, just as it does for a real submission.
    const {rows:[job]}=await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,created_at)
     VALUES($1,$2,$3,$4,gen_random_uuid(),'fixture',$5,$6,'{"code":"PRIVATE_STUDENT_CODE"}','queued',$7) RETURNING id`,
    [fixture.schoolId,fixture.problemId,versionId,account.id,kind,context,at??'2026-01-01T00:00:00Z']);
    await db.query('UPDATE school_judge_jobs SET state=$3,result=$4 WHERE school_id=$1 AND id=$2',
     [fixture.schoolId,job.id,state,{status,privateResults:['PRIVATE_RESULT']}]);
   });
  }
  await t.test('public metrics exclude school results, samples, failures and post-AC attempts',async()=>{
   await request('/practice/preferences',{auth:first,method:'PATCH',body:{rankingEnabled:true}});
   await seedJob(fixtures[0],{status:'WA',at:'2026-01-01T00:01:00Z'});
   await seedJob(fixtures[0],{at:'2026-01-01T00:02:00Z'});
   await seedJob(fixtures[0],{status:'WA',at:'2026-01-01T00:03:00Z'});
   await seedJob(fixtures[0],{at:'2026-01-01T00:04:00Z'});
   await seedJob(fixtures[1],{at:'2026-01-01T00:05:00Z'});
   for(const options of [{context:'school'},{kind:'samples'},{kind:'custom'},{status:'System Error'},{state:'failed'}])await seedJob(fixtures[1],options);
   // Fixture-only separate wallets prove the card never substitutes a school's
   // balance for the global public balance, even for an active school member.
   await owner.query("SELECT luq_post_entry($1,15,'admin_grant',$2,$3,'QA presence grant')",[learner.identityId,'presence-fixture:'+randomUUID(),teacher.id]);
   const publicBalance=(await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[learner.identityId])).rows[0].balance;
   await transaction(owner,async db=>{
    await db.query("SELECT set_config('campus.school_id',$1,true)",[schools[0].id]);
    await db.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[schools[0].id,learner.id]);
    const {rows:[identity]}=await db.query(`INSERT INTO school_identities(school_id,kind,number,name,account_id)
     VALUES($1,'student','PRIVATE_NUMBER','PRIVATE_SCHOOL_NAME',$2) RETURNING id`,[schools[0].id,learner.id]);
    await db.query("SELECT school_scholarship_entry($1,$2,987654,'admin_grant',$3,$4,'QA school-only grant')",
     [schools[0].id,identity.id,'presence-school-fixture:'+randomUUID(),teacher.id]);
   });
   const preview=(await card(learner)).data;
   assert.deepEqual(preview.stats,{points:20,solvedProblems:2,acRate:66.7,scholarship:publicBalance});
   assert.deepEqual(preview.activity.map(item=>item.problemTitle),['Public exercise 1','Public exercise 0']);
   assert.deepEqual(Object.keys(preview.activity[0]).sort(),['createdAt','id','problemTitle']);
   const rank=(await request('/practice/leaderboard',{auth:first})).data.own;
   assert.equal(preview.stats.points,rank.points);assert.equal(preview.stats.solvedProblems,rank.solved);
   for(const secret of ['PRIVATE','HIDDEN',schools[0].id,fixtures[0].versionId,'987654','referenceCode','payload','privateResults'])assert.ok(!JSON.stringify(preview).includes(secret));
   assert.equal((await runtime.query('SELECT count(*)::int n FROM school_judge_jobs')).rows[0].n,0,'runtime still cannot query another school directly');
   await assert.rejects(worker.query('SELECT public_practice_presence_stats($1)',[learner.id]),/permission denied/);
   await assert.rejects(worker.query('SELECT public_presence_seen_at FROM sessions'),/permission denied/);
  });
  await t.test('ranking choices affect the leaderboard without erasing public practice history',async()=>{
   const before=(await card(learner)).data;
   await request('/practice/preferences',{auth:first,method:'PATCH',body:{rankingEnabled:false}});
   assert.equal((await request('/practice/leaderboard',{auth:first})).data.own.points,0);
   assert.deepEqual((await card(learner)).data,before,'opting out of ranking preserves public learning activity');
   await request('/practice/preferences',{auth:first,method:'PATCH',body:{rankingEnabled:true}});
   assert.equal((await request('/practice/leaderboard',{auth:first})).data.own.points,20);

   await seedJob(fixtures[0],{account:nicknamed});
   const unranked=(await card(nicknamed)).data;
   assert.deepEqual(unranked.stats,{points:10,solvedProblems:1,acRate:100,scholarship:0});
   assert.equal(unranked.activity[0].problemTitle,'Public exercise 0');
   assert.equal((await request('/practice/leaderboard',{auth:other})).data.own.points,0);
   await request('/practice/preferences',{auth:other,method:'PATCH',body:{rankingEnabled:true}});
   assert.equal((await request('/practice/leaderboard',{auth:other})).data.own.points,0,'enabling ranking does not backfill earlier submissions');
   assert.deepEqual((await card(nicknamed)).data,unranked);
  });
  await t.test('recent activity hides withdrawn, archived and superseded editions',async()=>{
   await owner.query('UPDATE school_problem_publications SET withdrawn_at=now() WHERE problem_id=$1',[fixtures[1].problemId]);
   assert.deepEqual((await card(learner)).data.activity.map(item=>item.problemTitle),['Public exercise 0']);
   await transaction(owner,async db=>{
    const f=fixtures[0];await db.query("SELECT set_config('campus.school_id',$1,true)",[f.schoolId]);
    await db.query('UPDATE school_problem_banks SET archived=true WHERE school_id=$1 AND id=$2',[f.schoolId,f.bankId]);
   });
   assert.deepEqual((await card(learner)).data.activity,[]);
   await transaction(owner,async db=>{
    const f=fixtures[0];await db.query("SELECT set_config('campus.school_id',$1,true)",[f.schoolId]);
    await db.query('UPDATE school_problem_banks SET archived=false WHERE school_id=$1 AND id=$2',[f.schoolId,f.bankId]);
    const {rows:[next]}=await db.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
     VALUES($1,$2,2,'{"title":"PRIVATE_UNREVIEWED_EDITION"}') RETURNING id`,[f.schoolId,f.problemId]);
    await db.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[f.schoolId,f.problemId,next.id]);
   });
   assert.deepEqual((await card(learner)).data.activity,[]);
  });
  await t.test('expiry, disabled identities and logout remove presence immediately',async()=>{
   await owner.query("UPDATE sessions SET public_presence_seen_at=now()-interval '91 seconds' WHERE account_id=$1",[nicknamed.id]);
   assert.equal((await list()).data.onlineCount,1);await card(nicknamed,first,404);
   await heartbeat(other);
   await owner.query('UPDATE identities SET archived_at=now() WHERE id=$1',[nicknamed.identityId]);
   assert.equal((await list()).data.onlineCount,1);await card(nicknamed,first,404);
   await request('/practice/presence',{auth:other,status:401});
   await owner.query('UPDATE identities SET archived_at=NULL WHERE id=$1',[nicknamed.identityId]);
   await owner.query('UPDATE accounts SET disabled_at=now() WHERE id=$1',[nicknamed.id]);
   assert.equal((await list()).data.onlineCount,1);await card(nicknamed,first,404);
   await request('/auth/logout',{auth:first,method:'POST',body:{}});
   assert.equal((await list(second)).data.onlineCount,1,'another live session preserves the same learner');
   await request('/auth/logout',{auth:second,method:'POST',body:{}});
   assert.equal((await list(staff)).data.onlineCount,0);
   await card(learner,staff,404);
   await request('/practice/presence/heartbeat',{auth:second,method:'POST',body:{},status:401});
   assert.equal((await request('/presence',{auth:staff})).data.onlineCount,1,'public presence never changes school presence');
  });
 } finally {
  if(app)await app.close();if(runtime)await runtime.end();if(worker)await worker.end();
  await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
