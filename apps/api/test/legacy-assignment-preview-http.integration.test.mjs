import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';
import { processOne } from '../../../packages/domain/worker.mjs';
import { SCHOOL_BANK } from '../../../packages/domain/src/library.mjs';
import { acceptDraftValidation, draftIdentity, reviewIdentity } from '../../../packages/domain/test/problem-draft-fixture.mjs';

test('legacy teachers preview the current exercise with private, immutable judged results', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 90000,
}, async () => {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = 'legacy_preview_' + randomBytes(6).toString('hex');
  await manager.query(`CREATE SCHEMA ${schema}`);
  const database = new URL(process.env.TEST_DATABASE_URL);
  database.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(database.href);
  let app;
  try {
    await migrate(pool);
    const password = randomBytes(24).toString('base64url');
    await bootstrap(pool, { name: 'QA administrator', number: 'ADMIN', username: 'qa-admin', password });
    const origin = 'http://legacy-preview.test';
    app = await createApiApplication({ databaseUrl: database.href, logger: false, config: loadConfig({
      SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: origin, COOKIE_SECURE: 'false',
    }) });
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()) + '/api/v1';
    function client() {
      let cookie, csrf;
      return async (path, { body, method = body === undefined ? 'GET' : 'POST', status = 200, includeCsrf = true } = {}) => {
        const response = await fetch(base + path, { method, headers: { Origin: origin,
          ...(cookie && { Cookie: cookie }), ...(includeCsrf && csrf && { 'X-CSRF-Token': csrf }),
          ...(body && { 'Content-Type': 'application/json' }),
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data.error ?? {})}`);
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        if (data.csrfToken) csrf = data.csrfToken;
        return data;
      };
    }
    const admin = client();
    await admin('/auth/login', { body: { username: 'qa-admin', password } });
    async function register(username, kind) {
      const api = client(), name = username;
      const person = await admin('/people', { body: { kind, number: username, name }, status: 201 });
      const { user } = await api('/auth/register', { body: {
        kind, number: username, name, activationCode: person.activationCode, username, password,
      }, status: 201 });
      return { api, user };
    }
    const { api: teacher, user: owner } = await register('qa-teacher', 'teacher');
    const { api: colleague } = await register('qa-colleague', 'teacher');
    const { api: student, user: learner } = await register('qa-student', 'student');
    const platform = client();
    await platform('/auth/register-personal', { body: { username: 'qa-platform', displayName: 'QA platform', password }, status: 201 });
    await provisionPlatformAdministrator(pool, { username: 'qa-platform' });

    async function publish(title, previous, sample = '5') {
      const draft = await teacher(previous ? `/problems/${previous.id}/versions` : '/problems', { status: 201, body: {
        ...(previous && draftIdentity(previous)), title, statement: 'Echo an integer.', mode: 'stdio', comparator: 'tokens',
        bankId: SCHOOL_BANK, timeLimitMs: 1000, memoryLimitMb: 64, referenceCode: 'print(input())',
        samples: [{ input: sample, expected: sample }], tests: [{ input: '84713', expected: '84713', weight: 100 }],
      } });
      if (previous) await acceptDraftValidation(pool, draft);
      else assert.equal(await processOne({ pool, logger: {}, judge: {
        environmentVersion: 'preview-fixture',
        async judge() {
          return { status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '',
            privateResults: [], environmentVersion: this.environmentVersion };
        },
      } }), true);
      await teacher(`/problems/${draft.id}/publish`, { body: reviewIdentity(draft) });
      await admin(`/problems/${draft.id}/rank-review`, { method: 'PATCH', body: { ...reviewIdentity(draft), decision: 'approved' } });
      return draft;
    }
    const original = await publish('Pinned preview task');
    const { id: problemId, versionId } = original;
    const { rows: [{ id: courseId }] } = await pool.query(
      "INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Preview course',now()) RETURNING id", [owner.id]);
    const { rows: [{ id: chapterId }] } = await pool.query(
      "INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'Preview chapter',0) RETURNING id", [courseId]);
    await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapterId, problemId, versionId]);
    const { rows: [{ id: assignmentId }] } = await pool.query(`INSERT INTO assignments(title,owner_account_id,due_at,course_path_id,state)
      VALUES('Preview homework',$1,now()+interval '1 hour',$2,'Draft') RETURNING id`, [owner.id, courseId]);
    await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,20,0)', [assignmentId, problemId, versionId]);
    await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)', [assignmentId, learner.identityId]);
    await pool.query(`INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,task_kind,created_by)
      VALUES('assignment',$1,1,6,1,100,'challenge',$2)`, [assignmentId, owner.id]);
    await pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1", [assignmentId]);
    const latest = await publish('Reviewed preview task', original);
    assert.equal(latest.versionId, versionId);

    const assignment = `/assignments/${assignmentId}`, preview = assignment + '/preview';
    const problem = `${preview}/problems/${problemId}`, enqueue = problem + '/submissions';
    const state = async () => {
      const homework = await student(assignment), course = await student(`/learning-paths/${courseId}`);
      const wallet = await student('/scholarship/me');
      const ranking = await student('/points/leaderboard');
      const stored = (await pool.query(`SELECT (SELECT count(*) FROM submissions) submissions,
        (SELECT count(*) FROM learning_progress) progress, (SELECT count(*) FROM point_ledger) points,
        (SELECT count(*) FROM school_rank_ledger) rank,(SELECT count(*) FROM luq_ledger) luq,
        (SELECT count(*) FROM luq_activity_awards) rewards`)).rows[0];
      return { grades: homework.grades, tasks: course.completedTasks, totalTasks: course.taskCount,
        chapterComplete: course.chapters[0].problems[0]?.completed, balance: wallet.balance, ranking, stored };
    };
    const before = await state();
    assert.equal(before.totalTasks, 1);
    assert.equal(before.chapterComplete, false);
    assert.equal(before.grades[0].score, 0);
    const view = await teacher(preview);
    assert.equal(view.problems[0].versionId, versionId);
    assert.equal((await student(`/problems/${problemId}`)).publishedRevision, latest.editRevision);
    assert.equal(view.problems[0].score, null);
    const statement = await teacher(problem);
    assert.equal(statement.problem.title, 'Reviewed preview task');
    assert.equal(statement.problem.publishedRevision, latest.editRevision);
    assert.equal(statement.problem.samples[0].expected, '5');
    assert.equal(statement.problem.referenceCode, undefined);
    assert.equal(statement.problem.tests, undefined);
    const body = { kind: 'submit', code: 'print(input())', language: 'python', requestId: randomUUID(),
      versionId, publishedRevision: latest.editRevision, revision: view.revision };
    await teacher(enqueue, { body, includeCsrf: false, status: 403 });
    await teacher(enqueue, { body: { ...body, publishedRevision: original.editRevision }, status: 409 });
    await student(preview, { status: 404 });
    await student(enqueue, { body, status: 404 });
    await colleague(preview, { status: 403 });
    await platform(preview, { status: 403 });
    const [queued, duplicate] = await Promise.all([teacher(enqueue, { body, status: 202 }), teacher(enqueue, { body, status: 202 })]);
    assert.equal(queued.id, duplicate.id);
    await teacher(enqueue, { body: { ...body, code: 'print(0)' }, status: 409 });
    const resultPath = `${preview}/jobs/${queued.id}`;
    assert.equal((await teacher(resultPath)).status, 'Waiting');
    await admin(resultPath, { status: 404 });
    const { rows: [task] } = await pool.query('SELECT id,purpose,submission_id,version_id FROM judge_tasks WHERE preview_submission_id=$1', [queued.id]);
    assert.equal(task.purpose, 'assignment_preview');
    assert.equal(task.submission_id, null);
    assert.equal(task.version_id, versionId);
    await admin(`/judge-tasks/${task.id}`, { status: 404 });
    await admin(`/judge-tasks/${task.id}/retry`, { body: { reason: 'QA privacy' }, status: 404 });

    const judge = process.env.GO_JUDGE_TEST_URL ? new GoJudge({
      url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'legacy-preview-qa',
    }) : {
      environmentVersion: 'legacy-preview-fixture',
      async judge({ kind, tests }) {
        const expected = { submit: '84713', samples: '5', custom: '11' }[kind];
        assert.equal(tests[0].input, expected);
        const status = kind === 'custom' ? 'Executed' : 'AC';
        return { status, score: kind === 'custom' ? null : 100, passed: 1, total: 1, publicOutput: '', publicMessage: 'Passed',
          privateResults: [{ position: 1, status, stdout: expected }], environmentVersion: this.environmentVersion };
      },
    };
    if (judge instanceof GoJudge) await judge.ready();
    assert.equal(await processOne({ pool, judge, logger: {} }), true);
    const result = await teacher(resultPath);
    assert.equal(result.status, 'AC');
    assert.equal(result.preview, true);
    assert.equal(result.score, 100);
    assert.equal(result.testResults[0].status, 'AC');
    assert.equal(JSON.stringify(result).includes('84713'), false, 'formal hidden tests stay private');
    assert.equal((await teacher(preview)).problems[0].score, 20);
    assert.equal((await teacher(enqueue)).items[0].id, queued.id);
    assert.equal((await admin(enqueue)).total, 0);
    for (const [kind, verdict, output] of [['samples', 'AC', '5'], ['custom', 'Executed', '11']]) {
      const { id } = await teacher(enqueue, {
        body: { ...body, kind, requestId: randomUUID(), ...(kind === 'custom' && { customInput: output }) }, status: 202,
      });
      assert.equal(await processOne({ pool, judge, logger: {} }), true);
      const run = await teacher(`${preview}/jobs/${id}`);
      assert.equal(run.status, verdict);
      assert.equal(run.testResults[0].output.trim(), output);
    }
    assert.equal((await teacher(enqueue)).items[0].id, queued.id);
    assert.deepEqual(await state(), before);

    // Positive control proves all four student projections respond to formal work.
    const formalSubmission = await student('/submissions', { body: { assignmentId, problemId, versionId, publishedRevision: latest.editRevision, kind: 'submit',
      code: 'print(input())', idempotencyKey: randomUUID() }, status: 201 });
    assert.equal(await processOne({ pool, judge, logger: {} }), true);
    const formal = await state();
    assert.equal(formal.grades[0].score, 20);
    assert.equal(formal.tasks, 1);
    assert.equal(formal.chapterComplete, true);
    assert.ok(formal.balance > before.balance);
    assert.ok(Number(formal.stored.rank) > Number(before.stored.rank));
    assert.notDeepEqual(formal.ranking, before.ranking);
    const queuedBeforeUpdate = await teacher(enqueue, {
      body: { ...body, kind: 'samples', requestId: randomUUID() }, status: 202,
    });
    const newest = await publish('Updated everywhere', latest, '6');
    assert.equal(newest.versionId, versionId);
    assert.equal((await teacher(problem)).problem.publishedRevision, newest.editRevision);
    assert.equal((await student(assignment)).problems[0].title, newest.title);
    assert.equal((await student(`/learning-paths/${courseId}`)).chapters[0].problems[0].title, newest.title);
    assert.equal((await student(`/submissions/${formalSubmission.id}`)).status, 'AC');
    assert.equal((await student(`/problems/${problemId}`)).samples[0].input, '6');
    assert.equal((await student(`/problems/${problemId}?originalSubmissionId=${formalSubmission.id}`)).samples[0].input, '5');
    assert.equal((await pool.query('SELECT version_id FROM assignment_problems WHERE assignment_id=$1',[assignmentId])).rows[0].version_id, versionId);
    assert.equal(await processOne({ pool, judge, logger: {} }), true);
    const queuedResult = await teacher(`${preview}/jobs/${queuedBeforeUpdate.id}`);
    assert.equal(queuedResult.status, 'AC');
    assert.equal(queuedResult.testResults[0].input, '5');
    await teacher(enqueue,{body:{...body,requestId:randomUUID()},status:409});
    await teacher(enqueue, { body: { ...body, requestId: randomUUID(), publishedRevision: newest.editRevision }, status: 202 });
    assert.equal((await state()).grades[0].score,20,'new content does not erase historical grades');
    await pool.query("UPDATE assignments SET due_at=clock_timestamp()-interval '1 second', edit_revision=edit_revision+1 WHERE id=$1", [assignmentId]);
    await teacher(enqueue, { body: { ...body, requestId: randomUUID() }, status: 409 });
    assert.equal((await teacher(preview)).problems[0].score, null);
    await teacher(assignment + '/archive', { body: {} });
    await teacher(preview, { status: 404 });
  } finally {
    await app?.close();
    await pool.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`);
    await manager.end();
  }
});
