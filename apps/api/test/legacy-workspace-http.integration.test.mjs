import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
      async function credential(login, { legacyRole } = {}) {
        return transaction(pool, async db => {
          const identity = (await db.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
            [legacyRole ?? 'teacher', login, 'QA ' + login])).rows[0];
          const account = (await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
            [identity.id, login, hash])).rows[0];
          if (legacyRole) await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [account.id, legacyRole]);
          return { ...account, identityId: identity.id };
        });
      }
      const schoolAccount = await credential('new-school-admin');
      const platformAccount = await credential('platform-only');
      const originalStudent = await credential('original-student', { legacyRole: 'student' });
      const originalTeacher = await credential('original-teacher', { legacyRole: 'teacher' });
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
          '/paper4/papers', `/paper4/papers/${id}`, '/scholarship/me', '/scholarship/ledger', '/scholarship/contents', '/scholarship/public-statements',
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
          ['/submissions', 'POST'], ['/presence/heartbeat', 'POST'], ['/scholarship/assistance/quote', 'POST'],
          ['/scholarship/assistance/unlock', 'POST'], ['/scholarship/assistance/provide', 'POST'], ['/system-settings', 'PATCH'],
        ];
        for (const auth of [newSchool, platform]) for (const [path,method] of mutations) {
          const response = await request(path, { auth, method, body: { problemId: problem.id, versionId: version.id } });
          assert.equal(response.status, 403, path);
          assert.equal(response.data.error?.code ?? response.data.code, 'LEGACY_WORKSPACE_REQUIRED', path);
        }
        assert.deepEqual(await counts(), before);
      });

      await t.test('original administrator and student retain original-school access', async () => {
        for (const path of ['/problems', `/problems/${problem.id}?versionId=${version.id}`, '/learning-paths', '/assignments', '/scholarship/me']) {
          assert.equal((await request(path, { auth: student })).status, 200, path);
        }
        for (const path of ['/people', '/accounts', '/system-settings', '/problem-banks']) {
          assert.equal((await request(path, { auth: admin })).status, 200, path);
        }
        assert.equal((await request('/system-settings', { auth: student })).status, 403, 'ownership does not widen the original role');
      });

      await t.test('admin bank group filters apply before paging and include archived problems', async () => {
        const bankId = randomUUID();
        const otherBankId = randomUUID();
        const groupId = randomUUID();
        const overlappingGroupId = randomUUID();
        const archivedGroupId = randomUUID();
        const otherGroupId = randomUUID();
        await pool.query(`INSERT INTO problem_banks(id,name,owner_account_id,archived_at) VALUES
          ($1,'Archived filter bank',$3,now()),($2,'Other filter bank',$3,NULL)`, [bankId, otherBankId, originalTeacher.id]);
        await pool.query(`INSERT INTO problem_groups(id,bank_id,name,owner_account_id,archived_at) VALUES
          ($1,$5,'Chapter one',$7,NULL),($2,$5,'Chapter two',$7,NULL),($3,$5,'Retired chapter',$7,now()),
          ($4,$6,'Chapter one',$7,NULL)`, [groupId, overlappingGroupId, archivedGroupId, otherGroupId, bankId, otherBankId, originalTeacher.id]);
        const { rows } = await pool.query(`INSERT INTO problems(bank_id,owner_account_id,created_at,archived_at)
          SELECT $1,$2,to_timestamp(position),CASE WHEN position=1 THEN now() END FROM generate_series(1,104) position
          RETURNING id,extract(epoch FROM created_at)::int position`, [bankId, originalTeacher.id]);
        const problemIds = rows.sort((a, b) => a.position - b.position).map(row => row.id);
        const archivedProblemId = problemIds[0];
        const overlappingProblemId = problemIds[100];
        const retiredGroupProblemId = problemIds[101];
        const ungroupedProblemId = problemIds[102];
        const otherChapterProblemId = problemIds[103];
        await pool.query(`WITH versions AS (
          INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,time_limit_ms,memory_limit_mb)
          SELECT id,'Group filter problem ' || position,'stdio','Fixture statement','',1000,64
          FROM unnest($1::uuid[]) WITH ORDINALITY AS fixture(id,position) RETURNING id,problem_id
        ) UPDATE problems p SET current_version_id=v.id FROM versions v WHERE p.id=v.problem_id`, [problemIds]);
        await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,time_limit_ms,memory_limit_mb)
          SELECT id,'Previous matching title','stdio','Fixture statement','',1000,64 FROM unnest($1::uuid[]) AS fixture(id)`,
          [[archivedProblemId, otherChapterProblemId]]);
        await pool.query(`INSERT INTO problem_group_members(group_id,problem_id,position)
          SELECT $1,id,position FROM unnest($2::uuid[]) WITH ORDINALITY AS fixture(id,position)`, [groupId, problemIds.slice(0, 101)]);
        await pool.query(`INSERT INTO problem_group_members(group_id,problem_id,position) VALUES
          ($1,$3,1),($1,$4,2),($2,$5,1)`, [overlappingGroupId, archivedGroupId, overlappingProblemId, otherChapterProblemId, retiredGroupProblemId]);

        const list = (filters = {}, auth = admin) => request(`/admin/problem-banks/${bankId}/problems?${new URLSearchParams(filters)}`, { auth });
        const all = await list();
        assert.equal(all.status, 200);
        assert.ok(all.data.bank.archivedAt);
        assert.equal(all.data.total, 104);
        assert.deepEqual([...all.data.groups].sort((a, b) => a.name.localeCompare(b.name)), [
          { id: groupId, name: 'Chapter one' }, { id: overlappingGroupId, name: 'Chapter two' },
        ]);

        const firstPage = await list({ groupId });
        assert.equal(firstPage.status, 200);
        assert.equal(firstPage.data.total, 101);
        assert.equal(firstPage.data.pageSize, 100);
        assert.deepEqual(firstPage.data.items.map(item => item.id), problemIds.slice(1, 101).reverse());
        const secondPage = await list({ groupId, page: 2, search: 'Group filter problem' });
        assert.equal(secondPage.status, 200);
        assert.equal(secondPage.data.total, 101);
        assert.deepEqual(secondPage.data.items.map(item => item.id), [archivedProblemId]);
        assert.ok(secondPage.data.items[0].archivedAt);

        const combined = await list({ groupId, search: 'Previous matching title' });
        assert.equal(combined.status, 200);
        assert.equal(combined.data.total, 1);
        assert.deepEqual(combined.data.items.map(item => item.id), [archivedProblemId]);
        const ungrouped = await list({ groupId: 'ungrouped' });
        assert.equal(ungrouped.status, 200);
        assert.equal(ungrouped.data.total, 2);
        assert.deepEqual(ungrouped.data.items.map(item => item.id), [ungroupedProblemId, retiredGroupProblemId]);
        const overlapping = await list({ groupId: overlappingGroupId });
        assert.equal(overlapping.status, 200);
        assert.equal(overlapping.data.total, 2);
        assert.deepEqual(overlapping.data.items.map(item => item.id), [otherChapterProblemId, overlappingProblemId]);

        for (const inactiveGroupId of [otherGroupId, archivedGroupId]) {
          const empty = await list({ groupId: inactiveGroupId });
          assert.equal(empty.status, 200);
          assert.equal(empty.data.total, 0);
          assert.deepEqual(empty.data.items, []);
        }
        assert.equal((await list({ groupId: 'invalid-group' })).status, 400);
        const teacher = await login('original-teacher');
        for (const auth of [student, teacher, newSchool, platform]) {
          assert.equal((await list({ groupId }, auth)).status, 403);
        }
        const teacherGroups = await request('/problem-groups', { auth: teacher });
        assert.equal(teacherGroups.status, 200);
        assert.ok(teacherGroups.data.items.some(group => group.id === otherGroupId));
        assert.ok(teacherGroups.data.items.every(group => group.bankId !== bankId));
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
