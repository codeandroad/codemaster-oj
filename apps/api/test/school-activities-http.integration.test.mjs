import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

test('school activity HTTP transport and alternate-entry assessment isolation', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.match(url.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  const owner = createPool(url.href), schema = 'activity_http_' + randomBytes(5).toString('hex');
  const scoped = new URL(url); scoped.searchParams.set('options', '-csearch_path=' + schema);
  const pool = createPool(scoped.href); let server, worker;
  try {
    await owner.query('CREATE SCHEMA ' + schema); await migrate(pool);
    const grantSql = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
    await pool.query(grantSql.replaceAll('SCHEMA public', 'SCHEMA ' + schema));
    const password = randomBytes(24).toString('base64url'), hash = await hashPassword(password), users = {}, ids = {};
    for (const name of ['admin', 'teacher', 'student', 'peer', 'outside']) {
      const identity = randomUUID();
      await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$2)", [identity, name]);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, hash])).rows[0];
    }
    const school = await provisionSchool(pool, { slug: 'activity-http-school', name: 'HTTP school', adminUsername: 'admin' });
    const beta = await provisionSchool(pool, { slug: 'activity-http-beta', name: 'Beta', adminUsername: 'outside' });
    await pool.query('INSERT INTO platform_admins(account_id) VALUES($1)', [users.admin.id]);
    for (const name of ['teacher', 'student', 'peer']) {
      const role = name === 'teacher' ? 'teacher' : 'student';
      await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [school.id, users[name].id, role]);
      ids[name] = (await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4) RETURNING id', [school.id, role, name, users[name].id])).rows[0].id;
    }
    const runtime = new URL(scoped); runtime.searchParams.set('options', '-crole=campus_app -csearch_path=' + schema);
    const wu = new URL(scoped); wu.searchParams.set('options', '-crole=campus_worker -csearch_path=' + schema); worker = createPool(wu.href);
    const origin = 'http://activity.test';
    server = await createApiApplication({ databaseUrl: runtime.href, logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const base = await server.getUrl();
    const request = async (path, { auth, method = 'GET', body, status = 200, csrf = true } = {}) => {
      const r = await fetch(base + '/api/v1' + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, ...(csrf ? { 'X-CSRF-Token': auth.csrfToken } : {}) } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await r.json(); assert.equal(r.status, status, method + ' ' + path + ': ' + JSON.stringify(data.error ?? {}));
      return { data, cookie: r.headers.get('set-cookie')?.split(';')[0], cache: r.headers.get('cache-control') };
    };
    const auth = {}; for (const name of Object.keys(users)) { const login = await request('/auth/login', { method: 'POST', body: { username: name, password } }); auth[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
    const prefix = '/schools/' + school.id, activities = prefix + '/activities';
    await t.test('new-school grants notify only the intended student in the school inbox', async () => {
      const inbox = prefix + '/student-notifications';
      const grant = { identityIds: [ids.student], amount: 15, reason: 'Class award', requestId: randomUUID() };
      await request(inbox, { status: 401 });
      await request(inbox, { auth: auth.teacher, status: 403 });
      await request(inbox, { auth: auth.outside, status: 404 });
      assert.equal((await request(inbox, { auth: auth.student })).data.unreadCount, 0);
      await request(prefix + '/scholarship/grant', { auth: auth.admin, method: 'POST', body: grant });
      await request(prefix + '/scholarship/grant', { auth: auth.admin, method: 'POST', body: grant });
      const { data } = await request(inbox, { auth: auth.student });
      assert.equal(data.unreadCount, 1);
      assert.deepEqual(data.items.map(({ kind, amount, reason }) => ({ kind, amount, reason })),
        [{ kind: 'scholarship_grant', amount: 15, reason: grant.reason }]);
      assert.equal((await request(inbox, { auth: auth.peer })).data.total, 0);
      await request(inbox + '/' + data.items[0].id + '/read', { auth: auth.peer, method: 'POST', status: 404 });
      await request(inbox + '/read-all', { auth: auth.student, method: 'POST' });
      assert.equal((await request(inbox, { auth: auth.student })).data.unreadCount, 0);
      await assert.rejects(worker.query('SELECT * FROM student_system_notifications'), { code: '42501' });
    });

    const bank = (await request(prefix + '/problem-banks', { auth: auth.teacher, method: 'POST', status: 201, body: { name: 'Bank', requestId: randomUUID() } })).data;
    const p = (await request(prefix + '/problems', { auth: auth.teacher, method: 'POST', status: 201, body: { bankId: bank.id, requestId: randomUUID(), title: 'Double', statement: 'Return twice the integer.', mode: 'function', functionName: 'solve', referenceCode: 'def solve(data):\n return data*2 # PRIVATE_REFERENCE', samples: [{ input: '[2]', expected: '4' }], tests: [{ input: '[937]', expected: '1874', weight: 100 }] } })).data;
    const completed = { status: 'AC', score: 100, passed: 1, total: 1, publicMessage: '', privateResults: [{ position: 1, status: 'AC', cpuMs: 5, memoryBytes: 4096, stdout: 'PRIVATE_OUTPUT', stderr: 'PRIVATE_NOTE' }] };
    const mismatch = { judge: async task => ({ ...completed, status: 'WA', score: 0, passed: 0,
      privateResults: [{ ...completed.privateResults[0], testId: task.tests[0].id, status: 'WA', returned: '0' }] }) };
    await request(prefix + '/problems/' + p.id + '/validate', { auth: auth.teacher, method: 'POST', status: 202, body: { expectedRevision: 1, requestId: randomUUID() } });
    await processSchoolOne({ pool: worker, judge: { judge: async () => completed } });
    const published = (await request(prefix + '/problems/' + p.id + '/publish', { auth: auth.admin, method: 'POST', body: { expectedRevision: 1 } })).data;
    await request('/platform/problem-publications', { auth: auth.admin, method: 'POST', body: { schoolId: school.id, problemId: p.id, versionId: published.versionId } });
    const config = { kind: 'timed', title: 'Timed assessment', description: '', startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), durationMinutes: 30, problems: [{ problemId: p.id, versionId: published.versionId, points: 50 }], identityIds: [ids.student, ids.peer], requestId: randomUUID() };
    await t.test('teacher practice and assignment previews are isolated from formal student outcomes', async () => {
      const teacher = { auth: auth.teacher };
      const judge = process.env.GO_JUDGE_TEST_URL
        ? new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'assignment-preview-qa' })
        : { judge: async () => completed };
      const draft = { ...config, kind: 'assignment', title: 'Preview homework', requestId: randomUUID() };
      const { data: assignment } = await request(activities, { ...teacher, method: 'POST', status: 201, body: draft });
      assert.equal(assignment.canPreview, true);
      const path = activities + '/' + assignment.id;
      const preview = path + '/preview';
      const problem = preview + '/problems/' + p.id;
      await request(preview, { auth: auth.student, status: 404 });
      await request(preview, { auth: auth.outside, status: 404 });
      const { data: view } = await request(problem, teacher);
      assert.equal(view.activity.preview, true);
      assert.equal(view.versionId, published.versionId);
      assert.doesNotMatch(JSON.stringify(view), /PRIVATE_REFERENCE|1874|937/);
      const submission = { method: 'POST', status: 202, ...teacher, body: {
        kind: 'submit', code: 'def solve(data):\n return data*2', requestId: randomUUID(),
        versionId: view.versionId, expectedRevision: view.activity.revision,
      } };
      const tables = ['school_activity_attempts', 'school_activity_results', 'school_scholarship_ledger',
        'school_scholarship_receipts', 'school_rank_awards', 'luq_ledger'];
      const snapshots = async () => Promise.all(tables.map(async table => (await pool.query(
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
      )).rows));
      const before = await snapshots();
      const { data: job } = await request(problem + '/submissions', submission);
      assert.equal((await request(problem + '/submissions', submission)).data.id, job.id);
      await processSchoolOne({ pool: worker, judge });
      const jobPath = preview + '/jobs/' + job.id;
      assert.equal((await request(jobPath, teacher)).data.status, 'AC');
      await request(jobPath, { auth: auth.admin, status: 404 });
      await request(prefix + '/judge-jobs/' + job.id, { ...teacher, status: 404 });
      assert.equal((await request(preview, teacher)).data.grade.score, 50);
      assert.equal((await request(problem + '/submissions', teacher)).data.total, 1);
      assert.equal((await request(path + '/report', teacher)).data.items[0].grade.score, 0);
      await request(path, { ...teacher, method: 'PATCH', body: { ...draft, expectedRevision: assignment.revision } });
      await request(problem + '/submissions', { ...submission, status: 409 });
      assert.equal((await request(preview, teacher)).data.grade.score, 0);
      await request(path + '/publish', { ...teacher, method: 'POST', body: { expectedRevision: assignment.revision + 1 } });
      assert.equal((await request(path, { auth: auth.student })).data.grade.score, 0);

      const practice = prefix + '/problems/' + p.id;
      const { data: personal } = await request(practice + '/submissions', {
        ...submission, body: { ...submission.body, requestId: randomUUID() },
      });
      await processSchoolOne({ pool: worker, judge });
      assert.equal((await request(prefix + '/judge-jobs/' + personal.id, teacher)).data.status, 'AC');
      assert.equal((await request(practice + '/submissions', teacher)).data.solved, true);
      assert.deepEqual((await request(practice + '/submissions', { auth: auth.student })).data.items, []);
      assert.deepEqual((await request(prefix + '/submissions', teacher)).data.items.map(item => item.id), [personal.id]);
      assert.deepEqual(await snapshots(), before);
      assert.equal((await request(path, { auth: auth.student })).data.grade.score, 0);
    });
    let activity, failedJob;
    await t.test('session, CSRF, role, other-school and draft access checks', async () => {
      await request(activities, { status: 401 });
      await request(activities, { auth: auth.outside, status: 404 });
      await request(activities + '/options', { auth: auth.student, status: 403 });
      await request(activities, { auth: auth.teacher, method: 'POST', body: config, csrf: false, status: 403 });
      await request(activities, { auth: auth.student, method: 'POST', body: config, status: 403 });
      activity = (await request(activities, { auth: auth.teacher, method: 'POST', body: config, status: 201 })).data;
      await request(activities + '/' + activity.id, { auth: auth.student, status: 404 });
      await request('/schools/' + beta.id + '/activities/' + activity.id, { auth: auth.outside, status: 404 });
      await request(activities + '/' + activity.id + '/publish', { auth: auth.teacher, method: 'POST', body: { expectedRevision: 1 } });
    });
    const activityPath = () => activities + '/' + activity.id;
    const timedList = category => activities + '?kind=timed&timingCategory=' + category;
    await t.test('timing categories filter school and recipient scope before paging', async () => {
      const upcoming = (await request(activities, { auth: auth.teacher, method: 'POST', status: 201, body: {
        ...config, title: 'Future practice', startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(), identityIds: [ids.student], requestId: randomUUID(),
      } })).data;
      await request(activities + '/' + upcoming.id + '/publish', { auth: auth.teacher, method: 'POST', body: { expectedRevision: 1 } });
      const list = async (student, category) => (await request(timedList(category), { auth: auth[student] })).data.items.map(item => item.id);
      assert.deepEqual(await list('student', 'available'), [activity.id]);
      assert.deepEqual(await list('student', 'upcoming'), [upcoming.id]);
      assert.deepEqual(await list('student', 'completed'), []);
      assert.deepEqual(await list('peer', 'upcoming'), []);
      await request(timedList('invalid'), { auth: auth.student, status: 400 });
      await request(timedList('available'), { auth: auth.outside, status: 404 });
    });
    await t.test('formal results cannot leak through problem, public, job, metadata or personal list routes', async () => {
      await request(activityPath() + '/start', { auth: auth.student, method: 'POST' });
      const problem = await request(activityPath() + '/problems/' + p.id, { auth: auth.student });
      assert.equal(problem.cache, 'no-store'); assert.equal(problem.data.activity.canSubmit, true);
      for (const secret of ['PRIVATE_REFERENCE', '1874', '937']) assert.ok(!JSON.stringify(problem.data).includes(secret));
      await request(activityPath() + '/problems/' + p.id + '/submissions', { auth: auth.student, method: 'POST', status: 202, body: { kind: 'submit', code: 'def solve(data):\n return data*2', requestId: randomUUID(), deadlineAt: '2099-01-01' } });
      await processSchoolOne({ pool: worker, judge: { judge: async () => completed } });
      failedJob = (await request(activityPath() + '/problems/' + p.id + '/submissions', { auth: auth.student, method: 'POST', status: 202, body: { kind: 'submit', code: 'def solve(data): return 0', requestId: randomUUID() } })).data;
      await processSchoolOne({ pool: worker, judge: mismatch });
      for (const path of [prefix + '/problems/' + p.id, '/practice/problems/' + p.id]) {
        await request(path, { auth: auth.student, status: 403 });
        await request(path + '/submissions', { auth: auth.student, method: 'POST', status: 403, body: { kind: 'submit', code: 'pass', requestId: randomUUID() } });
      }
      for (const path of [activityPath() + '/jobs/' + failedJob.id, prefix + '/judge-jobs/' + failedJob.id]) {
        const r = await request(path, { auth: auth.student });
        assert.equal(r.data.status, 'Submitted'); assert.equal(r.data.score, null); assert.deepEqual(r.data.caseFeedback, []); assert.equal(r.cache, 'no-store');
        for (const secret of ['PRIVATE_OUTPUT', 'PRIVATE_NOTE']) assert.ok(!JSON.stringify(r.data).includes(secret));
      }
      const personal = (await request(prefix + '/submissions', { auth: auth.student })).data;
      assert.equal(personal.items.length, 0);
      const outsideFeed = (await request(prefix + '/problems/' + p.id + '/submissions', { auth: auth.peer })).data;
      assert.equal(outsideFeed.total, 0); assert.equal(outsideFeed.solved, false);
      const ownFeed = (await request(activityPath() + '/problems/' + p.id + '/submissions', { auth: auth.student })).data;
      assert.equal(ownFeed.items[0].status, 'Submitted'); assert.equal(ownFeed.items[0].runtimeMs, null); assert.equal(ownFeed.solved, false);
      await request(activityPath() + '/report', { auth: auth.student, status: 404 });
      await request(activityPath() + '/jobs/' + failedJob.id, { auth: auth.peer, status: 404 });
    });
    await t.test('closing rejects new submissions; first result publication exposes only safe final metadata', async () => {
      await request(activityPath() + '/end', { auth: auth.teacher, method: 'POST' });
      await request(activityPath() + '/problems/' + p.id + '/submissions', { auth: auth.student, method: 'POST', status: 409, body: { kind: 'submit', code: 'pass', requestId: randomUUID() } });
      const hidden = (await request(activityPath(), { auth: auth.student })).data; assert.equal(hidden.grade, null);
      const completedList = (await request(timedList('completed'), { auth: auth.student })).data.items;
      assert.deepEqual(completedList.map(item => [item.id, item.grade]), [[activity.id, null]]);
      await request(activityPath() + '/publish-results', { auth: auth.teacher, method: 'POST' });
      const final = (await request(activityPath(), { auth: auth.student })).data;
      assert.equal(final.grade.score, 50); assert.equal(final.grade.items[0].activityAttempts, 2);
      const problem = (await request(activityPath() + '/problems/' + p.id, { auth: auth.student })).data;
      assert.equal(problem.solved, true); assert.equal(problem.activity.canSubmit, false);
      const feed = (await request(activityPath() + '/problems/' + p.id + '/submissions', { auth: auth.peer })).data;
      assert.equal(feed.total, 1);
      const [latest] = feed.items;
      assert.equal(latest.id, failedJob.id); assert.equal(latest.status, 'WA'); assert.equal(latest.runtimeMs, 5); assert.equal(latest.memoryKb, 4);
      assert.ok(!JSON.stringify(feed).includes('PRIVATE_'));
      assert.equal((await request(prefix + '/submissions', { auth: auth.student })).data.items.length, 2);
      for (const path of [activityPath() + '/jobs/' + failedJob.id, prefix + '/judge-jobs/' + failedJob.id]) {
        const { data } = await request(path, { auth: auth.student });
        assert.equal(data.status, 'WA');
        assert.deepEqual(data.caseFeedback, [{ position: 1, status: 'WA', timeMs: 5, memoryKb: 4 }]);
        assert.doesNotMatch(JSON.stringify(data), /PRIVATE_|\[937\]|1874/);
      }
      await request(prefix + '/problems/' + p.id, { auth: auth.student });
    });
    await t.test('ordinary homework exposes the failed comparison in both authorized detail routes', async () => {
      const { data: assignment } = await request(activities, { auth: auth.teacher, method: 'POST', status: 201, body: {
        ...config, kind: 'assignment', title: 'Debugging homework', identityIds: [ids.peer], requestId: randomUUID(),
      } });
      const path = activities + '/' + assignment.id;
      await request(path + '/publish', { auth: auth.teacher, method: 'POST', body: { expectedRevision: 1 } });
      const { data: submitted } = await request(path + '/problems/' + p.id + '/submissions', { auth: auth.peer, method: 'POST', status: 202, body: {
        kind: 'submit', code: 'def solve(data): return 0', requestId: randomUUID(),
      } });
      await processSchoolOne({ pool: worker, judge: mismatch });
      for (const detail of [path + '/jobs/' + submitted.id, prefix + '/judge-jobs/' + submitted.id]) {
        const { data, cache } = await request(detail, { auth: auth.peer });
        assert.equal(data.status, 'WA');
        const [failed] = data.caseFeedback;
        assert.deepEqual([failed.input, failed.output, failed.expected], ['[937]', '0', '1874']);
        assert.doesNotMatch(JSON.stringify(data), /PRIVATE_/);
        assert.equal(cache, 'no-store');
        await request(detail, { auth: auth.student, status: 404 });
      }
    });
  } finally {
    await server?.close(); await worker?.end(); await pool.end(); await owner.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await owner.end();
  }
});
