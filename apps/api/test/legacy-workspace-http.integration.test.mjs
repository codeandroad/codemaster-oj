import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { applicationDatabaseUrl, registerPersonal } from './support/workspace-accounts.mjs';
import { publishedSchoolProblems } from './support/school-problems.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('old bookmarks resolve through the current school membership and role on the real Nest API',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const manager = createPool(process.env.TEST_DATABASE_URL);
    const schema = 'legacy_boundary_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    let app;
    try {
      await migrate(pool);
      const legacyAccountId = await bootstrap(pool,{schoolSlug:'tianxing-chuangshiji', name: 'Original administrator', number: 'ADM', username: 'original-admin', password });
      app = await createApiApplication({ databaseUrl: await applicationDatabaseUrl(pool,url,schema), logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'http://boundary.test', COOKIE_SECURE: 'false' }) });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth, csrf = true } = {}) {
        const response = await fetch(base + '/api/v1' + path, { method,
          headers: { Origin: 'http://boundary.test', ...(body && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.data.csrfToken }) }) },
          body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
      }
      async function login(username) {
        const response = await request('/auth/login', { method: 'POST', body: { username, password } });
        assert.equal(response.status, 200);
        return response;
      }
      const admin = await login('original-admin');
      const original = (await request('/schools',{auth:admin})).data.items[0];
      const student = await registerPersonal(request,'original-student',password);
      const teacher = await registerPersonal(request,'original-teacher',password);
      const newSchool = await registerPersonal(request,'new-school-admin',password);
      const platform = await registerPersonal(request,'platform-only',password);
      const school = await provisionSchool(pool,{slug:'boundary-school',name:'Boundary School',adminUsername:'new-school-admin'});
      await provisionPlatformAdministrator(pool,{username:'platform-only'});
      for (const [auth,role] of [[student,'student'],[teacher,'teacher']]) {
        const invite = await request(`/schools/${original.id}/invitations`,{auth:admin,method:'POST',body:{role}});
        assert.equal(invite.status,201);
        assert.equal((await request('/school-invitations/accept',{auth,method:'POST',body:{token:invite.data.token}})).status,200);
        assert.equal((await request(`/schools/${original.id}/identities`,{auth:admin,method:'POST',
          body:{kind:role,name:'Original '+role,number:role,accountId:auth.data.user.id}})).status,201);
      }
      const prefix = `/schools/${original.id}`;
      const {bankId,links} = await publishedSchoolProblems(pool, original.id, teacher.data.user.id, 104);
      const problem = links[0];
      await t.test('bookmarks and direct IDs respect the requested school, including for platform administrators', async () => {
        for (const auth of [newSchool,platform]) {
          for (const path of ['/problems','/classes','/people','/assignments','/timed-practices','/learning-paths','/submissions',
            '/problems/'+problem.problemId]) {
            const response=await request(path+'?workspaceSchoolId='+original.id,{auth});
            assert.equal(response.status,404,path);
            assert.equal(response.data.error.code,'WORKSPACE_REQUIRED',path);
          }
          for (const section of ['problems','problems/'+problem.problemId,'problem-banks','courses','accounts','identities','settings','scholarship/ledger']) {
            assert.equal((await request(prefix+'/'+section,{auth})).status,404,section);
          }
          for (const path of ['/accounts','/admin/problem-banks','/reports/export','/assignments/'+problem.problemId,
            '/learning-resources','/paper4/papers','/scholarship/contents']) {
            const result=await request(path,{auth});
            assert.equal(result.status,410,path);
            assert.equal(result.data.error.code,'SCHOOL_WORKSPACE_REQUIRED',path);
          }
        }
        for (const route of ['/system-settings','/audit-events','/judge-status']) {
          assert.equal((await request(route,{auth:admin})).status,404);
          assert.equal((await request('/platform'+route,{auth:admin})).status,403);
          assert.equal((await request('/platform'+route,{auth:platform})).status,200);
        }
        assert.deepEqual((await request('/problems',{auth:newSchool})).data.items,[]);
        const result=await request('/problems/'+problem.problemId,{auth:student});
        assert.equal(result.status,200);
        assert.equal(result.data.definition.statement,'School-only statement');
        assert.ok(!JSON.stringify(result.data).includes('private reference'));
        assert.deepEqual((await request('/problems/'+problem.problemId+'?workspaceSchoolId='+original.id,{auth:student})).data,result.data);
        assert.equal((await request('/problems/'+problem.problemId,{auth:newSchool})).status,404);
        assert.equal((await request('/problems',{auth:platform})).status,404);
        assert.equal((await request(prefix+'/accounts',{auth:admin})).status,200);
        assert.equal((await request(prefix+'/accounts',{auth:student})).status,403);
      });

      await t.test('rejected writes leave school resources, submissions and rewards intact', async () => {
        const counts=()=>transaction(pool,async db=>{
          await db.query("SELECT set_config('campus.school_id',$1,true)",[original.id]);
          return (await db.query(`SELECT (SELECT count(*) FROM school_problems) problems,(SELECT count(*) FROM school_courses) courses,
            (SELECT count(*) FROM school_activities) activities,(SELECT count(*) FROM school_judge_jobs) jobs,
            (SELECT count(*) FROM school_scholarship_ledger) ledger,(SELECT count(*) FROM school_audit_events) audit`)).rows[0];
        });
        const before=await counts();
        for (const auth of [newSchool,platform]) {
          for (const [path,method] of [['/problems','POST'],['/problem-banks','POST'],['/assignments','POST'],['/learning-paths','POST'],
            ['/submissions','POST'],['/scholarship/assistance/unlock','POST']]) {
            const response=await request(path,{auth,method,body:{}});
            assert.equal(response.status,410,path);
            assert.equal(response.data.error.code,'SCHOOL_WORKSPACE_REQUIRED',path);
          }
          for (const path of ['/problem-banks','/courses','/problems/'+problem.problemId+'/submissions']) {
            const response=await request(prefix+path,{auth,method:'POST',body:{requestId:randomUUID()}});
            assert.equal(response.status,404,path);
          }
        }
        assert.deepEqual(await counts(),before);
      });

      await t.test('school groups retain their ordered membership and enforce owner, archive and workspace boundaries', async () => {
        const ids = links.map(link=>link.problemId);
        const group=randomUUID(), overlap=randomUUID(), archived=randomUUID(), otherOwner=randomUUID();
        await transaction(pool,async db=>{
          await db.query("SELECT set_config('campus.school_id',$1,true)",[original.id]);
          for (const [id,owner,retired] of [[group,teacher.data.user.id,false],[overlap,teacher.data.user.id,false],
            [archived,teacher.data.user.id,true],[otherOwner,legacyAccountId,false]]) {
            await db.query(`INSERT INTO practice_problem_groups(scope_id,id,name,bank_id,owner_account_id,created_at,archived_at)
              VALUES($1,$2,$3,$4,$5,now(),CASE WHEN $6 THEN now() END)`,[original.id,id,'Group '+id,bankId,owner,retired]);
          }
          for (const [id,members] of [[group,ids.slice(0,101)],[overlap,ids.slice(100,103)]]) {
            await db.query(`INSERT INTO practice_problem_group_members(scope_id,group_id,problem_id,position)
              SELECT $1,$2,id,pos FROM unnest($3::uuid[]) WITH ORDINALITY m(id,pos)`,[original.id,id,members]);
          }
        });
        const groups=prefix+'/problem-groups';
        const items=(await request(groups,{auth:admin})).data.items;
        assert.deepEqual(new Set(items.map(g=>g.id)),new Set([group,overlap,otherOwner]));
        assert.deepEqual(items.find(g=>g.id===group).problemIds,ids.slice(0,101));
        assert.deepEqual(items.find(g=>g.id===overlap).problemIds,ids.slice(100,103));
        assert.equal((await request(groups+'/'+archived,{auth:admin})).status,404);
        assert.deepEqual(new Set((await request(groups,{auth:teacher})).data.items.map(g=>g.id)),new Set([group,overlap]));
        assert.equal((await request(groups+'/'+otherOwner,{auth:teacher})).status,404);
        assert.equal((await request(groups,{auth:student})).status,403);
        for (const auth of [platform,newSchool]) assert.equal((await request(groups+'/'+group,{auth})).status,404);
        assert.deepEqual((await request('/platform/problem-groups',{auth:platform})).data.items,[]);
        assert.equal((await request('/admin/problem-banks/'+bankId+'/problems?groupId='+group,{auth:admin})).status,410);
      });

      await t.test('shared login, self profile, anonymous site info and school governance remain available', async () => {
        assert.equal((await request('/site-info')).status, 200);
        assert.equal((await request('/problems')).status, 401);
        assert.equal((await request('/auth/me', { auth: newSchool })).status, 200);
        const ownProfile = await request('/auth/profile', { auth: newSchool, method: 'PATCH', body: { nickname: 'School nickname' } });
        assert.equal(ownProfile.status, 200);
        assert.equal(ownProfile.data.user.nickname, 'School nickname');
        assert.equal((await request('/schools', { auth: newSchool })).status, 200);
        assert.equal((await request(`/schools/${school.id}/members`, { auth: newSchool })).status, 200);
        assert.equal((await request('/platform/schools', { auth: platform })).status, 200);
        assert.equal((await request('/platform/schools', { auth: newSchool })).status, 403);
        assert.equal((await request('/auth/profile', { auth: newSchool, csrf: false, method: 'PATCH', body: { nickname: 'Blocked' } })).status, 403);
        assert.equal((await request('/auth/logout', { auth: newSchool, method: 'POST', body: {} })).status, 200);
        assert.equal((await request('/auth/me', { auth: newSchool })).status, 401);
      });
    } finally {
      if (app) await app.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
