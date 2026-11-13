import assert from 'node:assert/strict';
import test from 'node:test';
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
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';

const migration = '105_acsl_platform_course.sql';
const targetId = 'ff018311-56ec-4aa2-ba66-04e7925c18a8';
const secret = 'FORMAL_EXAM_SOLUTION_MUST_NOT_REACH_DIRECTORY';
function noExamSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['correctOptionIds', 'explanation', 'explanationDiagrams', 'referenceCode', 'tests', 'solution', 'correct'].includes(key), `formal exam field leaked: ${key}`);
    noExamSecrets(child);
  }
  assert.ok(!JSON.stringify(value).includes(secret), 'formal explanation value leaked');
}

test('ACSL platform course migration and directory enforce ownership without losing student records', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 180000,
}, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(base.pathname, '/campus_qa');
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const schema = `acsl_platform_${randomBytes(6).toString('hex')}`;
  const manager = createPool(base.href);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href);
  let server;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`);
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    await pool.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration]);
    await migrate(pool);
    const password = randomBytes(24).toString('base64url'), passwordHash = await hashPassword(password);
    await bootstrap(pool, { name: 'Fixture legacy administrator', number: 'ADMIN', username: 'legacy-admin', password });
    const actors = {};
    actors['legacy-admin'] = (await pool.query("SELECT id,identity_id AS \"identityId\" FROM accounts WHERE username='legacy-admin'")).rows[0];
    for (const name of ['legacy-owner', 'legacy-teacher', 'legacy-student', 'legacy-peer', 'platform', 'alpha-admin', 'alpha-teacher', 'alpha-student', 'beta-admin', 'beta-student', 'outsider']) {
      const role = name === 'legacy-owner' || name === 'legacy-teacher' ? 'teacher' : 'student';
      const identityId = randomUUID();
      await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identityId, role, name]);
      actors[name] = { ...(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, name, passwordHash])).rows[0], identityId };
      if (name.startsWith('legacy-')) {
        await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [actors[name].id, role]);
        await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [actors[name].id]);
      } else {
        await pool.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1', [actors[name].id]);
      }
    }
    await provisionPlatformAdministrator(pool, { username: 'platform' });
    assert.equal((await pool.query('SELECT 1 FROM legacy_school_account_ownership WHERE account_id=$1', [actors.platform.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM account_roles WHERE account_id=$1', [actors.platform.id])).rowCount, 0);
    const alpha = await provisionSchool(pool, { slug: 'acsl-platform-alpha', name: 'Fixture Alpha', adminUsername: 'alpha-admin' });
    const beta = await provisionSchool(pool, { slug: 'acsl-platform-beta', name: 'Fixture Beta', adminUsername: 'beta-admin' });
    for (const [name, schoolId, role] of [['alpha-teacher', alpha.id, 'teacher'], ['alpha-student', alpha.id, 'student'], ['beta-student', beta.id, 'student']]) {
      await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [schoolId, actors[name].id, role]);
      await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4)', [schoolId, role, name, actors[name].id]);
    }
    const sample = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    for (const q of sample.questions) q.explanation = { en: `${secret} ${q.id}`, zh: `${secret} 中文 ${q.id}` };
    const legacyPaper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: actors['legacy-owner'].id, content: sample });
    const alphaPaper = await importAcslPaper(pool, { schoolId: alpha.id, ownerAccountId: actors['alpha-admin'].id, content: sample });
    const betaPaper = await importAcslPaper(pool, { schoolId: beta.id, ownerAccountId: actors['beta-admin'].id, content: sample });
    const sections = [{ key: 'one', title: 'Topic one', groupKey: 'contest-1', groupTitle: 'Contest 1' }, { key: 'two', title: 'Topic two', groupKey: 'contest-2', groupTitle: 'Contest 2' }];
    await pool.query("INSERT INTO learning_paths(id,owner_account_id,title,category,sections) VALUES($1,$2,'ACSL Intermediate Course','ACSL',$3)", [targetId, actors['legacy-owner'].id, JSON.stringify(sections)]);
    const makeFields = n => ({ title: `Lesson ${n}`, content: `Original lesson ${n}: $2^3=8$.`, objective: 'Follow each state', checkpoint: 'An original lesson exercise', checkpointAnswer: 'ORIGINAL_LESSON_ANSWER_ALLOWED' });
    const chapterIds = [];
    for (let n = 0; n < 39; n++) {
      const id = randomUUID(), fields = makeFields(n), localizations = { en: fields, zh: { title: `第 ${n} 课`, content: `原创第 ${n} 课：$2^3=8$。`, objective: '逐步追踪状态', checkpoint: '原创课内自测', checkpointAnswer: '原创课内参考答案' } };
      const acslLinks = ['q1', 'q2', 'q3'].map(questionId => ({ paperSlug: sample.slug, kind: 'question', questionId, versionId: legacyPaper.versionId }));
      if (n < 11) acslLinks.push({ paperSlug: sample.slug, kind: 'written', versionId: legacyPaper.versionId });
      await pool.query('INSERT INTO learning_chapters(id,path_id,title,content,objective,checkpoint,checkpoint_answer,position,localizations,acsl_links,section_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, targetId, fields.title, fields.content, fields.objective, fields.checkpoint, fields.checkpointAnswer, n, localizations, JSON.stringify(acslLinks), n < 20 ? 'one' : 'two']);
      chapterIds.push(id);
    }
    const aliasId = randomUUID();
    await pool.query("INSERT INTO learning_paths(id,owner_account_id,title,archived_at,merged_into_id,merged_first_chapter_id) VALUES($1,$2,'Prior topic',now(),$3,$4)", [aliasId, actors['legacy-owner'].id, targetId, chapterIds[0]]);
    const unrelated = (await pool.query("INSERT INTO learning_paths(owner_account_id,title) VALUES($1,'ACSL teacher-authored unrelated course') RETURNING *", [actors['legacy-owner'].id])).rows[0];
    await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true),($1,$3,false),($4,$3,true)', [actors['legacy-student'].identityId, chapterIds[0], chapterIds[1], actors['legacy-peer'].identityId]);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const runtime = new URL(scoped); runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    const origin = 'http://acsl-platform.test';
    server = await createApiApplication({ databaseUrl: runtime.href, logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const endpoint = (await server.getUrl()) + '/api/v1', auth = {};
    const request = async (path, { name = 'platform', method = 'GET', body, status = 200, csrf = true, session = true } = {}) => {
      const actor = session ? auth[name] : null;
      const response = await fetch(endpoint + path, { method, headers: { Origin: origin, ...(actor ? { Cookie: actor.cookie, ...(csrf ? { 'X-CSRF-Token': actor.csrf } : {}) } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json(); assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path} as ${name}: ${response.status} ${JSON.stringify(data.error ?? {})}`);
      return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    for (const name of Object.keys(actors)) { const result = await request('/auth/login', { session: false, method: 'POST', body: { username: name, password } }); auth[name] = { cookie: result.cookie, csrf: result.data.csrfToken }; }
    const get = async (path, name = 'platform', status = 200) => (await request(path, { name, status })).data;
    const post = async (path, body, name = 'platform', status = 200) => (await request(path, { name, method: 'POST', body, status })).data;
    const patch = async (path, body, name = 'platform', status = 200) => (await request(path, { name, method: 'PATCH', body, status })).data;
    const paperPath = `/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`;
    const revisions = {};
    for (const q of sample.questions) {
      const saved = await patch(`${paperPath}/questions/${q.id}/draft`, { versionId: legacyPaper.versionId, expectedRevision: 0, selectedOptionIds: q.correctOptionIds }, 'legacy-student');
      revisions[q.id] = saved.revision;
    }
    const grade = await post(paperPath + '/submit', { versionId: legacyPaper.versionId, revisions }, 'legacy-student');
    await patch(paperPath + '/questions/q1/draft', { versionId: legacyPaper.versionId, expectedRevision: 0, selectedOptionIds: sample.questions[0].correctOptionIds }, 'legacy-peer');
    const studentRecords = async () => {
      const out = {};
      for (const [table, order] of [['learning_progress', 'identity_id,chapter_id'], ['acsl_drafts', 'school_id,paper_id,account_id,question_id'], ['acsl_paper_grades', 'id'], ['acsl_point_awards', 'id'], ['point_ledger', 'id'], ['submissions', 'id']]) out[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
      return out;
    };
    const beforeRecords = await studentRecords();
    assert.equal(beforeRecords.learning_progress.length, 3);
    assert.equal(beforeRecords.acsl_paper_grades.length, 1, 'protection assertions include a real historical grade');
    assert.equal(beforeRecords.acsl_drafts.length, sample.questions.length + 1, 'snapshot includes submitted and unfinished drafts');
    const beforePath = (await pool.query('SELECT * FROM learning_paths WHERE id=$1', [targetId])).rows[0];
    const beforeChapters = (await pool.query('SELECT * FROM learning_chapters WHERE path_id=$1 ORDER BY id', [targetId])).rows;
    const beforeAlias = (await pool.query('SELECT * FROM learning_paths WHERE id=$1', [aliasId])).rows[0];

    await t.test('guarded one-time migration preserves canonical IDs, historical owner, aliases, contents and student rows', async () => {
      // A malformed target must fail before it is promoted; the correction is fixture-only.
      await pool.query('UPDATE learning_chapters SET archived_at=now() WHERE id=$1', [chapterIds[38]]);
      await pool.query('DELETE FROM schema_migrations WHERE name=$1', [migration]);
      await assert.rejects(migrate(pool));
      assert.equal((await pool.query('SELECT owner_scope FROM learning_paths WHERE id=$1', [targetId])).rows[0].owner_scope, 'school');
      await pool.query('UPDATE learning_chapters SET archived_at=NULL WHERE id=$1', [chapterIds[38]]);
      await migrate(pool);
      const after = (await pool.query('SELECT * FROM learning_paths WHERE id=$1', [targetId])).rows[0];
      assert.equal(after.owner_scope, 'platform'); assert.equal(after.platform_access_scope, 'schools'); assert.deepEqual(after.platform_school_ids, [LEGACY_SCHOOL_ID]);
      for (const key of Object.keys(beforePath).filter(key => !['owner_scope', 'platform_access_scope', 'platform_school_ids', 'platform_revision', 'updated_at'].includes(key))) assert.deepEqual(after[key], beforePath[key], key);
      assert.ok(after.updated_at > beforePath.updated_at, 'ownership transfer invalidates stale source versions');
      assert.deepEqual((await pool.query('SELECT * FROM learning_chapters WHERE path_id=$1 ORDER BY id', [targetId])).rows, beforeChapters);
      assert.deepEqual((await pool.query('SELECT * FROM learning_paths WHERE id=$1', [aliasId])).rows[0], beforeAlias);
      assert.deepEqual((await pool.query('SELECT * FROM learning_paths WHERE id=$1', [unrelated.id])).rows[0], unrelated);
      assert.deepEqual(await studentRecords(), beforeRecords);
      await migrate(pool); assert.deepEqual((await pool.query('SELECT * FROM learning_paths WHERE id=$1', [targetId])).rows[0], after);
      assert.ok(!(await get(`/schools/${LEGACY_SCHOOL_ID}/acsl`, 'legacy-student')).learningCourses.some(c => c.courseId === targetId), 'unpublished course is not advertised in ACSL');
    });

    let course;
    const reload = async () => course = await get('/platform/courses/' + targetId);
    const cas = () => ({ expectedRevision: course.revision, sourceVersion: course.sourceVersion });
    const change = async body => course = await patch('/platform/courses/' + targetId, { ...cas(), ...body });
    const action = async name => course = await post(`/platform/courses/${targetId}/${name}`, cas());

    await t.test('true platform administrator edits and publishes complete bilingual lessons without acquiring school access', async () => {
      await reload();
      const picker = await get('/platform/courses/acsl-links'); noExamSecrets(picker);
      assert.ok(picker.items.some(item => item.paperId === legacyPaper.id && item.versionId === legacyPaper.versionId));
      await get(`/schools/${LEGACY_SCHOOL_ID}/acsl`, 'platform', 404);
      const first = course.chapters.find(c => c.id === chapterIds[0]);
      assert.equal(first.objective, makeFields(0).objective); assert.equal(first.checkpointAnswer, makeFields(0).checkpointAnswer); assert.equal(first.acslLinks.length, 4);
      const fields = { title: 'Updated platform lesson', content: 'Updated original explanation $3^2=9$.', objective: 'Explain each transition', checkpoint: 'Original question revised', checkpointAnswer: 'ORIGINAL_LESSON_ANSWER_REVISED' };
      const localizations = { en: fields, zh: { title: '更新的课时', content: '更新讲解 $3^2=9$。', objective: '解释每次转移', checkpoint: '更新原创问题', checkpointAnswer: '更新原创答案' } };
      await change({ chapters: course.chapters.map(c => c.id === first.id ? { ...c, ...fields, localizations } : c) });
      await reload(); const edited = course.chapters.find(c => c.id === first.id);
      for (const [key, value] of Object.entries(fields)) assert.equal(edited[key], value, key);
      assert.deepEqual(edited.localizations, localizations); assert.deepEqual(edited.acslLinks, first.acslLinks);
      await change({ chapters: course.chapters.map(c => ({ id: c.id, title: c.title })) });
      await reload(); assert.deepEqual(course.chapters.find(c => c.id === first.id), edited, 'omitted fields preserve existing lesson');
      await action('publish');
      const reader = await get('/practice/courses/' + targetId, 'legacy-peer');
      assert.equal(reader.chapters.length, 39); const lesson = reader.chapters.find(c => c.id === first.id);
      assert.equal(lesson.body, fields.content); for (const key of ['objective', 'checkpoint', 'checkpointAnswer', 'localizations']) assert.deepEqual(lesson[key], edited[key]);
      noExamSecrets(reader); noExamSecrets(await get('/practice/catalog', 'legacy-peer'));
      assert.equal(lesson.acslLinks[0].status, 'draft'); assert.equal(lesson.acslLinks[0].completed, false);
      assert.deepEqual(await studentRecords(), beforeRecords, 'maintenance and reading do not alter historical learner records');
      await get(`/schools/${LEGACY_SCHOOL_ID}/acsl`, 'platform', 404);
    });

    await t.test('former owner and both school administrators cannot edit or publish through old or platform routes', async () => {
      const before = (await pool.query('SELECT * FROM learning_paths WHERE id=$1', [targetId])).rows[0];
      const chapters = (await pool.query('SELECT * FROM learning_chapters WHERE path_id=$1 ORDER BY id', [targetId])).rows;
      const auditCount = (await pool.query('SELECT count(*)::int n FROM platform_audit_events')).rows[0].n;
      for (const name of ['legacy-owner', 'legacy-teacher', 'legacy-admin', 'alpha-admin', 'alpha-teacher', 'alpha-student', 'outsider']) {
        assert.deepEqual((await get('/platform/courses', name)).items, []); await get('/platform/courses/acsl-links', name, 403);
        await patch('/platform/courses/' + targetId, { ...cas(), title: 'Unauthorized replacement' }, name, 403);
        for (const operation of ['publish', 'unpublish', 'archive', 'restore']) await post(`/platform/courses/${targetId}/${operation}`, cas(), name, 403);
        for (const operation of ['publish', 'unpublish', 'restore']) await post(`/learning-paths/${targetId}/${operation}`, {}, name, 403);
        await patch('/learning-paths/' + targetId, { title: 'Unauthorized legacy replacement' }, name, 403);
        await post(`/learning-paths/${targetId}/chapters`, { title: 'Injected', content: 'Injected' }, name, 403);
        await patch('/chapters/' + chapterIds[0], { content: 'Unauthorized chapter replacement' }, name, 403);
        await request('/chapters/' + chapterIds[0], { name, method: 'DELETE', status: 403 });
      }
      await request(`/platform/courses/${targetId}`, { method: 'PATCH', body: { ...cas(), title: 'No CSRF' }, csrf: false, status: 403 });
      await request(`/platform/courses/${targetId}`, { session: false, status: 401 });
      assert.deepEqual((await pool.query('SELECT * FROM learning_paths WHERE id=$1', [targetId])).rows[0], before);
      assert.deepEqual((await pool.query('SELECT * FROM learning_chapters WHERE path_id=$1 ORDER BY id', [targetId])).rows, chapters);
      assert.equal((await pool.query('SELECT count(*)::int n FROM platform_audit_events')).rows[0].n, auditCount);
      assert.deepEqual(await studentRecords(), beforeRecords);
    });

    await t.test('stale platform saves and unavailable references fail without partial changes', async () => {
      const stale = cas(); await change({ description: 'Platform-owned ACSL teaching content' });
      const snapshot = async () => ({ path: (await pool.query('SELECT * FROM learning_paths WHERE id=$1', [targetId])).rows[0], chapters: (await pool.query('SELECT * FROM learning_chapters WHERE path_id=$1 ORDER BY id', [targetId])).rows, audits: (await pool.query('SELECT * FROM platform_audit_events ORDER BY id')).rows });
      const before = await snapshot();
      await patch('/platform/courses/' + targetId, { ...stale, title: 'Stale' }, 'platform', 409);
      await patch('/platform/courses/' + targetId, { ...cas(), title: 'Partial change forbidden', chapters: [{ id: randomUUID(), title: 'Foreign', content: 'Foreign' }] }, 'platform', 400);
      await patch('/platform/courses/' + targetId, { ...cas(), title: 'Invalid link', chapters: course.chapters.map((c, index) => index ? c : { ...c, acslLinks: [{ paperSlug: sample.slug, kind: 'question', questionId: 'q1', versionId: randomUUID() }] }) }, 'platform', 409);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('published audience and school context control discovery and referenced exercise access', async () => {
      for (const name of ['alpha-student', 'beta-student', 'outsider']) {
        assert.ok(!(await get('/practice/catalog', name)).courses.some(c => c.id === targetId));
        await get('/practice/courses/' + targetId, name, 404);
      }
      const authorized = await get('/practice/courses/' + targetId, 'legacy-student');
      assert.equal(authorized.completedChapters, 1); assert.equal(authorized.chapters[0].acslLinks[0].completed, true); noExamSecrets(authorized);
      const old = await get(`/learning-paths/${aliasId}`, 'legacy-student'); assert.equal(old.id, targetId); assert.equal(old.chapters[0].id, chapterIds[0]); assert.equal(old.completedChapters, 1);
      await action('unpublish'); await get('/practice/courses/' + targetId, 'legacy-student', 404); await get('/learning-paths/' + aliasId, 'legacy-student', 404);
      await action('publish');
      // Opening the teaching material to Alpha must not confer access to legacy-school papers.
      await change({ audienceScope: 'schools', schoolIds: [LEGACY_SCHOOL_ID, alpha.id] });
      const withoutContext = await get('/practice/courses/' + targetId, 'alpha-student');
      assert.ok(withoutContext.chapters[0].acslLinks.every(link => !link.available && !link.href && !link.paperId)); noExamSecrets(withoutContext);
      const withContext = await get(`/practice/courses/${targetId}?schoolId=${alpha.id}`, 'alpha-student'); noExamSecrets(withContext);
      for (const link of withContext.chapters[0].acslLinks) {
        if (link.available) { assert.equal(link.paperId, alphaPaper.id); assert.match(link.href, new RegExp(alpha.id)); assert.notEqual(link.paperId, legacyPaper.id); }
        else assert.ok(!link.href && !link.paperId, 'different pinned version cannot acquire a working link');
      }
      await get(`/practice/courses/${targetId}?schoolId=${beta.id}`, 'alpha-student', 404);
      await get(`/practice/courses/${targetId}?schoolId=${LEGACY_SCHOOL_ID}`, 'alpha-student', 404);
      await get(`/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`, 'alpha-student', 404);
      await get(`/schools/${beta.id}/acsl/${betaPaper.id}`, 'alpha-student', 404);
      assert.deepEqual(await studentRecords(), beforeRecords);
      assert.equal((await get(paperPath, 'legacy-student')).gradeId, grade.gradeId);
    });

    await t.test('ACSL directory cards use the current learner and hide unpublished, excluded and different-version courses', async () => {
      const directory = async name => get(`/schools/${LEGACY_SCHOOL_ID}/acsl`, name);
      const graded = await directory('legacy-student'), drafting = await directory('legacy-peer');
      noExamSecrets(graded); noExamSecrets(drafting);
      const card = graded.learningCourses.find(c => c.courseId === targetId), peerCard = drafting.learningCourses.find(c => c.courseId === targetId);
      assert.ok(card); assert.equal(card.ownerScope, 'platform'); assert.equal(card.chapterCount, 39); assert.equal(card.completedChapters, 1);
      assert.equal(card.totalExercises, 128); assert.equal(card.completedExercises, 128);
      assert.equal(peerCard.completedChapters, 1); assert.equal(peerCard.completedExercises, 0, 'a correct draft is not graded completion');
      assert.equal(card.href, `/student/learning-paths/${targetId}/chapters/${chapterIds[1]}`, 'continue at the first unread chapter');
      assert.equal(peerCard.href, `/student/learning-paths/${targetId}/chapters/${chapterIds[0]}`, 'another learner has a different next chapter');
      const peerPaper = await get(paperPath, 'legacy-peer'); noExamSecrets(peerPaper);
      assert.ok(peerPaper.learningLinks.some(link => link.courseId === targetId && link.chapterId === chapterIds[0]));
      assert.notEqual(alphaPaper.versionId, legacyPaper.versionId);
      assert.ok(!(await get(`/schools/${alpha.id}/acsl`, 'alpha-student')).learningCourses.some(c => c.courseId === targetId), 'same slug with different pinned version does not map automatically');
      await action('unpublish'); assert.ok(!(await directory('legacy-student')).learningCourses.some(c => c.courseId === targetId));
      await action('publish');
      await change({ audienceScope: 'schools', schoolIds: [alpha.id] });
      assert.ok(!(await directory('legacy-student')).learningCourses.some(c => c.courseId === targetId), 'paper permission does not override course audience');
      await change({ audienceScope: 'schools', schoolIds: [LEGACY_SCHOOL_ID, alpha.id] });
      assert.ok((await directory('legacy-student')).learningCourses.some(c => c.courseId === targetId));
      assert.deepEqual(await studentRecords(), beforeRecords);
    });

    await t.test('read progress uses the same stable chapter and cannot mutate another learner or an unpublished course', async () => {
      const beforePeer = (await pool.query('SELECT * FROM learning_progress WHERE identity_id=$1 ORDER BY chapter_id', [actors['legacy-peer'].identityId])).rows;
      await post(`/practice/courses/${targetId}/chapters/${chapterIds[2]}/read`, { expectedRevision: course.revision, read: true }, 'legacy-student');
      assert.equal((await get('/learning-paths/' + targetId, 'legacy-student')).completedChapters, 2);
      assert.equal((await get('/practice/courses/' + targetId, 'legacy-peer')).completedChapters, 1);
      assert.deepEqual((await pool.query('SELECT * FROM learning_progress WHERE identity_id=$1 ORDER BY chapter_id', [actors['legacy-peer'].identityId])).rows, beforePeer);
      await action('archive');
      await post(`/practice/courses/${targetId}/chapters/${chapterIds[3]}/read`, { expectedRevision: course.revision, read: true }, 'legacy-student', 404);
      await action('restore'); assert.equal((await get('/practice/courses/' + targetId, 'legacy-student')).completedChapters, 2);
      const after = await studentRecords(); delete after.learning_progress; const before = { ...beforeRecords }; delete before.learning_progress; assert.deepEqual(after, before);
    });
  } finally {
    if (server) await server.close();
    await pool.end(); await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
