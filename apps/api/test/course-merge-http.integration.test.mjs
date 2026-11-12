import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';

const noExamSecrets = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['correctOptionIds', 'explanation', 'explanationDiagrams', 'referenceCode', 'tests', 'solution'].includes(key), `ACSL secret field: ${key}`);
    noExamSecrets(child);
  }
};

test('draft course merge preserves learning records and enforces canonical authorization through real Nest HTTP', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 180000,
}, async t => {
  const database = new URL(process.env.TEST_DATABASE_URL);
  assert.match(database.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const manager = createPool(database.href);
  const schema = `course_merge_${randomBytes(6).toString('hex')}`;
  database.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(database.href);
  let server;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8'))
      .match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url');
    const passwordHash = await hashPassword(password);
    const users = {};
    for (const name of ['teacher', 'other-teacher', 'student', 'peer', 'outsider']) {
      const identityId = randomUUID();
      const role = name.includes('teacher') ? 'teacher' : 'student';
      await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identityId, role, name]);
      const { rows: [account] } = await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, name, passwordHash]);
      users[name] = { ...account, identityId };
      await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [account.id, role]);
      await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [account.id]);
    }
    const classId = randomUUID();
    await pool.query('INSERT INTO classes(id,name,owner_account_id) VALUES($1,$2,$3)', [classId, 'Merge test class', users.teacher.id]);
    await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)', [classId, users.teacher.id]);
    for (const name of ['student', 'peer']) await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [classId, users[name].identityId]);

    const content = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    const paper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.teacher.id, content });
    const { rows: [{ id: problemId }] } = await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [users.teacher.id]);
    const { rows: [{ id: versionId }] } = await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,
      time_limit_ms,memory_limit_mb,reference_code,validation_status,samples,published_at,school_visible_at,rank_review_status,rank_approved_at)
      VALUES($1,'Merge exercise','stdio','Echo an integer.',1000,64,'print(input())','AC',$2,now(),now(),'approved',now()) RETURNING id`,
      [problemId, JSON.stringify([{ input: '5', expected: '5' }])]);
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [problemId, versionId]);

    const runtime = new URL(database);
    runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    const origin = 'http://course-merge.test';
    server = await createApiApplication({ databaseUrl: runtime.href, logger: false, config: loadConfig({
      SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false',
    }) });
    await server.listen(0, '127.0.0.1');
    const host = (await server.getUrl()) + '/api/v1';
    const auth = {};
    const request = async (path, { name = 'teacher', method = 'GET', body, status = 200, csrf = true, session = true } = {}) => {
      const account = session ? auth[name] : null;
      const response = await fetch(host + path, { method, headers: {
        Origin: origin,
        ...(account ? { Cookie: account.cookie, ...(csrf ? { 'X-CSRF-Token': account.csrfToken } : {}) } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(data.error ?? {})}`);
      return { data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    for (const name of Object.keys(users)) {
      const response = await request('/auth/login', { method: 'POST', session: false, body: { username: name, password } });
      auth[name] = { cookie: response.cookie, csrfToken: response.data.csrfToken };
    }
    const post = async (path, body, options = {}) => (await request(path, { method: 'POST', body, ...options })).data;
    const get = async (path, options = {}) => (await request(path, options)).data;
    const patch = async (path, body, options = {}) => (await request(path, { method: 'PATCH', body, ...options })).data;
    let fixtureNumber = 0;
    const makeFixture = async ({ counts = [1, 1], rich = false, owner = 'teacher' } = {}) => {
      const n = ++fixtureNumber, courses = [], chapters = [];
      for (const [index, count] of counts.entries()) {
        const courseOwner = Array.isArray(owner) ? owner[index] : owner;
        const doc = {
          format: 'codemaster-learning-path', version: 1, title: `Topic ${n}.${index}`, description: 'Original topic description',
          category: 'ACSL', estimatedMinutes: 30, difficulty: 'intermediate',
          localizations: { en: { title: `Topic ${index}` }, zh: { title: `专题 ${index}` } },
          chapters: Array.from({ length: count }, (_, position) => ({
            title: `Lesson ${index}.${position}`, content: `Lesson ${index}.${position}: $10_2 = 2_{10}$.`,
            objective: 'Understand positional notation', checkpoint: 'Compute a lesson example', checkpointAnswer: 'Lesson-only answer',
            localizations: { zh: { title: `课时 ${index}.${position}`, content: '中文版正文。', checkpointAnswer: '课内例题答案。' } },
            problemIds: rich && position === 0 ? [problemId] : [],
            acslLinks: rich && position === 0 ? [{ paperSlug: content.slug, kind: 'question', questionId: 'q1' }, { paperSlug: content.slug, kind: 'written' }] : [],
          })),
        };
        const created = await post('/learning-paths/import', doc, { name: courseOwner, status: 201 });
        const detail = await get(`/learning-paths/${created.id}`, { name: courseOwner });
        courses.push(detail); chapters.push(...detail.chapters);
      }
      const sections = courses.map((course, index) => ({ key: `topic-${index}`, title: course.title,
        groupKey: index < 3 ? 'contest-1' : 'contest-2', groupTitle: index < 3 ? 'Contest 1' : 'Contest 2',
        localizations: { zh: { title: `专题 ${index}`, groupTitle: index < 3 ? '第一轮' : '第二轮' } } }));
      const body = { courses: courses.map((course, index) => ({ courseId: course.id, sectionKey: sections[index].key })),
        course: { title: 'ACSL Intermediate', description: 'Unified course', category: 'ACSL', estimatedMinutes: counts.reduce((sum, count) => sum + count * 30, 0),
          localizations: { en: { title: 'ACSL Intermediate' }, zh: { title: 'ACSL Intermediate 系统课程' } }, sections }, dryRun: true };
      return { courses, chapters, body, ids: courses.map(course => course.id), path: `/learning-paths/${courses[0].id}/merge` };
    };
    const snapshot = async fixture => ({
      courses: (await pool.query('SELECT * FROM learning_paths WHERE id=ANY($1::uuid[]) ORDER BY id', [fixture.ids])).rows,
      chapters: (await pool.query('SELECT * FROM learning_chapters WHERE id=ANY($1::uuid[]) ORDER BY id', [fixture.chapters.map(chapter => chapter.id)])).rows,
      resources: (await pool.query('SELECT * FROM learning_resources WHERE path_id=ANY($1::uuid[]) ORDER BY id', [fixture.ids])).rows,
      progress: (await pool.query('SELECT * FROM learning_progress ORDER BY identity_id,chapter_id')).rows,
      problems: (await pool.query('SELECT * FROM chapter_problems ORDER BY chapter_id,problem_id')).rows,
      grades: (await pool.query('SELECT * FROM acsl_paper_grades ORDER BY id')).rows,
      awards: (await pool.query('SELECT * FROM acsl_point_awards ORDER BY id')).rows,
      merges: (await pool.query('SELECT * FROM learning_course_merges ORDER BY id')).rows,
      audit: (await pool.query("SELECT * FROM audit_events WHERE action='learning.merge' ORDER BY id")).rows,
    });
    const examCounts = async () => (await pool.query(`SELECT
      (SELECT count(*)::int FROM acsl_drafts) drafts, (SELECT count(*)::int FROM acsl_paper_grades) grades,
      (SELECT count(*)::int FROM acsl_point_awards) awards, (SELECT count(*)::int FROM point_ledger) points,
      (SELECT count(*)::int FROM submissions) submissions`)).rows[0];

    await t.test('session, CSRF, role and owner checks protect preview and execution', async () => {
      const fixture = await makeFixture();
      const before = await snapshot(fixture);
      await post(fixture.path, fixture.body, { session: false, status: 401 });
      await post(fixture.path, fixture.body, { csrf: false, status: 403 });
      await post(fixture.path, fixture.body, { name: 'student', status: 403 });
      await post(fixture.path, fixture.body, { name: 'other-teacher', status: 404 });
      await post(fixture.path, { ...fixture.body, dryRun: false }, { status: 400 });
      const preview = await post(fixture.path, fixture.body);
      assert.match(preview.planHash, /^[a-f0-9]{64}$/);
      await post(fixture.path, { ...fixture.body, dryRun: false, expectedPlanHash: preview.planHash }, { csrf: false, status: 403 });
      assert.deepEqual(await snapshot(fixture), before);
    });

    await t.test('six topics retain 19 chapter identities, progress, translations, exercises and resources; retries are idempotent', async () => {
      const fixture = await makeFixture({ counts: [4, 3, 3, 3, 3, 3], rich: true });
      const [target, ...sources] = fixture.courses;
      for (const course of fixture.courses) await patch(`/learning-paths/${course.id}`, { accessScope: 'classes', classIds: [classId] });
      // Historical read records are fixture data; merging never requires clearing them.
      for (const [index, chapter] of fixture.chapters.entries()) {
        await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,$3)', [users.student.identityId, chapter.id, index % 2 === 0]);
      }
      await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)', [users.peer.identityId, fixture.chapters[1].id]);
      for (const course of fixture.courses) {
        await post('/learning-resources', { title: `${course.title} notes`, type: 'note', content: 'Course notes', scope: 'private', pathId: course.id }, { status: 201 });
        await post('/learning-resources', { title: `${course.title} chapter reference`, type: 'reference', content: 'Chapter resource', scope: 'private', pathId: course.id, chapterId: course.chapters[0].id }, { status: 201 });
      }
      const examPath = `/schools/${LEGACY_SCHOOL_ID}/acsl/${paper.id}`, revisions = {};
      for (const question of content.questions) {
        const saved = await patch(`${examPath}/questions/${question.id}/draft`, { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds }, { name: 'peer' });
        revisions[question.id] = saved.revision;
      }
      const historicalGrade = await post(examPath + '/submit', { versionId: paper.versionId, revisions }, { name: 'peer' });
      assert.equal(historicalGrade.score, content.questions.length);
      const before = await snapshot(fixture), countsBefore = await examCounts();
      assert.equal(before.grades.length, 1);
      const preview = await post(fixture.path, fixture.body);
      assert.equal(preview.courseCount, 6); assert.equal(preview.chapterCount, 19); assert.equal(preview.resourceCount, 12);
      assert.deepEqual(await snapshot(fixture), before, 'preview must be read-only');
      const delayed = await pool.connect();
      try {
        await delayed.query('BEGIN');
        assert.equal((await delayed.query('SELECT merged_into_id FROM learning_paths WHERE id=$1', [sources[0].id])).rows[0].merged_into_id, null);
        const execution = { ...fixture.body, dryRun: false, expectedPlanHash: preview.planHash };
        const receipt = await post(fixture.path, execution);
        assert.equal(receipt.merged, true); assert.equal(receipt.targetCourseId, target.id);
        assert.deepEqual(receipt.chapterIds, fixture.chapters.map(chapter => chapter.id));
        const after = await snapshot(fixture);
        assert.deepEqual(after.progress, before.progress);
        assert.deepEqual(after.problems, before.problems);
        assert.deepEqual(after.grades, before.grades);
        assert.deepEqual(after.awards, before.awards);
        for (const chapter of after.chapters) {
          const old = before.chapters.find(row => row.id === chapter.id);
          const { path_id, position, section_key, ...preserved } = chapter;
          const { path_id: oldPath, position: oldPosition, section_key: oldSection, ...oldPreserved } = old;
          assert.deepEqual(preserved, oldPreserved);
          assert.equal(path_id, target.id);
          assert.equal(section_key, fixture.body.courses.find(course => course.courseId === oldPath).sectionKey);
        }
        assert.deepEqual([...after.chapters].sort((a, b) => a.position - b.position).map(chapter => chapter.id), receipt.chapterIds);
        assert.deepEqual(after.resources, before.resources.map(resource => ({ ...resource, path_id: target.id })));
        const journal = after.merges.find(merge => merge.plan_hash === preview.planHash);
        assert.ok(journal); assert.equal(journal.actor_account_id, users.teacher.id);
        assert.equal(journal.snapshot.chapters.length, 19); assert.equal(journal.snapshot.resources.length, 12);
        assert.deepEqual(journal.receipt, receipt);
        const repeated = await post(fixture.path, execution);
        assert.deepEqual(repeated, { ...receipt, alreadyApplied: true });
        assert.deepEqual(await snapshot(fixture), after);
        await post(fixture.path, { ...execution, course: { ...execution.course, title: 'Different retry' } }, { status: 409 });
        // A writer which read the old parent before the merge cannot reattach later.
        await assert.rejects(delayed.query("INSERT INTO learning_resources(owner_account_id,type,title,path_id,scope) VALUES($1,'note','Delayed write',$2,'private')", [users.teacher.id, sources[0].id]), error => error.code === '23514');
        await delayed.query('ROLLBACK');
        await assert.rejects(pool.query("INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'Delayed chapter',0)", [sources[0].id]), error => error.code === '23514');
        assert.deepEqual(await examCounts(), countsBefore);
      } finally { await delayed.query('ROLLBACK'); delayed.release(); }

      await get(`/learning-paths/${sources[0].id}`, { name: 'student', status: 404 });
      await get(`/learning-paths/${sources[0].id}`, { name: 'other-teacher', status: 404 });
      for (const source of sources) {
        const alias = await get(`/learning-paths/${source.id}`);
        assert.equal(alias.id, target.id); assert.equal(alias.redirectedFromCourseId, source.id);
        assert.equal(alias.redirectedChapterId, source.chapters[0].id);
        assert.equal(alias.chapters.length, 19); assert.deepEqual(alias.sections, fixture.body.course.sections);
        assert.equal(alias.chapters.find(chapter => chapter.id === source.chapters[0].id).acslLinks[0].versionId, paper.versionId);
        noExamSecrets(alias);
      }
      const beforeRejectedWrites = await snapshot(fixture);
      for (const [suffix, method, body] of [['', 'PATCH', { title: 'Forbidden edit' }], ['/restore', 'POST', {}], ['/publish', 'POST', {}], ['/unpublish', 'POST', {}], ['/chapters', 'POST', { title: 'Forbidden chapter', content: 'Text' }], ['/python-exercises', 'POST', {}]]) {
        await request(`/learning-paths/${sources[0].id}${suffix}`, { method, body, status: [404, 409] });
      }
      await post('/learning-resources', { title: 'Cannot attach', type: 'note', content: 'Text', scope: 'private', pathId: sources[0].id }, { status: [404, 409] });
      assert.deepEqual(await snapshot(fixture), beforeRejectedWrites);
      const live = (await get('/learning-paths')).items;
      assert.ok(live.some(course => course.id === target.id)); assert.ok(sources.every(source => !live.some(course => course.id === source.id)));

      await post(`/learning-paths/${target.id}/publish`, {});
      for (const language of ['en', 'zh']) {
        const detail = await get(`/learning-paths/${sources[0].id}?language=${language}`, { name: 'student' });
        assert.equal(detail.id, target.id); assert.equal(detail.completedChapters, 10);
        assert.equal(detail.redirectedChapterId, sources[0].chapters[0].id); noExamSecrets(detail);
      }
      assert.equal((await get(`/learning-paths/${target.id}`, { name: 'peer' })).completedChapters, 1);
      await get(`/learning-paths/${sources[0].id}`, { name: 'outsider', status: 404 });
      await get(`/learning-paths/${target.id}`, { name: 'outsider', status: 404 });
      await post(`/chapters/${sources[0].chapters[0].id}/progress`, { completed: true }, { name: 'peer' });
      assert.equal((await get(`/learning-paths/${sources[0].id}`, { name: 'peer' })).completedChapters, 2);
      const links = (await get(`/schools/${LEGACY_SCHOOL_ID}/acsl/${paper.id}`, { name: 'student' })).learningLinks;
      assert.ok(links.some(link => link.chapterId === sources[0].chapters[0].id && link.courseId === target.id));
      await get(`${examPath}/questions/q1/explanation?versionId=${paper.versionId}`, { name: 'student', status: 403 });
      assert.equal((await get(examPath, { name: 'peer' })).gradeId, historicalGrade.gradeId);
      const exerciseRequest = { problemId, versionId, courseId: sources[0].id, chapterId: sources[0].chapters[0].id,
        kind: 'samples', language: 'python', code: 'print(input())', idempotencyKey: randomUUID() };
      await post('/submissions', exerciseRequest, { name: 'student', status: 201 });
      await post('/submissions', { ...exerciseRequest, idempotencyKey: randomUUID() }, { name: 'outsider', status: 404 });
      await patch(`/learning-paths/${target.id}`, { availableFrom: new Date(Date.now() + 3600000).toISOString() });
      await get(`/learning-paths/${sources[0].id}`, { name: 'student', status: 404 });
      await patch(`/learning-paths/${target.id}`, { availableFrom: null });
      await post(`/learning-paths/${target.id}/unpublish`, {});
      await get(`/learning-paths/${sources[0].id}`, { name: 'student', status: 404 });
      assert.equal((await get(`/learning-paths/${sources[0].id}`)).id, target.id);
    });

    await t.test('course, chapter and resource edits invalidate preview without partial mutation', async () => {
      const fixture = await makeFixture();
      const resource = await post('/learning-resources', { title: 'Stale plan resource', type: 'note', content: 'Before', scope: 'private', pathId: fixture.ids[1] }, { status: 201 });
      for (const edit of [
        () => patch(`/learning-paths/${fixture.ids[1]}`, { description: 'Changed after preview' }),
        () => patch(`/chapters/${fixture.chapters[1].id}`, { content: 'Changed lesson after preview' }),
        () => patch(`/learning-resources/${resource.id}`, { content: 'Changed resource after preview' }),
      ]) {
        const preview = await post(fixture.path, fixture.body);
        await edit();
        const edited = await snapshot(fixture);
        assert.equal((await post(fixture.path, { ...fixture.body, dryRun: false, expectedPlanHash: preview.planHash }, { status: 409 })).error.code, 'COURSE_MERGE_CONFLICT');
        assert.deepEqual(await snapshot(fixture), edited);
      }
    });

    await t.test('database failure after chapter moves rolls back every row and journal entry', async () => {
      const fixture = await makeFixture();
      await post('/learning-resources', { title: 'Rollback resource', type: 'note', content: 'Keep me', scope: 'private', pathId: fixture.ids[1] }, { status: 201 });
      const preview = await post(fixture.path, fixture.body), before = await snapshot(fixture);
      await pool.query(`CREATE FUNCTION reject_test_merge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.merged_into_id IS NOT NULL THEN RAISE EXCEPTION 'Injected merge failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER course_merge_test_failure BEFORE UPDATE OF merged_into_id ON learning_paths FOR EACH ROW EXECUTE FUNCTION reject_test_merge()`);
      try {
        await post(fixture.path, { ...fixture.body, dryRun: false, expectedPlanHash: preview.planHash }, { status: 500 });
        assert.deepEqual(await snapshot(fixture), before);
      } finally { await pool.query('DROP TRIGGER course_merge_test_failure ON learning_paths; DROP FUNCTION reject_test_merge()'); }
    });

    await t.test('owner, audience, history and external teaching activities cannot be silently merged', async group => {
      const cases = [
        ['different owner', async () => {}, { owner: ['teacher', 'other-teacher'] }],
        ['platform ownership', fixture => pool.query("UPDATE learning_paths SET owner_scope='platform' WHERE id=$1", [fixture.ids[1]])],
        ['access scope', fixture => patch(`/learning-paths/${fixture.ids[1]}`, { accessScope: 'classes', classIds: [classId] })],
        ['class set', async fixture => { for (const id of fixture.ids) await patch(`/learning-paths/${id}`, { accessScope: 'classes', classIds: [classId] }); await pool.query('DELETE FROM learning_path_classes WHERE path_id=$1', [fixture.ids[1]]); }],
        ['discovery', fixture => patch(`/learning-paths/${fixture.ids[1]}`, { listed: false })],
        ['language requirement', fixture => patch(`/learning-paths/${fixture.ids[1]}`, { requiredLanguage: 'python' })],
        ['currently published', fixture => post(`/learning-paths/${fixture.ids[1]}/publish`, {})],
        ['previously published', async fixture => { await post(`/learning-paths/${fixture.ids[1]}/publish`, {}); await post(`/learning-paths/${fixture.ids[1]}/unpublish`, {}); }],
        ['public snapshot history', fixture => pool.query(`INSERT INTO legacy_course_publication_versions(school_id,course_id,revision,source_version,title,description,access_scope,chapters)
          VALUES($1,$2,1,'historical-version','Historical snapshot','','school',$3)`, [LEGACY_SCHOOL_ID, fixture.ids[1], JSON.stringify([{ id: fixture.chapters[1].id, title: 'Old lesson', content: 'Old content' }])])],
        ['assignment history', fixture => pool.query(`INSERT INTO assignments(title,class_id,owner_account_id,due_at,course_path_id,archived_at)
          VALUES('Historical assignment',$1,$2,now()-interval '1 day',$3,now())`, [classId, users.teacher.id, fixture.ids[1]])],
        ['timed practice history', fixture => pool.query(`INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes,course_path_id,state,archived_at)
          VALUES('Historical practice',$1,$2,now()-interval '2 days',now()-interval '1 day',60,$3,'Archived',now())`, [classId, users.teacher.id, fixture.ids[1]])],
        ['generated practice bundle', fixture => pool.query('UPDATE learning_paths SET practice_bundle=$2 WHERE id=$1', [fixture.ids[1], JSON.stringify([{ problemId, versionId, chapterId: fixture.chapters[1].id }])])],
        ['inconsistent resource parent', fixture => pool.query("INSERT INTO learning_resources(owner_account_id,type,title,path_id,chapter_id,scope) VALUES($1,'note','Mismatched parent',$2,$3,'private')", [users.teacher.id, fixture.ids[0], fixture.chapters[1].id])],
      ];
      for (const [label, mutate, options] of cases) await group.test(label, async () => {
        const fixture = await makeFixture(options);
        await mutate(fixture);
        const before = await snapshot(fixture);
        const rejected = await post(fixture.path, fixture.body, { status: label === 'different owner' ? [404, 409] : 409 });
        assert.ok(['COURSE_MERGE_CONFLICT', ...(label === 'different owner' ? ['NOT_FOUND'] : [])].includes(rejected.error.code));
        assert.deepEqual(await snapshot(fixture), before);
      });
    });
  } finally {
    if (server) await server.close();
    await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await manager.end();
  }
});
