import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { applicationDatabaseUrl, registerPersonal } from './support/workspace-accounts.mjs';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('explicit platform governance preserves teaching roles and enforces authorization on the real Nest API',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const manager = createPool(process.env.TEST_DATABASE_URL);
    const schema = 'platform_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    let app;
    try {
      await migrate(pool);
      await bootstrap(pool,{schoolSlug:'tianxing-chuangshiji', name: 'Legacy operator', number: 'ADM', username: 'legacy-operator', password });
      app = await createApiApplication({
        databaseUrl: await applicationDatabaseUrl(pool,url,schema), logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'http://platform.test', COOKIE_SECURE: 'false' }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth, csrf = true } = {}) {
        const response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Origin: 'http://platform.test',
            ...(body && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.data.csrfToken }) }),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
      }
      const legacy = await request('/auth/login', { method: 'POST', body: { username: 'legacy-operator', password } });
      assert.equal(legacy.status, 200);
      const originalSchool = (await request('/schools',{auth:legacy})).data.items.find(s=>s.slug==='tianxing-chuangshiji');
      const platform = await registerPersonal(request,'platform-operator',password);
      const firstAdmin = await registerPersonal(request,'school-founder',password);
      const teacher = await registerPersonal(request,'school-teacher',password);
      const learner = await registerPersonal(request,'school-learner',password);
      const disabled = await registerPersonal(request,'disabled-target',password);
      const studentInvite = await request(`/schools/${originalSchool.id}/invitations`, {
        method:'POST',auth:legacy,body:{role:'student'},
      });
      assert.equal(studentInvite.status,201);
      assert.equal((await request('/school-invitations/accept',{
        method:'POST',auth:platform,body:{token:studentInvite.data.token},
      })).status,200);

      assert.equal((await request('/platform/schools')).status, 401);
      assert.equal((await request('/platform/schools', { auth: legacy })).status, 403, 'legacy admin is not a platform admin');
      assert.equal((await request('/platform/schools', { auth: platform })).status, 403);
      const grants = await Promise.all([
        provisionPlatformAdministrator(pool, { username: 'platform-operator' }),
        provisionPlatformAdministrator(pool, { username: 'platform-operator' }),
      ]);
      assert.deepEqual(grants.map(g => g.created).sort(), [false,true]);
      assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.administrator.provision'")).rows[0].n, 1);
      assert.deepEqual((await request('/auth/me', { auth: platform })).data.user.roles, []);
      assert.equal((await request('/auth/me', { auth: platform })).data.user.platformAdmin, true);
      assert.deepEqual((await request('/schools',{auth:platform})).data.items[0].roles,['student']);
      assert.equal((await request('/platform/accounts', { auth: platform })).status, 200);
      const protectedId=platform.data.user.id, prefix=`/schools/${originalSchool.id}`;
      for (const [path,method,body] of [
        [`/platform/accounts/${protectedId}/login`, 'PATCH', {disabled:true}],
        [`${prefix}/accounts/${protectedId}/roles`, 'PATCH', {role:'teacher',expectedRole:'student',administrator:false,expectedAdministrator:false}],
        [`${prefix}/accounts/${protectedId}/access`, 'PATCH', {suspended:true}],
        [`${prefix}/members/${protectedId}/reset`, 'POST', {}],
      ]) {
        assert.equal((await request(path,{method,body,auth:legacy})).status,403,path);
      }

      const createBody = { slug: 'platform-school', name: 'Platform School', adminUsername: 'school-founder' };
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, csrf: false, body: createBody })).status, 403);
      assert.equal((await request('/platform/schools', { method: 'POST', auth: legacy, body: createBody })).status, 403);
      const created = await Promise.all([1,2].map(() => request('/platform/schools', { method: 'POST', auth: platform, body: createBody })));
      assert.deepEqual(created.map(r => r.status).sort(), [200,201]);
      assert.equal(created[0].data.id, created[1].data.id);
      const school = created[0].data;
      assert.equal(school.slug, createBody.slug);
      assert.equal((await request('/platform/schools', { auth: firstAdmin })).status, 403, 'school admin cannot manage the platform');
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, body: { ...createBody, adminUsername: 'school-teacher' } })).status, 409);
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, body: { ...createBody, slug: 'missing-admin', adminUsername: 'missing-person' } })).status, 404);
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, body: { ...createBody, slug: 'invalid slug' } })).status, 400);
      const memberPath = `/schools/${school.id}/members`;
      assert.equal((await request(memberPath, { auth: platform })).status, 404, 'governance does not grant a school directory');
      assert.equal((await request(memberPath, { auth: firstAdmin })).status, 200);

      const rename = await request(`/platform/schools/${school.id}`, { method: 'PATCH', auth: platform, body: { name: 'Renamed School', expectedName: school.name } });
      assert.equal(rename.status, 200);
      assert.equal(rename.data.name, 'Renamed School');
      assert.equal((await request(`/platform/schools/${school.id}`, { method: 'PATCH', auth: platform, body: { name: 'Conflicting name', expectedName: school.name } })).status, 409);
      assert.equal((await request(`/platform/schools/${school.id}`, { method: 'PATCH', auth: platform, body: { name: 'Renamed School', expectedName: school.name } })).status, 200, 'exact rename retry is harmless');

      const site = (await request('/site-info')).data;
      const renameOriginal = name => request(`/platform/schools/${originalSchool.id}`, {
        method:'PATCH',auth:platform,body:{name,expectedName:originalSchool.name},
      });
      const renamed = await renameOriginal('Original school renamed in QA');
      assert.equal(renamed.status,200);
      assert.equal((await request(`/schools/${originalSchool.id}/settings`,{auth:legacy})).data.name,renamed.data.name);
      assert.deepEqual((await request('/site-info')).data,site,'renaming one school keeps platform branding independent');

      const invitation = await request(`/schools/${school.id}/invitations`, { method: 'POST', auth: firstAdmin, body: { role: 'teacher' } });
      assert.equal(invitation.status, 201);
      assert.equal((await request('/school-invitations/accept', { method: 'POST', auth: teacher, body: { token: invitation.data.token } })).status, 200);
      const identity = await request(`/schools/${school.id}/identities`, {
        method: 'POST', auth: firstAdmin, body: { kind: 'teacher', name: 'School teacher', number: 'T-01', accountId: teacher.data.user.id },
      });
      assert.equal(identity.status, 201);
      const classResponse = await request(`/schools/${school.id}/classes`, { method: 'POST', auth: firstAdmin, body: { name: 'Teaching class', type: 'training' } });
      assert.equal(classResponse.status, 201);
      assert.equal((await request(`/schools/${school.id}/classes/${classResponse.data.id}/roster`, {
        method: 'POST', auth: firstAdmin, body: { identityId: identity.data.id },
      })).status, 201);
      const originalIdentity = (await pool.query('SELECT * FROM school_identities WHERE id=$1', [identity.data.id])).rows[0];
      const appointPath = `/platform/schools/${school.id}/administrators`;
      assert.equal((await request(appointPath, { method: 'POST', auth: firstAdmin, body: { username: 'school-teacher' } })).status, 403);
      const appointments = await Promise.all([1,2].map(() => request(appointPath, { method: 'POST', auth: platform, body: { username: 'school-teacher' } })));
      assert.ok(appointments.every(r => r.status === 200));
      assert.deepEqual(appointments.map(r => r.data.created).sort(), [false,true]);
      assert.equal((await pool.query('SELECT role FROM school_memberships WHERE school_id=$1 AND account_id=$2', [school.id, teacher.data.user.id])).rows[0].role, 'teacher');
      assert.deepEqual((await pool.query('SELECT * FROM school_identities WHERE id=$1', [identity.data.id])).rows[0], originalIdentity, 'administrator grant preserves the bound teaching identity');
      assert.equal((await pool.query('SELECT count(*)::int n FROM school_class_roster WHERE identity_id=$1', [identity.data.id])).rows[0].n, 1);
      assert.deepEqual((await request('/schools', { auth: teacher })).data.items.find(s => s.id === school.id).roles, ['school_admin','teacher']);
      assert.equal((await request(memberPath, { auth: teacher })).status, 200);
      const appointedMember = (await request(memberPath, { auth:firstAdmin })).data.items.find(m => m.accountId === teacher.data.user.id);
      assert.equal(appointedMember.role, 'teacher');
      assert.equal(appointedMember.administrator, true);
      assert.ok((await request(memberPath+'?role=school_admin', { auth:firstAdmin })).data.items.some(m => m.accountId === teacher.data.user.id));
      assert.equal((await request(`${memberPath}/${teacher.data.user.id}`, { method: 'DELETE', auth: firstAdmin })).status, 404, 'school member removal cannot revoke a platform-appointed administrator');
      assert.equal((await request(`/schools/${originalSchool.id}/members`, {auth:teacher})).status,404,'appointment applies only to the selected school');

      // Additional administrator capabilities authorize invitations, and their
      // revocation invalidates outstanding invitations without touching teaching.
      const allowed = await request(`/schools/${school.id}/invitations`, { method: 'POST', auth: teacher, body: { role: 'student' } });
      assert.equal(allowed.status, 201);
      assert.equal((await request('/school-invitations/accept', { method: 'POST', auth: learner, body: { token: allowed.data.token } })).status, 200);
      const unused = await request(`/schools/${school.id}/invitations`, { method: 'POST', auth: teacher, body: { role: 'student' } });
      await pool.query('UPDATE school_administrators SET revoked_at=clock_timestamp() WHERE school_id=$1 AND account_id=$2', [school.id,teacher.data.user.id]);
      assert.equal((await request('/school-invitations/accept', { method: 'POST', auth: disabled, body: { token: unused.data.token } })).status, 400);
      assert.equal((await request(memberPath, { auth: teacher })).status, 403);
      assert.deepEqual((await request('/schools', { auth: teacher })).data.items.find(s => s.id === school.id).roles, ['teacher']);

      assert.equal((await request(`/platform/accounts/${disabled.data.user.id}/login`, {auth:platform,method:'PATCH',body:{disabled:true}})).status,200);
      assert.equal((await request(appointPath, { method: 'POST', auth: platform, body: { username: 'disabled-target' } })).status, 404);
      const list = await request('/platform/schools', { auth: platform });
      assert.equal(list.status, 200);
      const listed = list.data.items.find(s => s.id === school.id);
      assert.deepEqual(listed.counts, { members:3,identities:1,classes:1,banks:0,courses:0,assignments:0,papers:0 });
      assert.equal(listed.administrators.length, 1);
      assert.equal(listed.administrators[0].accountId, firstAdmin.data.user.id);
      assert.equal(list.data.items.find(s => s.id===originalSchool.id).name, renamed.data.name);
      assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.school.create'")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.school.administrator.grant'")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action LIKE 'platform.%'")).rows[0].n, 0);

      await t.test('a newly created school exposes the school modules to each role with isolated data', async () => {
        const founder = await request('/auth/register-personal', {
          method: 'POST', body: { username: 'independent-founder', displayName: 'Independent founder', password },
        });
        assert.equal(founder.status, 201);
        assert.deepEqual((await request('/schools', { auth: founder })).data.items, []);
        const candidates = '/platform/school-admin-candidates';
        assert.equal((await request(`${candidates}?q=founder`)).status, 401);
        for (const auth of [legacy, firstAdmin, founder]) {
          assert.equal((await request(`${candidates}?q=founder`, { auth })).status, 403);
        }
        for (const query of ['Independent%20founder', 'INDEPENDENT-FOUNDER']) {
          const found = await request(`${candidates}?q=${query}`, { auth: platform });
          assert.equal(found.status, 200);
          assert.deepEqual(found.data.items, [{
            accountId: founder.data.user.id, name: 'Independent founder', username: 'independent-founder',
          }]);
        }
        for (const query of ['', 'f', '%25%25', 'disabled-target']) {
          const found = await request(`${candidates}?q=${query}`, { auth: platform });
          assert.equal(found.status, 200);
          assert.deepEqual(found.data.items, []);
        }
        const requestId = randomUUID();
        const create = { method: 'POST', auth: platform, body: {
          requestId, name: 'New school', adminAccountId: founder.data.user.id,
        } };
        const stale = await request('/platform/schools', {
          ...create, body: { ...create.body, adminAccountId: disabled.data.user.id },
        });
        assert.equal(stale.status, 404);
        const attempts = await Promise.all([request('/platform/schools', create), request('/platform/schools', create)]);
        assert.deepEqual(attempts.map(response => response.status).sort(), [200, 201]);
        const [fresh, retry] = attempts;
        assert.equal(fresh.data.id, retry.data.id);
        assert.equal(fresh.data.slug, `school-${requestId}`);
        const prefix = `/schools/${fresh.data.id}`;
        const memberships = await request('/schools', { auth: founder });
        assert.equal(memberships.status, 200);
        assert.deepEqual(memberships.data.items.map(({ id, roles }) => ({ id, roles })), [
          { id: fresh.data.id, roles: ['school_admin'] },
        ]);

        const commonLists = ['classes', 'courses', 'problems', 'activities?kind=assignment', 'activities?kind=timed', 'paper4/papers', 'paper4/activities', 'leaderboard'];
        const adminLists = ['identities', 'problem-banks', 'scholarship/ledger'];
        for (const module of [...commonLists, ...adminLists]) {
          const path = `${prefix}/${module}`;
          const own = await request(path, { auth: founder });
          assert.equal(own.status, 200, path);
          assert.deepEqual(own.data.items, [], `${module} starts with no other-school records`);
          assert.equal((await request(path, { auth: firstAdmin })).status, 404, `${module} rejects another school administrator`);
        }
        const settings = await request(`${prefix}/scholarship/settings`, { auth: founder });
        assert.equal(settings.status, 200);
        assert.ok(Number.isInteger(settings.data.initialGrant));
        assert.equal((await request(`${prefix}/judge-status`, { auth: founder })).status, 200);
        assert.equal((await request(`${prefix}/settings`, { auth: founder })).data.id, fresh.data.id);
        assert.equal((await request(`${prefix}/settings`, { auth: platform })).status, 404);
        assert.equal((await request('/platform/accounts', { auth: founder })).status, 403);

        for (const [role, auth] of [['teacher', teacher], ['student', learner]]) {
          const invite = await request(`${prefix}/invitations`, { method: 'POST', auth: founder, body: { role } });
          assert.equal(invite.status, 201);
          assert.equal((await request('/school-invitations/accept', { method: 'POST', auth, body: { token: invite.data.token } })).status, 200);
          const linked = await request(`${prefix}/identities`, {
            method: 'POST', auth: founder, body: { kind: role, name: `New school ${role}`, number: role, accountId: auth.data.user.id },
          });
          assert.equal(linked.status, 201);
          for (const module of commonLists) {
            const response = await request(`${prefix}/${module}`, { auth });
            assert.equal(response.status, 200, `${role} can open ${module}`);
            if (module.startsWith('activities?')) assert.equal(response.data.canCreate, role === 'teacher');
          }
          assert.equal((await request(`${prefix}/settings`, { auth })).status, 403);
        }
        const wallet = await request(`${prefix}/scholarship/wallet`, { auth: learner });
        assert.equal(wallet.status, 200);
        assert.equal(wallet.data.balance, settings.data.initialGrant);

        const bank = await request(`${prefix}/problem-banks`, {
          method: 'POST', auth: teacher, body: { name: 'New school private bank', requestId: randomUUID() },
        });
        assert.equal(bank.status, 201);
        const banks = await request(`${prefix}/problem-banks`, { auth: founder });
        assert.deepEqual(banks.data.items.map(({ id }) => id), [bank.data.id]);
        assert.deepEqual((await request(`${prefix}/problem-banks`, { auth: learner })).data.items, []);
        assert.deepEqual((await request(`/schools/${school.id}/problem-banks`, { auth: teacher })).data.items, []);
      });

      // Existing sessions must lose governance access as soon as the grant is revoked.
      await pool.query('UPDATE platform_admins SET revoked_at=clock_timestamp() WHERE account_id=$1', [platform.data.user.id]);
      assert.equal((await request('/platform/schools', { auth: platform })).status, 403);
      await provisionPlatformAdministrator(pool, { username: 'platform-operator' });
      assert.equal((await request('/platform/schools', { auth: platform })).status, 200);
      await pool.query('UPDATE accounts SET disabled_at=clock_timestamp() WHERE id=$1', [platform.data.user.id]);
      assert.equal((await request('/platform/schools', { auth: platform })).status, 401);
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
