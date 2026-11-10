import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { importAcslPaper, importAcslPapers } from '../../../packages/domain/src/acsl-import.mjs';
import { processSchoolOne } from '../../../packages/domain/school-worker.mjs';
import { GoJudge } from '../../../packages/domain/judge.mjs';

test('ACSL batch imports preserve editions and protect original images through the real Nest transport', { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const manager = createPool(base.href), schema = `acsl_assets_${randomBytes(5).toString('hex')}`;
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href);
  let server, app, worker;
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const password = randomBytes(24).toString('base64url'), hash = await hashPassword(password), users = {};
    for (const name of ['admin', 'student', 'outsider']) {
      const identity = randomUUID();
      await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$2)", [identity, name]);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, hash])).rows[0];
    }
    const school = await provisionSchool(pool, { slug: 'source-school', name: 'Source school', adminUsername: 'admin' });
    await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')", [school.id, users.student.id]);
    const sample = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
    const original = await importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.admin.id, content: sample });
    const originalSnapshot = (await pool.query('SELECT * FROM acsl_papers WHERE id=$1', [original.id])).rows[0];
    const content = structuredClone(sample);
    content.slug = 'acsl-elementary-assets'; content.division = 'Elementary'; content.programming = null;
    content.questions = [content.questions[0]];
    const buffers = [
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=', 'base64'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    ];
    content.assets = ['statement', 'solution'].map((id, i) => ({ id, path: `${id}.png`, sha256: createHash('sha256').update(buffers[i]).digest('hex'), mimeType: 'image/png', width: 1, height: 1,
      source: { path: `source-${id}.pdf`, sha256: '0'.repeat(64), page: 1, bbox: [0, 0, 1, 1] } }));
    content.questions[0].statementAssets = { en: ['statement'], zh: [] };
    content.questions[0].explanationAssets = { en: ['solution'], zh: [] };
    const assets = content.assets.map((asset, i) => ({ id: asset.id, content: buffers[i] }));
    const batch = [{ content: sample }, { content, assets }];
    const imported = await importAcslPapers(pool, { schoolId: school.id, ownerAccountId: users.admin.id, packages: batch });
    const paper = imported[1];
    const asRole = role => { const url = new URL(scoped); url.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return url.href; };
    app = createPool(asRole('campus_app')); worker = createPool(asRole('campus_worker'));
    const origin = 'http://acsl-assets.test';
    server = await createApiApplication({ databaseUrl: asRole('campus_app'), logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await server.listen(0, '127.0.0.1'); const host = await server.getUrl();
    const request = async (path, { auth, method = 'GET', body, status = 200, binary = false } = {}) => {
      const response = await fetch(`${host}${path.startsWith('/api/') ? path : `/api/v1${path}`}`, { method, headers: { Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = binary && response.status === 200 ? Buffer.from(await response.arrayBuffer()) : await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
      return { data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const auth = {};
    for (const name of Object.keys(users)) { const login = await request('/auth/login', { method: 'POST', body: { username: name, password } }); auth[name] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
    const root = `/schools/${school.id}/acsl`, path = `${root}/${paper.id}`;
    const solutionUrl = `/api/v1${path}/assets/solution?versionId=${paper.versionId}`;

    await t.test('batch prevalidation and transactions preserve the existing reviewed edition on retries and conflicts', async () => {
      assert.equal(imported[0].imported, false); assert.equal(imported[1].imported, true);
      assert.deepEqual((await pool.query('SELECT * FROM acsl_papers WHERE id=$1', [original.id])).rows[0], originalSnapshot);
      assert.ok((await importAcslPapers(pool, { schoolId: school.id, ownerAccountId: users.admin.id, packages: batch })).every(item => !item.imported));
      const newContent = { ...content, slug: 'acsl-rollback-candidate' };
      await assert.rejects(importAcslPapers(pool, { schoolId: school.id, ownerAccountId: users.admin.id,
        packages: [{ content: newContent, assets }, { content: { ...sample, title: { en: 'Conflicting content', zh: '冲突内容' } } }] }), /differs/);
      assert.equal((await pool.query("SELECT count(*)::integer n FROM acsl_papers WHERE slug='acsl-rollback-candidate'")).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_assets')).rows[0].n, 2);
      assert.equal((await pool.query('SELECT count(*)::integer n FROM school_problems')).rows[0].n, 1, 'written-only edition creates no coding bank or problem');
    });

    await t.test('points are explicit and atomic, preserve existing rules, and distinguish written-only editions', async () => {
      assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_point_rules')).rows[0].n, 0);
      await assert.rejects(importAcslPapers(pool, { schoolId: school.id, ownerAccountId: users.admin.id, packages: batch, enablePoints: true }), /legacy school/);
      const existing = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.admin.id, content: sample });
      await pool.query(`INSERT INTO acsl_point_rules(school_id,paper_id,version_id,written_points_per_correct,programming_points)
        VALUES($1,$2,$3,7,90)`, [LEGACY_SCHOOL_ID, existing.id, existing.versionId]);
      const ruleBefore = (await pool.query('SELECT * FROM acsl_point_rules WHERE paper_id=$1', [existing.id])).rows[0];
      const freshCoding = { ...sample, slug: 'acsl-points-new-coding' };
      const args = { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.admin.id, packages: [...batch, { content: freshCoding }], enablePoints: true };
      const first = await importAcslPapers(pool, args);
      const again = await importAcslPapers(pool, args);
      assert.ok(again.every(item => !item.imported));
      assert.deepEqual((await pool.query('SELECT * FROM acsl_point_rules WHERE paper_id=$1', [existing.id])).rows[0], ruleBefore);
      for (const [index, programmingPoints] of [[1, 0], [2, 10]]) {
        const rule = (await pool.query('SELECT written_points_per_correct,programming_points FROM acsl_point_rules WHERE paper_id=$1', [first[index].id])).rows[0];
        assert.deepEqual(rule, { written_points_per_correct: 1, programming_points: programmingPoints });
      }
      assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_point_awards')).rows[0].n, 0, 'enabling rules creates no retroactive awards');
      const ruleCount = (await pool.query('SELECT count(*)::integer n FROM acsl_point_rules')).rows[0].n;
      await assert.rejects(importAcslPapers(pool, { ...args, packages: [{ content: { ...content, slug: 'acsl-points-rollback' }, assets }, { content: { ...sample, title: { en: 'Conflict', zh: '冲突' } } }] }), /differs/);
      assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_point_rules')).rows[0].n, ruleCount);
    });

    await t.test('written-only projection and protected statement images require school membership and exact version', async () => {
      const catalog = (await request(root, { auth: auth.student })).data;
      assert.equal(catalog.items.find(item => item.id === paper.id).hasProgramming, false);
      assert.equal(catalog.items.find(item => item.id === original.id).hasProgramming, true);
      const detail = (await request(path, { auth: auth.student })).data;
      assert.equal(detail.programming, null); assert.equal(detail.programmingSolved, false);
      assert.equal(detail.programmingPointsAwarded, undefined);
      assert.ok(!JSON.stringify(detail).includes('solution')); assert.ok(!JSON.stringify(detail).includes('source-statement.pdf'));
      const sourceUrl = detail.questions[0].statementAssets.en[0];
      const image = await request(sourceUrl, { auth: auth.student, binary: true });
      assert.deepEqual(image.data, buffers[0]); assert.match(image.headers.get('content-type'), /^image\/png/);
      assert.match(image.headers.get('cache-control'), /no-store/); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
      await request(sourceUrl, { status: 401 }); await request(sourceUrl, { auth: auth.outsider, status: 404 });
      await request(sourceUrl.replace(paper.versionId, randomUUID()), { auth: auth.student, status: 409 });
      await request(sourceUrl.replace('/assets/statement?', '/assets/unknown?'), { auth: auth.student, status: 404 });
      await request(`${path}/programming`, { auth: auth.student, status: 404 });
      await request(`${path}/programming/submissions`, { auth: auth.student, method: 'POST', body: { versionId: randomUUID(), kind: 'submit', language: 'python', code: 'print(0)', requestId: randomUUID() }, status: 404 });
      await request(solutionUrl, { auth: auth.student, status: 403 });
      await request(`${path}/questions/q1/explanation?versionId=${paper.versionId}`, { auth: auth.student, status: 403 });
    });

    await t.test('full written grading unlocks only that account’s explanation images and locks saved answers', async () => {
      await request(`${path}/questions/q1/draft`, { auth: auth.student, method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: ['D'] } });
      const grade = (await request(`${path}/submit`, { auth: auth.student, method: 'POST', body: { versionId: paper.versionId, revisions: { q1: 1 } } })).data;
      assert.equal(grade.graded, true); assert.equal(grade.score, 1); assert.equal(grade.programming, null);
      assert.equal(grade.programmingPointsAwarded, undefined);
      assert.ok(!JSON.stringify(grade).includes('solution'), 'solutions still require explicit expand');
      const expanded = (await request(`${path}/questions/q1/explanation?versionId=${paper.versionId}`, { auth: auth.student })).data;
      assert.equal(expanded.explanationAssets.en[0], solutionUrl);
      assert.deepEqual((await request(solutionUrl, { auth: auth.student, binary: true })).data, buffers[1]);
      await request(solutionUrl, { auth: auth.admin, status: 403 });
      await request(`${path}/questions/q1/draft`, { auth: auth.student, method: 'PATCH', body: { versionId: paper.versionId, expectedRevision: 1, selectedOptionIds: ['A'] }, status: 409 });
      await pool.query('UPDATE acsl_papers SET enabled=false WHERE id=$1', [paper.id]);
      await request(solutionUrl, { auth: auth.student, status: 404 });
    });

    await t.test('application images are read-only and school scoped while worker has no image access', async () => {
      assert.equal((await app.query('SELECT count(*)::integer n FROM acsl_assets')).rows[0].n, 0);
      const db = await app.connect();
      try {
        await db.query('BEGIN'); await db.query("SELECT set_config('campus.school_id',$1,true)", [school.id]);
        assert.equal((await db.query('SELECT count(*)::integer n FROM acsl_assets')).rows[0].n, 2);
        await db.query('ROLLBACK');
      } finally { db.release(); }
      for (const statement of ['DELETE FROM acsl_assets', "UPDATE acsl_assets SET purpose='statement'", 'INSERT INTO acsl_assets SELECT * FROM acsl_assets']) {
        await assert.rejects(app.query(statement), error => error.code === '42501');
      }
      await assert.rejects(worker.query('SELECT * FROM acsl_assets'), error => error.code === '42501');
    });

    await t.test('official-test programming without a stored reference uses the unchanged isolated judge', { skip: !process.env.GO_JUDGE_TEST_URL }, async () => {
      const official = structuredClone(sample); official.slug = 'acsl-official-no-reference';
      delete official.programming.definition.referenceCode; official.programming.testProvenance = 'official';
      const codingPaper = await importAcslPaper(pool, { schoolId: school.id, ownerAccountId: users.admin.id, content: official });
      const codingPath = `${root}/${codingPaper.id}/programming`;
      const coding = (await request(codingPath, { auth: auth.student })).data;
      assert.equal(coding.referenceAvailable, true);
      for (const field of ['referenceCode', 'reference_code', 'solution', 'code', 'tests']) assert.equal(coding[field], undefined);
      assert.ok(!JSON.stringify(coding).includes('"tests"'));
      await request(`${codingPath}?view=solution`, { auth: auth.student, status: 403 });
      const definition = (await pool.query('SELECT v.definition FROM school_problem_versions v JOIN acsl_papers p ON p.school_id=v.school_id AND p.programming_version_id=v.id WHERE p.id=$1', [codingPaper.id])).rows[0].definition;
      assert.equal(Object.hasOwn(definition, 'reference_code'), false);
      const queued = (await request(`${codingPath}/submissions`, { auth: auth.student, method: 'POST', body: { paperVersionId: codingPaper.versionId, versionId: coding.versionId, kind: 'submit', language: 'python', code: sample.programming.definition.referenceCode, requestId: randomUUID() }, status: 202 })).data;
      const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: process.env.JUDGE_ENVIRONMENT_VERSION ?? 'acsl-assets-integration' });
      await judge.ready(); await processSchoolOne({ pool: worker, judge });
      const result = (await request(`${codingPath}/submissions/${queued.id}`, { auth: auth.student })).data;
      assert.equal(result.status, 'AC'); assert.equal(result.passed, 6);
    });
  } finally {
    await server?.close(); await app?.end(); await worker?.end(); await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
