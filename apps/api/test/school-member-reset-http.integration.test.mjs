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

      const student = await request('/auth/register-personal', {
        method: 'POST', body: { username: 'reset-member', displayName: 'Reset member', password },
      });
      assert.equal(student.status, 201);
      const memberId = student.data.user.id;
      assert.equal((await reset(memberId, admin)).status, 404, 'non-members cannot be reset');

      const invite = await request(`/schools/${schoolId}/invitations`, { method: 'POST', auth: admin, body: { role: 'student' } });
      assert.equal(invite.status, 201);
      assert.equal((await request('/school-invitations/accept', { method: 'POST', auth: student, body: { token: invite.data.token } })).status, 200);

      assert.equal((await reset(memberId, student)).status, 403, 'members cannot issue reset credentials');
      const issued = await reset(memberId, admin);
      assert.equal(issued.status, 200);
      assert.equal(issued.data.username, 'reset-member');
      assert.match(issued.data.resetCode, /^[A-Za-z0-9_-]{32}$/);

      const tokenRow = (await pool.query('SELECT token_hash, consumed_at FROM reset_tokens WHERE account_id=$1', [memberId])).rows[0];
      assert.ok(tokenRow && /^[0-9a-f]{64}$/.test(tokenRow.token_hash) && !tokenRow.consumed_at, 'stores only the code hash');

      const newPassword = 'ResetMember-8f6b7c2d1e!';
      const settled = await request('/auth/reset', { method: 'POST', body: { username: 'reset-member', resetCode: issued.data.resetCode, password: newPassword } });
      assert.equal(settled.status, 200);
      assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'reset-member', password: newPassword } })).status, 200);

      const reissued = await reset(memberId, admin);
      assert.equal(reissued.status, 200);
      assert.equal((await request('/auth/reset', { method: 'POST', body: { username: 'reset-member', resetCode: issued.data.resetCode, password: 'StaleCode-9z8y7x6w5v!' } })).status, 400, 'reissuing invalidates the previous code');
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
