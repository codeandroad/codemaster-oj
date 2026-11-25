import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { applicationDatabaseUrl, registerPersonal, seedUnlinkedMembership } from './support/workspace-accounts.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('school claims and reviewed applications stay within each school on the real Nest API',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const manager = createPool(process.env.TEST_DATABASE_URL);
    const schema = 'schools_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    let app;
    try {
      await migrate(pool);
      await bootstrap(pool,{schoolSlug:'tianxing-chuangshiji', name: 'Legacy admin', number: 'ADM', username: 'legacy-admin', password });
      app = await createApiApplication({
        databaseUrl: await applicationDatabaseUrl(pool,url,schema), logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'http://schools.test', COOKIE_SECURE: 'false' }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth, csrf = true } = {}) {
        const response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Origin: 'http://schools.test',
            ...(body && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.data.csrfToken }) }),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return {
          status: response.status, data: await response.json(),
          cookie: response.headers.get('set-cookie')?.split(';')[0],
        };
      }
      const legacy = await request('/auth/login', { method: 'POST', body: { username: 'legacy-admin', password } });
      assert.equal(legacy.status, 200);
      const alphaAdmin = await registerPersonal(request,'alpha-admin',password);
      const betaAdmin = await registerPersonal(request,'beta-admin',password);
      const learner = await registerPersonal(request,'test-learner',password);
      const another = await registerPersonal(request,'test-another',password);
      const platform = await registerPersonal(request,'platform-admin',password);
      await provisionPlatformAdministrator(pool,{username:'platform-admin'});
      const alpha = await provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      const beta = await provisionSchool(pool, { slug: 'school-beta', name: 'Beta School', adminUsername: 'beta-admin' });
      const retry = await provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      assert.equal(retry.id, alpha.id);
      await assert.rejects(provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'beta-admin' }), { status: 409 });
      await assert.rejects(provisionSchool(pool, { slug: 'invalid slug', name: 'Invalid', adminUsername: 'alpha-admin' }), { status: 400 });

      const members = school => `/schools/${school.id}/members`;
      assert.equal((await request('/schools')).status, 401);
      assert.deepEqual((await request('/schools', { auth: alphaAdmin })).data.items.map(s => s.id), [alpha.id]);
      assert.equal((await request('/platform/accounts', { auth: alphaAdmin })).status, 403, 'school admin grant cannot manage platform accounts');
      assert.equal((await request(members(beta), { auth: alphaAdmin })).status, 404);
      assert.equal((await request(members(alpha), { auth: legacy })).status, 404, 'legacy admin cannot browse a pilot school');
      const post = (path, auth, body, csrf=true) => request(path,{method:'POST',auth,body,csrf});
      const path = school => `/schools/${school.id}/join-requests`;
      const facts = {kind:'student',number:'S001',name:'Alpha Learner'};
      const decide = (school,id,auth,decision,identityId) => post(path(school)+'/'+id+'/decision',auth,{decision,identityId});
      assert.equal((await post('/school-invitations/accept',learner,{token:'unused'})).status,404);
      assert.equal((await post('/schools/'+alpha.id+'/invitations',alphaAdmin,{role:'school_admin'})).status,404);
      assert.equal((await post('/auth/register',undefined,{})).status,404);
      assert.equal((await post('/auth/claim-identity',undefined,{})).status,401);
      assert.equal((await post('/auth/verify-identity',undefined,{})).status,401);
      assert.equal((await post(path(alpha),undefined,facts)).status,401);
      assert.equal((await post(path(alpha),learner,facts,false)).status,403);
      assert.equal((await post(path(alpha),learner,{...facts,kind:'school_admin'})).status,400);
      const submissions=await Promise.all([1,2].map(()=>post(path(alpha),learner,facts)));
      assert.deepEqual(submissions.map(r=>r.status).sort(),[200,201]);
      const id=submissions[0].data.id;
      assert.equal(id,submissions[1].data.id);
      assert.equal((await post(path(alpha),learner,{...facts,name:'Different'})).status,409);
      assert.deepEqual((await request('/schools',{auth:learner})).data.items,[]);
      assert.deepEqual((await request('/schools/join-requests',{auth:another})).data.items,[]);
      assert.equal((await request('/schools/join-requests',{auth:learner})).data.items[0].status,'pending');
      const list = async () => (await request(path(alpha),{auth:alphaAdmin})).data.items;
      assert.equal((await list())[0].identityId,null);
      const make = async (school,auth,body) => (await post('/schools/'+school.id+'/identities',auth,body)).data;
      const local=await make(alpha,alphaAdmin,facts),foreign=await make(beta,betaAdmin,facts);
      const different=await make(alpha,alphaAdmin,{...facts,number:'S002'});
      assert.equal((await list())[0].identityId,local.id);
      assert.equal((await request(path(alpha),{auth:learner})).status,404);
      assert.equal((await decide(beta,id,betaAdmin,'approved',foreign.id)).status,404);
      assert.equal((await decide(alpha,id,betaAdmin,'approved',local.id)).status,404);
      for (const wrong of [foreign,different]) assert.equal((await decide(alpha,id,alphaAdmin,'approved',wrong.id)).status,409);
      const collision=await post(path(alpha),another,facts);
      const sourceCode=(await post('/schools/'+alpha.id+'/identities/'+local.id+'/activation-code',alphaAdmin,{})).data.activationCode;
      const approvals=await Promise.all([1,2].map(()=>decide(alpha,id,alphaAdmin,'approved',local.id)));
      assert.deepEqual(approvals.map(r=>r.status),[200,200]);
      assert.equal((await decide(alpha,collision.data.id,alphaAdmin,'approved',local.id)).status,409);
      assert.equal((await decide(alpha,collision.data.id,alphaAdmin,'rejected')).status,200);
      assert.deepEqual((await request('/schools',{auth:another})).data.items,[]);
      assert.equal((await request('/schools/join-requests',{auth:another})).data.items[0].status,'rejected');
      assert.equal((await request(members(alpha),{auth:learner})).status,403);
      assert.equal((await pool.query('SELECT account_id FROM school_identities WHERE id=$1',[local.id])).rows[0].account_id,learner.data.user.id);
      assert.equal((await post('/auth/claim-identity',another,{...facts,schoolSlug:alpha.slug,activationCode:sourceCode})).status,400);
      assert.equal((await post(path(alpha),learner,facts)).status,409);
      const pending=await post(path(beta),learner,facts);
      const issue=await post('/schools/'+beta.id+'/identities/'+foreign.id+'/activation-code',betaAdmin,{});
      const claim={...facts,schoolSlug:beta.slug,activationCode:issue.data.activationCode};
      assert.equal((await post('/auth/claim-identity',learner,claim,false)).status,403);
      assert.equal((await post('/auth/claim-identity',learner,claim)).status,200);
      assert.deepEqual(new Set((await request('/schools',{auth:learner})).data.items.map(s=>s.id)),new Set([alpha.id,beta.id]));
      assert.equal((await decide(beta,pending.data.id,betaAdmin,'approved',foreign.id)).status,409);
      assert.equal((await request('/schools/join-requests',{auth:learner})).data.items.find(r=>r.id===pending.data.id).status,'superseded');
      assert.equal((await request('/auth/me',{auth:learner})).data.user.id,learner.data.user.id);
      assert.equal((await post('/auth/claim-identity',another,claim)).status,400);
      assert.equal((await request('/platform/accounts',{auth:learner})).status,403);

      await t.test('students without a number require an independently verified choice of school record', async () => {
        const applicant = await registerPersonal(request,'unknown-number',password);
        const info = {kind:'student',name:'Same Name',rosterHint:'Year 8, homeroom Lee'};
        for (const body of [{...info,kind:'teacher'},{...info,rosterHint:' '},{...info,rosterHint:'x'.repeat(161)}]) {
          assert.equal((await post(path(alpha),applicant,body)).status,400);
        }
        const a = await make(alpha,alphaAdmin,{...info,number:'N01'});
        const b = await make(alpha,alphaAdmin,{...info,number:'N02'});
        const outside = await make(beta,betaAdmin,{...info,number:'N02'});
        const teacher = await make(alpha,alphaAdmin,{...info,kind:'teacher',number:'T02'});
        const submission = await post(path(alpha),applicant,info);
        assert.equal(submission.status,201);
        const requestId = submission.data.id;
        assert.equal((await post(path(alpha),applicant,{...info,number:' '})).data.id,requestId);
        assert.equal((await post(path(alpha),applicant,{...info,rosterHint:'Other'})).status,409);
        assert.deepEqual((await request('/schools',{auth:applicant})).data.items,[]);
        assert.deepEqual(Object.keys(submission.data).sort(),['id','status']);
        const item = (await list()).find(r=>r.id===requestId);
        assert.equal(item.identityId,null);
        assert.equal(item.rosterHint,info.rosterHint);
        const candidates = path(alpha)+'/'+requestId+'/candidates';
        assert.equal((await request(candidates,{auth:applicant})).status,404);
        assert.equal((await request(candidates,{auth:betaAdmin})).status,404);
        assert.deepEqual((await request(candidates,{auth:alphaAdmin})).data.items.map(r=>r.id),[a.id,b.id]);
        const approve = (identityId,verificationMethod) => post(path(alpha)+'/'+requestId+'/decision',alphaAdmin,{decision:'approved',identityId,verificationMethod});
        assert.equal((await approve(b.id)).status,400);
        assert.equal((await approve(b.id,'same_name')).status,400);
        for (const wrong of [teacher,local,outside]) assert.equal((await approve(wrong.id,'in_person')).status,409);
        assert.equal((await approve(b.id,'school_contact')).status,200);
        assert.equal((await approve(b.id,'school_contact')).status,200);
        assert.equal((await request(path(alpha)+'/'+requestId+'/candidates',{auth:alphaAdmin})).data.items.length,0);
        const own = await request('/schools/join-requests',{auth:applicant});
        assert.equal(own.data.items[0].status,'approved');
        assert.equal(own.data.items[0].number,null);
        const checked = await pool.query('SELECT identity_id,decided_by,verification_method FROM school_join_requests WHERE id=$1',[requestId]);
        assert.deepEqual(checked.rows[0],{identity_id:b.id,decided_by:alphaAdmin.data.user.id,verification_method:'school_contact'});
        const sibling = await registerPersonal(request,'other-same-name',password);
        const next = await post(path(alpha),sibling,info);
        assert.deepEqual((await request(path(alpha)+'/'+next.data.id+'/candidates',{auth:alphaAdmin})).data.items.map(r=>r.id),[a.id]);
        const used = await post(path(alpha)+'/'+next.data.id+'/decision',alphaAdmin,{decision:'approved',identityId:b.id,verificationMethod:'in_person'});
        assert.equal(used.status,409);
        assert.equal((await decide(alpha,next.data.id,alphaAdmin,'rejected')).status,200);
        assert.deepEqual((await request('/schools',{auth:sibling})).data.items,[]);
      });

      // Members who previously used a general invitation can finish linking their original dossier.
      await seedUnlinkedMembership(pool,beta.id,another.data.user.id,'student');
      const memberFacts={kind:'student',name:'Previous member',number:'S003'};
      const oldMemberRequest=await post(path(beta),another,memberFacts);
      assert.equal(oldMemberRequest.status,201);
      const existing=await make(beta,betaAdmin,memberFacts);
      const bind=await request('/schools/'+beta.id+'/identities/'+existing.id+'/account',{
        method:'PATCH',auth:betaAdmin,body:{accountId:another.data.user.id},
      });
      assert.equal(bind.status,200);
      assert.equal((await request('/schools/join-requests',{auth:another})).data.items.find(r=>r.id===oldMemberRequest.data.id).status,'superseded');
      assert.equal((await decide(beta,oldMemberRequest.data.id,betaAdmin,'approved',existing.id)).status,409);
      assert.equal((await post(path(beta),another,memberFacts)).status,409);
      const attempts=await request('/schools/'+beta.id+'/accounts/'+another.data.user.id+'/access',{
        method:'PATCH',auth:betaAdmin,body:{suspended:true},
      });
      assert.equal(attempts.status,200);
      assert.equal((await post(path(beta),another,memberFacts)).data.error.code,'SCHOOL_ACCESS_SUSPENDED');
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
