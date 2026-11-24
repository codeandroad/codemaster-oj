import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school administrators issue one-time password reset credentials for members',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
    const manager = createPool(process.env.TEST_DATABASE_URL);
    const schema = 'reset_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    let app;
    try {
      await migrate(pool);
      await bootstrap(pool, { schoolSlug: 'tianxing-chuangshiji', name: 'Legacy admin', number: 'ADM', username: 'legacy-admin', password });
      app = await createApiApplication({
        databaseUrl: url.href, logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'http://reset.test', COOKIE_SECURE: 'false' }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth } = {}) {
        const response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Origin: 'http://reset.test',
            ...(body && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, 'X-CSRF-Token': auth.data.csrfToken }),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return {
          status: response.status, data: await response.json(),
          cookie: response.headers.get('set-cookie')?.split(';')[0],
        };
      }
      const admin = await request('/auth/login', { method: 'POST', body: { username: 'legacy-admin', password } });
      assert.equal(admin.status, 200);
      const schoolId = (await request('/schools', { auth: admin })).data.items[0].id;
      const members = `/schools/${schoolId}/members`;
      const reset = (accountId, auth) => request(`${members}/${accountId}/reset`, { method: 'POST', auth });

      const personal = await request('/auth/register-personal', {
        method: 'POST', body: { username: 'personal-member', displayName: 'Personal member', password },
      });
      assert.equal(personal.status, 201);
      assert.equal((await reset(personal.data.user.id, admin)).status, 404);

      const invite = await request(`/schools/${schoolId}/invitations`, { method: 'POST', auth: admin, body: { role: 'student' } });
      assert.equal(invite.status, 201);
      assert.equal((await request('/school-invitations/accept', { method: 'POST', auth: personal, body: { token: invite.data.token } })).status, 200);
      assert.equal((await reset(personal.data.user.id, admin)).status, 403);
      assert.equal((await reset(admin.data.user.id, admin)).status, 403);
      const identity = { kind: 'student', name: 'Reset member', number: 'S01' };
      const created = await request(`/schools/${schoolId}/identities`, { method: 'POST', auth: admin, body: identity });
      assert.equal(created.status, 201);
      const activation = await request(`/schools/${schoolId}/identities/${created.data.id}/activation-code`, { method: 'POST', auth: admin });
      const student = await request('/auth/register', { method: 'POST', body: {
        ...identity, schoolSlug: 'tianxing-chuangshiji', activationCode: activation.data.activationCode, username: 'reset-member', password,
      } });
      assert.equal(student.status, 201);
      const memberId = student.data.user.id;
      const list = (await request(members, { auth: admin })).data.items;
      assert.deepEqual(list.filter(member => member.canResetPassword).map(member => member.accountId), [memberId]);

      assert.equal((await reset(memberId, student)).status, 403, 'members cannot issue reset credentials');
      const issued = await reset(memberId, admin);
      assert.equal(issued.status, 200);
      assert.equal(issued.data.username, 'reset-member');
      assert.match(issued.data.resetCode, /^[A-Za-z0-9_-]{32}$/);

      const tokenRow = (await pool.query('SELECT token_hash, consumed_at FROM reset_tokens WHERE account_id=$1', [memberId])).rows[0];
      assert.ok(tokenRow && /^[0-9a-f]{64}$/.test(tokenRow.token_hash) && !tokenRow.consumed_at, 'stores only the code hash');

      const newPassword = randomBytes(24).toString('base64url');
      const redeem = resetCode => request('/auth/reset', {method:'POST', body:{username:'reset-member',resetCode,password:newPassword}});
      const reissued = await reset(memberId, admin);
      assert.equal(reissued.status, 200);
      assert.equal((await redeem(issued.data.resetCode)).status, 400);
      assert.equal((await redeem(reissued.data.resetCode)).status, 200);
      assert.equal((await request('/auth/me', {auth:student})).status, 401);
      assert.equal((await redeem(reissued.data.resetCode)).status, 400);
      assert.equal((await request('/auth/login', { method:'POST', body:{username:'reset-member',password:newPassword} })).status, 200);
      const prior = await reset(memberId, admin);
      await pool.query('INSERT INTO school_administrators(school_id,account_id,granted_by) VALUES($1,$2,$3)', [schoolId,memberId,admin.data.user.id]);
      assert.equal((await redeem(prior.data.resetCode)).status, 400);
      assert.equal((await reset(memberId, admin)).status, 403);
      await pool.query('DELETE FROM school_administrators WHERE school_id=$1 AND account_id=$2', [schoolId,memberId]);
      await provisionSchool(pool, {slug:'second-school',name:'Second School',adminUsername:'reset-member'});
      assert.equal((await redeem(prior.data.resetCode)).status, 400);
      assert.equal((await reset(memberId, admin)).status, 403);
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
