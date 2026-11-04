import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handlePresence, PRESENCE_TTL_SECONDS} from '../src/presence.mjs';
import {defaultAvatarPath} from '../src/avatars.mjs';

test('presence validates authentication, role, paging, search and rejects client-controlled identity/time', async () => {
 const context = {user: {id: randomUUID(), roles: ['student']}, sess: {token_hash: 'session'},
  route: '/presence', method: 'GET', url: new URL('http://localhost/presence')};
 await assert.rejects(handlePresence({...context, user: null}), error => error.status === 401);
 await assert.rejects(handlePresence({...context, sess: null}), error => error.status === 401);
 await assert.rejects(handlePresence({...context, user: {...context.user, roles: []}}), error => error.status === 403);
 for (const query of ['page=0', 'page=-1', 'page=1.5', 'pageSize=51', 'q=' + 'a'.repeat(81)]) {
  await assert.rejects(handlePresence({...context, url: new URL(`http://localhost/presence?${query}`)}), error => error.status === 400);
 }
 for (const body of [{identityId: randomUUID()}, {seenAt: new Date().toISOString()}, {problemId: randomUUID()}, [], null]) {
  await assert.rejects(handlePresence({...context, method: 'POST', route: '/presence/heartbeat', body}), error => error.status === 400);
 }
 await assert.rejects(handlePresence({...context, method: 'POST', route: '/presence/heartbeat',
  user: {...context.user, roles: ['teacher']}}), error => error.status === 403);
});

test('presence TTL, session deduplication, account state and public-name search use a real database',
 {skip: !process.env.TEST_DATABASE_URL, timeout: 60000}, async () => {
 const manager = createPool(process.env.TEST_DATABASE_URL);
 const schema = `presence_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection = new URL(process.env.TEST_DATABASE_URL);
 connection.searchParams.set('options', `-csearch_path=${schema}`);
 const pool = createPool(connection.href);
 try {
  await migrate(pool);
  async function account(kind, name, nickname = '', useNickname = false) {
   const {rows: [identity]} = await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
    [kind, randomUUID(), name]);
   const {rows: [account]} = await pool.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname,leaderboard_use_nickname)
    VALUES($1,$2,'test-hash',$3,$4) RETURNING id`, [identity.id, randomUUID(), nickname, useNickname]);
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [account.id, kind]);
   return {id: account.id, identityId: identity.id, roles: [kind]};
  }
  async function session(user) {
   const {rows: [sess]} = await pool.query(`INSERT INTO sessions(token_hash,account_id,csrf_token,expires_at)
    VALUES($1,$2,$3,now()+interval '1 day') RETURNING *`, [randomUUID(), user.id, randomUUID()]);
   return {user, sess};
  }
  const alpha = await account('student', 'Alice', 'UNUSED-NICKNAME');
  const beta = await account('student', 'PRIVATE-LEGAL-NAME', 'Beta', true);
  const teacher = await account('teacher', 'Teacher');
  const first = await session(alpha), second = await session(alpha), b = await session(beta), staff = await session(teacher);
  const call = (auth, route = '/presence', method = 'GET', query = '') => handlePresence({pool, ...auth, route, method,
   body: {}, url: new URL(`http://localhost/api/v1${route}${query}`)}).then(response => response.body);
  const heartbeat = auth => call(auth, '/presence/heartbeat', 'POST');
  assert.equal((await call(staff)).onlineCount, 0, 'login alone is not an online heartbeat');
  const beforeLuq = (await pool.query('SELECT count(*)::int n FROM luq_ledger')).rows[0].n;
  await Promise.all([heartbeat(first), heartbeat(first), heartbeat(second), heartbeat(b)]);
  const seenAt = (await pool.query('SELECT presence_seen_at FROM sessions WHERE token_hash=$1', [first.sess.token_hash])).rows[0].presence_seen_at;
  await heartbeat(first);
  assert.equal((await pool.query('SELECT presence_seen_at FROM sessions WHERE token_hash=$1', [first.sess.token_hash])).rows[0].presence_seen_at.getTime(), seenAt.getTime(), 'rapid repeated heartbeats do not repeatedly write');
  await pool.query('UPDATE sessions SET presence_seen_at=now() WHERE account_id=$1', [teacher.id]);
  const online = await call(staff);
  assert.equal(online.onlineCount, 2, 'multiple tabs/devices count one stable identity; staff do not count');
  assert.equal(online.total, 2);
  assert.equal(online.ttlSeconds, PRESENCE_TTL_SECONDS);
  assert.deepEqual(online.items, [
   {identityId: alpha.identityId, displayName: 'Alice', avatar: defaultAvatarPath(alpha.identityId)},
   {identityId: beta.identityId, displayName: 'Beta', avatar: defaultAvatarPath(beta.identityId)},
  ]);
  const found = await call(staff, '/presence', 'GET', '?q=bEtA&pageSize=1');
  assert.equal(found.onlineCount, 2);
  assert.equal(found.total, 1);
  assert.equal(found.items[0].identityId, beta.identityId);
  assert.equal((await call(staff, '/presence', 'GET', '?q=PRIVATE-LEGAL-NAME')).total, 0);
  assert.equal((await call(staff, '/presence', 'GET', '?q=UNUSED-NICKNAME')).total, 0);
  assert.equal((await call(staff, '/presence', 'GET', '?q=%25')).total, 0, 'search is literal, not a LIKE wildcard');
  assert.equal((await call(staff, '/presence', 'GET', '?page=2&pageSize=1')).items[0].identityId, beta.identityId);
  assert.equal((await call(staff, '/presence', 'GET', '?page=3&pageSize=1')).items.length, 0);
  await pool.query('DELETE FROM sessions WHERE token_hash=$1', [first.sess.token_hash]);
  assert.equal((await call(staff)).onlineCount, 2, 'another valid session keeps the student online');
  await assert.rejects(heartbeat(first), error => error.status === 401);
  await pool.query("UPDATE sessions SET presence_seen_at=now()-interval '91 seconds' WHERE account_id=$1", [alpha.id]);
  assert.equal((await call(staff)).onlineCount, 1, 'stale clients expire without a cleanup task');
  await heartbeat(second);
  assert.equal((await call(staff)).onlineCount, 2);
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE account_id=$1", [alpha.id]);
  assert.equal((await call(staff)).onlineCount, 1);
  await assert.rejects(heartbeat(second), error => error.status === 401);
  await pool.query('UPDATE accounts SET disabled_at=now() WHERE id=$1', [beta.id]);
  assert.equal((await call(staff)).onlineCount, 0);
  await assert.rejects(heartbeat(b), error => error.status === 401);
  await pool.query('UPDATE accounts SET disabled_at=NULL WHERE id=$1', [beta.id]);
  await pool.query('UPDATE identities SET archived_at=now() WHERE id=$1', [beta.identityId]);
  assert.equal((await call(staff)).onlineCount, 0);
  await pool.query('UPDATE identities SET archived_at=NULL WHERE id=$1', [beta.identityId]);
  await pool.query('UPDATE accounts SET binding_released_at=now() WHERE id=$1', [beta.id]);
  assert.equal((await call(staff)).onlineCount, 0);
  await pool.query('UPDATE accounts SET binding_released_at=NULL WHERE id=$1', [beta.id]);
  await pool.query("DELETE FROM account_roles WHERE account_id=$1 AND role='student'", [beta.id]);
  assert.equal((await call(staff)).onlineCount, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_ledger')).rows[0].n, beforeLuq, 'heartbeats cannot award Luq');
  assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n, 0);
 } finally {
  await pool.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  await manager.end();
 }
});
