import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { canonicalHash, hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

test('ACSL teacher management authorizes local staff and preserves grades, exports and judge isolation', { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL); assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const schema = `acsl_manage_${randomBytes(5).toString('hex')}`, manager = createPool(base.href);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href); let server, app, worker;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url'), passwordHash = await hashPassword(password), users = {};
    for (const [name, kind, role] of [ ['admin','teacher','admin'], ['teacher','teacher','teacher'], ['historical','student','student'], ['pending','student','student'], ['fresh','student','student'],
      ['schooladmin','personal',null], ['schoolteacher','personal',null], ['overlay','personal',null], ['outsider','personal',null] ]) {
      const identity = randomUUID();
      await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identity, kind, name]);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, passwordHash])).rows[0];
      if (role) await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [users[name].id, role]);
    }
    const school = await provisionSchool(pool, { slug: 'manage-school', name: 'Manage school', adminUsername: 'schooladmin' });
    for (const [name, role] of [['schoolteacher','teacher'], ['overlay','student'], ['teacher','student']]) {
      await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [school.id, users[name].id, role]);
    }
    await pool.query('INSERT INTO school_administrators(school_id,account_id,granted_by) VALUES($1,$2,$3)', [school.id, users.overlay.id, users.schooladmin.id]);
    const original = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    original.programming.solution ??= { language: 'python', provenance: 'independent',
      code: original.programming.definition.referenceCode, explanation: { en: 'Card simulation.', zh: '模拟出牌。' },
      complexity: { en: 'O(n²) time, O(n) space.', zh: '时间 O(n²)，空间 O(n)。' } };
    original.slug = 'acsl-management-test';
    const paper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.admin.id, content: original, enablePoints: true });
    const other = await importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.schooladmin.id, content: original });
    const asRole = role => { const url = new URL(scoped); url.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return url.href; };
    app = createPool(asRole('campus_app')); worker = createPool(asRole('campus_worker'));
    const origin = 'http://acsl-manage.test';
    server = await createApiApplication({ databaseUrl: asRole('campus_app'), logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const host = await server.getUrl();
    const request = async (path, { auth, method = 'GET', body, status = 200, csrf = true } = {}) => {
      const response = await fetch(`${host}/api/v1${path}`, { method, headers: { Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, ...(csrf ? { 'X-CSRF-Token': auth.csrfToken } : {}) } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json(); assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${response.status}: ${JSON.stringify(data)}`);
      return { data, status: response.status, cache: response.headers.get('cache-control'), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const auth = {};
    for (const name of Object.keys(users)) { const login = await request('/auth/login', { method: 'POST', body: { username: name, password } }); auth[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
    const root = `/schools/${LEGACY_SCHOOL_ID}/acsl`, path = `${root}/${paper.id}`, manage = `${root}/manage/${paper.id}`;
    const otherRoot = `/schools/${school.id}/acsl`, otherManage = `${otherRoot}/manage/${other.id}`;
    const submitBody = { versionId: paper.versionId, revisions: Object.fromEntries(original.questions.map(q => [q.id, 1])) };
    for (const name of ['historical', 'pending']) for (const question of original.questions) {
      await request(`${path}/questions/${question.id}/draft`, { auth: auth[name], method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds } });
    }
    const oldGrade = (await request(`${path}/submit`, { auth: auth.historical, method: 'POST', body: submitBody })).data;
    const programming = (await request(`${path}/programming`, { auth: auth.historical })).data;
    const queued = (await request(`${path}/programming/submissions`, { auth: auth.historical, method: 'POST', status: 202, body: { paperVersionId: paper.versionId,
      versionId: programming.versionId, requestId: randomUUID(), kind: 'submit', language: 'python', code: original.programming.definition.referenceCode } })).data;
    const oldJob = (await pool.query('SELECT payload FROM school_judge_jobs WHERE id=$1', [queued.id])).rows[0].payload;
    let current;

    await t.test('list/detail/export require current local teaching authority, never a global role in another school', async () => {
      assert.equal((await request(`${root}/manage`, { auth: auth.teacher })).data.enabled, true);
      current = (await request(manage, { auth: auth.teacher })).data;
      assert.equal(current.canEdit, true); assert.equal(current.questions.length, 6); assert.equal(current.contentHash, canonicalHash(original));
      assert.deepEqual(current.questions[0].correctOptionIds, ['D']); assert.equal(current.programming.readOnlyJudge.testCount, 6);
      assert.deepEqual(current.programming.solution, original.programming.solution);
      assert.doesNotMatch(JSON.stringify(current), /referenceCode|"tests"|account_id|identity_id|gradeId/);
      for (const name of ['historical', 'pending', 'outsider']) for (const target of [`${root}/manage`, manage, `${manage}/export?include=package`]) {
        await request(target, { auth: auth[name], status: 403 });
      }
      await request(manage, { status: 401 });
      for (const name of ['schooladmin', 'schoolteacher', 'overlay']) await request(otherManage, { auth: auth[name] });
      await request(otherManage, { auth: auth.teacher, status: 403 });
      await request(otherManage, { auth: auth.admin, status: 404 });
      await request(`${root}/manage/${other.id}`, { auth: auth.teacher, status: 404 });
      assert.match((await request(manage, { auth: auth.teacher })).cache, /private.*no-store/);
    });

    await t.test('student export excludes solutions and hidden cases; answers and explicit backup remain staff only', async () => {
      for (const language of ['en', 'zh']) for (const include of ['questions', 'answers', 'package']) {
        const result = (await request(`${manage}/export?include=${include}&language=${language}`, { auth: auth.teacher })).data;
        assert.equal(result.contentType, 'application/json'); assert.match(result.filename, /\.json$/);
        const exported = JSON.parse(Buffer.from(result.contentBase64, 'base64').toString('utf8'));
        if (include === 'package') assert.deepEqual(exported, original);
        else {
          assert.equal(exported.title, original.title[language]); assert.equal(exported.questions[0].statement, original.questions[0].statement[language]);
          assert.deepEqual(exported.programming.samples, original.programming.definition.samples);
          assert.doesNotMatch(JSON.stringify(exported), /"source"|statementAssets|solutionPages|referenceCode|"tests"|account_id|gradeId/);
          if (include === 'questions') assert.doesNotMatch(JSON.stringify(exported), /correctOptionIds|explanation|"solution"/);
          else {
            assert.deepEqual(exported.questions[0].correctOptionIds, ['D']);
            assert.equal(exported.programming.solution.code, original.programming.solution.code);
            assert.equal(exported.programming.solution.explanation, original.programming.solution.explanation[language]);
          }
        }
      }
      await request(`${manage}/export?include=student-records`, { auth: auth.teacher, status: 400 });
      for (const route of [path, `${path}/programming`]) {
        const student = (await request(route, { auth: auth.historical })).data;
        assert.ok(!JSON.stringify(student).includes(JSON.stringify(original.programming.solution.code).slice(1, -1)));
        assert.doesNotMatch(JSON.stringify(student), /"solution"|"referenceCode"/);
      }
    });

    await t.test('solution prices default to 12 and only local teaching staff may change a paper price', async () => {
      const pricePath = `${manage}/solution-price`, otherPricePath = `${otherManage}/solution-price`;
      const defaultPrice = { price: null, defaultPrice: 12, effectivePrice: 12, revision: 0 };
      for (const [target, actor] of [[pricePath, auth.teacher], [otherPricePath, auth.schoolteacher]]) {
        const result = await request(target, { auth: actor });
        assert.deepEqual(result.data, defaultPrice); assert.match(result.cache, /private.*no-store/);
      }
      await request(pricePath, { status: 401 });
      for (const name of ['historical', 'pending', 'outsider']) {
        await request(pricePath, { auth: auth[name], status: 403 });
        await request(pricePath, { auth: auth[name], method: 'PATCH', body: { price: 1, expectedRevision: 0 }, status: 403 });
      }
      await request(otherPricePath, { auth: auth.teacher, method: 'PATCH', body: { price: 1, expectedRevision: 0 }, status: 403 });
      await request(otherPricePath, { auth: auth.admin, status: 404 });
      await request(`${root}/manage/${other.id}/solution-price`, { auth: auth.teacher, status: 404 });
      await request(pricePath, { auth: auth.teacher, method: 'PATCH', csrf: false, body: { price: 18, expectedRevision: 0 }, status: 403 });
      const before = (await pool.query('SELECT * FROM acsl_papers ORDER BY id')).rows;
      const changed = (await request(pricePath, { auth: auth.teacher, method: 'PATCH', body: { price: 18, expectedRevision: 0 } })).data;
      assert.deepEqual(changed, { price: 18, defaultPrice: 12, effectivePrice: 18, revision: 1 });
      assert.deepEqual((await request(pricePath, { auth: auth.teacher, method: 'PATCH', body: { price: 18, expectedRevision: 1 } })).data, changed);
      await request(pricePath, { auth: auth.teacher, method: 'PATCH', body: { price: 18, expectedRevision: 0 }, status: 409 });
      assert.deepEqual((await request(otherPricePath, { auth: auth.schoolteacher })).data, defaultPrice);
      assert.equal((await request(otherPricePath, { auth: auth.schoolteacher, method: 'PATCH', body: { price: 9, expectedRevision: 0 } })).data.effectivePrice, 9);
      assert.equal((await request(pricePath, { auth: auth.admin })).data.effectivePrice, 18);
      assert.deepEqual((await pool.query('SELECT * FROM acsl_papers ORDER BY id')).rows, before, 'pricing must not revise questions, grades or judge versions');
      assert.equal((await pool.query("SELECT count(*)::int n FROM school_audit_events WHERE action='acsl.solution_price'")).rows[0].n, 2);
      await assert.rejects(worker.query('SELECT * FROM school_scholarship_policies'), { code: '42501' });
    });

    await t.test('price validation, free access, default reset and concurrent edits preserve the current policy', async () => {
      const pricePath = `${manage}/solution-price`;
      for (const price of [-1, 1001, 1.5, '12', false, {}, []]) {
        await request(pricePath, { auth: auth.teacher, method: 'PATCH', body: { price, expectedRevision: 1 }, status: 400 });
      }
      for (const body of [{ expectedRevision: 1 }, { price: 12 }, { price: 12, expectedRevision: '1' },
        { price: 12, expectedRevision: 1, mode: 'disabled' }]) {
        await request(pricePath, { auth: auth.teacher, method: 'PATCH', body, status: 400 });
      }
      assert.equal((await request(pricePath, { auth: auth.teacher })).data.revision, 1);
      assert.deepEqual((await request(pricePath, { auth: auth.teacher, method: 'PATCH', body: { price: 0, expectedRevision: 1 } })).data,
        { price: 0, defaultPrice: 12, effectivePrice: 0, revision: 2 });
      assert.deepEqual((await request(pricePath, { auth: auth.admin, method: 'PATCH', body: { price: null, expectedRevision: 2 } })).data,
        { price: null, defaultPrice: 12, effectivePrice: 12, revision: 3 });
      const results = await Promise.all([
        request(pricePath, { auth: auth.teacher, method: 'PATCH', body: { price: 7, expectedRevision: 3 }, status: [200, 409] }),
        request(pricePath, { auth: auth.admin, method: 'PATCH', body: { price: 22, expectedRevision: 3 }, status: [200, 409] }),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
      const saved = (await request(pricePath, { auth: auth.teacher })).data;
      assert.deepEqual(saved, results.find(result => result.status === 200).data); assert.equal(saved.revision, 4);
      assert.equal((await pool.query("SELECT count(*)::int n FROM school_audit_events WHERE action='acsl.solution_price' AND school_id=$1", [LEGACY_SCHOOL_ID])).rows[0].n, 4);
    });

    await t.test('unknown fields, structural edits, invalid answer sets and judge data are rejected before any write', async () => {
      const edit = { expectedContentHash: current.contentHash, requestId: randomUUID(), reason: 'Reviewed teaching correction' };
      for (const patch of [ { questions: [{ id: 'q1', type: 'multiple' }] }, { questions: [{ id: 'new', statement: { en: 'X', zh: 'X' } }] },
        { questions: [{ id: 'q1', options: [{ id: 'Z', text: { en: 'X', zh: 'X' } }] }] }, { questions: [{ id: 'q1', correctOptionIds: [] }] },
        { questions: [{ id: 'q1', correctOptionIds: ['A','B'] }] }, { questions: [{ id: 'q1', correctOptionIds: ['Z'] }] },
        { programming: { tests: [] } }, { programming: { samples: [] } }, { enabled: false }, { questions: [{ id: 'q1', statementDiagrams: { en: [{ svg: '<svg/>' }], zh: [] } }] } ]) {
        await request(manage, { auth: auth.teacher, method: 'PATCH', body: { ...edit, ...patch }, status: 400 });
      }
      for (const reason of [null, 1, 'x'.repeat(2001)]) {
        await request(manage, { auth: auth.teacher, method: 'PATCH', body: { ...edit, reason }, status: 400 });
      }
      await request(manage, { auth: auth.teacher, method: 'PATCH', csrf: false, body: edit, status: 403 });
      await request(manage, { auth: auth.pending, method: 'PATCH', body: edit, status: 403 });
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_management_updates')).rows[0].n, 0);
    });

    await t.test('correct-key edit without a reason freezes old grades, requires review of old drafts, and is idempotent', async () => {
      const edit = { expectedContentHash: current.contentHash, requestId: randomUUID(),
        title: { en: 'Reviewed ACSL practice', zh: '已审核的 ACSL 练习' },
        questions: [{ id: 'q1', topic: { en: 'Reviewed Boolean algebra', zh: '布尔代数复核' }, correctOptionIds: ['A'], explanation: { en: 'New reviewed explanation.', zh: '修订后的完整解析。' } }],
        programming: { title: 'Reviewed programming title', statement: 'Reviewed English statement.', statementZh: '已审核的中文题面。' } };
      const results = await Promise.all([request(manage, { auth: auth.teacher, method: 'PATCH', body: edit }), request(manage, { auth: auth.teacher, method: 'PATCH', body: edit })]);
      assert.deepEqual(results[0].data, results[1].data); current = results[0].data;
      assert.equal(current.versionId, paper.versionId); assert.notEqual(current.writtenRevision, paper.versionId); assert.deepEqual(current.changedQuestionIds, ['q1']);
      assert.deepEqual((await pool.query('SELECT request_id,reason FROM acsl_management_updates')).rows, [{ request_id: edit.requestId, reason: '' }]);
      await request(manage, { auth: auth.teacher, method: 'PATCH', body: { ...edit, reason: 'Reused with different input' }, status: 409 });
      const historical = (await request(path, { auth: auth.historical })).data;
      assert.deepEqual(historical.questions, oldGrade.questions); assert.equal(historical.gradeId, oldGrade.gradeId); assert.equal(historical.score, 6); assert.equal(historical.writtenPointsAwarded, 6);
      assert.deepEqual((await request(`${path}/questions/q1/explanation?versionId=${paper.versionId}`, { auth: auth.historical })).data.correctOptionIds, ['D']);
      const pending = (await request(path, { auth: auth.pending })).data;
      assert.equal(pending.questions[0].requiresReview, true); assert.deepEqual(pending.questions[0].draft.selectedOptionIds, ['D']);
      assert.doesNotMatch(JSON.stringify(pending), /correctOptionIds|explanation/);
      await request(`${path}/submit`, { auth: auth.pending, method: 'POST', body: { ...submitBody, writtenRevision: current.writtenRevision }, status: 409 });
      await request(`${path}/questions/q1/draft`, { auth: auth.pending, method: 'PATCH', body: { versionId: paper.versionId, writtenRevision: current.writtenRevision, expectedRevision: 1, selectedOptionIds: ['D'] } });
      const newGrade = (await request(`${path}/submit`, { auth: auth.pending, method: 'POST', body: { ...submitBody, writtenRevision: current.writtenRevision, revisions: { ...submitBody.revisions, q1: 2 } } })).data;
      assert.equal(newGrade.score, 5); assert.equal(newGrade.writtenPointsAwarded, 5); assert.equal(newGrade.questions[0].lastSubmission.correct, false);
      assert.deepEqual((await request(`${path}/questions/q1/explanation?versionId=${paper.versionId}`, { auth: auth.pending })).data.correctOptionIds, ['A']);
      assert.deepEqual((await pool.query('SELECT payload FROM school_judge_jobs WHERE id=$1', [queued.id])).rows[0].payload, oldJob);
      const program = (await request(`${path}/programming`, { auth: auth.historical })).data;
      assert.equal(program.title, 'Reviewed programming title'); assert.equal(program.versionId, programming.versionId); assert.deepEqual(program.samples, programming.samples);
    });

    await t.test('explanation-only edits accept a blank reason and preserve completed snapshots under concurrent saves', async () => {
      const draft = { expectedContentHash: current.contentHash, reason: ' \t\n ', questions: [{ id: 'q2', explanation: { en: 'Teacher explanation A.', zh: '教师解析甲。' } }] };
      const editIds = [randomUUID(), randomUUID()];
      const results = await Promise.all([
        request(manage, { auth: auth.teacher, method: 'PATCH', body: { ...draft, requestId: editIds[0] }, status: [200,409] }),
        request(manage, { auth: auth.admin, method: 'PATCH', body: { ...draft, requestId: editIds[1], questions: [{ id: 'q2', explanation: { en: 'Teacher explanation B.', zh: '教师解析乙。' } }] }, status: [200,409] }),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(), [200,409]); current = results.find(result => result.status === 200).data;
      assert.deepEqual(current.changedQuestionIds, []);
      const savedId = editIds[results.findIndex(result => result.status === 200)];
      assert.equal((await pool.query('SELECT reason FROM acsl_management_updates WHERE request_id=$1', [savedId])).rows[0].reason, '');
      assert.deepEqual((await request(`${path}/questions/q2/explanation?versionId=${paper.versionId}`, { auth: auth.pending })).data.explanation, original.questions[1].explanation);
      const before = (await request(otherManage, { auth: auth.schoolteacher })).data;
      const localEdit = { expectedContentHash: before.contentHash, requestId: randomUUID(), reason: '  Local school teacher edit  ', questions: [{ id: 'q1', correctOptionIds: ['A'] }] };
      const changed = (await request(otherManage, { auth: auth.schoolteacher, method: 'PATCH', body: localEdit })).data;
      assert.equal(changed.questions[0].correctOptionIds[0], 'A');
      assert.equal((await pool.query('SELECT reason FROM acsl_management_updates WHERE request_id=$1', [localEdit.requestId])).rows[0].reason, 'Local school teacher edit');
      await pool.query('UPDATE school_memberships SET revoked_at=clock_timestamp() WHERE school_id=$1 AND account_id=$2', [school.id, users.schoolteacher.id]);
      await request(otherManage, { auth: auth.schoolteacher, status: 404 });
      await request(`${otherManage}/export?include=package`, { auth: auth.schoolteacher, status: 404 });
      await request(`${otherManage}/solution-price`, { auth: auth.schoolteacher, status: 404 });
      await request(`${otherManage}/solution-price`, { auth: auth.schoolteacher, method: 'PATCH', body: { price: 2, expectedRevision: 1 }, status: 404 });
    });

    await t.test('the definer enforces roles and immutable judge/structure constraints even for direct runtime calls', async () => {
      const invoke = (actor, content, overrides = {}) => app.query('SELECT acsl_edit_paper($1,$2,$3,$4,$5)', [LEGACY_SCHOOL_ID, paper.id, actor,
        JSON.stringify({ expectedContentHash: current.contentHash, requestId: randomUUID(), reason: 'Direct entry validation', ...overrides }), JSON.stringify(content)]);
      const full = (await pool.query('SELECT definition FROM acsl_papers WHERE id=$1', [paper.id])).rows[0].definition;
      await assert.rejects(invoke(users.pending.id, full), { code: '42501' });
      for (const reason of [null, 1, 'x'.repeat(2001)]) {
        await assert.rejects(invoke(users.teacher.id, full, { reason }), /ACSL_INVALID_EDIT/);
      }
      for (const mutate of [ value => { value.questions.reverse(); }, value => { value.questions[0].type = 'multiple'; },
        value => { value.questions[0].options[0].id = 'Z'; }, value => { value.questions[0].correctOptionIds = ['A','D']; },
        value => { value.programming.definition.tests[0].expected += 'bad'; }, value => { value.programming.definition.timeLimitMs += 100; },
        value => { value.programming.definition.samples[0].input += 'bad'; }, value => { value.programming.definition.referenceCode += 'bad'; },
        value => { value.questions[0].statementDiagrams = { en: [{ id: 'unsafe', width: 30, height: 30, alt: { en: 'Bad', zh: '错误' }, elements: [{ type: 'path', d: 'M0 0', onload: 'alert(1)' }] }], zh: [] }; },
        value => { value.questions[0].options[0].diagrams = { en: [{ id: 'unsafe', width: 30, height: 30, alt: { en: 'Bad', zh: '错误' }, elements: [{ type: 'path', d: 'M0 0 L999999 0' }] }], zh: [] }; },
        value => { value.programming.statementDiagrams = { en: [{ id: 'unsafe', width: 30, height: 30, alt: { en: 'Bad', zh: '错误' }, elements: [{ type: 'foreignObject', text: '<script/>' }] }], zh: [] }; } ]) {
        const changed = structuredClone(full); mutate(changed); await assert.rejects(invoke(users.teacher.id, changed), /ACSL_INVALID_EDIT/);
      }
      await assert.rejects(worker.query('SELECT acsl_edit_paper($1,$2,$3,$4,$5)', [LEGACY_SCHOOL_ID,paper.id,users.teacher.id,'{}','{}']), { code: '42501' });
      for (const table of ['acsl_papers', 'acsl_grade_question_snapshots', 'acsl_submission_question_snapshots', 'acsl_management_updates']) {
        await assert.rejects(app.query(`UPDATE ${table} SET school_id=school_id`), { code: '42501' });
      }
      await assert.rejects(app.query('SELECT * FROM acsl_management_updates'), { code: '42501' });
      await assert.rejects(pool.query('DELETE FROM acsl_management_updates'));
      const audit = (await pool.query('SELECT before_grading_hash,after_grading_hash FROM acsl_management_updates WHERE paper_id=$1 ORDER BY created_at', [paper.id])).rows;
      assert.notEqual(audit[0].before_grading_hash, audit[0].after_grading_hash); assert.equal(audit[1].before_grading_hash, audit[1].after_grading_hash);
    });

    await t.test('queued programming still uses the original isolated judge snapshot after staff edits', { skip: !process.env.GO_JUDGE_TEST_URL }, async () => {
      const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: process.env.JUDGE_ENVIRONMENT_VERSION ?? 'acsl-management' });
      await judge.ready(); await processSchoolOne({ pool: worker, judge });
      const result = (await request(`${path}/programming/submissions/${queued.id}`, { auth: auth.historical })).data;
      assert.equal(result.status, 'AC'); assert.equal(result.passed, 6); assert.equal(result.practicePointsAwarded, 10);
      const replay = (await request(`${path}/submit`, { auth: auth.historical, method: 'POST', body: submitBody })).data;
      assert.equal(replay.gradeId, oldGrade.gradeId); assert.equal(replay.writtenPointsAwarded, 6);
      assert.equal((await pool.query('SELECT sum(points)::int total FROM acsl_point_awards')).rows[0].total, 21);
    });

    await t.test('teacher answer-key edits racing student saves or turn-ins preserve the version each student saw', async () => {
      for (const action of ['save', 'submit']) {
        const source = structuredClone(original); source.slug = `acsl-management-race-${action}`;
        const edition = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.admin.id, content: source });
        const studentPath = `${root}/${edition.id}`, teacherPath = `${root}/manage/${edition.id}`;
        if (action === 'submit') for (const question of source.questions) {
          await request(`${studentPath}/questions/${question.id}/draft`, { auth: auth.fresh, method: 'PATCH', body: {
            versionId: edition.versionId, writtenRevision: edition.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds,
          } });
        }
        const [studentResult, teacherResult] = await Promise.all([
          request(action === 'save' ? `${studentPath}/questions/q1/draft` : `${studentPath}/submit`, {
            auth: auth.fresh, method: action === 'save' ? 'PATCH' : 'POST', status: [200, 409], body: action === 'save'
              ? { versionId: edition.versionId, writtenRevision: edition.versionId, expectedRevision: 0, selectedOptionIds: ['D'] }
              : { versionId: edition.versionId, writtenRevision: edition.versionId,
                revisions: Object.fromEntries(source.questions.map(question => [question.id, 1])) },
          }),
          request(teacherPath, { auth: auth.teacher, method: 'PATCH', body: {
            expectedContentHash: canonicalHash(source), requestId: randomUUID(), reason: 'Reviewed answer correction during student work',
            questions: [{ id: 'q1', correctOptionIds: ['A'] }],
          } }),
        ]);
        assert.equal(teacherResult.data.versionId, edition.versionId);
        assert.notEqual(teacherResult.data.writtenRevision, edition.versionId);
        assert.deepEqual(teacherResult.data.questions[0].correctOptionIds, ['A']);
        if (studentResult.status === 409) assert.equal(studentResult.data.error.code, 'WRITTEN_REVISION_CONFLICT');
        const detail = (await request(studentPath, { auth: auth.fresh })).data;
        if (action === 'submit' && studentResult.status === 200) {
          assert.equal(detail.graded, true); assert.equal(detail.historicalWrittenVersion, true);
          assert.equal(detail.gradeId, studentResult.data.gradeId); assert.equal(detail.score, 6);
          assert.deepEqual(detail.questions[0].lastSubmission.selectedOptionIds, ['D']);
          assert.equal(detail.questions[0].lastSubmission.correct, true);
          const explanation = (await request(`${studentPath}/questions/q1/explanation?versionId=${edition.versionId}`, { auth: auth.fresh })).data;
          assert.deepEqual(explanation.correctOptionIds, ['D']); assert.deepEqual(explanation.explanation, source.questions[0].explanation);
          const snapshot = (await pool.query('SELECT written_revision,questions FROM acsl_grade_question_snapshots WHERE grade_id=$1', [detail.gradeId])).rows[0];
          assert.equal(snapshot.written_revision, edition.versionId); assert.deepEqual(snapshot.questions, source.questions);
        } else {
          assert.equal(detail.graded, false);
          const saved = action === 'submit' || studentResult.status === 200;
          assert.equal(detail.questions[0].requiresReview, saved);
          assert.equal(detail.questions[0].draft.revision, saved ? 1 : 0);
          assert.deepEqual(detail.questions[0].draft.selectedOptionIds, saved ? ['D'] : []);
          assert.doesNotMatch(JSON.stringify(detail), /correctOptionIds|explanation/);
          await request(`${studentPath}/questions/q1/explanation?versionId=${edition.versionId}`, { auth: auth.fresh, status: 403 });
        }
        const historical = (await request(path, { auth: auth.historical })).data;
        assert.equal(historical.gradeId, oldGrade.gradeId); assert.equal(historical.score, 6); assert.equal(historical.writtenPointsAwarded, 6);
      }
    });
  } finally {
    await server?.close(); await app?.end(); await worker?.end(); await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
