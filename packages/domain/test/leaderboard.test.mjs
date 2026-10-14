import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { handleEducation } from '../src/education.mjs';

function leaderboard(pool, user, query = '') {
 const url = new URL(`http://localhost/api/v1/points/leaderboard${query}`);
 return handleEducation({ pool, user, method: 'GET', route: '/points/leaderboard', url });
}

test('leaderboard rejects invalid period and pagination before querying', async () => {
 const pool = { query: () => { throw new Error('invalid query reached database'); } };
 const user = { roles: ['student'], identityId: randomUUID() };
 for (const query of ['?period=year', '?page=0', '?page=-1', '?page=1.5', '?pageSize=0', '?pageSize=51', '?pageSize=1e3']) {
  await assert.rejects(leaderboard(pool, user, query), error => error.status === 400, query);
 }
});

test('leaderboard uses actual awards, formal results and Shanghai period boundaries without leaking unreleased timed work',
 { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = `leaderboard_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(url.href);
  try {
   await migrate(pool);
   async function account(kind, name) {
    const identityId = (await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id', [kind, randomUUID(), name])).rows[0].id;
    const id = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identityId, randomUUID(), 'test-hash'])).rows[0].id;
    await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, kind]);
    return { id, identityId, roles: [kind] };
   }
   const teacher = await account('teacher', 'Teacher');
   const alpha = await account('student', 'Alpha');
   const beta = await account('student', 'Beta');
   const charlie = await account('student', 'Charlie');
   const newcomer = await account('student', 'Newcomer');
   await pool.query("UPDATE accounts SET nickname='贝塔' WHERE id=$1", [beta.id]);
   async function problem() {
    const id = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [teacher.id])).rows[0].id;
    const versionId = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
     VALUES($1,'Leaderboard problem','stdio','Test',500,64,'print(1)','AC',now()) RETURNING id`, [id])).rows[0].id;
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [id, versionId]);
    return { id, versionId };
   }
   const first = await problem(), second = await problem(), hidden = await problem();
   const previousMonth = (await pool.query("SELECT (date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai')-interval '8 days') AT TIME ZONE 'Asia/Shanghai' AS at")).rows[0].at;
   async function submission(student, item, kind, status, createdAt = new Date(), timedAttemptId = null) {
    const score = status === 'AC' ? 100 : ['Waiting', 'Judging', 'System Error'].includes(status) ? null : 0;
    return (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score,created_at)
     VALUES($1,$2,$3,$4,$5,$6,'print(1)',$7,'leaderboard-test',$8,$9,$10) RETURNING id`,
     [student.id, student.identityId, item.id, item.versionId, timedAttemptId, kind, randomUUID(), status, score, createdAt])).rows[0].id;
   }

   await submission(alpha, first, 'submit', 'AC', previousMonth);
   // Trigger credit time is now; move the older award together with its source
   // submission to prove all-time and current-period totals differ.
   await pool.query("UPDATE point_ledger SET created_at=$2 WHERE identity_id=$1 AND reason='first_ac' AND problem_id=$3", [alpha.identityId, previousMonth, first.id]);
   await submission(alpha, second, 'submit', 'AC');
   await submission(alpha, second, 'submit', 'WA');
   await submission(alpha, second, 'submit', 'AC');
   await submission(alpha, second, 'samples', 'AC');
   await submission(alpha, second, 'correction', 'AC');
   await submission(beta, first, 'submit', 'AC');
   await submission(beta, second, 'submit', 'Waiting');
   await submission(beta, second, 'submit', 'System Error');
   await submission(charlie, first, 'submit', 'AC');
   await submission(charlie, second, 'submit', 'AC');

   const classId = (await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Leaderboard class',$1) RETURNING id", [teacher.id])).rows[0].id;
   const practiceId = (await pool.query(`INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes,state)
    VALUES('Unreleased practice',$1,$2,now()-interval '1 minute',now()+interval '1 hour',30,'Draft') RETURNING id`, [classId, teacher.id])).rows[0].id;
   await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)', [practiceId, alpha.identityId]);
   await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1", [practiceId]);
   const timedAttemptId = (await pool.query(`INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at)
    VALUES($1,$2,$3,now(),now()+interval '30 minutes') RETURNING id`, [practiceId, alpha.identityId, alpha.id])).rows[0].id;
   await submission(alpha, hidden, 'submit', 'AC', new Date(), timedAttemptId);
   assert.equal((await pool.query("SELECT count(*)::int n FROM point_ledger WHERE identity_id=$1 AND problem_id=$2", [alpha.identityId, hidden.id])).rows[0].n, 0);

   const all = (await leaderboard(pool, alpha, '?period=all&pageSize=1&page=1')).body;
   assert.equal(all.total, 3);
   assert.equal(all.items.length, 1);
   assert.equal(all.items[0].points, 20);
   assert.equal(all.items[0].rank, 1);
   assert.equal(all.me.id, alpha.identityId);
   assert.equal(all.me.name, '同学', 'public leaderboard must not fall back to legal names');
   assert.equal(all.me.publicTag, alpha.identityId.replaceAll('-', '').slice(0, 8).toUpperCase());
   assert.equal(all.me.points, 20);
   assert.equal(all.me.solvedProblems, 2);
   assert.equal(all.me.attempts, 4);
   assert.equal(all.me.acRate, 75);
   const secondPage = (await leaderboard(pool, alpha, '?period=all&pageSize=1&page=2')).body;
   assert.equal(secondPage.items[0].points, 20);
   assert.equal(secondPage.items[0].rank, 1, 'equal points share a rank across pages');
   const thirdPage = (await leaderboard(pool, alpha, '?period=all&pageSize=1&page=3')).body;
   assert.equal(thirdPage.items[0].id, beta.identityId);
   assert.equal(thirdPage.items[0].rank, 3);
   assert.equal(thirdPage.items[0].attempts, 3, 'pending and system-error formal submissions count as attempts');
   assert.equal(thirdPage.items[0].acRate, 100, 'only resolved valid verdicts enter the AC-rate denominator');
   let fetchedRows = [];
   const observedPool = { query: async (...args) => {
    const response = await pool.query(...args);
    fetchedRows = response.rows;
    return response;
   } };
   const betaView = (await leaderboard(observedPool, beta, '?period=all&pageSize=1&page=1')).body;
   assert.equal(betaView.me.id, beta.identityId, 'current student is returned even when absent from the requested page');
   assert.equal(betaView.me.name, '贝塔');
   assert.equal(betaView.me.rank, 3);
   assert.equal(fetchedRows.length, 2, 'database returns only the page plus current student, not every avatar');
   assert.deepEqual(new Set(fetchedRows.map(row => row.id)), new Set([betaView.items[0].id, beta.identityId]));
   assert.equal((await leaderboard(pool, teacher)).body.me, null);
   const pastEnd = (await leaderboard(pool, teacher, '?period=all&page=500&pageSize=1')).body;
   assert.equal(pastEnd.total, 3);
   assert.deepEqual(pastEnd.items, []);
   assert.equal(pastEnd.me, null);
   const zeroPointStudent = (await leaderboard(pool, newcomer, '?period=all&pageSize=1')).body;
   assert.equal(zeroPointStudent.total, 3, 'zero-point students do not occupy public ranked pages');
   assert.equal(zeroPointStudent.me.id, newcomer.identityId);
   assert.equal(zeroPointStudent.me.points, 0);
   assert.equal(zeroPointStudent.me.rank, 4);
   assert.equal(zeroPointStudent.me.solvedProblems, 0);
   assert.equal(zeroPointStudent.me.attempts, 0);
   assert.equal(zeroPointStudent.me.acRate, null);

   for (const period of ['month', 'week']) {
    const current = (await leaderboard(pool, alpha, `?period=${period}&pageSize=10`)).body;
    assert.equal(current.total, 3);
    assert.equal(current.items[0].id, charlie.identityId);
    assert.equal(current.items[0].points, 20);
    assert.equal(current.me.points, 10, `${period} excludes previous-month awards`);
    assert.equal(current.me.solvedProblems, 1);
    assert.equal(current.me.attempts, 3, 'unreleased timed and old formal submissions are excluded');
    assert.equal(current.me.acRate, 66.7);
    assert.deepEqual(current.items.slice(1).map(item => item.rank), [2, 2]);
   }
  } finally {
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
