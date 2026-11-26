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
    for (const name of ['admin', 'teacher', 'student', 'peer', 'fresh', 'outside']) {
      const identity = randomUUID();
      await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$2)", [identity, name]);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, hash])).rows[0];
    }
    const school = await provisionSchool(pool, { slug: 'activity-http-school', name: 'HTTP school', adminUsername: 'admin' });
    const beta = await provisionSchool(pool, { slug: 'activity-http-beta', name: 'Beta', adminUsername: 'outside' });
    await pool.query('INSERT INTO platform_admins(account_id) VALUES($1)', [users.admin.id]);
    for (const name of ['teacher', 'student', 'peer', 'fresh']) {
      const role = name === 'teacher' ? 'teacher' : 'student';
      await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [school.id, users[name].id, role]);
      ids[name] = (await pool.query('INSERT INTO school_identities(id,school_id,kind,number,name,account_id) SELECT identity_id,$1,$2,$3,$3,id FROM accounts WHERE id=$4 RETURNING id', [school.id, role, name, users[name].id])).rows[0].id;
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
    const classroom = (await request(prefix+'/classes',{auth:auth.admin,method:'POST',status:201,body:{name:'Assigned class',type:'training'}})).data;
    for(const identityId of [ids.teacher,ids.student,ids.peer,ids.fresh])
      await request(prefix+'/classes/'+classroom.id+'/roster',{auth:auth.admin,method:'POST',status:201,body:{identityId}});
    await t.test('assignment audience follows current teaching assignments even when roster management is delegated separately',async()=>{
      const adminPost = {auth:auth.admin,method:'POST',status:201};
      const other=(await request(prefix+'/classes',{...adminPost,body:{name:'Other class',type:'training'}})).data;
      const outsider=(await request(prefix+'/identities',{...adminPost,body:{kind:'student',number:'UNASSIGNED',name:'Unassigned'}})).data;
      const options=(await request(activities+'/options?view=assignment',{auth:auth.teacher})).data;
      assert.deepEqual(options.classes.map(c=>c.id),[classroom.id]);
      assert.ok(!options.students.some(s=>s.id===outsider.id));
      const body={kind:'assignment',title:'Scoped audience',problems:[],identityIds:[outsider.id],requestId:randomUUID()};
      const send=(changes,status)=>request(activities,{method:'POST',auth:auth.teacher,status,body:{...body,...changes,requestId:randomUUID()}});
      await send({},403); await send({identityIds:[],classIds:[other.id]},403);
      await request(prefix+'/classes/'+classroom.id+'/roster',{method:'POST',auth:auth.teacher,status:201,body:{identityId:outsider.id}});
      const grantPath=prefix+'/classes/'+classroom.id+'/roster/'+ids.teacher;
      const permissions = canManageStudents => ({permissions:{canRename:false,canManageStudents}});
      await request(grantPath,{method:'PATCH',auth:auth.admin,body:permissions(false)});
      await send({},201);
      await request(prefix+'/classes/'+classroom.id+'/roster/'+outsider.id,{method:'DELETE',auth:auth.teacher,status:403});
      await request(grantPath,{method:'PATCH',auth:auth.admin,body:permissions(true)});
      await request(prefix+'/classes/'+classroom.id+'/roster/'+outsider.id,{method:'DELETE',auth:auth.teacher});
      await send({},403);
    });
    await t.test('new-school grants notify only the intended student in the school inbox', async () => {
      const inbox = prefix + '/student-notifications';
      const grant = { identityIds: [ids.student], amount: 15, reason: 'Class award', requestId: randomUUID() };
      await request(inbox, { status: 401 });
      await request(inbox, { auth: auth.teacher, status: 403 });
      await request(inbox, { auth: auth.outside, status: 404 });
      assert.equal((await request(inbox, { auth: auth.student })).data.unreadCount, 0);
      await request(prefix + '/scholarship/grant', { auth: auth.admin, method: 'POST', body: grant });
      await request(prefix + '/scholarship/grant', { auth: auth.admin, method: 'POST', body: grant });
      const personalWallet = prefix + '/scholarship/me';
      const wallet = (await request(personalWallet, { auth: auth.student })).data;
      assert.equal(wallet.total, wallet.items.length);
      assert.equal(wallet.balance, wallet.items[0].balanceAfter);
      assert.equal(wallet.items[0].delta, 15);
      assert.deepEqual((await request(personalWallet + '?identityId=' + ids.peer, { auth: auth.student })).data, wallet);
      assert.ok((await request(personalWallet + '?identityId=' + ids.student, { auth: auth.peer })).data.items.every(row => row.identityId === ids.peer));
      await request(personalWallet, { auth: auth.outside, status: 404 });
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
    await t.test('assignment reward and draft save atomically with retry and revision protection', async () => {
      const post = { auth: auth.teacher, method: 'POST' };
      const body = { ...config, kind: 'assignment', title: 'Reward draft', requestId: randomUUID(), scholarshipRule: { amount: 10, requireAll: true } };
      const cap = (await request(activities + '/options', { auth: auth.teacher })).data.activityRewardCap;
      await request(activities, { ...post, body: { ...body, scholarshipRule: { amount: cap + 1 } }, status: 400 });
      await request(activities, { ...post, auth: auth.student, body, status: 403 });
      await request(activities, { ...post, auth: auth.outside, body, status: 404 });
      const { data: draft } = await request(activities, { ...post, body, status: 201 });
      assert.equal((await request(activities, { ...post, body })).data.id, draft.id);
      await request(activities, { ...post, body: { ...body, scholarshipRule: { amount: 9 } }, status: 409 });
      const rulePath = prefix + '/scholarship/activity-rule?activityId=' + draft.id;
      const readRule = async () => (await request(rulePath, { auth: auth.teacher })).data;
      assert.equal((await readRule()).revision, 1);
      assert.equal((await readRule()).requireAll, true);
      const path = activities + '/' + draft.id;
      await pool.query('UPDATE school_activity_problems SET reward_points=3 WHERE school_id=$1 AND activity_id=$2', [school.id, draft.id]);
      const patch = { ...body, title: 'Changed draft', expectedRevision: 1, scholarshipRule: { amount: 8, requireAll: true, expectedRevision: 1 } };
      await request(path, { auth: auth.teacher, method: 'PATCH', body: { ...patch, scholarshipRule: { ...patch.scholarshipRule, expectedRevision: 0 } }, status: 409 });
      assert.equal((await request(path, { auth: auth.teacher })).data.title, body.title);
      const updated = (await request(path, { auth: auth.teacher, method: 'PATCH', body: patch })).data;
      assert.equal(updated.problems[0].rewardPoints, 3);
      assert.equal((await readRule()).amount, 8);
      await request(path + '/publish', { ...post, body: { expectedRevision: updated.revision } });
      await request(path, { auth: auth.teacher, method: 'PATCH', body: patch, status: 409 });
    });
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
      assert.doesNotMatch(JSON.stringify(view), /PRIVATE_REFERENCE|"1874"|"\[937\]"/);
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
      assert.doesNotMatch(JSON.stringify(problem.data), /PRIVATE_REFERENCE|"1874"|"\[937\]"/);
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
        assert.doesNotMatch(JSON.stringify(data), /PRIVATE_|\[937\]|"1874"/);
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
    await t.test('homework accepts a first late attempt without awarding completion or changing the official grade', async () => {
      const teacher = { auth: auth.teacher };
      const judge = process.env.GO_JUDGE_TEST_URL
        ? new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'assignment-cutoff-qa' })
        : { judge: async () => completed };
      const { data: assignment } = await request(activities, { ...teacher, method: 'POST', status: 201, body: {
        ...config, kind: 'assignment', title: 'Homework cutoff', requestId: randomUUID(),
      } });
      const path = activities + '/' + assignment.id, problem = path + '/problems/' + p.id;
      await request(prefix + '/scholarship/activity-rule', { ...teacher, method: 'POST', body: {
        activityId: assignment.id, amount: 12, requireAll: true, expectedRevision: 0,
      } });
      await request(path + '/publish', { ...teacher, method: 'POST', body: { expectedRevision: 1 } });
      const submit = (student, body, status = 202) => request(problem + '/submissions', {
        auth: auth[student], method: 'POST', status, body,
      });
      const solution = { kind: 'submit', code: 'def solve(data): return data*2' };
      const { data: onTime } = await submit('student', { ...solution, requestId: randomUUID() });
      const awards = async () => (await pool.query(`SELECT award.identity_id, ledger.delta FROM school_scholarship_activity_awards award
        JOIN school_scholarship_ledger ledger ON ledger.school_id=award.school_id AND ledger.id=award.ledger_id
        WHERE award.school_id=$1 AND award.activity_id=$2`, [school.id, assignment.id])).rows;
      assert.deepEqual(await awards(), []);
      // Let the cutoff pass while the on-time submission is still queued.
      await pool.query('UPDATE school_activities SET ends_at=clock_timestamp() WHERE school_id=$1 AND id=$2', [school.id, assignment.id]);
      await processSchoolOne({ pool: worker, judge });
      assert.equal((await request(path + '/jobs/' + onTime.id, { auth: auth.student })).data.status, 'AC');
      assert.deepEqual(await awards(), [{ identity_id: ids.student, delta: 12 }]);

      const peer = { auth: auth.peer };
      const view = (await request(problem, peer)).data;
      assert.equal(view.activity.phase, 'Ended');
      assert.equal(view.activity.canSubmit, true);
      const lateBody = { ...solution, requestId: randomUUID() };
      await submit('outside', lateBody, 404);
      const { data: late } = await submit('peer', lateBody);
      assert.equal((await submit('peer', lateBody)).data.id, late.id);
      const { rows: [receipt] } = await pool.query(`SELECT j.created_at>a.ends_at AS late, j.activity_deadline_at=a.ends_at AS cutoff,
        t.started_at>a.ends_at AS started_late FROM school_judge_jobs j
        JOIN school_activities a ON a.school_id=j.school_id AND a.id=j.activity_id
        JOIN school_activity_attempts t ON t.school_id=j.school_id AND t.id=j.activity_attempt_id
        WHERE j.school_id=$1 AND j.id=$2`, [school.id, late.id]);
      assert.deepEqual(receipt, { late: true, cutoff: true, started_late: true });
      await processSchoolOne({ pool: worker, judge });
      const verdict = (await request(path + '/jobs/' + late.id, peer)).data;
      assert.equal(verdict.status, 'AC');
      const history = (await request(problem + '/submissions', peer)).data;
      assert.ok(history.items.some(item => item.id === late.id && item.status === 'AC'));
      const { grade, progress } = (await request(path, peer)).data;
      assert.equal(grade.score, 0);
      assert.equal(grade.items[0].activityAttempts, 0);
      assert.equal(progress.solved, 1);
      assert.equal(progress.items[0].status, 'AC');
      assert.equal(progress.items[0].activityAttempts, 1);
      const matrix = (await request(path+'/report?view=assignment',teacher)).data.items.find(row=>row.id===ids.peer);
      assert.equal(matrix.grade.score,0);
      assert.equal(matrix.progress.items[0].matrixStatus,'AC');
      assert.equal(matrix.progress.items[0].activityAttempts,1);
      const directory = (await request(activities+'?kind=assignment&view=assignment',teacher)).data.items;
      assert.equal(directory.find(row=>row.id===assignment.id).completedStudents,2);
      assert.equal((await request(problem, peer)).data.solved, true);
      assert.equal(history.solved, true);
      assert.deepEqual(await awards(), [{ identity_id: ids.student, delta: 12 }]);

      await request(path + '/finish', { ...peer, method: 'POST' });
      assert.equal((await request(problem, peer)).data.activity.canSubmit, false);
      await submit('peer', { ...solution, requestId: randomUUID() }, 409);
      await request(path + '/archive', { ...teacher, method: 'POST' });
      const archived = (await request(activities+'?kind=assignment&archived=true',peer)).data;
      assert.ok(archived.items.some(item=>item.id===path.split('/').at(-1)));
      assert.equal((await request(path,peer)).data.canSubmit,false);
      await request(path,{auth:auth.outside,status:404});
      await submit('student', { ...solution, requestId: randomUUID() }, 404);
    });
    await t.test('assignment changes notify affected students, preserve history, and use the personal cutoff', async () => {
      const teacher = { auth: auth.teacher }, student = { auth: auth.student }, peer = { auth: auth.peer };
      const judge = process.env.GO_JUDGE_TEST_URL
        ? new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'assignment-change-qa' })
        : { judge: async () => completed };
      const { data: a } = await request(activities, { ...teacher, method: 'POST', status: 201, body: {
        ...config, kind: 'assignment', title: 'Adjusted homework', requestId: randomUUID(), scholarshipRule: { amount: 12, requireAll: true },
      } });
      const path = activities + '/' + a.id, submit = path + '/problems/' + p.id + '/submissions';
      const studentPath = path + '/participants/' + ids.student;
      const peerPath = path + '/participants/' + ids.peer;
      const notices = async auth => (await request(prefix + '/student-notifications', auth)).data.items
        .filter(item => item.kind === 'assignment_change' && item.assignmentId === a.id);
      await request(path + '/publish', { ...teacher, method: 'POST', body: { expectedRevision: 1 } });
      await pool.query('UPDATE school_activities SET ends_at=clock_timestamp() WHERE school_id=$1 AND id=$2', [school.id, a.id]);
      const dueAt = new Date(Date.now() + 7200000).toISOString();
      const extend = { method: 'PATCH', body: { dueAt, reason: 'Extra practice time' } };
      await request(studentPath, { ...student, ...extend, status: 404 });
      await request(studentPath, { auth: auth.outside, ...extend, status: 404 });
      await request(studentPath, { ...teacher, ...extend });
      await request(studentPath, { ...teacher, ...extend });
      assert.equal((await request(path, student)).data.endsAt, dueAt);
      assert.notEqual((await request(path, peer)).data.endsAt, dueAt);
      assert.deepEqual((await notices(student)).map(item => [item.action, new Date(item.dueAt).toISOString()]), [['extended', dueAt], ['assigned', a.endsAt ? new Date(a.endsAt).toISOString() : null]]);
      assert.deepEqual((await notices(peer)).map(item => item.action), ['assigned']);
      const run = { method: 'POST', body: { kind: 'submit', code: 'def solve(data): return data*2', requestId: randomUUID() } };
      const { data: job } = await request(submit, { ...student, ...run, status: 202 });
      const receipt = (await pool.query('SELECT activity_deadline_at FROM school_judge_jobs WHERE school_id=$1 AND id=$2', [school.id, job.id])).rows[0];
      assert.equal(receipt.activity_deadline_at.toISOString(), dueAt);
      const exempt = { method: 'PATCH', body: { exempt: true, reason: 'Excused' } };
      await request(peerPath, { ...teacher, ...exempt });
      await request(peerPath, { ...teacher, ...exempt });
      await request(path, { ...peer, status: 404 });
      await request(submit, { ...peer, ...run, status: 404 });
      assert.deepEqual((await notices(peer)).map(item => item.action), ['exempted', 'assigned']);
      await request(peerPath, { ...teacher, method: 'PATCH', body: { exempt: false, reason: 'Reinstated' } });
      const cancel = { method: 'POST' };
      await request(activityPath() + '/cancel', { ...teacher, ...cancel, status: 409 });
      await request(path + '/cancel', { ...student, ...cancel, status: 404 });
      assert.ok((await request(path + '/cancel', { ...teacher, ...cancel })).data.cancelledAt);
      await request(path + '/cancel', { ...teacher, ...cancel });
      assert.deepEqual((await notices(student)).map(item => item.action), ['cancelled', 'extended', 'assigned']);
      assert.deepEqual((await notices(peer)).map(item => item.action), ['cancelled', 'reinstated', 'exempted', 'assigned']);
      await request(submit, { ...student, ...run, body: { ...run.body, requestId: randomUUID() }, status: 404 });
      await processSchoolOne({ pool: worker, judge });
      assert.equal((await request(path + '/jobs/' + job.id, student)).data.status, 'AC');
      await request(path + '/jobs/' + job.id, { ...peer, status: 404 });
      const report = (await request(path + '/report', teacher)).data;
      assert.equal(report.items.find(item => item.id === ids.student).grade.score, config.problems[0].points);
      const awards = (await pool.query('SELECT identity_id FROM school_scholarship_activity_awards WHERE school_id=$1 AND activity_id=$2', [school.id, a.id])).rows;
      assert.deepEqual(awards, [{ identity_id: ids.student }]);
    });

    await t.test('publishes an assigned notice and a readable deadline reminder', async () => {
      const teacher = { auth: auth.teacher }, student = { auth: auth.fresh };
      const { data: a } = await request(activities, { ...teacher, method: 'POST', status: 201, body: {
        ...config, kind: 'assignment', title: 'Reminder homework', identityIds: [ids.student,ids.fresh], requestId: randomUUID(),
        endsAt: new Date(Date.now() + 24 * 3600000).toISOString(),
      } });
      const path = activities + '/' + a.id;
      const inbox = prefix + '/student-notifications';
      const allNotices = async auth => (await request(inbox, auth)).data.items;
      const changeNotices = async auth => (await allNotices(auth)).filter(item => item.kind === 'assignment_change' && item.assignmentId === a.id);
      const reminderNotices = async auth => (await allNotices(auth)).filter(item => item.kind === 'assignment_reminder' && item.assignmentId === a.id);
      await request(path + '/publish', { ...teacher, method: 'POST', body: { expectedRevision: 1 } });
      assert.deepEqual((await changeNotices(student)).map(item => item.action), ['assigned']);
      assert.equal((await reminderNotices(student)).length, 1);
      assert.equal((await reminderNotices(student))[0].activityTitle, 'Reminder homework');
      assert.ok((await reminderNotices(student))[0].dueAt);
      const { data: inboxData } = await request(inbox, student);
      const reminder = inboxData.items.find(item => item.kind === 'assignment_reminder' && item.assignmentId === a.id);
      assert.ok(reminder && !reminder.readAt);
      assert.equal((await request(inbox + '/' + reminder.id + '/read', { ...student, method: 'POST' })).data.ok, true);
      assert.deepEqual(await reminderNotices(student), []);
      assert.deepEqual(await reminderNotices({ auth: auth.student }), [], 'a previously solved exercise needs no reminder');
      // Historical receipts retain their original identity, school, and language.
      await pool.query("INSERT INTO problems(id,owner_account_id) VALUES($1,$2)", [p.id,users.teacher.id]);
      await pool.query(`INSERT INTO problem_versions(id,problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code)
        VALUES($1,$2,'Double','stdio','Double',500,64,'print(2)')`, [published.versionId,p.id]);
      await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score,language)
        VALUES($1,$2,$3,$4,'submit','print(2)',$5,'receipt','AC',100,'python')`,
        [users.fresh.id,ids.fresh,p.id,published.versionId,randomUUID()]);
      const receipt = (await pool.query("SELECT 'SUB'||id AS id,to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day FROM submissions WHERE identity_id=$1 AND problem_id=$2 ORDER BY id DESC LIMIT 1",[ids.fresh,p.id])).rows[0];
      const daily = prefix+'/submissions/students/'+ids.fresh, day='?date='+receipt.day;
      assert.ok((await request(daily+day,{auth:auth.admin})).data.items.some(row=>row.id===receipt.id && row.status==='AC'));
      assert.deepEqual((await request(daily+'/'+receipt.id+day,{auth:auth.admin})).data,{code:'print(2)'});
      const grade = async () => (await request(path, student)).data.grade;
      assert.equal((await grade()).score, config.problems[0].points);
      assert.equal((await grade()).items[0].inherited,true);
      await pool.query("UPDATE school_activities SET required_language='cpp' WHERE school_id=$1 AND id=$2",[school.id,a.id]);
      assert.equal((await grade()).score,0);
    });
    await t.test('migrated assignment pins show only the admitted platform chapter for their exact version', async () => {
      const { rows: [course] } = await pool.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,platform_audience_scope,published_at)
        VALUES($1,'Platform Python','platform','custom',now()) RETURNING id`, [users.admin.id]);
      await pool.query("INSERT INTO platform_course_rules(course_id,rule_key,target_kind,identity_id) VALUES($1,'pupil','account',$2)", [course.id, ids.student]);
      const { rows: [chapter] } = await pool.query(`INSERT INTO learning_chapters(path_id,title,content,checkpoint_answer,position)
        VALUES($1,'Loops','The loop lesson','PRIVATE_CHECKPOINT',0) RETURNING id`, [course.id]);
      const { rows: [source] } = await pool.query("INSERT INTO problems(owner_account_id,owner_scope) VALUES($1,'platform') RETURNING id", [users.admin.id]);
      const addVersion = async () => (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,time_limit_ms,memory_limit_mb)
        VALUES($1,'Loops','stdio','Use a loop','PRIVATE_REFERENCE',500,64) RETURNING id`, [source.id])).rows[0].id;
      const pin = await addVersion(), other = await addVersion();
      await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapter.id, source.id, pin]);
      const { rows: [bank] } = await pool.query(`INSERT INTO school_problem_banks(school_id,name,owner_account_id,request_id,resource_kind)
        VALUES($1,'Execution snapshots',$2,$3,'publication') RETURNING id`, [school.id, users.admin.id, randomUUID()]);
      await pool.query(`INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id)
        VALUES($1,$2,$3,$4,'{}',$2)`, [school.id,source.id,bank.id,users.admin.id]);
      await pool.query(`INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition)
        SELECT school_id,$2,$3,1,definition FROM school_problem_versions WHERE school_id=$1 AND id=$4`, [school.id,pin,source.id,published.versionId]);
      const { rows: [hw] } = await pool.query(`INSERT INTO school_activities(school_id,owner_account_id,kind,title,state,published_at,request_id,request_hash,platform_course_id)
        VALUES($1,$2,'assignment','HW2','Published',now(),$3,'fixture',$4) RETURNING id`, [school.id,users.teacher.id,randomUUID(),course.id]);
      await pool.query('INSERT INTO school_activity_problems(school_id,activity_id,problem_id,version_id,position,points) VALUES($1,$2,$3,$4,1,100)', [school.id,hw.id,source.id,pin]);
      await pool.query('INSERT INTO school_activity_participants(school_id,activity_id,identity_id) VALUES($1,$2,$3),($1,$2,$4)', [school.id,hw.id,ids.student,ids.peer]);
      const path = activities + '/' + hw.id + '/problems/' + source.id;
      const get = async (who, query = '') => (await request(path + query, { auth:auth[who] })).data;
      await request(prefix + '/problems/' + source.id + '/tutorial', { auth:auth.student, status:404 });
      const view = await get('student');
      assert.deepEqual(view.tutorial, {source:'course',courseTitle:'Platform Python',title:'Loops',body:'The loop lesson'});
      assert.doesNotMatch(JSON.stringify(view), /PRIVATE_/);
      assert.equal((await get('peer', '?courseId=' + course.id)).tutorial, undefined);
      await request(path, { auth:auth.fresh, status:404 });
      await pool.query("UPDATE problems SET tutorial_mode='none' WHERE id=$1", [source.id]);
      assert.equal((await get('student')).tutorial, undefined);
      await pool.query("UPDATE problems SET tutorial_mode='course' WHERE id=$1", [source.id]);
      await pool.query('UPDATE chapter_problems SET version_id=$2 WHERE chapter_id=$1', [chapter.id,other]);
      assert.equal((await get('student', '?versionId=' + other)).tutorial, undefined);
    });
    await t.test('school assignment editor keeps an exact roster, authorized course, marks, award and feedback', async () => {
      const staff = {auth:auth.teacher}, post = {...staff,method:'POST'}, patch = {...staff,method:'PATCH'};
      const {rows:[group]} = await pool.query("INSERT INTO school_classes(school_id,name) VALUES($1,'Editor class') RETURNING id",[school.id]);
      await pool.query('INSERT INTO school_class_roster(school_id,class_id,identity_id) VALUES($1,$2,$3),($1,$2,$4),($1,$2,$5)',[school.id,group.id,ids.fresh,ids.peer,ids.teacher]);
      const {rows:[course]} = await pool.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,platform_audience_scope,published_at,required_language)
        VALUES($1,'Authorized assignment course','platform','custom',now(),'python') RETURNING id`,[users.admin.id]);
      const selector=activities+'/options?view=assignment';
      assert.equal((await request(selector,staff)).data.courses.some(c=>c.id===course.id),false);
      await pool.query(`INSERT INTO platform_content_editors(resource_kind,resource_id,account_id,school_id,granted_by)
        VALUES('course',$1,$2,$3,$4)`,[course.id,users.teacher.id,school.id,users.admin.id]);
      assert.equal((await request(selector,staff)).data.courses.find(c=>c.id===course.id).requiredLanguage,'python');
      const body={...config,kind:'assignment',requestId:randomUUID(),title:'Scoped assignment',audienceMode:'selected',
        classIds:[group.id],identityIds:[ids.fresh],problems:[{problemId:p.id,versionId:published.versionId,points:37.25,rewardPoints:7}],
        subjectLabel:'Computing',courseId:course.id,problemOrder:'course',scholarshipRule:{amount:9,requireAll:true,expectedRevision:0}};
      await request(activities,{...post,body:{...body,problems:[{...body.problems[0],rewardPoints:21}]},status:400});
      const draft=(await request(activities,{...post,body,status:201})).data, path=activities+'/'+draft.id;
      assert.deepEqual(draft.identityIds,[ids.fresh]); assert.equal(draft.subjectLabel,'Computing');
      assert.equal(draft.courseTitle,'Authorized assignment course'); assert.equal(draft.requiredLanguage,'python');
      assert.equal(draft.problems[0].points,37.25); assert.equal((await request(activities,{...post,body})).data.id,draft.id);
      await request(path+'/archive',{...post,body:{}});
      const restored=(await request(path+'/restore',{...post,body:{}})).data;
      assert.equal(restored.state,'Draft');
      const publish={...post,body:{expectedRevision:restored.revision,expectedRuleRevision:1}};
      await request(path+'/publish',{...publish,body:{...publish.body,expectedRuleRevision:0},status:409});
      await pool.query("UPDATE platform_content_editors SET revoked_at=now() WHERE resource_id=$1",[course.id]);
      await request(path+'/publish',{...publish,status:409});
      await pool.query("UPDATE platform_content_editors SET revoked_at=NULL WHERE resource_id=$1",[course.id]);
      const assigned=(await request(path+'/publish',publish)).data;
      await request(path,{auth:auth.peer,status:404});
      const extended=(await request(path+'/manage',{...patch,body:{expectedRevision:assigned.revision,endsAt:new Date(Date.parse(assigned.endsAt)+3600000).toISOString()}})).data;
      await request(path+'/manage',{...patch,auth:auth.outside,body:{expectedRevision:extended.revision,title:'unavailable'},status:404});
      const problemPath=path+'/problems/'+p.id+'/submissions';
      const judge=process.env.GO_JUDGE_TEST_URL ? new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'assignment-editor-qa'}) : {judge:async()=>completed};
      const submit=async()=> {
        const {data}=await request(problemPath,{auth:auth.fresh,method:'POST',status:202,body:{kind:'submit',code:'def solve(data): return data*2',requestId:randomUUID()}});
        await processSchoolOne({pool:worker,judge}); return data.id;
      };
      const job=await submit(); await submit();
      const grade=(await request(path+'/report',staff)).data.items[0].grade;
      assert.equal(grade.score,37.25); assert.equal(grade.items[0].activityAttempts,2); assert.equal(grade.items[0].matrixStatus,'AC');
      assert.equal((await request(activities+'?kind=assignment&view=assignment',staff)).data.items.find(a=>a.id===draft.id).completedStudents,1);
      const ledger=(await pool.query("SELECT delta FROM school_scholarship_ledger WHERE school_id=$1 AND identity_id=$2 AND kind='activity' AND metadata->>'activityId'=$3 ORDER BY delta",[school.id,ids.fresh,draft.id])).rows;
      assert.deepEqual(ledger.map(r=>r.delta),[7,9]);
      const history=path+'/report/'+ids.fresh+'?problemId='+p.id;
      const records=(await request(history,staff)).data.items;
      assert.equal(records.length,2); assert.equal(records[0].status,'AC'); assert.doesNotMatch(JSON.stringify(records),/PRIVATE_/);
      await request(history,{auth:auth.peer,status:404});
      await request(history,{auth:auth.outside,status:404});
      await request(history,{...post,body:{submissionId:job,note:'Feedback on this submission'},status:201});
      assert.equal((await request(prefix+'/judge-jobs/'+job,{auth:auth.fresh})).data.reviews[0].note,'Feedback on this submission');
      await request(prefix+'/judge-jobs/'+job,{auth:auth.peer,status:404});
      const managed=(await request(path+'?view=assignment',staff)).data;
      assert.deepEqual(managed.protectedParticipantIds,[ids.fresh]);
      await request(path+'/manage',{...patch,body:{expectedRevision:managed.revision,identityIds:[ids.peer]},status:409});
      await request(path+'/manage',{...patch,body:{expectedRevision:managed.revision,problems:body.problems},status:409});
      assert.equal((await request(path+'/manage',{...patch,body:{expectedRevision:managed.revision,title:'Renamed'}})).data.title,'Renamed');
      await request(path+'/archive',{...post,body:{}}); assert.equal((await request(path+'/restore',{...post,body:{}})).data.state,'Published');
      await request(path+'/cancel',{...post,body:{}}); await request(path+'/restore',{...post,body:{},status:409});
    });
    await t.test('assignment problem import atomically creates only school drafts and preserves the package language', async () => {
      const path=prefix+'/problems/import';
      const post={auth:auth.teacher,method:'POST'};
      const definition={title:'Imported JavaScript',statement:'Read a line and echo it.',mode:'stdio',referenceLanguage:'javascript',
        referenceCode:"console.log(require('node:fs').readFileSync(0,'utf8').trim())",starterCode:'',samples:[{input:'7',expected:'7'}],tests:[{input:'8',expected:'8',weight:100}]};
      const body={bankName:'Import destination',idempotencyKey:randomUUID(),problems:[definition]};
      await request(path,{...post,auth:auth.student,body,status:403});
      await request(path,{...post,auth:auth.outside,body,status:404});
      await request(path,{...post,body:{...body,problems:[definition,{...definition,tests:[]}]},status:400});
      assert.equal((await pool.query('SELECT id FROM school_problem_banks WHERE school_id=$1 AND name=$2',[school.id,body.bankName])).rowCount,0);
      await request(path,{...post,body,status:201});
      assert.equal((await request(path,{...post,body})).data.importedCount,1);
      await request(path,{...post,body:{...body,bankName:'Conflicting'},status:409});
      const {rows} = await pool.query("SELECT id,draft,published FROM school_problems WHERE school_id=$1 AND draft->>'title'=$2",[school.id,definition.title]);
      assert.equal(rows.length,1); assert.equal(rows[0].published,false); assert.equal(rows[0].draft.reference_language,'javascript');
      const created=prefix+'/problems/'+rows[0].id;
      await request(created,{auth:auth.student,status:404});
      await request(created+'/validate',{...post,body:{expectedRevision:1,requestId:randomUUID()},status:202});
      const queued=(await pool.query('SELECT payload FROM school_judge_jobs WHERE school_id=$1 AND problem_id=$2',[school.id,rows[0].id])).rows[0];
      assert.equal(queued.payload.language,'javascript');
      const judge=process.env.GO_JUDGE_TEST_URL ? new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'assignment-import-qa'}) : {judge:async()=>completed};
      await processSchoolOne({pool:worker,judge});
      assert.equal((await request(created,{auth:auth.teacher})).data.validation.status,'AC');
    });
    await t.test('bank controls and scholarship review track the exact bank, problem and published version', async () => {
      const staff = { auth: auth.teacher }, targets = prefix + '/scholarship/targets';
      const listed = async () => (await request(targets, staff)).data.items;
      const find = async () => (await listed()).find(row => row.problemId === p.id);
      const row = await find();
      assert.equal(row.bankId, bank.id);
      assert.equal(row.bankName, bank.name);
      assert.equal(row.hasOriginalSolution, true);
      assert.equal(row.hasPreviousSolution, false);
      assert.deepEqual(row.contents, []);
      assert.doesNotMatch(JSON.stringify(row), /PRIVATE_REFERENCE|1874/);
      await request(targets, { auth: auth.student, status: 403 });
      await request(targets, { auth: auth.outside, status: 404 });
      const target = { problemId: p.id, versionId: published.versionId, kind: 'FULL_SOLUTION' };
      const editor = prefix + '/scholarship/content';
      const content = (await request(editor + '?' + new URLSearchParams(target), staff)).data;
      assert.match(content.originalSolution.body, /PRIVATE_REFERENCE/);
      const saved = (await request(editor, { ...staff, method: 'POST', body: { ...target, body: 'Reviewed worked solution' } })).data;
      assert.equal((await find()).contents[0].status, 'draft');
      await request(prefix + '/scholarship/contents/review', { auth: auth.admin, method: 'POST', body: { confirmReviewed: true, items: [saved] } });
      assert.equal((await find()).contents[0].status, 'published');
      const duplicate = randomUUID(), version = randomUUID();
      await pool.query(`INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id)
        VALUES($1,$2,$3,$4,'{}',$2)`, [school.id, duplicate, bank.id, users.teacher.id]);
      await pool.query(`INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition)
        VALUES($1,$2,$3,1,$4)`, [school.id, version, duplicate, JSON.stringify({ title: row.title })]);
      await pool.query('UPDATE school_problems SET published_version_id=$2,published=true WHERE school_id=$1 AND id=$3', [school.id, version, duplicate]);
      const other = (await listed()).find(item => item.problemId === duplicate);
      assert.equal(other.hasOriginalSolution, false);
      assert.equal(other.hasPreviousSolution, false);
      assert.deepEqual(other.contents, []);
      const newer = randomUUID();
      await pool.query(`INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition)
        SELECT school_id,$2,problem_id,draft_revision+1,definition FROM school_problem_versions WHERE school_id=$1 AND id=$3`, [school.id, newer, published.versionId]);
      await pool.query('UPDATE school_problems SET published_version_id=$2 WHERE school_id=$1 AND id=$3', [school.id, newer, p.id]);
      assert.equal((await find()).hasPreviousSolution, true);
      assert.deepEqual((await find()).contents, []);
      const changeBank = (auth, archived, expectedRevision, status = 200) => request(prefix + '/problem-banks/' + bank.id,
        { auth, method: 'PATCH', body: { archived, expectedRevision }, status });
      await changeBank(auth.student, true, 1, 403);
      await changeBank(auth.teacher, true, 1);
      assert.ok(!(await request(prefix + '/problem-banks', { auth: auth.student })).data.items.some(b => b.id === bank.id));
      await changeBank(auth.teacher, false, 2);
      assert.ok((await request(prefix + '/problem-banks', { auth: auth.student })).data.items.some(b => b.id === bank.id));
    });
    await t.test('only school administrators can read every school attempt and its own source on a Beijing calendar day', async()=>{
      const base=prefix+'/submissions/students/'+ids.student;
      const date='?date=2020-02-29', admin={auth:auth.admin};
      const add=async(kind,instant,code,scope='school')=>{
        const {rows:[job]}=await pool.query(`INSERT INTO school_judge_jobs
          (school_id,problem_id,version_id,account_id,identity_id,kind,access_context,request_id,request_hash,payload,state,result,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,gen_random_uuid(),'qa',$8,'completed',$9,$10) RETURNING id`,
          [school.id,p.id,published.versionId,users.student.id,scope==='school'?ids.student:null,kind,scope,
           JSON.stringify({language:'python',code}),JSON.stringify({status:'WA',score:0}),instant]);
        return job.id;
      };
      const first=await add('samples','2020-02-28T16:00:00Z','sample');
      const repeated=await add('submit','2020-02-29T02:05:00Z','first source');
      const again=await add('submit','2020-02-29T02:05:10Z','second source');
      const last=await add('custom','2020-02-29T15:59:59.999999Z','custom');
      await add('samples','2020-02-29T16:00:00Z','next date');
      const privateJob=await add('samples','2020-02-29T02:10:00Z','private source','public');
      const result=(await request(base+date,admin)).data;
      assert.deepEqual(result.items.map(row=>row.id),[first,repeated,again,last]);
      assert.equal(result.total,4);
      assert.ok(result.items.every(row=>row.title==='Double' && row.status==='WA' && !('code' in row)));
      for (const [id,code] of [[first,'sample'],[again,'second source'],[repeated,'first source'],[last,'custom']])
        assert.deepEqual((await request(base+'/'+id+date,admin)).data,{code});
      await request(base+'/'+privateJob+date,{...admin,status:404});
      await request(prefix+'/submissions/students/'+ids.peer+'/'+first+date,{...admin,status:404});
      await request(base+'?date=2021-02-29',{...admin,status:400});
      assert.equal((await request(base+'?date=2020-02-28',admin)).data.total,0);
      await pool.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,kind,access_context,
        request_id,request_hash,payload,state,result,created_at)
        SELECT $1,$2,$3,$4,$5,'samples','school',gen_random_uuid(),'qa','{}','completed','{"status":"CE"}','2020-02-29 08:00:00+08'
        FROM generate_series(1,50)`,[school.id,p.id,published.versionId,users.student.id,ids.student]);
      const pages=await Promise.all([1,2].map(page=>request(base+date+'&page='+page,admin)));
      assert.deepEqual(pages.map(p=>p.data.items.length),[50,4]);
      assert.equal(new Set(pages.flatMap(p=>p.data.items.map(row=>row.id))).size,54);
      for(const suffix of [date,'/'+first+date]){
        await request(base+suffix,{status:401});
        for(const who of ['student','peer','teacher'])await request(base+suffix,{auth:auth[who],status:403});
        await request(base+suffix,{auth:auth.outside,status:404});
        await request('/schools/'+beta.id+'/submissions/students/'+ids.student+suffix,{auth:auth.outside,status:404});
      }
    });
  } finally {
    await server?.close(); await worker?.end(); await pool.end(); await owner.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await owner.end();
  }
});
