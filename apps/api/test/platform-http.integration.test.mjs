import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';
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
      await bootstrap(pool, { name: 'Legacy operator', number: 'ADM', username: 'legacy-operator', password });
      const grantScript = await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8');
      const grantSql = grantScript.match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
      await pool.query(grantSql.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const appUrl = new URL(url);
      appUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      app = await createApiApplication({
        databaseUrl: appUrl.href, logger: false,
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
      async function register(login, number) {
        const name = 'QA ' + login;
        const issue = await request('/people', { method: 'POST', auth: legacy, body: { kind: 'student', number, name } });
        assert.equal(issue.status, 201);
        const registered = await request('/auth/register', {
          method: 'POST', body: { kind: 'student', number, name, username: login, password, activationCode: issue.data.activationCode },
        });
        assert.equal(registered.status, 201);
        return registered;
      }
      const platform = await register('platform-operator', 'PLAT');
      const firstAdmin = await register('school-founder', 'FOUND');
      const teacher = await register('school-teacher', 'TEACH');
      const learner = await register('school-learner', 'LEARN');
      const disabled = await register('disabled-target', 'DISABLE');

      assert.equal((await request('/platform/schools')).status, 401);
      assert.equal((await request('/platform/schools', { auth: legacy })).status, 403, 'legacy admin is not a platform admin');
      assert.equal((await request('/platform/schools', { auth: platform })).status, 403);
      const grants = await Promise.all([
        provisionPlatformAdministrator(pool, { username: 'platform-operator' }),
        provisionPlatformAdministrator(pool, { username: 'platform-operator' }),
      ]);
      assert.deepEqual(grants.map(g => g.created).sort(), [false,true]);
      assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.administrator.provision'")).rows[0].n, 1);
      assert.deepEqual((await request('/auth/me', { auth: platform })).data.user.roles, ['student']);
      assert.equal((await request('/auth/me', { auth: platform })).data.user.platformAdmin, true);
      assert.equal((await request('/accounts', { auth: platform })).status, 403, 'platform capability does not grant legacy account access');
      const protectedMutations = [
        [`/accounts/${platform.data.user.id}`, 'PATCH', { disabled: true }],
        [`/accounts/${platform.data.user.id}`, 'PATCH', { roles: ['admin'] }],
        [`/people/${platform.data.user.identityId}`, 'PATCH', { name: 'Changed by school admin' }],
        [`/people/${platform.data.user.identityId}/reset`, 'POST', {}],
        [`/people/${platform.data.user.identityId}/unbind`, 'POST', {}],
      ];
      for (const [path,method,body] of protectedMutations) {
        const denied = await request(path, { method,body,auth:legacy });
        assert.equal(denied.status, 403, path);
        assert.equal(denied.data.error?.code ?? denied.data.code, 'PLATFORM_ACCOUNT_PROTECTED', path);
      }

      const createBody = { slug: 'platform-school', name: 'Platform School', adminUsername: 'school-founder' };
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, csrf: false, body: createBody })).status, 403);
      assert.equal((await request('/platform/schools', { method: 'POST', auth: legacy, body: createBody })).status, 403);
      const created = await Promise.all([1,2].map(() => request('/platform/schools', { method: 'POST', auth: platform, body: createBody })));
      assert.deepEqual(created.map(r => r.status).sort(), [200,201]);
      assert.equal(created[0].data.id, created[1].data.id);
      const school = created[0].data;
      assert.equal(school.legacy, false);
      assert.equal((await request('/platform/schools', { auth: firstAdmin })).status, 403, 'school admin cannot manage the platform');
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, body: { ...createBody, adminUsername: 'school-teacher' } })).status, 409);
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, body: { ...createBody, slug: 'missing-admin', adminUsername: 'missing-person' } })).status, 404);
      assert.equal((await request('/platform/schools', { method: 'POST', auth: platform, body: { ...createBody, slug: 'legacy-school' } })).status, 400);
      const memberPath = `/schools/${school.id}/members`;
      assert.equal((await request(memberPath, { auth: platform })).status, 404, 'governance does not grant a school directory');
      assert.equal((await request(memberPath, { auth: firstAdmin })).status, 200);

      const rename = await request(`/platform/schools/${school.id}`, { method: 'PATCH', auth: platform, body: { name: 'Renamed School', expectedName: school.name } });
      assert.equal(rename.status, 200);
      assert.equal(rename.data.name, 'Renamed School');
      assert.equal((await request(`/platform/schools/${school.id}`, { method: 'PATCH', auth: platform, body: { name: 'Conflicting name', expectedName: school.name } })).status, 409);
      assert.equal((await request(`/platform/schools/${school.id}`, { method: 'PATCH', auth: platform, body: { name: 'Renamed School', expectedName: school.name } })).status, 200, 'exact rename retry is harmless');

      const originalSettings = (await pool.query('SELECT settings FROM site_settings WHERE id=true')).rows[0].settings;
      assert.equal((await request(`/platform/schools/${LEGACY_SCHOOL_ID}`, {
        method:'PATCH', auth:platform, body:{ name:'Legacy school renamed in QA',expectedName:'天行创世纪学校' },
      })).status, 200);
      assert.deepEqual((await pool.query('SELECT settings FROM site_settings WHERE id=true')).rows[0].settings,
        { ...originalSettings,schoolName:'Legacy school renamed in QA' }, 'legacy rename only updates the old school name in site settings');
      assert.equal((await request('/site-info')).data.schoolName, 'Legacy school renamed in QA');
      assert.equal((await request('/system-settings', {
        method:'PATCH', auth:legacy, body:{ schoolName:'天行创世纪学校' },
      })).status, 200);
      assert.equal((await pool.query('SELECT name FROM schools WHERE id=$1', [LEGACY_SCHOOL_ID])).rows[0].name, '天行创世纪学校');

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
      assert.equal((await request(`/platform/schools/${LEGACY_SCHOOL_ID}/administrators`, { method: 'POST', auth: platform, body: { username: 'school-teacher' } })).status, 409);

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

      await pool.query('UPDATE accounts SET disabled_at=clock_timestamp() WHERE id=$1', [disabled.data.user.id]);
      assert.equal((await request(appointPath, { method: 'POST', auth: platform, body: { username: 'disabled-target' } })).status, 404);
      const list = await request('/platform/schools', { auth: platform });
      assert.equal(list.status, 200);
      const listed = list.data.items.find(s => s.id === school.id);
      assert.deepEqual(listed.counts, { members:3,identities:1,classes:1,banks:0,courses:0,assignments:0,papers:0 });
      assert.equal(listed.administrators.length, 1);
      assert.equal(listed.administrators[0].accountId, firstAdmin.data.user.id);
      assert.equal(list.data.items.find(s => s.legacy).name, '天行创世纪学校');
      assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.school.create'")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.school.administrator.grant'")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action LIKE 'platform.%'")).rows[0].n, 0);

      await t.test('a newly created school exposes the school modules to each role with isolated data', async () => {
        const founder = await request('/auth/register-personal', {
          method: 'POST', body: { username: 'independent-founder', displayName: 'Independent founder', password },
        });
        assert.equal(founder.status, 201);
        const slug = `school-${randomBytes(6).toString('hex')}`;
        const fresh = await request('/platform/schools', {
          method: 'POST', auth: platform, body: { slug, name: 'New school', adminUsername: 'independent-founder' },
        });
        assert.equal(fresh.status, 201);
        const prefix = `/schools/${fresh.data.id}`;
        const memberships = await request('/schools', { auth: founder });
        assert.equal(memberships.status, 200);
        assert.deepEqual(memberships.data.items.map(({ id, roles, legacy }) => ({ id, roles, legacy })), [
          { id: fresh.data.id, roles: ['school_admin'], legacy: false },
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
        assert.equal((await request('/accounts', { auth: founder })).status, 403);

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
