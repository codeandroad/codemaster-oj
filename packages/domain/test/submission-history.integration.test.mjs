import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';

test('complete formal progress and keyset history preserve ownership and timed feedback masking',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async t=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`history_${randomBytes(6).toString('hex')}`;await manager.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);let server;
 try{
  await migrate(pool);await bootstrap(pool,{name:'历史测试管理员',number:'ADMIN',username:'history-admin',password:'History-test-2026!'});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:'history-test-session-secret-at-least-32-bytes',APP_ORIGIN:'http://history.test',COOKIE_SECURE:'false'})));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='';return async(path,body,method=body===undefined?'GET':'POST',expected=200)=>{const response=await fetch(base+path,{method,headers:{Origin:'http://history.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;return data;};}
  const admin=client(),teacher=client(),student=client(),other=client();await admin('/auth/login',{username:'history-admin',password:'History-test-2026!'});
  async function member(kind,number,name,username,actor){const person=await admin('/people',{kind,number,name},'POST',201);const {user}=await actor('/auth/register',{kind,number,name,username,password:'History-test-2026!',activationCode:person.activationCode},'POST',201);return user;}
  const staff=await member('teacher','T1','教师','history-teacher',teacher),learner=await member('student','S1','学生','history-student',student),outsider=await member('student','S2','其他学生','history-other',other);
  const cls=await admin('/classes',{name:'历史验证班级',teacherIds:[staff.identityId],studentIds:[learner.identityId]},'POST',201);
  async function problem(title,bankId){const row=(await pool.query(`INSERT INTO problems(owner_account_id,bank_id) VALUES($1,COALESCE($2::uuid,'00000000-0000-4000-8000-000000000001')) RETURNING id`,[staff.id,bankId||null])).rows[0];const version=(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at) VALUES($1,$2,'stdio','输出一',1000,64,'print(1)','AC',now()) RETURNING id",[row.id,title])).rows[0];await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[version.id,row.id]);return {id:row.id,versionId:version.id};}
  const p1=await problem('旧正式记录'),p2=await problem('多页同时间记录');
  const formal=await student('/submissions',{problemId:p1.id,kind:'submit',code:'print(0)',idempotencyKey:randomUUID()},'POST',201);await pool.query("UPDATE submissions SET status='WA',score=75 WHERE id=$1",[formal.id.slice(3)]);
  const correction=await student('/submissions',{problemId:p1.id,kind:'correction',originalSubmissionId:formal.id,code:'print(1)',idempotencyKey:randomUUID()},'POST',201);await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[correction.id.slice(3)]);
  await pool.query("INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score,created_at) SELECT $1,$2,$3,$4,CASE WHEN n%2=0 THEN 'samples' ELSE 'custom' END,'print(1)','self-'||n,'fixture',CASE WHEN n%2=0 THEN 'AC' ELSE 'Executed' END,CASE WHEN n%2=0 THEN 100 ELSE NULL END,clock_timestamp()+n*interval '1 second' FROM generate_series(1,230) n",[learner.id,learner.identityId,p1.id,p1.versionId]);
  await pool.query("INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score,created_at) SELECT $1,$2,$3,$4,'submit','print(0)','formal-'||n,'fixture','WA',50,'2020-01-01T00:00:00.123456Z'::timestamptz FROM generate_series(1,240) n",[learner.id,learner.identityId,p2.id,p2.versionId]);
  await pool.query("INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score) VALUES($1,$2,$3,$4,'submit','print(1)','outsider-formal','fixture','AC',100)",[outsider.id,outsider.identityId,p1.id,p1.versionId]);
  await t.test('self-tests and independent corrections cannot erase or inflate original formal progress',async()=>{
   assert.equal((await student('/submissions')).items.some(sub=>sub.kind==='submit'||sub.kind==='correction'),false);
   const progress=(await student('/problems')).items.find(problem=>problem.id===p1.id).ownProgress;
   assert.equal(progress.status,'WA');assert.equal(progress.bestScore,75);assert.equal(progress.formalCount,1);assert.equal(progress.lastSubmissionId,formal.id);
   const history=await student(`/submissions?kind=submit,correction&problemId=${p1.id}&limit=50`);assert.deepEqual(history.items.map(sub=>sub.id),[correction.id,formal.id]);assert.equal(history.nextCursor,null);
   assert.equal((await student(`/submissions?kind=submit&context=practice&problemId=${p1.id}`)).items[0].id,formal.id);
   assert.equal((await student(`/submissions?kind=submit,correction&context=correction&problemId=${p1.id}`)).items[0].id,correction.id);
   assert.equal((await other('/problems')).items.find(problem=>problem.id===p2.id).ownProgress.status,'NotStarted');
   assert.equal((await student(`/submissions?kind=submit&identityId=${outsider.identityId}`)).items.length,0);
  });
  await t.test('filtered keyset pagination preserves every formal row and precise timestamp ties',async()=>{
   const query=`/submissions?kind=submit&problemId=${p2.id}&context=practice&limit=50`,seen=[];let cursor=null,firstCursor=null;
   do{const page=await student(query+(cursor?`&cursor=${encodeURIComponent(cursor)}`:''));seen.push(...page.items.map(sub=>sub.id));cursor=page.nextCursor;if(!firstCursor)firstCursor=cursor;}while(cursor);
   assert.equal(seen.length,240);assert.equal(new Set(seen).size,240);
   assert.equal((await student('/problems')).items.find(problem=>problem.id===p2.id).ownProgress.formalCount,240);
   await student(query+'&cursor=invalid',undefined,'GET',400);
   await student(query+'&cursor='+encodeURIComponent(firstCursor.slice(0,-1)+(firstCursor.endsWith('A')?'B':'A')),undefined,'GET',400);
   await student(`/submissions?kind=submit&problemId=${p1.id}&limit=50&cursor=${encodeURIComponent(firstCursor)}`,undefined,'GET',400);
   await other(query+'&cursor='+encodeURIComponent(firstCursor),undefined,'GET',400);
   await student('/submissions?kind=invalid',undefined,'GET',400);await student('/submissions?limit=201',undefined,'GET',400);
  });
  await t.test('timed masks apply before aggregate and status/context filtering',async()=>{
   const bank=await teacher('/problem-banks',{name:'私有计时题库',visibility:'private'},'POST',201),hidden=await problem('隐藏成绩测试',bank.id);
   const practice=await teacher('/timed-practices',{title:'历史遮罩验证',classId:cls.id,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),durationMinutes:30,showVerdict:false,problems:[{problemId:hidden.id,points:100}],participants:[learner.identityId]},'POST',201);
   await teacher(`/timed-practices/${practice.id}/publish`,{});await student(`/timed-practices/${practice.id}/start`,{});
   const submitted=await student('/submissions',{problemId:hidden.id,timedPracticeId:practice.id,kind:'submit',code:'print(1)',idempotencyKey:randomUUID()},'POST',201);await pool.query("UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[submitted.id.slice(3)]);
   const progress=(await student('/problems')).items.find(problem=>problem.id===hidden.id).ownProgress;assert.equal(progress.status,'AC');assert.equal(progress.bestScore,null);assert.equal(progress.formalCount,1);
   const filtered=`/submissions?kind=submit&problemId=${hidden.id}&context=timed&timedPracticeId=${practice.id}`;
   assert.equal((await student(filtered+'&status=Executed')).items.length,0);const masked=(await student(filtered+'&status=AC')).items[0];assert.equal(masked.id,submitted.id);assert.equal(masked.score,null);
   assert.equal((await teacher(filtered+'&status=AC')).items[0].score,100);assert.equal((await other('/problems')).items.some(problem=>problem.id===hidden.id),false);
   await teacher(`/timed-practices/${practice.id}/end`,{reason:'验证发布边界'});await teacher(`/timed-practices/${practice.id}/results`,{});
   const released=(await student('/problems')).items.find(problem=>problem.id===hidden.id).ownProgress;assert.equal(released.status,'AC');assert.equal(released.bestScore,100);assert.equal((await student(filtered+'&status=AC')).items[0].id,submitted.id);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
