import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school identity import previews and atomic commits enforce tenant, account, and retry boundaries',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 90000 }, async t => {
    const connection = new URL(process.env.TEST_DATABASE_URL);
    // Even though every run owns a random schema, never migrate the live database.
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(connection.hostname)
      && /^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(connection.pathname),
    'Use a dedicated local campus_qa/campus_test database.');
    const manager = createPool(connection.href);
    const schema = 'school_import_' + randomBytes(6).toString('hex');
    connection.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(connection.href);
    const password = randomBytes(24).toString('base64url');
    const sessionSecret = randomBytes(32).toString('base64url');
    const origin = 'http://school-import.test';
    let app;
    let schemaCreated = false;
    try {
      await manager.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await migrate(pool);
      await bootstrap(pool, { name: 'Legacy administrator', number: 'ADM', username: 'legacy-admin', password });
      const passwordHash = await hashPassword(password);
      await transaction(pool, async db => {
        for (const username of ['alpha-admin', 'alpha-colleague', 'beta-admin', 'pilot-teacher', 'pilot-student']) {
          const identityId = randomUUID();
          await db.query("INSERT INTO identities (id, kind, number, name) VALUES ($1, 'student', $2, $2)", [identityId, username]);
          await db.query('INSERT INTO accounts (identity_id, username, password_hash) VALUES ($1, $2, $3)',
            [identityId, username, passwordHash]);
        }
      });
      app = await createApiApplication({
        databaseUrl: connection.href, logger: false,
        config: loadConfig({ SESSION_SECRET: sessionSecret, APP_ORIGIN: origin, COOKIE_SECURE: 'false' }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth, csrf = true, status = 200, code } = {}) {
        const response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Origin: origin,
            ...(body !== undefined && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.csrfToken }) }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json();
        const accepted = Array.isArray(status) ? status : [status];
        assert.ok(accepted.includes(response.status),
          `${method} ${path} returned ${response.status} (${data.error?.code ?? 'success'}), expected ${accepted.join(' or ')}`);
        if (code) assert.equal(data.error?.code, code);
        return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
      }
      const login = async username => {
        const { data, cookie } = await request('/auth/login', { method: 'POST', body: { username, password } });
        return { id: data.user.id, csrfToken: data.csrfToken, cookie };
      };
      const legacy = await login('legacy-admin');
      const alphaAdmin = await login('alpha-admin');
      const colleague = await login('alpha-colleague');
      const betaAdmin = await login('beta-admin');
      const teacher = await login('pilot-teacher');
      const student = await login('pilot-student');
      const alpha = await provisionSchool(pool, { slug: 'import-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      const beta = await provisionSchool(pool, { slug: 'import-beta', name: 'Beta School', adminUsername: 'beta-admin' });
      await pool.query(`INSERT INTO school_memberships (school_id, account_id, role) VALUES
        ($1, $2, 'school_admin'), ($1, $3, 'teacher'), ($1, $4, 'student')`,
      [alpha.id, colleague.id, teacher.id, student.id]);

      const schoolPath = (school, resource) => `/schools/${school.id}/${resource}`;
      const post = (path, auth, body, status = 201) => request(path, { method: 'POST', auth, body, status });
      const preview = (body, options = {}) => request(schoolPath(options.school ?? alpha, 'identity-imports/preview'), {
        method: 'POST', auth: alphaAdmin, body, ...options,
      });
      const commit = (body, previewToken, options = {}) => request(schoolPath(options.school ?? alpha, 'identity-imports/commit'), {
        method: 'POST', auth: alphaAdmin, body: { ...body, ...(previewToken !== undefined && { previewToken }) }, ...options,
      });
      const { data: classroom } = await post(schoolPath(alpha, 'classes'), alphaAdmin, { name: 'Import class', type: 'administrative' });
      const { data: otherClass } = await post(schoolPath(alpha, 'classes'), alphaAdmin, { name: 'Second class', type: 'training' });
      const { data: betaClass } = await post(schoolPath(beta, 'classes'), betaAdmin, { name: 'Import class', type: 'administrative' });
      const { data: existingStudent } = await post(schoolPath(alpha, 'identities'), alphaAdmin,
        { kind: 'student', number: '01', name: 'Existing student', accountId: student.id });
      const { data: existingTeacher } = await post(schoolPath(alpha, 'identities'), alphaAdmin,
        { kind: 'teacher', number: '01', name: 'Existing teacher', accountId: teacher.id });
      const { data: betaStudent } = await post(schoolPath(beta, 'identities'), betaAdmin,
        { kind: 'student', number: '01', name: 'Beta student' });

      const importTables = ['school_identities', 'school_class_roster', 'school_identity_imports', 'school_audit_events'];
      // Include every legacy/account/Luq/grading table, plus other school state.
      // Session activity is the only permitted side effect outside the import.
      const protectedTables = (await pool.query(`SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND NOT (table_name = ANY($2::text[]))
        ORDER BY table_name`, [schema, [...importTables, 'sessions']])).rows.map(row => row.table_name);
      async function snapshot(tables = importTables) {
        const entries = await Promise.all(tables.map(async table => {
          const { rows: [row] } = await pool.query(
            `SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS digest FROM "${table.replaceAll('"', '""')}" t`);
          return [table, row];
        }));
        return Object.fromEntries(entries);
      }
      const protectedBefore = await snapshot(protectedTables);
      const numberRows = async numbers => (await pool.query(`
        SELECT id, kind, number, name, account_id AS "accountId" FROM school_identities
        WHERE school_id = $1 AND number = ANY($2::text[]) ORDER BY kind, number`, [alpha.id, numbers])).rows;
      const simpleBody = number => ({ kind: 'student', rows: [{ number, name: 'Import ' + number }] });

      await t.test('preview and commit require school administration and CSRF; targets stay within the school', async () => {
        const body = simpleBody('authorization');
        const { data: plan } = await preview(body);
        const before = await snapshot();
        for (const operation of [preview, (value, options) => commit(value, plan.previewToken, options)]) {
          await operation(body, { auth: undefined, status: 401 });
          await operation(body, { auth: teacher, status: 403 });
          await operation(body, { auth: student, status: 403 });
          await operation(body, { auth: legacy, status: 404 });
          await operation(body, { school: beta, status: 404 });
          await operation(body, { school: { id: LEGACY_SCHOOL_ID }, auth: legacy, status: 404 });
          await operation(body, { csrf: false, status: 403, code: 'CSRF' });
        }
        await preview(body, { school: { id: 'not-a-uuid' }, status: 400 });
        await preview(body, { school: { id: randomUUID() }, status: 404 });
        await preview({ ...body, classId: 'not-a-uuid' }, { status: 400 });
        await preview({ ...body, classId: randomUUID() }, { status: 404 });
        await preview({ ...body, classId: betaClass.id }, { status: 404 });
        assert.deepEqual(await snapshot(), before);
      });

      await t.test('preview is read-only and reports normalized create, existing, and duplicate rows', async () => {
        const body = {
          kind: 'student', classId: classroom.id,
          rows: [
            { number: ' 01 ', name: ' Existing student ' },
            { number: 'new-01', name: '新同学' },
            { number: ' new-01 ', name: ' 新同学 ' },
            { number: 'pilot-student', name: 'pilot-student' },
          ],
        };
        const before = await snapshot();
        const { data: plan } = await preview(body);
        assert.equal(plan.canCommit, true);
        assert.equal(typeof plan.previewToken, 'string');
        assert.ok(Number.isFinite(Date.parse(plan.expiresAt)));
        assert.ok(Date.parse(plan.expiresAt) > Date.now());
        assert.deepEqual(plan.items.map(({ line, number, name, status }) => ({ line, number, name, status })), [
          { line: 1, number: '01', name: 'Existing student', status: 'existing' },
          { line: 2, number: 'new-01', name: '新同学', status: 'create' },
          { line: 3, number: 'new-01', name: '新同学', status: 'duplicate' },
          { line: 4, number: 'pilot-student', name: 'pilot-student', status: 'create' },
        ]);
        assert.deepEqual(plan.summary, { total: 4, created: 2, existing: 1, duplicates: 1, errors: 0, rosterAdded: 3 });
        assert.deepEqual(await snapshot(), before, 'preview must not create receipts, identities, roster rows, or audit events');
        const { data: result } = await commit(body, plan.previewToken);
        assert.match(result.batchId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(result.summary, { total: 4, created: 2, existing: 1, duplicates: 1, rosterAdded: 3 });
        assert.deepEqual(Object.keys(result).sort(), ['batchId', 'summary']);
        const people = await numberRows(['01', 'new-01', 'pilot-student']);
        assert.equal(people.filter(person => person.kind === 'student').length, 3);
        assert.equal(people.find(person => person.kind === 'student' && person.number === '01').id, existingStudent.id);
        assert.equal(people.find(person => person.kind === 'student' && person.number === '01').accountId, student.id);
        assert.ok(people.filter(person => person.number !== '01').every(person => person.accountId === null),
          'matching account numbers must never auto-link');
        const roster = await request(schoolPath(alpha, `classes/${classroom.id}/roster`), { auth: alphaAdmin });
        assert.deepEqual(new Set(roster.data.items.map(person => person.number)), new Set(['01', 'new-01', 'pilot-student']));
        const { data: repeated } = await preview(body);
        assert.deepEqual(repeated.summary, { total: 4, created: 0, existing: 3, duplicates: 1, errors: 0, rosterAdded: 0 });
        assert.equal((await pool.query('SELECT name FROM school_identities WHERE id = $1', [betaStudent.id])).rows[0].name, 'Beta student');
      });

      await t.test('invalid and conflicting rows block the whole import without partial inserts', async () => {
        const before = await snapshot();
        for (const rows of [
          [{ number: 'conflict-new', name: 'First name' }, { number: 'conflict-new', name: 'Second name' }],
          [{ number: 'must-not-create', name: 'Valid row' }, { number: '01', name: 'Different existing name' }],
          [{ number: '', name: 'Missing number' }, { number: 'invalid-name', name: '' }],
          [{ number: 'x'.repeat(65), name: 'Too long number' }, { number: 'too-long-name', name: 'x'.repeat(101) }],
          [{ number: 12, name: 'Numeric number' }, { number: 'null-name', name: null }],
          [{ number: 'nul\u0000number', name: 'Invalid character' }],
        ]) {
          const body = { kind: 'student', rows, classId: classroom.id };
          const { data: plan } = await preview(body);
          assert.equal(plan.canCommit, false);
          assert.ok(plan.summary.errors > 0);
          assert.equal(plan.items.length, rows.length);
          assert.ok(plan.items.some(item => ['invalid', 'conflict'].includes(item.status)));
          assert.ok(plan.items.filter(item => ['invalid', 'conflict'].includes(item.status)).every(item => typeof item.message === 'string' && item.message.length));
          assert.ok(!plan.previewToken);
          await commit(body, undefined, { status: 400 });
        }
        for (const body of [{ kind: 'admin', rows: [] }, { kind: 'student', rows: [] }, { kind: 'student', rows: 'not-an-array' }, { kind: 'teacher' },
          { kind: 'student', rows: Array.from({ length: 501 }, (_, index) => ({ number: String(index), name: 'Too many rows' })) }]) {
          await preview(body, { status: 400 });
        }
        assert.deepEqual(await snapshot(), before);
      });

      await t.test('teacher imports reuse only the selected kind and associate both identity kinds to classes', async () => {
        const body = { kind: 'teacher', classId: classroom.id, rows: [
          { number: '01', name: 'Existing teacher' },
          { number: 'new-01', name: 'New teacher' },
        ] };
        const { data: plan } = await preview(body);
        assert.deepEqual(plan.items.map(item => item.status), ['existing', 'create']);
        assert.deepEqual(plan.summary, { total: 2, created: 1, existing: 1, duplicates: 0, errors: 0, rosterAdded: 2 });
        const { data: result } = await commit(body, plan.previewToken);
        assert.deepEqual(result.summary, { total: 2, created: 1, existing: 1, duplicates: 0, rosterAdded: 2 });
        const people = await numberRows(['01', 'new-01']);
        assert.equal(people.length, 4);
        assert.equal(people.find(person => person.kind === 'teacher' && person.number === '01').id, existingTeacher.id);
        const teachers = await request(schoolPath(alpha, `classes/${classroom.id}/roster?kind=teacher`), { auth: alphaAdmin });
        assert.deepEqual(new Set(teachers.data.items.map(person => person.number)), new Set(['01', 'new-01']));
        const withoutClass = simpleBody('no-class');
        const { data: noClassPlan } = await preview(withoutClass);
        const { data: noClassResult } = await commit(withoutClass, noClassPlan.previewToken);
        assert.equal(noClassResult.summary.rosterAdded, 0);
        assert.equal((await pool.query(`SELECT count(*)::int AS count FROM school_class_roster r
          JOIN school_identities i ON i.id = r.identity_id WHERE i.number = 'no-class'`)).rows[0].count, 0);
      });

      await t.test('preview tokens bind actor, school, kind, rows, and class and reject missing or tampered tokens', async () => {
        const body = simpleBody('token-bound');
        const { data: plan } = await preview(body);
        const before = await snapshot();
        await commit(body, undefined, { status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        await commit(body, 'not-a-signed-token', { status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        const [payload, signature] = plan.previewToken.split('.');
        const changedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
        await commit(body, payload + '.' + changedSignature, { status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        await commit(body, plan.previewToken, { auth: colleague, status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        await commit(body, plan.previewToken, { school: beta, auth: betaAdmin, status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        for (const changed of [
          { ...body, kind: 'teacher' },
          { ...body, rows: [{ number: 'changed-number', name: body.rows[0].name }] },
          { ...body, rows: [{ number: body.rows[0].number, name: 'Changed name' }] },
          { ...body, rows: [...body.rows, { number: 'extra-row', name: 'Extra row' }] },
          { ...body, classId: otherClass.id },
          { ...body, classId: betaClass.id },
        ]) await commit(changed, plan.previewToken, { status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        assert.deepEqual(await snapshot(), before);
      });

      await t.test('a correctly signed expired preview cannot create an import', async () => {
        const body = simpleBody('expired-preview');
        const { data: plan } = await preview(body);
        const before = await snapshot();
        // The test owns this application's random secret. Re-signing changes only
        // expiry, so this exercises expiration rather than a signature failure.
        const claims = JSON.parse(Buffer.from(plan.previewToken.split('.')[0], 'base64url').toString('utf8'));
        claims.expiresAt = Date.now() - 1000;
        const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
        const signature = createHmac('sha256', sessionSecret).update('school-identity-import:v1:' + encoded).digest('base64url');
        await commit(body, encoded + '.' + signature, { status: 409, code: 'IMPORT_PREVIEW_EXPIRED' });
        assert.deepEqual(await snapshot(), before);
      });

      await t.test('identity or roster changes after preview invalidate the plan atomically', async () => {
        const body = { kind: 'student', classId: otherClass.id, rows: [
          { number: 'stale-existing', name: 'Originally new' },
          { number: 'stale-must-not-create', name: 'Must not be created' },
        ] };
        const { data: plan } = await preview(body);
        await post(schoolPath(alpha, 'identities'), alphaAdmin, { kind: 'student', number: 'stale-existing', name: 'Concurrent different name' });
        const afterConcurrentWrite = await snapshot();
        await commit(body, plan.previewToken, { status: 409, code: 'IMPORT_PREVIEW_STALE' });
        assert.deepEqual(await snapshot(), afterConcurrentWrite);
        assert.equal((await numberRows(['stale-must-not-create'])).length, 0);
        const rosterBody = { kind: 'student', classId: otherClass.id, rows: [{ number: '01', name: 'Existing student' }] };
        const { data: rosterPlan } = await preview(rosterBody);
        assert.equal(rosterPlan.summary.rosterAdded, 1);
        await post(schoolPath(alpha, `classes/${otherClass.id}/roster`), alphaAdmin, { identityId: existingStudent.id });
        const afterRosterWrite = await snapshot();
        await commit(rosterBody, rosterPlan.previewToken, { status: 409, code: 'IMPORT_PREVIEW_STALE' });
        assert.deepEqual(await snapshot(), afterRosterWrite);
      });

      await t.test('a changed account link invalidates a pending preview without overwriting the new link state', async () => {
        const body = { kind: 'student', rows: [
          { number: '01', name: 'Existing student' },
          { number: 'link-stale-must-not-create', name: 'Must not be created' },
        ] };
        const { data: plan } = await preview(body);
        const path = schoolPath(alpha, `identities/${existingStudent.id}/account`);
        await request(path, { method: 'PATCH', auth: alphaAdmin, body: { accountId: null, expectedAccountId: student.id } });
        try {
          const afterUnlink = await snapshot();
          await commit(body, plan.previewToken, { status: 409, code: 'IMPORT_PREVIEW_STALE' });
          assert.deepEqual(await snapshot(), afterUnlink);
          assert.equal((await numberRows(['link-stale-must-not-create'])).length, 0);
          assert.equal((await numberRows(['01'])).find(person => person.kind === 'student').accountId, null);
        } finally {
          await request(path, { method: 'PATCH', auth: alphaAdmin, body: { accountId: student.id } });
        }
      });

      await t.test('concurrent retries return one receipt and perform each insert and audit exactly once', async () => {
        const body = { kind: 'student', classId: otherClass.id, rows: [
          { number: 'retry-01', name: 'Retry first' },
          { number: 'retry-02', name: 'Retry second' },
          { number: 'retry-01', name: 'Retry first' },
        ] };
        const { data: plan } = await preview(body);
        const results = await Promise.all(Array.from({ length: 6 }, () => commit(body, plan.previewToken)));
        for (const result of results) assert.deepEqual(result.data, results[0].data);
        assert.deepEqual(results[0].data.summary, { total: 3, created: 2, existing: 0, duplicates: 1, rosterAdded: 2 });
        const batchId = results[0].data.batchId;
        const people = await numberRows(['retry-01', 'retry-02']);
        assert.equal(people.length, 2);
        const { rows: receipt } = await pool.query('SELECT * FROM school_identity_imports WHERE id = $1', [batchId]);
        assert.equal(receipt.length, 1);
        assert.deepEqual(receipt[0].aggregate_result, results[0].data);
        assert.ok(!JSON.stringify(receipt[0]).includes('Retry first'));
        assert.ok(!JSON.stringify(receipt[0]).includes('retry-01'));
        assert.ok(!JSON.stringify(receipt[0]).includes(plan.previewToken));
        const { rows: audits } = await pool.query(`SELECT action, count(*)::int AS count FROM school_audit_events
          WHERE school_id = $1 AND target_id = ANY($2::uuid[]) GROUP BY action`,
        [alpha.id, [batchId, ...people.map(person => person.id)]]);
        assert.deepEqual(Object.fromEntries(audits.map(row => [row.action, row.count])), {
          'school.identity.import': 1, 'school.identity.create': 2, 'school.roster.add': 2,
        });
        const after = await snapshot();
        assert.deepEqual((await commit(body, plan.previewToken)).data, results[0].data);
        await commit(body, plan.previewToken, { auth: colleague, status: 400, code: 'IMPORT_PREVIEW_INVALID' });
        assert.deepEqual(await snapshot(), after, 'a completed receipt cannot be replayed by another school administrator');
      });

      await t.test('an exact successful receipt remains replayable after its preview token expires', async () => {
        const body = simpleBody('retry-after-expiry');
        const { data: plan } = await preview(body);
        const claims = JSON.parse(Buffer.from(plan.previewToken.split('.')[0], 'base64url').toString('utf8'));
        claims.expiresAt = Date.now() + 1000;
        const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
        const signature = createHmac('sha256', sessionSecret).update('school-identity-import:v1:' + encoded).digest('base64url');
        const token = encoded + '.' + signature;
        const { data: first } = await commit(body, token);
        const afterCommit = await snapshot();
        await delay(Math.max(0, claims.expiresAt - Date.now() + 25));
        assert.ok(Date.now() >= claims.expiresAt);
        assert.deepEqual((await commit(body, token)).data, first);
        assert.deepEqual(await snapshot(), afterCommit, 'expired receipt replay must not repeat imports or audit events');
      });

      await t.test('receipt replay still requires active school authority and an enabled account', async () => {
        const body = simpleBody('retry-authority');
        const { data: plan } = await preview(body, { auth: colleague });
        await commit(body, plan.previewToken, { auth: colleague });
        const afterCommit = await snapshot();
        try {
          await pool.query(`UPDATE school_memberships SET revoked_at = clock_timestamp()
            WHERE school_id = $1 AND account_id = $2`, [alpha.id, colleague.id]);
          await commit(body, plan.previewToken, { auth: colleague, status: 404 });
          assert.deepEqual(await snapshot(), afterCommit);
          await pool.query(`UPDATE school_memberships SET revoked_at = NULL
            WHERE school_id = $1 AND account_id = $2`, [alpha.id, colleague.id]);
          await pool.query('UPDATE accounts SET disabled_at = clock_timestamp() WHERE id = $1', [colleague.id]);
          await commit(body, plan.previewToken, { auth: colleague, status: 401 });
          assert.deepEqual(await snapshot(), afterCommit);
        } finally {
          await pool.query(`UPDATE school_memberships SET revoked_at = NULL
            WHERE school_id = $1 AND account_id = $2`, [alpha.id, colleague.id]);
          await pool.query('UPDATE accounts SET disabled_at = NULL WHERE id = $1', [colleague.id]);
        }
      });

      await t.test('concurrent conflicting plans produce one complete winner and no partial losing import', async () => {
        const left = { kind: 'student', classId: otherClass.id, rows: [
          { number: 'race-left-only', name: 'Left only' }, { number: 'race-shared', name: 'Left name' },
        ] };
        const right = { kind: 'student', classId: otherClass.id, rows: [
          { number: 'race-right-only', name: 'Right only' }, { number: 'race-shared', name: 'Right name' },
        ] };
        const [{ data: leftPlan }, { data: rightPlan }] = await Promise.all([preview(left), preview(right)]);
        const before = await snapshot();
        const results = await Promise.all([
          commit(left, leftPlan.previewToken, { status: [200, 409] }),
          commit(right, rightPlan.previewToken, { status: [200, 409] }),
        ]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        const winner = results[0].status === 200 ? left : right;
        const loser = results.find(result => result.status === 409);
        assert.equal(loser.data.error.code, 'IMPORT_PREVIEW_STALE');
        const people = await numberRows(['race-left-only', 'race-right-only', 'race-shared']);
        assert.deepEqual(people.map(person => [person.number, person.name]),
          winner.rows.map(person => [person.number, person.name]).sort((a, b) => a[0].localeCompare(b[0])));
        const after = await snapshot();
        assert.equal(after.school_identities.count - before.school_identities.count, 2);
        assert.equal(after.school_class_roster.count - before.school_class_roster.count, 2);
        assert.equal(after.school_identity_imports.count - before.school_identity_imports.count, 1);
        assert.equal(after.school_audit_events.count - before.school_audit_events.count, 5);
      });

      await t.test('imports preserve accounts, legacy teaching data, Luq, grades, and account bindings', async () => {
        assert.deepEqual(await snapshot(protectedTables), protectedBefore);
        assert.deepEqual((await pool.query(`SELECT id, account_id FROM school_identities
          WHERE account_id IS NOT NULL ORDER BY id`)).rows,
        [{ id: existingStudent.id, account_id: student.id }, { id: existingTeacher.id, account_id: teacher.id }]
          .sort((a, b) => a.id.localeCompare(b.id)));
        assert.equal((await request('/auth/me', { auth: alphaAdmin })).data.user.roles.length, 0);
        await request('/accounts', { auth: alphaAdmin, status: 403 });
        await post('/classes', alphaAdmin, { name: 'Legacy escalation' }, 403);
      });
    } finally {
      await app?.close();
      await pool.end();
      if (schemaCreated) await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
