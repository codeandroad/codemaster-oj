import { enrollWithClaim } from './support/workspace-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { LEGACY_SCHOOL_ID } from '../../../packages/domain/test/fixtures/pre-workspace/legacy-school.mjs';

test('school exits require approval, archive the original dossier and retain the personal login', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 120000,
}, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/campus_(qa|test)(?:_|$)/);
  const manager = createPool(url.href);
  const schema = 'school_exits_' + randomBytes(6).toString('hex');
  await manager.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const owner = createPool(url.href);
  const password = randomBytes(24).toString('base64url');
  const origin = 'http://school-exits.test';
  let app;
  try {
    await migrate(owner);
    await bootstrap(owner,{schoolSlug:'tianxing-chuangshiji', name: 'Legacy administrator', number: 'ADM', username: 'legacy-admin', password });
    const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
    await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const runtime = new URL(url);
    runtime.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
    app = await createApiApplication({ databaseUrl: runtime.href, logger: false,
      config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    async function request(path, { method = 'GET', body, auth, expected = 200, csrf = true } = {}) {
      const response = await fetch(base + '/api/v1' + path, {
        method, headers: { Origin: origin, ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.data.csrfToken }) }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.ok([expected].flat().includes(response.status),
        `${method} ${path}: ${response.status}, expected ${expected}: ${JSON.stringify(data.error ?? {})}`);
      return { data, status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    const personal = username => request('/auth/register-personal', {
      method: 'POST', expected: 201, body: { username, displayName: username, password },
    });
    const login = username => request('/auth/login', { method: 'POST', body: { username, password } });
    const post = (path, auth, body = {}, expected = 200) => request(path, { method: 'POST', auth, body, expected });
    const schoolList = async auth => (await request('/schools', { auth })).data.items.map(school => school.id);
    const legacy = await login('legacy-admin');
    const alphaAdmin = await personal('exit-alpha-admin'), betaAdmin = await personal('exit-beta-admin');
    const alpha = await provisionSchool(owner, { slug: 'exit-alpha', name: 'Exit Alpha', adminUsername: 'exit-alpha-admin' });
    const beta = await provisionSchool(owner, { slug: 'exit-beta', name: 'Exit Beta', adminUsername: 'exit-beta-admin' });
    const prefix = `/schools/${alpha.id}`;
    const student = await personal('exit-student');
    const teacher = await personal('exit-teacher');
    const studentId = student.data.user.id;
    const identity = await enrollWithClaim(post,alpha,alphaAdmin,student,{kind:'student',number:'ALPHA-1',name:'Alpha learner'});
    await enrollWithClaim(post,beta,betaAdmin,student,{kind:'student',number:'B1',name:'Beta learner'});
    await enrollWithClaim(post,alpha,alphaAdmin,teacher,{kind:'teacher',number:'T1',name:'Alpha teacher'});
    const schoolClass = (await post(prefix + '/classes', alphaAdmin, { name: 'QA class', type: 'training' }, 201)).data;
    const roster = `${prefix}/classes/${schoolClass.id}/roster`;
    await post(roster, alphaAdmin, { identityId: identity.id }, 201);
    await request('/auth/default-workspace', { method: 'PATCH', auth: student, body: { defaultSchoolId: alpha.id } });
    const wallet = prefix + '/scholarship/wallet';
    await post(prefix + '/scholarship/grant', alphaAdmin, {
      identityIds: [identity.id], requestId: randomUUID(), amount: 31, reason: 'QA history',
    });
    const schoolBalance = (await request(wallet, { auth: student })).data.balance;
    const apply = prefix + '/exit-request';
    const history = prefix + '/exit-requests';
    const direct = prefix + '/student-exits';
    const decide = (id, auth, decision, expected = 200) => post(`${history}/${id}/decision`, auth, { decision, note: 'QA decision' }, expected);

    await t.test('student requests are private and repeatable; rejection leaves access intact', async () => {
      await request(apply, { expected: 401 });
      await request(apply, { method: 'POST', auth: student, body: {}, csrf: false, expected: 403 });
      await post(apply, teacher, {}, 404);
      await request(history, { auth: student, expected: 403 });
      await request(history, { auth: teacher, expected: 403 });
      await request(history, { auth: betaAdmin, expected: 404 });
      await post(direct, student, { accountId: studentId }, 403);
      assert.equal((await request(apply, { auth: student })).data.request, null);
      const requests = await Promise.all([post(apply, student, { reason: 'Moving' }, [200, 201]), post(apply, student, { reason: 'Moving' }, [200, 201])]);
      assert.deepEqual(requests.map(entry => entry.status).sort(), [200, 201]);
      const pendingId = requests[0].data.request.id;
      assert.equal(requests[1].data.request.id, pendingId);
      assert.equal('reviewedBy' in requests[0].data.request, false);
      const list = (await request(history, { auth: alphaAdmin })).data.items;
      assert.deepEqual(list.map(item => [item.id, item.studentNumber, item.status]), [[pendingId, 'ALPHA-1', 'pending']]);
      await decide(pendingId, student, 'approve', 403);
      await decide(pendingId, betaAdmin, 'approve', 404);
      await post(`/schools/${beta.id}/exit-requests/${pendingId}/decision`, betaAdmin, { decision: 'approve' }, 404);
      await decide(pendingId, alphaAdmin, 'reject');
      assert.ok((await schoolList(student)).includes(alpha.id));
      assert.equal((await request(apply, { auth: student })).data.request.reviewNote, 'QA decision');
    });

    await t.test('approval is atomic and removes only the selected school access', async () => {
      const pending = (await post(apply, student, {}, 201)).data.request;
      const previousCandidate = (await request(direct + '?q=Alpha+learner', { auth: alphaAdmin })).data.items[0];
      const approvals = await Promise.all([decide(pending.id, alphaAdmin, 'approve'), decide(pending.id, alphaAdmin, 'approve')]);
      assert.deepEqual(approvals.map(result => result.data.status), ['approved', 'approved']);
      await decide(pending.id, alphaAdmin, 'reject', 409);
      assert.deepEqual(await schoolList(student), [beta.id]);
      assert.equal((await request('/auth/default-workspace', { auth: student })).data.defaultSchoolId, null);
      assert.equal((await request('/auth/me', { auth: student })).data.user.id, studentId);
      assert.equal((await request(apply, { auth: student })).data.request.status, 'approved');
      await request(roster, { auth: student, expected: 404 });
      await request(wallet, { auth: student, expected: 404 });
      assert.deepEqual((await request(prefix + '/scholarship/recipients', { auth: alphaAdmin })).data.items, []);
      await post(`${prefix}/identities/${identity.id}/activation-code`, alphaAdmin, {}, 404);
      await request(`${roster}/${identity.id}`, { method: 'DELETE', auth: alphaAdmin, expected: 404 });
      assert.deepEqual((await request(roster, { auth: alphaAdmin })).data.items, []);
      assert.deepEqual((await request(history + '?status=approved', { auth: alphaAdmin })).data.items.map(item => item.id), [pending.id]);
      assert.deepEqual((await request(prefix + '/activities/options', { auth: alphaAdmin })).data.students, []);
      const { rows: [snapshot] } = await owner.query(`SELECT i.account_id,i.archived_at,a.balance,
        (SELECT count(*)::int FROM school_class_roster WHERE identity_id=i.id) AS roster,
        (SELECT count(*)::int FROM school_scholarship_ledger WHERE identity_id=i.id AND kind='admin_grant') AS ledger,
        (SELECT count(*)::int FROM school_audit_events WHERE target_id=$2 AND action='school.exit.approved') AS decisions
        FROM school_identities i JOIN school_scholarship_accounts a ON a.school_id=i.school_id AND a.identity_id=i.id
        WHERE i.id=$1`, [identity.id, pending.id]);
      assert.ok(snapshot.archived_at);
      assert.deepEqual({ ...snapshot, archived_at: true }, { account_id: null, archived_at: true, balance: schoolBalance, roster: 1, ledger: 1, decisions: 1 });
      const newIdentity = await enrollWithClaim(post,alpha,alphaAdmin,student,{kind:'student',name:'Rejoined learner',number:'ALPHA-2'});
      const candidates = (await request(direct + '?q=Rejoined+learner', { auth: alphaAdmin })).data.items;
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].identityId, newIdentity.id, 'rejoining does not reclaim an archived dossier');
      await post(direct, alphaAdmin, { accountId: studentId, membershipStartedAt: previousCandidate.membershipStartedAt, identityId: previousCandidate.identityId }, 409);
      await post(direct, alphaAdmin, { accountId: studentId, membershipStartedAt: candidates[0].membershipStartedAt, identityId:newIdentity.id }, 201);
      assert.deepEqual(await schoolList(student), [beta.id]);
    });

    await t.test('an elevated student cannot drop an administrator membership through a student exit', async () => {
      const elevated = await personal('exit-elevated');
      const id = elevated.data.user.id;
      await enrollWithClaim(post,alpha,alphaAdmin,elevated,{kind:'student',number:'S3',name:'Elevated learner'});
      await owner.query('INSERT INTO school_administrators(school_id,account_id,granted_by) VALUES($1,$2,$3)', [alpha.id, id, alphaAdmin.data.user.id]);
      await post(apply, elevated, {}, 404);
      await post(direct, alphaAdmin, { accountId: id }, 404);
      await request(`${prefix}/members/${id}`, { method: 'DELETE', auth: alphaAdmin, expected: 404 });
      assert.deepEqual(await schoolList(elevated), [alpha.id]);
    });

    await t.test('legacy administrator detaches the school dossier while preserving the same credentials', async () => {
      const account = await personal('exit-legacy-student');
      const school = (await request('/schools',{auth:legacy})).data.items.find(s=>s.id===LEGACY_SCHOOL_ID);
      const schoolRecord = await enrollWithClaim(post,school,legacy,account,{kind:'student',number:'OLD-1',name:'Legacy learner'});
      const id = account.data.user.id, dossier = account.data.user.identityId;
      await enrollWithClaim(post,beta,betaAdmin,account,{kind:'student',number:'B2',name:'Legacy learner'});
      const legacyPath = '/schools/' + LEGACY_SCHOOL_ID;
      const schoolClass = (await post(legacyPath + '/classes', legacy, {name:'Legacy class',type:'training'}, 201)).data;
      await post(legacyPath + '/classes/' + schoolClass.id + '/roster', legacy, {identityId:schoolRecord.id}, 201);
      await post(legacyPath + '/scholarship/grant', legacy, {
        identityIds:[schoolRecord.id], amount:17, reason:'QA history', requestId:randomUUID(),
      });
      const balance = (await request(legacyPath + '/scholarship/wallet', {auth:account})).data.balance;
      const assignment = (await owner.query(`INSERT INTO school_activities(school_id,owner_account_id,kind,title,state,request_id,request_hash)
        VALUES($1,$2,'assignment','Legacy assignment','Published',gen_random_uuid(),'exit-history') RETURNING id`,
        [school.id,legacy.data.user.id])).rows[0].id;
      const participant = [school.id,assignment,schoolRecord.id];
      await owner.query('INSERT INTO school_activity_participants(school_id,activity_id,identity_id) VALUES($1,$2,$3)',participant);
      await owner.query('INSERT INTO school_activity_attempts(school_id,activity_id,identity_id,account_id) VALUES($1,$2,$3,$4)',[...participant,id]);
      await owner.query('INSERT INTO school_activity_results(school_id,activity_id,identity_id,grade) VALUES($1,$2,$3,$4)',[...participant,{score:100}]);
      await request('/auth/default-workspace', { method: 'PATCH', auth: account, body: { defaultSchoolId: school.id } });
      const pending = (await post(legacyPath + '/exit-request', account, {}, 201)).data.request;
      await post(`${legacyPath}/exit-requests/${pending.id}/decision`, betaAdmin, { decision: 'approve' }, 404);
      await post(`${legacyPath}/exit-requests/${pending.id}/decision`, legacy, { decision: 'approve' });
      assert.deepEqual(await schoolList(account), [beta.id]);
      const me = (await request('/auth/me', { auth: account })).data.user;
      assert.equal(me.id, id);
      assert.equal(me.identityId, dossier);
      assert.deepEqual(me.roles, []);
      assert.equal(me.defaultSchoolId, null);
      assert.equal((await login('exit-legacy-student')).data.user.id, id);
      await request(legacyPath+'/classes', { auth: account, expected: 404 });
      await post(legacyPath+'/identities/'+schoolRecord.id+'/restore', legacy, {}, 409);
      await post(legacyPath+'/identities/'+schoolRecord.id+'/activation-code', legacy, {}, 404);
      const archived = (await request(legacyPath+'/identities/'+schoolRecord.id+'/details', { auth: legacy })).data;
      assert.equal(archived.archivedByExit, true);
      assert.equal(archived.canArchive, false);
      assert.equal((await owner.query('SELECT count(*)::int n FROM school_class_roster WHERE identity_id=$1', [schoolRecord.id])).rows[0].n, 1);
      assert.equal((await owner.query('SELECT balance FROM school_scholarship_accounts WHERE identity_id=$1', [schoolRecord.id])).rows[0].balance, balance);
      const {rows:[retained]} = await owner.query(`SELECT a.account_id,r.grade FROM school_activity_attempts a
        JOIN school_activity_results r USING(school_id,activity_id,identity_id)
        JOIN school_activity_participants p USING(school_id,activity_id,identity_id)
        WHERE a.school_id=$1 AND a.activity_id=$2 AND a.identity_id=$3`,participant);
      assert.deepEqual(retained,{account_id:id,grade:{score:100}});
    });

    const { rows: [grantsAfter] } = await owner.query(`SELECT
      has_table_privilege('campus_worker', $1, 'SELECT') AS worker_reads,
      has_table_privilege('campus_app', $1, 'DELETE') AS app_deletes,
      has_column_privilege('campus_app', $1, 'account_id', 'UPDATE') AS app_reassigns,
      to_regprocedure($2) IS NOT NULL AS obsolete_detach_exists`,
    [`${schema}.school_exit_requests`, `${schema}.detach_legacy_school_student(uuid,uuid,uuid,uuid)`]);
    assert.deepEqual(grantsAfter, { worker_reads: false, app_deletes: false, app_reassigns: false, obsolete_detach_exists: false });
  } finally {
    await app?.close();
    await owner.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`);
    await manager.end();
  }
});
