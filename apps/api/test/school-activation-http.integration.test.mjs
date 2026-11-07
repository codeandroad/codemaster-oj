import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school activation isolates same-name and same-number identities and consumes credentials atomically',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async t => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.match(url.pathname, /^\/campus_(qa|test)(?:_|$)/);
    const manager = createPool(url.href), schema = `school_activation_${randomBytes(6).toString('hex')}`;
    await manager.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const owner = createPool(url.href), password = randomBytes(24).toString('base64url'), origin = 'http://activation.test';
    let app;
    try {
      await migrate(owner);
      await bootstrap(owner, { name: 'Original admin', number: 'ADMIN', username: 'legacy-admin', password });
      const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
      await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const appUrl = new URL(url); appUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      app = await createApiApplication({ databaseUrl: appUrl.href, logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
      await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
      async function request(path, { body, method = 'GET', auth, status = 200, csrf = true } = {}) {
        const response = await fetch(base + '/api/v1' + path, { method,
          headers: { Origin: origin, ...(body !== undefined && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.data.csrfToken }) }) },
          body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await response.json();
        assert.ok([status].flat().includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(data.error ?? {})}`);
        return { data, cookie: response.headers.get('set-cookie')?.split(';')[0], status: response.status };
      }
      const personal = username => request('/auth/register-personal', { method: 'POST', status: 201, body: { username, displayName: username, password } });
      const adminA = await personal('alpha-admin'), adminB = await personal('beta-admin');
      const alpha = await provisionSchool(owner, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      const beta = await provisionSchool(owner, { slug: 'school-beta', name: 'Beta School', adminUsername: 'beta-admin' });
      const identity = async (school, auth, number = '001', kind = 'student') => (await request(`/schools/${school.id}/identities`,
        { method: 'POST', auth, status: 201, body: { kind, number, name: 'Same Name' } })).data;
      const issuePath = (school, person) => `/schools/${school.id}/identities/${person.id}/activation-code`;
      const issue = async (school, auth, person) => (await request(issuePath(school, person), { method: 'POST', body: {}, auth, status: 201 })).data;
      const claim = (school, person, code) => ({ schoolSlug: school.slug, kind: person.kind, number: person.number, name: person.name, activationCode: code });
      const verify = (body, status = 200) => request('/auth/verify-identity', { method: 'POST', body, status });
      const register = (body, username, status = 201) => request('/auth/register', { method: 'POST', body: { ...body, username, password, email: '' }, status });
      const a = await identity(alpha, adminA), b = await identity(beta, adminB);
      const ca = await issue(alpha, adminA, a), cb = await issue(beta, adminB, b);
      await t.test('public school selector exposes only display names and identifiers without granting membership', async () => {
        await owner.query('UPDATE schools SET name_zh=$2,name_en=$3 WHERE id=$1', [alpha.id, '甲学校', 'Alpha School']);
        const before = (await owner.query('SELECT (SELECT count(*) FROM accounts)::int accounts,(SELECT count(*) FROM school_memberships)::int memberships,(SELECT count(*) FROM school_activation_tokens WHERE consumed_at IS NOT NULL)::int consumed')).rows[0];
        const items = (await request('/auth/activation-schools')).data.items;
        assert.equal(items.length, 3);
        assert.ok(items.some(item => item.slug === 'legacy-school'));
        assert.ok(items.some(item => item.slug === beta.slug));
        assert.deepEqual(items.find(item => item.id === alpha.id), { id: alpha.id, slug: alpha.slug, name: '甲学校', nameZh: '甲学校', nameEn: 'Alpha School' });
        for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['id', 'name', 'nameEn', 'nameZh', 'slug']);
        const json = JSON.stringify(items);
        for (const secret of [a.id, b.id, ca.activationCode, cb.activationCode, 'Same Name', adminA.data.user.username]) assert.ok(!json.includes(secret));
        assert.deepEqual((await request('/auth/activation-schools', { auth: adminA })).data.items, items);
        assert.deepEqual((await request(`/auth/activation-schools?schoolId=${alpha.id}&number=001&include=identities`)).data.items, items);
        await request('/schools', { status: 401 });
        await request(`/schools/${alpha.id}/identities`, { status: 401 });
        assert.deepEqual((await owner.query('SELECT (SELECT count(*) FROM accounts)::int accounts,(SELECT count(*) FROM school_memberships)::int memberships,(SELECT count(*) FROM school_activation_tokens WHERE consumed_at IS NOT NULL)::int consumed')).rows[0], before);
      });
      await t.test('issuance uses school authorization, CSRF and private one-time credentials', async () => {
        await request(issuePath(alpha, a), { method: 'POST', body: {}, status: 401 });
        await request(issuePath(alpha, a), { method: 'POST', body: {}, auth: adminB, status: 404 });
        await request(issuePath(alpha, b), { method: 'POST', body: {}, auth: adminA, status: 404 });
        await request(issuePath(alpha, a), { method: 'POST', body: {}, auth: adminA, csrf: false, status: 403 });
        await request(`/schools/${alpha.id}/identities`, { status: 401 });
        const publicDirectory = JSON.stringify((await request(`/schools/${alpha.id}/identities`, { auth: adminA })).data);
        assert.ok(!publicDirectory.includes(ca.activationCode));
        assert.notEqual((await owner.query('SELECT token_hash FROM school_activation_tokens WHERE identity_id=$1', [a.id])).rows[0].token_hash, ca.activationCode);
        assert.equal((await owner.query("SELECT has_table_privilege('campus_worker',$1,'SELECT') allowed", [`${schema}.school_activation_tokens`])).rows[0].allowed, false);
      });
      await t.test('same number and name are matched only inside the provided school, with uniform failures', async () => {
        const wrongSchool = await verify(claim(beta, b, ca.activationCode), 400);
        const unknownSchool = await verify({ ...claim(alpha, a, ca.activationCode), schoolSlug: 'missing-school' }, 400);
        const wrongName = await verify({ ...claim(alpha, a, ca.activationCode), name: 'Other Name' }, 400);
        assert.deepEqual(wrongSchool.data.error, unknownSchool.data.error);
        assert.deepEqual(wrongSchool.data.error, wrongName.data.error);
        const wrongRegistration = await register(claim(beta, b, ca.activationCode), 'wrong-school-student', 400);
        assert.deepEqual(wrongRegistration.data.error, wrongSchool.data.error);
        assert.equal((await owner.query("SELECT count(*)::int n FROM accounts WHERE username='wrong-school-student'")).rows[0].n, 0);
        const ac = claim(alpha, a, ca.activationCode); delete ac.schoolSlug;
        await verify(ac, 400); // Legacy fallback never searches pilot identities.
        const preview = (await verify(claim(alpha, a, ca.activationCode))).data;
        assert.equal(preview.school.id, alpha.id); assert.equal(preview.person.number, '001');
        assert.equal(preview.person.id, undefined); assert.equal(preview.person.accountId, undefined);
      });
      let registeredA;
      await t.test('concurrent registration creates exactly one account and preserves the school identity and roster', async () => {
        const cls = (await request(`/schools/${alpha.id}/classes`, { method: 'POST', auth: adminA, status: 201, body: { name: 'Existing class', type: 'training' } })).data;
        await request(`/schools/${alpha.id}/classes/${cls.id}/roster`, { method: 'POST', auth: adminA, status: 201, body: { identityId: a.id } });
        const preview = (await verify(claim(alpha, a, ca.activationCode))).data;
        assert.deepEqual(preview.person.classes, [{ name: 'Existing class' }]);
        const attempts = await Promise.all(['candidate-one', 'candidate-two'].map(login => register(claim(alpha, a, ca.activationCode), login, [201,400])));
        assert.deepEqual(attempts.map(item => item.status).sort(), [201,400]);
        registeredA = attempts.find(item => item.status === 201);
        assert.deepEqual(registeredA.data.user.roles, []); assert.equal(registeredA.data.user.defaultSchoolId, alpha.id);
        const retained = (await owner.query('SELECT account_id FROM school_identities WHERE school_id=$1 AND id=$2', [alpha.id, a.id])).rows[0];
        assert.equal(retained.account_id, registeredA.data.user.id);
        assert.equal((await owner.query('SELECT count(*)::int n FROM school_class_roster WHERE identity_id=$1', [a.id])).rows[0].n, 1);
        assert.equal((await owner.query('SELECT count(*)::int n FROM legacy_school_account_ownership WHERE account_id=$1', [retained.account_id])).rows[0].n, 0);
        assert.equal((await owner.query("SELECT count(*)::int n FROM school_audit_events WHERE action='school.identity.claim' AND target_id=$1", [a.id])).rows[0].n, 1);
        await register(claim(alpha, a, ca.activationCode), 'candidate-repeat', 400);
        await request(issuePath(alpha, a), { method: 'POST', body: {}, auth: adminA, status: 409 });
        await request('/accounts', { auth: registeredA, status: 403 });
      });
      await t.test('the same identity number and name at another school remain independently claimable', async () => {
        const registeredB = await register(claim(beta, b, cb.activationCode), 'beta-student');
        assert.notEqual(registeredA.data.user.identityId, registeredB.data.user.identityId);
        const schoolList = (await request('/schools', { auth: registeredB })).data.items;
        assert.deepEqual(schoolList.map(school => school.id), [beta.id]);
        await request(`/schools/${alpha.id}/identities`, { auth: registeredB, status: 404 });
      });
      await t.test('reissue, expiry and issuer revocation invalidate credentials, including teacher identities', async () => {
        const person = await identity(alpha, adminA, 'T001', 'teacher');
        const otherTeacher = await identity(beta, adminB, 'T001', 'teacher');
        const first = await issue(alpha, adminA, person), second = await issue(alpha, adminA, person);
        const betaCode = await issue(beta, adminB, otherTeacher);
        await verify(claim(alpha, person, betaCode.activationCode), 400);
        await verify(claim(beta, otherTeacher, second.activationCode), 400);
        await verify(claim(alpha, person, first.activationCode), 400);
        await owner.query("UPDATE school_activation_tokens SET expires_at=now()-interval '1 second' WHERE identity_id=$1", [person.id]);
        await register(claim(alpha, person, second.activationCode), 'expired-teacher', 400);
        const third = await issue(alpha, adminA, person);
        await owner.query('UPDATE accounts SET disabled_at=now() WHERE id=$1', [adminA.data.user.id]);
        await verify(claim(alpha, person, third.activationCode), 400);
        await owner.query('UPDATE accounts SET disabled_at=NULL WHERE id=$1', [adminA.data.user.id]);
        const registered = await register(claim(alpha, person, third.activationCode), 'active-teacher');
        assert.deepEqual((await request('/schools', { auth: registered })).data.items[0].roles, ['teacher']);
        const betaRegistered = await register(claim(beta, otherTeacher, betaCode.activationCode), 'beta-teacher');
        assert.notEqual(betaRegistered.data.user.identityId, registered.data.user.identityId);
        assert.deepEqual((await request('/schools', { auth: betaRegistered })).data.items[0].roles, ['teacher']);
      });
      await t.test('original school activation stays scoped and retains its stable identity and roles', async () => {
        const legacy = await request('/auth/login', { method: 'POST', body: { username: 'legacy-admin', password } });
        const p = (await request('/people', { auth: legacy, method: 'POST', status: 201, body: { kind: 'student', number: '001', name: 'Same Name' } })).data;
        const body = claim({ slug: 'legacy-school' }, p.person, p.activationCode);
        await verify({ ...body, schoolSlug: alpha.slug }, 400);
        assert.equal((await verify(body)).data.school.slug, 'legacy-school');
        const registered = await register(body, 'legacy-student');
        assert.equal(registered.data.user.identityId, p.person.id); assert.deepEqual(registered.data.user.roles, ['student']);
        const q = (await request('/people', { auth: legacy, method: 'POST', status: 201, body: { kind: 'teacher', number: 'T-OLD', name: 'Teacher' } })).data;
        const compatibility = claim({ slug: 'legacy-school' }, q.person, q.activationCode); delete compatibility.schoolSlug;
        await register(compatibility, 'old-client-teacher');
      });
    } finally { await app?.close(); await owner.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end(); }
  });
