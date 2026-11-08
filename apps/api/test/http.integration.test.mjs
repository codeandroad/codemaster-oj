import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {canonicalHash} from '../../../packages/domain/src/security.mjs';

test('actual NestJS HTTP entry preserves sessions, CSRF, role checks, body limits and JSON errors',
  {skip: !process.env.TEST_DATABASE_URL, timeout: 60000}, async t => {
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`nest_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const connection=new URL(process.env.TEST_DATABASE_URL);
  connection.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(connection.toString());
  const adminPassword=randomBytes(24).toString('base64url');
  const studentPassword=randomBytes(24).toString('base64url');
  let app;
  try {
    await migrate(pool);
    const adminId=await bootstrap(pool,{name:'Nest管理员',number:'ADMIN',username:'nest-admin',password:adminPassword});
    app=await createApiApplication({databaseUrl:connection.toString(),logger:false,
      config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:'http://school.test',COOKIE_SECURE:'false'})});
    await app.listen(0,'127.0.0.1');
    const base=await app.getUrl();
    const request=async(path,{method='GET',body,auth,headers={},raw}={})=>{
      const response=await fetch(`${base}${path}`,{method,headers:{Origin:'http://school.test',
        ...((body!==undefined||raw!==undefined)?{'Content-Type':'application/json'}:{}),
        ...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...headers},
        ...((body!==undefined||raw!==undefined)?{body:raw??JSON.stringify(body)}:{})});
      const data=await response.json();
      return {status:response.status,data,headers:response.headers,
        cookie:response.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};
    };
    const health=await request('/healthz');
    assert.equal(health.status,200);assert.deepEqual(health.data,{ok:true,database:true});
    assert.equal(health.headers.get('cache-control'),'no-store');
    assert.equal(health.headers.get('x-content-type-options'),'nosniff');
    assert.equal(health.headers.get('x-powered-by'),null);
    assert.equal((await request('/api/v1/auth/me')).status,401);
    assert.equal((await request('/api/v1/auth/login',{method:'POST',raw:'{'})).data.error.code,'JSON');
    assert.equal((await request('/api/v1/auth/login',{method:'POST',raw:'[]'})).data.error.code,'JSON');
    assert.equal((await request('/api/v1/auth/login',{method:'POST',raw:'null'})).data.error.code,'JSON');
    assert.equal((await request('/api/v1/auth/login',{method:'POST',raw:'hello',headers:{'Content-Type':'text/plain'}})).status,415);
    const oversize=await request('/api/v1/auth/login',{method:'POST',raw:JSON.stringify({padding:'x'.repeat(2097152)})});
    assert.equal(oversize.status,413);assert.equal(oversize.data.error.code,'TOO_LARGE');
    const credentials={username:'nest-admin',password:adminPassword};
    assert.equal((await request('/api/v1/auth/login',{method:'POST',body:credentials,headers:{Origin:'http://attacker.test'}})).data.error.code,'ORIGIN');
    const admin=await request('/api/v1/auth/login',{method:'POST',body:credentials});
    assert.equal(admin.status,200);assert.equal(admin.data.user.id,adminId);
    assert.match(admin.headers.get('set-cookie'),/HttpOnly/);assert.match(admin.headers.get('set-cookie'),/SameSite=Strict/);
    assert.equal((await request('/api/v1/auth/me',{auth:admin})).data.user.username,'nest-admin');
    const csrf=await request('/api/v1/auth/profile',{method:'PATCH',body:{email:'nest@example.test'},auth:admin,headers:{'X-CSRF-Token':'wrong'}});
    assert.equal(csrf.status,403);assert.equal(csrf.data.error.code,'CSRF');
    assert.equal((await request(`/api/v1/accounts/${adminId}`,{method:'PATCH',body:{disabled:true},auth:admin})).data.error.code,'LAST_ADMIN');
    const person=await request('/api/v1/people',{method:'POST',body:{kind:'student',number:'STUDENT',name:'Nest学生'},auth:admin});
    assert.equal(person.status,201);
    const verified=await request('/api/v1/auth/verify-identity',{method:'POST',body:{kind:'student',number:'STUDENT',name:'Nest学生',activationCode:person.data.activationCode}});assert.equal(verified.status,200);assert.equal(verified.data.person.number,'STUDENT');
    const student=await request('/api/v1/auth/register',{method:'POST',body:{kind:'student',number:'STUDENT',name:'Nest学生',
      username:'nest-student',password:studentPassword,activationCode:person.data.activationCode}});
    assert.equal(student.status,201);
    const forbidden=await request('/api/v1/accounts',{auth:student});
    assert.equal(forbidden.status,403);assert.equal(forbidden.data.error.code,'FORBIDDEN');
    assert.equal((await request('/api/v1/classes',{auth:student})).status,200);
    const problem=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[adminId])).rows[0];
    const version=(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,school_visible_at) VALUES($1,'笔记测试题','stdio','输出一',1000,64,'print(1)','AC',now()) RETURNING id",[problem.id])).rows[0];
    const formalCase=(await pool.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'217','1',100) RETURNING id",[version.id])).rows[0];
    await pool.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[version.id]);
    await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[version.id,problem.id]);
    const historical=await request(`/api/v1/problems/${problem.id}`,{auth:student});
    assert.equal(historical.status,200);assert.equal(historical.data.referenceLanguage,'python');
    assert.deepEqual(historical.data.supportedLanguages,['python','cpp','javascript']);
    assert.deepEqual(historical.data.languageLimits,{
      python:{effectiveMemoryMb:64},cpp:{effectiveMemoryMb:64},
      javascript:{effectiveMemoryMb:128,runtimeMemoryFloorMb:128},
    });
    assert.match(historical.data.starterCodes.cpp,/int main/);
    assert.match(historical.data.starterCodes.javascript,/readFileSync/);
    const submission=await request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,kind:'submit',code:'print(1)',idempotencyKey:'nest-notebook-key'},auth:student});assert.equal(submission.status,201);
    assert.equal(submission.data.language,'python');
    const legacyHash=canonicalHash({kind:'submit',problemId:problem.id,code:'print(1)',assignmentId:null,timedPracticeId:null,requestedVersion:null,originalId:null,customInput:null});
    await pool.query('UPDATE submissions SET request_hash=$1 WHERE id=$2',[legacyHash,submission.data.id.slice(3)]);
    const legacyRetry=await request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,kind:'submit',language:'python',code:'print(1)',idempotencyKey:'nest-notebook-key'},auth:student});
    assert.equal(legacyRetry.status,201);assert.equal(legacyRetry.data.id,submission.data.id);
    const keySwitch=await request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,kind:'submit',language:'cpp',code:'print(1)',idempotencyKey:'nest-notebook-key'},auth:student});
    assert.equal(keySwitch.status,409);assert.equal(keySwitch.data.error.code,'IDEMPOTENCY_CONFLICT');
    const note=await request('/api/v1/review-notebook',{method:'POST',body:{submissionId:submission.data.id,note:'持久笔记'},auth:student});assert.equal(note.status,201);
    const notebookDetail=await request(`/api/v1/review-notebook/${note.data.id}`,{auth:student});assert.equal(notebookDetail.status,200);assert.equal(notebookDetail.data.authorIdentityId,person.data.person.id);assert.equal(notebookDetail.data.relatedNotes.length,1);
    assert.equal((await request(`/api/v1/review-notebook/${note.data.id}`)).status,401);
    assert.equal((await request('/api/v1/review-notebook/invalid',{auth:student})).data.error.code,'VALIDATION');
    const releasedLink=await request(`/api/v1/people/${person.data.person.id}/link`,{method:'POST',body:{accountId:student.data.user.id,reason:'必须先解绑'},auth:admin,headers:{'X-CSRF-Token':'wrong'}});assert.equal(releasedLink.status,403);assert.equal(releasedLink.data.error.code,'CSRF');
    await pool.query("UPDATE submissions SET status='WA',score=75 WHERE id=$1",[submission.data.id.slice(3)]);
    const correction=await request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,kind:'correction',originalSubmissionId:submission.data.id,code:'print(1)',idempotencyKey:'nest-history-correction'},auth:student});assert.equal(correction.status,201);await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[correction.data.id.slice(3)]);
    await pool.query("INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score,created_at) SELECT $1,$2,$3,$4,'samples','print(1)','nest-sample-'||n,'fixture','AC',100,clock_timestamp()+n*interval '1 second' FROM generate_series(1,205) n",[student.data.user.id,person.data.person.id,problem.id,version.id]);
    const progress=(await request('/api/v1/problems',{auth:student})).data.items.find(item=>item.id===problem.id).ownProgress;assert.equal(progress.bestScore,75);assert.equal(progress.formalCount,1);assert.equal(progress.status,'WA');
    const historyQuery=`/api/v1/submissions?kind=submit,correction&problemId=${problem.id}&limit=1`;
    const firstPage=await request(historyQuery,{auth:student});assert.equal(firstPage.status,200);assert.equal(firstPage.data.items[0].id,correction.data.id);assert.ok(firstPage.data.nextCursor);
    const secondPage=await request(historyQuery+`&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`,{auth:student});assert.equal(secondPage.data.items[0].id,submission.data.id);assert.equal(secondPage.data.nextCursor,null);
    assert.equal((await request('/api/v1/submissions?kind=submit&status=WA&context=practice',{auth:student})).data.items[0].id,submission.data.id);
    assert.equal((await request('/api/v1/submissions?cursor=invalid',{auth:student})).data.error.code,'VALIDATION');
    const javascript=await request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,kind:'submit',language:'javascript',code:'console.log(1)',idempotencyKey:'nest-js-key'},auth:student});
    assert.equal(javascript.status,201);assert.equal(javascript.data.language,'javascript');
    assert.equal((await request(`/api/v1/submissions/${javascript.data.id}`,{auth:student})).data.language,'javascript');
    const submitCode=(code,idempotencyKey)=>request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,versionId:version.id,kind:'submit',code,idempotencyKey},auth:student});
    const sameCode=await Promise.all(['nest-duplicate-a','nest-duplicate-b'].map(key=>submitCode('print(2)',key)));
    assert.deepEqual(sameCode.map(result=>result.status).sort(),[201,409]);
    assert.equal(sameCode.find(result=>result.status===409).data.error.code,'SUBMISSION_ALREADY_PENDING');
    const acceptedId=sameCode.find(result=>result.status===201).data.id.slice(3);
    await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[acceptedId]);
    const repeat=await submitCode('print(2)','nest-repeat-accepted');
    assert.equal(repeat.status,409);assert.equal(repeat.data.error.code,'SUBMISSION_ALREADY_ACCEPTED');
    assert.equal((await pool.query("SELECT count(*)::int n FROM submissions WHERE problem_id=$1 AND kind='submit' AND code='print(2)'",[problem.id])).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM judge_tasks WHERE submission_id=$1',[acceptedId])).rows[0].n,1);
    assert.equal((await submitCode('print(2) # revised','nest-revised-after-ac')).status,201);
    const cls=(await pool.query("INSERT INTO classes(name,type,owner_account_id) VALUES('Nest 作业班','administrative',$1) RETURNING id",[adminId])).rows[0];
    const assignment=(await pool.query("INSERT INTO assignments(title,class_id,owner_account_id,due_at,state,published_at) VALUES('Nest 作业',$1,$2,now()+interval '1 hour','Published',now()) RETURNING id",[cls.id,adminId])).rows[0];
    await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)',[assignment.id,problem.id,version.id]);
    await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,person.data.person.id]);
    const inAssignment=await request('/api/v1/submissions',{method:'POST',body:{problemId:problem.id,versionId:version.id,assignmentId:assignment.id,kind:'submit',code:'print(2)',idempotencyKey:'nest-same-code-assignment'},auth:student});
    assert.equal(inAssignment.status,201);assert.equal(inAssignment.data.assignmentId,assignment.id);
    assert.equal((await request('/api/v1/site-info',{auth:student})).data.siteName,'CodeMaster');
    assert.equal((await request('/api/v1/problem-favorites',{auth:student})).status,200);
    assert.equal((await request('/api/v1/problem-favorites/invalid',{method:'PUT',body:{favorite:true},auth:student})).data.error.code,'VALIDATION');
    assert.equal((await request('/api/v1/system-settings',{method:'PATCH',body:{siteName:'New site'},auth:student})).status,403);
    const settings=await request('/api/v1/system-settings',{method:'PATCH',body:{siteName:'Nest school judge',runtime:{workerConcurrency:1}},auth:admin});assert.equal(settings.status,200);
    assert.equal((await request('/api/v1/site-info',{auth:student})).data.siteName,'Nest school judge');
    assert.equal((await request('/api/v1/judge-maintenance',{method:'POST',body:{enabled:true},auth:admin,headers:{'X-CSRF-Token':'bad'}})).status,403);
    assert.equal((await request('/api/v1/judge-maintenance',{method:'POST',body:{enabled:true},auth:admin})).status,200);
    assert.equal((await request('/api/v1/judge-status',{auth:admin})).data.maintenance,true);
    assert.equal((await request('/api/v1/judge-maintenance',{method:'POST',body:{enabled:false},auth:admin})).status,200);
    assert.equal((await request('/api/v1/judge-tasks/invalid',{auth:admin})).data.error.code,'VALIDATION');
    assert.equal((await request('/api/v1/problems/import',{auth:admin})).status,200);
    const sampleDraft=await request('/api/v1/problems',{method:'POST',auth:admin,body:{saveDraft:true,title:'样例启用状态',mode:'stdio',statement:'输出一',referenceCode:'console.log(1)',referenceLanguage:'javascript',starterCodes:{javascript:'console.log(1)',cpp:'#include <iostream>\nint main(){std::cout<<1;}'},samples:[{input:'',expected:'1',name:'公开样例',enabled:true},{input:'disabled-private-sample',expected:'wrong',name:'停用样例',enabled:false}],tests:[{input:'',expected:'1',weight:100}]}});assert.equal(sampleDraft.status,201);assert.equal(sampleDraft.data.samples[1].name,'停用样例');assert.equal(sampleDraft.data.samples[1].enabled,false);assert.equal(sampleDraft.data.referenceLanguage,'javascript');assert.equal(sampleDraft.data.starterCodes.javascript,'console.log(1)');
    await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[sampleDraft.data.versionId]);assert.equal((await request(`/api/v1/problems/${sampleDraft.data.id}/publish`,{method:'POST',auth:admin,body:{versionId:sampleDraft.data.versionId}})).status,200);
    assert.equal((await request(`/api/v1/problems/${sampleDraft.data.id}/rank-review`,{method:'PATCH',auth:admin,body:{versionId:sampleDraft.data.versionId,decision:'approved'}})).status,200);
    const ownerSamples=await request(`/api/v1/problems/${sampleDraft.data.id}`,{auth:admin});assert.equal(ownerSamples.data.samples.length,2);
    const studentSamples=await request(`/api/v1/problems/${sampleDraft.data.id}`,{auth:student});assert.equal(studentSamples.data.samples.length,1);assert.equal(studentSamples.data.samples[0].name,'公开样例');
    assert.equal(JSON.stringify((await request('/api/v1/problems',{auth:student})).data).includes('disabled-private-sample'),false);
    assert.equal((await request('/api/v1/learning-resources',{auth:student})).status,200);
    assert.equal((await request('/api/v1/assignments/invalid',{method:'PATCH',body:{title:'invalid'},auth:admin})).data.error.code,'VALIDATION');
    assert.equal((await request('/api/v1/timed-practices/invalid',{method:'PATCH',body:{title:'invalid'},auth:admin})).data.error.code,'VALIDATION');
    assert.equal((await request('/api/v1/chapters/invalid/progress',{method:'POST',body:{completed:true},auth:student})).data.error.code,'VALIDATION');
    assert.equal((await request('/api/v1/problem-groups/invalid',{method:'DELETE',auth:admin})).data.error.code,'VALIDATION');
    const groups=[];for(const name of ['Nest 来源','Nest 目标']){const r=await request('/api/v1/problem-groups',{method:'POST',auth:admin,body:{name,problemIds:groups.length?[]:[sampleDraft.data.id]}});assert.equal(r.status,201);groups.push(r.data);}
    const move={bankId:groups[0].bankId,sourceGroupId:groups[0].id,targetGroupIds:[groups[1].id],problemIds:[sampleDraft.data.id]};
    assert.equal((await request('/api/v1/problem-groups/move',{method:'POST',auth:student,body:move})).status,403);
    assert.equal((await request('/api/v1/problem-groups/move',{method:'POST',auth:admin,body:move,headers:{'X-CSRF-Token':'invalid'}})).status,403);
    const moved=await request('/api/v1/problem-groups/move',{method:'POST',auth:admin,body:move});assert.equal(moved.status,200,JSON.stringify(moved.data));assert.equal(moved.data.moved,1);
    const afterGroups=(await request('/api/v1/problem-groups',{auth:admin})).data.items;assert(!afterGroups.find(g=>g.id===groups[0].id).problemIds.includes(sampleDraft.data.id));assert(afterGroups.find(g=>g.id===groups[1].id).problemIds.includes(sampleDraft.data.id));
    await t.test('ordinary diagnostics reach the owner while timed attempts and their corrections stay private', async () => {
      const runtimeError = 'ValueError: diagnostic sentinel';
      const measurements = [{position:1,status:'RE',timeMs:5,memoryKb:2048},{position:2,status:'NotRun'}];
      const rawResults = [
        {position:1,status:'RE',cpuMs:5,memoryBytes:2097152,stderr:runtimeError,
          stdout:'PRIVATE_STDOUT',returned:'PRIVATE_RETURN',input:'PRIVATE_INPUT',expected:'PRIVATE_EXPECTED',testId:'PRIVATE_ID'},
        {position:2,status:'NotRun'},
      ];
      async function recordFailure(submissionId, status='RE', results=rawResults) {
        const id = submissionId.slice(3);
        await pool.query(`WITH completed AS (
          UPDATE judge_tasks SET state='completed' WHERE submission_id=$1 RETURNING id,version_id
        ) INSERT INTO judge_runs(task_id,lease_id,submission_id,version_id,status,score,passed,total,private_results,environment_version)
          SELECT id,gen_random_uuid(),$1,version_id,$3,0,0,2,$2,'nest-feedback-test' FROM completed`, [id,JSON.stringify(results),status]);
        await pool.query('UPDATE submissions SET status=$2,score=0,passed=0,total=2 WHERE id=$1',[id,status]);
      }
      const detail = (id, auth) => request(`/api/v1/submissions/${id}`,{auth});

      for (const {data:{id}} of [submission, correction, inAssignment]) {
        await recordFailure(id);
        const result = await detail(id, student);
        assert.equal(result.status, 200);
        assert.equal(result.data.testResults[0].runtimeError, runtimeError);
        assert.equal(result.data.testResults[0].mode, 'stdio');
        assert.equal(result.data.testResults[0].stderr, undefined);
        assert.deepEqual(result.data.testResults[1], measurements[1]);
        assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE_/);
      }
      assert.equal((await detail(submission.data.id)).status, 401);
      const outsider = await request('/api/v1/people',{method:'POST',body:{kind:'student',number:'OUTSIDER',name:'Nest outsider'},auth:admin});
      assert.equal(outsider.status, 201);
      const outsiderAccount = await request('/api/v1/auth/register',{method:'POST',body:{kind:'student',number:'OUTSIDER',name:'Nest outsider',
        username:'nest-outsider',activationCode:outsider.data.activationCode,password:randomBytes(24).toString('base64url')}});
      assert.equal(outsiderAccount.status, 201);
      const denied = await detail(submission.data.id, outsiderAccount);
      assert.equal(denied.status, 403);
      assert.doesNotMatch(JSON.stringify(denied.data), /testResults|diagnostic sentinel/);

      const practice = await request('/api/v1/timed-practices',{method:'POST',auth:admin,body:{
        title:'Timed diagnostics',startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+600000).toISOString(),
        durationMinutes:5,showVerdict:true,participants:[person.data.person.id],problems:[{problemId:problem.id,versionId:version.id,points:100}],
      }});
      assert.equal(practice.status, 201, JSON.stringify(practice.data));
      const activityAction = (action, auth) => request(`/api/v1/timed-practices/${practice.data.id}/${action}`,{method:'POST',body:{},auth});
      for (const [action, auth] of [['publish',admin], ['start',student]]) {
        const result = await activityAction(action, auth);
        assert.equal(result.status, 200, JSON.stringify(result.data));
      }
      const timed = await request('/api/v1/submissions',{method:'POST',auth:student,body:{
        problemId:problem.id,versionId:version.id,kind:'submit',code:'print(3)',idempotencyKey:'nest-timed-runtime',timedPracticeId:practice.data.id,
      }});
      assert.equal(timed.status, 201, JSON.stringify(timed.data));
      await recordFailure(timed.data.id);
      const embargoed = await detail(timed.data.id, student);
      assert.equal(embargoed.status, 200);
      assert.equal(embargoed.data.resultsVisible, false);
      assert.deepEqual(embargoed.data.testResults, []);
      assert.deepEqual((await detail(timed.data.id, admin)).data.testResults, measurements);
      for (const [action, auth] of [['finish',student], ['results',admin]]) {
        const result = await activityAction(action, auth);
        assert.equal(result.status, 200, JSON.stringify(result.data));
      }
      const timedCorrection = await request('/api/v1/submissions',{method:'POST',auth:student,body:{
        problemId:problem.id,kind:'correction',code:'print(4)',idempotencyKey:'nest-timed-correction-runtime',originalSubmissionId:timed.data.id,
      }});
      assert.equal(timedCorrection.status, 201, JSON.stringify(timedCorrection.data));
      await recordFailure(timedCorrection.data.id);
      for (const {data:{id}} of [timed, timedCorrection]) {
        const result = await detail(id, student);
        assert.equal(result.status, 200);
        assert.equal(result.data.resultsVisible, true);
        assert.deepEqual(result.data.testResults, measurements);
        assert.doesNotMatch(JSON.stringify(result.data), /diagnostic sentinel|PRIVATE_/);
      }
      const wrongAnswer=[{...rawResults[0],testId:formalCase.id,status:'WA',stdout:'2\n'},rawResults[1]];
      await recordFailure(inAssignment.data.id,'WA',wrongAnswer);
      const graded=await detail(inAssignment.data.id,student);
      assert.equal(graded.status,200);
      const [failed]=graded.data.testResults;
      assert.deepEqual([failed.input,failed.output,failed.expected],['217','2\n','1']);
      assert.doesNotMatch(JSON.stringify(graded.data),/PRIVATE_|diagnostic sentinel/);
      await recordFailure(timed.data.id,'WA',wrongAnswer);
      const contest=await detail(timed.data.id,student);
      assert.equal(contest.data.resultsVisible,true);
      assert.deepEqual(contest.data.testResults,[{...measurements[0],status:'WA'},measurements[1]]);
    });
    const unknown=await request('/api/v1/does-not-exist',{auth:admin});
    assert.equal(unknown.status,404);assert.equal(unknown.data.error.code,'NOT_FOUND');
    assert.equal((await request(`/api/v1/accounts/${student.data.user.id}`,{method:'PATCH',body:{disabled:true},auth:admin})).status,200);
    const disabledLogin=await request('/api/v1/auth/login',{method:'POST',body:{username:'nest-student',password:studentPassword}});
    assert.equal(disabledLogin.status,403);assert.deepEqual(disabledLogin.data.error,{code:'ACCOUNT_DISABLED',message:'账号已禁用'});
    const wrongDisabledLogin=await request('/api/v1/auth/login',{method:'POST',body:{username:'nest-student',password:randomBytes(24).toString('base64url')}});
    assert.equal(wrongDisabledLogin.status,401);assert.equal(wrongDisabledLogin.data.error.code,'LOGIN_FAILED');
    assert.equal((await request('/api/v1/auth/logout',{method:'POST',body:{},auth:admin})).status,200);
    assert.equal((await request('/api/v1/auth/me',{auth:admin})).status,401);
  } finally {
    if(app)await app.close();
    await pool.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`);
    await manager.end();
  }
});
