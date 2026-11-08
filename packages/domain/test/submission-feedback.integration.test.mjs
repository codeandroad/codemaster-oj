import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';

test('HTTP result feedback uses authorized, confirmed runs and context-aware diagnostics',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async t=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`feedback_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const database=new URL(process.env.TEST_DATABASE_URL);database.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(database.href);let server;
 try{
  await migrate(pool);
  const password=`Feedback-${randomUUID()}!`;
  await bootstrap(pool,{name:'Admin',number:'FEEDBACK-ADMIN',username:'feedback-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://feedback.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='';return async(path,body,status=200)=>{
   const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:'http://feedback.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const result=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(result.csrfToken)csrf=result.csrfToken;
   return result;
  };}
  const admin=client(),adminUser=(await admin('/auth/login',{username:'feedback-admin',password})).user;
  const students=[];
  for(const number of ['FEEDBACK-A','FEEDBACK-B']){
   const created=await admin('/people',{kind:'student',number,name:number},201),api=client();
   const registered=await api('/auth/register',{kind:'student',number,name:number,activationCode:created.activationCode,username:number.toLowerCase(),password},201);
   students.push({...registered.user,api});
  }
  const [student,other]=students;
  const problemId=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[adminUser.id])).rows[0].id;
  const versionId=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,function_name,statement,samples,time_limit_ms,memory_limit_mb,comparator,reference_code,validation_status,published_at,rank_review_status,rank_approved_at,school_visible_at)
   VALUES($1,'Feedback exercise','function','solve','Return a value.',$2,1000,128,'json','PRIVATE_REFERENCE','AC',NULL,'approved',now(),now()) RETURNING id`,[problemId,JSON.stringify([{input:'HIDDEN_DISABLED',expected:'HIDDEN_DISABLED',enabled:false},{input:'[1]',expected:'2'},{input:'[3]',expected:'4'}])])).rows[0].id;
  const testId=(await pool.query(`INSERT INTO test_cases(version_id,position,input,expected,weight,enabled)
   VALUES($1,0,'[77]','78',100,false),($1,1,'[13]','14',100,true) RETURNING id,enabled`,[versionId])).rows.find(row=>row.enabled).id;
  await pool.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[versionId]);
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,versionId]);
  const logs=[{position:1,status:'AC',cpuMs:1,memoryBytes:1024,returned:'2',stdout:'first',stderr:''},{position:2,status:'WA',cpuMs:2,memoryBytes:2048,returned:'5',stdout:'second',stderr:'',privateKey:'PRIVATE_UNEXPECTED'}];
  async function createRun(id,raw,{kind='samples',rejudge=false,status='WA',score=50}={}){
   const task=(await pool.query("INSERT INTO judge_tasks(submission_id,version_id,purpose,state,rejudge) VALUES($1,$2,'submission','completed',$3) RETURNING id",[id,versionId,rejudge])).rows[0].id;
   return (await pool.query(`INSERT INTO judge_runs(task_id,lease_id,submission_id,version_id,status,score,passed,total,private_results,environment_version,created_at)
    VALUES($1,$2,$3,$4,$5,$6,1,2,$7,'feedback-test',clock_timestamp()) RETURNING id`,[task,randomUUID(),id,versionId,status,score,JSON.stringify(raw)])).rows[0].id;
  }
  async function submission(kind='samples',{raw=logs,status='WA',score=50,timedAttemptId=null,originalId=null}={}){
   const id=(await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,custom_input,idempotency_key,request_hash,status,score,passed,total,timed_attempt_id,original_submission_id)
    VALUES($1,$2,$3,$4,$5,'def solve(x): return x+2','[9]',$6,'feedback',$7,$8,1,2,$9,$10) RETURNING id`,[student.id,student.identityId,problemId,versionId,kind,randomUUID(),status,score,timedAttemptId,originalId])).rows[0].id;
   const runId=await createRun(id,raw,{kind,status,score});return {id,runId};
  }
  const detail=id=>student.api(`/submissions/SUB${id}`);
  await t.test('samples return the exact-version public inputs/expected with per-case outputs',async()=>{
   const {id}=await submission(),result=await detail(id);
   assert.equal(result.testResults.length,2);assert.equal(result.testResults[0].input,'[1]');assert.equal(result.testResults[1].expected,'4');assert.equal(result.testResults[1].output,'5');assert.equal(result.testResults[1].stdout,'second');
   assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|HIDDEN_DISABLED/);
   const denied=await other.api(`/submissions/SUB${id}`,undefined,403);assert.doesNotMatch(JSON.stringify(denied),/testResults|second|def solve/);
   await client()(`/submissions/SUB${id}`,undefined,401);
  });
  await t.test('custom runs without grades still expose execution output, never expected values',async()=>{
   const {id}=await submission('custom',{status:'Executed',score:null,raw:[{position:1,status:'Executed',returned:'11',stdout:'debug',stderr:''}]});
   const result=await detail(id);assert.equal(result.score,null);assert.equal(result.testResults[0].output,'11');assert.equal(result.testResults[0].input,'[9]');assert.equal(result.testResults[0].expected,undefined);
  });
  const mismatchLog={status:'WA',score:0,raw:[{position:1,status:'WA',cpuMs:4,testId,returned:'15',stdout:'PRIVATE_STDOUT',stderr:'PRIVATE_STDERR'}]};
  await t.test('historical practice and corrections compare the saved output against the pinned formal case',async()=>{
   const {id}=await submission('submit',mismatchLog);
   const correction=await submission('correction',{...mismatchLog,originalId:id});
   const newer=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,function_name,statement,time_limit_ms,memory_limit_mb,comparator,reference_code,validation_status)
    VALUES($1,'New version','function','solve','Return a value.',1000,128,'json','PRIVATE_REFERENCE','AC') RETURNING id`,[problemId])).rows[0].id;
   await pool.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'[99]','100',100)",[newer]);
   await pool.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[newer]);
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,newer]);
   for(const savedId of [id,correction.id]){
    const result=await detail(savedId),[failed]=result.testResults;
    assert.equal(result.versionId,versionId);
    assert.deepEqual([failed.input,failed.output,failed.expected],['[13]','15','14']);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|\[77\]|\[99\]/);
    assert.deepEqual((await admin(`/submissions/SUB${savedId}`)).testResults,[{position:1,status:'WA',timeMs:4}]);
   }
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,versionId]);
  });
  const exceptionLog={status:'RE',score:0,raw:[{position:1,status:'RE',cpuMs:4,stdout:'PRIVATE_STDOUT',stderr:'ValueError: retained error',returned:'PRIVATE_RETURN',testId:'PRIVATE_CASE'}]};
  await t.test('ordinary formal and correction runs expose the runtime error only for authorized readers',async()=>{
   const original=await submission('submit',exceptionLog);
   for(const kind of ['submit','correction']){
    const {id}=kind==='submit'?original:await submission(kind,{...exceptionLog,originalId:original.id});
    for(const api of [student.api,admin]){
     const result=await api(`/submissions/SUB${id}`);
     assert.deepEqual(result.testResults,[{position:1,status:'RE',timeMs:4,runtimeError:'ValueError: retained error',mode:'function'}]);
     assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
    }
    const denied=await other.api(`/submissions/SUB${id}`,undefined,403);
    assert.doesNotMatch(JSON.stringify(denied),/retained error|runtimeError|PRIVATE_/);
   }
  });
  await t.test('legacy correction with no original submission keeps its runtime diagnostic private',async()=>{
   const {id}=await submission('correction',exceptionLog);
   for(const api of [student.api,admin]){
    const result=await api(`/submissions/SUB${id}`);
    assert.deepEqual(result.testResults,[{position:1,status:'RE',timeMs:4}]);
   }
  });
  await t.test('pending rejudge results do not replace displayed output until explicitly confirmed',async()=>{
   const {id}=await submission();const runId=await createRun(id,[{...logs[0],status:'WA',returned:'999'}],{rejudge:true});
   await pool.query('UPDATE submissions SET pending_judge_run_id=$2 WHERE id=$1',[id,runId]);
   assert.equal((await detail(id)).testResults[0].output,'2');
   await pool.query('UPDATE submissions SET pending_judge_run_id=NULL WHERE id=$1',[id]);
   assert.equal((await detail(id)).testResults[0].output,'2');
   await pool.query("INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,'submission.rejudge_confirm','submission',$2,$3)",[adminUser.id,String(id),JSON.stringify({runId})]);
   assert.equal((await detail(id)).testResults[0].output,'999');
  });
  await t.test('timed failures stay private before and after release, including through correction chains',async()=>{
   const practice=(await pool.query("INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes,state) VALUES('Timed feedback',$1,now()-interval '1 minute',now()+interval '1 hour',60,'Draft') RETURNING id",[adminUser.id])).rows[0].id;
   await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[practice,student.identityId]);
   await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[practice]);
   const attempt=(await pool.query("INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour') RETURNING id",[practice,student.identityId,student.id])).rows[0].id;
   const {id}=await submission('submit',{...exceptionLog,timedAttemptId:attempt});const masked=await detail(id);
   assert.equal(masked.resultsVisible,false);assert.equal(masked.score,null);assert.deepEqual(masked.testResults,[]);
   const measurements=[{position:1,status:'RE',timeMs:4}];
   assert.deepEqual((await admin(`/submissions/SUB${id}`)).testResults,measurements);
   await pool.query('UPDATE timed_practices SET results_published_at=now() WHERE id=$1',[practice]);
   const released=await detail(id);
   assert.equal(released.resultsVisible,true);assert.deepEqual(released.testResults,measurements);
   const correction=await submission('correction',{...exceptionLog,originalId:id});
   const nextCorrection=await submission('correction',{...exceptionLog,originalId:correction.id});
   for(const correctionId of [correction.id,nextCorrection.id])assert.deepEqual((await detail(correctionId)).testResults,measurements);
   const mismatch=await submission('submit',{...mismatchLog,timedAttemptId:attempt});
   const mismatchCorrection=await submission('correction',{...mismatchLog,originalId:mismatch.id});
   for(const savedId of [mismatch.id,mismatchCorrection.id]){
    const result=await detail(savedId);
    assert.equal(result.resultsVisible,true);
    assert.deepEqual(result.testResults,[{position:1,status:'WA',timeMs:4}]);
   }
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
