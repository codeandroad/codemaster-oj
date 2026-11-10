import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';
import { canonicalHash, hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';
import { updateAcslPresentations } from '../../../packages/domain/src/acsl-presentation.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

test('presentation-only repair keeps grading versions, submissions, points and judge snapshots intact', { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL); assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const schema = `acsl_display_${randomBytes(5).toString('hex')}`, manager = createPool(base.href);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href); let server, app, worker;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url'), passwordHash = await hashPassword(password), users = {};
    for (const name of ['actor', 'student', 'pending']) {
      const identity = randomUUID();
      await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2)", [identity, name]);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, passwordHash])).rows[0];
      await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [users[name].id]);
      await pool.query('INSERT INTO legacy_school_identity_ownership(identity_id) VALUES($1) ON CONFLICT DO NOTHING', [identity]);
      await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [users[name].id]);
    }
    const original = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    const authoredSolution = original.programming.solution ?? { language: 'python', provenance: 'independent',
      code: original.programming.definition.referenceCode, explanation: { en: 'Card simulation.', zh: '模拟出牌。' },
      complexity: { en: 'O(n²) time, O(n) space.', zh: '时间 O(n²)，空间 O(n)。' } };
    delete original.programming.solution;
    original.slug = 'acsl-presentation-source';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=', 'base64');
    const translatedPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    original.assets = [{ id: 'old-question-crop', path: 'old.png', sha256: createHash('sha256').update(png).digest('hex'), mimeType: 'image/png', width: 1, height: 1,
      source: { path: 'source.pdf', sha256: '0'.repeat(64), page: 1, bbox: [0, 0, 1, 1] } }];
    original.assets.push({ ...original.assets[0], id: 'old-program-zh', path: 'old-zh.png', sha256: createHash('sha256').update(translatedPng).digest('hex') });
    original.questions[0].statementAssets = { en: ['old-question-crop'], zh: [] };
    original.programming.statementAssets = { en: ['old-question-crop'], zh: ['old-program-zh'] };
    const paper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: original,
      assets: [{ id: 'old-question-crop', content: png }, { id: 'old-program-zh', content: translatedPng }], enablePoints: true });
    const otherContent = structuredClone(original); otherContent.slug = 'acsl-presentation-second'; otherContent.division = 'Elementary'; otherContent.programming = null;
    otherContent.assets.pop();
    const other = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: otherContent, assets: [{ id: 'old-question-crop', content: png }] });
    const asRole = role => { const url = new URL(scoped); url.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return url.href; };
    app = createPool(asRole('campus_app')); worker = createPool(asRole('campus_worker'));
    const origin = 'http://acsl-presentation.test';
    server = await createApiApplication({ databaseUrl: asRole('campus_app'), logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const host = await server.getUrl();
    const request = async (path, { auth, method = 'GET', body, status = 200 } = {}) => {
      const response = await fetch(`${host}${path.startsWith('/api/') ? path : `/api/v1${path}`}`, { method, headers: { Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data));
      return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const auth = {};
    for (const name of Object.keys(users)) { const login = await request('/auth/login', { method: 'POST', body: { username: name, password } }); auth[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
    const path = `/schools/${LEGACY_SCHOOL_ID}/acsl/${paper.id}`;
    await t.test('private Chinese source images require the same translation entitlement', async () => {
      const asset = `${path}/assets/old-program-zh?versionId=${paper.versionId}`;
      await request(asset, { auth: auth.pending, status: 403 });
      const translate = (action, body = {}) => request(`${path}/programming/translation/${action}`, { auth: auth.pending, method: 'POST', body });
      const quote = (await translate('quote')).data;
      await translate('unlock', { requestKey: randomUUID(), confirmedContentId: quote.contentId, confirmedPrice: quote.price });
      assert.ok((await translate('provide')).data.body.includes(asset));
      const response = await fetch(`${host}/api/v1${asset}`, { headers: { Origin: origin, Cookie: auth.pending.cookie } });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), translatedPng);
      await request(asset, { auth: auth.student, status: 403 });
    });
    for (const question of original.questions) await request(`${path}/questions/${question.id}/draft`, { auth: auth.student, method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds } });
    await request(`${path}/questions/q1/draft`, { auth: auth.pending, method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: ['A'] } });
    const grade = (await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: { versionId: paper.versionId, revisions: Object.fromEntries(original.questions.map(q => [q.id, 1])) } })).data;
    assert.equal(grade.writtenPointsAwarded, 6);
    const originalCrop = grade.questions[0].statementAssets.en[0];
    const programming = (await request(`${path}/programming`, { auth: auth.student })).data;
    assert.ok(programming.statement.includes(originalCrop), 'not-yet-transcribed programming keeps its authorized source image');
    const queued = (await request(`${path}/programming/submissions`, { auth: auth.student, method: 'POST', status: 202, body: { paperVersionId: paper.versionId,
      versionId: programming.versionId, requestId: randomUUID(), kind: 'submit', language: 'python', code: original.programming.definition.referenceCode } })).data;
    await pool.query(`INSERT INTO acsl_submissions(school_id,paper_id,version_id,account_id,question_id,selected_option_ids,correct,request_id,request_hash,draft_revision)
      VALUES($1,$2,$3,$4,'q1','["D"]',true,$5,'historical',0)`, [LEGACY_SCHOOL_ID, paper.id, paper.versionId, users.pending.id, randomUUID()]);
    const unchangedTables = ['acsl_drafts', 'acsl_submissions', 'acsl_paper_grades', 'acsl_point_awards', 'acsl_point_rules', 'school_problem_versions', 'school_problems', 'school_problem_banks', 'school_judge_jobs', 'acsl_assets'];
    const snapshot = async () => Object.fromEntries(await Promise.all(unchangedTables.map(async table => [table, (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows])));
    const before = await snapshot();
    const diagram = { en: [{ id: 'native-tree', width: 100, height: 60, alt: { en: 'A labelled node', zh: '带标记的结点' }, elements: [
      { type: 'circle', cx: 50, cy: 30, r: 20, fill: 'surface', stroke: 'ink' }, { type: 'text', x: 50, y: 35, text: 'A', anchor: 'middle' },
    ] }], zh: [] };
    const native = structuredClone(original); delete native.assets; delete native.questions[0].statementAssets;
    delete native.programming.statementAssets;
    native.questions[0].statement.en = 'A native statement with $x^2$ and {{diagram:native-tree}}.';
    native.questions[0].options[0].text.en = '$A + B$'; native.questions[0].statementDiagrams = diagram;
    native.questions[0].options[0].diagrams = diagram; native.questions[0].explanationDiagrams = diagram;
    native.questions[0].explanation.en = 'Native worked explanation.';
    native.programming.definition.title = 'Native programming presentation';
    native.programming.definition.statement = 'Native English programming statement.'; native.programming.statementZh = '原生中文编程题干。';
    native.programming.statementDiagrams = diagram;
    native.programming.solution = authoredSolution;
    const args = { schoolId: LEGACY_SCHOOL_ID, actorAccountId: users.actor.id, reason: 'Reviewed native presentation repair',
      updates: [{ content: native, expectedContentHash: canonicalHash(original) }] };

    await t.test('dry run, stale before hashes and forbidden changes cannot partially update a batch', async () => {
      assert.equal((await updateAcslPresentations(pool, { ...args, dryRun: true })).changed, 1);
      assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_presentation_updates')).rows[0].n, 0);
      await assert.rejects(updateAcslPresentations(pool, { ...args, updates: [...args.updates, { content: { ...otherContent, title: { en: 'Other native', zh: '另一份' } }, expectedContentHash: 'f'.repeat(64) }] }), /changed since review/);
      const changedAnswer = structuredClone(native); changedAnswer.questions[0].correctOptionIds = ['A'];
      await assert.rejects(updateAcslPresentations(pool, { ...args, updates: [{ content: changedAnswer, expectedContentHash: canonicalHash(original) }] }), /grading contract/);
      assert.deepEqual((await pool.query('SELECT definition FROM acsl_papers WHERE id=$1', [paper.id])).rows[0].definition, original);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('concurrent repair is idempotent and preserves every grading, history and points row', async () => {
      const results = await Promise.all([updateAcslPresentations(pool, args), updateAcslPresentations(pool, args), updateAcslPresentations(pool, args)]);
      assert.deepEqual(results.map(result => result.changed).sort(), [0, 0, 1]);
      assert.deepEqual(await snapshot(), before);
      const row = (await pool.query('SELECT * FROM acsl_papers WHERE id=$1', [paper.id])).rows[0];
      assert.equal(row.version_id, paper.versionId); assert.equal(row.programming_problem_id, programming.id); assert.equal(row.programming_version_id, programming.versionId);
      assert.equal(row.content_hash, canonicalHash(native));
      const audits = (await pool.query('SELECT * FROM acsl_presentation_updates')).rows;
      assert.equal(audits.length, 1); assert.deepEqual(audits[0].before_definition, original); assert.deepEqual(audits[0].after_definition, native);
      assert.equal((await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: native })).imported, false);
      await assert.rejects(pool.query("UPDATE acsl_presentation_updates SET reason='erase evidence'"));
      await assert.rejects(pool.query('DELETE FROM acsl_presentation_updates'));
      for (const db of [app, worker]) await assert.rejects(db.query('SELECT * FROM acsl_presentation_updates'), error => error.code === '42501');
      await assert.rejects(app.query('UPDATE acsl_papers SET definition=definition'), error => error.code === '42501');
    });

    await t.test('native projection separates answers and explanations and retires cached screenshot URLs', async () => {
      const pending = (await request(path, { auth: auth.pending })).data;
      assert.equal(pending.graded, false); assert.equal(pending.questions[0].lastSubmission, null); assert.deepEqual(pending.questions[0].draft, { selectedOptionIds: ['A'], revision: 1 });
      assert.deepEqual(pending.questions[0].statementDiagrams, diagram); assert.deepEqual(pending.questions[0].options[0].diagrams, diagram);
      assert.ok(!JSON.stringify(pending).includes('explanationDiagrams')); assert.ok(!JSON.stringify(pending).includes('correctOptionIds'));
      await request(`${path}/questions/q1/explanation?versionId=${paper.versionId}`, { auth: auth.pending, status: 403 });
      const graded = (await request(path, { auth: auth.student })).data;
      assert.equal(graded.gradeId, grade.gradeId); assert.equal(graded.writtenPointsAwarded, 6); assert.equal(graded.score, 6);
      const explanation = (await request(`${path}/questions/q1/explanation?versionId=${paper.versionId}`, { auth: auth.student })).data;
      assert.deepEqual(explanation.explanationDiagrams, diagram); assert.deepEqual(explanation.correctOptionIds, original.questions[0].correctOptionIds);
      await request(originalCrop, { auth: auth.student, status: 404 });
      const english = (await request(`${path}/programming?language=en`, { auth: auth.student })).data;
      assert.equal(english.statement, native.programming.definition.statement); assert.equal(english.title, native.programming.definition.title); assert.deepEqual(english.statementDiagrams, diagram.en);
      const chinese = (await request(`${path}/programming?language=zh`, { auth: auth.student })).data;
      assert.equal(chinese.statement, english.statement); assert.deepEqual(chinese.statementDiagrams, diagram.en);
      const translate = (action, body = {}, status = 200) => request(`${path}/programming/translation/${action}`,
        { auth: auth.student, method: 'POST', body: { paperVersionId: paper.versionId, ...body }, status });
      await translate('provide', {}, 403);
      const quote = (await translate('quote')).data;
      await translate('unlock', { requestKey: randomUUID(), confirmedContentId: quote.contentId, confirmedPrice: quote.price });
      const translated = (await translate('provide')).data;
      assert.equal(translated.body, native.programming.statementZh); assert.deepEqual(translated.statementDiagrams, diagram.zh);
      assert.equal(english.versionId, programming.versionId); assert.deepEqual(english.samples, programming.samples);
      assert.ok(!JSON.stringify(english).includes('referenceCode')); assert.ok(!JSON.stringify(english).includes('"tests"'));
      const second = (await request(`/schools/${LEGACY_SCHOOL_ID}/acsl/${other.id}`, { auth: auth.student })).data;
      assert.equal(second.graded, false, 'unrelated paper is untouched');
    });

    await t.test('the already queued coding submission still judges against its original isolated test snapshot', { skip: !process.env.GO_JUDGE_TEST_URL }, async () => {
      const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: process.env.JUDGE_ENVIRONMENT_VERSION ?? 'acsl-presentation' });
      await judge.ready(); await processSchoolOne({ pool: worker, judge });
      const result = (await request(`${path}/programming/submissions/${queued.id}`, { auth: auth.student })).data;
      assert.equal(result.status, 'AC'); assert.equal(result.passed, 6); assert.equal(result.practicePointsAwarded, 10);
    });
  } finally {
    await server?.close(); await app?.end(); await worker?.end(); await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
