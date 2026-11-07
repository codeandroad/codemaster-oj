import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school invitations and management stay within each school on the real Nest API',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
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
      await bootstrap(pool, { name: 'Legacy admin', number: 'ADM', username: 'legacy-admin', password });
      app = await createApiApplication({
        databaseUrl: url.href, logger: false,
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
      async function register(username, number) {
        const name = 'QA ' + username;
        const issue = await request('/people', { method: 'POST', auth: legacy, body: { kind: 'student', number, name } });
        assert.equal(issue.status, 201);
        const account = await request('/auth/register', {
          method: 'POST', body: { kind: 'student', number, name, username, password, activationCode: issue.data.activationCode },
        });
        assert.equal(account.status, 201);
        return account;
      }
      const alphaAdmin = await register('alpha-admin', 'A');
      const betaAdmin = await register('beta-admin', 'B');
      const learner = await register('test-learner', 'C');
      const another = await register('test-another', 'D');
      const alpha = await provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      const beta = await provisionSchool(pool, { slug: 'school-beta', name: 'Beta School', adminUsername: 'beta-admin' });
      const retry = await provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      assert.equal(retry.id, alpha.id);
      await assert.rejects(provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'beta-admin' }), { status: 409 });
      await assert.rejects(provisionSchool(pool, { slug: 'legacy-school', name: 'Legacy', adminUsername: 'alpha-admin' }), { status: 400 });

      const members = school => `/schools/${school.id}/members`;
      const issue = (school, auth, role = 'student', csrf = true) => request(`/schools/${school.id}/invitations`, {
        method: 'POST', auth, csrf, body: { role },
      });
      const accept = (auth, token) => request('/school-invitations/accept', { method: 'POST', auth, body: { token } });
      const revoke = (school, account, auth) => request(`${members(school)}/${account.data.user.id}`, { method: 'DELETE', auth });
      assert.equal((await request('/schools')).status, 401);
      assert.deepEqual((await request('/schools', { auth: alphaAdmin })).data.items.map(s => s.id), [LEGACY_SCHOOL_ID, alpha.id]);
      assert.equal((await request('/accounts', { auth: alphaAdmin })).status, 403, 'school admin grant cannot elevate legacy privileges');
      assert.equal((await request(members(beta), { auth: alphaAdmin })).status, 404);
      assert.equal((await request(members(alpha), { auth: legacy })).status, 404, 'legacy admin cannot browse a pilot school');
      assert.equal((await issue(beta, alphaAdmin)).status, 404);
      assert.equal((await issue(alpha, alphaAdmin, 'platform_admin')).status, 400);
      assert.equal((await issue(alpha, alphaAdmin, 'student', false)).status, 403);
      assert.equal((await revoke(alpha, alphaAdmin, alphaAdmin)).status, 404);

      const aInvite = await issue(alpha, alphaAdmin, 'teacher');
      const bInvite = await issue(beta, betaAdmin);
      assert.equal(aInvite.status, 201);
      assert.equal(bInvite.status, 201);
      const claimed = await Promise.all([accept(learner, aInvite.data.token), accept(another, aInvite.data.token)]);
      assert.deepEqual(claimed.map(r => r.status).sort(), [200, 400]);
      const member = claimed[0].status === 200 ? learner : another;
      const memberId = member.data.user.id;
      assert.equal((await accept(member, bInvite.data.token)).status, 200);
      const mySchools = (await request('/schools', { auth: member })).data.items;
      assert.deepEqual(mySchools.map(s => [s.id, s.roles]), [
        [LEGACY_SCHOOL_ID, ['student']], [alpha.id, ['teacher']], [beta.id, ['student']],
      ]);
      assert.deepEqual((await request('/auth/me', { auth: member })).data.user.roles, ['student']);
      assert.equal((await request(members(alpha), { auth: member })).status, 403);
      assert.equal((await issue(alpha, member)).status, 403);
      assert.equal((await issue(alpha,member,'school_admin')).status,403,'teachers cannot grant administrator access');
      const alphaList = (await request(members(alpha), { auth: alphaAdmin })).data.items;
      const betaList = (await request(members(beta), { auth: betaAdmin })).data.items;
      assert.deepEqual(new Set(alphaList.map(m => m.accountId)), new Set([alphaAdmin.data.user.id, memberId]));
      assert.deepEqual(new Set(betaList.map(m => m.accountId)), new Set([betaAdmin.data.user.id, memberId]));
      assert.deepEqual(Object.keys(alphaList[0]).sort(), ['accountId', 'joinedAt', 'name', 'role']);
      assert.equal((await revoke(beta, member, alphaAdmin)).status, 404);
      assert.equal((await revoke(alpha, member, alphaAdmin)).status, 200);
      assert.deepEqual((await request('/schools', { auth: member })).data.items.map(s => s.id), [LEGACY_SCHOOL_ID, beta.id]);
      assert.equal((await accept(member, aInvite.data.token)).status, 400);
      const reinvite = await issue(alpha, alphaAdmin);
      assert.equal((await accept(member, reinvite.data.token)).status, 200);

      // School administrators can delegate only their school's administration.
      const candidate = await request('/auth/register-personal', {method:'POST',body:{username:'new-school-admin',displayName:'New school administrator',password}});
      assert.equal(candidate.status,201);
      const adminInvite = await issue(alpha, alphaAdmin, 'school_admin');
      assert.equal(adminInvite.status,201);
      assert.equal((await accept(member,adminInvite.data.token)).status,409,'an invitation cannot override an active membership');
      assert.equal((await issue(alpha,member,'school_admin')).status,403,'students cannot grant administrator access');
      assert.equal((await accept(candidate,adminInvite.data.token)).status,200);
      assert.equal((await accept(candidate,adminInvite.data.token)).status,400,'one invitation can be consumed only once');
      assert.equal((await request(members(alpha),{auth:candidate})).status,200);
      assert.equal((await request(members(beta),{auth:candidate})).status,404);
      assert.equal((await issue(alpha,candidate,'teacher')).status,201);
      assert.deepEqual((await request('/auth/me',{auth:candidate})).data.user.roles,[]);
      assert.equal((await request('/platform/schools',{auth:candidate})).status,403);
      assert.equal((await request('/accounts',{auth:candidate})).status,403);
      assert.equal((await pool.query('SELECT count(*)::int n FROM account_roles WHERE account_id=$1',[candidate.data.user.id])).rows[0].n,0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM platform_admins WHERE account_id=$1',[candidate.data.user.id])).rows[0].n,0);
      assert.equal((await revoke(alpha,candidate,alphaAdmin)).status,404,'membership removal cannot accidentally remove a school administrator');

      const unclaimed = await issue(alpha, alphaAdmin);
      await pool.query('UPDATE accounts SET disabled_at = clock_timestamp() WHERE id = $1', [alphaAdmin.data.user.id]);
      assert.equal((await accept(another, unclaimed.data.token)).status, 400, 'disabling issuer invalidates unused invitations');
      assert.equal((await request('/schools', { auth: alphaAdmin })).status, 401);
      const { rows } = await pool.query('SELECT token_hash FROM school_invitations');
      assert.ok(rows.every(row => /^[0-9a-f]{64}$/.test(row.token_hash)));
      assert.ok(rows.every(row => row.token_hash !== aInvite.data.token));
      assert.equal((await pool.query("SELECT count(*)::int count FROM audit_events WHERE action LIKE 'school.%'")).rows[0].count, 0);
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
