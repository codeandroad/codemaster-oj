import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { provisionSchool, lockSchoolTeaching } from '../src/schools.mjs';
import { schoolPracticeOperation } from '../src/school-practice.mjs';
import { schoolActivitiesOperation, activityJobVisible, schoolActivityProblemAccess } from '../src/school-activities.mjs';
import { GoJudge } from '../judge.mjs';
import { processSchoolOne } from '../school-worker.mjs';

const result = status => ({ status, score: status === 'AC' ? 100 : 0, passed: status === 'AC' ? 1 : 0, total: 1,
  publicMessage: '', privateResults: [{ position: 1, status, stdout: 'SECRET_OUTPUT', stderr: 'PRIVATE_NOTE', cpuMs: 5, memoryBytes: 2048 }] });

test('school activities preserve scope, fixed versions, deadline receipts and result confidentiality', { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && /^\/campus_(qa|test)(_[a-z0-9_]+)?$/i.test(base.pathname));
  const manager = createPool(base.href), schema = `activity_${randomBytes(6).toString('hex')}`;
  const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(scoped.href); let app, worker;
  const users = {}, identities = {};
  try {
    await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
    const grants = (await readFile(new URL('../grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1]; assert.ok(grants);
    await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
    const asRole = role => { const u = new URL(scoped); u.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return createPool(u.href); };
    app = asRole('campus_app'); worker = asRole('campus_worker');
    for (const name of ['admin', 'teacher', 'otherTeacher', 'student', 'peer', 'unassigned', 'outsider']) {
      const personId = randomUUID();
      await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2)", [personId, name]);
      users[name] = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id,identity_id AS "identityId"', [personId, name, 'test-unusable'])).rows[0];
    }
    const school = await provisionSchool(pool, { slug: 'activities-alpha', name: 'Alpha', adminUsername: 'admin' });
    const beta = await provisionSchool(pool, { slug: 'activities-beta', name: 'Beta', adminUsername: 'outsider' });
    for (const name of ['teacher', 'otherTeacher', 'student', 'peer', 'unassigned']) {
      const role = name.toLowerCase().includes('teacher') ? 'teacher' : 'student';
      await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [school.id, users[name].id, role]);
      identities[name] = (await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4) RETURNING id', [school.id, role, name, users[name].id])).rows[0].id;
    }
    const cls = (await pool.query("INSERT INTO school_classes(school_id,name,type) VALUES($1,'First class','training') RETURNING id", [school.id])).rows[0];
    await pool.query('INSERT INTO school_class_roster(school_id,class_id,identity_id) VALUES($1,$2,$3)', [school.id, cls.id, identities.student]);
    const call = async (name, route, method = 'GET', body = {}) => (await schoolActivitiesOperation({ pool: app, user: users[name], route: route.split('?')[0], url: new URL('http://test' + route), method, body })).body;
    const practice = async (name, route, method = 'GET', body = {}) => (await schoolPracticeOperation({ pool: app, user: users[name], route: route.split('?')[0], url: new URL('http://test' + route), method, body })).body;
    const path = `/schools/${school.id}/activities`, ppath = `/schools/${school.id}/problems`;
    const bank = await practice('teacher', `/schools/${school.id}/problem-banks`, 'POST', { name: 'Exercise bank', requestId: randomUUID() });
    const definition = { title: 'First problem', statement: 'Print five.', mode: 'stdio', referenceCode: 'print(5)', starterCode: '# start', samples: [{ input: '', expected: '5' }], tests: [{ input: 'SECRET_INPUT', expected: 'SECRET_EXPECTED', weight: 100 }] };
    const fixtures = [];
    for (const title of ['01. First', '02. Second']) {
      const draft = await practice('teacher', ppath, 'POST', { ...definition, title, bankId: bank.id, requestId: randomUUID() });
      await practice('teacher', `${ppath}/${draft.id}/validate`, 'POST', { expectedRevision: 1, requestId: randomUUID() });
      await processSchoolOne({ pool: worker, judge: { judge: async () => result('AC') } });
      fixtures.push(await practice('admin', `${ppath}/${draft.id}/publish`, 'POST', { expectedRevision: 1 }));
    }
    const [p, p2] = fixtures;
    const config = (extra = {}) => ({ kind: 'assignment', title: 'Practice assignment', description: 'Do the assigned problems.', problems: [{ problemId: p2.id, versionId: p2.versionId, points: 40 }, { problemId: p.id, versionId: p.versionId, points: 60 }], classIds: [cls.id], identityIds: [identities.peer, identities.unassigned], requestId: randomUUID(), ...extra });
    const submit = (activity, problem = p, fields = {}) => call('student', `${path}/${activity.id}/problems/${problem.id}/submissions`, 'POST', { kind: 'submit', code: 'print(5)', language: 'python', requestId: randomUUID(), ...fields });
    let assignment, timed, job;
    await t.test('cross-class/unassigned selection, stable order, create retry, owner and school authorization', async () => {
      const body = config();
      const copies = await Promise.all([call('teacher', path, 'POST', body), call('teacher', path, 'POST', body)]);
      assignment = copies[0]; assert.equal(copies[0].id, copies[1].id);
      assert.equal(assignment.participantCount, 3); assert.deepEqual(assignment.problems.map(x => x.id), [p2.id, p.id]);
      await assert.rejects(call('outsider', `${path}/${assignment.id}`), e => e.status === 404);
      await assert.rejects(call('otherTeacher', `${path}/${assignment.id}`), e => e.status === 404);
      await assert.rejects(call('student', `${path}/${assignment.id}`), e => e.status === 404);
      await assert.rejects(call('student', `${path}/options`), e => e.status === 403);
      await assert.rejects(call('teacher', path, 'POST', config({ identityIds: [randomUUID()] })), e => e.status === 404);
      await assert.rejects(call('outsider', `/schools/${beta.id}/activities`, 'POST', config({ classIds: [], identityIds: [] })), e => e.status === 404);
      assignment = await call('teacher', `${path}/${assignment.id}/publish`, 'POST', { expectedRevision: assignment.revision });
      await assert.rejects(call('teacher', `${path}/${assignment.id}`, 'PATCH', { ...body, expectedRevision: assignment.revision }), e => e.code === 'ACTIVITY_FROZEN');
      assert.equal((await call('unassigned', path)).items.length, 1);
      const d = await call('student', `${path}/${assignment.id}/problems/${p.id}`);
      assert.equal(d.versionId, p.versionId); assert.equal(d.definition.referenceCode, undefined);
      assert.ok(!JSON.stringify(d).includes('SECRET_'));
    });
    await t.test('assignment same-version AC inherits without fabricating activity jobs or rewards', async () => {
      const external = await practice('student', `${ppath}/${p.id}/submissions`, 'POST', { kind: 'submit', code: 'print(5)', requestId: randomUUID() });
      await processSchoolOne({ pool: worker, judge: { judge: async () => result('AC') } });
      const d = await call('student', `${path}/${assignment.id}`), inherited = d.grade.items.find(x => x.id === p.id);
      assert.equal(inherited.status, 'AC'); assert.equal(inherited.score, 60); assert.equal(inherited.inherited, true); assert.equal(inherited.attempts, 1); assert.equal(inherited.activityAttempts, 0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM school_judge_jobs WHERE activity_id=$1', [assignment.id])).rows[0].n, 0);
      assert.ok(external.id);
      const body = { kind: 'submit', code: 'print(0)', requestId: randomUUID() };
      const duplicates = await Promise.all([submit(assignment, p2, body), submit(assignment, p2, body)]);
      assert.equal(duplicates[0].id, duplicates[1].id);
      await processSchoolOne({ pool: worker, judge: { judge: async () => result('WA') } });
      const privateView = await call('student', `${path}/${assignment.id}/jobs/${duplicates[0].id}`);
      assert.equal(privateView.status, 'WA'); assert.ok(!JSON.stringify(privateView).includes('SECRET_')); assert.ok(!JSON.stringify(privateView).includes('PRIVATE_NOTE'));
      await assert.rejects(call('peer', `${path}/${assignment.id}/jobs/${duplicates[0].id}`), e => e.status === 404);
    });
    await t.test('timed start, server receipt snapshot, no inherited AC and unreleased-result barriers', async () => {
      timed = await call('teacher', path, 'POST', config({ kind: 'timed', startsAt: new Date(Date.now() - 10000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), durationMinutes: 30, classIds: [], identityIds: [identities.student, identities.peer] }));
      timed = await call('teacher', `${path}/${timed.id}/publish`, 'POST', { expectedRevision: 1 });
      assert.equal((await call('student', `${path}/${timed.id}`)).grade, null);
      await assert.rejects(submit(timed), e => e.code === 'ATTEMPT_CLOSED');
      const starts = await Promise.all([call('student', `${path}/${timed.id}/start`, 'POST'), call('student', `${path}/${timed.id}/start`, 'POST')]);
      assert.equal(starts[0].attempt.id, starts[1].attempt.id);
      assert.equal(+new Date(starts[0].attempt.deadlineAt) - +new Date(starts[0].attempt.startedAt), 30 * 60000);
      job = await submit(timed, p, { receivedAt: '2000-01-01', deadlineAt: '2099-01-01' });
      const receipt = (await pool.query('SELECT * FROM school_judge_jobs WHERE id=$1', [job.id])).rows[0];
      assert.equal(receipt.activity_attempt_id, starts[0].attempt.id); assert.equal(receipt.identity_id, identities.student); assert.ok(+receipt.created_at > Date.now() - 60000);
      await processSchoolOne({ pool: worker, judge: { judge: async () => result('AC') } });
      const hidden = await call('student', `${path}/${timed.id}/jobs/${job.id}`);
      assert.equal(hidden.status, 'Submitted'); assert.equal(hidden.score, null); assert.deepEqual(hidden.caseFeedback, []);
      assert.equal((await call('student', `${path}/${timed.id}`)).grade, null);
      const peer = await call('peer', `${path}/${timed.id}/problems/${p.id}/submissions`);
      assert.equal(peer.total, 0); assert.equal(peer.solved, false);
      const own = await call('student', `${path}/${timed.id}/problems/${p.id}/submissions`);
      assert.equal(own.total, 1); assert.equal(own.items[0].status, 'Submitted'); assert.equal(own.items[0].runtimeMs, null); assert.equal(own.solved, false);
      await transaction(app, async db => { await db.query("SELECT set_config('campus.school_id',$1,true)", [school.id]); assert.equal(await activityJobVisible(db, receipt), false); await assert.rejects(schoolActivityProblemAccess(db, { schoolId: school.id, problemId: p.id, user: users.student }), e => e.code === 'ACTIVITY_RESTRICTED'); });
      const report = await call('teacher', `${path}/${timed.id}/report`);
      assert.equal(report.items.find(x => x.id === identities.peer).grade.score, 0, 'Timed does not inherit another activity or practice');
      assert.equal(report.items.find(x => x.id === identities.student).grade.score, 60);
      await assert.rejects(call('student', `${path}/${timed.id}/report`), e => e.status === 404);
    });
    await t.test('personal deadline rejects new requests but retries return the original receipt', async () => {
      await pool.query("UPDATE school_activity_attempts SET started_at=clock_timestamp()-interval '2 minutes',deadline_at=clock_timestamp()-interval '1 minute' WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3", [school.id, timed.id, identities.student]);
      await assert.rejects(submit(timed, p2, { createdAt: '2000-01-01', activityDeadlineAt: '2099-01-01' }), e => e.code === 'ATTEMPT_CLOSED');
      const original = (await pool.query('SELECT request_id FROM school_judge_jobs WHERE id=$1', [job.id])).rows[0];
      assert.equal((await submit(timed, p, { requestId: original.request_id })).id, job.id);
      await assert.rejects(call('teacher', `${path}/${timed.id}/publish-results`, 'POST'), e => e.code === 'ACTIVITY_OPEN');
    });
    await t.test('first result publication waits for judging and freezes grades exactly once', async () => {
      await call('peer', `${path}/${timed.id}/start`, 'POST');
      const waiting = await call('peer', `${path}/${timed.id}/problems/${p2.id}/submissions`, 'POST', { kind: 'submit', code: 'print(5)', requestId: randomUUID() });
      await call('teacher', `${path}/${timed.id}/end`, 'POST');
      await assert.rejects(call('teacher', `${path}/${timed.id}/publish-results`, 'POST'), e => e.code === 'JUDGING_PENDING');
      await processSchoolOne({ pool: worker, judge: { judge: async () => result('AC') } });
      const published = await Promise.all([call('teacher', `${path}/${timed.id}/publish-results`, 'POST'), call('teacher', `${path}/${timed.id}/publish-results`, 'POST')]);
      assert.equal(published[0].resultsPublishedAt.toISOString(), published[1].resultsPublishedAt.toISOString());
      const d = await call('student', `${path}/${timed.id}`); assert.equal(d.grade.score, 60);
      assert.equal((await call('peer', `${path}/${timed.id}`)).grade.score, 40);
      assert.equal((await pool.query('SELECT count(*)::int n FROM school_activity_results WHERE activity_id=$1', [timed.id])).rows[0].n, 2);
      const metadata = await call('peer', `${path}/${timed.id}/problems/${p.id}/submissions?sort=runtimeMs&order=asc&pageSize=1`);
      assert.equal(metadata.total, 1); assert.equal(metadata.items[0].displayName, 'student'); assert.equal(metadata.items[0].runtimeMs, 5); assert.equal(metadata.items[0].memoryKb, 2); assert.ok(!JSON.stringify(metadata).includes('SECRET_'));
      await pool.query("UPDATE school_judge_jobs SET result=jsonb_set(result,'{score}','0') WHERE id=$1", [waiting.id]);
      assert.equal((await call('peer', `${path}/${timed.id}`)).grade.score, 40, 'Published snapshot is stable');
    });
    await t.test('activity freeze preserves fixed version and record identity', async () => {
      await practice('teacher', `${ppath}/${p.id}`, 'PATCH', { ...definition, title: 'New revision', expectedRevision: 1 });
      const d = await call('student', `${path}/${assignment.id}/problems/${p.id}`); assert.equal(d.versionId, p.versionId); assert.equal(d.title, '01. First');
      await call('teacher', `${path}/${assignment.id}/archive`, 'POST');
      assert.equal((await call('student', path)).items.some(x => x.id === assignment.id), false);
      const before = (await pool.query('SELECT count(*)::int n FROM school_judge_jobs WHERE activity_id=$1', [assignment.id])).rows[0].n;
      assert.ok(before > 0); assert.equal((await call('teacher', `${path}?archived=true`)).items[0].id, assignment.id);
    });
    await t.test('RLS and isolated worker keep activity/roster/source mutation privileges separate', async () => {
      for (const table of ['school_activities', 'school_activity_problems', 'school_activity_participants', 'school_activity_classes', 'school_activity_attempts', 'school_activity_results']) {
        assert.equal((await app.query(`SELECT * FROM ${table}`)).rowCount, 0, table);
        await assert.rejects(worker.query(`SELECT * FROM ${table}`), { code: '42501' });
      }
      await assert.rejects(worker.query('UPDATE school_judge_jobs SET activity_deadline_at=clock_timestamp()'), { code: '42501' });
      await assert.rejects(app.query('UPDATE school_activity_results SET grade=grade'), { code: '42501' });
      await assert.rejects(app.query('DELETE FROM school_activity_results'), { code: '42501' });
      await assert.rejects(pool.query('UPDATE school_activity_results SET grade=grade WHERE activity_id=$1', [timed.id]), { code: '55000' });
      await assert.rejects(pool.query('DELETE FROM school_activity_results WHERE activity_id=$1', [timed.id]), { code: '55000' });
      await assert.rejects(app.query("UPDATE school_judge_jobs SET state='completed'"), { code: '42501' });
      const foreign = await call('outsider', `/schools/${beta.id}/activities`); assert.equal(foreign.items.length, 0);
    });
    await t.test('incomplete timed drafts can be saved and archived but cannot publish', async () => {
      const draft = await call('teacher', path, 'POST', config({ kind: 'timed', startsAt: null, endsAt: null, durationMinutes: 30, problems: [], classIds: [], identityIds: [] }));
      await assert.rejects(call('teacher', path + '/' + draft.id + '/publish', 'POST', { expectedRevision: 1 }), e => e.status === 400);
      const archived = await call('teacher', path + '/' + draft.id + '/archive', 'POST');
      assert.equal(archived.state, 'Archived');
    });
    await t.test('real isolated executor judges fixed activity payloads and preserves safe feedback', { skip: !process.env.GO_JUDGE_TEST_URL }, async () => {
      const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN, environmentVersion: 'school-activity-qa' });
      await judge.ready();
      const draft = await practice('teacher', ppath, 'POST', { ...definition, title: 'Isolated activity fixture', tests: [{ input: 'HIDDEN_ACTIVITY_INPUT', expected: '5', weight: 100 }], bankId: bank.id, requestId: randomUUID() });
      await practice('teacher', ppath + '/' + draft.id + '/validate', 'POST', { expectedRevision: 1, requestId: randomUUID() });
      await processSchoolOne({ pool: worker, judge });
      const published = await practice('admin', ppath + '/' + draft.id + '/publish', 'POST', { expectedRevision: 1 });
      const a = await call('teacher', path, 'POST', config({ problems: [{ problemId: published.id, versionId: published.versionId, points: 100 }], classIds: [], identityIds: [identities.student] }));
      await call('teacher', path + '/' + a.id + '/publish', 'POST', { expectedRevision: 1 });
      for (const [kind, code, verdict] of [['samples', 'print(0)', 'WA'], ['submit', 'print(5)', 'AC']]) {
        const j = await submit(a, published, { kind, code });
        await processSchoolOne({ pool: worker, judge });
        const view = await call('student', path + '/' + a.id + '/jobs/' + j.id);
        assert.equal(view.status, verdict);
        assert.ok(!JSON.stringify(view).includes('HIDDEN_ACTIVITY_INPUT'));
        if (kind === 'submit') assert.equal(view.caseFeedback[0].input, undefined);
      }
      assert.equal((await call('student', path + '/' + a.id)).grade.score, 100);
    });
    await t.test('membership revocation serializes with student starts and reads', async () => {
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN'); await lockSchoolTeaching(writer, school.id);
        const pending = call('unassigned', path).then(() => ({ allowed: true }), error => ({ error }));
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          const n = (await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%school-teaching:%'")).rows[0].n;
          if (n) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(blocked);
        await writer.query('UPDATE school_memberships SET revoked_at=clock_timestamp() WHERE school_id=$1 AND account_id=$2', [school.id, users.unassigned.id]); await writer.query('COMMIT');
        assert.equal((await pending).error?.status, 404);
      } finally { await writer.query('ROLLBACK'); writer.release(); }
    });
  } finally {
    await app?.end(); await worker?.end(); await pool.end();
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
  }
});
