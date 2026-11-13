import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

test('ACSL real Nest lifecycle protects answers, histories, drafts, school scope and isolated programming', { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const manager = createPool(base.href), schema = `acsl_http_${randomBytes(5).toString('hex')}`;
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href);
  let server, worker, app;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url'), hash = await hashPassword(password), users = {};
    for (const name of ['admin','student','outsider','legacy','legacy-history','legacy-pending','legacy-zero','legacy-coding-only']) {
      const identity = randomUUID();
      await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,$3,$2,$2)", [identity,name,name.startsWith('legacy') ? 'student' : 'personal']);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity,name,hash])).rows[0];
      users[name].identity = identity;
    }
    const school = await provisionSchool(pool, { slug: 'acsl-school', name: 'ACSL school', adminUsername: 'admin' });
    await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')", [school.id,users.student.id]);
    const schoolStudentIdentity = (await pool.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student','learner','Learner',$2) RETURNING id", [school.id,users.student.id])).rows[0];
    for (const [name, actor] of Object.entries(users)) {
      if (!name.startsWith('legacy')) continue;
      await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [actor.id]);
      await pool.query('INSERT INTO legacy_school_identity_ownership(identity_id) VALUES($1) ON CONFLICT DO NOTHING', [actor.identity]);
      await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [actor.id]);
    }
    const content = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    const paper = await importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.admin.id, content });
    assert.equal((await importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.admin.id, content })).imported, false);
    await assert.rejects(importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.admin.id, content: { ...content, title: { en: 'changed', zh: '变化' } } }));
    const legacyPaper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.admin.id, content });
    const asRole = role => { const url = new URL(scoped); url.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return url.href; };
    app = createPool(asRole('campus_app')); worker = createPool(asRole('campus_worker'));
    const origin = 'http://acsl.test';
    server = await createApiApplication({ databaseUrl: asRole('campus_app'), logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const host = await server.getUrl();
    const request = async (path, { auth, method = 'GET', body, status = 200, csrf = true } = {}) => {
      const response = await fetch(`${host}/api/v1${path}`, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, ...(csrf ? { 'X-CSRF-Token': auth.csrfToken } : {}) } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path}: status ${response.status} ${JSON.stringify(data.error ?? {})}`);
      return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
    };
    const auth = {};
    for (const name of Object.keys(users)) { const login = await request('/auth/login', { method: 'POST', body: { username: name, password } }); auth[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
    const root = `/schools/${school.id}/acsl`, path = `${root}/${paper.id}`, question = `${path}/questions/q1`;
    await t.test('authorization, opt-in and safe student projections', async () => {
      await request(root, { status: 401 });
      await request(root, { auth: auth.outsider, status: 404 });
      await request(`${root}?view=availability`, { status: 401 });
      await request(`${root}?view=availability`, { auth: auth.outsider, status: 404 });
      const availability = await request(`${root}?view=availability`, { auth: auth.student });
      assert.deepEqual(availability.data, { enabled: true });
      assert.match(availability.headers.get('cache-control'), /no-store/);
      await request(`${root}/manage?view=availability`, { auth: auth.student, status: 403 });
      assert.deepEqual((await request(`${root}/manage?view=availability`, { auth: auth.admin })).data, { enabled: true });
      await request(`/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`, { auth: auth.student, status: 404 });
      assert.equal((await request(`/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`, { auth: auth.legacy })).data.questions.length, 6);
      const catalog = await request(root, { auth: auth.student }); assert.equal(catalog.data.enabled, true);
      const detail = await request(path, { auth: auth.student }); assert.equal(detail.data.questions.length, 6);
      assert.match(detail.headers.get('cache-control'), /no-store/);
      const text = JSON.stringify(detail.data);
      for (const privateField of ['correctOptionIds','explanation','referenceCode','"tests"']) assert.ok(!text.includes(privateField), privateField);
      await request(`${question}/explanation?versionId=${paper.versionId}`, { auth: auth.student, status: 403 });
      assert.deepEqual((await request(`/schools/${school.id}/problems`, { auth: auth.student })).data.items, []);
      const privateProblem = (await pool.query('SELECT p.id,p.bank_id FROM school_problems p JOIN acsl_papers a ON a.school_id=p.school_id AND a.programming_problem_id=p.id WHERE a.id=$1', [paper.id])).rows[0];
      assert.deepEqual((await request(`/schools/${school.id}/problems`, { auth: auth.admin })).data.items, []);
      assert.deepEqual((await request(`/schools/${school.id}/problem-banks`, { auth: auth.admin })).data.items, []);
      await request(`/schools/${school.id}/problem-banks/${privateProblem.bank_id}`, { auth: auth.admin, method: 'PATCH', body: { expectedRevision: 1, archived: false }, status: 404 });
      await request(`/schools/${school.id}/problems/${privateProblem.id}`, { auth: auth.admin, status: 404 });
      for (const action of ['validate','publish']) await request(`/schools/${school.id}/problems/${privateProblem.id}/${action}`, { auth: auth.admin, method: 'POST', body: { expectedRevision: 1, requestId: randomUUID() }, status: 404 });
    });
    await t.test('historical individual grades stay private and whole-paper completion is required', async () => {
      await pool.query(`INSERT INTO acsl_submissions(school_id,paper_id,version_id,account_id,question_id,selected_option_ids,correct,request_id,request_hash,draft_revision)
        VALUES($1,$2,$3,$4,'q1','["D"]',true,$5,'historical',0)`, [school.id,paper.id,paper.versionId,users.student.id,randomUUID()]);
      const before = (await request(path, { auth: auth.student })).data;
      assert.equal(before.graded, false); assert.equal(before.score, null); assert.equal(before.correctCount, null);
      assert.ok(before.questions.every(question => question.lastSubmission === null));
      await request(`${question}/explanation?versionId=${paper.versionId}`, { auth: auth.student, status: 403 });
      const retired = await request(`${question}/submissions`, { auth: auth.student, method: 'POST', body: { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: ['D'], requestId: randomUUID() }, status: 409 });
      assert.equal(retired.data.error.code, 'WHOLE_PAPER_REQUIRED');
      const emptyRevisions = Object.fromEntries(content.questions.map(question => [question.id,0]));
      const submitBody = { versionId: paper.versionId, revisions: emptyRevisions };
      await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: submitBody, csrf: false, status: 403 });
      await request(`${path}/submit`, { auth: auth.outsider, method: 'POST', body: submitBody, status: 404 });
      await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: { ...submitBody, revisions: { q1: 0 } }, status: 400 });
      const incomplete = await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: submitBody, status: 400 });
      assert.equal(incomplete.data.error.code, 'INCOMPLETE_PAPER');
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_paper_grades')).rows[0].n, 0);
      const draft = { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: ['A'] };
      await request(`${question}/draft`, { auth: auth.student, method: 'PATCH', body: draft, csrf: false, status: 403 });
      assert.equal((await request(`${question}/draft`, { auth: auth.student, method: 'PATCH', body: draft })).data.revision, 1);
      await request(`${question}/draft`, { auth: auth.student, method: 'PATCH', body: draft, status: 409 });
      await request(`${question}/draft`, { auth: auth.student, method: 'PATCH', body: { ...draft, versionId: randomUUID() }, status: 409 });
      const partial = (await request(path, { auth: auth.student })).data;
      assert.equal(partial.answeredCount, 1); assert.equal(partial.correctCount, null); assert.equal(partial.questions[0].lastSubmission, null);
      assert.deepEqual(partial.questions[0].draft.selectedOptionIds, ['A']);
      const partialCatalog = (await request(root, { auth: auth.student })).data.items[0];
      assert.equal(partialCatalog.correctCount, null); assert.equal(partialCatalog.answeredCount, 1);
      for (const [key, value] of Object.entries(partialCatalog)) assert.deepEqual(value, partial[key], key);
      await request(`${question}/explanation?versionId=${paper.versionId}`, { auth: auth.student, status: 403 });
    });
    await t.test('whole-paper turn-in grades a saved snapshot once, concurrent replays agree and drafts then lock', async () => {
      for (const item of content.questions.slice(1)) {
        await request(`${path}/questions/${item.id}/draft`, { auth: auth.student, method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: item.correctOptionIds } });
      }
      const revisions = Object.fromEntries(content.questions.map(question => [question.id,1]));
      const submit = { versionId: paper.versionId, revisions };
      await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: { ...submit, revisions: { ...revisions, q1: 0 } }, status: 409 });
      await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: { ...submit, versionId: randomUUID() }, status: 409 });
      const results = await Promise.all(Array.from({ length: 3 }, () => request(`${path}/submit`, { auth: auth.student, method: 'POST', body: submit })));
      const graded = results[0].data;
      for (const result of results) assert.deepEqual(result.data, graded);
      assert.equal(graded.graded, true); assert.equal(graded.score, 5); assert.equal(graded.maxScore, 6);
      assert.equal(graded.correctCount, 5); assert.equal(graded.questions[0].lastSubmission.correct, false);
      assert.ok(graded.questions.slice(1).every(question => question.lastSubmission.correct));
      assert.ok(graded.questions.every(question => question.lastSubmission.id === graded.gradeId));
      assert.equal(graded.programming.solved, false, 'written grade cannot solve the coding problem');
      assert.deepEqual((await request(path, { auth: auth.student })).data, graded);
      assert.deepEqual((await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: { ...submit, revisions: {} } })).data, graded, 'accepted turn-in replays its immutable snapshot');
      const locked = await request(`${question}/draft`, { auth: auth.student, method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 1, selectedOptionIds: ['D'] }, status: 409 });
      assert.equal(locked.data.error.code, 'PAPER_GRADED');
      const solution = (await request(`${question}/explanation?versionId=${paper.versionId}`, { auth: auth.student })).data;
      assert.deepEqual(solution.correctOptionIds, ['D']); assert.ok(solution.explanation.en);
      await request(`${question}/explanation?versionId=${paper.versionId}`, { auth: auth.admin, status: 403 });
      assert.equal((await request(root, { auth: auth.student })).data.items[0].correctCount, 5);
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_submissions')).rows[0].n, 1, 'historical per-question rows remain unchanged');
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_paper_grades')).rows[0].n, 1);
    });
    await t.test('multi-select snapshots and simultaneous save/turn-in serialize without losing an acknowledged edit', async () => {
      const fixture = structuredClone(content);
      fixture.slug = 'acsl-test-multiple';
      fixture.programming.tutorial = { en: 'Trace the cards one at a time.', zh: '逐张检查牌的移动。' };
      fixture.questions[0].type = 'multiple'; fixture.questions[0].correctOptionIds = ['C','D'];
      const multiple = await importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.admin.id, content: fixture });
      const multiplePath = `${root}/${multiple.id}`;
      const guided = (await request(`${multiplePath}/programming?language=zh`, { auth: auth.student })).data;
      assert.deepEqual(guided.tutorial, { source: 'custom', body: fixture.programming.tutorial.zh });
      assert.equal(guided.statement, fixture.programming.definition.statement);
      for (const item of fixture.questions) await request(`${multiplePath}/questions/${item.id}/draft`, { auth: auth.admin, method: 'PATCH', body: { versionId: multiple.versionId, expectedRevision: 0, selectedOptionIds: [...item.correctOptionIds].reverse() } });
      const revisions = Object.fromEntries(fixture.questions.map(question => [question.id,1]));
      const raced = await Promise.all([
        request(`${multiplePath}/submit`, { auth: auth.admin, method: 'POST', body: { versionId: multiple.versionId, revisions }, status: [200,409] }),
        request(`${multiplePath}/questions/q1/draft`, { auth: auth.admin, method: 'PATCH', body: { versionId: multiple.versionId, expectedRevision: 1, selectedOptionIds: ['D'] }, status: [200,409] }),
      ]);
      assert.deepEqual(raced.map(result => result.status).sort(), [200,409]);
      const fresh = (await request(multiplePath, { auth: auth.admin })).data;
      const final = fresh.graded ? fresh : (await request(`${multiplePath}/submit`, { auth: auth.admin, method: 'POST', body: { versionId: multiple.versionId, revisions: { ...revisions, q1: 2 } } })).data;
      assert.equal(final.score, raced[1].status === 200 ? 5 : 6);
      assert.equal(final.questions[0].lastSubmission.correct, raced[1].status !== 200);
      assert.deepEqual(final.questions[0].lastSubmission.selectedOptionIds, raced[1].status === 200 ? ['D'] : ['C','D']);
      assert.equal((await request(multiplePath, { auth: auth.student })).data.graded, false, 'grade is owned by the submitting account');
    });
    let programming, job;
    const referencePath = `${path}/programming?view=solution`;
    await t.test('programming reuses queue with private feedback and owner-scoped results', async () => {
      programming = (await request(`${path}/programming`, { auth: auth.student })).data;
      assert.ok(!JSON.stringify(programming).includes('referenceCode')); assert.ok(!JSON.stringify(programming).includes('"tests"'));
      assert.equal(programming.referenceAvailable, true);
      assert.equal(programming.tutorial, undefined);
      await request(referencePath, { status: 401 });
      await request(referencePath, { auth: auth.outsider, status: 404 });
      await request(referencePath, { auth: auth.student, status: 403 });
      const body = { versionId: programming.versionId, kind: 'submit', language: 'python', code: 'print(0)', requestId: randomUUID() };
      job = (await request(`${path}/programming/submissions`, { auth: auth.student, method: 'POST', body, status: 202 })).data;
      assert.equal((await request(`${path}/programming/submissions`, { auth: auth.student, method: 'POST', body, status: 202 })).data.id, job.id);
      await request(referencePath, { auth: auth.student, status: 403 });
      await processSchoolOne({ pool: worker, judge: { judge: async () => ({ status: 'WA', score: 0, passed: 0, total: 1, publicMessage: '', privateResults: [{ position: 1, status: 'WA', stdout: 'PRIVATE', expected: 'SECRET', input: 'HIDDEN' }] }) } });
      const result = (await request(`${path}/programming/submissions/${job.id}`, { auth: auth.student })).data;
      assert.equal(result.status, 'WA'); for (const secret of ['PRIVATE','SECRET','HIDDEN']) assert.ok(!JSON.stringify(result).includes(secret));
      await request(referencePath, { auth: auth.student, status: 403 });
      const resume = `${path}/programming/submissions?view=resume&versionId=${programming.versionId}`;
      assert.deepEqual((await request(resume, { auth: auth.student })).data, { submission: { code: body.code, language: body.language } });
      assert.deepEqual((await request(resume, { auth: auth.admin })).data, { submission: null });
      await request(`${path}/programming/submissions?view=resume&versionId=${randomUUID()}`, { auth: auth.student, status: 409 });
      await request(`${path}/programming/submissions/${job.id}`, { auth: auth.admin, status: 404 });
      await request(`/schools/${school.id}/judge-jobs/${job.id}`, { auth: auth.student, status: 404 });
      assert.equal((await request(`/schools/${school.id}/submissions`, { auth: auth.student })).data.items.length, 0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM school_scholarship_ledger WHERE kind<>\'initial_grant\'')).rows[0].n, 0);
    });
    await t.test('real isolated executor validates official sample and test cases', { skip: !process.env.GO_JUDGE_TEST_URL }, async () => {
      const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: process.env.JUDGE_ENVIRONMENT_VERSION ?? 'acsl-integration' });
      await judge.ready();
      for (const kind of ['samples','custom','submit']) {
        const body = { versionId: programming.versionId, kind, language: 'python', code: content.programming.definition.referenceCode,
          requestId: randomUUID(), ...(kind === 'custom' ? { input: programming.samples[0].input } : {}) };
        const queued = (await request(`${path}/programming/submissions`, { auth: auth.student, method: 'POST', body, status: 202 })).data;
        await request(referencePath, { auth: auth.student, status: 403 });
        await processSchoolOne({ pool: worker, judge });
        const result = (await request(`${path}/programming/submissions/${queued.id}`, { auth: auth.student })).data;
        assert.equal(result.status, kind === 'custom' ? 'Executed' : 'AC', JSON.stringify(result));
        if (kind !== 'custom') assert.equal(result.passed, 6);
        if (kind !== 'submit') await request(referencePath, { auth: auth.student, status: 403 });
      }
      const implementation = content.programming.solution;
      for (const language of ['en', 'zh']) {
        const reference = await request(`${referencePath}&language=${language}&paperVersionId=${paper.versionId}`, { auth: auth.student });
        assert.match(reference.headers.get('cache-control'), /no-store/);
        assert.deepEqual(reference.data, { language: 'python', code: implementation.code,
          explanation: implementation.explanation[language], complexity: implementation.complexity[language] });
      }
      const after = (await request(`${path}/programming`, { auth: auth.student })).data;
      assert.equal(after.solved, true);
      assert.equal(after.solution, undefined);
      assert.equal(after.code, undefined);
      await request(referencePath, { auth: auth.admin, status: 403 });
      await request(`${referencePath}&paperVersionId=${randomUUID()}`, { auth: auth.student, status: 409 });
    });
    await t.test('ACSL Translation uses each school wallet, confirms price, and charges only once', async () => {
      const identity = schoolStudentIdentity;
      const legacyPath = `/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`;
      for (const [target, actor, versionId, ledger, student] of [
        [path, auth.student, paper.versionId, 'school_scholarship_ledger', identity.id],
        [legacyPath, auth.legacy, legacyPaper.versionId, 'luq_ledger', users.legacy.identity],
      ]) {
        const translation = `${target}/programming/translation`;
        const post = (action, body = {}, status = 200) => request(`${translation}/${action}`,
          { auth: actor, method: 'POST', body: { paperVersionId: versionId, ...body }, status });
        const direct = (await request(`${target}/programming?language=zh`, { auth: actor })).data;
        assert.equal(direct.statement, content.programming.definition.statement);
        await post('provide', {}, 403);
        await request(`${translation}/unlock`, { auth: actor, csrf: false, method: 'POST', body: {}, status: 403 });
        const quote = (await post('quote')).data;
        assert.equal(quote.available, true);
        assert.ok(quote.price > 0 && quote.balance >= quote.price);
        assert.equal(quote.body, undefined);
        const confirmation = { requestKey: randomUUID(), confirmedContentId: quote.contentId, confirmedPrice: quote.price };
        await post('unlock', { ...confirmation, confirmedPrice: quote.price + 1 }, 409);
        await post('unlock', { ...confirmation, confirmedContentId: 'stale' }, 409);
        const purchases = await Promise.all([post('unlock', confirmation), post('unlock', confirmation), post('unlock', { ...confirmation, requestKey: randomUUID() })]);
        assert.ok(purchases.every(purchase => purchase.data.unlocked && purchase.data.balance === quote.balanceAfter));
        const translated = (await post('provide')).data;
        assert.equal(translated.body, content.programming.statementZh);
        assert.deepEqual(translated.statementDiagrams, content.programming.statementDiagrams?.zh);
        assert.equal(translated.code, undefined);
        assert.deepEqual((await post('provide')).data, translated);
        assert.equal((await post('quote')).data.price, 0);
        const entries = (await pool.query(`SELECT delta FROM ${ledger} WHERE identity_id=$1 AND kind='purchase'`, [student])).rows;
        assert.deepEqual(entries, [{ delta: -quote.price }]);
      }
      await request(`${path}/programming/translation/provide`, { auth: auth.outsider, method: 'POST', body: {}, status: 404 });
      await request(`${legacyPath}/programming/translation/provide`, { auth: auth['legacy-pending'], method: 'POST', body: {}, status: 403 });
    });
    await t.test('enabled legacy ACSL rewards post written and first-AC points once without scholarship or retroactive credit', async () => {
      const legacyPath = `/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`;
      const legacyProgramming = (await request(`${legacyPath}/programming`, { auth: auth.legacy })).data;
      const referenceCode = content.programming.definition.referenceCode;
      const realJudge = process.env.GO_JUDGE_TEST_URL
        ? new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN,
          environmentVersion: process.env.JUDGE_ENVIRONMENT_VERSION ?? 'acsl-reward-integration' }) : null;
      if (realJudge) await realJudge.ready();
      const judge = realJudge ?? { judge: async task => {
        const status = task.kind === 'custom' ? 'Executed' : task.code === referenceCode ? 'AC' : 'WA';
        return { status, score: status === 'AC' ? 100 : 0, passed: status === 'AC' ? task.tests.length : 0,
          total: task.tests.length, publicMessage: '', privateResults: [] };
      } };
      const scholarshipSnapshot = async () => ({
        legacyAccounts: (await pool.query('SELECT * FROM luq_accounts ORDER BY identity_id')).rows,
        legacyLedger: (await pool.query('SELECT * FROM luq_ledger ORDER BY id')).rows,
        schoolAccounts: (await pool.query('SELECT * FROM school_scholarship_accounts ORDER BY school_id,identity_id')).rows,
        schoolLedger: (await pool.query('SELECT * FROM school_scholarship_ledger ORDER BY school_id,id')).rows,
      });
      const scholarshipBefore = await scholarshipSnapshot();
      const awardsFor = async name => (await pool.query(`SELECT section,points,grade_id,job_id FROM acsl_point_awards
        WHERE school_id=$1 AND paper_id=$2 AND identity_id=$3 ORDER BY section`,
      [LEGACY_SCHOOL_ID,legacyPaper.id,users[name].identity])).rows;
      const saveWritten = async (name, correctCount) => {
        for (const [index, item] of content.questions.entries()) {
          const selected = index < correctCount ? item.correctOptionIds : [item.options.find(option => !item.correctOptionIds.includes(option.id)).id];
          await request(`${legacyPath}/questions/${item.id}/draft`, { auth: auth[name], method: 'PATCH',
            body: { versionId: legacyPaper.versionId, expectedRevision: 0, selectedOptionIds: selected } });
        }
        return { versionId: legacyPaper.versionId, revisions: Object.fromEntries(content.questions.map(item => [item.id,1])) };
      };
      const queueProgram = async (name, kind, code, targetPath = legacyPath, versionId = legacyProgramming.versionId) => {
        const body = { versionId, kind, language: 'python', code, requestId: randomUUID(), ...(kind === 'custom' ? { input: '' } : {}) };
        const queued = (await request(`${targetPath}/programming/submissions`, { auth: auth[name], method: 'POST', body, status: 202 })).data;
        return { ...queued, body, name, targetPath };
      };
      const finishProgram = async (queued, expectedStatus) => {
        assert.equal(await processSchoolOne({ pool: worker, judge }), true);
        const completed = (await request(`${queued.targetPath}/programming/submissions/${queued.id}`, { auth: auth[queued.name] })).data;
        assert.equal(completed.status, expectedStatus, JSON.stringify(completed));
        if (expectedStatus === 'AC') assert.equal(completed.passed, 6);
        return completed;
      };

      const oldWritten = await saveWritten('legacy-history', 6);
      const oldGrade = (await request(`${legacyPath}/submit`, { auth: auth['legacy-history'], method: 'POST', body: oldWritten })).data;
      assert.equal(oldGrade.score, 6); assert.equal(oldGrade.writtenPointsAwarded, undefined);
      const oldAccepted = await queueProgram('legacy-history', 'submit', referenceCode);
      assert.equal((await finishProgram(oldAccepted, 'AC')).practicePointsAwarded, undefined);
      const pendingBeforeEnablement = await queueProgram('legacy-pending', 'submit', referenceCode);
      assert.deepEqual(await awardsFor('legacy-history'), []);
      await pool.query(`INSERT INTO acsl_point_rules(school_id,paper_id,version_id,written_points_per_correct,programming_points)
        VALUES($1,$2,$3,1,10)`, [LEGACY_SCHOOL_ID,legacyPaper.id,legacyPaper.versionId]);
      await assert.rejects(pool.query(`INSERT INTO acsl_point_rules(school_id,paper_id,version_id,written_points_per_correct,programming_points)
        VALUES($1,$2,$3,1,10)`, [school.id,paper.id,paper.versionId]), { code: '23514' });

      const replayOld = (await request(`${legacyPath}/submit`, { auth: auth['legacy-history'], method: 'POST', body: oldWritten })).data;
      assert.equal(replayOld.gradeId, oldGrade.gradeId); assert.equal(replayOld.writtenPointsAwarded, undefined);
      assert.equal(replayOld.programmingSolved, true); assert.equal(replayOld.programmingPointsAwarded, undefined,
        'a historical formal AC does not imply that points were awarded');
      assert.equal((await finishProgram(pendingBeforeEnablement, 'AC')).practicePointsAwarded, undefined,
        'a job queued before enablement cannot acquire a reward at completion');
      assert.equal((await finishProgram(await queueProgram('legacy-history', 'submit', referenceCode), 'AC')).practicePointsAwarded, undefined,
        'historical formal AC consumes first-AC eligibility without granting retroactive points');
      assert.deepEqual(await awardsFor('legacy-history'), []);
      assert.deepEqual(await awardsFor('legacy-pending'), []);

      const written = await saveWritten('legacy', 5);
      const turnIns = await Promise.all(Array.from({ length: 3 }, () => request(`${legacyPath}/submit`, { auth: auth.legacy, method: 'POST', body: written })));
      const grade = turnIns[0].data;
      for (const result of turnIns) assert.deepEqual(result.data, grade);
      assert.equal(grade.score, 5); assert.equal(grade.writtenPointsAwarded, 5);
      assert.equal(grade.programmingPointsAwarded, undefined); assert.equal(grade.programmingSolved, false);
      assert.deepEqual(await awardsFor('legacy'), [{ section: 'written', points: 5, grade_id: grade.gradeId, job_id: null }]);
      assert.equal((await request('/points/me', { auth: auth.legacy })).data.points, 5);
      const replay = (await request(`${legacyPath}/submit`, { auth: auth.legacy, method: 'POST', body: written })).data;
      assert.equal(replay.writtenPointsAwarded, 5); assert.equal((await awardsFor('legacy')).length, 1);
      const zero = (await request(`${legacyPath}/submit`, { auth: auth['legacy-zero'], method: 'POST', body: await saveWritten('legacy-zero', 0) })).data;
      assert.equal(zero.score, 0); assert.equal(zero.writtenPointsAwarded, undefined);
      assert.deepEqual(await awardsFor('legacy-zero'), [{ section: 'written', points: 0, grade_id: zero.gradeId, job_id: null }]);

      assert.equal((await finishProgram(await queueProgram('legacy', 'samples', referenceCode), 'AC')).practicePointsAwarded, undefined);
      assert.equal((await finishProgram(await queueProgram('legacy', 'custom', 'print(1)'), 'Executed')).practicePointsAwarded, undefined);
      await request(`${legacyPath}/programming?view=solution`, { auth: auth.legacy, status: 403 });
      assert.equal((await finishProgram(await queueProgram('legacy', 'submit', 'print(0)'), 'WA')).practicePointsAwarded, undefined);
      await request(`${legacyPath}/programming?view=solution`, { auth: auth.legacy, status: 403 });
      const beforeFormalAC = (await request(legacyPath, { auth: auth.legacy })).data;
      assert.equal(beforeFormalAC.programmingSolved, false); assert.equal(beforeFormalAC.programmingPointsAwarded, undefined);
      assert.equal((await awardsFor('legacy')).length, 1, 'sample, custom and incorrect formal runs cannot earn coding points');
      const accepted = await queueProgram('legacy', 'submit', referenceCode);
      await request(`${legacyPath}/programming?view=solution`, { auth: auth.legacy, status: 403 });
      const repeatEnqueues = await Promise.all(Array.from({ length: 2 }, () => request(`${legacyPath}/programming/submissions`,
        { auth: auth.legacy, method: 'POST', body: accepted.body, status: 202 })));
      assert.ok(repeatEnqueues.every(result => result.data.id === accepted.id));
      const result = await finishProgram(accepted, 'AC');
      assert.equal(result.practicePointsAwarded, 10);
      assert.equal((await request(`${legacyPath}/programming?view=solution`, { auth: auth.legacy })).data.code, content.programming.solution.code);
      await request(`${legacyPath}/programming?view=solution`, { auth: auth['legacy-zero'], status: 403 });
      const rewardedDetail = (await request(legacyPath, { auth: auth.legacy })).data;
      const rewardedCatalog = (await request(`/schools/${LEGACY_SCHOOL_ID}/acsl`, { auth: auth.legacy })).data.items.find(item => item.id === legacyPaper.id);
      const rewardedReplay = (await request(`${legacyPath}/submit`, { auth: auth.legacy, method: 'POST', body: written })).data;
      for (const summary of [rewardedDetail, rewardedCatalog, rewardedReplay]) {
        assert.equal(summary.programmingPointsAwarded, 10); assert.equal(summary.writtenPointsAwarded, 5);
        assert.equal(summary.programmingSolved, true); assert.equal(summary.graded, true); assert.equal(summary.gradeId, grade.gradeId);
      }
      assert.equal((await request(legacyPath, { auth: auth['legacy-zero'] })).data.programmingPointsAwarded, undefined,
        'another account and identity cannot see the awarded points');
      await worker.query('UPDATE school_judge_jobs SET result=result WHERE school_id=$1 AND id=$2', [LEGACY_SCHOOL_ID,accepted.id]);
      assert.equal((await request(`${legacyPath}/programming/submissions/${accepted.id}`, { auth: auth.legacy })).data.practicePointsAwarded, 10);
      const subsequent = await queueProgram('legacy', 'submit', referenceCode);
      assert.equal((await finishProgram(subsequent, 'AC')).practicePointsAwarded, undefined);
      assert.deepEqual(await awardsFor('legacy'), [
        { section: 'programming', points: 10, grade_id: null, job_id: accepted.id },
        { section: 'written', points: 5, grade_id: grade.gradeId, job_id: null },
      ]);
      const points = (await request('/points/me', { auth: auth.legacy })).data;
      assert.equal(points.points, 15); assert.equal(points.rankPoints, 15);
      const leaderboard = (await request('/points/leaderboard?period=all', { auth: auth.legacy })).data;
      assert.equal(leaderboard.me.id, users.legacy.identity); assert.equal(leaderboard.me.points, 15);
      assert.equal(leaderboard.items.find(item => item.id === users.legacy.identity).points, 15);
      assert.equal((await request('/points/me', { auth: auth['legacy-history'] })).data.points, 0);
      assert.equal((await request(path, { auth: auth.student })).data.writtenPointsAwarded, undefined);
      const otherSchoolJob = await queueProgram('student', 'submit', referenceCode, path, programming.versionId);
      assert.equal((await finishProgram(otherSchoolJob, 'AC')).practicePointsAwarded, undefined);
      const otherSummary = (await request(path, { auth: auth.student })).data;
      assert.equal(otherSummary.programmingSolved, true); assert.equal(otherSummary.programmingPointsAwarded, undefined);
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_point_awards WHERE school_id=$1', [school.id])).rows[0].n, 0);

      const codingOnly = await queueProgram('legacy-coding-only', 'submit', referenceCode);
      assert.equal((await finishProgram(codingOnly, 'AC')).practicePointsAwarded, 10);
      const ungraded = (await request(legacyPath, { auth: auth['legacy-coding-only'] })).data;
      assert.equal(ungraded.programmingPointsAwarded, 10); assert.equal(ungraded.programmingSolved, true);
      assert.equal((await request(`${legacyPath}/programming?view=solution`, { auth: auth['legacy-coding-only'] })).data.code, content.programming.solution.code);
      assert.equal(ungraded.graded, false); assert.equal(ungraded.score, null); assert.equal(ungraded.writtenPointsAwarded, undefined);
      assert.ok(ungraded.questions.every(question => question.lastSubmission === null));
      assert.doesNotMatch(JSON.stringify(ungraded), /correctOptionIds|explanationDiagrams|"explanation"/);
      await request(`${legacyPath}/questions/q1/explanation?versionId=${legacyPaper.versionId}`, { auth: auth['legacy-coding-only'], status: 403 });
      await pool.query('UPDATE acsl_point_rules SET programming_points=25 WHERE school_id=$1 AND paper_id=$2', [LEGACY_SCHOOL_ID, legacyPaper.id]);
      assert.equal((await request(legacyPath, { auth: auth['legacy-coding-only'] })).data.programmingPointsAwarded, 10,
        'the displayed award is the ledger amount, not the current configured reward');
      const awardedBeforeReplacement = (await pool.query('SELECT to_jsonb(a) row FROM acsl_point_awards a ORDER BY id')).rows;
      await pool.query('UPDATE accounts SET binding_released_at=clock_timestamp() WHERE id=$1', [users['legacy-coding-only'].id]);
      const replacement = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
        [users['legacy-coding-only'].identity, 'legacy-coding-replacement', hash])).rows[0];
      await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [replacement.id]);
      const replacementLogin = await request('/auth/login', { method: 'POST', body: { username: 'legacy-coding-replacement', password } });
      const replacementAuth = { cookie: replacementLogin.cookie, csrfToken: replacementLogin.data.csrfToken };
      const replacementDetail = (await request(legacyPath, { auth: replacementAuth })).data;
      assert.equal(replacementDetail.programmingPointsAwarded, 10, 'the same stable student identity retains its actual existing award');
      assert.equal(replacementDetail.programmingSolved, false, 'the replacement account has no own formal AC');
      assert.equal(replacementDetail.graded, false); assert.equal(replacementDetail.writtenPointsAwarded, undefined);
      const replacementCatalog = (await request(`/schools/${LEGACY_SCHOOL_ID}/acsl`, { auth: replacementAuth })).data.items.find(item => item.id === legacyPaper.id);
      for (const [key, value] of Object.entries(replacementCatalog)) assert.deepEqual(value, replacementDetail[key], key);
      await request(`${legacyPath}/programming?view=solution`, { auth: replacementAuth, status: 403 });
      await request(`${legacyPath}/questions/q1/explanation?versionId=${legacyPaper.versionId}`, { auth: replacementAuth, status: 403 });
      await request(legacyPath, { auth: auth['legacy-coding-only'], status: 401 });
      assert.deepEqual((await pool.query('SELECT to_jsonb(a) row FROM acsl_point_awards a ORDER BY id')).rows, awardedBeforeReplacement,
        'refresh and account replacement do not rewrite or duplicate past awards');
      assert.deepEqual(await scholarshipSnapshot(), scholarshipBefore, 'ACSL awards change points only, preserving every scholarship balance and ledger row');
    });
    for (const [scope, schoolId, actor, identityId] of [
      ['school', school.id, auth.student, (await pool.query('SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2', [school.id,users.student.id])).rows[0].id],
      ['legacy', LEGACY_SCHOOL_ID, auth['legacy-zero'], users['legacy-zero'].identity],
    ]) await t.test(`${scope} ACSL solutions can be purchased before submitting with configurable prices and actual translation credit`, async () => {
      const ledger = scope === 'legacy' ? 'luq_ledger' : 'school_scholarship_ledger';
      const entitlements = scope === 'legacy' ? 'luq_assistance_entitlements' : 'school_scholarship_entitlements';
      const creditColumn = scope === 'legacy' ? 'translation_credit_ledger_id' : 'credit_ledger_id';
      const settings = scope === 'legacy' ? 'luq_settings' : 'school_scholarship_settings';
      const where = scope === 'legacy' ? 'singleton' : 'school_id=$1';
      const params = scope === 'legacy' ? [] : [schoolId];
      const originalTranslationPrice = (await pool.query(`SELECT translation_price FROM ${settings} WHERE ${where}`, params)).rows[0].translation_price;
      const translationPrice = amount => pool.query(`UPDATE ${settings} SET translation_price=${amount}${scope === 'legacy' ? ',rule_version=rule_version+1' : ''} WHERE ${where}`, params);
      const makePaper = async suffix => {
        const fixture = structuredClone(content); fixture.slug = `acsl-payment-${scope}-${suffix}`;
        const imported = await importAcslPaper(pool, { schoolId, ownerAccountId: users.admin.id, content: fixture });
        const target = `/schools/${schoolId}/acsl/${imported.id}`;
        const post = (kind, action, body = {}, status = 200) => request(`${target}/programming/${kind}/${action}`,
          { auth: actor, method: 'POST', body: { paperVersionId: imported.versionId, contentLanguage: 'zh', ...body }, status });
        const setPrice = async price => {
          if (scope === 'school') {
            const endpoint = `/schools/${schoolId}/acsl/manage/${imported.id}/solution-price`;
            const current = (await request(endpoint, { auth: auth.admin })).data;
            return request(endpoint, { auth: auth.admin, method: 'PATCH', body: { price, expectedRevision: current.revision } });
          }
          return pool.query(`INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode,price)
            VALUES($1,'subject',$2,'FULL_SOLUTION','paid',$3) ON CONFLICT(school_id,target_type,target_key,kind)
            DO UPDATE SET price=EXCLUDED.price,revision=school_scholarship_policies.revision+1`, [schoolId,`acsl:${imported.id}`,price]);
        };
        const purchase = async (kind, quote, requestKey = randomUUID(), status = 200) => post(kind, 'unlock',
          { requestKey, confirmedContentId: quote.contentId, confirmedPrice: quote.price }, status);
        const entries = () => pool.query(`SELECT * FROM ${ledger} WHERE identity_id=$1 AND kind='purchase' AND metadata->>'subjectKey'=$2 ORDER BY created_at`,
          [identityId, `acsl:${imported.id}`]);
        return { ...imported, target, post, setPrice, purchase, entries };
      };
      try {
        await translationPrice(3);
        const direct = await makePaper('direct');
        const initial = (await direct.post('solution', 'quote')).data;
        assert.equal(initial.available, true); assert.equal(initial.basePrice, 12); assert.equal(initial.price, 12);
        assert.equal(initial.translationCredit, 0); assert.equal(initial.body, undefined); assert.equal(initial.solution, undefined);
        assert.equal((await request(`${direct.target}/programming`, { auth: actor })).data.attempts, 0);
        await direct.post('solution', 'provide', {}, 403);
        await request(`${direct.target}/programming?view=solution`, { auth: actor, status: 403 });
        await request(`${direct.target}/programming/solution/unlock`, { auth: actor, method: 'POST', body: {}, csrf: false, status: 403 });
        await request(`${direct.target}/programming/solution/provide`, { auth: auth.outsider, method: 'POST', body: {}, status: 404 });
        const key = randomUUID();
        const bought = await Promise.all([direct.purchase('solution', initial, key), direct.purchase('solution', initial, key), direct.purchase('solution', initial)]);
        assert.ok(bought.every(item => item.data.unlocked && item.data.balance === initial.balanceAfter));
        assert.deepEqual((await direct.entries()).rows.map(row => row.delta), [-12]);
        for (const language of ['en', 'zh']) {
          const delivered = (await direct.post('solution', 'provide', { contentLanguage: language })).data;
          assert.equal(delivered.solution.code, content.programming.solution.code);
          assert.equal(delivered.solution.explanation, content.programming.solution.explanation[language]);
          assert.equal(delivered.solution.complexity, content.programming.solution.complexity[language]);
          assert.equal((await request(`${direct.target}/programming?view=solution&language=${language}`, { auth: actor })).data.code, content.programming.solution.code);
        }
        const unentitledActor = scope === 'school' ? auth.admin : auth.legacy;
        await request(`${direct.target}/programming?view=solution`, { auth: unentitledActor, status: 403 });
        await request(`${direct.target}/programming/solution/provide`, { auth: unentitledActor, method: 'POST', body: { paperVersionId: direct.versionId }, status: 403 });
        await direct.setPrice(20);
        assert.equal((await direct.post('solution', 'quote')).data.price, 0, 'existing purchases are not charged again after a price increase');
        assert.equal((await request(`${direct.target}/programming`, { auth: actor })).data.attempts, 0);

        const discounted = await makePaper('discounted');
        const translation = (await discounted.post('translation', 'quote')).data;
        assert.equal(translation.price, 3);
        await discounted.purchase('translation', translation);
        await translationPrice(9);
        const beforePriceChange = (await discounted.post('solution', 'quote')).data;
        assert.equal(beforePriceChange.basePrice, 12); assert.equal(beforePriceChange.translationCredit, 3); assert.equal(beforePriceChange.price, 9);
        await discounted.setPrice(14);
        await discounted.purchase('solution', beforePriceChange, randomUUID(), 409);
        const adjusted = (await discounted.post('solution', 'quote')).data;
        assert.equal(adjusted.basePrice, 14); assert.equal(adjusted.translationCredit, 3); assert.equal(adjusted.price, 11);
        await discounted.purchase('solution', adjusted);
        assert.deepEqual((await discounted.entries()).rows.map(row => row.delta), [-3, -11]);
        const credited = (await pool.query(`SELECT ${creditColumn} credit FROM ${entitlements}
          WHERE identity_id=$1 AND subject_key=$2 AND kind='FULL_SOLUTION'`, [identityId,`acsl:${discounted.id}`])).rows[0];
        assert.equal(String(credited.credit), String((await discounted.entries()).rows[0].id));
        assert.equal((await discounted.post('solution', 'quote')).data.price, 0);
        const translationEntry = (await discounted.entries()).rows[0];
        const refund = entry => scope === 'legacy'
          ? pool.query("SELECT * FROM luq_post_entry($1,$2,'refund',$3,$4,$5,$6,$7)",
            [identityId,-entry.delta,`test-refund:${randomUUID()}`,users.admin.id,'Refund translation',{},entry.id])
          : transaction(pool, async db => {
            await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
            return db.query("SELECT * FROM school_scholarship_entry($1,$2,$3,'refund',$4,$5,$6,$7,$8)",
              [schoolId,identityId,-entry.delta,`test-refund:${randomUUID()}`,users.admin.id,'Refund translation',{},entry.id]);
          });
        await assert.rejects(refund(translationEntry), /(?:SCHOLARSHIP_CREDIT_USED|LUQ_TRANSLATION_CREDIT_USED)/,
          'credited translation cannot be refunded separately from its solution');

        const refunded = await makePaper('refunded');
        await refunded.purchase('translation', (await refunded.post('translation', 'quote')).data);
        await refund((await refunded.entries()).rows[0]);
        const afterRefund = (await refunded.post('solution', 'quote')).data;
        assert.equal(afterRefund.translationCredit, 0, 'refunded payments cannot be spent again as translation credit');
        assert.equal(afterRefund.price, 12);

        const covered = await makePaper('covered');
        await covered.purchase('translation', (await covered.post('translation', 'quote')).data);
        await covered.setPrice(2);
        const coveredQuote = (await covered.post('solution', 'quote')).data;
        assert.equal(coveredQuote.basePrice, 2); assert.equal(coveredQuote.translationCredit, 2); assert.equal(coveredQuote.price, 0);
        const coveredKey = randomUUID();
        await Promise.all([covered.purchase('solution', coveredQuote, coveredKey), covered.purchase('solution', coveredQuote, coveredKey)]);
        assert.deepEqual((await covered.entries()).rows.map(row => row.delta), [-9], 'a fully credited solution creates no zero-valued money entry');
        await covered.setPrice(18);
        assert.equal((await covered.post('solution', 'quote')).data.price, 0, 'zero-charge credit grants a durable entitlement');
        assert.equal((await covered.post('solution', 'provide')).data.solution.code, content.programming.solution.code);
        await covered.purchase('translation', { contentId: coveredQuote.contentId, price: 0 }, coveredKey, 409);

        const free = await makePaper('free');
        await free.setPrice(0);
        const freeQuote = (await free.post('solution', 'quote')).data;
        assert.equal(freeQuote.mode, 'free'); assert.equal(freeQuote.price, 0);
        assert.equal((await free.post('solution', 'provide')).data.solution.code, content.programming.solution.code);
        assert.equal((await free.entries()).rowCount, 0);
        await free.setPrice(null);
        assert.equal((await free.post('solution', 'quote')).data.basePrice, 12);

        const expensive = await makePaper('insufficient');
        await expensive.setPrice(1000);
        const expensiveQuote = (await expensive.post('solution', 'quote')).data;
        assert.ok(expensiveQuote.balance < expensiveQuote.price);
        await expensive.purchase('solution', expensiveQuote, randomUUID(), 409);
        assert.equal((await expensive.entries()).rowCount, 0);
        await expensive.post('solution', 'provide', {}, 403);
        await request(`${expensive.target}/programming?view=solution`, { auth: actor, status: 403 });
      } finally { await translationPrice(originalTranslationPrice); }
    });
    await t.test('runtime grants isolate answers and worker, withdrawal blocks further access', async () => {
      for (const table of ['acsl_papers','acsl_drafts','acsl_submissions','acsl_paper_grades']) {
        assert.equal((await app.query(`SELECT * FROM ${table}`)).rowCount, 0);
        await assert.rejects(worker.query(`SELECT * FROM ${table}`), { code: '42501' });
      }
      for (const table of ['acsl_point_rules','acsl_point_awards','acsl_programming_point_receipts']) {
        await assert.rejects(worker.query(`SELECT * FROM ${table}`), { code: '42501' });
        await assert.rejects(app.query(`INSERT INTO ${table} SELECT * FROM ${table} WHERE false`), { code: '42501' });
        await assert.rejects(app.query(`DELETE FROM ${table} WHERE false`), { code: '42501' });
      }
      await assert.rejects(app.query('SELECT * FROM acsl_programming_point_receipts'), { code: '42501' });
      await assert.rejects(app.query('UPDATE acsl_point_rules SET programming_points=programming_points WHERE false'), { code: '42501' });
      await assert.rejects(app.query('UPDATE acsl_point_awards SET points=points WHERE false'), { code: '42501' });
      await assert.rejects(app.query('UPDATE acsl_programming_point_receipts SET points=points WHERE false'), { code: '42501' });
      await assert.rejects(app.query('UPDATE acsl_submissions SET correct=true'), { code: '42501' });
      await assert.rejects(app.query('UPDATE acsl_paper_grades SET correct_count=0'), { code: '42501' });
      await assert.rejects(app.query('DELETE FROM acsl_paper_grades'), { code: '42501' });
      assert.equal((await pool.query("SELECT has_table_privilege('campus_app','acsl_submissions','INSERT') allowed")).rows[0].allowed, false);
      await assert.rejects(app.query('UPDATE acsl_papers SET definition=definition'), { code: '42501' });
      await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [school.id,users.student.id]);
      await request(path, { auth: auth.student, status: 404 });
      await request(referencePath, { auth: auth.student, status: 404 });
      await request(`${root}?view=availability`, { auth: auth.student, status: 404 });
      await pool.query('UPDATE acsl_papers SET enabled=false WHERE school_id=$1', [school.id]);
      assert.equal((await request(root, { auth: auth.admin })).data.enabled, false);
      assert.deepEqual((await request(`${root}?view=availability`, { auth: auth.admin })).data, { enabled: false });
      assert.deepEqual((await request(`${root}/manage?view=availability`, { auth: auth.admin })).data, { enabled: true });
      await request(path, { auth: auth.admin, status: 404 });
    });
  } finally {
    await server?.close(); await worker?.end(); await app?.end(); await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
