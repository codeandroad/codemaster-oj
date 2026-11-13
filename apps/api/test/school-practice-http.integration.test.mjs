import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

test('school and public practice Nest transport requires scoped membership, CSRF and explicit review',{skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const url=new URL(process.env.TEST_DATABASE_URL);assert.match(url.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);const owner=createPool(url.href),schema=`practice_http_${randomBytes(5).toString('hex')}`;const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(scoped.href);let server,worker;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await migrate(pool);const grantSql=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];await pool.query(grantSql.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),hash=await hashPassword(password),users={};
  for(const name of ['admin','teacher','student','personal','platform']){const identity=randomUUID();await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$2)",[identity,name]);users[name]=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity,name,hash])).rows[0];}
  const school=await provisionSchool(pool,{slug:'http-school',name:'HTTP school',adminUsername:'admin'});
  for(const role of ['teacher','student'])await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[school.id,users[role].id,role]);
  await pool.query('INSERT INTO platform_admins(account_id) VALUES($1)',[users.platform.id]);
  const runtime=new URL(scoped);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);const workerUrl=new URL(scoped);workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);worker=createPool(workerUrl.href);
  const origin='http://practice.test';server=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});await server.listen(0,'127.0.0.1');const base=await server.getUrl();
  const request=async(path,{auth,method='GET',body,status=200,csrf=true}={})=>{const response=await fetch(`${base}/api/v1${path}`,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);return {data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};};
  const auth={};for(const name of Object.keys(users)){const login=await request('/auth/login',{method:'POST',body:{username:name,password}});auth[name]={cookie:login.cookie,csrfToken:login.data.csrfToken};assert.deepEqual(login.data.user.roles,[]);}
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_ledger')).rows[0].n,0,'registration and login must not initialize a scholarship wallet');
  const prefix=`/schools/${school.id}`;
  await request(`${prefix}/problems`,{status:401});await request(`${prefix}/problems`,{auth:auth.personal,status:404});
  await request(`${prefix}/problem-banks`,{auth:auth.teacher,method:'POST',body:{name:'Python',requestId:randomUUID()},csrf:false,status:403});
  const bank=(await request(`${prefix}/problem-banks`,{auth:auth.teacher,method:'POST',body:{name:'Python',requestId:randomUUID()},status:201})).data;
  const problem=(await request(`${prefix}/problems`,{auth:auth.teacher,method:'POST',status:201,body:{bankId:bank.id,requestId:randomUUID(),title:'Double',statement:'Return twice the integer.',mode:'function',functionName:'solve',referenceCode:'def solve(data):\n return data*2',starterCode:'def solve(data):\n pass',samples:[{input:'[2]',expected:'4'}],tests:[{input:'[937]',expected:'1874',weight:100}]}})).data;
  await request(`${prefix}/problems/${problem.id}`,{auth:auth.student,status:404});
  const validation=(await request(`${prefix}/problems/${problem.id}/validate`,{auth:auth.teacher,method:'POST',body:{expectedRevision:1,requestId:randomUUID()},status:202})).data;
  await processSchoolOne({pool:worker,judge:{judge:async()=>({status:'AC',score:100,passed:1,total:1,publicMessage:'',privateResults:[]})}});
  assert.equal((await request(`${prefix}/judge-jobs/${validation.id}`,{auth:auth.teacher})).data.status,'AC');
  const published=(await request(`${prefix}/problems/${problem.id}/publish`,{auth:auth.admin,method:'POST',body:{expectedRevision:1}})).data;
  const visible=await request(`${prefix}/problems/${problem.id}`,{auth:auth.student});assert.ok(!JSON.stringify(visible.data).includes('[937]'));assert.equal(visible.data.definition.tests,undefined);assert.equal(visible.data.definition.referenceCode,undefined);assert.match(visible.headers.get('cache-control')??'',/no-store/);
  await request('/practice/problems?page=1&q=Double',{status:401});
  assert.deepEqual((await request('/practice/problems?page=1&q=Double',{auth:auth.personal})).data,
   {items:[],page:1,query:'Double',hasMore:false});
  const requestPath = `${prefix}/problems/${problem.id}/public-request`;
  const exactVersion = { versionId: published.versionId };
  await request(requestPath,{auth:auth.teacher,method:'POST',body:exactVersion,status:403});
  await request(requestPath,{auth:auth.admin,method:'POST',body:{versionId:randomUUID()},status:409});
  await request(requestPath,{auth:auth.admin,method:'POST',body:exactVersion,csrf:false,status:403});
  assert.equal((await request(requestPath,{auth:auth.admin,method:'POST',body:exactVersion})).data.publicRequestStatus,'pending');
  await request(requestPath,{auth:auth.admin,method:'POST',body:exactVersion});
  assert.equal((await request('/platform/problem-publications',{auth:auth.platform})).data.items[0].publicRequestStatus,'pending');
  assert.equal((await request('/practice/problems',{auth:auth.personal})).data.items.length,0);
  await request(`/platform/problem-publications/${problem.id}/reject`,{auth:auth.platform,method:'POST',body:{schoolId:school.id,...exactVersion}});
  assert.equal((await request(`${prefix}/problems`,{auth:auth.admin})).data.items[0].publicRequestStatus,'rejected');
  await request(requestPath,{auth:auth.admin,method:'POST',body:exactVersion});
  await request('/platform/problem-publications',{auth:auth.platform,method:'POST',body:{schoolId:school.id,problemId:problem.id,versionId:published.versionId}});
  assert.equal((await request('/practice/problems',{auth:auth.personal})).data.items.length,1);
  for(const query of ['  dOuBLE  ', 'PYTHON', problem.id.slice(0,8)]){
   const match=(await request(`/practice/problems?${new URLSearchParams({q:query,page:'1'})}`,{auth:auth.personal})).data;
   assert.deepEqual(match.items.map(item=>item.id),[problem.id]);
   assert.equal(match.query,query.trim());assert.equal(match.hasMore,false);assert.equal(match.items[0].definition,undefined);
  }
  for(const query of ['1874','solve(data)','%','_']){
   assert.deepEqual((await request(`/practice/problems?${new URLSearchParams({q:query,page:'1'})}`,{auth:auth.personal})).data.items,[]);
  }
  await request('/practice/problems?page=0',{auth:auth.personal,status:400});
  const publicRun = (await request(`/practice/problems/${problem.id}/submissions`,{auth:auth.personal,method:'POST',body:{kind:'submit',code:'def solve(data):\n return data*2',requestId:randomUUID()},status:202})).data;
  // Submission navigation is scoped to this account and school; it never returns worker payloads.
  await request(`${prefix}/submissions`,{status:401});
  await request(`${prefix}/submissions`,{auth:auth.personal,status:404});
  await request(`${prefix}/submissions`,{auth:auth.platform,status:404});
  await request(`${prefix}/submissions?page=0`,{auth:auth.student,status:400});
  const formal=(await request(`${prefix}/problems/${problem.id}/submissions`,{auth:auth.student,method:'POST',body:{kind:'submit',code:'def solve(data):\n return 0 # private student code',requestId:randomUUID()},status:202})).data;
  await request(`${prefix}/problems/${problem.id}/submissions`,{auth:auth.student,method:'POST',body:{kind:'samples',code:'def solve(data):\n return 0',requestId:randomUUID()},status:202});
  const own=await request(`${prefix}/submissions`,{auth:auth.student});
  assert.equal(own.data.items.length,1);assert.equal(own.data.items[0].id,formal.id);assert.equal(own.data.items[0].problemId,problem.id);assert.equal(own.data.hasMore,false);
  assert.ok(!JSON.stringify(own.data).includes('private student code'));assert.ok(!JSON.stringify(own.data).includes('[937]'));assert.equal(own.data.items[0].code,undefined);assert.equal(own.data.items[0].payload,undefined);
  assert.match(own.headers.get('cache-control')??'',/no-store/);
  assert.equal((await request(`${prefix}/submissions`,{auth:auth.teacher})).data.items.length,0);
  assert.equal((await request(`${prefix}/submissions`,{auth:auth.admin})).data.items.length,0);
  const beta=await provisionSchool(pool,{slug:'http-other-school',name:'Other school',adminUsername:'platform'});
  await request(`/schools/${beta.id}/submissions`,{auth:auth.student,status:404});
  const mismatch={judge:async task=>({status:'WA',score:0,passed:0,total:1,publicMessage:'',privateResults:[{position:1,status:'WA',testId:task.tests[0].id,cpuMs:3,memoryBytes:2048,input:'SPOOFED_INPUT',expected:'SPOOFED_EXPECTED',returned:'0',stdout:'PRIVATE_STDOUT',stderr:'TEACHER_PRIVATE_NOTE'}]})};
  await processSchoolOne({pool:worker,judge:mismatch});
  await processSchoolOne({pool:worker,judge:mismatch});
  const detail=await request(`${prefix}/judge-jobs/${formal.id}`,{auth:auth.student});
  assert.equal(detail.data.id,formal.id);assert.equal(detail.data.status,'WA');
  assert.deepEqual([detail.data.versionId,detail.data.runtimeMs,detail.data.memoryKb],[published.versionId,3,2]);
  assert.match(detail.data.code,/private student code/);
  const [failed]=detail.data.caseFeedback;
  assert.deepEqual([failed.position,failed.status,failed.timeMs,failed.memoryKb],[1,'WA',3,2]);
  assert.deepEqual([failed.input,failed.output,failed.expected],['[937]','0','1874']);
  assert.match(detail.headers.get('cache-control')??'',/no-store/);
  assert.doesNotMatch(JSON.stringify(detail.data),/SPOOFED_|PRIVATE_STDOUT|TEACHER_PRIVATE_NOTE/);
  for(const viewer of ['teacher','admin','platform','personal'])await request(`${prefix}/judge-jobs/${formal.id}`,{auth:auth[viewer],status:404});
  for(const [viewer,attempts] of [['personal',1],['student',1]]){
   const {items:[row]}=(await request('/practice/problems?page=1&q=Double',{auth:auth[viewer]})).data;
   assert.equal(row.attempts,attempts);assert.equal(row.solved,false);
  }
  const publicDetail = `/practice/submissions/${school.id}/${publicRun.id}`;
  await request('/practice/submissions',{status:401});
  assert.deepEqual((await request('/practice/submissions',{auth:auth.personal})).data.items.map(job=>job.id),[publicRun.id]);
  await request('/practice/submissions?status=unknown',{auth:auth.personal,status:400});
  assert.deepEqual((await request('/practice/submissions?status=WA',{auth:auth.personal})).data.items.map(job=>job.id),[publicRun.id]);
  assert.deepEqual((await request('/practice/submissions?status=AC',{auth:auth.personal})).data.items,[]);
  assert.deepEqual((await request('/practice/submissions?status=WA',{auth:auth.student})).data.items,[]);
  assert.equal((await request('/practice/submissions',{auth:auth.student})).data.items.length,0);
  for(const path of [publicDetail,`/practice/problems/${problem.id}/submissions/${publicRun.id}`]){
   const {data}=await request(path,{auth:auth.personal});
   assert.deepEqual(data.caseFeedback,detail.data.caseFeedback);
  }
  await request(`/practice/submissions/${school.id}/${formal.id}`,{auth:auth.student,status:404});
  await request(publicDetail,{auth:auth.student,status:404});
  await request(`${publicDetail}/note`,{auth:auth.student,method:'PATCH',body:{note:'Unauthorized'},status:404});
  await request(`${publicDetail}/note`,{auth:auth.personal,method:'PATCH',body:{note:'Check the return type'},csrf:false,status:403});
  await request(`${publicDetail}/note`,{auth:auth.personal,method:'PATCH',body:{note:'Check the return type'}});
  assert.equal((await request('/practice/review-notebook',{auth:auth.personal})).data.items[0].id,publicRun.id);
  assert.deepEqual((await request('/practice/review-notebook?reviewState=needs-review',{auth:auth.personal})).data.items.map(job=>job.id),[publicRun.id]);
  assert.deepEqual((await request('/practice/review-notebook?reviewState=resolved',{auth:auth.personal})).data.items,[]);
  assert.deepEqual((await request('/practice/review-notebook?reviewState=needs-review',{auth:auth.student})).data.items,[]);
  await request('/practice/review-notebook?reviewState=unknown',{auth:auth.personal,status:400});
  await t.test('public leaderboard uses first effective AC and never includes school or private submission data',async()=>{
   await request('/practice/leaderboard',{status:401});
   await request('/practice/leaderboard?page=0',{auth:auth.personal,status:400});
   const before=await request('/practice/leaderboard',{auth:auth.personal});
   assert.match(before.headers.get('cache-control')??'',/no-store/);
   assert.deepEqual(before.data.items,[]);
   assert.equal(before.data.own.rank,null);
   assert.equal(before.data.own.attempts,0);
   assert.equal(before.data.own.acRate,null);
   assert.match(before.data.own.name,/^Learner-[0-9A-F]{8}$/);

   const accepted={status:'AC',score:100,passed:1,total:1,publicMessage:'',privateResults:[]};
   // Complete the queued school sample, then a public submission before
   // opting in. The private history should already contain the accepted solve.
   await processSchoolOne({pool:worker,judge:{judge:async()=>accepted}});
   const historical=(await request(`/practice/problems/${problem.id}/submissions`,{auth:auth.personal,method:'POST',
    body:{kind:'submit',code:'def solve(data):\n return data*2',requestId:randomUUID()},status:202})).data;
   await processSchoolOne({pool:worker,judge:{judge:async()=>accepted}});
   await request(`/practice/submissions/${school.id}/${historical.id}/note`,{auth:auth.personal,method:'PATCH',body:{note:'Accepted solution'}});
   assert.deepEqual((await request('/practice/review-notebook?reviewState=resolved',{auth:auth.personal})).data.items.map(job=>job.id),[historical.id]);
   assert.deepEqual((await request('/practice/review-notebook?reviewState=needs-review',{auth:auth.personal})).data.items.map(job=>job.id),[publicRun.id]);
   const unshared=(await request('/practice/leaderboard',{auth:auth.personal})).data;
   assert.deepEqual(unshared.progress,{solved:1,rankingEnabled:false,historyIncluded:false});
   assert.equal(unshared.own.rank,null);
   assert.deepEqual(unshared.items,[]);

   const profile=`/practice/profiles/${users.personal.id}`;
   await request(profile,{status:401});
   await request(profile,{auth:auth.student,status:404});
   assert.deepEqual((await request(profile,{auth:auth.personal})).data.profile,
    {points:0,scholarship:0,solvedProblems:1,nickname:before.data.own.name,avatar:before.data.own.avatar,isSelf:true,profileEnabled:false});
   const activity=(await request(`${profile}/activity?pageSize=5`,{auth:auth.personal})).data;
   assert.equal(activity.total,1);
   assert.deepEqual(activity.items.map(({id,problemTitle})=>[id,problemTitle]),[[historical.id,problem.title]]);
   assert.doesNotMatch(JSON.stringify(activity),/solve\(data\)|1874/);
   assert.deepEqual((await request(`${profile}/messages`,{auth:auth.personal})).data.items,[]);
   const share={method:'PATCH',body:{profileEnabled:true}};
   await request(profile,{auth:auth.personal,...share,csrf:false,status:403});
   await request(profile,{auth:auth.student,...share,status:403});
   await request(profile,{auth:auth.personal,...share});
   const visitor=(await request(profile,{auth:auth.student})).data.profile;
   assert.deepEqual(visitor,{nickname:before.data.own.name,avatar:before.data.own.avatar,isSelf:false});
   await request(`${profile}/activity`,{auth:auth.student,status:404});
   const messageBody={body:'Nice work on your public practice.'};
   await request(`${profile}/messages`,{auth:auth.personal,method:'POST',body:messageBody,status:400});
   const message=(await request(`${profile}/messages`,{auth:auth.student,method:'POST',body:messageBody,status:201})).data;
   assert.match(message.author.nickname,/^Learner-[0-9A-F]{8}$/);
   assert.equal(message.author.id,undefined);
   assert.equal((await request(`${profile}/messages`,{auth:auth.personal})).data.items[0].canDelete,true);
   await request(`${profile}/messages/${message.id}`,{auth:auth.teacher,method:'DELETE',status:403});
   await request(`${profile}/messages/${message.id}/report`,{auth:auth.personal,method:'POST',body:{reason:'other'}});
   await request('/platform/profile-message-reports',{auth:auth.admin,status:403});
   const reports=(await request('/platform/profile-message-reports',{auth:auth.platform})).data;
   assert.deepEqual(reports.items.map(report=>[report.profileAccountId,report.messageId]),[[users.personal.id,message.id]]);
   await request(profile,{auth:auth.personal,method:'PATCH',body:{profileEnabled:false}});
   await request(`${profile}/messages`,{auth:auth.student,status:404});
   assert.equal((await request(`${profile}/messages`,{auth:auth.personal})).data.total,1);
   await request(`${profile}/messages/${message.id}`,{auth:auth.platform,method:'DELETE'});
   assert.equal((await request(`${profile}/messages`,{auth:auth.personal})).data.total,0);

   for(const account of ['personal','teacher','platform']) {
    await request('/practice/preferences',{auth:auth[account],method:'PATCH',body:{rankingEnabled:true}});
   }
   const enabled=(await request('/practice/leaderboard',{auth:auth.personal})).data;
   assert.deepEqual(enabled.progress,{solved:1,rankingEnabled:true,historyIncluded:true});
   assert.deepEqual([enabled.own.rank,enabled.own.points,enabled.own.attempts],[1,10,2]);
   await request(`/practice/problems/${problem.id}/submissions`,{auth:auth.personal,method:'POST',
    body:{kind:'submit',code:'def solve(data):\n return 0',requestId:randomUUID()},status:202});
   await processSchoolOne({pool:worker,judge:{judge:async()=>({...accepted,status:'WA',score:0,passed:0})}});
   const acceptedRun=(await request(`/practice/problems/${problem.id}/submissions`,{auth:auth.personal,method:'POST',
    body:{kind:'submit',code:'def solve(data):\n return data*2',requestId:randomUUID()},status:202})).data;
   await processSchoolOne({pool:worker,judge:{judge:async()=>accepted}});
   assert.equal((await request(`/practice/submissions/${school.id}/${acceptedRun.id}`,{auth:auth.personal})).data.status,'AC');

   // Include a repeated AC on a later version, school AC, public runs and an
   // infrastructure error. None of these changes first-AC points or rate.
   const {rows:[nextVersion]}=await pool.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
    SELECT school_id,problem_id,2,definition FROM school_problem_versions WHERE id=$1 RETURNING id`,[published.versionId]);
   const seedJob=(account,access,kind,status,version=published.versionId)=>pool.query(`INSERT INTO school_judge_jobs
    (school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result)
    VALUES($1,$2,$3,$4,gen_random_uuid(),'fixture',$5,$6,'{"code":"PRIVATE_LEADERBOARD_CODE"}','completed',
     jsonb_build_object('status',$7::text,'privateResults',jsonb_build_array('HIDDEN_LEADERBOARD_CASE')))`,
    [school.id,problem.id,version,users[account].id,kind,access,status]);
   await seedJob('personal','public','submit','AC',nextVersion.id);
   await seedJob('personal','public','submit','WA',nextVersion.id);
   await seedJob('student','school','submit','AC');
   await seedJob('student','public','samples','AC');
   await seedJob('student','public','custom','AC');
   await seedJob('student','public','submit','System Error');
   await seedJob('teacher','public','submit','AC');
   await seedJob('platform','public','submit','AC');
   await request('/practice/preferences',{auth:auth.teacher,method:'PATCH',body:{rankingEnabled:true}});
   await pool.query("UPDATE accounts SET nickname='Shared Nickname',leaderboard_use_nickname=true WHERE id=$1",[users.teacher.id]);
   await pool.query("UPDATE accounts SET nickname='Private Nickname',leaderboard_use_nickname=false WHERE id=$1",[users.personal.id]);

   const ranking=(await request('/practice/leaderboard',{auth:auth.personal})).data;
   assert.equal(ranking.total,1);
   assert.equal(ranking.pointsPerSolved,10);
   assert.deepEqual(ranking.items.map(row=>row.rank),[1]);
   assert.equal(ranking.items.filter(row=>row.name==='Shared Nickname').length,0);
   assert.deepEqual(ranking.own,{...before.data.own,rank:1,points:10,solved:1,attempts:2,acRate:0.5});
   assert.deepEqual(ranking.items.filter(row=>row.isOwn),[ranking.own]);
   assert.doesNotMatch(JSON.stringify(ranking),/Private Nickname|PRIVATE_LEADERBOARD_CODE|HIDDEN_LEADERBOARD_CASE|accountId|schoolId|problemId/);

   const inactive=(await request('/practice/leaderboard',{auth:auth.student})).data.own;
   assert.equal(inactive.rank,null);
   assert.equal(inactive.attempts,0);
   assert.equal(inactive.acRate,null);
   const outsidePage=(await request('/practice/leaderboard?page=2',{auth:auth.personal})).data;
   assert.deepEqual(outsidePage.items,[]);
   assert.deepEqual(outsidePage.own,ranking.own);
   assert.equal(outsidePage.total,1);
   assert.equal(outsidePage.hasMore,false);
   await request('/practice/preferences',{auth:auth.personal,method:'PATCH',body:{rankingEnabled:false}});
   const hidden=(await request('/practice/leaderboard',{auth:auth.personal})).data;
   assert.deepEqual(hidden.items,[]);
   assert.equal(hidden.own.rank,null);
   assert.deepEqual(hidden.progress,{solved:1,rankingEnabled:false,historyIncluded:true});
   await request('/practice/preferences',{auth:auth.personal,method:'PATCH',body:{rankingEnabled:true}});
   assert.equal((await request('/practice/leaderboard',{auth:auth.personal})).data.own.points,10);
   await assert.rejects(worker.query('SELECT * FROM public_practice_leaderboard($1,1,50)',[users.personal.id]),{code:'42501'});
   await assert.rejects(worker.query('SELECT include_public_practice_rank_history($1)',[users.personal.id]),{code:'42501'});
   const app=createPool(runtime.href);
   try {
    assert.equal((await app.query('SELECT count(*)::int AS total FROM school_judge_jobs')).rows[0].total,0);
   } finally { await app.end(); }
  });
  await request(`/platform/problem-publications/${problem.id}/withdraw`,{auth:auth.platform,method:'POST',body:{schoolId:school.id,...exactVersion}});
  const retainedRank=(await request('/practice/leaderboard',{auth:auth.personal})).data.own;
  assert.equal(retainedRank.points,10);
  assert.equal(retainedRank.attempts,2);
  await request(`/practice/problems/${problem.id}`,{auth:auth.personal,status:404});
  assert.deepEqual((await request('/practice/problems?page=1&q=Double',{auth:auth.personal})).data.items,[]);
  const archivedPublicRecord = (await request(publicDetail,{auth:auth.personal})).data;
  assert.equal(archivedPublicRecord.note,'Check the return type');
  assert.deepEqual(archivedPublicRecord.caseFeedback,detail.data.caseFeedback);
  assert.doesNotMatch(JSON.stringify(archivedPublicRecord),/SPOOFED_|PRIVATE_STDOUT|TEACHER_PRIVATE_NOTE/);
  await request(`${prefix}/judge-jobs/${formal.id}`,{status:401});
  await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[beta.id,users.student.id]);
  await request(`/schools/${beta.id}/judge-jobs/${formal.id}`,{auth:auth.student,status:404});
  await request(`${prefix}/judge-jobs/${randomUUID()}`,{auth:auth.student,status:404});
  await request(`${prefix}/judge-status`,{auth:auth.student,status:403});await request(`${prefix}/judge-status`,{auth:auth.admin});
  // Generate public metadata in the disposable schema to exercise search beyond a full page.
  const seed=await pool.connect();
  try{
   await seed.query('BEGIN');
   await seed.query("SELECT set_config('campus.school_id',$1,true)",[school.id]);
   const {rows}=await seed.query(`INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id)
    SELECT $1,$2,$3,jsonb_build_object('title', CASE WHEN n=1 THEN 'Old unique result' ELSE 'Batch public title' END),gen_random_uuid()
    FROM generate_series(1,101) n RETURNING id,draft`,[school.id,bank.id,users.teacher.id]);
   for(const {id,draft} of rows){
    const {rows:[version]}=await seed.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
     VALUES($1,$2,1,$3) RETURNING id`,[school.id,id,draft]);
    await seed.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[school.id,id,version.id]);
    await seed.query(`INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by,approved_at)
     VALUES($1,$2,$3,$4,now()-CASE WHEN $5 THEN interval '1 day' ELSE interval '0' END)`,
    [school.id,id,version.id,users.platform.id,draft.title==='Old unique result']);
   }
   await seed.query('COMMIT');
  }catch(error){await seed.query('ROLLBACK');throw error;}finally{seed.release();}
  const first=(await request('/practice/problems?page=1',{auth:auth.personal})).data;
  const second=(await request('/practice/problems?page=2',{auth:auth.personal})).data;
  const third=(await request('/practice/problems?page=3',{auth:auth.personal})).data;
  const olderSearch=(await request('/practice/problems?page=1&q=unique',{auth:auth.personal})).data;
  assert.equal(first.items.length,50);assert.equal(first.hasMore,true);
  assert.equal(second.items.length,50);assert.equal(second.hasMore,true);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,100);
  assert.equal(third.items.length,1);assert.equal(third.hasMore,false);
  assert.equal(third.items[0].title,'Old unique result');
  assert.deepEqual(olderSearch.items,third.items);assert.equal(olderSearch.hasMore,false);
  assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n,0);
  assert.deepEqual((await pool.query(`SELECT a.username,l.kind,l.delta FROM luq_ledger l
   JOIN accounts a ON a.identity_id=l.identity_id ORDER BY a.username`)).rows,[],
   'ranking opt-in does not enable scholarship or initialize a wallet');
  await t.test('public workspace executes samples, custom input and formal submissions in the isolated executor', {skip:!process.env.GO_JUDGE_TEST_URL}, async()=>{
   const judge=new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'public-workspace-qa'});
   await judge.ready();
   const modes=[
    {mode:'stdio',code:'value=int(input())\nprint(value*2)',sample:'2',custom:'11',hidden:'48307',expected:'96614'},
    {mode:'function',functionName:'solve',code:'def solve(data):\n    return data*2',sample:'[2]',custom:'[11]',hidden:'[48307]',expected:'96614'},
   ];
   for(const fixture of modes){
    const p=(await request(`${prefix}/problems`,{auth:auth.teacher,method:'POST',status:201,body:{
     bankId:bank.id,requestId:randomUUID(),title:`Public executor ${fixture.mode}`,statement:'Return double the supplied integer.',
     mode:fixture.mode,functionName:fixture.functionName,referenceCode:fixture.code,
     samples:[{input:fixture.sample,expected:'4'}],tests:[{input:fixture.hidden,expected:fixture.expected,weight:100}],
    }})).data;
    const validated=(await request(`${prefix}/problems/${p.id}/validate`,{auth:auth.teacher,method:'POST',status:202,body:{expectedRevision:1,requestId:randomUUID()}})).data;
    assert.equal(await processSchoolOne({pool:worker,judge}),true);
    assert.equal((await request(`${prefix}/judge-jobs/${validated.id}`,{auth:auth.teacher})).data.status,'AC');
    const published=(await request(`${prefix}/problems/${p.id}/publish`,{auth:auth.admin,method:'POST',body:{expectedRevision:1}})).data;
    await request('/platform/problem-publications',{auth:auth.platform,method:'POST',body:{schoolId:school.id,problemId:p.id,versionId:published.versionId}});
    const run=async(kind,code,input)=>{
     const job=(await request(`/practice/problems/${p.id}/submissions`,{auth:auth.personal,method:'POST',status:202,
      body:{kind,code,input,language:'python',requestId:randomUUID()}})).data;
     assert.equal(await processSchoolOne({pool:worker,judge}),true);
     const response=await request(`/practice/problems/${p.id}/submissions/${job.id}`,{auth:auth.personal});
     assert.equal(response.data.state,'completed');assert.equal(response.data.versionId,published.versionId);
     assert.match(response.headers.get('cache-control')??'',/no-store/);
     if(response.data.status!=='WA'){
      assert.ok(!JSON.stringify(response.data).includes(fixture.hidden));
      assert.ok(!JSON.stringify(response.data).includes(fixture.expected));
     }
     return response.data;
    };
    const samples=await run('samples',fixture.code);
    assert.equal(samples.status,'AC');assert.equal(samples.caseFeedback[0].input,fixture.sample);
    assert.equal(samples.caseFeedback[0].expected,'4');assert.match(samples.caseFeedback[0].output,/4/);
    const custom=await run('custom',fixture.code,fixture.custom);
    assert.equal(custom.status,'Executed');assert.equal(custom.caseFeedback[0].input,fixture.custom);
    assert.equal(custom.caseFeedback[0].expected,undefined);assert.match(custom.caseFeedback[0].output,/22/);
    const runtimeError=await run('samples',`${fixture.mode==='function'?'def solve(data):\n    ':''}raise ValueError("public diagnostic fixture")`);
    assert.equal(runtimeError.status,'RE');assert.match(runtimeError.caseFeedback[0].stderr,/ValueError/);
    const mismatch=await run('submit',fixture.mode==='function'?'def solve(data): return 0':'print(0)');
    assert.equal(mismatch.status,'WA');
    assert.equal(mismatch.caseFeedback[0].input,fixture.hidden);
    assert.equal(mismatch.caseFeedback[0].expected,fixture.expected);
    assert.equal(mismatch.caseFeedback[0].output.trim(),'0');
    const formal=await run('submit',fixture.code);
    assert.equal(formal.status,'AC');assert.equal(formal.score,100);assert.equal(formal.caseFeedback[0].input,undefined);
    assert.equal(formal.caseFeedback[0].expected,undefined);assert.equal(formal.caseFeedback[0].output,undefined);
    assert.ok(Number.isFinite(formal.runtimeMs)&&formal.runtimeMs>=0);assert.ok(Number.isFinite(formal.memoryKb)&&formal.memoryKb>0);
    const {items:[latest]}=(await request(`/practice/problems/${p.id}/submissions`,{auth:auth.personal})).data;
    assert.equal(latest.id,formal.id);
    assert.deepEqual([latest.runtimeMs,latest.memoryKb],[formal.runtimeMs,formal.memoryKb]);
    const progress=(await request(`/practice/problems/${p.id}`,{auth:auth.personal})).data;
    assert.equal(progress.solved,true);assert.equal(progress.attempts,2);
    assert.equal((await request(`/practice/problems/${p.id}`,{auth:auth.student})).data.solved,false);
   }
  });
  await t.test('school and public course runs enforce the published language while preserving earned progress',async()=>{
   await request('/platform/problem-publications',{auth:auth.platform,method:'POST',body:{schoolId:school.id,problemId:problem.id,...exactVersion}});
   const chapter={id:randomUUID(),title:'Double',body:'Practice doubling.',problems:[{problemId:problem.id,...exactVersion}]};
   const input={title:'Programming practice',description:'Course practice',accessScope:'school',classIds:[],chapters:[chapter]};
   const created=(await request(`${prefix}/courses`,{auth:auth.teacher,method:'POST',status:201,body:{...input,requestId:randomUUID()}})).data;
   const coursePath=`${prefix}/courses/${created.id}`;
   const publish=async revision=>(await request(coursePath+'/publish',{auth:auth.teacher,method:'POST',body:{expectedRevision:revision}})).data;
   const list=async revision=>(await request('/platform/course-publications',{auth:auth.platform,method:'POST',status:201,
    body:{schoolId:school.id,courseId:created.id,revision}})).data;
   const firstEdition=await publish(created.revision);
   const listing=await list(firstEdition.revision);
   const publicCourse=`/practice/courses/${listing.id}`;
   const getCourse=async account=>(await request(publicCourse,{auth:auth[account]})).data;
   assert.equal((await getCourse('personal')).completedExercises,1);

   const edited=(await request(coursePath,{auth:auth.teacher,method:'PATCH',body:{...input,expectedRevision:firstEdition.revision,requiredLanguage:'javascript'}})).data;
   assert.equal(edited.requiredLanguage,'javascript');
   assert.equal((await request(coursePath,{auth:auth.student})).data.requiredLanguage,null);
   assert.equal((await getCourse('personal')).requiredLanguage,null);
   const secondEdition=await publish(edited.revision);
   assert.equal((await list(secondEdition.revision)).id,listing.id);
   assert.equal((await getCourse('personal')).requiredLanguage,'javascript');
   assert.equal((await getCourse('personal')).completedExercises,1,'the previously recognized Python AC remains earned');
   assert.equal((await getCourse('admin')).completedExercises,0);
   const publicProblem=(await request(`/practice/problems/${problem.id}`,{auth:auth.admin})).data;
   assert.match(publicProblem.definition.starterCodes.javascript,/function solve\(/);

   const schoolRuns=`${prefix}/problems/${problem.id}/submissions`;
   const publicRuns=`/practice/problems/${problem.id}/submissions`;
   const schoolContext={courseId:created.id,chapterId:chapter.id,...exactVersion};
   const publicContext={...schoolContext,courseId:listing.id};
   const run=(path,account,body,status)=>request(path,{auth:auth[account],method:'POST',status,
    body:{requestId:randomUUID(),kind:'submit',language:'python',code:'def solve(data): return data*2',...body}});
   for(const [path,account,context] of [[schoolRuns,'student',schoolContext],[publicRuns,'admin',publicContext]]){
    for(const kind of ['samples','custom','submit']){
     const result=await run(path,account,{...context,kind,...(kind==='custom'&&{input:'[5]'})},400);
     assert.equal(result.data.error.code,'COURSE_LANGUAGE_REQUIRED');
    }
    await run(path,account,{...context,chapterId:undefined},400);
    await run(path,account,{...context,chapterId:randomUUID()},404);
   }
   await run(schoolRuns,'personal',schoolContext,404);
   await run(schoolRuns,'student',{...schoolContext,coursePreview:true},403);
   await run(publicRuns,'admin',{...publicContext,coursePreview:true},403);
   const draft=(await request(`${prefix}/courses`,{auth:auth.teacher,method:'POST',status:201,
    body:{...input,requestId:randomUUID(),requiredLanguage:'javascript'}})).data;
   const draftContext={...schoolContext,courseId:draft.id,coursePreview:true};
   const previewMismatch=await run(schoolRuns,'teacher',draftContext,400);
   assert.equal(previewMismatch.data.error.code,'COURSE_LANGUAGE_REQUIRED');

   const accepted={status:'AC',score:100,passed:1,total:1,publicMessage:'',privateResults:[]};
   const judge=process.env.GO_JUDGE_TEST_URL
    ? new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'course-language-qa'})
    : {judge:async()=>accepted};
   const free=(await run(publicRuns,'admin',exactVersion,202)).data;
   await processSchoolOne({pool:worker,judge});
   assert.equal((await request(`${publicRuns}/${free.id}`,{auth:auth.admin})).data.status,'AC');
   assert.equal((await getCourse('admin')).completedExercises,0,'a new Python AC in free practice cannot satisfy the JavaScript requirement');
   const code='function solve(data) { return data * 2; }';
   const freeJavascript=(await run(publicRuns,'admin',{...exactVersion,language:'javascript',code},202)).data;
   await processSchoolOne({pool:worker,judge});
   assert.equal((await request(`${publicRuns}/${freeJavascript.id}`,{auth:auth.admin})).data.status,'AC');
   assert.equal((await getCourse('admin')).completedExercises,1,'a matching-language AC in free practice earns course progress');

   const scoped={...publicContext,kind:'samples',language:'javascript',code,requestId:randomUUID()};
   const result=(await run(publicRuns,'admin',scoped,202)).data;
   assert.equal((await run(publicRuns,'admin',scoped,202)).data.id,result.id);
   await run(publicRuns,'admin',{...scoped,courseId:undefined,chapterId:undefined},409);
   await processSchoolOne({pool:worker,judge});
   assert.equal((await request(`${publicRuns}/${result.id}`,{auth:auth.admin})).data.status,'AC');
   const schoolJob=(await run(schoolRuns,'student',{...schoolContext,language:'javascript',code},202)).data;
   await processSchoolOne({pool:worker,judge});
   assert.equal((await request(`${prefix}/judge-jobs/${schoolJob.id}`,{auth:auth.student})).data.status,'AC');
   const previewJob=(await run(schoolRuns,'teacher',{...draftContext,kind:'samples',language:'javascript',code},202)).data;
   await processSchoolOne({pool:worker,judge});
   assert.equal((await request(`${prefix}/judge-jobs/${previewJob.id}`,{auth:auth.teacher})).data.status,'AC');
  });
 }finally{await server?.close();await worker?.end();await pool.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.end();}
});
