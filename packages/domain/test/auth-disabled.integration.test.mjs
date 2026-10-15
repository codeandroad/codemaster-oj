import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';

test('disabled login is explicit only after correct credentials are verified', {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 60000,
}, async () => {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = `auth_disabled_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(url.href);
  const adminPassword = randomBytes(24).toString('base64url');
  const studentPassword = randomBytes(24).toString('base64url');
  let server;
  try {
    await migrate(pool);
    await bootstrap(pool, { name: '测试管理员', number: 'ADMIN', username: 'disabled-test-admin', password: adminPassword });
    server = http.createServer(await createApp(pool, loadConfig({
      SESSION_SECRET: randomBytes(32).toString('base64url'),
      APP_ORIGIN: 'http://auth-disabled.test',
      COOKIE_SECURE: 'false',
    })));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const request = async (path, body, auth, method = 'POST') => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Origin: 'http://auth-disabled.test',
          'Content-Type': 'application/json',
          ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], csrfToken: data.csrfToken };
    };

    const admin = await request('/auth/login', { username: 'disabled-test-admin', password: adminPassword });
    assert.equal(admin.status, 200);
    const person = await request('/people', { kind: 'student', number: 'S001', name: '停用测试学生' }, admin);
    assert.equal(person.status, 201);
    const credentials = { username: 'disabled-test-student', password: studentPassword };
    const registered = await request('/auth/register', {
      kind: 'student', number: 'S001', name: '停用测试学生', activationCode: person.data.activationCode,
      ...credentials,
    });
    assert.equal(registered.status, 201);
    const accountId = registered.data.user.id;
    const before = await request('/auth/login', credentials);
    assert.equal(before.status, 200);

    const disabled = await request(`/accounts/${accountId}`, { disabled: true }, admin, 'PATCH');
    assert.equal(disabled.status, 200);
    const blocked = await request('/auth/login', credentials);
    assert.equal(blocked.status, 403);
    assert.deepEqual(blocked.data.error, { code: 'ACCOUNT_DISABLED', message: '账号已禁用' });
    const wrongPassword = await request('/auth/login', { ...credentials, password: randomBytes(24).toString('base64url') });
    const unknownAccount = await request('/auth/login', { username: 'unknown-student', password: credentials.password });
    for (const response of [wrongPassword, unknownAccount]) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.data.error, { code: 'LOGIN_FAILED', message: '用户名或密码不正确' });
    }

    const enabled = await request(`/accounts/${accountId}`, { disabled: false }, admin, 'PATCH');
    assert.equal(enabled.status, 200);
    const after = await request('/auth/login', credentials);
    assert.equal(after.status, 200);
    assert.equal(after.data.user.id, accountId);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`);
    await manager.end();
  }
});
