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

function contexts(pool, user) {
 return handleEducation({pool,user,method:'GET',route:'/points/leaderboard/contexts'});
}

function pointsMe(pool,user) {
 return handleEducation({pool,user,method:'GET',route:'/points/me'});
}

function updateVisibility(pool,user,visibleFields) {
 return handleEducation({pool,user,method:'PATCH',route:'/points/leaderboard/settings',
  body:{visibleFields},helpers:{audit:async(db,actor,action,type,id,metadata)=>db.query(
   'INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',
   [actor,action,type,id,metadata])}});
}

test('leaderboard rejects invalid period and pagination before querying', async () => {
 const pool = { query: () => { throw new Error('invalid query reached database'); } };
 const user = { roles: ['student'], identityId: randomUUID() };
 for (const query of ['?period=year', '?page=0', '?page=-1', '?page=1.5', '?pageSize=0', '?pageSize=51', '?pageSize=1e3', '?classId=']) {
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
   const admin = await account('admin', 'Administrator');
   const alpha = await account('student', 'Alpha');
   const beta = await account('student', 'Beta');
   const charlie = await account('student', 'Charlie');
   const newcomer = await account('student', 'Newcomer');
   await pool.query("UPDATE accounts SET nickname='贝塔' WHERE id=$1", [beta.id]);
   const classId = (await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Leaderboard class',$1) RETURNING id", [teacher.id])).rows[0].id;
   await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[classId,teacher.id]);
   for(const student of [alpha,beta,charlie,newcomer])
    await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,student.identityId]);
   const otherClassId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Other class',$1) RETURNING id",[teacher.id])).rows[0].id;
   const outsider=await account('student','Outsider');
   await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[otherClassId,outsider.identityId]);
   const previousMonth = (await pool.query("SELECT (date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai')-interval '8 days') AT TIME ZONE 'Asia/Shanghai' AS at")).rows[0].at;
   const approvedBeforePreviousMonth=new Date(previousMonth.getTime()-86400000);
   async function problem() {
    const id = (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [teacher.id])).rows[0].id;
    const versionId = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
     VALUES($1,'Leaderboard problem','stdio','Test',500,64,'print(1)','AC',$2) RETURNING id`, [id,approvedBeforePreviousMonth])).rows[0].id;
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [id, versionId]);
    return { id, versionId };
   }
   const first = await problem(), second = await problem(), hidden = await problem();
   await pool.query(`UPDATE problem_versions SET school_visible_at=$2,
    rank_review_status='approved',rank_approved_at=$2,rank_reviewed_at=$2,rank_reviewed_by=$3
    WHERE id=ANY($1::uuid[])`,[[first.versionId,second.versionId,hidden.versionId],approvedBeforePreviousMonth,admin.id]);
   async function submission(student, item, kind, status, createdAt = new Date(), timedAttemptId = null, assignmentId = null) {
    const score = status === 'AC' ? 100 : ['Waiting', 'Judging', 'System Error'].includes(status) ? null : 0;
    return (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,timed_attempt_id,assignment_id,kind,code,idempotency_key,request_hash,status,score,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'print(1)',$8,'leaderboard-test',$9,$10,$11) RETURNING id`,
     [student.id, student.identityId, item.id, item.versionId, timedAttemptId, assignmentId, kind, randomUUID(), status, score, createdAt])).rows[0].id;
   }

   await submission(alpha, first, 'submit', 'AC', previousMonth);
   // Trigger credit time is now; move the older award together with its source
   // submission to prove all-time and current-period totals differ.
   await pool.query("UPDATE point_ledger SET created_at=$2 WHERE identity_id=$1 AND reason='first_ac' AND problem_id=$3", [alpha.identityId, previousMonth, first.id]);
   // Backdate a synthetic award to exercise Shanghai week/month boundaries.
   await pool.query('ALTER TABLE school_rank_ledger DISABLE TRIGGER school_rank_ledger_immutable');
   await pool.query('UPDATE school_rank_ledger SET created_at=$2 WHERE identity_id=$1 AND problem_id=$3',[alpha.identityId,previousMonth,first.id]);
   await pool.query('ALTER TABLE school_rank_ledger ENABLE TRIGGER school_rank_ledger_immutable');
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

   const practiceId = (await pool.query(`INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes,state)
    VALUES('Unreleased practice',$1,$2,now()-interval '1 minute',now()+interval '1 hour',30,'Draft') RETURNING id`, [classId, teacher.id])).rows[0].id;
   await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)', [practiceId, alpha.identityId]);
   await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1", [practiceId]);
   const timedAttemptId = (await pool.query(`INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at)
    VALUES($1,$2,$3,now(),now()+interval '30 minutes') RETURNING id`, [practiceId, alpha.identityId, alpha.id])).rows[0].id;
   const timedAcId=await submission(alpha, hidden, 'submit', 'AC', new Date(), timedAttemptId);
   assert.equal((await pool.query("SELECT count(*)::int n FROM point_ledger WHERE identity_id=$1 AND problem_id=$2", [alpha.identityId, hidden.id])).rows[0].n, 0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_rank_ledger WHERE identity_id=$1 AND problem_id=$2',[alpha.identityId,hidden.id])).rows[0].n,0);

   assert.deepEqual(new Set((await contexts(pool,alpha)).body.items.map(item=>item.id)),new Set([classId,otherClassId]));
   assert.deepEqual(new Set((await contexts(pool,teacher)).body.items.map(item=>item.id)),new Set([classId,otherClassId]));
   assert.equal((await contexts(pool,alpha)).body.canManage,false);
   assert.equal((await contexts(pool,teacher)).body.canManage,false);
   assert.equal((await contexts(pool,admin)).body.canManage,true);
   assert.deepEqual((await contexts(pool,alpha)).body.visibleFields,{solvedProblems:true,attempts:false,acRate:true});
   const hiddenByDefault=(await leaderboard(pool,alpha,`?classId=${classId}`)).body;
   assert.deepEqual(hiddenByDefault.visibleFields,{solvedProblems:true,attempts:false,acRate:true});
   assert.equal(Object.hasOwn(hiddenByDefault.me,'attempts'),false,'hidden student fields must be redacted by the API');
   assert.equal(Object.hasOwn(hiddenByDefault.me,'publicTag'),false);
   assert.equal((await leaderboard(pool,teacher,`?classId=${classId}`)).body.items.find(item=>item.id===alpha.identityId).attempts,4,'teachers retain full metrics');
   assert.equal((await leaderboard(pool,alpha,`?classId=${otherClassId}`)).body.total,1,'students may select another class, including members without points');
   assert.equal((await leaderboard(pool,teacher,`?classId=${otherClassId}`)).body.total,1,'teachers may view classes they do not teach');
   await assert.rejects(leaderboard(pool,alpha,`?classId=${randomUUID()}`),error=>error.status===404);
   await assert.rejects(updateVisibility(pool,alpha,{solvedProblems:true,attempts:true,acRate:true}),error=>error.status===403);
   await assert.rejects(updateVisibility(pool,teacher,{solvedProblems:true,attempts:true,acRate:true}),error=>error.status===403);
   await updateVisibility(pool,admin,{solvedProblems:true,attempts:true,acRate:true});
   assert.equal((await contexts(pool,alpha)).body.visibleFields.attempts,true);

   const all = (await leaderboard(pool, alpha, '?period=all&pageSize=1&page=1')).body;
   assert.equal(all.classId,null,'default leaderboard covers the whole school');
   assert.equal(all.total, 5,'the school board includes active students before their first ranked AC');
   assert.equal(all.items.length, 1);
   assert.equal(all.items[0].points, 20);
   assert.equal(all.items[0].rank, 1);
   assert.equal(all.me.id, alpha.identityId);
   assert.equal(all.me.name, '同学', 'public leaderboard must not fall back to legal names');
   assert.equal(Object.hasOwn(all.me,'publicTag'),false);
   assert.equal(all.me.points, 20);
   assert.equal(all.me.solvedProblems, 2);
   assert.equal(all.me.attempts, 4);
   assert.equal(all.me.acRate, 75);
   assert.equal((await pointsMe(pool,alpha)).body.points,20);
   assert.equal((await pointsMe(pool,alpha)).body.rankPoints,20);
   assert.equal((await pointsMe(pool,alpha)).body.rankingPolicy.scope,'approved_school_first_ac');
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
   assert.equal(pastEnd.total, 5);
   assert.deepEqual(pastEnd.items, []);
   assert.equal(pastEnd.me, null);
   const zeroPointStudent = (await leaderboard(pool, newcomer, '?period=all&pageSize=1')).body;
   assert.equal(zeroPointStudent.total, 5, 'zero-point students occupy public ranked pages');
   assert.equal(zeroPointStudent.me.id, newcomer.identityId);
   assert.equal(zeroPointStudent.me.points, 0);
   assert.equal(zeroPointStudent.me.rank, 4);
   assert.equal(zeroPointStudent.me.solvedProblems, 0);
   assert.equal(zeroPointStudent.me.attempts, 0);
   assert.equal(zeroPointStudent.me.acRate, null);

   for (const period of ['month', 'week']) {
    const current = (await leaderboard(pool, alpha, `?period=${period}&pageSize=10`)).body;
    assert.equal(current.total, 5);
    assert.equal(current.items[0].id, charlie.identityId);
    assert.equal(current.items[0].points, 20);
    assert.equal(current.me.points, 10, `${period} excludes previous-month awards`);
    assert.equal(current.me.solvedProblems, 1);
    assert.equal(current.me.attempts, 3, 'unreleased timed and old formal submissions are excluded');
    assert.equal(current.me.acRate, 66.7);
    assert.deepEqual(current.items.slice(1).map(item => item.rank), [2, 2, 4, 4]);
   }
   await updateVisibility(pool,admin,{solvedProblems:false,attempts:false,acRate:false});
   const privateMetrics=(await leaderboard(pool,beta,`?classId=${classId}`)).body;
   for(const item of [...privateMetrics.items,privateMetrics.me])
    for(const key of ['solvedProblems','attempts','acRate'])assert.equal(Object.hasOwn(item,key),false);
   assert.equal((await leaderboard(pool,teacher,`?classId=${classId}`)).body.items.find(item=>item.id===alpha.identityId).solvedProblems,2);
   assert.deepEqual((await leaderboard(pool,alpha)).body.visibleFields,{solvedProblems:false,attempts:false,acRate:false},'global visibility applies to all filters');
   await submission(outsider,first,'submit','AC');
   assert.equal((await leaderboard(pool,alpha)).body.total,5,'default leaderboard includes students from other classes');
   assert.equal((await leaderboard(pool,alpha,`?classId=${classId}`)).body.total,4);
   assert.equal((await leaderboard(pool,alpha,`?classId=${otherClassId}`)).body.items[0].id,outsider.identityId);
   await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[otherClassId,alpha.identityId]);
   assert.equal((await leaderboard(pool,alpha)).body.total,5,'multiple class memberships must not duplicate a student');
   assert.equal((await leaderboard(pool,alpha,`?classId=${otherClassId}`)).body.total,2);
   const unassigned=await account('student','Unassigned');
   await submission(unassigned,first,'submit','AC');
   assert.equal((await leaderboard(pool,alpha)).body.total,6,'school board includes students without a class');
   assert.equal((await leaderboard(pool,alpha,`?classId=${classId}`)).body.total,4);

   // A private AC before review keeps its personal reward, yet cannot consume
   // the independent school award. A new formal AC after review earns rank points.
   const reviewedLater=await problem();
   await submission(beta,reviewedLater,'submit','AC');
   const personalBeforeReview=(await pointsMe(pool,beta)).body;
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_rank_ledger WHERE identity_id=$1 AND problem_id=$2',[beta.identityId,reviewedLater.id])).rows[0].n,0);
   await new Promise(resolve=>setTimeout(resolve,10));
   const reviewedAt=new Date();
   await pool.query(`UPDATE problem_versions SET school_visible_at=$2,rank_review_status='approved',
    rank_approved_at=$2,rank_reviewed_at=$2,rank_reviewed_by=$3 WHERE id=$1`,[reviewedLater.versionId,reviewedAt,admin.id]);
   await pool.query('INSERT INTO point_rewards(problem_id,assignment_id,points,updated_by) VALUES($1,NULL,15,$2)',[reviewedLater.id,admin.id]);
   await new Promise(resolve=>setTimeout(resolve,10));
   const publicAcId=await submission(beta,reviewedLater,'submit','AC');
   const awarded=(await pool.query('SELECT submission_id,points FROM school_rank_ledger WHERE identity_id=$1 AND problem_id=$2',[beta.identityId,reviewedLater.id])).rows[0];
   assert.equal(awarded.submission_id,publicAcId);
   assert.equal(awarded.points,15,'ranked award snapshots the admin-set default reward');
   assert.equal((await pointsMe(pool,beta)).body.points,personalBeforeReview.points,'personal first-AC reward is not repeated');
   assert.equal((await pointsMe(pool,beta)).body.rankPoints,personalBeforeReview.rankPoints+15);
   await pool.query('UPDATE point_rewards SET points=20 WHERE problem_id=$1 AND assignment_id IS NULL',[reviewedLater.id]);
   assert.equal((await pointsMe(pool,beta)).body.rankPoints,personalBeforeReview.rankPoints+15,'later reward edits cannot rewrite an earned rank');
   await assert.rejects(pool.query('UPDATE school_rank_ledger SET points=20 WHERE identity_id=$1 AND problem_id=$2',[beta.identityId,reviewedLater.id]),error=>/immutable/.test(error.message));
   assert.equal((await leaderboard(pool,teacher)).body.items.find(item=>item.id===beta.identityId).attempts,4,'unapproved AC does not enter public attempt statistics');
   const revokedAt=new Date();
   await pool.query(`UPDATE problem_versions SET rank_review_status='revoked',rank_reviewed_at=$2,
    school_visible_at=NULL WHERE id=$1`,[reviewedLater.versionId,revokedAt]);
   assert.equal((await leaderboard(pool,teacher)).body.items.find(item=>item.id===beta.identityId).attempts,4,'revocation preserves historical public attempts');
   await new Promise(resolve=>setTimeout(resolve,10));
   await submission(beta,reviewedLater,'submit','AC');
   assert.equal((await leaderboard(pool,teacher)).body.items.find(item=>item.id===beta.identityId).attempts,4,'post-revocation private attempts remain outside public statistics');
   const privateBankId=(await pool.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES('Later private',$1,'private') RETURNING id",[teacher.id])).rows[0].id;
   await pool.query('UPDATE problems SET bank_id=$2 WHERE id=$1',[reviewedLater.id,privateBankId]);
   assert.equal((await pointsMe(pool,beta)).body.rankPoints,personalBeforeReview.rankPoints+15,'an awarded school rank is frozen after a visibility change');
   assert.equal((await leaderboard(pool,teacher)).body.items.find(item=>item.id===beta.identityId).points,personalBeforeReview.rankPoints+15);

   // Assignment bonuses remain personal and never change school rank points.
   const assignmentId=(await pool.query(`INSERT INTO assignments(title,class_id,owner_account_id,due_at,state)
    VALUES('Bonus assignment',$1,$2,now()+interval '1 day','Draft') RETURNING id`,[classId,teacher.id])).rows[0].id;
   await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)',[assignmentId,first.id,first.versionId]);
   await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignmentId,alpha.identityId]);
   await pool.query('INSERT INTO point_rewards(problem_id,assignment_id,points,updated_by) VALUES($1,$2,7,$3)',[first.id,assignmentId,teacher.id]);
   await pool.query("UPDATE assignments SET state='Published' WHERE id=$1",[assignmentId]);
   const beforeBonus=(await pointsMe(pool,alpha)).body;
   await submission(alpha,first,'submit','AC',new Date(),null,assignmentId);
   const afterBonus=(await pointsMe(pool,alpha)).body;
   assert.equal(afterBonus.points,beforeBonus.points+7);
   assert.equal(afterBonus.rankPoints,beforeBonus.rankPoints);

   // A timed AC followed by a scored WA earns first-AC rank points only when
   // the first result is published, matching the personal first-AC policy.
   const timedWaId=await submission(alpha,hidden,'submit','WA',new Date(),timedAttemptId);
   await pool.query('INSERT INTO timed_first_ac_candidates(submission_id,practice_id) VALUES($1,$2)',[timedAcId,practiceId]);
   await pool.query('INSERT INTO timed_result_snapshots(practice_id,identity_id,grade) VALUES($1,$2,$3)',[practiceId,alpha.identityId,{problems:[{submissionId:`SUB${timedWaId}`,status:'WA'}]}]);
   assert.equal((await pointsMe(pool,alpha)).body.rankPoints,afterBonus.rankPoints,'unreleased timed AC stays off the board');
   await pool.query("UPDATE timed_practices SET state='ResultsPublished',results_published_at=now() WHERE id=$1",[practiceId]);
   const afterRelease=(await pointsMe(pool,alpha)).body;
   assert.equal(afterRelease.points,afterBonus.points+10);
   assert.equal(afterRelease.rankPoints,afterBonus.rankPoints+10);
   assert.equal((await pool.query('SELECT submission_id FROM school_rank_ledger WHERE identity_id=$1 AND problem_id=$2',[alpha.identityId,hidden.id])).rows[0].submission_id,timedAcId);
  } finally {
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
