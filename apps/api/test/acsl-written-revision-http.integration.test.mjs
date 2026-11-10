import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';
import { canonicalHash, hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';
import { updateAcslPresentations } from '../../../packages/domain/src/acsl-presentation.mjs';

test('semantic written repair preserves historical meaning and requires confirmed current drafts', { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL); assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const schema = `acsl_revision_${randomBytes(5).toString('hex')}`, manager = createPool(base.href);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href); let server, app, worker;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url'), passwordHash = await hashPassword(password), users = {};
    for (const name of ['actor', 'historical', 'pending', 'stale', 'fresh', 'outsider']) {
      const identity = randomUUID();
      await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$3,$2,$2)', [identity, name, name === 'outsider' ? 'personal' : 'student']);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, passwordHash])).rows[0];
      if (name !== 'outsider') {
        await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [users[name].id]);
        await pool.query('INSERT INTO legacy_school_identity_ownership(identity_id) VALUES($1) ON CONFLICT DO NOTHING', [identity]);
        await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [users[name].id]);
      }
    }
    const original = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    original.slug = 'acsl-semantic-repair';
    original.questions[5].options.find(option => option.id === 'C').text = { en: 'c, d, e, f', zh: 'c、d、e、f' };
    original.questions[5].correctOptionIds = ['C'];
    original.questions[5].explanation = { en: 'Original explanation retained with the historical grade.', zh: '随原答卷保留的原解析。' };
    const paper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: original, enablePoints: true });
    const asRole = role => { const url = new URL(scoped); url.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return url.href; };
    app = createPool(asRole('campus_app')); worker = createPool(asRole('campus_worker'));
    const origin = 'http://acsl-revision.test';
    server = await createApiApplication({ databaseUrl: asRole('campus_app'), logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const host = await server.getUrl();
    const request = async (path, { auth, method = 'GET', body, status = 200, csrf = true } = {}) => {
      const response = await fetch(`${host}/api/v1${path}`, { method, headers: { Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, ...(csrf ? { 'X-CSRF-Token': auth.csrfToken } : {}) } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json();
      assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${response.status}: ${JSON.stringify(data)}`);
      return { data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const auth = {};
    for (const name of Object.keys(users)) { const login = await request('/auth/login', { method: 'POST', body: { username: name, password } }); auth[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
    const path = `/schools/${LEGACY_SCHOOL_ID}/acsl/${paper.id}`;
    const body = { versionId: paper.versionId, revisions: Object.fromEntries(original.questions.map(question => [question.id, 1])) };
    const patch = (name, questionId, expectedRevision, writtenRevision, selectedOptionIds = original.questions.find(q => q.id === questionId).correctOptionIds, status = 200) =>
      request(`${path}/questions/${questionId}/draft`, { auth: auth[name], method: 'PATCH', status,
        body: { versionId: paper.versionId, expectedRevision, selectedOptionIds, ...(writtenRevision ? { writtenRevision } : {}) } });
    for (const name of ['historical', 'pending', 'stale']) for (const question of original.questions) await patch(name, question.id, 0);
    const oldGrade = (await request(`${path}/submit`, { auth: auth.historical, method: 'POST', body })).data;
    assert.equal(oldGrade.writtenRevision, paper.versionId); assert.equal(oldGrade.score, 6); assert.equal(oldGrade.writtenPointsAwarded, 6);
    const legacy = (await pool.query(`INSERT INTO acsl_submissions(school_id,paper_id,version_id,account_id,question_id,selected_option_ids,correct,request_id,request_hash,draft_revision)
      VALUES($1,$2,$3,$4,'q6','["C"]',true,$5,'historical',0) RETURNING id`, [LEGACY_SCHOOL_ID, paper.id, paper.versionId, users.pending.id, randomUUID()])).rows[0];
    const unchangedTables = ['acsl_drafts', 'acsl_submissions', 'acsl_paper_grades', 'acsl_point_awards', 'acsl_point_rules', 'school_problem_versions', 'school_judge_jobs'];
    const snapshot = async () => Object.fromEntries(await Promise.all(unchangedTables.map(async table => [table, (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows])));
    const before = await snapshot();
    const revised = structuredClone(original);
    revised.questions[5].options.find(option => option.id === 'C').text = { en: 'b, c, d, e, f', zh: 'b、c、d、e、f' };
    revised.questions[5].explanation = { en: 'Revised explanation: the second class also accepts digits.', zh: '修订解析：第二个字符类也接受数字。' };
    const args = { schoolId: LEGACY_SCHOOL_ID, actorAccountId: users.actor.id, reason: 'Approved correction of option C; preserve previous grades',
      updates: [{ content: revised, expectedContentHash: canonicalHash(original), changedQuestionIds: ['q6'] }] };
    let revision;

    await t.test('repair is atomic, idempotent and preserves grades, points and retired history verbatim', async () => {
      assert.equal((await updateAcslPresentations(pool, { ...args, dryRun: true })).changed, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_grade_question_snapshots')).rows[0].n, 0);
      const invalid = structuredClone(revised); invalid.questions[5].correctOptionIds = ['D'];
      await assert.rejects(updateAcslPresentations(pool, { ...args, updates: [{ content: invalid, expectedContentHash: canonicalHash(original), changedQuestionIds: ['q6'] }] }), /grading contract/);
      await assert.rejects(updateAcslPresentations(pool, { ...args, updates: [{ ...args.updates[0], changedQuestionIds: ['q1'] }] }), /unchanged question/);
      await assert.rejects(updateAcslPresentations(pool, { ...args, updates: [{ ...args.updates[0], expectedContentHash: 'f'.repeat(64) }] }), /changed since review/);
      assert.deepEqual(await snapshot(), before);
      const updates = await Promise.all([updateAcslPresentations(pool, args), updateAcslPresentations(pool, args)]);
      assert.deepEqual(updates.map(result => result.changed).sort(), [0, 1]);
      revision = updates[0].items[0].writtenRevision;
      assert.notEqual(revision, paper.versionId); assert.equal(updates[1].items[0].writtenRevision, revision);
      assert.deepEqual(await snapshot(), before);
      const saved = (await pool.query('SELECT * FROM acsl_grade_question_snapshots')).rows;
      assert.equal(saved.length, 1); assert.equal(saved[0].grade_id, oldGrade.gradeId); assert.deepEqual(saved[0].questions, original.questions);
      const retired = (await pool.query('SELECT * FROM acsl_submission_question_snapshots')).rows;
      assert.equal(retired.length, 1); assert.equal(retired[0].submission_id, legacy.id); assert.deepEqual(retired[0].question, original.questions[5]);
      assert.equal((await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: revised })).imported, false);
    });

    await t.test('historical detail, explicit explanation and replay retain the original question and grade', async () => {
      const historical = (await request(path, { auth: auth.historical })).data;
      assert.equal(historical.historicalWrittenVersion, true); assert.equal(historical.writtenRevision, revision);
      assert.equal(historical.gradeId, oldGrade.gradeId); assert.equal(historical.score, 6); assert.equal(historical.writtenPointsAwarded, 6);
      assert.deepEqual(historical.questions, oldGrade.questions);
      const explanation = (await request(`${path}/questions/q6/explanation?versionId=${paper.versionId}`, { auth: auth.historical })).data;
      assert.deepEqual(explanation.explanation, original.questions[5].explanation);
      for (const writtenRevision of [undefined, paper.versionId, randomUUID()]) {
        const replay = (await request(`${path}/submit`, { auth: auth.historical, method: 'POST', body: { versionId: paper.versionId, writtenRevision } })).data;
        assert.deepEqual(replay, historical);
      }
      const locked = await patch('historical', 'q6', 1, revision, ['D'], 409); assert.equal(locked.data.error.code, 'PAPER_GRADED');
    });

    await t.test('new and pending views never expose keys, while stale clients cannot save or submit', async () => {
      const pending = (await request(path, { auth: auth.pending })).data;
      assert.equal(pending.historicalWrittenVersion, false); assert.deepEqual(pending.changedQuestionIds, ['q6']); assert.ok(pending.writtenRevisionAt);
      assert.deepEqual(pending.questions[5].draft, { selectedOptionIds: ['C'], revision: 1 });
      assert.equal(pending.questions[5].requiresReview, true); assert.ok(pending.questions.slice(0, 5).every(q => !q.requiresReview));
      assert.deepEqual(pending.questions[5].options, revised.questions[5].options);
      const fresh = (await request(path, { auth: auth.fresh })).data;
      assert.ok(fresh.questions.every(q => !q.requiresReview)); assert.equal(fresh.questions[5].options[2].text.en, 'b, c, d, e, f');
      for (const value of [pending, fresh]) {
        assert.equal(value.score, null); assert.ok(value.questions.every(q => q.lastSubmission === null));
        assert.doesNotMatch(JSON.stringify(value), /correctOptionIds|explanation|questionSnapshot|reference_code|"tests"/);
      }
      await request(`${path}/questions/q6/explanation?versionId=${paper.versionId}`, { auth: auth.pending, status: 403 });
      for (const writtenRevision of [undefined, paper.versionId, randomUUID()]) {
        assert.equal((await patch('pending', 'q6', 1, writtenRevision, ['C'], 409)).data.error.code, 'WRITTEN_REVISION_CONFLICT');
        assert.equal((await request(`${path}/submit`, { auth: auth.pending, method: 'POST', status: 409, body: { ...body, writtenRevision } })).data.error.code, 'WRITTEN_REVISION_CONFLICT');
      }
      assert.equal((await request(`${path}/submit`, { auth: auth.pending, method: 'POST', status: 409, body: { ...body, writtenRevision: revision } })).data.error.code, 'ANSWER_REVIEW_REQUIRED');
      await request(`${path}/submit`, { auth: auth.pending, method: 'POST', status: 403, csrf: false, body: { ...body, writtenRevision: revision } });
      await request(path, { auth: auth.outsider, status: 404 });
      await patch('outsider', 'q6', 0, revision, ['C'], 404);
      assert.deepEqual(await snapshot(), before, 'rejected requests do not mutate any stored answer or award');
    });

    await t.test('saving the same choice explicitly confirms it, then concurrent turn-in awards only once', async () => {
      const confirmed = (await patch('pending', 'q6', 1, revision)).data;
      assert.deepEqual(confirmed, { selectedOptionIds: ['C'], revision: 2, requiresReview: false });
      const turnIn = { ...body, writtenRevision: revision, revisions: { ...body.revisions, q6: 2 } };
      const results = await Promise.all(Array.from({ length: 3 }, () => request(`${path}/submit`, { auth: auth.pending, method: 'POST', body: turnIn })));
      for (const result of results) assert.deepEqual(result.data, results[0].data);
      assert.equal(results[0].data.score, 6); assert.equal(results[0].data.writtenPointsAwarded, 6); assert.equal(results[0].data.historicalWrittenVersion, false);
      const saved = (await pool.query('SELECT questions,written_revision FROM acsl_grade_question_snapshots WHERE grade_id=$1', [results[0].data.gradeId])).rows[0];
      assert.deepEqual(saved.questions, revised.questions); assert.equal(saved.written_revision, revision);
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_point_awards')).rows[0].n, 2);
      const explanation = (await request(`${path}/questions/q6/explanation?versionId=${paper.versionId}`, { auth: auth.pending })).data;
      assert.deepEqual(explanation.explanation, revised.questions[5].explanation);
    });

    await t.test('later cosmetic repairs cannot overwrite frozen grades; later semantic repairs retain all outstanding review requirements', async () => {
      const cosmetic = structuredClone(revised); cosmetic.questions[5].explanation.zh += ' 排版修订。';
      await updateAcslPresentations(pool, { ...args, updates: [{ content: cosmetic, expectedContentHash: canonicalHash(revised) }] });
      assert.deepEqual((await request(`${path}/questions/q6/explanation?versionId=${paper.versionId}`, { auth: auth.pending })).data.explanation, revised.questions[5].explanation);
      const second = structuredClone(cosmetic); second.questions[1].statement.en += ' Clarified wording.';
      await updateAcslPresentations(pool, { ...args, updates: [{ content: second, expectedContentHash: canonicalHash(cosmetic), changedQuestionIds: ['q2'] }] });
      const stale = (await request(path, { auth: auth.stale })).data;
      assert.deepEqual(stale.changedQuestionIds, ['q2']); assert.notEqual(stale.writtenRevision, revision);
      assert.deepEqual(stale.questions.filter(q => q.requiresReview).map(q => q.id), ['q2', 'q6']);
      assert.equal((await request(`${path}/submit`, { auth: auth.stale, method: 'POST', body: { ...body, writtenRevision: stale.writtenRevision }, status: 409 })).data.error.code, 'ANSWER_REVIEW_REQUIRED');
      assert.deepEqual((await request(path, { auth: auth.historical })).data.questions, oldGrade.questions);
      assert.equal((await request(path, { auth: auth.pending })).data.historicalWrittenVersion, true);
      const programming = (await request(`${path}/programming`, { auth: auth.stale })).data;
      assert.equal(programming.solved, false); assert.equal(programming.attempts, 0); assert.deepEqual(programming.samples, original.programming.definition.samples);
    });

    await t.test('snapshots are tenant scoped, immutable and unavailable for runtime writes or worker reads', async () => {
      assert.equal((await app.query('SELECT count(*)::int n FROM acsl_grade_question_snapshots')).rows[0].n, 0);
      await assert.rejects(worker.query('SELECT * FROM acsl_grade_question_snapshots'), { code: '42501' });
      await assert.rejects(app.query('SELECT * FROM acsl_submission_question_snapshots'), { code: '42501' });
      for (const table of ['acsl_grade_question_snapshots', 'acsl_submission_question_snapshots']) {
        await assert.rejects(app.query(`INSERT INTO ${table} DEFAULT VALUES`), { code: '42501' });
        await assert.rejects(app.query(`UPDATE ${table} SET written_revision=written_revision`), { code: '42501' });
        await assert.rejects(pool.query(`DELETE FROM ${table}`));
      }
      await assert.rejects(app.query('SELECT acsl_freeze_graded_questions()'), { code: '42501' });
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_submissions')).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_paper_grades')).rows[0].n, 2);
      assert.equal((await pool.query('SELECT sum(points)::int total FROM acsl_point_awards')).rows[0].total, 12);
    });

    await t.test('a repair racing a save or turn-in cannot silently accept an answer against unseen wording', async () => {
      for (const action of ['save', 'submit']) {
        const source = structuredClone(original); source.slug = `acsl-revision-race-${action}`;
        const edition = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: source });
        const racePath = `/schools/${LEGACY_SCHOOL_ID}/acsl/${edition.id}`;
        if (action === 'submit') for (const question of source.questions) {
          await request(`${racePath}/questions/${question.id}/draft`, { auth: auth.fresh, method: 'PATCH',
            body: { versionId: edition.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds } });
        }
        const target = structuredClone(source); target.questions[5].options[2].text = revised.questions[5].options[2].text;
        const [response] = await Promise.all([
          request(action === 'save' ? `${racePath}/questions/q6/draft` : `${racePath}/submit`, {
            auth: auth.fresh, method: action === 'save' ? 'PATCH' : 'POST', status: [200, 409], body: action === 'save'
              ? { versionId: edition.versionId, writtenRevision: edition.versionId, expectedRevision: 0, selectedOptionIds: ['C'] }
              : { versionId: edition.versionId, writtenRevision: edition.versionId, revisions: body.revisions },
          }),
          updateAcslPresentations(pool, { ...args, updates: [{ content: target, expectedContentHash: canonicalHash(source), changedQuestionIds: ['q6'] }] }),
        ]);
        const detail = (await request(racePath, { auth: auth.fresh })).data;
        if (response.status === 409) assert.equal(response.data.error.code, 'WRITTEN_REVISION_CONFLICT');
        if (action === 'submit' && response.status === 200) {
          assert.equal(detail.graded, true); assert.equal(detail.historicalWrittenVersion, true);
          assert.equal(detail.questions[5].options[2].text.en, 'c, d, e, f');
          assert.equal(detail.gradeId, response.data.gradeId); assert.equal(detail.score, 6);
        } else {
          assert.equal(detail.graded, false); assert.equal(detail.questions[5].options[2].text.en, 'b, c, d, e, f');
          assert.equal(detail.questions[5].requiresReview, action === 'submit' || response.status === 200);
          assert.equal(detail.questions[5].draft.revision, action === 'submit' || response.status === 200 ? 1 : 0);
        }
        assert.equal((await request(path, { auth: auth.historical })).data.gradeId, oldGrade.gradeId, 'the separate original paper remains unchanged');
      }
    });
  } finally {
    await server?.close(); await app?.end(); await worker?.end(); await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
