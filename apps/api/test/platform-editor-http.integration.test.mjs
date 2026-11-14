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
import { canEditPlatformContent } from '../../../packages/domain/src/platform-content-access.mjs';
import { SCHOOL_BANK } from '../../../packages/domain/src/library.mjs';
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
    for (const name of ['platform', 'school-admin', 'teacher', 'other-teacher', 'student', 'legacy-editor', 'course-editor', 'history-student', 'history-other']) {
      const identityId = randomUUID(), legacy = name === 'legacy-editor' || name.startsWith('history-'), legacyStudent = name.startsWith('history-');
      await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identityId, legacyStudent ? 'student' : legacy ? 'teacher' : 'personal', name]);
      actors[name] = { identityId, ...(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, name, hash])).rows[0] };
      if (legacy) {
        await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [actors[name].id, legacyStudent ? 'student' : 'teacher']);
        await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [actors[name].id]);
      }
    }
    await provisionPlatformAdministrator(pool, { username: 'platform' });
    const alpha = await provisionSchool(pool, { slug: 'editor-alpha', name: 'Editor Alpha', adminUsername: 'school-admin' });
    const beta = await provisionSchool(pool, { slug: 'editor-beta', name: 'Editor Beta', adminUsername: 'other-teacher' });
    for (const school of [alpha, beta]) for (const name of ['teacher', 'course-editor']) await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'teacher')", [school.id, actors[name].id]);
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
    await t.test('authorized teachers save a draft on the same problem, validate, but cannot publish', async () => {
      const original = await get(`${source}/${problem.id}`, 'teacher');
      const changed = { ...input, title: 'Edited platform source', tags: ['Draft Topic'], expectedVersionId: original.versionId, expectedRevision: original.editRevision };
      latest = await post(`${source}/${problem.id}/versions`, changed, 'teacher', 201);
      assert.equal(latest.versionId, original.versionId); assert.equal(latest.editRevision, original.editRevision+1);
      assert.equal(latest.tests[0].input, input.tests[0].input);
      const summary = `${source}?schoolId=${alpha.id}&view=summary`;
      const editableRow = (await get(summary, 'teacher')).items.find(row => row.id === problem.id);
      assert.deepEqual(editableRow.tags, input.tags);
      assert.deepEqual(editableRow.draftTags, changed.tags);
      for (const name of ['other-teacher', 'student']) assert.deepEqual((await get(summary, name)).items, []);
      await post(`${source}/${problem.id}/versions`, { ...changed, title: 'Stale edit' }, 'school-admin', 409);
      await post(`${source}/${problem.id}/validate`, { versionId: other.versionId }, 'teacher', 404);
      await post(`${source}/${problem.id}/validate`, { versionId: latest.versionId }, 'student', 403);
      const validation = await post(`${source}/${problem.id}/validate`, { versionId: latest.versionId, expectedRevision: latest.editRevision }, 'teacher');
      assert.equal(validation.versionId, latest.versionId);
      await post(`${source}/${problem.id}/publish`, { expectedVersionId: latest.versionId }, 'teacher', 403);
      await post(`${source}/${problem.id}/publish`, { expectedVersionId: latest.versionId, expectedRevision: latest.editRevision }, 'platform', 409);
      const judge = { environmentVersion: 'platform-editor-fixture', judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'platform-editor-fixture' }) };
      for (let count = 0; count < 5 && await processOne({ pool: worker, judge, logger: {} }); count++) { /* Drain only this isolated fixture's validation tasks. */ }
      const checked = await get(`${source}/${problem.id}`, 'teacher'); assert.equal(checked.validationStatus, 'AC');
      assert.equal(checked.canRequestReview,true);
      const review={expectedVersionId:checked.versionId,expectedRevision:checked.editRevision};
      await post(`${source}/${problem.id}/request-review`,{...review,expectedRevision:0},'teacher',409);
      await post(`${source}/${problem.id}/request-review`,review,'student',403);
      const submitted=await post(`${source}/${problem.id}/request-review`,review,'teacher');
      assert.equal(submitted.draftReviewStatus,'pending');
      assert.equal(submitted.canRequestReview,false);
      assert.equal((await get(source)).items[0].id,problem.id,'requested reviews appear first');
      assert.equal((await get(source)).items[0].draftReviewStatus,'pending');
      assert.equal((await get(`${source}/${problem.id}`)).canPublish,true);
      latest = await post(`${source}/${problem.id}/publish`, { expectedVersionId: checked.versionId, expectedRevision: checked.editRevision });
      assert.equal(latest.published, true);
      const publishedRow = (await get(summary, 'teacher')).items.find(row => row.id === problem.id);
      assert.deepEqual(publishedRow.tags, changed.tags);
      assert.equal(publishedRow.draftTags, undefined);
      assert.equal((await pool.query('SELECT version_id FROM chapter_problems WHERE problem_id=$1', [problem.id])).rowCount, 0);
      for (const path of [`/problems/${problem.id}/versions`, `/problems/${problem.id}/publish`]) await post(path, { ...changed, versionId: latest.versionId }, 'legacy-editor', 403);
    });
    await t.test('batch review queues only authorized and validated draft revisions and keeps published content live', async () => {
      const batch = `${source}/request-review-batch`;
      const summary = `${source}?schoolId=${alpha.id}&view=summary`;
      const judge = { environmentVersion: 'platform-batch-review-fixture', judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'platform-batch-review-fixture' }) };
      const drain = async () => { while (await processOne({ pool: worker, judge, logger: {} })) { /* Isolated fixture queue. */ } };
      const makePublished = async title => {
        const created = await post(source, { ...input, title }, 'platform', 201);
        await drain();
        return post(`${source}/${created.id}/publish`, { expectedVersionId: created.versionId });
      };
      const fixtures = [];
      for (const name of ['First', 'Second', 'Waiting', 'Stale']) fixtures.push(await makePublished(`${name} batch review fixture`));
      const [first, second, waiting, stale] = fixtures;
      for (const row of fixtures) {
        await post(`/platform/content-editors/problem/${row.id}`, grant('teacher'));
      }
      const update = row => post(`${source}/${row.id}/versions`, {
        ...input, title: row.title + ' draft', tags: ['Updated topic'], expectedVersionId: row.versionId, expectedRevision: row.editRevision,
      }, 'teacher', 201);
      const firstDraft = await update(first), secondDraft = await update(second), staleDraft = await update(stale);
      await drain();
      const waitingDraft = await update(waiting);
      await update(staleDraft);
      const itemsById = new Map((await get(summary, 'teacher')).items.map(row => [row.id, row]));
      assert.equal(itemsById.get(first.id).draftValidationStatus, 'AC');
      assert.equal(itemsById.get(first.id).editRevision, firstDraft.editRevision);
      assert.equal(itemsById.get(first.id).canRequestReview, true);
      assert.equal(itemsById.get(waiting.id).draftValidationStatus, 'Waiting');
      assert.equal(itemsById.get(waiting.id).canRequestReview, false);
      const item = row => ({ problemId: row.id, expectedVersionId: row.versionId, expectedRevision: row.editRevision });
      await post(batch, { items: [item(firstDraft)] }, 'student', 403);
      await request(batch, { name: 'teacher', method: 'POST', body: { items: [item(firstDraft)] }, csrf: false, status: 403 });
      await post(batch, { items: [item(firstDraft), item(firstDraft)] }, 'teacher', 400);
      const payload = { items: [firstDraft, waitingDraft, staleDraft, secondDraft].map(item).concat({ ...item(other), expectedRevision: 1 }) };
      const expected = [
        { problemId: first.id, status: 'submitted' },
        { problemId: waiting.id, status: 'skipped', code: 'NOT_VALIDATED' },
        { problemId: stale.id, status: 'skipped', code: 'REVISION_CONFLICT' },
        { problemId: second.id, status: 'submitted' },
        { problemId: other.id, status: 'skipped', code: 'UNAVAILABLE' },
      ];
      assert.deepEqual((await post(batch, payload, 'teacher')).items, expected);
      assert.deepEqual((await post(batch, payload, 'teacher')).items, expected.map(row => row.status === 'submitted' ? { ...row, status: 'pending' } : row));
      const saved = (await get(summary, 'teacher')).items.find(row => row.id === first.id);
      assert.equal(saved.draftReviewStatus, 'pending');
      assert.equal(saved.canRequestReview, false);
      assert.deepEqual(saved.tags, input.tags);
      const live = await get(`/problems/${first.id}?current=1`, 'history-student');
      assert.deepEqual(live.tags, input.tags);
      const release = { expectedVersionId: firstDraft.versionId, expectedRevision: firstDraft.editRevision };
      await post(`${source}/${first.id}/publish`, release, 'teacher', 403);
      const audit = await pool.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action='platform.problem.request_review' AND detail->>'problemId' = ANY($1)", [[first.id, second.id]]);
      assert.equal(audit.rows[0].count, 2, 'Retries do not duplicate review requests');
      await drain();

      const publishBatch = `${source}/publish-batch`;
      const adminRows = new Map((await get(`${source}?view=summary`)).items.map(row => [row.id, row]));
      assert.equal(adminRows.get(first.id).draftTitle, firstDraft.title);
      assert.equal(adminRows.get(first.id).draftValidationStatus, 'AC');
      assert.equal(adminRows.get(waiting.id).draftTitle, undefined);
      assert.equal(saved.draftTitle, undefined, 'Review list title belongs to the administrator summary');
      assert.equal(adminRows.get(waiting.id).draftValidationStatus, 'AC');

      await post(`${source}/${stale.id}/request-review`, item(await get(`${source}/${stale.id}`, 'teacher')), 'teacher');
      // Model a validation run whose result is no longer usable at confirmation time.
      await pool.query(`UPDATE judge_runs SET status='WA' WHERE task_id=(SELECT draft_validation_task_id FROM problem_versions WHERE id=$1)`, [staleDraft.versionId]);
      const noLongerValidated = await get(`${source}/${stale.id}`, 'teacher');
      assert.equal(noLongerValidated.validationStatus, 'WA');
      assert.equal(noLongerValidated.draftReviewStatus, 'pending');

      const publishPayload = { items: [firstDraft, waitingDraft, secondDraft, noLongerValidated].map(item).concat({ ...item(other), expectedRevision: 1 }) };
      for (const name of ['teacher', 'school-admin', 'student']) await post(publishBatch, publishPayload, name, 403);
      await request(publishBatch, { method: 'POST', body: publishPayload, csrf: false, status: 403 });
      await post(publishBatch, { items: [item(firstDraft), item(firstDraft)] }, 'platform', 400);
      assert.deepEqual((await post(publishBatch, { items: [item(staleDraft)] })).items, [{ problemId: stale.id, status: 'skipped', code: 'REVISION_CONFLICT' }]);
      const publication = [
        { problemId: first.id, status: 'published' },
        { problemId: waiting.id, status: 'skipped', code: 'REVIEW_REQUIRED' },
        { problemId: second.id, status: 'published' },
        { problemId: stale.id, status: 'skipped', code: 'NOT_VALIDATED' },
        { problemId: other.id, status: 'skipped', code: 'REVISION_CONFLICT' },
      ];
      assert.deepEqual((await post(publishBatch, publishPayload)).items, publication);
      assert.deepEqual((await post(publishBatch, publishPayload)).items, publication.map(row => row.status === 'published' ? { ...row, status: 'already_published' } : row));
      for (const row of [first, second]) {
        const published = await get(`/problems/${row.id}?current=1`, 'history-student');
        assert.deepEqual(published.tags, ['Updated topic']);
        assert.equal(published.versionId, row.versionId);
        assert.equal((await get(`${source}/${row.id}`)).draftReviewStatus, null);
      }
      for (const row of [stale, waiting]) assert.deepEqual((await get(`/problems/${row.id}?current=1`, 'history-student')).tags, input.tags);
      const releases = await pool.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action='platform.problem.publish' AND detail->>'problemId' = ANY($1) AND detail ? 'revision'", [[first.id, second.id]]);
      assert.equal(releases.rows[0].count, 2, 'Retries do not repeat promotions');
      for (const row of fixtures) {
        await request(`/platform/content-editors/problem/${row.id}`, { method: 'DELETE', body: grant('teacher') });
      }
      await post(batch, payload, 'teacher', 403);
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
    await t.test('school review keeps the live question and prior submission intact through rejection and approval', async () => {
      const judge = {environmentVersion:'fixture',judge:async()=>({status:'AC',score:100,passed:1,total:1,publicOutput:'',publicMessage:'',privateResults:[],environmentVersion:'fixture'})};
      const drain=async()=>{for(let i=0;i<6&&await processOne({pool:worker,judge,logger:{}});i++);};
      const draft=await post('/problems',{...input,bankId:SCHOOL_BANK},'legacy-editor',201);
      const path='/problems/'+draft.id, student='history-student', admin='legacy-admin', teacher='legacy-editor';
      const key={versionId:draft.versionId,expectedRevision:draft.editRevision};
      await drain();
      await post(path+'/publish',key,teacher);
      await get(path+'?current=1',student,404);
      await patch(path+'/rank-review',{...key,decision:'approved'},admin);
      const before=await get(path+'?current=1',student);
      const accepted=await post('/submissions',{problemId:draft.id,versionId:draft.versionId,publishedRevision:before.publishedRevision,
        kind:'submit',code:'print(input())',idempotencyKey:randomUUID()},student,201);
      await drain();
      const history=await get('/submissions/'+accepted.id,student);
      const baseline=await get(path+'?current=1',student);
      const save=revision=>post(path+'/versions',{...input,title:'Approved replacement',statement:'Read the next value and echo it.',tags:[],
        bankId:SCHOOL_BANK,expectedVersionId:draft.versionId,expectedRevision:revision},teacher,201);
      const proposal=await save(draft.editRevision);
      assert.equal(proposal.versionId,draft.versionId);
      const teacherRow=(await get('/problems?view=summary',teacher)).items.find(row=>row.id===draft.id);
      assert.deepEqual(teacherRow.tags,input.tags);
      assert.deepEqual(teacherRow.draftTags,[]);
      const pickerRow=(await get('/problems?view=summary&purpose=assignment',teacher)).items.find(row=>row.id===draft.id);
      assert.equal(pickerRow.draftTags,undefined);
      const studentRow=(await get('/problems?view=student-summary',student)).items.find(row=>row.id===draft.id);
      assert.deepEqual(studentRow.tags,input.tags);
      assert.equal(studentRow.draftTags,undefined);
      await drain();
      const revisionKey={versionId:draft.versionId,expectedRevision:proposal.editRevision};
      await post(path+'/publish',revisionKey,teacher);
      assert.deepEqual(await get(path+'?current=1',student),baseline);
      const queued=(await get('/problems/rank-review',admin)).items.find(row=>row.problemId===draft.id);
      assert.equal(queued.title,proposal.title); assert.equal(queued.editRevision,proposal.editRevision);
      await patch(path+'/rank-review',{...revisionKey,decision:'rejected',reason:'Check the examples again'},admin);
      assert.deepEqual(await get(path+'?current=1',student),baseline);
      const next=await save(proposal.editRevision);
      await drain();
      const nextKey={versionId:draft.versionId,expectedRevision:next.editRevision};
      await post(path+'/publish',nextKey,teacher);
      await patch(path+'/rank-review',{...revisionKey,decision:'approved'},admin,409);
      await patch(path+'/rank-review',{...nextKey,decision:'approved'},admin);
      const after=await get(path+'?current=1',student);
      assert.equal(after.title,next.title); assert.equal(after.versionId,before.versionId);
      assert.deepEqual(after.tags,[]);
      assert.equal(after.solved,baseline.solved); assert.equal(after.publishedRevision,next.editRevision);
      const old=await get('/submissions/'+accepted.id,student);
      assert.equal(old.id,history.id); assert.equal(old.status,'AC'); assert.equal(old.score,history.score);
      const freshBody={problemId:draft.id,versionId:draft.versionId,publishedRevision:after.publishedRevision,
        kind:'submit',code:'print(input())'};
      const fresh=await post('/submissions',{...freshBody,idempotencyKey:randomUUID()},student,201);
      assert.notEqual(fresh.id,accepted.id,'old AC must not block code on the new definition');
      await post('/submissions',{...freshBody,idempotencyKey:randomUUID()},student,409);
      assert.equal((await pool.query('SELECT count(*)::int n FROM problem_versions WHERE problem_id=$1',[draft.id])).rows[0].n,1);
      await post('/submissions',{problemId:draft.id,versionId:draft.versionId,publishedRevision:before.publishedRevision,
        kind:'samples',code:'print(input())',idempotencyKey:randomUUID()},student,409);
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
      const retiredSourceId = randomUUID();
      await pool.query('UPDATE luq_assistance_contents SET version_id=$2 WHERE id=$1', [content.id, retiredSourceId]);
      const retained = (await get(`${path}?versionId=${latest.versionId}`, 'teacher')).items[0];
      assert.equal(retained.versionId, retiredSourceId);
      const update = await post(path, { ...draft, expectedHash: retained.contentHash,
        solutions: [{ title: 'Updated method', body: 'Read the input and print it once.', programmingLanguage: 'python' }] }, 'teacher', 201);
      assert.equal(update.id, content.id); assert.equal(update.hasPendingSolutions, true);
      await post(`${path}/${content.id}/publish`, { reviewed: true, expectedHash: update.contentHash }, 'teacher', 403);
      const promoted = await post(`${path}/${content.id}/publish`, { reviewed: true, expectedHash: update.contentHash });
      assert.equal(promoted.id, content.id); assert.equal(promoted.versionId, retiredSourceId);
      assert.equal(promoted.solutions[0].title, 'Updated method');
      assert.equal(Boolean(promoted.hasPendingSolutions), false);
    });
    await t.test('course grants also merge by school without inheriting publication or audience powers', async () => {
      const course = await post('/platform/courses', { requestId: randomUUID(), title: 'Scoped course editor', chapters: [{ title: 'Lesson', content: 'Lesson source.', problems: [{ problemId: problem.id, versionId: latest.versionId }] }] }, 'platform', 201);
      await post(`/platform/content-editors/course/${course.id}`, grant('teacher'));
      assert.ok((await get(`/platform/courses?schoolId=${alpha.id}`, 'teacher')).items.some(c => c.id === course.id));
      assert.ok(!(await get(`/platform/courses?schoolId=${beta.id}`, 'teacher')).items.some(c => c.id === course.id));
      assert.equal((await get(`/platform/courses/${course.id}`, 'teacher')).chapters[0].problems[0].canEdit, true);
      await post(`/platform/content-editors/course/${course.id}`, grant('other-teacher', beta.id));
      assert.equal((await get(`/platform/courses/${course.id}`, 'other-teacher')).chapters[0].problems[0].canEdit, true);
      const picker = await get(`/platform/courses/problem-options?courseId=${course.id}`, 'other-teacher');
      const option = picker.items.find(item => item.problemId === problem.id);
      assert.ok(option); assert.deepEqual(option.metadata, { difficulty: input.difficulty });
      assert.doesNotMatch(JSON.stringify(picker), /PRIVATE_EDITORIAL|PRIVATE_PLATFORM_CASE|referenceCode|reference_code/);
      assert.equal((await get(`${source}/${problem.id}`, 'other-teacher')).canEdit, true);
      const edit = { expectedRevision: course.revision, sourceVersion: course.sourceVersion };
      await patch(`/platform/courses/${course.id}`, { ...edit, audienceScope: 'students', studentIds: [actors.student.identityId] }, 'teacher', 403);
      await post(`/platform/courses/${course.id}/publish`, edit, 'teacher', 403);
      await post(`/platform/content-editors/course/${course.id}`, grant('teacher', beta.id));
      await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, actors.teacher.id]);
      assert.ok(!(await get(`/platform/courses?schoolId=${alpha.id}`, 'teacher')).items.some(c => c.id === course.id), 'an active grant in another school must not revive this school role');
      assert.ok((await get(`/platform/courses?schoolId=${beta.id}`, 'teacher')).items.some(c => c.id === course.id));
      await pool.query('UPDATE school_memberships SET revoked_at=NULL WHERE school_id=$1 AND account_id=$2', [alpha.id, actors.teacher.id]);
      for (const [name, schoolId] of [['teacher', alpha.id], ['teacher', beta.id], ['other-teacher', beta.id]]) await request(`/platform/content-editors/course/${course.id}`, { method: 'DELETE', body: grant(name, schoolId) });
    });
    await t.test('a platform course review grant lets only an active school administrator publish linked pending drafts', async () => {
      const course = await post('/platform/courses', { requestId: randomUUID(), title: 'Scoped reviewer course', chapters: [{ title: 'Lesson', content: 'Lesson source.', problems: [{ problemId: problem.id, versionId: latest.versionId }] }] }, 'platform', 201);
      const path = `/platform/content-editors/course/${course.id}`;
      const body = { ...grant('school-admin'), canReviewLinkedProblems: true };
      await post(path, { ...grant('teacher'), canReviewLinkedProblems: true }, 'platform', 400);
      await post(path, body, 'school-admin', 403);
      await post(path, grant('school-admin'));
      const queue = `${source}?view=summary&reviewQueue=1&schoolId=${alpha.id}`;
      const judge = { environmentVersion: 'review-grant', judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'review-grant' }) };
      const old = await get(`${source}/${problem.id}`, 'teacher');
      const draft = await post(`${source}/${problem.id}/versions`, { ...input, tags: ['Delegated change'], expectedVersionId: old.versionId, expectedRevision: old.editRevision }, 'teacher', 201);
      while (await processOne({ pool: worker, judge, logger: {} })) { /* Drain this isolated fixture. */ }
      const target = { problemId: problem.id, expectedVersionId: draft.versionId, expectedRevision: draft.editRevision };
      const batch = `${source}/publish-batch`;
      await post(batch, { items: [target] }, 'school-admin', 403);
      const authorization = await post(path, body);
      assert.deepEqual(authorization.items[0].reviewResourceIds, [course.id]);
      assert.deepEqual((await post(batch, { items: [target] }, 'school-admin')).items, [{ problemId: problem.id, status: 'skipped', code: 'REVIEW_REQUIRED' }]);
      await post(`${source}/${problem.id}/request-review`, target, 'teacher');
      assert.deepEqual((await get(queue, 'school-admin')).items.map(row => row.id), [problem.id]);
      assert.deepEqual((await get(queue, 'teacher')).items, []);
      await post(batch, { items: [{ ...target, problemId: other.id }] }, 'school-admin', 403);
      await post('/platform/problem-publications', { schoolId: LEGACY_SCHOOL_ID, problemId: problem.id, versionId: draft.versionId }, 'school-admin', 403);
      await post(path, { ...body, canReviewLinkedProblems: false });
      assert.deepEqual((await get(queue, 'school-admin')).items, []);
      await post(batch, { items: [target] }, 'school-admin', 403);
      await post(path, body);
      const published = (await post(batch, { items: [target] }, 'school-admin')).items[0];
      assert.equal(published.status, 'published');
      assert.equal((await post(batch, { items: [target] })).items[0].status, 'already_published');
      assert.deepEqual((await get(`/problems/${problem.id}?current=1`, 'history-student')).tags, ['Delegated change']);
      assert.equal((await pool.query('SELECT 1 FROM school_problem_publications WHERE problem_id=$1 AND withdrawn_at IS NULL', [problem.id])).rowCount, 0);
      await request(path, { method: 'DELETE', body: grant('school-admin') });
      latest = await get(`${source}/${problem.id}`);

      const courseOnly = await post(source, { ...input, title: 'Practice for admitted learners' }, 'platform', 201);
      const restrictedCourse = await post('/platform/courses', { requestId: randomUUID(), title: 'Restricted practice course',
        audienceScope: 'students', studentIds: [actors.student.identityId], chapters: [{ title: 'Practice', content: 'Practice lesson.' }] }, 'platform', 201);
      const chapterId = restrictedCourse.chapters[0].id;
      // Imported course links can already reference an unpublished source.
      await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapterId, courseOnly.id, courseOnly.versionId]);
      await post(`/platform/content-editors/course/${restrictedCourse.id}`, body);
      await post(`/platform/content-editors/course/${restrictedCourse.id}`, grant('teacher'));
      const initialDraft = await post(`${source}/${courseOnly.id}/versions`, { ...input, title: courseOnly.title,
        expectedVersionId: courseOnly.versionId, expectedRevision: courseOnly.editRevision }, 'teacher', 201);
      while (await processOne({ pool: worker, judge, logger: {} })) { /* Drain this isolated fixture. */ }
      const initialTarget = { problemId: courseOnly.id, expectedVersionId: courseOnly.versionId, expectedRevision: initialDraft.editRevision };
      await post(`${source}/${courseOnly.id}/request-review`, initialTarget, 'teacher');
      assert.equal((await get(`${source}/${courseOnly.id}`, 'school-admin')).canPublish, true);
      await post(`${source}/${courseOnly.id}/publish`, initialTarget, 'school-admin');
      const audience = await pool.query('SELECT course_only_published,school_visible_at FROM problem_versions WHERE id=$1', [courseOnly.versionId]);
      assert.deepEqual(audience.rows[0], { course_only_published: true, school_visible_at: null });
      assert.equal((await get(`/platform/courses/${restrictedCourse.id}`)).chapters[0].problems[0].readyForCourse, true);
      await post(`/platform/courses/${restrictedCourse.id}/publish`, { expectedRevision: restrictedCourse.revision, sourceVersion: restrictedCourse.sourceVersion });
      const practice = `/practice/problems/${courseOnly.id}`;
      const inCourse = `${practice}?courseId=${restrictedCourse.id}&chapterId=${chapterId}`;
      assert.equal((await get(inCourse, 'student')).id, courseOnly.id);
      await get(inCourse, 'history-student', 404);
      await get(practice, 'history-student', 404);
      assert.deepEqual((await get(`/practice/problems?q=${courseOnly.id}`, 'student')).items, []);
      await request(`/platform/content-editors/course/${restrictedCourse.id}`, { method: 'DELETE', body: grant('teacher') });
      await request(`/platform/content-editors/course/${restrictedCourse.id}`, { method: 'DELETE', body: grant('school-admin') });
    });
    await t.test('batch grants are atomic and current course links derive revocable, school-specific problem editing', async () => {
      const makeCourse = title => post('/platform/courses', { requestId: randomUUID(), title, chapters: [{ title: 'Linked lesson', content: 'Original lesson', problems: [{ problemId: problem.id, versionId: latest.versionId }] }] }, 'platform', 201);
      const first = await makeCourse('Inherited editor one'), second = await makeCourse('Inherited editor two');
      const schoolProblem = await post('/problems', { ...input, title: 'Private school problem', bankId: SCHOOL_BANK }, 'legacy-admin', 201);
      // A legacy reference may predate platform ownership. It must never confer editing of school-owned content.
      await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,1)', [first.chapters[0].id, schoolProblem.id, schoolProblem.versionId]);
      const courses = [first.id, second.id], batch = '/platform/content-editors/course/batch';
      const batchBody = { ...grant('course-editor'), resourceIds: courses };
      for (const name of ['teacher', 'course-editor', 'student', 'legacy-admin']) {
        await post(batch, batchBody, name, 403);
        await get(`${batch}?resourceIds=${courses.join(',')}`, name, 403);
        await request(batch, { name, method: 'DELETE', body: batchBody, status: 403 });
      }
      await request(batch, { method: 'POST', body: batchBody, csrf: false, status: 403 });
      for (const resourceIds of [[], [randomUUID(), first.id], [first.id, problem.id]]) await post(batch, { ...batchBody, resourceIds }, 'platform', resourceIds.length ? 404 : 400);
      assert.equal((await pool.query("SELECT 1 FROM platform_content_editors WHERE account_id=$1 AND resource_kind='course'", [actors['course-editor'].id])).rowCount, 0, 'invalid batches must grant nothing');
      await post(batch, { ...batchBody, ...grant('student') }, 'platform', 400);
      const saved = await post(batch, { ...batchBody, resourceIds: [...courses, first.id] });
      assert.deepEqual(new Set(saved.resourceIds), new Set(courses));
      assert.deepEqual(new Set(saved.items[0].resourceIds), new Set(courses));
      assert.equal((await get(`${source}/${problem.id}`, 'course-editor')).canEdit, true);
      assert.equal(await canEditPlatformContent(pool, actors['course-editor'].id, 'problem', schoolProblem.id), false);
      await post('/platform/content-editors/problem/batch', { ...grant('course-editor'), resourceIds: [other.id, schoolProblem.id] }, 'platform', 404);
      assert.equal((await pool.query("SELECT 1 FROM platform_content_editors WHERE resource_kind='problem' AND resource_id=$1 AND account_id=$2", [other.id, actors['course-editor'].id])).rowCount, 0);
      assert.ok((await get(`${source}?schoolId=${alpha.id}`, 'course-editor')).items.some(item => item.id === problem.id));
      assert.deepEqual((await get(`${source}?schoolId=${beta.id}`, 'course-editor')).items, []);
      const inherited = (await get(grantPath)).items.find(item => item.accountId === actors['course-editor'].id);
      assert.deepEqual(inherited.resourceIds, []); assert.deepEqual(new Set(inherited.inheritedResources.map(item => item.courseId)), new Set(courses));
      await get(`${source}/${other.id}`, 'course-editor', 403);
      const unrelated = await post(source, { ...input, title: 'Published source outside the delegated course' }, 'platform', 201);
      await post(`${source}/${unrelated.id}/validate`, { versionId: unrelated.versionId });
      const judge = { environmentVersion: 'platform-editor-fixture', judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'platform-editor-fixture' }) };
      for (let count = 0; count < 5 && await processOne({ pool: worker, judge, logger: {} }); count++) { /* Fixture-only validation, not executor verification. */ }
      await post(`${source}/${unrelated.id}/publish`, { expectedVersionId: unrelated.versionId });
      await get(`${source}/${unrelated.id}`, 'course-editor', 403);
      const beforeAppend = await get(`/platform/courses/${second.id}`, 'course-editor');
      await patch(`/platform/courses/${second.id}`, { expectedRevision: beforeAppend.revision, sourceVersion: beforeAppend.sourceVersion,
        chapters: [{ id: beforeAppend.chapters[0].id, problems: [{ problemId: problem.id, versionId: latest.versionId }, { problemId: unrelated.id, versionId: unrelated.versionId }] }] }, 'course-editor', 403);
      assert.equal((await get(`/platform/courses/${second.id}`)).revision, beforeAppend.revision, 'self-escalating link update rolls back entirely');
      assert.equal((await pool.query('SELECT 1 FROM chapter_problems WHERE problem_id=$1', [unrelated.id])).rowCount, 0);
      await get(`${source}/${unrelated.id}`, 'course-editor', 403);
      await post(`${source}/${problem.id}/publish`, { expectedVersionId: latest.versionId }, 'course-editor', 403);
      await post(`${source}/${problem.id}/contents/${content.id}/publish`, { reviewed: true }, 'course-editor', 403);
      await post('/scholarship/contents/batch-publish', { requestId: randomUUID(), reviewed: true, items: [{ contentId: content.id, expectedHash: content.contentHash }] }, 'course-editor', 403);
      await request(`/platform/content-editors/problem/${problem.id}`, { method: 'DELETE', body: grant('legacy-editor', LEGACY_SCHOOL_ID) });
      await post(`/platform/content-editors/course/${first.id}`, grant('legacy-editor', LEGACY_SCHOOL_ID));
      const legacy = await get(`/problems/${problem.id}`, 'legacy-editor');
      assert.equal(legacy.canEdit, true); assert.equal(legacy.ownerScope, 'platform'); assert.equal(legacy.referenceCode, input.referenceCode);
      await post(`/scholarship/contents/${content.id}/publish`, { reviewed: true, expectedHash: content.contentHash }, 'legacy-editor', 403);
      await post('/scholarship/contents/batch-publish', { requestId: randomUUID(), reviewed: true, items: [{ contentId: content.id, expectedHash: content.contentHash }] }, 'legacy-editor', 403);
      const setLinks = async (id, linked) => {
        const current = await get(`/platform/courses/${id}`);
        return patch(`/platform/courses/${id}`, { expectedRevision: current.revision, sourceVersion: current.sourceVersion,
          chapters: current.chapters.map(chapter => ({ id: chapter.id, problems: linked ? [{ problemId: problem.id, versionId: latest.versionId }] : [] })) });
      };
      await setLinks(first.id, false);
      assert.equal((await get(`${source}/${problem.id}`, 'course-editor')).canEdit, true, 'the other course grant still applies');
      await request(`/platform/content-editors/course/${second.id}`, { method: 'DELETE', body: grant('course-editor') });
      await get(`${source}/${problem.id}`, 'course-editor', 403);
      await setLinks(first.id, true);
      assert.equal((await get(`${source}/${problem.id}`, 'course-editor')).canEdit, true, 'existing course grant follows new links without regranting');
      const problemBatch = '/platform/content-editors/problem/batch', problems = [problem.id, other.id];
      await post(problemBatch, { ...grant('course-editor'), resourceIds: problems });
      assert.deepEqual(new Set((await get(`${problemBatch}?resourceIds=${problems.join(',')}`)).items.find(item => item.accountId === actors['course-editor'].id).resourceIds), new Set(problems));
      await setLinks(first.id, false);
      assert.equal((await get(`${source}/${problem.id}`, 'course-editor')).canEdit, true, 'direct grant survives removing the last course link');
      await request(problemBatch, { method: 'DELETE', body: { ...grant('course-editor'), resourceIds: problems } });
      await get(`${source}/${problem.id}`, 'course-editor', 403); await get(`${source}/${other.id}`, 'course-editor', 403);
      await setLinks(first.id, true);
      await post(`/platform/content-editors/course/${second.id}`, grant('course-editor', beta.id));
      await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2', [alpha.id, actors['course-editor'].id]);
      assert.deepEqual((await get(`${source}?schoolId=${alpha.id}`, 'course-editor')).items, [], 'another school grant cannot revive an expired membership');
      assert.ok((await get(`${source}?schoolId=${beta.id}`, 'course-editor')).items.some(item => item.id === problem.id));
      await request(batch, { method: 'DELETE', body: { ...batchBody, schoolId: beta.id } });
      await get(`${source}/${problem.id}`, 'course-editor', 403);
      await pool.query('UPDATE school_memberships SET revoked_at=NULL WHERE school_id=$1 AND account_id=$2', [alpha.id, actors['course-editor'].id]);
      assert.equal((await get(`${source}/${problem.id}`, 'course-editor')).canEdit, true);
      const beforeArchive = await get(`/platform/courses/${first.id}`);
      await post(`/platform/courses/${first.id}/archive`, { expectedRevision: beforeArchive.revision, sourceVersion: beforeArchive.sourceVersion });
      await get(`${source}/${problem.id}`, 'course-editor', 403);
      await request(batch, { method: 'DELETE', body: batchBody });
      assert.ok((await pool.query("SELECT 1 FROM platform_audit_events WHERE action='platform.content.editor_granted' AND detail->'resourceIds' @> $1::jsonb", [JSON.stringify(courses)])).rowCount > 0);
    });
    await t.test('archiving removes ordinary access while preserving only the learner-owned published submission snapshot', async () => {
      const historical = await post(source, { ...input, title: 'Historical published source' }, 'platform', 201);
      const judge = { environmentVersion: 'platform-editor-fixture', judge: async () => ({ status: 'AC', score: 100, passed: 1, total: 1, publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'platform-editor-fixture' }) };
      for (let count = 0; count < 5 && await processOne({ pool: worker, judge, logger: {} }); count++) { /* Fixture-only source validation. */ }
      await post(`${source}/${historical.id}/publish`, { expectedVersionId: historical.versionId });
      await post('/platform/problem-publications', { schoolId: LEGACY_SCHOOL_ID, problemId: historical.id, versionId: historical.versionId });
      assert.equal((await get(`/practice/problems/${historical.id}`, 'history-student')).id, historical.id);
      const saved = (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,language,code,idempotency_key,request_hash,status,score,passed,total)
        VALUES($1,$2,$3,$4,'submit','python','SAVED_STUDENT_HISTORY',$5,'fixture','AC',100,1,1) RETURNING id`,
        [actors['history-student'].id, actors['history-student'].identityId, historical.id, historical.versionId, randomUUID()])).rows[0];
      await post(`${source}/${historical.id}/versions`, { title: 'PRIVATE_UNPUBLISHED_DRAFT', mode: 'stdio', saveDraft: true, expectedVersionId: historical.versionId, expectedRevision: historical.editRevision }, 'platform', 201);
      await post(`${source}/batch`, { action: 'archive', problemIds: [historical.id] });
      assert.ok((await pool.query('SELECT withdrawn_at FROM school_problem_publications WHERE problem_id=$1', [historical.id])).rows[0].withdrawn_at);
      await get(`/practice/problems/${historical.id}`, 'history-student', 404);
      const path = `/problems/${historical.id}?originalSubmissionId=SUB${saved.id}`;
      const snapshot = await get(path, 'history-student');
      assert.equal(snapshot.versionId, historical.versionId); assert.equal(snapshot.title, historical.title);
      assert.equal(snapshot.canEdit, false); assert.equal(snapshot.canPublish, false);
      assert.equal(snapshot.referenceCode, undefined); assert.equal(snapshot.tests, undefined); assert.equal(snapshot.editorial, '');
      assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_PLATFORM_CASE|PRIVATE_EDITORIAL|PRIVATE_UNPUBLISHED_DRAFT/);
      await get(`/problems/${historical.id}`, 'history-student', [403, 404]);
      await get(`/problems/${historical.id}?versionId=${historical.versionId}`, 'history-student', [403, 404]);
      await get(path, 'history-other', [403, 404]);
      await get(path, 'legacy-admin', 404);
      await get(`/problems/${problem.id}?originalSubmissionId=SUB${saved.id}`, 'history-student', 404);
      await post('/submissions', { problemId: historical.id, versionId: historical.versionId, kind: 'submit', code: 'print(input())', language: 'python', idempotencyKey: randomUUID() }, 'history-student', [403, 404, 409]);
      const unchanged = (await pool.query('SELECT status,score,version_id FROM submissions WHERE id=$1', [saved.id])).rows[0];
      assert.equal(unchanged.status, 'AC'); assert.equal(Number(unchanged.score), 100); assert.equal(unchanged.version_id, historical.versionId);
      await post(`${source}/batch`, { action: 'restore', problemIds: [historical.id] });
      await get(`/practice/problems/${historical.id}`, 'history-student', 404);
      assert.ok((await pool.query('SELECT withdrawn_at FROM school_problem_publications WHERE problem_id=$1', [historical.id])).rows[0].withdrawn_at, 'restoring a source must not silently republish it');
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
