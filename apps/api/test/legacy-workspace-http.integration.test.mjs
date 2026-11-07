import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('legacy business endpoints require original-school ownership on the real Nest API',
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
      const legacyAccountId = await bootstrap(pool, { name: 'Original administrator', number: 'ADM', username: 'original-admin', password });
      const hash = await hashPassword(password);
      async function credential(login, { legacy = false } = {}) {
        return transaction(pool, async db => {
          const identity = (await db.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
            [legacy ? 'student' : 'teacher', login, 'QA ' + login])).rows[0];
          const account = (await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
            [identity.id, login, hash])).rows[0];
          if (legacy) await db.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [account.id]);
          return { ...account, identityId: identity.id };
        });
      }
      const schoolAccount = await credential('new-school-admin');
      const platformAccount = await credential('platform-only');
      const originalStudent = await credential('original-student', { legacy: true });
      const school = await provisionSchool(pool, { slug: 'boundary-school', name: 'Boundary School', adminUsername: 'new-school-admin' });
      await provisionPlatformAdministrator(pool, { username: 'platform-only' });
      assert.equal((await pool.query('SELECT count(*)::int n FROM legacy_school_account_ownership WHERE account_id=ANY($1::uuid[])',
        [[schoolAccount.id, platformAccount.id]])).rows[0].n, 0, 'non-legacy credentials must actually exercise the new boundary');

      // Synthetic published fixture: authorization checks do not execute code.
      const problem = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [legacyAccountId])).rows[0];
      const version = (await pool.query(`INSERT INTO problem_versions
        (problem_id,title,mode,statement,reference_code,time_limit_ms,memory_limit_mb,
         validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at)
        VALUES($1,'Original school published problem','stdio','Legacy-only statement marker',
          'print(1)',1000,64,'AC',now(),now(),'approved',now()) RETURNING id`, [problem.id])).rows[0];
      await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2', [version.id, problem.id]);

      app = await createApiApplication({ databaseUrl: url.href, logger: false,
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
      const student = await login('original-student');
      const newSchool = await login('new-school-admin');
      const platform = await login('platform-only');

      await t.test('new school and platform accounts cannot read original business lists, direct IDs, exports or assistance', async () => {
        const id = problem.id;
        const paths = ['/problems', `/problems/${id}?versionId=${version.id}`, '/problem-banks', '/problem-groups', '/problem-favorites',
          '/problems/import', '/admin/problem-banks', '/problems/rank-review', '/classes', '/people', '/accounts', '/teaching/audience',
          '/learning-paths', `/learning-paths/${id}`, '/learning-resources', '/assignments', `/assignments/${id}`, '/timed-practices',
          '/submissions', '/submissions/SUB1', '/review-notebook', '/reports', '/reports/export', '/points/me', '/points/leaderboard',
          '/paper4/papers', `/paper4/papers/${id}`, '/luq/me', '/luq/ledger', '/luq/contents', '/luq/public-statements',
          `/profiles/${originalStudent.identityId}`, `/profiles/${originalStudent.identityId}/activity`, '/presence',
          '/student-notifications', '/system-settings', '/audit-events', '/judge-status'];
        for (const auth of [newSchool, platform]) for (const path of paths) {
          const response = await request(path, { auth });
          assert.equal(response.status, 403, path);
          assert.equal(response.data.error?.code ?? response.data.code, 'LEGACY_WORKSPACE_REQUIRED', path);
          assert.equal(JSON.stringify(response.data).includes('Legacy-only statement marker'), false);
        }
      });

      await t.test('denied writes create no submissions, rewards or original-school records', async () => {
        const counts = async () => (await pool.query(`SELECT
          (SELECT count(*)::int FROM submissions) submissions,(SELECT count(*)::int FROM judge_tasks) tasks,
          (SELECT count(*)::int FROM luq_ledger) ledger,(SELECT count(*)::int FROM problems) problems,
          (SELECT count(*)::int FROM assignments) assignments,(SELECT count(*)::int FROM learning_paths) courses`)).rows[0];
        const before = await counts();
        const mutations = [
          ['/problems', 'POST'], ['/problem-banks', 'POST'], ['/assignments', 'POST'], ['/learning-paths', 'POST'],
          ['/submissions', 'POST'], ['/presence/heartbeat', 'POST'], ['/luq/assistance/quote', 'POST'],
          ['/luq/assistance/unlock', 'POST'], ['/luq/assistance/provide', 'POST'], ['/system-settings', 'PATCH'],
        ];
        for (const auth of [newSchool, platform]) for (const [path,method] of mutations) {
          const response = await request(path, { auth, method, body: { problemId: problem.id, versionId: version.id } });
          assert.equal(response.status, 403, path);
          assert.equal(response.data.error?.code ?? response.data.code, 'LEGACY_WORKSPACE_REQUIRED', path);
        }
        assert.deepEqual(await counts(), before);
      });

      await t.test('original administrator and student retain original-school access', async () => {
        for (const path of ['/problems', `/problems/${problem.id}?versionId=${version.id}`, '/learning-paths', '/assignments', '/luq/me']) {
          assert.equal((await request(path, { auth: student })).status, 200, path);
        }
        for (const path of ['/people', '/accounts', '/system-settings', '/problem-banks']) {
          assert.equal((await request(path, { auth: admin })).status, 200, path);
        }
        assert.equal((await request('/system-settings', { auth: student })).status, 403, 'ownership does not widen the original role');
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
