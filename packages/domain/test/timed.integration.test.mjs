import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { createTimedService } from '../src/timed.mjs';

const url = process.env.TEST_DATABASE_URL ?? process.env.JUDGE_TEST_DATABASE_URL;
let manager, pool, schema, timed, teacher, student, outsider, classId, problemId, version;
const call = (route, method, user, body = {}) => timed.handle({ route, method, user, body, url: new URL('http://localhost/api/v1' + route) });
const failure = (code) => (error) => error.code === code;

test.before(async () => {
  if (!url) return;
  manager = createPool(url); schema = `timed_test_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const conn = new URL(url); conn.searchParams.set('options', `-csearch_path=${schema}`);
  pool = createPool(conn.toString()); await migrate(pool); timed = createTimedService(pool);
  async function user(kind, number) {
    const identityId = (await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id', [kind, number])).rows[0].id;
    const id = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$2) RETURNING id', [identityId, number.toLowerCase()])).rows[0].id;
    await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, kind]);
    return { id, identityId, roles: [kind] };
  }
  teacher = await user('teacher', 'TIMED-TEACHER'); student = await user('student', 'TIMED-STUDENT'); outsider = await user('student', 'TIMED-OUTSIDER');
  classId = (await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Timed Test',$1) RETURNING id", [teacher.id])).rows[0].id;
  await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)', [classId, teacher.id]);
  await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [classId, student.identityId]);
  problemId = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [teacher.id])).rows[0].id;
  version = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,samples,time_limit_ms,memory_limit_mb,comparator,reference_code,validation_status,published_at)
    VALUES($1,'Timed Problem','stdio','Test','[{"input":"","expected":"42"}]',500,64,'tokens','print(42)','AC',now()) RETURNING *`, [problemId])).rows[0];
  // Published testcase insertion is deliberately prohibited; the service fixture
  // does not run the sandbox and only needs the immutable published metadata.
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [problemId, version.id]);
});
test.after(async () => {
  if (pool) await pool.end();
  if (schema) await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  if (manager) await manager.end();
});

async function create({ startsAt = new Date(Date.now() - 1000).toISOString(), endsAt = new Date(Date.now() + 300000).toISOString(), durationMinutes = 1, showVerdict = false, participants = [student.identityId] } = {}) {
  return (await call('/timed-practices', 'POST', teacher, { title: 'Timed Training', classId, startsAt, endsAt, durationMinutes, showVerdict,
    problems: [{ problemId, points: 100 }], participants })).body;
}
async function submission(practice, attempt, status, score) {
  return (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score,passed,total)
    VALUES($1,$2,$3,$4,$5,'submit','print(42)',$6,'test',$7,$8,1,1) RETURNING *`, [student.id, student.identityId, problemId, practice.problems[0].versionId, attempt.id, randomUUID(), status, score])).rows[0];
}

test('timed attempts: publication, scope, concurrent start, minimum deadline and immutable snapshots', { skip: !url }, async () => {
  const practice = await create({ endsAt: new Date(Date.now() + 90000).toISOString(), durationMinutes: 3 });
  assert.equal(practice.status, 'Draft'); assert.equal(practice.participants[0].identityId, student.identityId); assert.equal(practice.participants[0].attempt, null);
  await assert.rejects(call(`/timed-practices/${practice.id}`, 'GET', student), failure('NOT_FOUND'));
  await call(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  await assert.rejects(call(`/timed-practices/${practice.id}/start`, 'POST', outsider), failure('FORBIDDEN'));
  await assert.rejects(call(`/timed-practices/${practice.id}/start`, 'POST', teacher), failure('FORBIDDEN'));
  const [one, two] = await Promise.all([call(`/timed-practices/${practice.id}/start`, 'POST', student), call(`/timed-practices/${practice.id}/start`, 'POST', student)]);
  assert.equal(one.body.id, two.body.id); assert.equal(one.body.deadlineAt.toISOString(), new Date(practice.endsAt).toISOString());
  assert.equal((await pool.query('SELECT count(*) FROM timed_attempts WHERE practice_id=$1', [practice.id])).rows[0].count, '1');
  await assert.rejects(pool.query('UPDATE timed_practice_problems SET points=50 WHERE practice_id=$1', [practice.id]), /immutable/);
  await assert.rejects(pool.query('UPDATE timed_practices SET duration_minutes=10 WHERE id=$1', [practice.id]), /immutable/);
  await assert.rejects(pool.query('DELETE FROM timed_practice_participants WHERE practice_id=$1', [practice.id]), /immutable/);
});

test('timed submission: server deadline, pinned version, manual finish and bounded audited extension', { skip: !url }, async () => {
  const practice = await create(); await call(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  const body = { problemId, versionId: version.id, timedPracticeId: practice.id, kind: 'submit' };
  await assert.rejects(transaction(pool, (db) => timed.prepareSubmission(db, student, body, version)), failure('NOT_STARTED'));
  const attempt = (await call(`/timed-practices/${practice.id}/start`, 'POST', student)).body;
  const accepted = await transaction(pool, (db) => timed.prepareSubmission(db, student, body, { ...version, id: randomUUID() }));
  assert.equal(accepted.version.id, version.id); assert.equal(accepted.timedAttemptId, attempt.id); assert.ok(accepted.acceptedAt <= attempt.deadlineAt);
  await assert.rejects(transaction(pool, (db) => timed.prepareSubmission(db, student, { ...body, versionId: randomUUID() }, version)), failure('VERSION_MISMATCH'));
  await assert.rejects(transaction(pool, (db) => timed.prepareSubmission(db, student, { ...body, assignmentId: randomUUID() }, version)), failure('VALIDATION'));
  await call(`/timed-practices/${practice.id}/finish`, 'POST', student);
  await assert.rejects(transaction(pool, (db) => timed.prepareSubmission(db, student, body, version)), failure('DEADLINE_PASSED'));
  const extended = new Date(Date.now() + 600000).toISOString();
  await call(`/timed-practices/${practice.id}/extend`, 'POST', teacher, { identityId: student.identityId, deadlineAt: extended, reason: 'Network interruption' });
  assert.equal((await call(`/timed-practices/${practice.id}`, 'GET', student)).body.attempt.status, 'Active');
  assert.equal((await pool.query("SELECT count(*) FROM audit_events WHERE action='timed.extend' AND resource_id=$1", [practice.id])).rows[0].count, '1');
  await assert.rejects(call(`/timed-practices/${practice.id}/results`, 'POST', teacher), failure('TRAINING_ACTIVE'));
  await pool.query("UPDATE timed_attempts SET started_at=now()-interval '2 minutes',deadline_at=now()-interval '1 second' WHERE id=$1", [attempt.id]);
  await assert.rejects(transaction(pool, (db) => timed.prepareSubmission(db, student, body, version)), failure('DEADLINE_PASSED'));
});

test('timed grades: last submission, no System Error fallback, hidden feedback and explicit immutable publication', { skip: !url }, async () => {
  const practice = await create(); await call(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  const attempt = (await call(`/timed-practices/${practice.id}/start`, 'POST', student)).body;
  await submission(practice, attempt, 'AC', 100);
  const latest = await submission(practice, attempt, 'Waiting', null);
  const masked = await timed.maskSubmission(pool, student, { ...latest, status: 'WA', score: 40, public_output: 'secret result' });
  assert.equal(masked.status, 'WA'); assert.equal(masked.score, null); assert.equal(masked.passed, null); assert.equal(masked.total, null); assert.equal(masked.public_output, null);
  await call(`/timed-practices/${practice.id}/finish`, 'POST', student);
  let teacherResult = (await call(`/timed-practices/${practice.id}`, 'GET', teacher)).body;
  assert.equal(teacherResult.grades[0].pending, true); assert.equal(teacherResult.grades[0].score, null);
  await assert.rejects(call(`/timed-practices/${practice.id}/results`, 'POST', teacher), failure('INCOMPLETE_RESULTS'));
  await pool.query("UPDATE submissions SET status='System Error',score=NULL WHERE id=$1", [latest.id]);
  teacherResult = (await call(`/timed-practices/${practice.id}`, 'GET', teacher)).body;
  assert.equal(teacherResult.grades[0].problems[0].status, 'System Error'); assert.equal(teacherResult.grades[0].score, null);
  await assert.rejects(call(`/timed-practices/${practice.id}/results`, 'POST', teacher), failure('INCOMPLETE_RESULTS'));
  await pool.query("UPDATE submissions SET status='WA',score=40 WHERE id=$1", [latest.id]);
  assert.equal((await call(`/timed-practices/${practice.id}`, 'GET', student)).body.grade, undefined);
  const published = (await call(`/timed-practices/${practice.id}/results`, 'POST', teacher)).body;
  assert.equal(published.status, 'ResultsPublished'); assert.equal(published.grades[0].score, 40);
  assert.equal((await call(`/timed-practices/${practice.id}`, 'GET', student)).body.grade.score, 40);
  assert.equal((await timed.maskSubmission(pool, student, { ...latest, status: 'WA', score: 40 })).score, 40);
  await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1", [latest.id]);
  assert.equal((await call(`/timed-practices/${practice.id}`, 'GET', student)).body.grade.score, 40);
  await call(`/timed-practices/${practice.id}/results`, 'POST', teacher, { reason: 'Confirmed reference environment rejudge' });
  assert.equal((await call(`/timed-practices/${practice.id}`, 'GET', student)).body.grade.score, 100);
  const revisions = (await call(`/timed-practices/${practice.id}/result-revisions`, 'GET', teacher)).body.items;
  assert.equal(revisions.length, 2); assert.equal(revisions[0].revision, 2); assert.equal(revisions[1].grades[0].score, 40);
  await assert.rejects(pool.query("UPDATE timed_result_revisions SET reason='changed' WHERE practice_id=$1", [practice.id]), /immutable/);
  await assert.rejects(pool.query("UPDATE timed_result_snapshots SET grade='{}' WHERE practice_id=$1", [practice.id]), /immutable/);
  await assert.rejects(call(`/timed-practices/${practice.id}/extend`, 'POST', teacher, { identityId: student.identityId, deadlineAt: new Date(Date.now() + 600000).toISOString(), reason: 'Late extension' }), failure('INVALID_STATE'));
  await call(`/timed-practices/${practice.id}/archive`, 'POST', teacher);
  assert.equal((await call(`/timed-practices/${practice.id}`, 'GET', student)).body.grade.score, 100);
});

test('timed start window and student resource permissions are server enforced', { skip: !url }, async () => {
  const practice = await create({ startsAt: new Date(Date.now() + 60000).toISOString() });
  await call(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  await assert.rejects(call(`/timed-practices/${practice.id}/start`, 'POST', student), failure('START_WINDOW'));
  await assert.rejects(call(`/timed-practices/${practice.id}/publish`, 'POST', student), failure('FORBIDDEN'));
  await assert.rejects(call(`/timed-practices/${practice.id}`, 'GET', outsider), failure('FORBIDDEN'));
  const otherTeacher = { ...teacher, id: outsider.id, roles: ['teacher'] };
  await assert.rejects(call(`/timed-practices/${practice.id}/results`, 'POST', otherTeacher), failure('FORBIDDEN'));
});

test('mixed student/teacher role remains a participant and cannot gain management feedback', { skip: !url }, async () => {
  const practice = await create(); await call(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  const mixed = { ...student, roles: ['student', 'teacher'] };
  const started = (await call(`/timed-practices/${practice.id}/start`, 'POST', mixed)).body;
  const result = (await call(`/timed-practices/${practice.id}`, 'GET', mixed)).body;
  assert.equal(result.preview, false); assert.equal(result.participants, undefined); assert.equal(result.attempt.id, started.id);
  assert.ok((await call('/timed-practices', 'GET', mixed)).body.items.some((entry) => entry.id === practice.id));
  await assert.rejects(call(`/timed-practices/${practice.id}/results`, 'POST', mixed), failure('FORBIDDEN'));
  const loaded = await submission(practice, started, 'AC', 100);
  assert.equal((await timed.maskSubmission(pool, mixed, loaded)).score, null);
  const prepared = await transaction(pool, (db) => timed.prepareSubmission(db, mixed, { timedPracticeId: practice.id, problemId, versionId: version.id, kind: 'submit' }, version));
  assert.equal(prepared.timedAttemptId, started.id);
});

test('teacher force end serializes against accepted submissions and closes unstarted participants', { skip: !url }, async () => {
  await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [classId, outsider.identityId]);
  const practice = await create({ participants: [student.identityId, outsider.identityId] });
  await call(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  const attempt = (await call(`/timed-practices/${practice.id}/start`, 'POST', student)).body;
  await assert.rejects(call(`/timed-practices/${practice.id}/end`, 'POST', student, { reason: 'Unauthorized end' }), failure('FORBIDDEN'));
  await assert.rejects(call(`/timed-practices/${practice.id}/end`, 'POST', teacher), failure('VALIDATION'));
  const body = { timedPracticeId: practice.id, problemId, versionId: version.id, kind: 'submit' };
  const db = await pool.connect();
  let endPromise, ended = false;
  try {
    await db.query('BEGIN');
    const accepted = await timed.prepareSubmission(db, student, body, version);
    endPromise = call(`/timed-practices/${practice.id}/end`, 'POST', teacher, { reason: 'Class dismissed early' }).then((result) => { ended = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(ended, false);
    await db.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score,created_at)
      VALUES($1,$2,$3,$4,$5,'submit','print(42)',$6,'end-test','AC',100,$7)`, [student.id, student.identityId, problemId, version.id, attempt.id, randomUUID(), accepted.acceptedAt]);
    await db.query('COMMIT');
    const endedPractice = (await endPromise).body;
    assert.equal(endedPractice.status, 'Ended'); assert.ok(endedPractice.forcedEndedAt >= accepted.acceptedAt);
    assert.equal(endedPractice.participants.find((entry) => entry.identityId === student.identityId).attempt.status, 'Finished');
    assert.equal(endedPractice.grades.find((entry) => entry.identityId === student.identityId).score, 100);
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
  await assert.rejects(call(`/timed-practices/${practice.id}/start`, 'POST', outsider), failure('START_WINDOW'));
  await assert.rejects(transaction(pool, (client) => timed.prepareSubmission(client, student, body, version)), failure('TRAINING_CLOSED'));
  await assert.rejects(call(`/timed-practices/${practice.id}/extend`, 'POST', teacher, { identityId: student.identityId, deadlineAt: new Date(Date.now() + 600000).toISOString(), reason: 'Try reopen' }), failure('INVALID_STATE'));
  const result = (await call(`/timed-practices/${practice.id}/results`, 'POST', teacher)).body;
  assert.equal(result.status, 'ResultsPublished'); assert.equal(result.grades.find((entry) => entry.identityId === outsider.identityId).score, 0);
  assert.equal((await pool.query("SELECT count(*) FROM audit_events WHERE resource_id=$1 AND action='timed.end'", [practice.id])).rows[0].count, '1');
});
