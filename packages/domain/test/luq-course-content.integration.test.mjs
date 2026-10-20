import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};

async function fixture(run){
 const connection=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(connection.hostname)
  &&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(connection.pathname),
 'Requires a dedicated local QA database');
 const manager=createPool(connection.href),schema=`luq_course_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let server;
 try{
  await migrate(pool);
  const password=`fixture-${randomUUID()}`,origin='http://luq-course.test';
  await bootstrap(pool,{name:'Course QA admin',number:'LUQ-COURSE-ADMIN',username:'luq-course-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){
   let cookie='',csrf='',user;
   const send=async(path,body,method=body===undefined?'GET':'POST',status=200)=>{
    const response=await fetch(base+path,{
     method,
     headers:{Origin:origin,...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
     ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json();
    assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(data.csrfToken)csrf=data.csrfToken;
    if(data.user)user=data.user;
    return data;
   };
   return {send,get user(){return user;}};
  }
  const admin=client();
  await admin.send('/auth/login',{username:'luq-course-admin',password});
  const actors={admin};
  for(const kind of ['teacher','student']){
   const actor=client(),person=await admin.send('/people',{kind,number:`LUQ-COURSE-${kind}`,name:kind},'POST',201);
   await actor.send('/auth/register',{
    kind,number:person.person.number,name:kind,activationCode:person.activationCode,
    username:`luq-course-${kind}`,password,
   },'POST',201);
   actors[kind]=actor;
  }
  await run({pool,...actors});
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  await manager.end();
 }
}

test('course-pinned Luq solutions need exact-version reviewed content; pricing neither publishes nor bypasses an exam',options,()=>fixture(async({pool,teacher,student,admin})=>{
 const privateMarkers=['PRIVATE_REFERENCE_SENTINEL','PRIVATE_TEST_INPUT','PRIVATE_TEST_OUTPUT','PRIVATE_EDITORIAL_SENTINEL','PRIVATE_HINT_SENTINEL'];
 const input={
  title:'Course pinned problem',mode:'stdio',statement:'Print the number 1.',
  referenceCode:'# PRIVATE_REFERENCE_SENTINEL\nprint(1)',
  editorial:'PRIVATE_EDITORIAL_SENTINEL',hints:['PRIVATE_HINT_SENTINEL'],hintPolicy:'always',
  samples:[{input:'',expected:'1'}],
  tests:[{input:'PRIVATE_TEST_INPUT',expected:'PRIVATE_TEST_OUTPUT',weight:100}],
 };
 async function publishProblem(problem){
  // This fixture exercises access/content transport, not judge validation.
  await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[problem.versionId]);
  await teacher.send(`/problems/${problem.id}/publish`,{versionId:problem.versionId});
  await admin.send(`/problems/${problem.id}/rank-review`,{versionId:problem.versionId,decision:'approved'},'PATCH');
 }
 const first=await teacher.send('/problems',input,'POST',201);
 await publishProblem(first);
 const course=await teacher.send('/learning-paths',{title:'Pinned-version course'},'POST',201);
 const chapter=await teacher.send(`/learning-paths/${course.id}/chapters`,{
  title:'Practice',content:'Public lesson',problemIds:[first.id],
 },'POST',201);
 await teacher.send(`/learning-paths/${course.id}/publish`,{});
 const second=await teacher.send(`/problems/${first.id}/versions`,{...input,statement:'Print the number 2.'},'POST',201);
 await publishProblem(second);
 assert.notEqual(first.versionId,second.versionId);

 const courseView=await student.send(`/learning-paths/${course.id}`);
 const linked=courseView.chapters.find(item=>item.id===chapter.id).problems[0];
 assert.equal(linked.problemId,first.id);
 assert.equal(linked.versionId,first.versionId,'chapter retains the version selected before the problem changed');
 const oldView=await student.send(`/problems/${linked.problemId}?versionId=${linked.versionId}`);
 const currentView=await student.send(`/problems/${linked.problemId}`);
 assert.equal(oldView.versionId,first.versionId);
 assert.equal(currentView.versionId,second.versionId);
 for(const view of [courseView,oldView,currentView]){
  const serialized=JSON.stringify(view);
  for(const marker of privateMarkers)assert.equal(serialized.includes(marker),false,`${marker} must not reach student detail or course responses`);
 }
 assert.equal(Object.hasOwn(oldView,'referenceCode'),false);
 assert.equal(Object.hasOwn(oldView,'tests'),false);
 assert.equal(oldView.editorial,'');
 assert.deepEqual(oldView.hints,[]);

 // Use the same exact target sent by StudentWorkspace after the chapter link.
 const oldTarget={problemId:linked.problemId,versionId:oldView.versionId,kind:'FULL_SOLUTION'};
 const currentTarget={...oldTarget,versionId:currentView.versionId};
 const quote=target=>student.send('/luq/assistance/quote',target);
 const provide=(target,status=200)=>student.send('/luq/assistance/provide',target,'POST',status);
 const balance=async()=>Number((await pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[student.user.identityId])).rows[0].balance);
 const balanceBefore=await balance();
 const batch=await teacher.send('/luq/policies/batch-prices',{
  requestId:randomUUID(),targetType:'problem',targetIds:[linked.problemId],prices:{FULL_SOLUTION:6},
 });
 assert.equal(batch.count,1);
 assert.equal((await quote(oldTarget)).available,false,'setting a price must not publish private reference code');
 await provide(oldTarget,404);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_contents')).rows[0].n,0);
 assert.equal(await balance(),balanceBefore);

 async function draft(target,body){
  return teacher.send('/luq/contents',{...target,body},'POST',201);
 }
 async function publish(content){
  await teacher.send(`/luq/contents/${content.id}/publish`,{reviewed:true});
 }
 const currentBody='Reviewed solution for version 2 only.\n```python\nprint(2)\n```';
 const currentContent=await draft(currentTarget,currentBody);
 await publish(currentContent);
 assert.equal((await quote(currentTarget)).available,true);
 assert.equal((await quote(oldTarget)).available,false,'new-version content must not leak into a pinned older question');
 await provide(oldTarget,404);
 const oldBody='Reviewed solution for the course version.\n```python\nprint(1)\n```';
 const oldContent=await draft(oldTarget,oldBody);
 assert.equal((await quote(oldTarget)).available,false,'a draft is not a published solution');
 await teacher.send(`/luq/contents/${oldContent.id}/publish`,{},'POST',400);
 await publish(oldContent);
 const priced=await quote(oldTarget);
 assert.equal(priced.available,true);
 assert.equal(priced.price,6);
 assert.equal(priced.contentId,oldContent.id);
 assert.equal(Object.hasOwn(priced,'body'),false,'quotes contain metadata only');
 assert.equal(JSON.stringify(priced).includes('Reviewed solution for the course version.'),false);
 await provide(oldTarget,403);
 assert.equal(await balance(),balanceBefore);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n,0);
 const purchase=await student.send('/luq/assistance/unlock',{
  ...oldTarget,requestKey:randomUUID(),confirmedPrice:priced.price,confirmedContentId:priced.contentId,
 });
 assert.equal(purchase.charged,6);
 assert.equal(Object.hasOwn(purchase,'body'),false,'purchasing is separate from providing an answer');
 assert.equal(JSON.stringify(purchase).includes('Reviewed solution for the course version.'),false);
 assert.equal((await provide(oldTarget)).body,oldBody);
 assert.equal(await balance(),balanceBefore-6);
 assert.equal((await quote(currentTarget)).price,0,'permanent entitlement crosses versions, reviewed content does not');
 assert.equal((await provide(currentTarget)).body,currentBody);
 assert.equal((await pool.query("SELECT count(*)::int n FROM luq_ledger WHERE kind='purchase'")).rows[0].n,1);
 const deliveryCount=(await pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n;

 // An active exam assigned on V2 restricts the stable problem through the V1
 // course link as well, even after a previous purchase or a zero-price change.
 const exam=(await pool.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes,state)
  VALUES('Course bypass check',$1,now()-interval '1 minute',now()+interval '1 hour',60,'Draft') RETURNING id`,[teacher.user.id])).rows[0];
 await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[exam.id,first.id,second.versionId]);
 await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[exam.id,student.user.identityId]);
 await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[exam.id]);
 await teacher.send('/luq/policies/batch-prices',{
  requestId:randomUUID(),targetType:'problem',targetIds:[first.id],prices:{FULL_SOLUTION:0},
 });
 for(const target of [oldTarget,currentTarget]){
  const blocked=await quote(target);
  assert.equal(blocked.available,false);
  assert.equal(blocked.mode,'disabled');
  assert.equal(blocked.contentId,null);
  assert.equal((await provide(target,403)).error.code,'ASSISTANCE_LOCKED');
 }
 assert.equal(await balance(),balanceBefore-6);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n,deliveryCount);
 await pool.query('UPDATE timed_practices SET results_published_at=clock_timestamp() WHERE id=$1',[exam.id]);
 assert.equal((await quote(oldTarget)).available,true);
 assert.equal((await provide(oldTarget)).body,oldBody);
 assert.equal((await student.send(`/learning-paths/${course.id}`)).chapters[0].problems[0].versionId,first.versionId);
}));
