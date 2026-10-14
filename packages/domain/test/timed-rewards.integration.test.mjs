import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { createTimedService } from '../src/timed.mjs';

const url = process.env.TEST_DATABASE_URL ?? process.env.JUDGE_TEST_DATABASE_URL;
let manager, pool, schema, timed, teacher, student, otherStudent, classId, problemId, secondProblemId, versionId, secondVersionId;
const request = (route, method, user, body = {}) => timed.handle({ route, method, user, body,
  url: new URL('http://localhost/api/v1' + route) });
const rejects = (code) => (error) => error.code === code;

test.before(async () => {
  if (!url) return;
  manager = createPool(url);
  schema = `timed_reward_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const conn = new URL(url);
  conn.searchParams.set('options', `-csearch_path=${schema}`);
  pool = createPool(conn.toString());
  await migrate(pool);
  await migrate(pool);
  timed = createTimedService(pool);

  async function account(kind, number) {
    const identityId = (await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id', [kind, number])).rows[0].id;
    const id = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$2) RETURNING id', [identityId, number.toLowerCase()])).rows[0].id;
    await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, kind]);
    return { id, identityId, roles: [kind] };
  }
  teacher = await account('teacher', 'T-REWARD');
  student = await account('student', 'S-REWARD');
  otherStudent = await account('student', 'S-NO-REWARD');
  classId = (await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Reward Test',$1) RETURNING id", [teacher.id])).rows[0].id;
  await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)', [classId, teacher.id]);
  for (const user of [student, otherStudent]) await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [classId, user.identityId]);
  async function problem(title) {
    const id = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [teacher.id])).rows[0].id;
    const versionId = (await pool.query(`INSERT INTO problem_versions(
      problem_id,title,mode,statement,samples,time_limit_ms,memory_limit_mb,comparator,reference_code,validation_status,published_at)
      VALUES($1,$2,'stdio','Test','[]',500,64,'tokens','print(42)','AC',now()) RETURNING id`, [id, title])).rows[0].id;
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [id, versionId]);
    return { id, versionId };
  }
  ({ id: problemId, versionId } = await problem('First'));
  ({ id: secondProblemId, versionId: secondVersionId } = await problem('Second'));
});
test.after(async () => {
  if (pool) await pool.end();
  if (schema) await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  if (manager) await manager.end();
});

async function create({ participants = [student.identityId], problems = [{ problemId, points: 100,
  rewardPoints: 8, speedBonusPoints: 20, attemptBonusPoints: 12 }] } = {}) {
  return (await request('/timed-practices', 'POST', teacher, {
    title: 'Timed reward', classId, startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 120000).toISOString(), durationMinutes: 1,
    participants, problems
  })).body;
}
async function start(practice, user = student, elapsedMs = 40000) {
  await request(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  const attempt = (await request(`/timed-practices/${practice.id}/start`, 'POST', user)).body;
  const startedAt = new Date(Date.now() - elapsedMs);
  await pool.query('UPDATE timed_attempts SET started_at=$2,deadline_at=$3 WHERE id=$1',
    [attempt.id, startedAt, new Date(startedAt.getTime() + 60000)]);
  return { id: attempt.id, startedAt };
}
async function submit(practice, attempt, offsetSeconds, status, user = student, kind = 'submit') {
  return (await pool.query(`INSERT INTO submissions(
    account_id,identity_id,problem_id,version_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score,created_at)
    VALUES($1,$2,$3,$4,$5,$6,'print(42)',$7,'reward-test',$8,$9,$10) RETURNING *`,
  [user.id,user.identityId,practice.problems[0].problemId,practice.problems[0].versionId,attempt.id,kind,randomUUID(),status,
    status === 'AC' ? 100 : status === 'WA' ? 0 : null,
    new Date(attempt.startedAt.getTime() + offsetSeconds * 1000)])).rows[0];
}
async function finishAndPublish(practice, user = student) {
  await request(`/timed-practices/${practice.id}/finish`, 'POST', user);
  return (await request(`/timed-practices/${practice.id}/results`, 'POST', teacher)).body;
}
async function ledger(user, practice) {
  return (await pool.query('SELECT reason,points,submission_id FROM point_ledger WHERE identity_id=$1 AND timed_practice_id=$2',
    [user.identityId, practice.id])).rows;
}

test('timed reward bounds, total budget, ownership and published immutability', { skip: !url }, async () => {
  await assert.rejects(request('/timed-practices', 'POST', student, {}), rejects('FORBIDDEN'));
  await assert.rejects(create({ problems: [{ problemId, points: 100, rewardPoints: 21 }] }), rejects('VALIDATION'));
  await assert.rejects(create({ problems: [
    { problemId, points: 50, rewardPoints: 20, speedBonusPoints: 20, attemptBonusPoints: 20 },
    { problemId: secondProblemId, versionId: secondVersionId, points: 50, rewardPoints: 20, speedBonusPoints: 20, attemptBonusPoints: 20 }
  ] }), rejects('REWARD_BUDGET'));
  const practice = await create();
  assert.deepEqual(practice.problems.map(({ rewardPoints, speedBonusPoints, attemptBonusPoints, firstAcPoints }) =>
    [rewardPoints, speedBonusPoints, attemptBonusPoints, firstAcPoints]), [[8,20,12,10]]);
  await assert.rejects(request(`/timed-practices/${practice.id}`, 'PATCH', student, { problems: [] }), rejects('FORBIDDEN'));
  const changed = (await request(`/timed-practices/${practice.id}`, 'PATCH', teacher,
    { problems: [{ problemId, points: 100, rewardPoints: 10, speedBonusPoints: 15, attemptBonusPoints: 12 }] })).body;
  assert.deepEqual(changed.problems.map((p) => [p.rewardPoints,p.speedBonusPoints,p.attemptBonusPoints]), [[10,15,12]]);
  const adjusted = (await request(`/timed-practices/${practice.id}`, 'PATCH', teacher, { title: 'Edited draft' })).body;
  assert.deepEqual(adjusted.problems.map((p) => [p.rewardPoints,p.speedBonusPoints,p.attemptBonusPoints]), [[10,15,12]]);
  await request(`/timed-practices/${practice.id}/publish`, 'POST', teacher);
  await assert.rejects(request(`/timed-practices/${practice.id}`, 'PATCH', teacher,
    { problems: [{ problemId, points: 100, rewardPoints: 20 }] }), rejects('IMMUTABLE'));
  await assert.rejects(pool.query('UPDATE timed_practice_problems SET speed_bonus_points=0 WHERE practice_id=$1', [practice.id]), /immutable/);
});

test('first published result awards fixed, speed and attempts exactly once', { skip: !url }, async () => {
  const practice = await create();
  const attempt = await start(practice);
  const accepted = await submit(practice, attempt, 30, 'AC');
  await request(`/timed-practices/${practice.id}/finish`, 'POST', student);
  const [a, b] = await Promise.all([
    request(`/timed-practices/${practice.id}/results`, 'POST', teacher),
    request(`/timed-practices/${practice.id}/results`, 'POST', teacher)
  ]);
  assert.equal(a.body.status, 'ResultsPublished'); assert.equal(b.body.status, 'ResultsPublished');
  const score = a.body.grades[0].problems[0];
  assert.equal(score.submissionId, `SUB${accepted.id}`);
  assert.deepEqual([score.rewardPoints,score.speedBonusPointsEarned,score.attemptBonusPointsEarned,
    score.totalRewardPoints,score.elapsedSeconds,score.formalAttempts], [8,10,12,30,30,1]);
  assert.deepEqual((await ledger(student, practice)).map((entry) => [entry.reason,entry.points]), [['timed',30]]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM point_ledger WHERE identity_id=$1 AND problem_id=$2 AND reason='first_ac'", [student.identityId,problemId])).rows[0].n, 1);
  assert.equal((await request(`/timed-practices/${practice.id}`, 'GET', student)).body.grade.problems[0].totalRewardPoints, 30);
  await pool.query("UPDATE submissions SET status='WA',score=0 WHERE id=$1", [accepted.id]);
  const revised = (await request(`/timed-practices/${practice.id}/results`, 'POST', teacher,
    { reason: 'Review after publication' })).body;
  assert.equal(revised.grades[0].problems[0].status, 'WA');
  assert.equal(revised.grades[0].problems[0].totalRewardPoints, 30);
  assert.equal((await ledger(student, practice)).length, 1);
});

test('fewer attempts and faster AC earn more; samples are excluded from attempt count', { skip: !url }, async () => {
  const practice = await create();
  const attempt = await start(practice, student, 50000);
  await submit(practice, attempt, 10, 'WA');
  await submit(practice, attempt, 15, 'Executed', student, 'samples');
  await submit(practice, attempt, 20, 'WA');
  await submit(practice, attempt, 45, 'AC');
  const result = await finishAndPublish(practice);
  const score = result.grades[0].problems[0];
  assert.deepEqual([score.formalAttempts,score.elapsedSeconds,score.speedBonusPointsEarned,
    score.attemptBonusPointsEarned,score.totalRewardPoints], [3,45,5,4,17]);
  assert.deepEqual((await ledger(student, practice)).map((entry) => entry.points), [17]);
});

test('earlier AC followed by final WA still earns global first AC, but no timed bonus', { skip: !url }, async () => {
  const practice = await create({ participants: [otherStudent.identityId] });
  const attempt = await start(practice, otherStudent);
  const earlierAc = await submit(practice, attempt, 10, 'AC', otherStudent);
  await submit(practice, attempt, 20, 'WA', otherStudent);
  const published = await finishAndPublish(practice, otherStudent);
  assert.equal(published.grades[0].problems[0].totalRewardPoints, 0);
  assert.deepEqual(await ledger(otherStudent, practice), []);
  assert.deepEqual((await pool.query("SELECT points,submission_id FROM point_ledger WHERE identity_id=$1 AND problem_id=$2 AND reason='first_ac'", [otherStudent.identityId,problemId])).rows.map((entry)=>[entry.points,entry.submission_id]), [[10,String(earlierAc.id)]]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM timed_first_ac_candidates WHERE practice_id=$1', [practice.id])).rows[0].n, 1);
  await assert.rejects(pool.query('DELETE FROM timed_first_ac_candidates WHERE practice_id=$1', [practice.id]), /immutable/);

  const errored = await create();
  const secondAttempt = await start(errored);
  const errorSubmission = await submit(errored, secondAttempt, 10, 'System Error');
  await request(`/timed-practices/${errored.id}/finish`, 'POST', student);
  await assert.rejects(request(`/timed-practices/${errored.id}/results`, 'POST', teacher), rejects('INCOMPLETE_RESULTS'));
  assert.deepEqual(await ledger(student, errored), []);
  await pool.query("UPDATE submissions SET status='WA',score=0 WHERE id=$1", [errorSubmission.id]);
  await request(`/timed-practices/${errored.id}/results`, 'POST', teacher);
  assert.deepEqual(await ledger(student, errored), []);

  const late = await create();
  const lateAttempt = await start(late);
  await submit(late, lateAttempt, 70, 'AC');
  const lateResult = await finishAndPublish(late);
  assert.equal(lateResult.grades[0].problems[0].status, 'NotSubmitted');
  assert.deepEqual(await ledger(student, late), []);
  assert.equal((await pool.query('SELECT count(*)::int n FROM timed_first_ac_candidates WHERE practice_id=$1', [late.id])).rows[0].n, 0);
});

test('score revisions do not mint retroactive points or change settled reward breakdown', { skip: !url }, async () => {
  const practice = await create({ participants: [otherStudent.identityId], problems: [{
    problemId: secondProblemId, versionId: secondVersionId, points: 100,
    rewardPoints: 8, speedBonusPoints: 20, attemptBonusPoints: 12
  }] });
  const attempt = await start(practice, otherStudent);
  const original = await submit(practice, attempt, 10, 'WA', otherStudent);
  await finishAndPublish(practice, otherStudent);
  await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1", [original.id]);
  const revised = (await request(`/timed-practices/${practice.id}/results`, 'POST', teacher,
    { reason: 'Confirmed rejudge' })).body;
  assert.equal(revised.grades[0].problems[0].status, 'AC');
  assert.equal(revised.grades[0].problems[0].totalRewardPoints, 0);
  assert.deepEqual(await ledger(otherStudent, practice), []);
  assert.equal((await pool.query("SELECT count(*)::int n FROM point_ledger WHERE identity_id=$1 AND problem_id=$2 AND reason='first_ac'", [otherStudent.identityId,secondProblemId])).rows[0].n, 0);
});

test('publication waits for every on-time formal verdict, not only the latest submission', { skip: !url }, async () => {
  const practice = await create();
  const attempt = await start(practice);
  const earlier = await submit(practice, attempt, 10, 'Waiting');
  await submit(practice, attempt, 20, 'WA');
  await request(`/timed-practices/${practice.id}/finish`, 'POST', student);
  await assert.rejects(request(`/timed-practices/${practice.id}/results`, 'POST', teacher), rejects('INCOMPLETE_RESULTS'));
  assert.equal((await pool.query('SELECT count(*)::int n FROM timed_first_ac_candidates WHERE practice_id=$1', [practice.id])).rows[0].n, 0);
  await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1", [earlier.id]);
  const released = (await request(`/timed-practices/${practice.id}/results`, 'POST', teacher)).body;
  assert.equal(released.grades[0].problems[0].status, 'WA');
  assert.equal(released.grades[0].problems[0].totalRewardPoints, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM timed_first_ac_candidates WHERE practice_id=$1', [practice.id])).rows[0].n, 1);
});

test('worker verdict commit is serialized before the released grade and reward snapshot', { skip: !url }, async () => {
  const practice = await create({ participants: [otherStudent.identityId], problems: [{
    problemId: secondProblemId, versionId: secondVersionId, points: 100,
    rewardPoints: 8, speedBonusPoints: 20, attemptBonusPoints: 12
  }] });
  const attempt = await start(practice, otherStudent);
  const formal = await submit(practice, attempt, 30, 'WA', otherStudent);
  await request(`/timed-practices/${practice.id}/finish`, 'POST', otherStudent);
  const worker = await pool.connect();
  let publish;
  try {
    await worker.query('BEGIN');
    await worker.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1", [formal.id]);
    let settled = false;
    publish = request(`/timed-practices/${practice.id}/results`, 'POST', teacher)
      .then((result) => { settled = true; return result; }, (error) => { settled = true; throw error; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false, 'result publication must wait for the worker row lock');
    await worker.query('COMMIT');
    const released = (await publish).body;
    assert.equal(released.grades[0].problems[0].status, 'AC');
    assert.equal(released.grades[0].problems[0].totalRewardPoints, 30);
    assert.deepEqual((await ledger(otherStudent, practice)).map((entry) => entry.points), [30]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM timed_first_ac_candidates WHERE practice_id=$1', [practice.id])).rows[0].n, 1);
  } catch (error) {
    await worker.query('ROLLBACK');
    if (publish) await publish.catch(() => {});
    throw error;
  } finally { worker.release(); }
});
