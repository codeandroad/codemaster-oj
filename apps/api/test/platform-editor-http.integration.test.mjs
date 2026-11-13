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
import { processOne } from '../../../packages/domain/worker.mjs';

test('the complete platform problem editor uses scoped grants without publication or private-resource bypasses', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 90000,
}, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(base.pathname, '/campus_qa'); assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
  const manager = createPool(base.href), schema = 'platform_editor_' + randomBytes(6).toString('hex');
  await manager.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href); let app, worker;
  const password = randomBytes(24).toString('base64url'), origin = 'http://platform-editor.test';
  try {
    await migrate(pool);
    await bootstrap(pool, { name: 'Original school admin', number: 'ADMIN', username: 'legacy-admin', password });
    const actors = { 'legacy-admin': (await pool.query("SELECT id,identity_id AS \"identityId\" FROM accounts WHERE username='legacy-admin'")).rows[0] };
    const hash = await hashPassword(password);
    for (const name of ['platform', 'school-admin', 'teacher', 'other-teacher', 'student', 'legacy-editor']) {
      const identityId = randomUUID(), legacy = name === 'legacy-editor';
      await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identityId, legacy ? 'teacher' : 'personal', name]);
      actors[name] = { identityId, ...(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, name, hash])).rows[0] };
      if (legacy) {
        await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'teacher')", [actors[name].id]);
        await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [actors[name].id]);
      }
    }
    await provisionPlatformAdministrator(pool, { username: 'platform' });
    const alpha = await provisionSchool(pool, { slug: 'editor-alpha', name: 'Editor Alpha', adminUsername: 'school-admin' });
    const beta = await provisionSchool(pool, { slug: 'editor-beta', name: 'Editor Beta', adminUsername: 'other-teacher' });
    for (const school of [alpha, beta]) await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'teacher')", [school.id, actors.teacher.id]);
    await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')", [alpha.id, actors.student.id]);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const runtime = new URL(scoped); runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    const workerUrl = new URL(scoped); workerUrl.searchParams.set('options', `-crole=campus_worker -csearch_path=${schema}`);
    worker = createPool(workerUrl.href);
    app = await createApiApplication({ databaseUrl: runtime.href, logger: false,
      config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await app.listen(0, '127.0.0.1'); const endpoint = (await app.getUrl()) + '/api/v1', sessions = {};
    const request = async (path, { name = 'platform', method = 'GET', body, status = 200, csrf = true } = {}) => {
      const session = sessions[name];
      const response = await fetch(endpoint + path, { method, headers: { Origin: origin,
        ...(session ? { Cookie: session.cookie, ...(csrf && { 'X-CSRF-Token': session.csrfToken }) } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.ok([status].flat().includes(response.status), `${method} ${path} as ${name}: ${response.status} ${JSON.stringify(data.error ?? data)}`);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const get = async (path, name = 'platform', status = 200) => (await request(path, { name, status })).data;
    const post = async (path, body, name = 'platform', status = 200) => (await request(path, { name, body, method: 'POST', status })).data;
    const patch = async (path, body, name = 'platform', status = 200) => (await request(path, { name, body, method: 'PATCH', status })).data;
    for (const name of Object.keys(actors)) {
      const login = await request('/auth/login', { name, method: 'POST', body: { username: name, password } });
      sessions[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken };
    }
    const source = '/platform/source-problems';
    const input = { title: 'Platform complete editor fixture', statement: 'Read a value and print it.', mode: 'stdio', comparator: 'tokens',
      referenceCode: 'print(input())', referenceLanguage: 'python', starterCode: '# Read input',
      starterCodes: { python: '# Python starter', cpp: '// C++ starter', javascript: '// JS starter' },
      samples: [{ name: 'Visible sample', input: '7', expected: '7', enabled: true }, { name: 'Disabled sample', input: '8', expected: '8', enabled: false }],
      tests: [{ name: 'Private case', input: 'PRIVATE_PLATFORM_CASE', expected: 'PRIVATE_PLATFORM_CASE', weight: 100, enabled: true }],
      timeLimitMs: 1000, memoryLimitMb: 128, source: 'Fixture source', tags: ['Python', 'Input'],
      objective: 'Understand input', inputDescription: 'One value.', outputDescription: 'The same value.', difficulty: 'easy',
      editorial: 'PRIVATE_EDITORIAL', hints: ['Read the line.'], hintPolicy: 'afterAC' };
    let problem, other, latest, content, grantPath;
    const grant = (name, schoolId = alpha.id) => ({ accountId: actors[name].id, schoolId });

    await t.test('only a platform administrator creates sources and the full school-editor data round-trips', async () => {
      for (const name of ['school-admin', 'teacher', 'student', 'legacy-admin']) await post(source, input, name, 403);
      await request(source, { body: input, method: 'POST', csrf: false, status: 403 });
      problem = await post(source, input, 'platform', 201); latest = problem;
      other = await post(source, { title: 'Unrelated private source', mode: 'stdio', statement: 'OTHER_PRIVATE_STATEMENT', saveDraft: true }, 'platform', 201);
      grantPath = `/platform/content-editors/problem/${problem.id}`;
      for (const key of ['title', 'statement', 'mode', 'referenceCode', 'referenceLanguage', 'starterCode', 'starterCodes', 'timeLimitMs', 'memoryLimitMb', 'source', 'tags', 'objective', 'inputDescription', 'outputDescription', 'difficulty', 'editorial', 'hints']) assert.deepEqual(problem[key], input[key], key);
      assert.equal(problem.samples[1].enabled, false); assert.equal(problem.tests[0].input, 'PRIVATE_PLATFORM_CASE');
      assert.equal((await pool.query('SELECT owner_scope FROM problems WHERE id=$1', [problem.id])).rows[0].owner_scope, 'platform');
      assert.equal(problem.canPublish, false); assert.equal(problem.canManage, true);
      for (const name of ['school-admin', 'teacher', 'other-teacher', 'student', 'legacy-admin']) await get(`${source}/${problem.id}`, name, 403);
    });
    await t.test('grants appear only in the selected school management scope and remain specific to each item', async () => {
      await post(grantPath, grant('student'), 'platform', 400);
      await post(grantPath, grant('teacher')); await post(grantPath, grant('school-admin'));
      await post(grantPath, grant('legacy-editor', LEGACY_SCHOOL_ID));
      for (const name of ['teacher', 'school-admin']) {
        const listing = await get(`${source}?schoolId=${alpha.id}`, name);
        assert.deepEqual(listing.items.map(p => p.id), [problem.id]); assert.equal(listing.canManage, false);
        assert.equal(listing.items[0].title, input.title);
        assert.equal((await get(`${source}/${problem.id}`, name)).canPublish, false);
        await get(`${source}/${other.id}`, name, 403);
      }
      assert.deepEqual((await get(`${source}?schoolId=${beta.id}`, 'teacher')).items, []);
      assert.deepEqual((await get(`${source}?schoolId=${beta.id}`, 'other-teacher')).items, []);
      assert.deepEqual((await get(`${source}?schoolId=${LEGACY_SCHOOL_ID}`, 'legacy-editor')).items.map(p => p.id), [problem.id]);
      await get(`${source}/${problem.id}?versionId=${other.versionId}`, 'teacher', 404);
      await post(grantPath, grant('other-teacher', beta.id), 'teacher', 403);
    });
    await t.test('authorized teachers save complete new versions with CAS, validate, but cannot publish', async () => {
      const original = await get(`${source}/${problem.id}`, 'teacher');
      const changed = { ...input, title: 'Edited platform source', expectedVersionId: original.versionId };
      latest = await post(`${source}/${problem.id}/versions`, changed, 'teacher', 201);
      assert.notEqual(latest.versionId, original.versionId); assert.equal(latest.tests[0].input, input.tests[0].input);
      await post(`${source}/${problem.id}/versions`, { ...changed, title: 'Stale edit' }, 'school-admin', 409);
      await post(`${source}/${problem.id}/validate`, { versionId: other.versionId }, 'teacher', 404);
      await post(`${source}/${problem.id}/validate`, { versionId: latest.versionId }, 'student', 403);
      const validation = await post(`${source}/${problem.id}/validate`, { versionId: latest.versionId }, 'teacher');
      assert.equal(validation.versionId, latest.versionId);
      await post(`${source}/${problem.id}/publish`, { expectedVersionId: latest.versionId }, 'teacher', 403);
      await post(`${source}/${problem.id}/publish`, { expectedVersionId: latest.versionId }, 'platform', 409);
      const judge = { environmentVersion: 'platform-editor-fixture', judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'platform-editor-fixture' }) };
      for (let count = 0; count < 5 && await processOne({ pool: worker, judge, logger: {} }); count++) { /* Drain only this isolated fixture's validation tasks. */ }
      const checked = await get(`${source}/${problem.id}`, 'teacher'); assert.equal(checked.validationStatus, 'AC');
      latest = await post(`${source}/${problem.id}/publish`, { expectedVersionId: checked.versionId });
      assert.equal(latest.published, true);
      assert.equal((await pool.query('SELECT version_id FROM chapter_problems WHERE problem_id=$1', [problem.id])).rowCount, 0);
      for (const path of [`/problems/${problem.id}/versions`, `/problems/${problem.id}/publish`]) await post(path, { ...changed, versionId: latest.versionId }, 'legacy-editor', 403);
    });
    await t.test('the shared tutorial editor is available to grantees, uses revisions, and cannot read another source', async () => {
      const path = `${source}/${problem.id}/tutorial`, current = await get(path, 'teacher');
      assert.equal(current.mode, 'course');
      const changed = { mode: 'custom', body: '## Shared tutorial\n\nAn authorized lesson.', expectedRevision: current.revision };
      const saved = await patch(path, changed, 'teacher'); assert.equal(saved.body, changed.body); assert.equal(saved.revision, current.revision + 1);
      await patch(path, { ...changed, body: 'Outdated overwrite' }, 'school-admin', 409);
      await get(`${source}/${other.id}/tutorial`, 'teacher', 403);
      await patch(path, { ...changed, expectedRevision: saved.revision }, 'other-teacher', 403);
      await request(path, { method: 'PATCH', body: { ...changed, expectedRevision: saved.revision }, name: 'teacher', csrf: false, status: 403 });
    });
    await t.test('complete solution drafts are target-bound and delegates cannot publish through either API family', async () => {
      const path = `${source}/${problem.id}/contents`, target = { problemId: problem.id, versionId: latest.versionId };
      const initial = await get(`${path}?versionId=${latest.versionId}`, 'teacher'); assert.equal(initial.canPublish, false);
      assert.ok(initial.originalSolution.body.includes(input.referenceCode));
      const draft = { ...target, kind: 'FULL_SOLUTION', solutions: [{ title: 'Python method', body: 'Read and print the line.', programmingLanguage: 'python' }, { title: 'Alternate explanation', body: 'The identity operation preserves input.' }] };
      content = await post(path, draft, 'teacher', 201); assert.equal(content.status, 'draft'); assert.equal(content.solutions.length, 2);
      const foreignContent = await post(`${source}/${other.id}/contents`, { versionId: other.versionId, kind: 'FULL_SOLUTION', body: 'OTHER_PRIVATE_SOLUTION' }, 'platform', 201);
      await get(`${path}?problemId=${other.id}&versionId=${other.versionId}`, 'teacher', [400, 403, 404]);
      await post(path, { ...draft, problemId: other.id, versionId: other.versionId }, 'teacher', [400, 403, 404]);
      await post(path, { ...draft, versionId: other.versionId }, 'teacher', 404);
      await post(`${path}/${foreignContent.id}/publish`, { reviewed: true, expectedHash: foreignContent.contentHash }, 'platform', [400, 403, 404]);
      await post(`${path}/${content.id}/publish`, { reviewed: true, expectedHash: content.contentHash }, 'teacher', 403);
      await post(`/scholarship/contents/${content.id}/publish`, { reviewed: true, expectedHash: content.contentHash }, 'legacy-editor', 403);
      await post('/scholarship/contents/batch-publish', { requestId: randomUUID(), reviewed: true, items: [{ contentId: content.id, expectedHash: content.contentHash }] }, 'legacy-editor', 403);
      const published = await post(`${path}/${content.id}/publish`, { reviewed: true, expectedHash: content.contentHash }); assert.equal(published.status, 'published');
      const queried = await get(`${path}?versionId=${latest.versionId}`, 'teacher'); assert.equal(queried.items[0].id, content.id);
      assert.ok(!JSON.stringify(queried).includes('OTHER_PRIVATE_'));
    });
    await t.test('course grants also merge by school without inheriting publication or audience powers', async () => {
      const course = await post('/platform/courses', { requestId: randomUUID(), title: 'Scoped course editor', chapters: [{ title: 'Lesson', content: 'Lesson source.', problems: [{ problemId: problem.id, versionId: latest.versionId }] }] }, 'platform', 201);
      await post(`/platform/content-editors/course/${course.id}`, grant('teacher'));
      assert.ok((await get(`/platform/courses?schoolId=${alpha.id}`, 'teacher')).items.some(c => c.id === course.id));
      assert.ok(!(await get(`/platform/courses?schoolId=${beta.id}`, 'teacher')).items.some(c => c.id === course.id));
      assert.equal((await get(`/platform/courses/${course.id}`, 'teacher')).chapters[0].problems[0].canEdit, true);
      await post(`/platform/content-editors/course/${course.id}`, grant('other-teacher', beta.id));
      assert.equal((await get(`/platform/courses/${course.id}`, 'other-teacher')).chapters[0].problems[0].canEdit, false);
      const picker = await get(`/platform/courses/problem-options?courseId=${course.id}`, 'other-teacher');
      const option = picker.items.find(item => item.problemId === problem.id);
      assert.ok(option); assert.deepEqual(option.metadata, { difficulty: input.difficulty });
      assert.doesNotMatch(JSON.stringify(picker), /PRIVATE_EDITORIAL|PRIVATE_PLATFORM_CASE|referenceCode|reference_code/);
      await get(`${source}/${problem.id}`, 'other-teacher', 403);
      const edit = { expectedRevision: course.revision, sourceVersion: course.sourceVersion };
      await patch(`/platform/courses/${course.id}`, { ...edit, audienceScope: 'students', studentIds: [actors.student.identityId] }, 'teacher', 403);
      await post(`/platform/courses/${course.id}/publish`, edit, 'teacher', 403);
      await post(`/platform/content-editors/course/${course.id}`, grant('teacher', beta.id));
      await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, actors.teacher.id]);
      assert.ok(!(await get(`/platform/courses?schoolId=${alpha.id}`, 'teacher')).items.some(c => c.id === course.id), 'an active grant in another school must not revive this school role');
      assert.ok((await get(`/platform/courses?schoolId=${beta.id}`, 'teacher')).items.some(c => c.id === course.id));
      await pool.query('UPDATE school_memberships SET revoked_at=NULL WHERE school_id=$1 AND account_id=$2', [alpha.id, actors.teacher.id]);
    });
    await t.test('revocation and ending the school role remove every editing surface immediately', async () => {
      await request(grantPath, { method: 'DELETE', body: grant('teacher') });
      for (const suffix of ['', '/tutorial', `/contents?versionId=${latest.versionId}`]) await get(`${source}/${problem.id}${suffix}`, 'teacher', 403);
      await post(`${source}/${problem.id}/versions`, { ...input, expectedVersionId: latest.versionId }, 'teacher', 403);
      assert.deepEqual((await get(`${source}?schoolId=${alpha.id}`, 'teacher')).items, []);
      await post(grantPath, grant('teacher'));
      await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, actors.teacher.id]);
      await get(`${source}/${problem.id}`, 'teacher', 403);
      assert.deepEqual((await get(`${source}?schoolId=${alpha.id}`, 'teacher')).items, []);
      assert.deepEqual((await get(`/platform/courses?schoolId=${alpha.id}`, 'teacher')).items, []);
      await assert.rejects(worker.query('SELECT * FROM platform_content_editors'), /permission denied/);
    });
  } finally {
    if (app) await app.close(); if (worker) await worker.end(); await pool.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
  }
});
