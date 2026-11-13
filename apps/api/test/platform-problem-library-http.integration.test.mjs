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
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';

test('platform catalog categories and bulk actions preserve stable source identities', { skip: !process.env.TEST_DATABASE_URL, timeout: 90000 }, async t => {
 const url = new URL(process.env.TEST_DATABASE_URL);
 assert.equal(url.pathname, '/campus_qa'); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
 const manager = createPool(url.href), schema = 'platform_library_' + randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`); url.searchParams.set('options', `-csearch_path=${schema}`);
 const pool = createPool(url.href); let app, worker;
 try {
  await migrate(pool);
  const password = randomBytes(24).toString('base64url');
  await bootstrap(pool, { username: 'platform', password, number: 'ADMIN', name: 'Platform' });
  await provisionPlatformAdministrator(pool, { username: 'platform' });
  const admin = (await pool.query("SELECT id FROM accounts WHERE username='platform'")).rows[0];
  const identity = (await pool.query("INSERT INTO identities(kind,number,name) VALUES('teacher','STAFF','Teacher') RETURNING id")).rows[0];
  const teacher = (await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'teacher',$2) RETURNING id", [identity.id, await hashPassword(password)])).rows[0];
  await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'teacher')", [teacher.id]);
  await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [teacher.id]);
  const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
  const runtime = new URL(url); runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
  const workerUrl = new URL(url); workerUrl.searchParams.set('options', `-crole=campus_worker -csearch_path=${schema}`); worker = createPool(workerUrl.href);
  const origin = 'http://platform-library.test';
  app = await createApiApplication({ databaseUrl: runtime.href, logger: false, config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
  await app.listen(0, '127.0.0.1'); const endpoint = (await app.getUrl()) + '/api/v1', sessions = {};
  const request = async (path, { method = 'GET', body, actor = 'platform', status = 200, csrf = true } = {}) => {
   const session = sessions[actor], response = await fetch(endpoint + path, { method, headers: { Origin: origin, ...(session ? { Cookie: session.cookie, ...(csrf ? { 'X-CSRF-Token': session.csrfToken } : {}) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
   const data = await response.json(); assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data.error ?? data)}`);
   assert.match(response.headers.get('cache-control') ?? '', /no-store/);
   return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  for (const actor of ['platform', 'teacher']) { const login = await request('/auth/login', { method: 'POST', actor, body: { username: actor, password } }); sessions[actor] = { cookie: login.cookie, csrfToken: login.data.csrfToken }; }
  const get = async (path, options = {}) => (await request(path, options)).data;
  const post = async (path, body, options = {}) => (await request(path, { method: 'POST', body, ...options })).data;
  const patch = async (path, body, options = {}) => (await request(path, { method: 'PATCH', body, ...options })).data;
  const banks = '/platform/problem-banks', source = '/platform/source-problems';
  const draft = title => ({ title, mode: 'stdio', statement: 'Draft exercise', saveDraft: true });
  let a, b, imported, first, second;
  await t.test('platform categories require platform authority and revisions', async () => {
   await get(banks, { actor: 'teacher', status: 403 });
   await post(banks, { name: 'Private teacher category' }, { actor: 'teacher', status: 403 });
   await post(banks, { name: 'Missing CSRF' }, { csrf: false, status: 403 });
   a = await post(banks, { name: 'Python', description: 'Practice' }, { status: 201 });
   b = await post(banks, { name: 'Algorithms' }, { status: 201 });
   await post(banks, { name: 'PYTHON' }, { status: 409 });
   a = await patch(`${banks}/${a.id}`, { name: 'Python foundations', revision: a.revision });
   await patch(`${banks}/${a.id}`, { name: 'Stale name', revision: 1 }, { status: 409 });
   assert.equal(a.revision, 2); assert.equal((await get(banks)).items.length, 2);
  });
  await t.test('imports are atomic, idempotent, private drafts with no implicit publication', async () => {
   const key = randomUUID(), body = { bankId: a.id, idempotencyKey: key, problems: [draft('First upload'), draft('Second upload')] };
   imported = await post(`${source}/import`, body, { status: 201 });
   assert.equal(imported.importedCount, 2); [first, second] = imported.items;
   assert.deepEqual(await post(`${source}/import`, body), imported);
   await post(`${source}/import`, { ...body, problems: [draft('Changed')] }, { status: 409 });
   const before = (await pool.query('SELECT count(*)::int n FROM problems')).rows[0].n;
   await post(`${source}/import`, { ...body, idempotencyKey: randomUUID(), problems: [draft('Rollback'), { title: 'Invalid' }] }, { status: 400 });
   assert.equal((await pool.query('SELECT count(*)::int n FROM problems')).rows[0].n, before);
   await post(`${source}/import`, { ...body, idempotencyKey: randomUUID() }, { actor: 'teacher', status: 403 });
   const detail = await get(`${source}/${first.id}`); assert.equal(detail.bankId, a.id); assert.equal(detail.ownerScope, 'platform'); assert.equal(detail.published, false);
   assert.equal((await pool.query('SELECT current_version_id FROM problems WHERE id=$1', [first.id])).rows[0].current_version_id, null);
  });
  await t.test('classification does not change original school bank, versions or grants', async () => {
   const before = (await pool.query('SELECT bank_id,current_version_id FROM problems WHERE id=$1', [first.id])).rows[0];
   await post('/platform/content-editors/problem/' + first.id, { accountId: teacher.id, schoolId: LEGACY_SCHOOL_ID });
   await post(`${source}/batch`, { action: 'move', problemIds: [first.id, second.id], bankId: b.id });
   assert.deepEqual((await pool.query('SELECT bank_id,current_version_id FROM problems WHERE id=$1', [first.id])).rows[0], before);
   assert.equal((await get(`${source}/${first.id}`, { actor: 'teacher' })).canEdit, true);
   const list = await get(source); assert.equal(list.items.find(item => item.id === first.id).sourceBankId, before.bank_id);
   assert.equal(list.items.find(item => item.id === first.id).bankId, b.id);
   await post(`${source}/batch`, { action: 'archive', problemIds: [first.id] }, { actor: 'teacher', status: 403 });
   await post(`${banks}/${b.id}/archive`, { revision: b.revision }, { status: 409 });
  });
  await t.test('referenced or mixed-ownership batches fail atomically; deletion is reversible', async () => {
   const path = (await pool.query("INSERT INTO learning_paths(title,owner_account_id,owner_scope) VALUES('Linked course',$1,'platform') RETURNING id", [admin.id])).rows[0];
   const chapter = (await pool.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Chapter','Content',0) RETURNING id", [path.id])).rows[0];
   await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)', [chapter.id, first.id, first.versionId]);
   const originalCount = (await pool.query('SELECT count(*)::int n FROM problem_versions')).rows[0].n;
   await post(`${source}/batch`, { action: 'archive', problemIds: [first.id, second.id] }, { status: 409 });
   assert.equal((await pool.query('SELECT archived_at FROM problems WHERE id=$1', [second.id])).rows[0].archived_at, null);
   const schoolProblem = (await pool.query("INSERT INTO problems(bank_id,owner_account_id) VALUES('00000000-0000-4000-8000-000000000001',$1) RETURNING id", [admin.id])).rows[0];
   await post(`${source}/batch`, { action: 'move', problemIds: [first.id, schoolProblem.id], bankId: a.id }, { status: 404 });
   assert.equal((await get(`${source}/${first.id}`)).bankId, b.id);
   assert.deepEqual((await get(source)).items.find(item => item.id === first.id).courses, [{ id: path.id, title: 'Linked course' }]);
   await post(`${source}/batch`, { action: 'archive', problemIds: [second.id] });
   assert.ok(!(await get(source)).items.some(item => item.id === second.id));
   assert.ok((await get(source + '?includeArchived=1')).items.find(item => item.id === second.id).archivedAt);
   await post(`${source}/batch`, { action: 'restore', problemIds: [second.id] });
   assert.ok((await get(source)).items.some(item => item.id === second.id));
   assert.equal((await pool.query('SELECT count(*)::int n FROM problem_versions')).rows[0].n, originalCount);
  });
  await t.test('empty categories can be archived and restored; worker cannot read catalog/grant data', async () => {
   a = await post(`${banks}/${a.id}/archive`, { revision: a.revision });
   assert.ok(a.archivedAt); assert.ok(!(await get(banks)).items.some(item => item.id === a.id));
   await post(source, { ...draft('Archived category'), bankId: a.id }, { status: 409 });
   a = await post(`${banks}/${a.id}/restore`, { revision: a.revision }); assert.equal(a.archivedAt, null);
   for (const table of ['platform_problem_banks', 'platform_problem_imports', 'platform_content_editors']) await assert.rejects(worker.query(`SELECT * FROM ${table}`), error => error.code === '42501');
  });
 } finally { if (app) await app.close(); if (worker) await worker.end(); await pool.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end(); }
});
