import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Nest presence routes require auth and CSRF, expose only public fields, and drop logged-out sessions',
 {skip: !process.env.TEST_DATABASE_URL, timeout: 60000}, async () => {
 const manager = createPool(process.env.TEST_DATABASE_URL);
 const schema = `presence_http_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection = new URL(process.env.TEST_DATABASE_URL);
 connection.searchParams.set('options', `-csearch_path=${schema}`);
 const pool = createPool(connection.href);
 let app;
 try {
  await migrate(pool);
  const password = randomBytes(20).toString('base64url');
  const passwordHash = await hashPassword(password);
  async function account(kind, name) {
   const username = `${kind}-${randomBytes(5).toString('hex')}`;
   const {rows: [identity]} = await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id', [kind, randomUUID(), name]);
   const {rows: [account]} = await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity.id, username, passwordHash]);
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [account.id, kind]);
   return {id: account.id, identityId: identity.id, username};
  }
  const student = await account('student', 'Student'), teacher = await account('teacher', 'Teacher');
  app = await createApiApplication({databaseUrl: connection.href, logger: false,
   config: loadConfig({SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://school.test', COOKIE_SECURE: 'false'})});
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = async (path, {method = 'GET', body, auth, csrf = true, origin = 'http://school.test'} = {}) => {
   const response = await fetch(`${base}/api/v1${path}`, {method, headers: {
    Origin: origin, ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
    ...(auth ? {Cookie: auth.cookie, ...(csrf ? {'X-CSRF-Token': auth.csrfToken} : {})} : {}),
   }, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
   return {status: response.status, data: await response.json(), cache: response.headers.get('cache-control'),
    cookie: response.headers.get('set-cookie')?.split(';')[0]};
  };
  const login = async user => {
   const response = await request('/auth/login', {method: 'POST', body: {username: user.username, password}});
   assert.equal(response.status, 200);
   return {cookie: response.cookie, csrfToken: response.data.csrfToken};
  };
  const first = await login(student), second = await login(student), staff = await login(teacher);
  assert.equal((await request('/presence')).status, 401);
  assert.equal((await request('/presence/heartbeat', {method: 'POST', body: {}})).status, 401);
  assert.equal((await request('/presence', {auth: first})).data.onlineCount, 0);
  assert.equal((await request('/presence/heartbeat', {method: 'POST', body: {}, auth: first, csrf: false})).status, 403);
  assert.equal((await request('/presence/heartbeat', {method: 'POST', body: {}, auth: first, origin: 'http://evil.test'})).status, 403);
  assert.equal((await request('/presence/heartbeat', {method: 'POST', body: {identityId: teacher.identityId}, auth: first})).status, 400);
  assert.equal((await request('/presence/heartbeat', {method: 'POST', body: {}, auth: staff})).status, 403);
  for (const auth of [first, second]) {
   const response = await request('/presence/heartbeat', {method: 'POST', body: {}, auth});
   assert.equal(response.status, 200, JSON.stringify(response.data));
   assert.equal(response.data.ttlSeconds, 90);
  }
  const list = await request('/presence', {auth: staff});
  assert.equal(list.status, 200);
  assert.equal(list.cache, 'no-store');
  assert.equal(list.data.onlineCount, 1);
  assert.deepEqual(Object.keys(list.data.items[0]).sort(), ['avatar', 'displayName', 'identityId']);
  assert.equal(list.data.items[0].identityId, student.identityId);
  assert.equal((await request('/presence?pageSize=51', {auth: staff})).status, 400);
  assert.equal((await request('/auth/logout', {method: 'POST', body: {}, auth: first})).status, 200);
  assert.equal((await request('/presence', {auth: staff})).data.onlineCount, 1);
  assert.equal((await request('/auth/logout', {method: 'POST', body: {}, auth: second})).status, 200);
  assert.equal((await request('/presence', {auth: staff})).data.onlineCount, 0);
  assert.equal((await request('/presence/heartbeat', {method: 'POST', body: {}, auth: second})).status, 401);
 } finally {
  if (app) await app.close();
  await pool.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  await manager.end();
 }
});
