import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';
import { SCHOOL_BANK } from '../src/library.mjs';

test('batch publication is atomic, authorized, version-pinned and awaits administrator review',
  {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
    const manager=createPool(process.env.TEST_DATABASE_URL);
    const schema=`batch_publish_${randomBytes(6).toString('hex')}`;
    await manager.query(`CREATE SCHEMA ${schema}`);
    const connection=new URL(process.env.TEST_DATABASE_URL);
    connection.searchParams.set('options',`-csearch_path=${schema}`);
    const pool=createPool(connection.href);
    const testPassword=randomBytes(24).toString('base64url');
    const sessionSecret=randomBytes(48).toString('base64url');
    let server;
    try {
      await migrate(pool);
      await bootstrap(pool,{name:'管理员',number:'ADM-BATCH',username:'batch-admin',password:testPassword});
      server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:sessionSecret,APP_ORIGIN:'http://batch.test',COOKIE_SECURE:'false'})));
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const base=`http://127.0.0.1:${server.address().port}/api/v1`;
      const request=async(path,method='GET',body,auth,headers={})=>{
        const response=await fetch(`${base}${path}`,{method,headers:{Origin:'http://batch.test',...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
        const data=await response.json();
        return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};
      };
      const admin=await request('/auth/login','POST',{username:'batch-admin',password:testPassword});
      assert.equal(admin.status,200);
      const account=async(kind,number,name,username)=>{
        const issued=await request('/people','POST',{kind,number,name},admin);
        assert.equal(issued.status,201,JSON.stringify(issued.data));
        const registered=await request('/auth/register','POST',{kind,number,name,username,activationCode:issued.data.activationCode,password:testPassword});
        assert.equal(registered.status,201,JSON.stringify(registered.data));
        const id=(await pool.query('SELECT id FROM accounts WHERE username=$1',[username])).rows[0].id;
        return {...registered,id};
      };
      const teacher=await account('teacher','T-BATCH-1','教师一','batch-teacher-1');
      const otherTeacher=await account('teacher','T-BATCH-2','教师二','batch-teacher-2');
      const student=await account('student','S-BATCH-1','学生一','batch-student');
      const problem=async(owner,title,status='AC',bankId=SCHOOL_BANK)=>{
        const p=(await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[owner,bankId])).rows[0];
        const v=(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status) VALUES($1,$2,'stdio','输出一',1000,64,'print(1)',$3) RETURNING id",[p.id,title,status])).rows[0];
        return {problemId:p.id,versionId:v.id};
      };
      const one=await problem(teacher.id,'第一题');
      const two=await problem(teacher.id,'第二题');
      const invalid=await problem(teacher.id,'未通过题','WA');
      const foreign=await problem(otherTeacher.id,'他人题');
      const old=await problem(teacher.id,'旧版本');
      const newer=(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status) VALUES($1,'新版本','stdio','输出二',1000,64,'print(2)','AC') RETURNING id",[old.problemId])).rows[0].id;
      const payload=items=>({items});
      const batch=(items,auth=teacher,headers)=>request('/problems/publish-batch','POST',payload(items),auth,headers);
      const publishedCount=async id=>Number((await pool.query('SELECT count(*)::int n FROM problem_versions WHERE problem_id=$1 AND published_at IS NOT NULL',[id])).rows[0].n);

      assert.equal((await batch([one],student)).status,403);
      assert.equal((await batch([],teacher)).status,400);
      assert.equal((await batch([one,one],teacher)).status,400);
      assert.equal((await batch(Array.from({length:101},()=>one),teacher)).status,400);
      assert.equal((await batch([one],teacher,{'X-CSRF-Token':'forged'})).status,403);

      const unvalidated=await batch([one,invalid]);
      assert.equal(unvalidated.status,409,JSON.stringify(unvalidated.data));
      assert.equal(unvalidated.data.error.code,'NOT_VALIDATED');
      assert.equal(await publishedCount(one.problemId),0,'a failed batch never publishes an earlier valid item');
      assert.equal(await publishedCount(invalid.problemId),0);

      const unauthorized=await batch([one,foreign]);
      assert.ok([403,404].includes(unauthorized.status));
      assert.equal(await publishedCount(one.problemId),0,'foreign ownership rolls back the whole batch');

      const outdated=await batch([one,old]);
      assert.equal(outdated.status,409,JSON.stringify(outdated.data));
      assert.equal(outdated.data.error.code,'VERSION_CHANGED');
      assert.equal(await publishedCount(one.problemId),0,'a stale version rolls back the whole batch');

      const success=await batch([two,one]);
      assert.equal(success.status,200,JSON.stringify(success.data));
      assert.equal(success.data.publishedCount,2);
      assert.deepEqual(new Set(success.data.items.map(item=>item.problemId)),new Set([one.problemId,two.problemId]));
      for(const item of [one,two]){
        assert.equal(await publishedCount(item.problemId),1);
        const current=(await pool.query('SELECT current_version_id FROM problems WHERE id=$1',[item.problemId])).rows[0].current_version_id;
        assert.equal(current,item.versionId);
        const version=(await pool.query('SELECT rank_review_status,school_visible_at FROM problem_versions WHERE id=$1',[item.versionId])).rows[0];
        assert.equal(version.rank_review_status,'pending');
        assert.equal(version.school_visible_at,null,'batch publication cannot approve school visibility');
        assert.equal((await request(`/problems/${item.problemId}`,'GET',undefined,student)).status,404,'publication alone never grants school-wide access');
      }
      const review=(await request('/problems/rank-review','GET',undefined,admin)).data.items;
      assert.ok(review.some(item=>item.versionId===one.versionId&&item.rankReviewStatus==='pending'));
      const auditBefore=Number((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='problem.publish' AND metadata->>'batch'='true'")).rows[0].n);
      assert.equal(auditBefore,2);
      const retried=await batch([one,two]);
      assert.equal(retried.status,409);
      assert.equal(retried.data.error.code,'ALREADY_PUBLISHED');
      assert.equal(Number((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='problem.publish' AND metadata->>'batch'='true'")).rows[0].n),2,'a retry cannot duplicate publish audit entries');
      assert.equal((await pool.query('SELECT published_at FROM problem_versions WHERE id=$1',[newer])).rows[0].published_at,null);

      const approval=await request(`/problems/${one.problemId}/rank-review`,'PATCH',{versionId:one.versionId,decision:'approved'},admin);
      assert.equal(approval.status,200,JSON.stringify(approval.data));
      const extra=await problem(teacher.id,'Unpublished third problem');
      const mixed=await batch([extra,one]);
      assert.equal(mixed.status,409,'one already approved version rejects the whole batch');
      assert.equal(mixed.data.error.code,'ALREADY_PUBLISHED');
      assert.equal(await publishedCount(extra.problemId),0,'a mixed batch must not partially publish');
      const singleRetry=await request(`/problems/${one.problemId}/publish`,'POST',{versionId:one.versionId},teacher);
      assert.equal(singleRetry.status,409);
      assert.equal(singleRetry.data.error.code,'ALREADY_PUBLISHED');
      const stillApproved=(await pool.query('SELECT rank_review_status,school_visible_at FROM problem_versions WHERE id=$1',[one.versionId])).rows[0];
      assert.equal(stillApproved.rank_review_status,'approved');
      assert.ok(stillApproved.school_visible_at);
      const revision=(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status) VALUES($1,'First problem, revised','stdio','Print two',1000,64,'print(2)','AC') RETURNING id",[one.problemId])).rows[0].id;
      const freshPublication=await request(`/problems/${one.problemId}/publish`,'POST',{versionId:revision},teacher);
      assert.equal(freshPublication.status,200,JSON.stringify(freshPublication.data));
      assert.equal((await pool.query('SELECT current_version_id FROM problems WHERE id=$1',[one.problemId])).rows[0].current_version_id,revision);
      assert.equal((await pool.query('SELECT rank_review_status FROM problem_versions WHERE id=$1',[revision])).rows[0].rank_review_status,'pending','a new explicit revision requires a new review');
      assert.equal((await request(`/problems/${one.problemId}/publish`,'POST',{versionId:one.versionId},teacher)).status,409,'old approved version cannot regain the current pointer');
      assert.equal((await pool.query('SELECT current_version_id FROM problems WHERE id=$1',[one.problemId])).rows[0].current_version_id,revision);

      const sharedBank=(await pool.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES('共享编辑题库',$1,'private') RETURNING id",[otherTeacher.id])).rows[0];
      const delegated=await problem(otherTeacher.id,'授权共编题', 'AC',sharedBank.id);
      assert.ok([403,404].includes((await batch([delegated])).status),'a teacher without bank edit cannot publish it');
      await pool.query("INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,'edit')",[sharedBank.id,teacher.id]);
      const delegatedResult=await batch([delegated]);
      assert.equal(delegatedResult.status,200,JSON.stringify(delegatedResult.data));
      assert.equal(delegatedResult.data.publishedCount,1,'bank edit permission grants publication without changing ownership');
      assert.equal(await publishedCount(delegated.problemId),1);
    } finally {
      if(server)await new Promise(resolve=>server.close(resolve));
      await pool.end();
      await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await manager.end();
    }
  });
