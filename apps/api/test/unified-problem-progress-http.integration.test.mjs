import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

// Every account and result in this suite is synthetic. Published versions and
// completed submissions are preserved so the test can distinguish a current
// teaching version from the historical version that actually earned an AC.
test('ordinary problem versions and personal progress agree across school, platform and course entry points', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 90000,
}, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(base.pathname, '/campus_qa');
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const manager = createPool(base.href), schema = 'unified_problems_' + randomBytes(6).toString('hex');
  await manager.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const owner = createPool(scoped.href); let app, worker;
  const password = randomBytes(24).toString('base64url'), origin = 'http://unified-problems.test';
  try {
    await migrate(owner);
    await bootstrap(owner, { name: 'Fixture author', number: 'ADMIN', username: 'author', password });
    await provisionPlatformAdministrator(owner, { username: 'author' });
    const actors = { author: (await owner.query("SELECT id,identity_id AS \"identityId\" FROM accounts WHERE username='author'")).rows[0] };
    const hash = await hashPassword(password);
    for (const name of ['school-solver', 'public-solver', 'unstarted', 'exam-solver']) {
      const identityId = randomUUID();
      await owner.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2)", [identityId, name]);
      actors[name] = { identityId, ...(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, name, hash])).rows[0] };
      await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [actors[name].id]);
      await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [actors[name].id]);
    }
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const runtime = new URL(scoped); runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    const workerUrl = new URL(scoped); workerUrl.searchParams.set('options', `-crole=campus_worker -csearch_path=${schema}`);
    worker = createPool(workerUrl.href);
    app = await createApiApplication({ databaseUrl: runtime.href, logger: false,
      config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await app.listen(0, '127.0.0.1'); const endpoint = (await app.getUrl()) + '/api/v1';
    const sessions = {};
    const request = async (path, { name = 'author', method = 'GET', body, status = 200 } = {}) => {
      const session = sessions[name];
      const response = await fetch(endpoint + path, { method, headers: { Origin: origin,
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, status, `${method} ${path} as ${name}: ${JSON.stringify(data.error ?? data)}`);
      return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const get = async (path, name = 'school-solver', status = 200) => (await request(path, { name, status })).data;
    const post = async (path, body, name = 'author', status = 200) => (await request(path, { name, body, status, method: 'POST' })).data;
    for (const name of Object.keys(actors)) {
      const login = await request('/auth/login', { name, method: 'POST', body: { username: name, password } });
      sessions[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken };
    }
    const bank = (await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Unified fixture bank','school') RETURNING id", [actors.author.id])).rows[0];
    const problem = (await owner.query("INSERT INTO problems(owner_account_id,bank_id,owner_scope) VALUES($1,$2,'platform') RETURNING id", [actors.author.id, bank.id])).rows[0];
    const createVersion = async (title, { published = true, mode = 'stdio' } = {}) => {
      const v = (await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,function_name,reference_code,samples,time_limit_ms,memory_limit_mb,validation_status)
        VALUES($1,$2,$3,$2,$4,$5,$6,1000,128,'AC') RETURNING id`, [problem.id, title, mode, mode === 'function' ? 'solve' : null,
        mode === 'function' ? 'def solve(data):\n return data' : 'print(input())', JSON.stringify([{ input: mode === 'function' ? '[7]' : '7', expected: '7' }])])).rows[0];
      await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,$2,'937',100)", [v.id, mode === 'function' ? '[937]' : '937']);
      if (published) await owner.query("UPDATE problem_versions SET published_at=clock_timestamp(),school_visible_at=clock_timestamp(),rank_review_status='approved',rank_approved_at=clock_timestamp() WHERE id=$1", [v.id]);
      await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [problem.id, v.id]);
      return v;
    };
    const v1 = await createVersion('Original stdio exercise');
    await post('/platform/problem-publications', { schoolId: LEGACY_SCHOOL_ID, problemId: problem.id, versionId: v1.id });
    let course = await post('/platform/courses', { requestId: randomUUID(), title: 'Unified practice course', chapters: [{ title: 'Chapter', content: 'Read and practice.' }] }, 'author', 201);
    const chapter = course.chapters[0];
    await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapter.id, problem.id, v1.id]);
    course = await post(`/platform/courses/${course.id}/publish`, { expectedRevision: course.revision, sourceVersion: course.sourceVersion });
    const legacyCourse = (await owner.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Original school course',now()) RETURNING id", [actors.author.id])).rows[0];
    const legacyChapter = (await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'School chapter','Practice the same exercise.',0) RETURNING id", [legacyCourse.id])).rows[0];
    await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [legacyChapter.id, problem.id, v1.id]);
    const legacyResult = async (name, { kind = 'submit', status = 'AC', timedAttemptId = null, language = 'python' } = {}) => (await owner.query(`INSERT INTO submissions
      (account_id,identity_id,problem_id,version_id,kind,language,code,idempotency_key,request_hash,status,score,passed,total,timed_attempt_id)
      VALUES($1,$2,$3,$4,$5,$6,'PRIVATE_SAVED_CODE',$7,'fixture',$8,$9,$10,1,$11) RETURNING id,version_id,status`,
      [actors[name].id, actors[name].identityId, problem.id, v1.id, kind, language, randomUUID(), status, status === 'AC' ? 100 : 0, status === 'AC' ? 1 : 0, timedAttemptId])).rows[0];
    const historical = await legacyResult('school-solver');
    const publishedJob = await post(`/practice/problems/${problem.id}/submissions`, { requestId: randomUUID(), kind: 'submit', code: 'print(input())', language: 'python', versionId: v1.id }, 'public-solver', 202);
    const accepted = { judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicMessage: '', privateResults: [] }) };
    assert.equal(await processSchoolOne({ pool: worker, judge: accepted }), true);
    await legacyResult('unstarted', { kind: 'samples' });
    await legacyResult('school-solver', { status: 'WA' });
    const v2 = await createVersion('Current function exercise', { mode: 'function' });
    await createVersion('Unpublished private draft', { published: false });
    const courseQuery = new URLSearchParams({ courseId: course.id, chapterId: chapter.id, versionId: v1.id });

    await t.test('all ordinary entry points resolve the latest publication and ignore obsolete links and unpublished drafts', async () => {
      for (const name of ['school-solver', 'public-solver', 'unstarted']) {
        const schoolRow = (await get('/problems', name)).items.find(p => p.id === problem.id);
        const publicRow = (await get('/practice/problems', name)).items.find(p => p.id === problem.id);
        const schoolDetail = await get(`/problems/${problem.id}`, name);
        const schoolOldLink = await get(`/problems/${problem.id}?versionId=${v1.id}`, name);
        const publicDetail = await get(`/practice/problems/${problem.id}?versionId=${v1.id}`, name);
        const courseDetail = await get(`/practice/courses/${course.id}`, name);
        const schoolCourseDetail = await get(`/learning-paths/${legacyCourse.id}`, name);
        const courseProblem = await get(`/practice/problems/${problem.id}?${courseQuery}`, name);
        assert.ok(publicRow, 'a publication continues to expose the updated problem');
        for (const view of [schoolRow, publicRow, schoolDetail, schoolOldLink, publicDetail, courseDetail.chapters[0].problems[0], schoolCourseDetail.chapters[0].problems[0], courseProblem]) {
          assert.equal(view.versionId, v2.id); assert.equal(view.title ?? view.definition?.title, 'Current function exercise');
          assert.ok(!JSON.stringify(view).includes('Unpublished private draft'));
        }
        assert.equal(schoolDetail.mode, 'function'); assert.equal(publicDetail.definition.mode, 'function');
        assert.equal(publicDetail.definition.referenceCode, undefined); assert.equal(publicDetail.definition.tests, undefined);
        assert.ok(!JSON.stringify(publicDetail.definition).includes('937'));
      }
    });
    await t.test('old school and public ACs are shared by problem, while runs and later WA do not change the solved result', async () => {
      for (const [name, solved, attempts] of [['school-solver', true, 2], ['public-solver', true, 1], ['unstarted', false, 0]]) {
        const schoolRow = (await get('/problems', name)).items.find(p => p.id === problem.id);
        const publicRow = (await get('/practice/problems', name)).items.find(p => p.id === problem.id);
        assert.equal(schoolRow.ownProgress.status, solved ? 'AC' : 'NotStarted', name);
        assert.equal(schoolRow.ownProgress.formalCount, attempts, name);
        assert.equal(publicRow.solved, solved, name); assert.equal(publicRow.attempts, attempts, name);
        assert.equal((await get(`/problems/${problem.id}`, name)).solved, solved, name);
        assert.equal((await get(`/practice/problems/${problem.id}`, name)).solved, solved, name);
        assert.equal((await get(`/practice/courses/${course.id}`, name)).completedExercises, solved ? 1 : 0, name);
        assert.equal((await get(`/learning-paths/${legacyCourse.id}`, name)).completedTasks, solved ? 1 : 0, name);
        assert.equal((await get('/learning-paths', name)).items.find(c => c.id === legacyCourse.id).completedTasks, solved ? 1 : 0, name);
        assert.equal((await get(`/problems/${problem.id}/submissions`, name)).solved, solved, name);
        assert.equal((await get(`/practice/problems/${problem.id}/submissions`, name)).solved, solved, name);
      }
    });
    await t.test('stale submissions are rejected before execution and historical verdict snapshots remain intact', async () => {
      const before = Number((await owner.query('SELECT count(*) n FROM school_judge_jobs')).rows[0].n);
      const stale = { requestId: randomUUID(), kind: 'submit', code: 'print(input())', language: 'python', versionId: v1.id };
      const rejected = await post(`/practice/problems/${problem.id}/submissions`, stale, 'public-solver', 409);
      assert.equal(rejected.error.code, 'PROBLEM_UPDATED');
      await post(`/practice/problems/${problem.id}/submissions`, { ...stale, requestId: randomUUID(), courseId: course.id, chapterId: chapter.id }, 'public-solver', 409);
      assert.equal(Number((await owner.query('SELECT count(*) n FROM school_judge_jobs')).rows[0].n), before);
      assert.deepEqual((await owner.query('SELECT id,version_id,status FROM submissions WHERE id=$1', [historical.id])).rows[0], historical);
      const audit = await get(`/problems/${problem.id}?originalSubmissionId=${historical.id}`, 'school-solver');
      assert.equal(audit.versionId, v1.id); assert.equal(audit.mode, 'stdio');
      await get(`/problems/${problem.id}?originalSubmissionId=${historical.id}`, 'public-solver', 403);
      await get(`/problems/${randomUUID()}?originalSubmissionId=${historical.id}`, 'school-solver', 404);
      const oldJob = await get(`/practice/problems/${problem.id}/submissions/${publishedJob.id}`, 'public-solver');
      assert.equal(oldJob.versionId, v1.id); assert.equal(oldJob.status, 'AC');
      assert.equal((await owner.query('SELECT version_id FROM chapter_problems WHERE chapter_id=$1', [chapter.id])).rows[0].version_id, v1.id, 'the old association remains an audit snapshot');
    });

    await t.test('unreleased exam AC is not exposed through ordinary progress and release makes it count', async () => {
      const exam = (await owner.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes,show_verdict)
        VALUES('Private exam',$1,now()-interval '1 hour',now()+interval '1 hour',120,false) RETURNING id`, [actors.author.id])).rows[0];
      await owner.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)', [exam.id, actors['exam-solver'].identityId]);
      const attempt = (await owner.query(`INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at)
        VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour') RETURNING id`, [exam.id, actors['exam-solver'].identityId, actors['exam-solver'].id])).rows[0];
      await legacyResult('exam-solver', { timedAttemptId: attempt.id });
      for (const expected of [false, true]) {
        if (expected) await owner.query('UPDATE timed_practices SET results_published_at=now() WHERE id=$1', [exam.id]);
        const schoolRow = (await get('/problems', 'exam-solver')).items.find(p => p.id === problem.id);
        const publicRow = (await get('/practice/problems', 'exam-solver')).items.find(p => p.id === problem.id);
        assert.equal(schoolRow.ownProgress.status, expected ? 'AC' : 'NotStarted');
        assert.equal(publicRow.solved, expected);
        assert.equal((await get(`/practice/courses/${course.id}`, 'exam-solver')).completedExercises, Number(expected));
      }
    });

    await t.test('native school publications use one current version and share personal AC in both directions', async () => {
      const school = await provisionSchool(owner, { slug: 'unified-native', name: 'Native school', adminUsername: 'author' });
      const nativeIdentities = {};
      for (const name of ['school-solver', 'public-solver']) {
        await owner.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')", [school.id, actors[name].id]);
        nativeIdentities[name] = (await owner.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student',$2,$2,$3) RETURNING id", [school.id, name, actors[name].id])).rows[0].id;
      }
      const definition = { title: 'Native original', mode: 'stdio', comparator: 'tokens', statement: 'Print the input.', reference_code: 'print(input())', samples: [{ input: '7', expected: '7' }], tests: [{ position: 1, input: '937', expected: '937', weight: 100 }], time_limit_ms: 1000, memory_limit_mb: 128 };
      const bankId = (await owner.query("INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,'Native bank',$3) RETURNING id", [school.id, actors.author.id, randomUUID()])).rows[0].id;
      const id = (await owner.query('INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [school.id, bankId, actors.author.id, definition, randomUUID()])).rows[0].id;
      const version = async (revision, title) => (await owner.query('INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,$3,$4) RETURNING id', [school.id, id, revision, { ...definition, title }])).rows[0].id;
      const first = await version(1, 'Native original');
      await owner.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2', [school.id, id, first]);
      await owner.query('INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by) VALUES($1,$2,$3,$4)', [school.id, id, first, actors.author.id]);
      const prefix = `/schools/${school.id}/problems`;
      const nativeChapter = { id: randomUUID(), title: 'Native chapter', body: 'Practice the current publication.', problems: [{ problemId: id, versionId: first }] };
      const nativeCoursePath = `/schools/${school.id}/courses`;
      let nativeCourse = await post(nativeCoursePath, { requestId: randomUUID(), title: 'Native shared course', accessScope: 'school', classIds: [], chapters: [nativeChapter] }, 'author', 201);
      nativeCourse = await post(`${nativeCoursePath}/${nativeCourse.id}/publish`, { expectedRevision: nativeCourse.revision });
      const nativeListing = await post('/platform/course-publications', { schoolId: school.id, courseId: nativeCourse.id, revision: nativeCourse.revision }, 'author', 201);
      for (const [name, path] of [['school-solver', prefix], ['public-solver', '/practice/problems']]) {
        await post(`${path}/${id}/submissions`, { kind: 'submit', code: 'print(input())', language: 'python', requestId: randomUUID(), versionId: first }, name, 202);
        assert.equal(await processSchoolOne({ pool: worker, judge: accepted }), true);
      }
      const latest = await version(2, 'Native current');
      await owner.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2', [school.id, id, latest]);
      for (const name of ['school-solver', 'public-solver']) {
        const schoolDetail = await get(`${prefix}/${id}`, name), publicDetail = await get(`/practice/problems/${id}?versionId=${first}`, name);
        assert.equal(schoolDetail.versionId, latest); assert.equal(publicDetail.versionId, latest);
        assert.equal(publicDetail.definition.title, 'Native current');
        for (const path of [prefix, '/practice/problems']) {
          const row = (await get(path, name)).items.find(p => p.id === id);
          assert.equal(row.versionId, latest); assert.equal(row.solved, true); assert.equal(row.attempts, 1);
        }
        for (const path of [`${nativeCoursePath}/${nativeCourse.id}`, `/practice/courses/${nativeListing.id}`]) {
          const detail = await get(path, name);
          assert.equal(detail.chapters[0].problems[0].versionId, latest); assert.equal(detail.completedExercises, 1);
        }
        for (const path of [`${prefix}?courseId=${nativeCourse.id}`, `/practice/problems?courseId=${nativeListing.id}`]) {
          const detail = await get(path, name);
          assert.equal(detail.items.find(p => p.id === id).versionId, latest);
        }
      }
      // Rebinding a school login to another pupil must not expose the previous
      // pupil's school AC through either the school or the public projection.
      await owner.query('UPDATE school_identities SET account_id=NULL WHERE school_id=$1 AND id=$2', [school.id, nativeIdentities['school-solver']]);
      await owner.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student','replacement','New pupil',$2)", [school.id, actors['school-solver'].id]);
      for (const path of [prefix, '/practice/problems']) {
        const row = (await get(path, 'school-solver')).items.find(p => p.id === id);
        assert.equal(row.solved, false, 'the newly bound school pupil did not earn the old AC'); assert.equal(row.attempts, 0);
      }
    });
    await t.test('the isolated worker judges the latest function edition and its AC appears in every entry point', {
      skip: !process.env.GO_JUDGE_TEST_URL,
    }, async () => {
      const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'unified-problems-qa' });
      const job = await post(`/practice/problems/${problem.id}/submissions`, { requestId: randomUUID(), kind: 'submit',
        language: 'python', code: 'def solve(data):\n    return data', versionId: v2.id, courseId: course.id, chapterId: chapter.id }, 'unstarted', 202);
      const captured = (await owner.query('SELECT version_id,payload FROM school_judge_jobs WHERE id=$1', [job.id])).rows[0];
      assert.equal(captured.version_id, v2.id); assert.equal(captured.payload.version.mode, 'function');
      assert.equal(captured.payload.version.title, 'Current function exercise');
      assert.equal(await processSchoolOne({ pool: worker, judge }), true);
      const result = await get(`/practice/problems/${problem.id}/submissions/${job.id}`, 'unstarted');
      assert.equal(result.versionId, v2.id); assert.equal(result.status, 'AC');
      assert.ok(result.caseFeedback.every(item => item.input === undefined && item.expected === undefined && item.output === undefined));
      assert.equal((await get('/problems', 'unstarted')).items.find(p => p.id === problem.id).ownProgress.status, 'AC');
      assert.equal((await get('/practice/problems', 'unstarted')).items.find(p => p.id === problem.id).solved, true);
      assert.equal((await get(`/practice/courses/${course.id}`, 'unstarted')).completedExercises, 1);
      assert.equal((await get(`/learning-paths/${legacyCourse.id}`, 'unstarted')).completedTasks, 1);
    });
    await t.test('publication controls show the current version and withdraw an older approval through that current version', async () => {
      const current = (await get('/platform/problem-publications', 'author')).items.find(item => item.id === problem.id);
      assert.equal(current.versionId, v2.id); assert.equal(current.platformPublished, true);
      await post(`/platform/problem-publications/${problem.id}/withdraw`, { schoolId: LEGACY_SCHOOL_ID, versionId: v2.id });
      const withdrawn = (await get('/platform/problem-publications', 'author')).items.find(item => item.id === problem.id);
      assert.equal(withdrawn.versionId, v2.id); assert.equal(withdrawn.platformPublished, false);
      const publication = (await owner.query('SELECT version_id,withdrawn_at FROM school_problem_publications WHERE problem_id=$1', [problem.id])).rows[0];
      assert.equal(publication.version_id, v1.id); assert.ok(publication.withdrawn_at);
    });
  } finally {
    if (app) await app.close(); if (worker) await worker.end(); await owner.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
  }
});
