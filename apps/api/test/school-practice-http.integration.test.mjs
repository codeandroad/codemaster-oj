import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { defaultAvatarPath } from '../../../packages/domain/src/avatars.mjs';
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
  for (const table of ['student_guestbook_likes','student_guestbook_mentions','school_platform_course_adoptions']) {
   await assert.rejects(worker.query(`SELECT 1 FROM ${table} LIMIT 1`),{code:'42501'});
  }
  const origin='http://practice.test';server=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});await server.listen(0,'127.0.0.1');const base=await server.getUrl();
  const request=async(path,{auth,method='GET',body,status=200,csrf=true}={})=>{const response=await fetch(`${base}/api/v1${path}`,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);return {data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};};
  const auth={};for(const name of Object.keys(users)){const login=await request('/auth/login',{method:'POST',body:{username:name,password}});auth[name]={cookie:login.cookie,csrfToken:login.data.csrfToken};assert.deepEqual(login.data.user.roles,[]);}
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_ledger')).rows[0].n,0,'registration and login must not initialize a scholarship wallet');
  const prefix=`/schools/${school.id}`;
  await request(`${prefix}/problems`,{status:401});await request(`${prefix}/problems`,{auth:auth.personal,status:404});
  await request(`${prefix}/problem-banks`,{auth:auth.teacher,method:'POST',body:{name:'Python',requestId:randomUUID()},csrf:false,status:403});
  const bank=(await request(`${prefix}/problem-banks`,{auth:auth.teacher,method:'POST',body:{name:'Python',requestId:randomUUID()},status:201})).data;
  const problem=(await request(`${prefix}/problems`,{auth:auth.teacher,method:'POST',status:201,body:{bankId:bank.id,requestId:randomUUID(),title:'Double',statement:'Return twice the integer.',editorial:'Private author notes',hints:['Private hint'],hintPolicy:'never',source:'Teaching worksheet',mode:'function',functionName:'solve',referenceCode:'def solve(data):\n return data*2',starterCode:'def solve(data):\n pass',samples:[{input:'[2]',expected:'4'}],tests:[{input:'[937]',expected:'1874',weight:100}]}})).data;
  await request(`${prefix}/problems/${problem.id}`,{auth:auth.student,status:404});
  const validation=(await request(`${prefix}/problems/${problem.id}/validate`,{auth:auth.teacher,method:'POST',body:{expectedRevision:1,requestId:randomUUID()},status:202})).data;
  await processSchoolOne({pool:worker,judge:{judge:async()=>({status:'AC',score:100,passed:1,total:1,publicMessage:'',privateResults:[]})}});
  assert.equal((await request(`${prefix}/judge-jobs/${validation.id}`,{auth:auth.teacher})).data.status,'AC');
  const published=(await request(`${prefix}/problems/${problem.id}/publish`,{auth:auth.admin,method:'POST',body:{expectedRevision:1}})).data;
  const visible=await request(`${prefix}/problems/${problem.id}`,{auth:auth.student});assert.ok(!JSON.stringify(visible.data).includes('[937]'));assert.equal(visible.data.definition.tests,undefined);assert.equal(visible.data.definition.referenceCode,undefined);assert.match(visible.headers.get('cache-control')??'',/no-store/);
  assert.equal(problem.definition.editorial,'Private author notes');
  assert.deepEqual(problem.definition.hints,['Private hint']);
  assert.equal(problem.definition.hintPolicy,'never');
  assert.equal(problem.definition.source,'Teaching worksheet');
  assert.doesNotMatch(JSON.stringify(visible.data),/Private author notes|Private hint/);
  await t.test('editing a school draft preserves its published edition and checks revision and role',async()=>{
   const path=`${prefix}/problems/${problem.id}`;
   const {editorial,hints,hintPolicy,source,...previousFields}=problem.definition;
   const body={...previousFields,title:'Double · revised draft',expectedRevision:published.revision};
   const edited=(await request(path,{auth:auth.teacher,method:'PATCH',body})).data;
   assert.equal(edited.revision,published.revision+1);
   assert.equal(edited.versionId,published.versionId);
   assert.deepEqual(edited.definition,{...problem.definition,title:body.title});
   await request(path,{auth:auth.teacher,method:'PATCH',body,status:409});
   await request(path+'/publish',{auth:auth.teacher,method:'POST',body:{expectedRevision:edited.revision},status:403});
   assert.equal((await request(path,{auth:auth.student})).data.definition.title,problem.definition.title);
  });
  await request('/practice/problems?page=1&q=Double',{status:401});
  assert.deepEqual((await request('/practice/problems?page=1&q=Double',{auth:auth.personal})).data,
   {items:[],topics:[],filters:{topic:'',status:'',mode:'',savedOnly:false},page:1,query:'Double',hasMore:false});
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
  await t.test('personal accounts can filter native public problems without legacy school membership',async()=>{
   const filtered=(await request('/practice/problems?page=1&status=Not%20started&mode=function',{auth:auth.personal})).data;
   assert.deepEqual(filtered.items.map(item=>item.id),[problem.id]);
   assert.deepEqual(filtered.filters,{topic:'',status:'Not started',mode:'function',savedOnly:false});
   assert.deepEqual(filtered.topics,[]);
   assert.deepEqual(filtered.items[0].tags,[]);
   assert.equal(filtered.items[0].mode,'function');
   assert.equal(filtered.items[0].status,'Not started');
   for(const query of ['mode=stdio','status=AC','topic=Unpublished','savedOnly=1']){
    assert.deepEqual((await request('/practice/problems?page=1&'+query,{auth:auth.personal})).data.items,[]);
   }
   await request('/practice/problems?status=unknown',{auth:auth.personal,status:400});
   await request('/practice/problems?mode=script',{auth:auth.personal,status:400});
  });
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
  assert.deepEqual((await request('/practice/problems?page=1&status=Waiting',{auth:auth.personal})).data.items.map(item=>item.id),[problem.id]);
  assert.deepEqual((await request('/practice/problems?page=1&status=Waiting',{auth:auth.student})).data.items,[]);
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
   assert.equal(row.status,'WA');
   assert.deepEqual((await request('/practice/problems?page=1&status=WA&mode=function',{auth:auth[viewer]})).data.items.map(item=>item.id),[problem.id]);
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
  const mixed=(await request(`/practice/problems/${problem.id}/submissions?workspaceSchoolId=${school.id}`,{auth:auth.student})).data;
  assert.deepEqual(mixed.ownDetails,{[formal.id]:{scope:'school',schoolId:school.id}});
  assert.ok(mixed.items.some(row=>!row.isOwn && row.id===publicRun.id));
  const publicFeed=(await request(`/practice/problems/${problem.id}/submissions`,{auth:auth.personal})).data;
  assert.deepEqual(publicFeed.ownDetails,{[publicRun.id]:{scope:'public',schoolId:school.id}});
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
   await request(`${profile}/messages/${message.id}/report`,{auth:auth.personal,method:'POST',body:{reason:'other'},status:404});
   const reply=(await request(`${profile}/messages`,{auth:auth.personal,method:'POST',body:{body:'Thanks! 🎉',quoteId:message.id},status:201})).data;
   const replyInbox=(await request('/account-notifications',{auth:auth.student})).data.items;
   assert.equal(replyInbox[0].messageId,reply.id);
   assert.equal(replyInbox[0].interaction,'reply');
   assert.equal(replyInbox[0].practice,true);
   assert.match(replyInbox[0].authorNickname,/^Learner-/);
   assert.match((await request(`${profile}/messages/${message.id}/replies`,{auth:auth.student})).data.items[0].quote.nickname,/^Learner-/);
   assert.deepEqual((await request(`${profile}/messages/${reply.id}/like`,{auth:auth.student,method:'POST',body:{liked:true}})).data,{liked:true,likeCount:1});
   await pool.query(`INSERT INTO student_guestbook_reports(message_id,reporter_account_id,reason)
    VALUES($1,$2,'other')`,[message.id,users.personal.id]);
   await request('/platform/profile-message-reports',{auth:auth.admin,status:403});
   const reports=(await request('/platform/profile-message-reports',{auth:auth.platform})).data;
   assert.deepEqual(reports.items.map(report=>[report.profileAccountId,report.messageId]),[[users.personal.id,message.id]]);
   await request(profile,{auth:auth.personal,method:'PATCH',body:{profileEnabled:false}});
   await request(`${profile}/messages`,{auth:auth.student,status:404});
   assert.equal((await request('/account-notifications',{auth:auth.student})).data.items.some(item=>item.messageId===reply.id),false);
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
    SELECT $1,$2,$3,jsonb_build_object('title', CASE WHEN n=1 THEN 'Old unique result' ELSE 'Batch public title' END,
     'mode',CASE WHEN n=1 THEN 'function' ELSE 'stdio' END,'tags',jsonb_build_array(CASE WHEN n=1 THEN 'Tail topic' ELSE 'Batch topic' END)),gen_random_uuid()
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
  await t.test('native topic and status filters paginate all accessible rows and keep complete topic options',async()=>{
   const topics=['Batch topic','Tail topic'];
   assert.deepEqual(first.topics,topics);assert.deepEqual(second.topics,topics);assert.deepEqual(third.topics,topics);
   const tail=(await request('/practice/problems?page=1&topic=Tail%20topic&mode=function&status=Not%20started',{auth:auth.personal})).data;
   assert.deepEqual(tail.items,third.items);assert.equal(tail.hasMore,false);assert.deepEqual(tail.topics,topics);
   const secondUnstarted=(await request('/practice/problems?page=2&status=Not%20started',{auth:auth.personal})).data;
   assert.deepEqual(secondUnstarted.items,second.items);assert.equal(secondUnstarted.hasMore,true);
   const saved=(await request('/practice/problems?page=1&savedOnly=1',{auth:auth.personal})).data;
   assert.deepEqual(saved.items,[]);assert.equal(saved.hasMore,false);assert.deepEqual(saved.topics,topics);
   const impossible=(await request('/practice/problems?page=1&topic=Tail%20topic&mode=stdio',{auth:auth.personal})).data;
   assert.deepEqual(impossible.items,[]);assert.deepEqual(impossible.topics,topics);
  });
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
  await pool.query(`INSERT INTO school_identities(school_id,kind,number,name,account_id)
   VALUES($1,'student','exchange','Exchange student',$2) ON CONFLICT DO NOTHING`,[school.id,users.student.id]);
  await t.test('the school course catalog includes platform courses addressed to that school', async () => {
   const target={scope:'custom',schoolRules:[{schoolId:school.id,admissionMode:'application'}]};
   const create=async(title,audiencePolicy)=>{
    const created=(await request('/platform/courses',{auth:auth.platform,method:'POST',status:201,
     body:{requestId:randomUUID(),title,audiencePolicy,chapters:[{title:'Lesson',content:'Private lesson body'}]}})).data;
    return (await request('/platform/courses/'+created.id+'/publish',{auth:auth.platform,method:'POST',
     body:{expectedRevision:created.revision,sourceVersion:created.sourceVersion}})).data;
   };
   const assigned=await create('Catalog check · School',target);
   const global=await create('Catalog check · Global',{scope:'all'});
   const path=prefix+'/courses?includePlatform=true';
   const list=async suffix=>(await request(path+suffix,{auth:auth.student})).data;
   const combined=await list('');
   assert.ok(combined.items.length);
   assert.ok(!combined.platformCourses.some(course=>course.id===global.id));
   const row=combined.platformCourses.find(course=>course.id===assigned.id);
   assert.equal(row.admission,'apply');
   assert.equal(row.ownerScope,'platform');
   assert.ok(!JSON.stringify(row).includes('Private lesson body'));
   assert.deepEqual((await list('&q=Catalog%20check')).platformCourses.map(course=>course.id),[assigned.id]);
   assert.deepEqual((await list('&page=2')).platformCourses,[]);
   await request(path,{auth:auth.personal,status:404});
   await request('/practice/courses/'+assigned.id,{auth:auth.personal,status:404});
   const updated=(await request('/platform/courses/'+assigned.id,{auth:auth.platform,method:'PATCH',
    body:{expectedRevision:assigned.revision,sourceVersion:assigned.sourceVersion,audiencePolicy:{scope:'all'}}})).data;
   assert.ok(!(await list('')).platformCourses.some(course=>course.id===assigned.id));
   await request('/practice/courses/'+updated.id,{auth:auth.student});
  });
  await t.test('platform administrators can manage school catalog visibility independently of public admission', async () => {
   const created=(await request('/platform/courses',{auth:auth.platform,method:'POST',status:201,
    body:{requestId:randomUUID(),title:'Adopted course',audiencePolicy:{scope:'all'},
     chapters:[{title:'Lesson',content:'Shared lesson body'}]}})).data;
   const course=(await request('/platform/courses/'+created.id+'/publish',{auth:auth.platform,method:'POST',
    body:{expectedRevision:created.revision,sourceVersion:created.sourceVersion}})).data;
   const list=async schoolId=>(await request('/schools/'+schoolId+'/courses?includePlatform=true&q=Adopted%20course',
    {auth:auth.student})).data.platformCourses;
   const path='/platform/courses/'+course.id;
   const update=(state,body,options={})=>request(path,{auth:auth.platform,method:'PATCH',
    body:{expectedRevision:state.revision,sourceVersion:state.sourceVersion,...body},...options});
   assert.deepEqual(await list(school.id),[]);
   // Simulate a school already selected by the earlier data migration.
   await pool.query('INSERT INTO school_platform_course_adoptions VALUES($1,$2)',[school.id,course.id]);
   assert.deepEqual((await request(path,{auth:auth.platform})).data.catalogSchools,[{id:school.id,name:school.name}]);
   const appPool=createPool(runtime.href),app=await appPool.connect();
   try {
    await app.query("SELECT set_config('campus.account_id',$1,false)",[users.teacher.id]);
    await assert.rejects(app.query('INSERT INTO school_platform_course_adoptions VALUES($1,$2)',[beta.id,course.id]),{code:'42501'});
    assert.equal((await app.query('DELETE FROM school_platform_course_adoptions WHERE course_id=$1',[course.id])).rowCount,0);
   } finally { app.release(); await appPool.end(); }
   await update(course,{catalogSchoolIds:[]},{auth:auth.student,status:403});
   await update(course,{catalogSchoolIds:[]},{csrf:false,status:403});
   await update(course,{catalogSchoolIds:[randomUUID()]},{status:400});
   const [adopted]=await list(school.id);
   assert.equal(adopted.id,course.id);
   assert.equal(adopted.admission,'direct');
   const publicList=(await request('/practice/courses',{auth:auth.personal})).data.courses;
   assert.equal(publicList.find(item=>item.id===course.id).admission,'direct');
   const read=async(account,query='')=>(await request('/practice/courses/'+course.id+query,{auth:auth[account]})).data;
   assert.equal((await read('student','?schoolId='+school.id)).chapters[0].body,'Shared lesson body');
   assert.equal((await read('personal')).chapters[0].body,'Shared lesson body');
   assert.deepEqual(await list(beta.id),[]);
   const moved=(await update(course,{catalogSchoolIds:[beta.id]})).data;
   assert.deepEqual(moved.catalogSchools,[{id:beta.id,name:beta.name}]);
   assert.deepEqual(moved.audiencePolicy,course.audiencePolicy);
   assert.deepEqual(await list(school.id),[]);
   assert.equal((await list(beta.id))[0]?.id,course.id);
   await update(course,{catalogSchoolIds:[]},{status:409});
   const revoked=(await update(moved,{catalogSchoolIds:[]})).data;
   assert.deepEqual(revoked.catalogSchools,[]);
   assert.deepEqual(await list(beta.id),[]);
   assert.equal((await read('personal')).chapters[0].body,'Shared lesson body');
   const restored=(await update(revoked,{catalogSchoolIds:[beta.id]})).data;
   const custom={scope:'custom',schoolRules:[{schoolId:school.id,admissionMode:'direct'}],
    independentRule:{admissionMode:'direct'}};
   await update(restored,{audiencePolicy:custom,catalogSchoolIds:[beta.id]},{status:400});
   assert.equal((await list(beta.id))[0]?.id,course.id);
   const narrowed=(await update(restored,{audiencePolicy:custom})).data;
   assert.deepEqual(narrowed.catalogSchools,[]);
   assert.equal((await list(school.id))[0]?.id,course.id);
   assert.deepEqual(await list(beta.id),[]);
  });
  await t.test('supplemental school admission is an alternative to the public rule in both catalogs', async () => {
   const rules={scope:'all',allRule:{minimumPoints:1000000},schoolRules:[{schoolId:school.id,admissionMode:'direct'}]};
   const created=(await request('/platform/courses',{auth:auth.platform,method:'POST',status:201,
    body:{requestId:randomUUID(),title:'Alternative access',audiencePolicy:rules,catalogSchoolIds:[school.id],chapters:[{title:'Lesson',content:'Alternative lesson'}]}})).data;
   const path='/platform/courses/'+created.id;
   const published=(await request(path+'/publish',{auth:auth.platform,method:'POST',body:{expectedRevision:created.revision,sourceVersion:created.sourceVersion}})).data;
   const entry='/practice/courses/'+created.id;
   const schoolList=async()=>(await request(prefix+'/courses?includePlatform=true',{auth:auth.student})).data.platformCourses.find(c=>c.id===created.id);
   assert.equal((await schoolList()).admission,'direct');
   assert.equal((await request(entry+'/entry',{auth:auth.student})).data.admissionRules.length,2);
   for(const suffix of ['', '?schoolId='+school.id])assert.equal((await request(entry+suffix,{auth:auth.student})).data.chapters[0].body,'Alternative lesson');
   assert.equal((await request(entry+'/entry',{auth:auth.personal})).data.admission,'requirements');
   await request(entry,{auth:auth.personal,status:403});
   const changed=(await request(path,{auth:auth.platform,method:'PATCH',body:{expectedRevision:published.revision,sourceVersion:published.sourceVersion,
    catalogSchoolIds:[school.id],audiencePolicy:{scope:'all',allRule:{},schoolRules:[{schoolId:school.id,minimumPoints:1000000}]}}})).data;
   assert.equal((await schoolList()).admission,'direct');
   const alternatives=(await request(entry+'/entry',{auth:auth.student})).data.admissionRules;
   assert.deepEqual(alternatives.map(r=>[r.targetKind,r.granted]),[['all',true],['school',false]]);
   const removed=(await request(path,{auth:auth.platform,method:'PATCH',body:{expectedRevision:changed.revision,sourceVersion:changed.sourceVersion,catalogSchoolIds:[]}})).data;
   assert.equal(removed.audiencePolicy.schoolRules.length,0);
   assert.equal(await schoolList(),undefined);
   assert.equal((await request(entry+'/entry',{auth:auth.student})).data.admission,'direct');
  });
  await t.test('school problem discovery follows school catalog visibility and current course admission', async () => {
   const {rows:[source]}=await pool.query("INSERT INTO problems(owner_account_id,owner_scope) VALUES($1,'platform') RETURNING id",[users.platform.id]);
   const {rows:[version]}=await pool.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,
    reference_code,samples,time_limit_ms,memory_limit_mb,validation_status,course_only_published)
    VALUES($1,'Linked exercise','Print seven','stdio','tokens','print(7)','[{"input":"","expected":"7"}]',1000,128,'AC',true) RETURNING id`,[source.id]);
   await pool.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,'','7',100)",[version.id]);
   await pool.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[version.id]);
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[source.id,version.id]);
   const created=(await request('/platform/courses',{auth:auth.platform,method:'POST',status:201,body:{
    requestId:randomUUID(),title:'Scoped exercise',audiencePolicy:{scope:'all'},
    chapters:[{title:'Linked chapter',content:'Lesson',problems:[{problemId:source.id,versionId:version.id}]}],
   }})).data;
   const path='/platform/courses/'+created.id;
   let course=(await request(path+'/publish',{auth:auth.platform,method:'POST',body:{expectedRevision:created.revision,sourceVersion:created.sourceVersion}})).data;
   const change=async patch=>{course=(await request(path,{auth:auth.platform,method:'PATCH',body:{...patch,expectedRevision:course.revision,sourceVersion:course.sourceVersion}})).data;};
   const catalog=async(query='')=>(await request(prefix+'/problems?includeCourseFilters=1'+query,{auth:auth.student})).data;
   const byCourse='&courseId='+course.id;
   const context={courseId:course.id,chapterId:course.chapters[0].id};
   assert.ok(!(await catalog()).courses.some(c=>c.id===course.id));
   assert.deepEqual((await catalog(byCourse)).items,[]);
   await change({catalogSchoolIds:[school.id]});
   assert.ok((await catalog()).courses.some(c=>c.id===course.id));
   assert.deepEqual((await catalog()).items.find(p=>p.id===source.id)?.courseContext,context);
   assert.deepEqual((await catalog(byCourse)).items.map(p=>[p.id,p.versionId,p.courseContext]),[[source.id,version.id,context]]);
   const inBank=await catalog(byCourse+'&bankId='+bank.id);
   assert.ok(inBank.courses.some(c=>c.id===course.id));
   assert.deepEqual(inBank.items,[]);
   const practice='/practice/problems/'+source.id+'?'+new URLSearchParams(context);
   assert.equal((await request(practice,{auth:auth.student})).data.definition.statement,'Print seven');
   await change({audiencePolicy:{scope:'custom',schoolRules:[{schoolId:school.id,minimumPoints:1000000}]}});
   assert.ok(!(await catalog()).courses.some(c=>c.id===course.id));
   assert.deepEqual((await catalog(byCourse)).items,[]);
   await request(practice,{auth:auth.student,status:403});
  });
  await t.test('school course requirements follow the published edition, class audience and actual learner progress', async () => {
   const base=prefix+'/courses';
   const create=async(title,who)=> (await request(base,{auth:auth[who],method:'POST',status:201,body:{
    title,requestId:randomUUID(),chapters:[{id:randomUUID(),title:'Lesson',body:'Published lesson'}]}})).data;
   const publish=async(c)=> (await request(base+'/'+c.id+'/publish',{auth:auth.admin,method:'POST',body:{expectedRevision:c.revision}})).data;
   const save=(c,who,changes,status=200)=>request(base+'/'+c.id+'/admission-settings',{auth:auth[who],method:'PATCH',status,body:{
    expectedRevision:c.revision,accessScope:'school',classIds:[],...changes}});
   const first=await publish(await create('Prerequisite','admin'));
   const target=await publish(await create('Follow-up','teacher'));
   const options=(await request(base+'?view=prerequisites',{auth:auth.teacher})).data.items;
   assert.ok(options.some(c=>c.id===first.id));
   await request(base+'?view=prerequisites',{auth:auth.student,status:403});
   await save(first,'teacher',{},404);
   await save(target,'student',{},403);
   await save(target,'teacher',{prerequisiteCourseIds:[target.id]},400);
   await save(target,'teacher',{prerequisiteCourseIds:[randomUUID()]},400);
   const draft=(await save(target,'teacher',{minimumPoints:1000000,prerequisiteCourseIds:[first.id]})).data;
   await save(target,'admin',{},409);
   const targetPath=base+'/'+target.id;
   await request(targetPath,{auth:auth.student});
   let current=await publish(draft);
   const listing=(await request(prefix+'/course-admissions/'+target.id,{auth:auth.admin,method:'POST',status:201,body:{expectedRevision:current.revision}})).data;
   const publicPath='/practice/courses/'+listing.id;
   assert.equal((await request(publicPath+'/entry',{auth:auth.student})).data.admission,'requirements');
   await request(publicPath,{auth:auth.student,status:403});
   assert.equal((await request(publicPath+'/entry',{auth:auth.personal})).data.admission,'apply');
   const listed=async()=>(await request(base+'?q=Follow-up',{auth:auth.student})).data.items[0];
   assert.equal((await listed()).requirements.met,false);
   assert.equal((await listed()).chapters,undefined);
   await request(targetPath,{auth:auth.student,status:404});
   await request(targetPath+'/chapters/'+target.chapters[0].id+'/read',{auth:auth.student,method:'POST',body:{expectedRevision:current.revision,read:true},status:404});
   await save(first,'admin',{prerequisiteCourseIds:[target.id]},400);
   await request(base+'/'+first.id+'/chapters/'+first.chapters[0].id+'/read',{auth:auth.student,method:'POST',body:{expectedRevision:first.revision,read:true}});
   assert.equal((await listed()).requirements.prerequisites[0].completed,true);
   await request(targetPath,{auth:auth.student,status:404});
   current=await publish((await save(current,'admin',{minimumPoints:0})).data);
   assert.equal((await request(targetPath,{auth:auth.student})).data.chapters[0].body,'Published lesson');
   const cl=(await request(prefix+'/classes',{auth:auth.admin,method:'POST',status:201,body:{requestId:randomUUID(),name:'Restricted course class',type:'administrative'}})).data;
   await publish((await save(current,'admin',{accessScope:'classes',classIds:[cl.id]})).data);
   await request(targetPath,{auth:auth.student,status:404});
  });
  await t.test('school leaderboard preserves the default and saved avatars', async () => {
   const path=prefix+'/leaderboard';
   const read=async()=>(await request(path,{auth:auth.student})).data.items.find(item=>item.isOwn);
   const initial=await read();
   assert.ok(initial);
   assert.equal(initial.avatar,defaultAvatarPath(initial.identityId));
   const preset='/avatars/oj-15.webp';
   await pool.query('UPDATE accounts SET avatar=$2 WHERE id=$1',[users.student.id,preset]);
   assert.equal((await read()).avatar,preset);
   const upload='data:image/png;base64,iVBORw0KGgo=';
   await pool.query('UPDATE accounts SET avatar=$2 WHERE id=$1',[users.student.id,upload]);
   assert.equal((await read()).avatar,upload);
  });
  await t.test('wallet exchange is atomic, scoped to the student, and safe to retry', async () => {
   const exchange=(body,options={})=>request(prefix+'/scholarship/exchange',{auth:auth.student,method:'POST',body,...options});
   const wallet=async path=>(await request(path+'/scholarship/me',{auth:auth.student})).data;
   const schoolBefore=await wallet(prefix),platformBefore=await wallet('/practice');
   const out={direction:'to_platform',amount:3,requestId:randomUUID()};
   await exchange(out,{csrf:false,status:403});
   await exchange(out,{auth:auth.personal,status:404});
   await exchange(out,{auth:auth.teacher,status:403});
   await exchange({...out,amount:0},{status:400});
   await Promise.all([exchange(out),exchange(out)]);
   await exchange({...out,amount:4},{status:409});
   const local=await wallet(prefix),platform=await wallet('/practice');
   assert.equal(local.balance,schoolBefore.balance-3);
   assert.equal(platform.balance,platformBefore.balance+3);
   assert.equal(local.total,schoolBefore.total+1);
   assert.equal(platform.total,platformBefore.total+1);
   await exchange({...out,amount:local.balance+1,requestId:randomUUID()},{status:409});
   assert.equal((await wallet('/practice')).total,platform.total);
   await exchange({direction:'to_school',amount:3,requestId:randomUUID()});
   assert.equal((await wallet(prefix)).balance,schoolBefore.balance);
   assert.equal((await wallet('/practice')).balance,platformBefore.balance);
  });
 }finally{await server?.close();await worker?.end();await pool.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.end();}
});
