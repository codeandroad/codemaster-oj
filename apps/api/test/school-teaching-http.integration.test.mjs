import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { handleSchools, LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school directories and class rosters enforce tenant, role, and account boundaries',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
    const baseUrl = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(baseUrl.hostname) && /^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(baseUrl.pathname), 'Use an isolated local QA database.');
    const manager = createPool(baseUrl.href);
    const schema = 'school_teaching_' + randomBytes(6).toString('hex');
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    const origin = 'http://school-teaching.test';
    let app;
    let schemaCreated = false;
    try {
      await manager.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await migrate(pool);
      const grantsSource = await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8');
      const grantsSql = grantsSource.match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
      assert.ok(grantsSql);
      await pool.query(grantsSql.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const appUrl = new URL(url.href);
      appUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      await bootstrap(pool, { name: 'Legacy administrator', number: 'ADM', username: 'legacy-admin', password });
      const passwordHash = await hashPassword(password);
      // Membership-only login accounts use the shared authentication layer.
      // Their role in a school must never grant privileges on legacy routes.
      await transaction(pool, async db => {
        for (const username of ['alpha-admin', 'beta-admin', 'pilot-teacher', 'pilot-student']) {
          const identityId = randomUUID();
          await db.query(
            "INSERT INTO identities (id, kind, number, name) VALUES ($1, 'student', $2, $2)",
            [identityId, username]);
          await db.query(
            'INSERT INTO accounts (identity_id, username, password_hash) VALUES ($1, $2, $3)',
            [identityId, username, passwordHash]);
        }
      });

      app = await createApiApplication({
        databaseUrl: appUrl.href,
        logger: false,
        config: loadConfig({
          SESSION_SECRET: randomBytes(32).toString('base64url'),
          APP_ORIGIN: origin,
          COOKIE_SECURE: 'false',
        }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { status = 200, method = 'GET', body, auth, csrf = true } = {}) {
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
        const acceptedStatuses = Array.isArray(status) ? status : [status];
        assert.ok(acceptedStatuses.includes(response.status),
          `${method} ${path} returned ${response.status} (${data.error?.code ?? 'success'}), expected ${acceptedStatuses.join(' or ')}`);
        return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
      }
      const login = async username => {
        const { data, cookie } = await request('/auth/login', { method: 'POST', body: { username, password } });
        return { id: data.user.id, roles: data.user.roles, csrfToken: data.csrfToken, cookie };
      };
      const legacy = await login('legacy-admin');
      const alphaAdmin = await login('alpha-admin');
      const betaAdmin = await login('beta-admin');
      const teacher = await login('pilot-teacher');
      const student = await login('pilot-student');
      const alpha = await provisionSchool(pool, {
        slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin',
      });
      const beta = await provisionSchool(pool, {
        slug: 'school-beta', name: 'Beta School', adminUsername: 'beta-admin',
      });
      const schoolPath = (school, resource) => `/schools/${school.id}/${resource}`;
      const identities = school => schoolPath(school, 'identities');
      const classes = school => schoolPath(school, 'classes');
      const members = school => schoolPath(school, 'members');
      const roster = (school, cls) => `${classes(school)}/${cls.id}/roster`;
      const bind = (school, person) => `${identities(school)}/${person.id}/account`;
      const post = (path, auth, body, status = 201) => request(path, { method: 'POST', auth, body, status });
      const patch = (path, auth, body, status = 200) => request(path, { method: 'PATCH', auth, body, status });
      const remove = (path, auth, status = 200) => request(path, { method: 'DELETE', auth, status });
      const join = async (school, admin, member, role) => {
        const { data: invite } = await post(schoolPath(school, 'invitations'), admin, { role });
        await post('/school-invitations/accept', member, { token: invite.token }, 200);
      };
      await join(alpha, alphaAdmin, teacher, 'teacher');
      await join(alpha, alphaAdmin, student, 'student');
      await join(beta, betaAdmin, teacher, 'student');

      await request(identities(alpha), { status: 401 });
      await request(identities(alpha), { auth: legacy, status: 404 });
      await request(identities({ id: LEGACY_SCHOOL_ID }), { auth: legacy, status: 404 });
      await request(identities(beta), { auth: alphaAdmin, status: 404 });
      await request(identities(alpha), { auth: teacher, status: 403 });
      await request(identities(alpha), { auth: student, status: 403 });
      await request(identities(alpha), {
        method: 'POST', auth: alphaAdmin, csrf: false, status: 403,
        body: { kind: 'student', number: '01', name: 'CSRF attempt' },
      });

      const { data: alphaStudent } = await post(identities(alpha), alphaAdmin,
        { kind: 'student', number: '01', name: 'Alpha Learner', accountId: student.id });
      const { data: alphaTeacher } = await post(identities(alpha), alphaAdmin,
        { kind: 'teacher', number: '01', name: 'Alpha Instructor' });
      const { data: betaStudent } = await post(identities(beta), betaAdmin,
        { kind: 'student', number: '01', name: 'Beta Learner', accountId: teacher.id });
      assert.equal(alphaStudent.accountId, student.id);
      assert.equal(alphaTeacher.accountId, null);
      assert.equal(betaStudent.accountId, teacher.id);
      await post(identities(alpha), alphaAdmin, { kind: 'student', number: '01', name: 'Duplicate' }, 409);
      await post(identities(alpha), alphaAdmin, { kind: 'student', number: '02', name: 'Duplicate binding', accountId: student.id }, 409);
      await post(identities(alpha), alphaAdmin, { kind: 'student', number: '02', name: 'Wrong role', accountId: teacher.id }, 400);
      await post(identities(beta), betaAdmin, { kind: 'student', number: '02', name: 'Foreign account', accountId: student.id }, 404);
      await request(`${identities(alpha)}?page=0`, { auth: alphaAdmin, status: 400 });
      const { data: filtered } = await request(`${identities(alpha)}?kind=student&q=learner`, { auth: alphaAdmin });
      assert.deepEqual(filtered.items.map(person => person.id), [alphaStudent.id]);
      assert.equal(filtered.page, 1);
      assert.equal(filtered.hasMore, false);
      const { data: unlinkedBefore } = await request(`${members(alpha)}?role=teacher&unlinked=true`, { auth: alphaAdmin });
      assert.deepEqual(unlinkedBefore.items.map(member => member.accountId), [teacher.id]);
      await patch(bind(alpha, betaStudent), alphaAdmin, { accountId: student.id }, 404);
      await patch(bind(alpha, alphaTeacher), alphaAdmin, { accountId: student.id }, 400);
      assert.equal((await request(classes(alpha), { auth: teacher })).data.canCreate, false);
      await post(classes(alpha), teacher, { name: 'Unlinked teacher class', type: 'training' }, 403);
      const { data: bound } = await patch(bind(alpha, alphaTeacher), alphaAdmin, { accountId: teacher.id });
      assert.equal(bound.accountId, teacher.id);
      await patch(bind(alpha, alphaTeacher), alphaAdmin, { accountId: teacher.id });
      const { data: unlinkedAfter } = await request(`${members(alpha)}?role=teacher&unlinked=true`, { auth: alphaAdmin });
      assert.deepEqual(unlinkedAfter.items, []);

      const { data: taughtClass } = await post(classes(alpha), alphaAdmin, { name: 'Shared class name', type: 'administrative' });
      const { data: otherClass } = await post(classes(alpha), alphaAdmin, { name: 'Other Alpha class', type: 'training' });
      const { data: betaClass } = await post(classes(beta), betaAdmin, { name: 'Shared class name', type: 'administrative' });
      await post(classes(alpha), alphaAdmin, { name: taughtClass.name, type: 'training' }, 409);
      await post(classes(alpha), student, { name: 'Unauthorized class', type: 'training' }, 403);
      assert.deepEqual((await request(classes(alpha), { auth: student })).data.items, []);
      assert.deepEqual((await request(classes(beta), { auth: teacher })).data.items, []);
      assert.deepEqual((await request(classes(alpha), { auth: teacher })).data.items, []);
      await request(roster(alpha, taughtClass), { auth: teacher, status: 404 });
      await request(roster(alpha, betaClass), { auth: alphaAdmin, status: 404 });
      await request(roster(beta, taughtClass), { auth: betaAdmin, status: 404 });
      await post(roster(alpha, taughtClass), alphaAdmin, { identityId: betaStudent.id }, 404);
      await post(roster(alpha, betaClass), alphaAdmin, { identityId: alphaStudent.id }, 404);
      await post(roster(alpha, taughtClass), alphaAdmin, { identityId: alphaStudent.id });
      await post(roster(alpha, taughtClass), alphaAdmin, { identityId: alphaStudent.id });
      await post(roster(alpha, taughtClass), alphaAdmin, { identityId: alphaTeacher.id });

      await assert.rejects(pool.query(
        'INSERT INTO school_class_roster (school_id, class_id, identity_id) VALUES ($1, $2, $3)',
        [alpha.id, taughtClass.id, betaStudent.id]), { code: '23503' });
      await assert.rejects(pool.query(
        'INSERT INTO school_class_roster (school_id, class_id, identity_id) VALUES ($1, $2, $3)',
        [alpha.id, betaClass.id, alphaStudent.id]), { code: '23503' });
      await assert.rejects(pool.query(
        "UPDATE school_identities SET kind = 'teacher', number = 'DB-CHECK' WHERE id = $1",
        [alphaStudent.id]), { code: '23503' });

      const teacherClasses = (await request(classes(alpha), { auth: teacher })).data.items;
      assert.deepEqual(teacherClasses.map(cls => cls.id), [taughtClass.id]);
      const teacherRoster = (await request(roster(alpha, taughtClass), { auth: teacher })).data.items;
      assert.deepEqual(new Set(teacherRoster.map(person => person.id)), new Set([alphaStudent.id, alphaTeacher.id]));
      assert.equal(teacherRoster.length, 2, 'repeated roster add must not duplicate an identity');
      assert.ok(teacherRoster.every(person => !('accountId' in person)));
      await request(roster(alpha, otherClass), { auth: teacher, status: 404 });
      const studentClassItems = (await request(classes(alpha), { auth: student })).data.items;
      assert.deepEqual(studentClassItems.map(cls => cls.id), [taughtClass.id]);
      assert.equal(studentClassItems[0].canManage, false);
      assert.equal(studentClassItems[0].studentCount, 1);
      assert.deepEqual(studentClassItems[0].teachers, [{ id: alphaTeacher.id, name: alphaTeacher.name }]);
      const studentRoster = (await request(roster(alpha, taughtClass), { auth: student })).data.items;
      assert.deepEqual(studentRoster, [{ id: alphaStudent.id, kind: 'student', name: alphaStudent.name }]);
      assert.deepEqual((await request(`${roster(alpha, taughtClass)}?kind=teacher`, { auth: student })).data.items, studentRoster);
      await request(roster(alpha, otherClass), { auth: student, status: 404 });
      await post(roster(alpha, taughtClass), teacher, { identityId: alphaTeacher.id }, 403);
      await remove(`${roster(alpha, otherClass)}/${alphaStudent.id}`, teacher, 404);
      await remove(`${roster(alpha, taughtClass)}/${betaStudent.id}`, alphaAdmin, 404);

      // A linked teacher can create their own class and only manage its students.
      const { data: ownedClass } = await post(classes(alpha), teacher, { name: 'Teacher-created class', type: 'training' });
      assert.equal(ownedClass.revision, 1);
      assert.equal(ownedClass.archived, false);
      assert.equal((await request(classes(alpha), { auth: teacher })).data.canCreate, true);
      assert.deepEqual((await request(roster(alpha, ownedClass), { auth: teacher })).data.items.map(i => i.id), [alphaTeacher.id]);
      const candidates = (cls, suffix = '') => `${classes(alpha)}/${cls.id}/candidates${suffix}`;
      assert.deepEqual((await request(candidates(ownedClass), { auth: teacher })).data.items.map(i => i.id), [alphaStudent.id]);
      await request(candidates(ownedClass, '?kind=teacher'), { auth: teacher, status: 403 });
      await request(candidates(otherClass), { auth: teacher, status: 404 });
      await request(candidates(ownedClass), { auth: student, status: 403 });
      await request(`${classes(beta)}/${betaClass.id}/candidates`, { auth: teacher, status: 403 });
      await post(roster(alpha, ownedClass), teacher, { identityId: alphaTeacher.id }, 403);
      await post(roster(alpha, ownedClass), teacher, { identityId: alphaStudent.id });
      await post(roster(alpha, ownedClass), teacher, { identityId: alphaStudent.id });
      assert.deepEqual((await request(candidates(ownedClass), { auth: teacher })).data.items, []);
      const linkedStudent = (await request(`${roster(alpha, ownedClass)}?kind=student`, { auth: teacher })).data.items[0];
      assert.equal(linkedStudent.accountLinked, true);
      assert.equal(linkedStudent.accountStatus, 'active');
      assert.equal(linkedStudent.number, '01');
      assert.ok(!('accountId' in linkedStudent));
      await remove(`${roster(alpha, ownedClass)}/${alphaTeacher.id}`, teacher, 403);
      await remove(`${roster(alpha, ownedClass)}/${alphaStudent.id}`, teacher);
      await request(roster(alpha, ownedClass), { auth: student, status: 404 });

      await post(roster(alpha, ownedClass), teacher, { identityId: alphaStudent.id });
      const classResource = cls => `${classes(alpha)}/${cls.id}`;
      await patch(classResource(otherClass), teacher, { name: 'Not mine', type: 'training', expectedRevision: 1 }, 404);
      await patch(classResource(ownedClass), student, { name: 'Not authorized', type: 'training', expectedRevision: 1 }, 403);
      await patch(classResource(ownedClass), teacher, { name: 'Missing revision', type: 'training' }, 400);
      const updates = await Promise.all([
        patch(classResource(ownedClass), teacher, { name: 'Concurrent name A', type: 'administrative', expectedRevision: 1 }, [200, 409]),
        patch(classResource(ownedClass), alphaAdmin, { name: 'Concurrent name B', type: 'administrative', expectedRevision: 1 }, [200, 409]),
      ]);
      assert.equal(updates.filter(result => !result.data.error).length, 1, 'exactly one stale-version update wins');
      const updatedClass = updates.find(result => !result.data.error).data;
      assert.equal(updatedClass.revision, 2);
      assert.equal(updatedClass.type, 'administrative');
      await post(`${classResource(ownedClass)}/archive`, teacher, { expectedRevision: 1 }, 409);
      const { data: archivedClass } = await post(`${classResource(ownedClass)}/archive`, teacher, { expectedRevision: 2 }, 200);
      assert.equal(archivedClass.revision, 3);
      assert.equal(archivedClass.archived, true);
      assert.ok(!(await request(classes(alpha), { auth: teacher })).data.items.some(c => c.id === ownedClass.id));
      assert.deepEqual((await request(`${classes(alpha)}?archived=true`, { auth: teacher })).data.items.map(c => c.id), [ownedClass.id]);
      assert.ok(!(await request(`${classes(alpha)}?archived=true`, { auth: student })).data.items.some(c => c.id === ownedClass.id));
      assert.ok((await request(roster(alpha, ownedClass), { auth: teacher })).data.items.some(i => i.id === alphaTeacher.id), 'archiving preserves roster');
      await request(roster(alpha, ownedClass), { auth: student, status: 404 });
      await post(roster(alpha, ownedClass), teacher, { identityId: alphaStudent.id }, 409);
      await patch(classResource(ownedClass), teacher, { name: 'Cannot edit archive', type: 'training', expectedRevision: 3 }, 409);
      await request(candidates(ownedClass), { auth: teacher, status: 409 });
      const { data: restoredClass } = await post(`${classResource(ownedClass)}/restore`, teacher, { expectedRevision: 3 }, 200);
      assert.equal(restoredClass.archived, false);
      assert.equal(restoredClass.revision, 4);
      assert.equal(restoredClass.name, updatedClass.name);

      // Teachers import only students into their active, assigned class. The signed
      // preview is revalidated on commit, and retries create no extra identities.
      const importPath = action => schoolPath(alpha, `identity-imports/${action}`);
      const importInput = { kind: 'student', classId: ownedClass.id, rows: [{ number: 'IMP01', name: 'Imported learner' }] };
      await post(importPath('preview'), teacher, { ...importInput, classId: null }, 403);
      await post(importPath('preview'), teacher, { ...importInput, kind: 'teacher' }, 403);
      await post(importPath('preview'), teacher, { ...importInput, classId: otherClass.id }, 404);
      await post(importPath('preview'), teacher, { ...importInput, classId: betaClass.id }, 404);
      const { data: preview } = await post(importPath('preview'), teacher, importInput, 200);
      assert.equal(preview.canCommit, true);
      const commits = await Promise.all([
        post(importPath('commit'), teacher, { ...importInput, previewToken: preview.previewToken }, 200),
        post(importPath('commit'), teacher, { ...importInput, previewToken: preview.previewToken }, 200),
      ]);
      assert.deepEqual(commits[0].data, commits[1].data);
      assert.equal(commits[0].data.summary.created, 1);
      const imported = (await request(`${roster(alpha, ownedClass)}?kind=student`, { auth: teacher })).data.items.filter(i => i.number === 'IMP01');
      assert.equal(imported.length, 1);
      assert.equal(imported[0].name, 'Imported learner');
      assert.equal(imported[0].accountLinked, false);
      assert.equal(imported[0].accountStatus, 'unlinked');
      const staleInput = { ...importInput, rows: [{ number: 'IMP02', name: 'Stale learner' }] };
      const { data: beforeRemoval } = await post(importPath('preview'), teacher, staleInput, 200);
      await remove(`${roster(alpha, ownedClass)}/${alphaTeacher.id}`, alphaAdmin);
      await post(importPath('commit'), teacher, { ...staleInput, previewToken: beforeRemoval.previewToken }, 404);
      assert.equal((await pool.query("SELECT count(*)::int count FROM school_identities WHERE school_id=$1 AND number='IMP02'", [alpha.id])).rows[0].count, 0);
      // Keep the identity audit assertions below focused on the original access revocations.

      // Removing the teacher from the roster or disconnecting their account
      // must revoke classroom access immediately, even with the same session.
      await remove(`${roster(alpha, taughtClass)}/${alphaTeacher.id}`, alphaAdmin);
      await request(roster(alpha, taughtClass), { auth: teacher, status: 404 });
      await post(roster(alpha, taughtClass), alphaAdmin, { identityId: alphaTeacher.id });
      const staleUnlink = await patch(bind(alpha, alphaTeacher), alphaAdmin,
        { accountId: null, expectedAccountId: student.id }, 409);
      assert.equal(staleUnlink.data.error.code, 'CONFLICT');
      await request(roster(alpha, taughtClass), { auth: teacher });
      const unlinkTeacher = { accountId: null, expectedAccountId: teacher.id };
      await patch(bind(alpha, alphaTeacher), alphaAdmin, unlinkTeacher);
      await patch(bind(alpha, alphaTeacher), alphaAdmin, unlinkTeacher);
      await request(roster(alpha, taughtClass), { auth: teacher, status: 404 });
      await patch(bind(alpha, alphaTeacher), alphaAdmin, { accountId: teacher.id });
      await request(roster(alpha, taughtClass), { auth: teacher });
      // A deep link locates the class in the caller's authorized sorted pages,
      // without substituting the first row or revealing another school's class.
      const navigationClasses = [];
      for (let index = 0; index < 53; index++) {
        const cls = (await pool.query(`INSERT INTO school_classes(school_id,name,type)
          VALUES($1,$2,'training') RETURNING id`, [alpha.id, `Z navigation ${String(index).padStart(3, '0')}`])).rows[0];
        navigationClasses.push(cls);
        await pool.query(`INSERT INTO school_class_roster(school_id,class_id,identity_id)
          VALUES($1,$2,$3),($1,$2,$4)`, [alpha.id, cls.id, alphaTeacher.id, alphaStudent.id]);
      }
      const locatedId = navigationClasses.at(-1).id;
      for (const auth of [alphaAdmin, teacher, student]) {
        const located = (await request(`${classes(alpha)}?page=1&classId=${locatedId}`, { auth })).data;
        assert.equal(located.page, 2);
        assert.equal(located.archived, false);
        assert.ok(located.items.some(cls => cls.id === locatedId));
      }
      await request(`${classes(alpha)}?classId=${betaClass.id}`, { auth: alphaAdmin, status: 404 });
      await request(`${classes(alpha)}?classId=${randomUUID()}`, { auth: alphaAdmin, status: 404 });
      await request(`${classes(alpha)}?classId=${otherClass.id}`, { auth: teacher, status: 404 });
      await request(`${classes(alpha)}?classId=${otherClass.id}`, { auth: student, status: 404 });
      await request(`${classes(alpha)}?classId=bad-id`, { auth: alphaAdmin, status: 400 });
      const archivedTarget = navigationClasses[0];
      await post(`${classes(alpha)}/${archivedTarget.id}/archive`, alphaAdmin, { expectedRevision: 1 }, 200);
      const locatedArchived = (await request(`${classes(alpha)}?archived=false&classId=${archivedTarget.id}`, { auth: teacher })).data;
      assert.equal(locatedArchived.archived, true);
      assert.equal(locatedArchived.page, 1);
      assert.ok(locatedArchived.items.some(cls => cls.id === archivedTarget.id));
      await request(`${classes(alpha)}?classId=${archivedTarget.id}`, { auth: student, status: 404 });
      // Deterministically pause a real revocation after its school lock. A
      // simultaneous teacher read must wait before taking a membership SHARE
      // lock, otherwise the revoker and the read form a database deadlock.
      const revokeRuntime = createPool(appUrl.href);
      let announceSchoolLock;
      let resumeRevocation;
      const schoolLocked = new Promise(resolve => { announceSchoolLock = resolve; });
      const continueRevocation = new Promise(resolve => { resumeRevocation = resolve; });
      const gatedPool = {
        async connect() {
          const client = await revokeRuntime.connect();
          return {
            release: () => client.release(),
            async query(sql, values) {
              const result = await client.query(sql, values);
              if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock(') && values?.[0] === alpha.id) {
                announceSchoolLock();
                await continueRevocation;
              }
              return result;
            },
          };
        },
      };
      let revocation;
      let waitingReads;
      try {
        revocation = handleSchools({ pool: gatedPool, user: alphaAdmin, method: 'DELETE', route: `${members(alpha)}/${teacher.id}` });
        await schoolLocked;
        const reads = [
          request(classes(alpha), { auth: teacher, status: 404 }),
          post(importPath('preview'), teacher, importInput, 404),
          post(importPath('commit'), teacher, { ...importInput, previewToken: preview.previewToken }, 404),
        ];
        waitingReads = Promise.allSettled(reads);
        let waiters = 0;
        for (let attempt = 0; attempt < 100 && waiters < 3; attempt++) {
          waiters = (await pool.query(`SELECT count(*)::int count FROM pg_stat_activity
            WHERE datname = current_database() AND lower(wait_event) = 'advisory'
              AND query LIKE 'SELECT pg_advisory_xact_lock%'`)).rows[0].count;
          if (waiters < 3) await delay(20);
        }
        assert.equal(waiters, 3, 'teacher read, import preview and import commit all wait on the school lock');
        resumeRevocation();
        assert.equal((await revocation).status, 200);
        for (const read of await waitingReads) {
          assert.equal(read.status, 'fulfilled', read.reason?.message);
        }
      } finally {
        resumeRevocation();
        await Promise.allSettled([revocation, waitingReads].filter(Boolean));
        await revokeRuntime.end();
      }
      await request(classes(alpha), { auth: teacher, status: 404 });
      const alphaDirectory = (await request(identities(alpha), { auth: alphaAdmin })).data.items;
      assert.equal(alphaDirectory.find(person => person.id === alphaTeacher.id)?.accountId, null);
      const retainedRoster = (await request(roster(alpha, taughtClass), { auth: alphaAdmin })).data.items;
      assert.ok(retainedRoster.some(person => person.id === alphaTeacher.id));
      const betaDirectory = (await request(identities(beta), { auth: betaAdmin })).data.items;
      assert.equal(betaDirectory.find(person => person.id === betaStudent.id)?.accountId, teacher.id);
      await join(alpha, alphaAdmin, teacher, 'student');
      await request(roster(alpha, taughtClass), { auth: teacher, status: 404 });
      await patch(bind(alpha, alphaTeacher), alphaAdmin, { accountId: teacher.id }, 400);

      // If binding wins the race, revocation must detach it. If revocation
      // wins, binding must reject the now-inactive membership.
      await patch(bind(alpha, alphaStudent), alphaAdmin, { accountId: null });
      await Promise.all([
        patch(bind(alpha, alphaStudent), alphaAdmin, { accountId: student.id }, [200, 404]),
        remove(`${members(alpha)}/${student.id}`, alphaAdmin),
      ]);
      const { rows: [revokedBinding] } = await pool.query(
        'SELECT account_id FROM school_identities WHERE id = $1', [alphaStudent.id]);
      assert.equal(revokedBinding.account_id, null);

      assert.deepEqual((await request('/auth/me', { auth: alphaAdmin })).data.user.roles, []);
      assert.deepEqual((await request('/auth/me', { auth: teacher })).data.user.roles, []);
      await request('/accounts', { auth: alphaAdmin, status: 403 });
      await post('/classes', alphaAdmin, { name: 'Legacy escalation' }, 403);
      assert.deepEqual((await request('/classes', { auth: legacy })).data.items, []);
      assert.equal((await pool.query('SELECT count(*)::int count FROM identities')).rows[0].count, 5);
      assert.equal((await pool.query("SELECT count(*)::int count FROM audit_events WHERE action LIKE 'school.%'")).rows[0].count, 0);
      const { rows: audit } = await pool.query(`
        SELECT action, count(*)::int count FROM school_audit_events
        WHERE school_id = $1 AND target_id = $2 GROUP BY action`, [alpha.id, alphaTeacher.id]);
      assert.deepEqual(Object.fromEntries(audit.map(event => [event.action, event.count])), {
        'school.identity.create': 1,
        'school.identity.link': 2,
        'school.identity.unlink': 2,
        'school.roster.add': 3,
        'school.roster.remove': 2,
      });
      const { rows: [studentAudit] } = await pool.query(`
        SELECT count(*)::int count FROM school_audit_events
        WHERE school_id = $1 AND target_id = $2 AND action = 'school.roster.add'`, [alpha.id, alphaStudent.id]);
      assert.equal(studentAudit.count, 3);
    } finally {
      await app?.close();
      await pool.end();
      if (schemaCreated) await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
