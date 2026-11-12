import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { createApiApplication } from '../dist/application.js';

test('legacy course language governs judge admission and credit for newly published assignments', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 90000,
}, async () => {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = `legacy_course_language_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const database = new URL(process.env.TEST_DATABASE_URL);
  database.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(database.href);
  let app;
  try {
    await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8'))
      .match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url');
    const origin = 'http://legacy-course-language.test';
    await bootstrap(pool, { name: 'Administrator', number: 'LANG-ADMIN', username: 'lang-admin', password });
    const runtime = new URL(database);
    runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    app = await createApiApplication({ databaseUrl: runtime.href, logger: false, config: loadConfig({
      SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: origin, COOKIE_SECURE: 'false',
    }) });
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()) + '/api/v1';

    function client() {
      let cookie, csrf;
      return async (path, body, status = 200, method = body === undefined ? 'GET' : 'POST') => {
        const response = await fetch(base + path, { method, headers: {
          Origin: origin,
          ...(cookie && { Cookie: cookie, 'X-CSRF-Token': csrf }),
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data.error)}`);
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        if (data.csrfToken) csrf = data.csrfToken;
        return data;
      };
    }
    const admin = client();
    await admin('/auth/login', { username: 'lang-admin', password });
    async function register(username, kind) {
      const name = username, api = client();
      const { activationCode } = await admin('/people', { kind, number: username, name }, 201);
      const { user } = await api('/auth/register', {
        kind, number: username, name, activationCode, username, password,
      }, 201);
      return { api, user };
    }
    const { api: teacher, user: owner } = await register('lang-teacher', 'teacher');
    const { api: student, user: learner } = await register('lang-student', 'student');
    const { api: outsider } = await register('lang-outsider', 'student');

    const { rows: [{ id: problemId }] } = await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [owner.id]);
    const { rows: [{ id: versionId }] } = await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,
      time_limit_ms,memory_limit_mb,reference_code,validation_status,samples,published_at,school_visible_at,rank_review_status,rank_approved_at)
      VALUES($1,'Course exercise','stdio','Echo an integer.',1000,64,'print(input())','AC',$2,now(),now(),'approved',now())
      RETURNING id`, [problemId, JSON.stringify([{ input: '5', expected: '5' }])]);
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [problemId, versionId]);
    const { rows: [{ id: courseId }] } = await pool.query(`
      INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Languages',now()) RETURNING id`, [owner.id]);
    const { rows: [{ id: chapterId }] } = await pool.query(`
      INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'Intro',0) RETURNING id`, [courseId]);
    await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',
      [chapterId, problemId, versionId]);

    const dueAt = new Date(Date.now() + 3600000).toISOString();
    const homework = { title: 'Language homework', dueAt, coursePathId: courseId, participants: [learner.identityId],
      problems: [{ problemId, points: 20 }] };
    const oldAssignment = await teacher('/assignments', { ...homework, state: 'Published' }, 201);
    assert.equal(oldAssignment.requiredLanguage, null);
    const runBody = { problemId, versionId, kind: 'submit', code: 'const value = 1;', language: 'javascript' };
    const run = (api, body, status = 201) => api('/submissions', { idempotencyKey: randomUUID(), ...runBody, ...body }, status);
    const accept = id => pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1", [id.slice(3)]);
    const oldPractice = await run(student, {});
    await accept(oldPractice.id);
    const grade = async assignmentId => (await student(`/assignments/${assignmentId}`)).grades[0].problems[0];
    assert.equal((await grade(oldAssignment.id)).completionSource, 'other_entry');

    await teacher(`/learning-paths/${courseId}`, { requiredLanguage: 'python' }, 200, 'PATCH');
    const draft = await teacher('/assignments', { ...homework, state: 'Draft' }, 201);
    assert.equal(draft.requiredLanguage, 'python');
    const preview = `/assignments/${draft.id}/preview`, previewProblem = `${preview}/problems/${problemId}`;
    assert.equal((await teacher(preview)).requiredLanguage, 'python');
    const previewRequest = { kind: 'samples', code: 'print(input())', versionId, revision: draft.editRevision };
    const previewRun = (language, status) => teacher(previewProblem + '/submissions',
      { ...previewRequest, language, requestId: randomUUID() }, status);
    assert.equal((await previewRun('javascript', 400)).error.code, 'COURSE_LANGUAGE_REQUIRED');
    await previewRun('python', 202);

    await teacher(`/learning-paths/${courseId}`, { requiredLanguage: 'cpp' }, 200, 'PATCH');
    assert.equal((await teacher(previewProblem)).requiredLanguage, 'cpp');
    const assignment = await teacher(`/assignments/${draft.id}/publish`, { expectedRevision: draft.editRevision });
    const assignmentId = assignment.id, assignmentPath = `/assignments/${assignmentId}`;
    assert.equal(assignment.requiredLanguage, 'cpp');
    assert.equal((await teacher('/assignments', { ...homework, state: 'Published' }, 201)).requiredLanguage, 'cpp');
    assert.equal((await student(assignmentPath)).requiredLanguage, 'cpp');
    assert.equal((await grade(assignmentId)).status, 'NotSubmitted');
    assert.equal((await grade(oldAssignment.id)).score, 100);
    assert.equal((await student(`/submissions/${oldPractice.id}/assignment-completions`)).items.some(item => item.id === assignmentId), false);

    for (const kind of ['samples', 'custom', 'submit']) {
      assert.equal((await run(student, { kind, assignmentId }, 400)).error.code, 'COURSE_LANGUAGE_REQUIRED');
    }
    await run(outsider, { assignmentId }, 403);
    await run(student, { courseId }, 400);
    await run(student, { courseId, chapterId, assignmentId }, 400);
    await run(student, { courseId, chapterId: randomUUID() }, 404);
    assert.equal((await run(student, { courseId, chapterId }, 400)).error.code, 'COURSE_LANGUAGE_REQUIRED');
    const cppRun = { language: 'cpp', code: 'int main() { return 0; }' };
    const unscopedRequest = { ...cppRun, idempotencyKey: randomUUID() };
    const courseRequest = { ...unscopedRequest, courseId, chapterId };
    const courseRun = await run(student, courseRequest);
    assert.equal(courseRun.requiredLanguage, 'cpp');
    assert.equal((await run(student, unscopedRequest, 409)).error.code, 'IDEMPOTENCY_CONFLICT');
    await accept(courseRun.id);
    assert.equal((await grade(assignmentId)).completionSource, 'other_entry');
    assert.equal((await student(`/submissions/${courseRun.id}/assignment-completions`)).items.some(item => item.id === assignmentId), true);

    await teacher(`/learning-paths/${courseId}`, { requiredLanguage: 'javascript' }, 200, 'PATCH');
    assert.equal((await run(student, courseRequest)).id, courseRun.id);
    const originalSubmissionId = courseRun.id;
    assert.equal((await student(`/submissions/${originalSubmissionId}`)).requiredLanguage, 'cpp');
    await run(outsider, { kind: 'samples', originalSubmissionId, language: 'cpp' }, 403);
    for (const kind of ['samples', 'custom', 'correction']) {
      assert.equal((await run(student, { kind, originalSubmissionId }, 400)).error.code, 'COURSE_LANGUAGE_REQUIRED');
    }
    const correctionSample = await run(student, { ...cppRun, originalSubmissionId, kind: 'samples' });
    assert.equal(correctionSample.requiredLanguage, 'cpp');
    assert.deepEqual((await student(`/submissions/${correctionSample.id}`)).reviews, []);
    const correction = await run(student, { ...cppRun, originalSubmissionId, kind: 'correction' });
    assert.equal(correction.requiredLanguage, 'cpp');
    assert.equal((await student(`/submissions/${correction.id}`)).reviews.length, 1);

    const detached = await teacher(assignmentPath, { coursePathId: null, expectedRevision: assignment.editRevision }, 200, 'PATCH');
    assert.equal(detached.requiredLanguage, 'cpp');
    assert.equal((await student(assignmentPath)).requiredLanguage, 'cpp');
    assert.equal((await teacher(previewProblem)).requiredLanguage, 'cpp');
    const previewMismatch = await teacher(previewProblem + '/submissions', {
      ...previewRequest, revision: detached.editRevision, language: 'javascript', requestId: randomUUID(),
    }, 400);
    assert.equal(previewMismatch.error.code, 'COURSE_LANGUAGE_REQUIRED');
    const acceptedAssignmentRun = await run(student, { ...cppRun, assignmentId });
    assert.equal(acceptedAssignmentRun.requiredLanguage, 'cpp');
    const { rows: [{ total }] } = await pool.query('SELECT count(*)::int total FROM submissions WHERE assignment_id=$1', [assignmentId]);
    assert.equal(total, 1, 'rejected languages do not create judge submissions');
  } finally {
    if (app) await app.close();
    await pool.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`);
    await manager.end();
  }
});
