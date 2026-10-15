import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';
import { SCHOOL_BANK } from '../src/library.mjs';

test('batch school approval is admin-only, version-pinned, atomic and never publishes drafts',
  {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
    const manager=createPool(process.env.TEST_DATABASE_URL);
    const schema=`batch_review_${randomBytes(6).toString('hex')}`;
    await manager.query(`CREATE SCHEMA ${schema}`);
    const connection=new URL(process.env.TEST_DATABASE_URL);
    connection.searchParams.set('options',`-csearch_path=${schema}`);
    const pool=createPool(connection.href);
    const testPassword=randomBytes(24).toString('base64url');
    let server;
    try {
      await migrate(pool);
      await bootstrap(pool,{name:'管理员',number:'ADM-REVIEW',username:'review-admin',password:testPassword});
      server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('base64url'),APP_ORIGIN:'http://review.test',COOKIE_SECURE:'false'})));
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const base=`http://127.0.0.1:${server.address().port}/api/v1`;
      const request=async(path,method='GET',body,auth,headers={})=>{
        const response=await fetch(`${base}${path}`,{method,headers:{Origin:'http://review.test',...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
        const data=await response.json();
        return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};
      };
      const admin=await request('/auth/login','POST',{username:'review-admin',password:testPassword});
      assert.equal(admin.status,200);
      const account=async(kind,number,name,username)=>{
        const issued=await request('/people','POST',{kind,number,name},admin);
        assert.equal(issued.status,201);
        const registered=await request('/auth/register','POST',{kind,number,name,username,activationCode:issued.data.activationCode,password:testPassword});
        assert.equal(registered.status,201);
        return registered;
      };
      const teacher=await account('teacher','T-REVIEW','教师','review-teacher');
      const student=await account('student','S-REVIEW','学生','review-student');
      const adminId=(await pool.query("SELECT id FROM accounts WHERE username='review-admin'")).rows[0].id;
      const createProblem=async(title,{bankId=SCHOOL_BANK,validation='AC',published=true,review='pending'}={})=>{
        const p=(await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[adminId,bankId])).rows[0];
        const v=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at,rank_review_status)
          VALUES($1,$2,'stdio','输出一',1000,64,'print(1)',$3,CASE WHEN $4 THEN now() ELSE NULL END,$5) RETURNING id`,[p.id,title,validation,published,review])).rows[0];
        if(published)await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[v.id,p.id]);
        return {problemId:p.id,versionId:v.id};
      };
      const first=await createProblem('待审核题一');
      const second=await createProblem('待审核题二');
      const rejected=await createProblem('重新审核题',{review:'rejected'});
      const draft=await createProblem('未发布草稿',{published:false});
      const privateBank=(await pool.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES('私有库',$1,'private') RETURNING id",[adminId])).rows[0].id;
      const privateProblem=await createProblem('私有库题',{bankId:privateBank});
      const invalid=await createProblem('校验失效题',{validation:'WA'});
      const legacyPublic=await createProblem('升级前已公开待审题');
      await pool.query('UPDATE problem_versions SET school_visible_at=published_at WHERE id=$1',[legacyPublic.versionId]);
      const stale=await createProblem('旧发布版');
      const newer=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
        VALUES($1,'新发布版','stdio','输出二',1000,64,'print(2)','AC',now()) RETURNING id`,[stale.problemId])).rows[0].id;
      await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[newer,stale.problemId]);
      const batch=(items,auth=admin,headers)=>request('/problems/rank-review/approve-batch','POST',{items},auth,headers);
      const reviewStatus=async item=>(await pool.query('SELECT rank_review_status,school_visible_at,published_at FROM problem_versions WHERE id=$1',[item.versionId])).rows[0];

      const queue=(await request('/problems/rank-review','GET',undefined,admin)).data.items;
      assert.equal(queue.find(item=>item.versionId===invalid.versionId).validationStatus,'WA');
      assert.equal(queue.find(item=>item.versionId===first.versionId).validationStatus,'AC');
      assert.equal(queue.find(item=>item.versionId===legacyPublic.versionId).rankReviewStatus,'pending');
      assert.ok(queue.find(item=>item.versionId===legacyPublic.versionId).schoolVisibleAt,
        'legacy public versions remain accessible without automatic points approval');

      const rejectLegacy=await request(`/problems/${legacyPublic.problemId}/rank-review`,'PATCH',
        {versionId:legacyPublic.versionId,decision:'rejected',reason:'旧题暂不适合校内公开'},admin);
      assert.equal(rejectLegacy.status,200,JSON.stringify(rejectLegacy.data));
      assert.equal((await reviewStatus(legacyPublic)).rank_review_status,'rejected');
      assert.equal((await reviewStatus(legacyPublic)).school_visible_at,null,
        'rejecting a current legacy pending version also ends public access');

      assert.equal((await batch([first],teacher)).status,403);
      assert.equal((await batch([first],student)).status,403);
      assert.equal((await batch([first],admin,{'X-CSRF-Token':'forged'})).status,403);
      assert.equal((await batch([])).status,400);
      assert.equal((await batch([first,first])).status,400);
      assert.equal((await batch(Array.from({length:101},()=>first))).status,400);

      for(const [ineligible,code] of [[draft,'UNPUBLISHED'],[privateProblem,'NOT_SCHOOL_PUBLIC'],[invalid,'NOT_VALIDATED'],[stale,'VERSION_CHANGED']]){
        const failed=await batch([first,ineligible]);
        assert.equal(failed.status,409,JSON.stringify(failed.data));
        assert.equal(failed.data.error.code,code);
        assert.equal((await reviewStatus(first)).rank_review_status,'pending','one invalid item rolls back every approval');
        assert.equal((await reviewStatus(first)).school_visible_at,null);
      }
      assert.equal((await reviewStatus(draft)).published_at,null,'batch approval must never publish a draft');
      const invalidSingle=await request(`/problems/${invalid.problemId}/rank-review`,'PATCH',{versionId:invalid.versionId,decision:'approved'},admin);
      assert.equal(invalidSingle.status,409,'single-item approval cannot bypass AC validation');
      assert.equal(invalidSingle.data.error.code,'NOT_VALIDATED');

      const approved=await batch([second,rejected,first]);
      assert.equal(approved.status,200,JSON.stringify(approved.data));
      assert.equal(approved.data.approvedCount,3);
      assert.ok(approved.data.items.every(item=>item.validationStatus==='AC'));
      assert.deepEqual(new Set(approved.data.items.map(item=>item.versionId)),new Set([first.versionId,second.versionId,rejected.versionId]));
      for(const item of [first,second,rejected]){
        const version=await reviewStatus(item);
        assert.equal(version.rank_review_status,'approved');
        assert.ok(version.school_visible_at);
      }
      assert.equal((await batch([first])).status,409,'already approved versions are not reviewed twice');
      const auditCount=Number((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='problem.school_approve' AND metadata->>'batch'='true'")).rows[0].n);
      assert.equal(auditCount,3,'each approved version has one batch audit entry');
      assert.equal((await reviewStatus(draft)).published_at,null);
    } finally {
      if(server)await new Promise(resolve=>server.close(resolve));
      await pool.end();
      await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await manager.end();
    }
  });
