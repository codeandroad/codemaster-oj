import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';
import { importAcslPaper } from '../../../packages/domain/src/acsl-import.mjs';

const migrations = ['106_platform_course_admissions.sql', '108_platform_points_and_requirement_modes.sql'];
const bodySentinel = 'LOCKED_LESSON_CONTENT_NOT_FOR_APPLICANTS';
const policy = ({ all, independent, schools = [], accounts = [] } = {}) => ({
  scope: all ? 'all' : 'custom', allRule: all ?? null, independentRule: independent ?? null,
  schoolRules: schools, accountRules: accounts,
});
const rule = (admissionMode = 'direct', extra = {}) => ({ admissionMode, prerequisiteCourseIds: [], minimumPoints: 0, ...extra });
const rulesOf = course => [course.audiencePolicy.allRule, course.audiencePolicy.independentRule, ...course.audiencePolicy.schoolRules, ...course.audiencePolicy.accountRules].filter(Boolean);
const cas = course => ({ expectedRevision: course.revision, sourceVersion: course.sourceVersion });
function noLesson(value) { assert.ok(!JSON.stringify(value).includes(bodySentinel), 'locked lesson prose leaked'); }
function noCode(value, code) {
  assert.ok(!JSON.stringify(value).includes(code), 'invitation plaintext leaked after issuance');
  const inspect = input => { if (input && typeof input === 'object') for (const [key, child] of Object.entries(input)) {
    assert.ok(!/^(?:code|codeHash|code_hash|salt|tokenHash|token_hash)$/.test(key), `private invitation field leaked: ${key}`); inspect(child);
  } }; inspect(value);
}

// These fixtures are intentionally new, randomly named schemas. No production
// accounts, courses, historical answers or balances are reused or reset.
async function fixture() {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(base.pathname, '/campus_qa');
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const schema = `platform_admissions_${randomBytes(6).toString('hex')}`;
  const manager = createPool(base.href);
  await manager.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const owner = createPool(scoped.href), servers = [];
  const password = randomBytes(24).toString('base64url'), origin = 'http://platform-admissions.test';
  try {
    await owner.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    await owner.query('INSERT INTO schema_migrations(name) SELECT unnest($1::text[])', [migrations]);
    await migrate(owner);
    await bootstrap(owner, { name: 'Fixture legacy admin', number: 'ADMIN', username: 'legacy-admin', password });
    const actors = {};
    actors['legacy-admin'] = (await owner.query("SELECT id,identity_id AS \"identityId\" FROM accounts WHERE username='legacy-admin'")).rows[0];
    const hash = await hashPassword(password);
    for (const name of ['platform', 'free', 'free-peer', 'free-third', 'alpha-admin', 'alpha-teacher', 'alpha-student', 'alpha-peer', 'beta-admin', 'beta-student', 'multi-student', 'legacy-student', 'legacy-peer']) {
      const kind = name.startsWith('legacy-') ? 'student' : 'personal';
      const identityId = randomUUID();
      await owner.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identityId, kind, name]);
      actors[name] = { ...(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, name, hash])).rows[0], identityId };
      if (name.startsWith('legacy-')) {
        await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [actors[name].id]);
        await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [actors[name].id]);
      } else await owner.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1', [actors[name].id]);
    }
    await provisionPlatformAdministrator(owner, { username: 'platform' });
    const alpha = await provisionSchool(owner, { slug: 'admission-alpha', name: 'Fixture Alpha', adminUsername: 'alpha-admin' });
    const beta = await provisionSchool(owner, { slug: 'admission-beta', name: 'Fixture Beta', adminUsername: 'beta-admin' });
    for (const [name, schoolId, role] of [
      ['alpha-teacher', alpha.id, 'teacher'], ['alpha-student', alpha.id, 'student'], ['alpha-peer', alpha.id, 'student'],
      ['beta-student', beta.id, 'student'], ['multi-student', alpha.id, 'student'], ['multi-student', beta.id, 'student'],
    ]) {
      await owner.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [schoolId, actors[name].id, role]);
      const schoolIdentity = (await owner.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4) RETURNING id', [schoolId, role, name, actors[name].id])).rows[0];
      actors[name].schoolIdentities ??= {}; actors[name].schoolIdentities[schoolId] = schoolIdentity.id;
    }
    const oldCourses = [];
    for (const scope of ['all', 'schools', 'students']) {
      const path = (await owner.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,published_at,
        platform_access_scope,platform_school_ids,platform_student_ids) VALUES($1,$2,'platform',now(),$3,$4,$5) RETURNING *`,
      [actors.platform.id, `Existing ${scope} course`, scope, scope === 'schools' ? [alpha.id] : [], scope === 'students' ? [actors.free.identityId] : []])).rows[0];
      const chapter = (await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Historical chapter','Historical bilingual lesson',0) RETURNING *", [path.id])).rows[0];
      await owner.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)', [actors['legacy-student'].identityId, chapter.id]);
      oldCourses.push({ path, chapter });
    }
    const alias = (await owner.query("INSERT INTO learning_paths(owner_account_id,title,archived_at,merged_into_id,merged_first_chapter_id) VALUES($1,'Historical alias',now(),$2,$3) RETURNING *", [actors['legacy-admin'].id, oldCourses[0].path.id, oldCourses[0].chapter.id])).rows[0];
    const oldProgress = (await owner.query('SELECT * FROM learning_progress ORDER BY chapter_id')).rows;
    await owner.query('DELETE FROM schema_migrations WHERE name=ANY($1::text[])', [migrations]); await migrate(owner);
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const runtime = new URL(scoped); runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    const workerUrl = new URL(scoped); workerUrl.searchParams.set('options', `-crole=campus_worker -csearch_path=${schema}`);
    const worker = createPool(workerUrl.href);
    const config = loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' });
    const startServer = async () => {
      const app = await createApiApplication({ databaseUrl: runtime.href, logger: false, config });
      await app.listen(0, '127.0.0.1'); servers.push(app);
      return (await app.getUrl()) + '/api/v1';
    };
    let endpoint = await startServer();
    const auth = {};
    const request = async (path, { name = 'platform', method = 'GET', body, status = 200, csrf = true, session = true, at = endpoint } = {}) => {
      const actor = session ? auth[name] : null;
      const response = await fetch(at + path, { method, headers: { Origin: origin,
        ...(actor ? { Cookie: actor.cookie, ...(csrf ? { 'X-CSRF-Token': actor.csrf } : {}) } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      assert.ok([status].flat().includes(response.status), `${method} ${path} as ${name}: ${response.status} ${JSON.stringify(data.error ?? {})}`);
      return { data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    for (const name of Object.keys(actors)) {
      const login = await request('/auth/login', { session: false, method: 'POST', body: { username: name, password } });
      auth[name] = { cookie: login.cookie, csrf: login.data.csrfToken };
    }
    const get = async (path, name = 'platform', status = 200) => (await request(path, { name, status })).data;
    const post = async (path, body, name = 'platform', status = 200) => (await request(path, { name, method: 'POST', body, status })).data;
    const patch = async (path, body, name = 'platform', status = 200) => (await request(path, { name, method: 'PATCH', body, status })).data;
    const snapshot = async () => {
      const rows = {};
      for (const table of ['learning_progress', 'acsl_drafts', 'acsl_paper_grades', 'acsl_point_awards', 'school_rank_ledger', 'paper4_rank_ledger', 'school_rank_awards', 'luq_accounts', 'luq_ledger', 'school_scholarship_accounts', 'school_scholarship_ledger']) {
        rows[table] = (await owner.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
      }
      return rows;
    };
    let retained = false;
    const retain = async extra => {
      if (!process.env.TEST_KEEP_PLATFORM_ADMISSION_FIXTURE) return;
      const output = resolve(process.env.TEST_KEEP_PLATFORM_ADMISSION_FIXTURE);
      assert.equal(output, resolve('.campus-local/platform-course-admissions-20261112/qa/fixture.json'));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify({ schema, runtimeScopedUrl: runtime.href, config, origin, actors, alpha, beta,
        credentials: Object.fromEntries(Object.keys(actors).map(username => [username, { username, password }])), ...extra }, null, 2), { mode: 0o600 });
      await chmod(output, 0o600); retained = true;
    };
    const close = async () => {
      for (const app of servers) await app.close();
      await worker.end(); await owner.end();
      if (!retained) await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
    };
    return { owner, worker, actors, alpha, beta, schema, request, get, post, patch, snapshot, startServer, close, retain, oldCourses, oldProgress, alias };
  } catch (error) {
    for (const app of servers) await app.close();
    await owner.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end(); throw error;
  }
}

test('platform course admission combines audience, requirements and grants across real HTTP boundaries', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 240000,
}, async t => {
  const f = await fixture();
  let passedCases = 0;
  const run = (name, check) => t.test(name, async () => { await check(); passedCases++; });
  const { owner, actors, alpha, beta, get, post, patch, request } = f;
  const create = async (audiencePolicy, title = 'Admission fixture', chapters = [{ title: 'Lesson', content: bodySentinel }]) => {
    let course = await post('/platform/courses', { requestId: randomUUID(), title, audiencePolicy, chapters }, 'platform', 201);
    course = await post(`/platform/courses/${course.id}/publish`, cas(course)); return course;
  };
  const change = async (course, body, status = 200) => {
    const current = await get(`/platform/courses/${course.id}`);
    return patch(`/platform/courses/${course.id}`, { ...cas(current), ...body }, 'platform', status);
  };
  const entry = (course, name, status = 200) => get(`/practice/courses/${course.id}/entry`, name, status);
  const read = (course, name, status = 200) => get(`/practice/courses/${course.id}`, name, status);
  const apply = (course, r, name, status = 201) => post(`/practice/courses/${course.id}/applications`, { ruleId: r.ruleId, generation: r.generation }, name, status);
  const invite = (course, r, action = 'rotate', status = 200, name = 'platform') => post(`/platform/courses/${course.id}/rules/${r.ruleId}/invitation`, { action, generation: r.generation }, name, status);
  const redeem = (course, r, code, name, status = 200, at) => request(`/practice/courses/${course.id}/invitations/redeem`, { method: 'POST', name, status, at, body: { ruleId: r.ruleId, generation: r.generation, code } });
  const admissions = course => get(`/platform/courses/${course.id}/admissions`);
  const decision = (course, application, action, name = 'platform', status = 200) => post(`/platform/courses/${course.id}/admissions/${application.id}/decision`, { action, expectedStatus: application.status, generation: application.generation }, name, status);
  const publicProblem = async ({ approved = true } = {}) => {
    const bankId = (await owner.query("INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,'Fixture bank',$3) RETURNING id", [alpha.id, actors['alpha-admin'].id, randomUUID()])).rows[0].id;
    const definition = { title: 'Fixture public input', mode: 'stdio', statement: 'Return the input.', reference_code: 'print(input())', samples: [{ input: '2', expected: '2', enabled: true }], tests: [{ position: 1, input: '3', expected: '3' }], time_limit_ms: 1000, memory_limit_mb: 128, languages: ['python'] };
    const problemId = (await owner.query('INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [alpha.id, bankId, actors['alpha-admin'].id, definition, randomUUID()])).rows[0].id;
    const versionId = (await owner.query('INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,1,$3) RETURNING id', [alpha.id, problemId, definition])).rows[0].id;
    await owner.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2', [alpha.id, problemId, versionId]);
    if (approved) await owner.query('INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by) VALUES($1,$2,$3,$4)', [alpha.id, problemId, versionId, actors.platform.id]);
    return { schoolId: alpha.id, problemId, versionId };
  };
  const seedJob = async (problem, name, { context = 'public', kind = 'submit', status = 'AC', state = 'completed' } = {}) => {
    // Trusted fixture result, never execution of user code. Only transport and
    // eligibility projection are under test in this suite.
    const deferSchoolResult = context === 'school' && state === 'completed';
    const id = (await owner.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result,completed_at,identity_id)
      VALUES($1,$2,$3,$4,$5,'fixture',$6,$7,$8,$9,$10,now(),$11) RETURNING id`, [problem.schoolId, problem.problemId, problem.versionId, actors[name].id, randomUUID(), kind, context,
      { language: 'python', code: '# fixture result' }, deferSchoolResult ? 'queued' : state, deferSchoolResult ? null : { status },
      context === 'school' ? actors[name].schoolIdentities?.[problem.schoolId] : null])).rows[0].id;
    if (deferSchoolResult) await owner.query("UPDATE school_judge_jobs SET state='completed',result=$3,completed_at=now() WHERE school_id=$1 AND id=$2", [problem.schoolId, id, { status }]);
    return id;
  };
  try {
    await run('migration preserves existing scopes, stable chapters, aliases and reading history', async () => {
      for (const { path, chapter } of f.oldCourses) {
        const after = (await owner.query('SELECT * FROM learning_paths WHERE id=$1', [path.id])).rows[0];
        for (const key of Object.keys(path)) assert.deepEqual(after[key], path[key], `existing path field ${key}`);
        assert.deepEqual((await owner.query('SELECT * FROM learning_chapters WHERE id=$1', [chapter.id])).rows[0], chapter);
        const course = await get(`/platform/courses/${path.id}`);
        assert.ok(rulesOf(course).every(r => r.admissionMode === 'direct' && r.minimumPoints === 0 && r.prerequisiteCourseIds.length === 0));
        if (path.platform_access_scope === 'all') await read(course, 'free');
        if (path.platform_access_scope === 'schools') { await read(course, 'alpha-student'); await read(course, 'beta-student', 404); }
        if (path.platform_access_scope === 'students') { await read(course, 'free'); await read(course, 'free-peer', 404); }
      }
      assert.deepEqual((await owner.query('SELECT * FROM learning_progress ORDER BY chapter_id')).rows, f.oldProgress);
      assert.deepEqual((await owner.query('SELECT * FROM learning_paths WHERE id=$1', [f.alias.id])).rows[0], { ...f.alias, platform_audience_scope: 'all' });
      await migrate(owner);
      assert.deepEqual((await owner.query('SELECT * FROM learning_progress ORDER BY chapter_id')).rows, f.oldProgress);
    });

    await run('independent audience cannot be impersonated by school members using personal workspaces', async () => {
      const course = await create(policy({ independent: rule(), schools: [{ schoolId: alpha.id, ...rule() }] }));
      for (const name of ['free', 'alpha-student', 'alpha-teacher', 'alpha-admin', 'multi-student']) await read(course, name);
      for (const name of ['beta-student', 'beta-admin', 'legacy-student', 'legacy-admin']) {
        await entry(course, name, 404); await read(course, name, 404);
        assert.ok(!(await get('/practice/catalog', name)).courses.some(c => c.id === course.id));
      }
      assert.equal((await owner.query('SELECT kind FROM identities WHERE id=$1', [actors['beta-student'].identityId])).rows[0].kind, 'personal');
      await owner.query('UPDATE accounts SET default_school_id=NULL WHERE id=$1', [actors['beta-student'].id]);
      await read(course, 'beta-student', 404);
      await owner.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, actors['multi-student'].id]);
      await read(course, 'multi-student', 404);
      await owner.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [beta.id, actors['multi-student'].id]);
      await read(course, 'multi-student');
      await owner.query('UPDATE school_memberships SET revoked_at=NULL WHERE account_id=$1', [actors['multi-student'].id]);
    });

    await run('a platform course targeting the legacy school appears in both course tabs before admission', async () => {
      const schoolRule = { schoolId: LEGACY_SCHOOL_ID, ...rule('direct', { minimumPoints: 300 }) };
      const independent = rule('invite'), name = 'legacy-student';
      let course = await create(policy({ independent, schools: [schoolRule] }), 'ACSL discovery fixture');
      const issued = await invite(course, course.audiencePolicy.independentRule);
      const schoolList = () => get('/learning-paths?includeAdmission=true', name);
      const publicList = async actor => (await get('/practice/catalog', actor)).courses.find(item => item.id === course.id);
      const summary = (await schoolList()).items.find(item => item.id === course.id);
      assert.ok(summary);
      assert.equal(summary.title, course.title);
      assert.equal(summary.admission, 'requirements');
      assert.equal(summary.chapterCount, 1);
      for (const key of ['chapters', 'completedChapters', 'taskCount', 'admissionRules']) assert.ok(!(key in summary));
      noLesson(summary); noCode(summary, issued.code);
      assert.equal((await publicList(name)).admission, 'requirements');
      const schoolEntry = await entry(course, name);
      assert.equal(schoolEntry.admissionRules.length, 1);
      assert.equal(schoolEntry.admissionRules[0].points.required, 300);
      assert.equal((await publicList('free')).admission, 'invite');
      assert.equal(await publicList('beta-student'), undefined);
      await get('/learning-paths?includeAdmission=true', 'beta-student', 403);
      assert.ok(!(await get('/learning-paths', name)).items.some(item => item.id === course.id));
      await get(`/learning-paths/${course.id}`, name, 404); await read(course, name, 403);

      course = await change(course, { audiencePolicy: policy({ independent, schools: [{ ...schoolRule, minimumPoints: 0 }] }) });
      const admitted = (await schoolList()).items.find(item => item.id === course.id);
      assert.equal(admitted.completedChapters, 0);
      assert.ok(!('admission' in admitted));
      assert.equal((await get(`/learning-paths/${course.id}`, name)).id, course.id);
    });

    await run('applications expose metadata only and require platform approval; content edits retain grants', async () => {
      let course = await create(policy({ independent: rule('application') }));
      const r = course.audiencePolicy.independentRule;
      const initial = await entry(course, 'free'); assert.equal(initial.admission, 'apply'); noLesson(initial);
      noLesson(await get('/practice/catalog', 'free'));
      await read(course, 'free', 403); await apply(course, r, 'free'); await apply(course, r, 'free', 200);
      assert.equal((await entry(course, 'free')).admission, 'pending');
      let record = (await admissions(course)).items[0]; assert.ok(record);
      for (const name of ['legacy-admin', 'alpha-admin', 'alpha-teacher', 'free', 'free-peer']) {
        await get(`/platform/courses/${course.id}/admissions`, name, 403);
        await decision(course, record, 'approve', name, 403);
        await invite(course, r, 'rotate', 403, name);
      }
      await request(`/platform/courses/${course.id}/admissions/${record.id}/decision`, { method: 'POST', body: { action: 'approve', expectedStatus: record.status, generation: record.generation }, csrf: false, status: 403 });
      await decision(course, record, 'approve'); await read(course, 'free');
      course = await change(course, { description: 'Updated teaching description', chapters: [{ ...course.chapters[0], content: bodySentinel + ' revised' }] });
      assert.equal(course.audiencePolicy.independentRule.generation, r.generation);
      await read(course, 'free');
      await decision(course, record, 'approve', 'platform', 409);
      record = (await admissions(course)).items[0]; await decision(course, record, 'revoke');
      await read(course, 'free', 403);
      course = await change(course, { audiencePolicy: policy({ independent: { ...r, minimumPoints: 10 } }) });
      assert.notEqual(course.audiencePolicy.independentRule.generation, r.generation);
      await apply(course, r, 'free', 409);
      const gated = await entry(course, 'free'); assert.equal(gated.admission, 'requirements'); noLesson(gated);
    });

    await run('six-character invitations are single-disclosure and rotation preserves accepted learners', async () => {
      const course = await create(policy({ independent: rule('invite') })), r = course.audiencePolicy.independentRule;
      assert.equal((await entry(course, 'free')).admission, 'invite');
      const first = await invite(course, r); assert.match(first.code, /^[2-9A-HJKMNP-Z]{6}$/);
      noCode(await get(`/platform/courses/${course.id}`), first.code); noCode(await admissions(course), first.code);
      noCode(await entry(course, 'free'), first.code);
      const audits = (await owner.query('SELECT detail FROM platform_audit_events ORDER BY id')).rows;
      noCode(audits, first.code);
      await redeem(course, r, first.code, 'free'); await redeem(course, r, first.code, 'free'); await read(course, 'free');
      assert.equal((await admissions(course)).items.length, 1, 'redeeming twice cannot create duplicate approvals');
      const second = await invite(course, r); assert.match(second.code, /^[2-9A-HJKMNP-Z]{6}$/); assert.notEqual(second.code, first.code);
      assert.equal((await redeem(course, r, first.code, 'free-peer', 400)).data.error.code, 'INVALID_COURSE_INVITATION');
      await read(course, 'free'); await redeem(course, r, second.code, 'free-peer');
      await invite(course, r, 'revoke');
      assert.equal((await redeem(course, r, second.code, 'free-third', 400)).data.error.code, 'INVALID_COURSE_INVITATION');
      await read(course, 'free'); await read(course, 'free-peer');
      const rows = (await admissions(course)).items;
      const accepted = rows.find(a => a.accountId === actors.free.id || a.identityId === actors.free.identityId); assert.ok(accepted);
      await decision(course, accepted, 'revoke'); await read(course, 'free', 403);
      const third = await invite(course, r);
      await redeem(course, r, third.code, 'free', 403);
      await redeem(course, r, third.code, 'beta-student', 404);
      await redeem(course, { ...r, generation: randomUUID() }, third.code, 'free-third', 409);
    });

    await run('invitation failures remain rate-limited across independent API instances', async () => {
      const course = await create(policy({ independent: rule('invite') })), r = course.audiencePolicy.independentRule;
      const issued = await invite(course, r), wrong = issued.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ';
      for (let n = 0; n < 5; n++) assert.equal((await redeem(course, r, wrong, 'free-third', 400)).data.error.code, 'INVALID_COURSE_INVITATION');
      const anotherApi = await f.startServer();
      await redeem(course, r, issued.code, 'free-third', 429, anotherApi);
      await redeem(course, r, issued.code, 'free-third', 429);
      await redeem(course, r, issued.code, 'free-peer');
      await read(course, 'free-third', 403); await read(course, 'free-peer');
    });

    await run('expiry, unauthorized issuance and stored invitations never disclose usable secrets', async () => {
      const course = await create(policy({ independent: rule('invite') })), r = course.audiencePolicy.independentRule;
      const issued = await invite(course, r);
      const stored = (await owner.query('SELECT * FROM platform_course_invitations WHERE rule_id=$1', [r.ruleId])).rows[0];
      assert.ok(stored); assert.notEqual(stored.code_hash, issued.code);
      assert.ok(!JSON.stringify(stored).includes(issued.code), 'plaintext must not be stored');
      await request(`/platform/courses/${course.id}/rules/${r.ruleId}/invitation`, { method: 'POST', body: { action: 'rotate', generation: r.generation }, csrf: false, status: 403 });
      await request(`/platform/courses/${course.id}/admissions`, { session: false, status: 401 });
      assert.equal((await owner.query('SELECT count(*)::int n FROM platform_course_invitations WHERE rule_id=$1', [r.ruleId])).rows[0].n, 1);
      await owner.query("UPDATE platform_course_invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1", [stored.id]);
      const failure = await redeem(course, r, issued.code, 'free', 400);
      assert.equal(failure.data.error.code, 'INVALID_COURSE_INVITATION');
      assert.equal((await owner.query('SELECT count(*)::int n FROM platform_course_admissions WHERE rule_id=$1', [r.ruleId])).rows[0].n, 0);
      await assert.rejects(f.worker.query('SELECT platform_points_for_account(NULL)'), /permission denied/);
      for (const table of ['platform_course_rules', 'platform_course_admissions', 'platform_course_invitations', 'platform_course_invitation_attempts']) {
        await assert.rejects(f.worker.query(`SELECT * FROM ${table}`), /permission denied/);
      }
    });

    await run('platform points and prerequisites are both required and never consume scholarship balances', async () => {
      const prerequisite = await create(policy({ all: rule() }), 'Required reading');
      const learner = actors['alpha-student'];
      const markPrerequisite = read => post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read, expectedRevision: prerequisite.revision }, 'alpha-student');
      await owner.query("INSERT INTO school_rank_awards(school_id,identity_id,subject_key,points) VALUES($1,$2,'fixture:admission',9)", [alpha.id, learner.schoolIdentities[alpha.id]]);
      await owner.query('INSERT INTO school_scholarship_accounts(school_id,identity_id,balance) VALUES($1,$2,500) ON CONFLICT(school_id,identity_id) DO UPDATE SET balance=500', [alpha.id, learner.schoolIdentities[alpha.id]]);
      await owner.query('INSERT INTO luq_accounts(identity_id,balance) VALUES($1,700) ON CONFLICT(identity_id) DO UPDATE SET balance=700', [learner.identityId]);
      const course = await create(policy({ schools: [{ schoolId: alpha.id, ...rule('application', { prerequisiteCourseIds: [prerequisite.id], minimumPoints: 10 }) }] }));
      const r = course.audiencePolicy.schoolRules[0];
      let state = await entry(course, 'alpha-student'), evaluated = state.admissionRules[0];
      assert.equal(state.admission, 'requirements'); assert.equal(evaluated.requirementsMet, false);
      assert.equal(evaluated.points.source, 'platform'); assert.equal(evaluated.schoolId, alpha.id);
      assert.equal(evaluated.points.current, 0); assert.equal(evaluated.points.required, 10);
      assert.equal(evaluated.prerequisites[0].completed, false);
      await apply(course, r, 'alpha-student', 403);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read: true, expectedRevision: prerequisite.revision }, 'alpha-student');
      evaluated = (await entry(course, 'alpha-student')).admissionRules[0];
      assert.equal(evaluated.prerequisites[0].completed, true); assert.equal(evaluated.requirementsMet, false);
      await seedJob(await publicProblem(), 'alpha-student', { context: 'school' });
      assert.equal((await entry(course, 'alpha-student')).admission, 'apply');
      await apply(course, r, 'alpha-student'); let application = (await admissions(course)).items[0];
      await markPrerequisite(false);
      await decision(course, application, 'approve', 'platform', 403);
      assert.equal((await admissions(course)).items[0].status, 'pending');
      await markPrerequisite(true);
      await decision(course, application, 'approve');
      const before = await f.snapshot();
      for (let n = 0; n < 3; n++) { await entry(course, 'alpha-student'); await read(course, 'alpha-student'); }
      assert.deepEqual(await f.snapshot(), before, 'eligibility checks neither spend nor grant any points or scholarship');
      await markPrerequisite(false);
      await read(course, 'alpha-student', 403);
      await markPrerequisite(true);
      await owner.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, learner.id]);
      await read(course, 'alpha-student', 404);
      await owner.query('UPDATE school_memberships SET revoked_at=NULL WHERE school_id=$1 AND account_id=$2', [alpha.id, learner.id]);
      await read(course, 'alpha-student');
    });

    await run('all audiences share platform points and optional requirements accept either condition', async () => {
      const learner = 'multi-student';
      const prerequisite = await create(policy({ all: rule() }));
      const requirements = { minimumPoints: 10, prerequisiteCourseIds: [prerequisite.id], requirementMode: 'any' };
      let course = await create(policy({ schools: [alpha, beta].map(school => ({ schoolId: school.id, ...rule('direct', requirements) })) }));
      await read(course, learner, 403);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read: true, expectedRevision: prerequisite.revision }, learner);
      await read(course, learner);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read: false, expectedRevision: prerequisite.revision }, learner);
      const problem = await publicProblem();
      await seedJob(problem, learner, { context: 'school' });
      await seedJob(problem, learner);
      const state = await entry(course, learner);
      assert.deepEqual(state.admissionRules.map(r => r.points.current), [10, 10]);
      assert.ok(state.admissionRules.every(r => r.requirementMode === 'any' && r.granted));
      assert.equal((await get('/points/me', learner)).points, 10);
      course = await change(course, { audiencePolicy: policy({ all: rule('direct', requirements) }) });
      await read(course, learner);
      await owner.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE problem_id=$1', [problem.problemId]);
      await owner.query('UPDATE school_memberships SET revoked_at=now() WHERE account_id=$1', [actors[learner].id]);
      await owner.query('UPDATE school_identities SET account_id=NULL,archived_at=now() WHERE account_id=$1', [actors[learner].id]);
      assert.equal((await get('/points/me', learner)).points, 10);
      await read(course, learner);
      await change(course, { audiencePolicy: policy({ all: rule('direct', { requirementMode: 'other' }) }) }, 400);
    });

    await run('self-referential or cyclic prerequisites are rejected atomically', async () => {
      const first = await create(policy({ all: rule() }), 'Cycle first');
      const second = await create(policy({ all: rule('direct', { prerequisiteCourseIds: [first.id] }) }), 'Cycle second');
      const before = await get(`/platform/courses/${first.id}`);
      await change(first, { audiencePolicy: policy({ all: rule('direct', { prerequisiteCourseIds: [first.id] }) }) }, 400);
      await change(first, { audiencePolicy: policy({ all: rule('direct', { prerequisiteCourseIds: [second.id] }) }) }, 400);
      assert.deepEqual(await get(`/platform/courses/${first.id}`), before);
      await change(first, { audiencePolicy: policy({ all: rule('direct', { prerequisiteCourseIds: [randomUUID()] }) }) }, 400);
      await change(first, { audiencePolicy: policy({ all: rule('direct', { minimumPoints: -1 }) }) }, 400);
      assert.deepEqual(await get(`/platform/courses/${first.id}`), before);
      const gated = await create(policy({ independent: rule('application') }), 'Prerequisite requiring separate admission');
      const next = await create(policy({ all: rule('direct', { prerequisiteCourseIds: [gated.id] }) }), 'Safe prerequisite metadata');
      const visible = await entry(next, 'free'), visiblePrerequisite = visible.admissionRules[0].prerequisites[0];
      assert.equal(visiblePrerequisite.title, gated.title); assert.equal(visiblePrerequisite.canOpen, true);
      assert.equal(visiblePrerequisite.requiresAdmission, true); assert.equal(visiblePrerequisite.completed, false); noLesson(visible);
      const hidden = await entry(next, 'alpha-student'), hiddenPrerequisite = hidden.admissionRules[0].prerequisites[0];
      assert.equal(hiddenPrerequisite.canOpen, false); assert.equal(hiddenPrerequisite.title, undefined);
      assert.equal(hiddenPrerequisite.completed, false); assert.ok(!JSON.stringify(hidden).includes(gated.title)); noLesson(hidden);
    });

    await run('platform points count formal public solves independent of ranking and exclude private or duplicated AC', async () => {
      const name = 'free-third';
      await owner.query('INSERT INTO public_practice_preferences(account_id,ranking_enabled,scholarship_enabled) VALUES($1,true,false) ON CONFLICT(account_id) DO UPDATE SET ranking_enabled=true,scholarship_enabled=false', [actors[name].id]);
      const ranked = await publicProblem(); await seedJob(ranked, name); await seedJob(ranked, name);
      const sample = await publicProblem(); await seedJob(sample, name, { kind: 'samples' });
      const privatePractice = await publicProblem({ approved: false }); await seedJob(privatePractice, name, { context: 'school' });
      await owner.query('UPDATE public_practice_preferences SET ranking_enabled=false WHERE account_id=$1', [actors[name].id]);
      const unranked = await publicProblem(); await seedJob(unranked, name);
      await owner.query('UPDATE public_practice_preferences SET ranking_enabled=true WHERE account_id=$1', [actors[name].id]);
      await owner.query('INSERT INTO luq_accounts(identity_id,balance) VALUES($1,999) ON CONFLICT(identity_id) DO UPDATE SET balance=999', [actors[name].identityId]);
      const course = await create(policy({ accounts: [{ identityId: actors[name].identityId, ...rule('direct', { minimumPoints: 21 }) }] }));
      let state = await entry(course, name); assert.equal(state.admission, 'requirements');
      assert.equal(state.admissionRules[0].points.source, 'platform'); assert.equal(state.admissionRules[0].points.current, 20);
      assert.equal(state.admissionRules[0].points.required, 21); await read(course, name, 403);
      const second = await publicProblem(); await seedJob(second, name);
      state = await entry(course, name); assert.equal(state.admissionRules[0].points.current, 30); assert.equal(state.admission, 'direct');
      const before = await f.snapshot(); await read(course, name); await entry(course, name);
      assert.deepEqual(await f.snapshot(), before);
      await entry(course, 'free-peer', 404);
    });

    await run('prerequisites require all reading and formal ACSL results; unavailable references cannot become zero-task passes', async () => {
      const sample = JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json', import.meta.url), 'utf8'));
      const examSentinel = 'FORMAL_EXAM_EXPLANATION_NEVER_IN_COURSE_ENTRY';
      for (const question of sample.questions) question.explanation = { en: examSentinel, zh: examSentinel };
      const paper = await importAcslPaper(owner, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: actors['legacy-admin'].id, content: sample, enablePoints: true });
      const ref = { paperSlug: sample.slug, versionId: paper.versionId, kind: 'question', questionId: 'q1' };
      const prerequisite = await create(policy({ schools: [{ schoolId: LEGACY_SCHOOL_ID, ...rule() }] }), 'Required formal ACSL', [
        { title: 'First', content: 'First original lesson', acslLinks: [ref] }, { title: 'Second', content: 'Second original lesson' },
      ]);
      const course = await create(policy({ schools: [{ schoolId: LEGACY_SCHOOL_ID, ...rule('direct', { prerequisiteCourseIds: [prerequisite.id], minimumPoints: 6 }) }] }));
      const paperPath = `/schools/${LEGACY_SCHOOL_ID}/acsl/${paper.id}`;
      const unsubmitted = await get(paperPath, 'legacy-student');
      assert.ok(!JSON.stringify(unsubmitted).includes(examSentinel));
      assert.ok(!JSON.stringify(unsubmitted).includes('correctOptionIds'));
      for (const chapter of prerequisite.chapters) await post(`/practice/courses/${prerequisite.id}/chapters/${chapter.id}/read`, { read: true, expectedRevision: prerequisite.revision }, 'legacy-student');
      const revisions = {};
      for (const question of sample.questions) {
        const saved = await patch(`${paperPath}/questions/${question.id}/draft`, { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds }, 'legacy-student'); revisions[question.id] = saved.revision;
      }
      let state = await entry(course, 'legacy-student'), progress = state.admissionRules[0].prerequisites[0];
      assert.equal(progress.readChapters, 2); assert.equal(progress.totalChapters, 2);
      assert.equal(progress.totalExercises, 1); assert.equal(progress.completedExercises, 0); assert.equal(progress.completed, false);
      await read(course, 'legacy-student', 403);
      await post(paperPath + '/submit', { versionId: paper.versionId, revisions }, 'legacy-student');
      state = await entry(course, 'legacy-student'); progress = state.admissionRules[0].prerequisites[0];
      assert.equal(progress.completedExercises, 1); assert.equal(progress.completed, true);
      assert.equal(state.admissionRules[0].points.current, 6); assert.equal(state.admission, 'direct');
      assert.ok(!JSON.stringify(state).includes(examSentinel)); await read(course, 'legacy-student');
      const before = await f.snapshot();
      await owner.query('UPDATE acsl_papers SET enabled=false WHERE school_id=$1 AND id=$2', [LEGACY_SCHOOL_ID, paper.id]);
      state = await entry(course, 'legacy-student'); progress = state.admissionRules[0].prerequisites[0];
      assert.equal(progress.available, false); assert.equal(progress.completed, false); await read(course, 'legacy-student', 403);
      assert.deepEqual(await f.snapshot(), before);
      await owner.query('UPDATE acsl_papers SET enabled=true WHERE school_id=$1 AND id=$2', [LEGACY_SCHOOL_ID, paper.id]);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[1].id}/read`, { read: false, expectedRevision: prerequisite.revision }, 'legacy-student');
      assert.equal((await entry(course, 'legacy-student')).admissionRules[0].prerequisites[0].completed, false);
      await read(course, 'legacy-student', 403);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[1].id}/read`, { read: true, expectedRevision: prerequisite.revision }, 'legacy-student');
    });

    await run('legacy aliases, resources, tutorials, progress and course-context judge admission cannot bypass a pending gate', async () => {
      const course = await create(policy({ schools: [{ schoolId: LEGACY_SCHOOL_ID, ...rule('application') }] })), chapter = course.chapters[0], r = course.audiencePolicy.schoolRules[0];
      const aliasId = (await owner.query("INSERT INTO learning_paths(owner_account_id,title,archived_at,merged_into_id,merged_first_chapter_id) VALUES($1,'Old alias with a locked target',now(),$2,$3) RETURNING id", [actors['legacy-admin'].id, course.id, chapter.id])).rows[0].id;
      const resourceId = (await owner.query("INSERT INTO learning_resources(owner_account_id,type,title,content,path_id,chapter_id,scope) VALUES($1,'note','Locked resource',$2,$3,$4,'school') RETURNING id", [actors['legacy-admin'].id, bodySentinel, course.id, chapter.id])).rows[0].id;
      const problemId = (await owner.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [actors['legacy-admin'].id])).rows[0].id;
      const versionId = (await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,samples,time_limit_ms,memory_limit_mb,validation_status)
        VALUES($1,'Public teaching fixture','stdio','Print the input.','print(input())','[{"input":"2","expected":"2","enabled":true}]',1000,128,'AC') RETURNING id`, [problemId])).rows[0].id;
      await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'3','3',100)", [versionId]);
      await owner.query("UPDATE problem_versions SET published_at=now(),rank_review_status='approved',school_visible_at=now(),rank_approved_at=now() WHERE id=$1", [versionId]);
      await owner.query('UPDATE problems SET current_version_id=$1 WHERE id=$2', [versionId, problemId]);
      await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapter.id, problemId, versionId]);
      await post('/platform/problem-publications', { schoolId: LEGACY_SCHOOL_ID, problemId, versionId });
      const before = await f.snapshot(), jobCount = (await owner.query('SELECT count(*)::int n FROM school_judge_jobs')).rows[0].n;
      const problemCatalogues = ['/problems', '/practice/problems'];
      const catalogueQuery = `?includeCourseFilters=1&courseId=${course.id}`;
      await get(`/learning-resources/${resourceId}`, 'legacy-admin', 404);
      assert.ok(!(await get('/learning-resources', 'legacy-admin')).items.some(item => item.id === resourceId), 'former resource owner and school administrator cannot bypass a platform gate');
      await patch(`/learning-resources/${resourceId}`, { content: 'Unauthorized update', pathId: null, chapterId: null }, 'legacy-admin', 403);
      await request(`/learning-resources/${resourceId}`, { name: 'legacy-admin', method: 'DELETE', status: 403 });
      const preservedResource = (await owner.query('SELECT content,path_id,archived_at FROM learning_resources WHERE id=$1', [resourceId])).rows[0];
      assert.equal(preservedResource.content, bodySentinel); assert.equal(preservedResource.path_id, course.id); assert.equal(preservedResource.archived_at, null);
      const blocked = async () => {
        await read(course, 'legacy-peer', 403);
        for (const path of problemCatalogues) {
          const result = await get(path + catalogueQuery, 'legacy-peer');
          assert.deepEqual(result.items, []);
          assert.ok(!result.courses.some(item => item.id === course.id));
        }
        await get(`/learning-paths/${course.id}`, 'legacy-peer', [403, 404]); await get(`/learning-paths/${aliasId}`, 'legacy-peer', [403, 404]);
        assert.ok(!(await get('/learning-paths', 'legacy-peer')).items.some(item => item.id === course.id));
        await get(`/learning-resources/${resourceId}`, 'legacy-peer', 404);
        assert.ok(!(await get('/learning-resources', 'legacy-peer')).items.some(item => item.id === resourceId));
        await post(`/chapters/${chapter.id}/progress`, { completed: true }, 'legacy-peer', [403, 404]);
        await post(`/practice/courses/${course.id}/chapters/${chapter.id}/read`, { read: true, expectedRevision: course.revision }, 'legacy-peer', 403);
        const tutorial = await get(`/problems/${problemId}/tutorial?courseId=${course.id}&chapterId=${chapter.id}`, 'legacy-peer');
        assert.equal(tutorial.tutorial, null); noLesson(tutorial);
        for (const kind of ['samples', 'custom', 'submit']) await post(`/practice/problems/${problemId}/submissions`, {
          requestId: randomUUID(), kind, code: 'print(input())', input: '2', language: 'python', versionId, courseId: course.id, chapterId: chapter.id,
        }, 'legacy-peer', [403, 404]);
      };
      await blocked(); await apply(course, r, 'legacy-peer'); await blocked();
      assert.equal((await owner.query('SELECT count(*)::int n FROM school_judge_jobs')).rows[0].n, jobCount);
      assert.deepEqual(await f.snapshot(), before);
      let application = (await admissions(course)).items[0]; await decision(course, application, 'approve');
      for (const path of problemCatalogues) {
        const result = await get(path + catalogueQuery, 'legacy-peer');
        assert.equal(result.courseId, course.id);
        assert.deepEqual(result.items.map(item => [item.id, item.versionId]), [[problemId, versionId]]);
        assert.ok(result.courses.some(item => item.id === course.id));
        assert.doesNotMatch(JSON.stringify(result), /referenceCode|reference_code|checkpoint/);
      }
      assert.equal((await get(`/learning-paths/${course.id}`, 'legacy-peer')).id, course.id);
      assert.equal((await get(`/learning-paths/${aliasId}`, 'legacy-peer')).id, course.id);
      assert.ok((await get('/learning-paths', 'legacy-peer')).items.some(item => item.id === course.id));
      assert.equal((await get(`/learning-resources/${resourceId}`, 'legacy-peer')).content, bodySentinel);
      assert.ok((await get('/learning-resources', 'legacy-peer')).items.some(item => item.id === resourceId));
      assert.equal((await get(`/problems/${problemId}/tutorial?courseId=${course.id}&chapterId=${chapter.id}`, 'legacy-peer')).tutorial.body, bodySentinel);
      await post(`/chapters/${chapter.id}/progress`, { completed: true }, 'legacy-peer');
      await post(`/practice/problems/${problemId}/submissions`, { requestId: randomUUID(), kind: 'samples', code: 'print(input())', language: 'python', versionId, courseId: course.id, chapterId: chapter.id }, 'legacy-peer', 202);
      const existingProgress = await f.snapshot();
      application = (await admissions(course)).items[0]; await decision(course, application, 'revoke');
      await blocked(); assert.deepEqual(await f.snapshot(), existingProgress, 'revoking access preserves existing reading and grades');
    });

    await run('rule removal and restoration invalidate old grants while unrelated edits preserve matching generations', async () => {
      let course = await create(policy({ independent: rule('application'), schools: [{ schoolId: alpha.id, ...rule() }] }));
      const previous = course.audiencePolicy.independentRule, alphaRule = course.audiencePolicy.schoolRules[0];
      await apply(course, previous, 'free'); let application = (await admissions(course)).items[0]; await decision(course, application, 'approve');
      await apply(course, previous, 'free-peer');
      assert.equal((await get(`/platform/courses/${course.id}`)).pendingApplications, 1);
      await read(course, 'free');
      course = await change(course, { audiencePolicy: policy({ independent: previous, schools: [{ ...alphaRule, minimumPoints: 1 }] }) });
      assert.equal(course.audiencePolicy.independentRule.generation, previous.generation); assert.equal(course.pendingApplications, 1); await read(course, 'free');
      course = await change(course, { audiencePolicy: policy({ schools: course.audiencePolicy.schoolRules }) });
      assert.equal(course.pendingApplications, 0);
      assert.ok((await admissions(course)).items.every(item => item.current === false));
      await read(course, 'free', 404); await apply(course, previous, 'free', [404, 409]);
      course = await change(course, { audiencePolicy: policy({ independent: rule('application'), schools: course.audiencePolicy.schoolRules }) });
      assert.notEqual(course.audiencePolicy.independentRule.generation, previous.generation);
      assert.equal(course.pendingApplications, 0, 'historical pending requests cannot inflate the current review count');
      assert.equal((await entry(course, 'free')).admission, 'apply'); await read(course, 'free', 403);
      application = (await admissions(course)).items.find(a => a.id === application.id);
      if (application) await decision(course, application, 'approve', 'platform', 409);
    });

    await run('ordinary prerequisite progress accepts existing school and public formal AC with language cutoffs intact', async () => {
      let prerequisite = await create(policy({ all: rule() }), 'Ordinary formal prerequisite');
      prerequisite = await change(prerequisite, { requiredLanguage: 'python' });
      const chapter = prerequisite.chapters[0];
      const problemId = (await owner.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [actors['legacy-admin'].id])).rows[0].id;
      const versionId = (await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,samples,time_limit_ms,memory_limit_mb,validation_status)
        VALUES($1,'Prerequisite public fixture','stdio','Print the input.','print(input())','[{"input":"2","expected":"2","enabled":true}]',1000,128,'AC') RETURNING id`, [problemId])).rows[0].id;
      await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'3','3',100)", [versionId]);
      await owner.query("UPDATE problem_versions SET published_at=now(),rank_review_status='approved',school_visible_at=now(),rank_approved_at=now() WHERE id=$1", [versionId]);
      await owner.query('UPDATE problems SET current_version_id=$1 WHERE id=$2', [versionId, problemId]);
      await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapter.id, problemId, versionId]);
      await post('/platform/problem-publications', { schoolId: LEGACY_SCHOOL_ID, problemId, versionId });
      const course = await create(policy({ all: rule('direct', { prerequisiteCourseIds: [prerequisite.id] }) }));
      for (const name of ['legacy-peer', 'free-peer', 'free-third']) await post(`/practice/courses/${prerequisite.id}/chapters/${chapter.id}/read`, { read: true, expectedRevision: prerequisite.revision }, name);
      const legacyResult = async (kind, language) => owner.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,language,code,idempotency_key,request_hash,status,score,passed,total)
        VALUES($1,$2,$3,$4,$5,$6,'fixture',$7,'fixture','AC',100,1,1)`, [actors['legacy-peer'].id, actors['legacy-peer'].identityId, problemId, versionId, kind, language, randomUUID()]);
      await legacyResult('samples', 'python'); await legacyResult('submit', 'cpp');
      assert.equal((await entry(course, 'legacy-peer')).admissionRules[0].prerequisites[0].completed, false);
      await legacyResult('submit', 'python');
      assert.equal((await get(`/learning-paths/${prerequisite.id}`, 'legacy-peer')).completedTasks, 1);
      assert.equal((await entry(course, 'legacy-peer')).admissionRules[0].prerequisites[0].completed, true); await read(course, 'legacy-peer');
      const publicRef = { schoolId: LEGACY_SCHOOL_ID, problemId, versionId };
      await seedJob(publicRef, 'free-peer');
      assert.equal((await read(prerequisite, 'free-peer')).completedExercises, 1);
      assert.equal((await entry(course, 'free-peer')).admissionRules[0].prerequisites[0].completed, true); await read(course, 'free-peer');
      prerequisite = await change(prerequisite, { requiredLanguage: 'cpp' });
      assert.equal((await entry(course, 'legacy-peer')).admissionRules[0].prerequisites[0].completed, true, 'previously qualifying Python school AC survives policy change');
      assert.equal((await entry(course, 'free-peer')).admissionRules[0].prerequisites[0].completed, true, 'previously qualifying Python public AC survives policy change');
      await seedJob(publicRef, 'free-third');
      assert.equal((await entry(course, 'free-third')).admissionRules[0].prerequisites[0].completed, false, 'new Python AC cannot satisfy the new C++ policy');
      await read(course, 'free-third', 403);
    });

    await run('invitation redemption and existing approvals recheck requirements and do not bypass scoped membership', async () => {
      const prerequisite = await create(policy({ all: rule() }), 'Invitation prerequisite');
      const course = await create(policy({ schools: [{ schoolId: alpha.id, ...rule('invite', { minimumPoints: 10, prerequisiteCourseIds: [prerequisite.id] }) }] }));
      const r = course.audiencePolicy.schoolRules[0], issued = await invite(course, r), learner = actors['alpha-peer'];
      await redeem(course, r, issued.code, 'alpha-peer', 403); await redeem(course, r, issued.code, 'beta-student', 404);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read: true, expectedRevision: prerequisite.revision }, 'alpha-peer');
      await redeem(course, r, issued.code, 'alpha-peer', 403);
      await seedJob(await publicProblem(), 'alpha-peer');
      await redeem(course, r, issued.code, 'alpha-peer'); await read(course, 'alpha-peer');
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read: false, expectedRevision: prerequisite.revision }, 'alpha-peer');
      await read(course, 'alpha-peer', 403);
      await post(`/practice/courses/${prerequisite.id}/chapters/${prerequisite.chapters[0].id}/read`, { read: true, expectedRevision: prerequisite.revision }, 'alpha-peer');
      await read(course, 'alpha-peer');
      await owner.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, learner.id]);
      await read(course, 'alpha-peer', 404);
      await owner.query('UPDATE school_memberships SET revoked_at=NULL WHERE school_id=$1 AND account_id=$2', [alpha.id, learner.id]);
      await read(course, 'alpha-peer');
    });

    await run('earned legacy points follow the same login through a real school exit', async () => {
      const name = 'legacy-peer';
      const problem = (await owner.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [actors['legacy-admin'].id])).rows[0];
      const version = (await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,time_limit_ms,memory_limit_mb,validation_status,
        published_at,school_visible_at,rank_review_status,rank_approved_at)
        VALUES($1,'Legacy earned points','stdio','Print the input.','print(input())',1000,128,'AC',now(),now(),'approved',now()) RETURNING id`, [problem.id])).rows[0];
      const bank = (await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Legacy points bank','school') RETURNING id", [actors['legacy-admin'].id])).rows[0];
      await owner.query('UPDATE problems SET bank_id=$2,current_version_id=$3 WHERE id=$1', [problem.id, bank.id, version.id]);
      const pointsBefore = (await get('/points/me', name)).points;
      await owner.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,language,code,idempotency_key,request_hash,status,score,passed,total)
        VALUES($1,$2,$3,$4,'submit','python','fixture',$5,'fixture','AC',100,1,1)`, [actors[name].id, actors[name].identityId, problem.id, version.id, randomUUID()]);
      const earned = (await get('/points/me', name)).points;
      assert.equal(earned, pointsBefore + 10);
      const exit = await post(`/schools/${LEGACY_SCHOOL_ID}/exit-request`, {}, name, 201);
      await post(`/schools/${LEGACY_SCHOOL_ID}/exit-requests/${exit.request.id}/decision`, { decision: 'approve' }, 'legacy-admin');
      assert.equal((await get('/points/me', name)).points, earned);
      const course = await create(policy({ independent: rule('direct', { minimumPoints: earned }) }));
      await read(course, name);
    });

    await run('concurrent edits cannot introduce a prerequisite cycle across two courses', async () => {
      const first = await create(policy({ all: rule() }), 'Concurrent dependency A');
      const second = await create(policy({ all: rule() }), 'Concurrent dependency B');
      const edits = await Promise.all([[first, second], [second, first]].map(([course, dependency]) => request(`/platform/courses/${course.id}`, {
        method: 'PATCH', status: [200, 400, 409], body: { ...cas(course), audiencePolicy: policy({ all: rule('direct', { prerequisiteCourseIds: [dependency.id] }) }) },
      })));
      assert.equal(edits.filter(result => result.status === 200).length, 1);
      assert.equal(edits.filter(result => result.status !== 200).length, 1);
      const paths = await Promise.all([first, second].map(course => get(`/platform/courses/${course.id}`)));
      assert.equal(paths.filter(course => course.audiencePolicy.allRule.prerequisiteCourseIds.length === 1).length, 1);
    });

    if (process.env.TEST_KEEP_PLATFORM_ADMISSION_FIXTURE && passedCases === 18) {
      const browserCourse = await create(policy({ independent: rule('application'), schools: [{ schoolId: alpha.id, ...rule() }, { schoolId: beta.id, ...rule('invite') }] }), 'QA platform admission: three routes', [
        { title: 'An original bilingual lesson', content: 'Read the explanation before completing the checkpoint.', objective: 'Understand the admission flow', checkpoint: 'Explain one rule in your own words.', checkpointAnswer: 'Rules combine an audience with requirements and an admission method.', localizations: { en: { title: 'An original bilingual lesson', content: 'Read the explanation before completing the checkpoint.', objective: 'Understand the admission flow', checkpoint: 'Explain one rule in your own words.', checkpointAnswer: 'Rules combine an audience with requirements and an admission method.' }, zh: { title: '原创双语课时', content: '阅读讲解，再完成检查点。', objective: '理解课程准入流程', checkpoint: '用自己的话解释一条规则。', checkpointAnswer: '规则由目标人群、前置条件和准入方式组成。' } } },
      ]);
      const browserPrerequisite = await create(policy({ all: rule() }), 'QA prerequisite reading', [{ title: 'Read first', content: 'Mark this original lesson as read.' }]);
      const browserGated = await create(policy({ independent: rule('application', { minimumPoints: 1000, prerequisiteCourseIds: [browserPrerequisite.id] }) }), 'QA unmet requirements');
      await f.retain({ browserCourse, browserPrerequisite, browserGated });
    }
  } finally { await f.close(); }
});
