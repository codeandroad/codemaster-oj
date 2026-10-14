import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';
import { handleSystem, sanitizeAuditMetadata } from '../src/system.mjs';

test('audit metadata only exports bounded operational summaries, including nested records', () => {
  const fixture = { created: 3, disabled: false, roles: ['teacher'], reason: 'Network interruption',
    activationCode: 'private-activation', password: 'private-password', token: 'private-token', code: 'private-code',
    referenceCode: 'private-reference', input: 'private-input', output: 'private-output', arbitraryFutureField: 'private-future',
    summary: { total: 4, failed: 1, hidden: { reason: 'private-hidden' }, password: 'private-nested' },
    runId: { secret: 'private-secret', taskId: 'safe-id' } };
  assert.deepEqual(sanitizeAuditMetadata(fixture), { created: 3, disabled: false, roles: ['teacher'], reason: 'Network interruption',
    summary: { total: 4, failed: 1 }, runId: { taskId: 'safe-id' } });
  assert.equal(JSON.stringify(sanitizeAuditMetadata(fixture)).includes('private-'), false);
  const nested = []; nested.push(nested);
  // PostgreSQL JSON cannot contain cycles; a malformed caller's array must not
  // be an unbounded traversal either.
  assert.doesNotThrow(() => sanitizeAuditMetadata({ roles: nested }));
  assert.equal(sanitizeAuditMetadata({ reason: 'x'.repeat(3000), roles: Array.from({ length: 60 }, () => 'student') }).roles.length, 50);
  assert.equal(sanitizeAuditMetadata({ reason: 'x'.repeat(3000) }).reason.length, 2000);
});

test('system handlers deny non-admin reads and writes before querying', async () => {
  let queries = 0;
  const ctx = { method: 'GET', pool: { query() { queries++; throw new Error('must not query'); } }, config: {}, url: new URL('http://local/audit-events') };
  await assert.rejects(handleSystem({ ...ctx, route: '/audit-events', user: { roles: ['teacher'] } }), (error) => error.status === 403);
  await assert.rejects(handleSystem({ ...ctx, route: '/system-settings', user: { roles: ['student'] } }), (error) => error.status === 403);
  await assert.rejects(handleSystem({ ...ctx, route: '/system-settings', user: null }), (error) => error.status === 401);
  await assert.rejects(handleSystem({...ctx,route:'/system-settings',method:'PATCH',user:{roles:['teacher']}}),error=>error.status===403);
  assert.equal(queries, 0);
});

test('judge status and task detail report the language actually executed', async () => {
  const taskId = '00000000-0000-4000-8000-000000000001';
  const rows = [
    { id: taskId, submission_id: 42, submission_language: 'cpp', reference_language: 'python', kind: 'submit', state: 'queued', status: 'Waiting', attempts: 0, created_at: '2026-10-14T00:00:00Z' },
    { id: '00000000-0000-4000-8000-000000000002', submission_id: null, submission_language: null, reference_language: 'javascript', state: 'failed', validation_status: 'Waiting', attempts: 1, created_at: '2026-10-14T00:00:00Z' },
  ];
  const pool = { async query(sql, params) {
    if (sql.includes('FROM judge_tasks t JOIN')) {
      assert.match(sql, /s\.language submission_language/);
      assert.match(sql, /v\.reference_language/);
      return { rows: params ? rows.filter(row => row.id === params[0]) : rows };
    }
    if (sql.includes('FROM judge_tasks')) return { rows: [{ queued: 1, leased: 0, failed: 1, completed: 0, server_now: '2026-10-14T00:00:00Z' }] };
    if (sql.includes('FROM judge_nodes') || sql.includes('FROM judge_runs')) return { rows: [] };
    if (sql.includes('FROM site_settings')) return { rows: [] };
    if (sql.includes('FROM judge_control')) return { rows: [{ maintenance: false }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const context = { method: 'GET', user: { roles: ['admin'] }, pool, url: new URL('http://local/judge-status') };
  const snapshot = await handleSystem({ ...context, route: '/judge-status' });
  assert.deepEqual(snapshot.body.tasks.map(task => task.language), ['cpp', 'javascript']);
  assert.equal(snapshot.body.tasks[1].status, 'System Error');
  const detail = await handleSystem({ ...context, route: `/judge-tasks/${taskId}` });
  assert.equal(detail.body.language, 'cpp');
  assert.equal(detail.body.submissionId, 'SUB42');
});

test('real PostgreSQL + HTTP system settings and redacted audit require administrator scope', { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 }, async () => {
  const manager = createPool(process.env.TEST_DATABASE_URL), schema = `system_test_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(process.env.TEST_DATABASE_URL); connection.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(connection.href); let server;
  try {
    await migrate(pool);
    await bootstrap(pool, { name: 'System administrator', number: 'SYSTEM-A1', username: 'system-admin', password: 'System-test-password-2026' });
    const config = loadConfig({ SESSION_SECRET: 'system-test-session-secret-more-than-32-characters', APP_ORIGIN: 'http://system.test', COOKIE_SECURE: 'false' });
    server = http.createServer(await createApp(pool, config));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    function client() { let cookie = '', csrf = ''; return async (path, body, method = body === undefined ? 'GET' : 'POST', status = 200) => {
      const response = await fetch(base + path, { method, headers: { Origin: 'http://system.test', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json(); assert.equal(response.status, status, path);
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      if (data.csrfToken) csrf = data.csrfToken; return data;
    }; }
    const anonymous = client(), admin = client(), teacher = client(), student = client();
    await anonymous('/system-settings', undefined, 'GET', 401);
    await admin('/auth/login', { username: 'system-admin', password: 'System-test-password-2026' });
    for (const [kind, request] of [['teacher', teacher], ['student', student]]) {
      const issued = await admin('/people', { kind, number: `SYSTEM-${kind}`, name: kind }, 'POST', 201);
      await request('/auth/register', { kind, number: `SYSTEM-${kind}`, name: kind, activationCode: issued.activationCode, username: `system-${kind}`, password: 'System-test-password-2026' }, 'POST', 201);
      await request('/system-settings', undefined, 'GET', 403); await request('/audit-events', undefined, 'GET', 403);
    }
    const settings = await admin('/system-settings');
    assert.equal(settings.codeLimitBytes, config.codeLimit); assert.equal(settings.secureCookies, false);
    assert.deepEqual(settings.origins, config.origins); assert.equal(settings.judgeJobCpuBudgetMs, 30000); assert.equal(settings.judgeJobWallBudgetMs, 60000);
    assert.equal(settings.backup.verifiedOnSchoolHost, false); assert.equal(settings.backup.operation, 'server-cli');
    assert.equal(JSON.stringify(settings).includes(config.secret), false);
    const actor = (await pool.query("SELECT id FROM accounts WHERE username='system-admin'")).rows[0].id;
    const event = (await pool.query("INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,'security.test','test','safe-id',$2) RETURNING id", [actor,
      { reason: 'Operational summary', created: 2, activationCode: 'must-not-return', password: 'must-not-return', code: 'must-not-return', summary: { total: 2, resetCode: 'must-not-return' } }])).rows[0];
    const audits = await admin('/audit-events?limit=1'); assert.equal(audits.items.length, 1); assert.equal(audits.items[0].id, event.id);
    assert.equal(audits.items[0].actorName, 'System administrator'); assert.deepEqual(audits.items[0].metadata, { reason: 'Operational summary', created: 2, summary: { total: 2 } });
    assert.equal(JSON.stringify(audits).includes('must-not-return'), false);
    for (const limit of ['0', '201', '1.2', 'abc', '-1']) await admin(`/audit-events?limit=${limit}`, undefined, 'GET', 400);
    assert.ok((await admin('/audit-events')).items.length > 1);
    await admin('/system-settings', { siteName: 'Updated school judge',schoolName:'School',timezone:'Asia/Shanghai',runtime:{workerConcurrency:1} }, 'PATCH', 200);
    const updated=await admin('/system-settings');assert.equal(updated.siteName,'Updated school judge');assert.equal(updated.runtime.workerConcurrency,1);
    await teacher('/system-settings',{siteName:'Forbidden'},'PATCH',403);
    await admin('/system-settings',{runtime:{workerConcurrency:8}},'PATCH',400);
    await admin('/system-settings',{timezone:'Unknown/Timezone'},'PATCH',400);
    assert.equal((await student('/site-info')).siteName,'Updated school judge');
    assert.equal((await student('/site-info')).origins,undefined);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
  }
});
