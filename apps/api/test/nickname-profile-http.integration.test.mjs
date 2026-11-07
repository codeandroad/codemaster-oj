import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';

test('profile nickname width limits use real authenticated HTTP and preserve historical profiles',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async t => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    const manager = createPool(url.href);
    const schema = 'nickname_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const schemaUrl = new URL(url);
    schemaUrl.searchParams.set('options', `-csearch_path=${schema}`);
    const owner = createPool(schemaUrl.href);
    const origin = 'http://nickname.test';
    let app;
    try {
      await migrate(owner);
      const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8'))
        .match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
      await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const runtime = new URL(url);
      runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      app = await createApiApplication({ databaseUrl: runtime.href, logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      let cookie, csrfToken, accountId;
      async function request(path, { body, method = 'GET', status = 200, auth = true, csrf = true } = {}) {
        const response = await fetch(base + '/api/v1' + path, { method,
          headers: { Origin: origin, ...(body !== undefined && { 'Content-Type': 'application/json' }),
            ...(auth && cookie && { Cookie: cookie }), ...(auth && csrf && csrfToken && { 'X-CSRF-Token': csrfToken }) },
          body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data.error ?? {})}`);
        return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
      }
      const registered = await request('/auth/register-personal', { method: 'POST', status: 201, body: {
        username: 'nickname-learner', displayName: 'Nickname learner', password: randomBytes(24).toString('base64url'), email: ''
      } });
      cookie = registered.cookie; csrfToken = registered.data.csrfToken; accountId = registered.data.user.id;
      const patch = (body, options = {}) => request('/auth/profile', { method: 'PATCH', body, ...options });
      const stored = async () => (await owner.query('SELECT nickname,bio,leaderboard_use_nickname FROM accounts WHERE id=$1', [accountId])).rows[0];
      await t.test('session and CSRF are required before nickname mutation', async () => {
        await patch({ nickname: 'Protected' }, { auth: false, status: 401 });
        await patch({ nickname: 'Protected' }, { csrf: false, status: 403 });
        assert.equal((await stored()).nickname, '');
      });
      await t.test('ASCII, Chinese, mixed, fullwidth and emoji enforce the same display-width budget', async () => {
        for (const [accepted, rejected] of [
          ['a'.repeat(20), 'a'.repeat(21)], ['中'.repeat(10), '中'.repeat(11)],
          ['中'.repeat(9) + 'ab', '中'.repeat(9) + 'abc'], ['Ａ'.repeat(10), 'Ａ'.repeat(11)],
          ['🙂'.repeat(10), '🙂'.repeat(11)], ['👩‍💻'.repeat(10), '👩‍💻'.repeat(11)]
        ]) {
          assert.equal((await patch({ nickname: accepted })).data.user.nickname, accepted);
          const failure = await patch({ nickname: rejected }, { status: 400 });
          assert.equal(failure.data.error.code, 'NICKNAME_TOO_LONG');
          assert.equal(failure.data.error.message, '昵称最多10个中文字符或20个英文字符（中英文可混合）');
          assert.equal((await stored()).nickname, accepted);
        }
      });
      await t.test('normalization preserves graphemes, while rejected edits cannot partially update a profile', async () => {
        const accepted = 'é'.repeat(20);
        assert.equal((await patch({ nickname: '  ' + 'e\u0301'.repeat(20) + '  ', bio: 'Original profile' })).data.user.nickname, accepted);
        await patch({ nickname: '中'.repeat(11), bio: 'Must not be saved', showNicknameOnLeaderboard: true }, { status: 400 });
        assert.deepEqual(await stored(), { nickname: accepted, bio: 'Original profile', leaderboard_use_nickname: false });
        for (const nickname of [null, 123, {}, []]) await patch({ nickname }, { status: 400 });
      });
      await t.test('omitting nickname allows other profile edits without truncating old values', async () => {
        const historical = '历史昵称'.repeat(4);
        await owner.query('UPDATE accounts SET nickname=$1,leaderboard_use_nickname=true WHERE id=$2', [historical, accountId]);
        const updated = await patch({ bio: 'Updated biography', email: '' });
        assert.equal(updated.data.user.nickname, historical);
        assert.equal(updated.data.user.showNicknameOnLeaderboard, true);
        assert.deepEqual(await stored(), { nickname: historical, bio: 'Updated biography', leaderboard_use_nickname: true });
      });
      await t.test('clearing nickname clears opt-in without accepting an empty explicit opt-in', async () => {
        const cleared = await patch({ nickname: '   ' });
        assert.equal(cleared.data.user.nickname, '');
        assert.equal(cleared.data.user.showNicknameOnLeaderboard, false);
        await patch({ nickname: '', showNicknameOnLeaderboard: true }, { status: 400 });
        assert.equal((await stored()).leaderboard_use_nickname, false);
        const updated = await patch({ nickname: 'Learner', showNicknameOnLeaderboard: true });
        assert.equal(updated.data.user.showNicknameOnLeaderboard, true);
      });
    } finally {
      await app?.close(); await owner.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
    }
  });
