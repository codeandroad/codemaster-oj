import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPool, transaction} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handlePresence, PRESENCE_TTL_SECONDS} from '../src/presence.mjs';
import {defaultAvatarPath} from '../src/avatars.mjs';

test('presence validates authentication, role, paging, search and rejects client-controlled identity/time', async () => {
 const context = {user: {id: randomUUID(), roles: ['student']}, sess: {token_hash: 'session'},
  route: '/presence', method: 'GET', url: new URL('http://localhost/presence')};
 await assert.rejects(handlePresence({...context, user: null}), error => error.status === 401);
 await assert.rejects(handlePresence({...context, sess: null}), error => error.status === 401);
 await assert.rejects(handlePresence({...context, user: {...context.user, roles: []}}), error => error.status === 403);
 for (const query of ['page=0', 'page=-1', 'page=1.5', 'pageSize=51', 'q=' + 'a'.repeat(81)]) {
  await assert.rejects(handlePresence({...context, url: new URL(`http://localhost/presence?${query}`)}), error => error.status === 400);
 }
 for (const body of [{identityId: randomUUID()}, {seenAt: new Date().toISOString()}, {problemId: randomUUID()}, [], null]) {
  await assert.rejects(handlePresence({...context, method: 'POST', route: '/presence/heartbeat', body}), error => error.status === 400);
 }
 await assert.rejects(handlePresence({...context, method: 'POST', route: '/presence/heartbeat',
  user: {...context.user, roles: ['teacher']}}), error => error.status === 403);
 await assert.rejects(handlePresence({...context, route: '/presence/students/not-a-uuid'}), error => error.status === 400);
});

test('student preview uses application grants, school ownership and safe first-AC visibility for every viewer',
 {skip: !process.env.TEST_DATABASE_URL, timeout: 60000}, async () => {
 const manager = createPool(process.env.TEST_DATABASE_URL);
 const schema = `presence_preview_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection = new URL(process.env.TEST_DATABASE_URL);
 connection.searchParams.set('options', `-csearch_path=${schema}`);
 const pool = createPool(connection.href);
 let runtime;
 try {
  await migrate(pool);
  const grants = await readFile(new URL('../grants.mjs', import.meta.url), 'utf8');
  const sql = grants.match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
  assert.ok(sql);
  await pool.query(sql.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
  const appUrl = new URL(connection.href);
  appUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
  runtime = createPool(appUrl.href);
  async function account(kind, name, {role = kind, nickname = '', useNickname = false} = {}) {
   return transaction(pool, async db => {
    const {rows: [identity]} = await db.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
     [kind, randomUUID(), name]);
    const {rows: [person]} = await db.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname,leaderboard_use_nickname)
     VALUES($1,$2,'test-hash',$3,$4) RETURNING id`, [identity.id, randomUUID(), nickname, useNickname]);
    if (role) await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [person.id, role]);
    const {rows: [sess]} = await db.query(`INSERT INTO sessions(token_hash,account_id,csrf_token,expires_at,presence_seen_at)
     VALUES($1,$2,$3,now()+interval '1 day',now()) RETURNING *`, [randomUUID(), person.id, randomUUID()]);
    return {user: {id: person.id, identityId: identity.id, roles: role ? [role] : []}, sess};
   });
  }
  const viewer = await account('student', 'Viewer');
  const target = await account('student', 'PRIVATE LEGAL NAME', {nickname: 'Public nickname', useNickname: true});
  const teacher = await account('teacher', 'Teacher');
  const admin = await account('admin', 'Administrator');
  const personal = await account('personal', 'PERSONAL SECRET', {role: null});
  const newSchool = await account('personal', 'OTHER SCHOOL SECRET', {role: null});
  const schoolId = (await pool.query("INSERT INTO schools(slug,name) VALUES('presence-other','Other school') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')", [schoolId, newSchool.user.id]);
  // A stray legacy role must not bypass explicit ownership of either identity
  // or account. Build this inconsistent historical fixture only in the QA DB.
  const unrelated = await account('student', 'UNRELATED STUDENT SECRET');
  await pool.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1', [unrelated.user.id]);
  await pool.query('DELETE FROM legacy_school_identity_ownership WHERE identity_id=$1', [unrelated.user.identityId]);
  const call = (auth, path = `/presence/students/${target.user.identityId}`) => {
   const url = new URL(`http://localhost${path}`);
   return handlePresence({pool: runtime, ...auth, method: 'GET', route: url.pathname, url}).then(result => result.body);
  };
  for (const outsider of [personal, newSchool, unrelated]) {
   await assert.rejects(call(outsider), error => error.status === 403);
   // Even a forged in-process role does not supersede live ownership/roles.
   await assert.rejects(call({...outsider, user: {...outsider.user, roles: ['admin']} }), error => error.status === 403);
   await assert.rejects(call(viewer, `/presence/students/${outsider.user.identityId}`), error => error.status === 404);
  }
  const online = await call(viewer, '/presence');
  assert.equal(online.onlineCount, 2);
  assert.deepEqual(new Set(online.items.map(item => item.identityId)), new Set([viewer.user.identityId, target.user.identityId]));
  assert.ok(!JSON.stringify(online).includes('SECRET'));
  assert.equal((await call(viewer, `/presence?q=${encodeURIComponent('PRIVATE LEGAL NAME')}`)).total, 0);
  const blank = await call(viewer);
  assert.deepEqual(Object.keys(blank).sort(), ['activity', 'stats', 'student']);
  assert.deepEqual(blank.student, {identityId: target.user.identityId, displayName: 'Public nickname',
   avatar: defaultAvatarPath(target.user.identityId), isSelf: false, isOnline: true});
  assert.deepEqual(blank.stats, {points: 0, solvedProblems: 0, acRate: null, scholarship: 100});
  assert.deepEqual(blank.activity, []);
  await pool.query('UPDATE leaderboard_settings SET show_solved_problems=false,show_ac_rate=false,show_luq_balance=false WHERE id=true');
  assert.deepEqual((await call(viewer)).stats, {points: 0}, 'hidden fields are omitted, not merely hidden in the browser');
  assert.deepEqual((await call({...viewer, user: {...viewer.user, roles: ['admin']}})).stats, {points: 0}, 'staff override requires the persisted role');
  for (const authorized of [target, teacher, admin]) {
   const result = await call(authorized);
   assert.deepEqual(result.stats, blank.stats);
   assert.equal(result.student.isSelf, authorized === target);
  }
  await pool.query('UPDATE leaderboard_settings SET show_solved_problems=true,show_ac_rate=true,show_luq_balance=true WHERE id=true');
  async function problem(title, {visibility = 'school', approved = true, published = true} = {}) {
   const bankId = (await pool.query('INSERT INTO problem_banks(name,visibility,owner_account_id) VALUES($1,$2,$3) RETURNING id',
    [title, visibility, teacher.user.id])).rows[0].id;
   const id = (await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id', [teacher.user.id, bankId])).rows[0].id;
   const versionId = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,
    reference_code,validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at,rank_reviewed_at,rank_reviewed_by)
    VALUES($1,$2,'stdio','STATEMENT-SECRET',500,64,'REFERENCE-SECRET','AC',
     CASE WHEN $3 THEN now()-interval '1 day' END,CASE WHEN $4 THEN now()-interval '1 day' END,
     CASE WHEN $4 THEN 'approved' ELSE 'pending' END,CASE WHEN $4 THEN now()-interval '1 day' END,
     CASE WHEN $4 THEN now()-interval '1 day' END,CASE WHEN $4 THEN $5::uuid END) RETURNING id`,
    [id, title, published, approved, admin.user.id])).rows[0].id;
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [id, versionId]);
   return {id, versionId, bankId};
  }
  async function accepted(item, minute, {kind = 'submit', timedAttemptId = null} = {}) {
   const submissionId = (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,
    idempotency_key,request_hash,status,score,created_at,timed_attempt_id,public_message)
    VALUES($1,$2,$3,$4,$5,'STUDENT-CODE-SECRET',$6,'preview-test','AC',100,now()+$7::int*interval '1 minute',$8,'TEST-SECRET') RETURNING id`,
    [target.user.id, target.user.identityId, item.id, item.versionId, kind, randomUUID(), minute, timedAttemptId])).rows[0].id;
   await pool.query("UPDATE point_ledger SET created_at=now()+$2::int*interval '1 minute' WHERE submission_id=$1", [submissionId, minute]);
   return submissionId;
  }
  const visible = [];
  for (let index = 0; index < 4; index++) {
   const item = await problem(`Public exercise ${index}`);
   await accepted(item, index);
   visible.push(item);
  }
  const privateProblem = await problem('PRIVATE PROBLEM SECRET', {visibility: 'private'});
  await accepted(privateProblem, 10);
  const pending = await problem('PENDING SECRET', {approved: false});
  await accepted(pending, 11);
  const unpublished = await problem('DRAFT SECRET', {published: false, approved: false});
  await accepted(unpublished, 12);
  const archived = await problem('ARCHIVED SECRET');
  await accepted(archived, 13);
  await pool.query('UPDATE problems SET archived_at=now() WHERE id=$1', [archived.id]);
  const archivedBank = await problem('ARCHIVED BANK SECRET');
  await accepted(archivedBank, 14);
  await pool.query('UPDATE problem_banks SET archived_at=now() WHERE id=$1', [archivedBank.bankId]);
  const correction = await problem('CORRECTION SECRET');
  await accepted(correction, 15, {kind: 'correction'});
  const samples = await problem('SAMPLES SECRET');
  await accepted(samples, 16, {kind: 'samples'});
  const revoked = await problem('REVOKED SECRET');
  await accepted(revoked, 17);
  await pool.query("UPDATE problem_versions SET rank_review_status='revoked',school_visible_at=NULL WHERE id=$1", [revoked.versionId]);
  const classId = (await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('PRIVATE CLASS SECRET',$1) RETURNING id", [teacher.user.id])).rows[0].id;
  const practiceId = (await pool.query(`INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes,state)
   VALUES('PRIVATE TIMED SECRET',$1,$2,now()-interval '1 minute',now()+interval '1 hour',30,'Draft') RETURNING id`, [classId, teacher.user.id])).rows[0].id;
  await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)', [practiceId, target.user.identityId]);
  await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1", [practiceId]);
  const timedAttemptId = (await pool.query(`INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at)
   VALUES($1,$2,$3,now(),now()+interval '30 minutes') RETURNING id`, [practiceId, target.user.identityId, target.user.id])).rows[0].id;
  const timed = await problem('Released exercise');
  const timedSubmission = await accepted(timed, 0, {timedAttemptId});
  // A legacy ledger imported before publication must still not disclose a
  // result before the timed activity is released.
  await pool.query(`INSERT INTO point_ledger(identity_id,problem_id,submission_id,reason,points,created_at)
   VALUES($1,$2,$3,'first_ac',10,now()+interval '20 minutes')`, [target.user.identityId, timed.id, timedSubmission]);
  await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,'submit','private-code',$5,'preview-wa','WA',0)`,
   [target.user.id,target.user.identityId,visible[0].id,visible[0].versionId,randomUUID()]);
  await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,$5,'submit','private-code',$6,'preview-timed-wa','WA',0)`,
   [target.user.id,target.user.identityId,timed.id,timed.versionId,timedAttemptId,randomUUID()]);
  assert.equal((await call(viewer)).stats.acRate,100,'AC rate excludes practice after the first AC and unpublished timed results');
  const expectedTitles = ['Public exercise 3', 'Public exercise 2', 'Public exercise 1'];
  for (const authorized of [viewer, target, teacher, admin]) {
   const result = await call(authorized);
   assert.deepEqual(result.activity.map(item => item.problemTitle), expectedTitles);
   assert.ok(result.stats.points > 0);
   assert.ok(!JSON.stringify(result).includes('SECRET'), 'self and staff have no private-activity exception');
   for (const item of result.activity) assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'id', 'problemTitle']);
  }
  await pool.query('UPDATE timed_practices SET results_published_at=now() WHERE id=$1', [practiceId]);
  assert.equal((await call(viewer)).stats.acRate,83.3,'released timed results count even after a timed AC');
  assert.deepEqual((await call(viewer)).activity.map(item => item.problemTitle), ['Released exercise', ...expectedTitles.slice(0, 2)]);
  await pool.query('UPDATE accounts SET leaderboard_use_nickname=false WHERE id=$1', [target.user.id]);
  assert.equal((await call(viewer)).student.displayName, 'PRIVATE LEGAL NAME', 'explicit name preference matches the online list');
  for (const [hide, restore, params] of [
   ['UPDATE accounts SET disabled_at=now() WHERE id=$1', 'UPDATE accounts SET disabled_at=NULL WHERE id=$1', [target.user.id]],
   ['UPDATE accounts SET binding_released_at=now() WHERE id=$1', 'UPDATE accounts SET binding_released_at=NULL WHERE id=$1', [target.user.id]],
   ['UPDATE identities SET archived_at=now() WHERE id=$1', 'UPDATE identities SET archived_at=NULL WHERE id=$1', [target.user.identityId]],
   ["DELETE FROM account_roles WHERE account_id=$1 AND role='student'", "INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [target.user.id]],
  ]) {
   await pool.query(hide, params);
   await assert.rejects(call(viewer), error => error.status === 404);
   assert.equal((await call(viewer, '/presence')).onlineCount, 1);
   await pool.query(restore, params);
  }
  await pool.query('DELETE FROM sessions WHERE token_hash=$1', [viewer.sess.token_hash]);
  await assert.rejects(call(viewer), error => error.status === 401);
 } finally {
  if (runtime) await runtime.end();
  await pool.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  await manager.end();
 }
});

test('presence TTL, session deduplication, account state and public-name search use a real database',
 {skip: !process.env.TEST_DATABASE_URL, timeout: 60000}, async () => {
 const manager = createPool(process.env.TEST_DATABASE_URL);
 const schema = `presence_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection = new URL(process.env.TEST_DATABASE_URL);
 connection.searchParams.set('options', `-csearch_path=${schema}`);
 const pool = createPool(connection.href);
 try {
  await migrate(pool);
  async function account(kind, name, nickname = '', useNickname = false) {
   const {rows: [identity]} = await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
    [kind, randomUUID(), name]);
   const {rows: [account]} = await pool.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname,leaderboard_use_nickname)
    VALUES($1,$2,'test-hash',$3,$4) RETURNING id`, [identity.id, randomUUID(), nickname, useNickname]);
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [account.id, kind]);
   return {id: account.id, identityId: identity.id, roles: [kind]};
  }
  async function session(user) {
   const {rows: [sess]} = await pool.query(`INSERT INTO sessions(token_hash,account_id,csrf_token,expires_at)
    VALUES($1,$2,$3,now()+interval '1 day') RETURNING *`, [randomUUID(), user.id, randomUUID()]);
   return {user, sess};
  }
  const alpha = await account('student', 'Alice', 'UNUSED-NICKNAME');
  const beta = await account('student', 'PRIVATE-LEGAL-NAME', 'Beta', true);
  const teacher = await account('teacher', 'Teacher');
  const first = await session(alpha), second = await session(alpha), b = await session(beta), staff = await session(teacher);
  const call = (auth, route = '/presence', method = 'GET', query = '') => handlePresence({pool, ...auth, route, method,
   body: {}, url: new URL(`http://localhost/api/v1${route}${query}`)}).then(response => response.body);
  const heartbeat = auth => call(auth, '/presence/heartbeat', 'POST');
  assert.equal((await call(staff)).onlineCount, 0, 'login alone is not an online heartbeat');
  const beforeScholarship = (await pool.query('SELECT count(*)::int n FROM luq_ledger')).rows[0].n;
  await Promise.all([heartbeat(first), heartbeat(first), heartbeat(second), heartbeat(b)]);
  const seenAt = (await pool.query('SELECT presence_seen_at FROM sessions WHERE token_hash=$1', [first.sess.token_hash])).rows[0].presence_seen_at;
  await heartbeat(first);
  assert.equal((await pool.query('SELECT presence_seen_at FROM sessions WHERE token_hash=$1', [first.sess.token_hash])).rows[0].presence_seen_at.getTime(), seenAt.getTime(), 'rapid repeated heartbeats do not repeatedly write');
  await pool.query('UPDATE sessions SET presence_seen_at=now() WHERE account_id=$1', [teacher.id]);
  const online = await call(staff);
  assert.equal(online.onlineCount, 2, 'multiple tabs/devices count one stable identity; staff do not count');
  assert.equal(online.total, 2);
  assert.equal(online.ttlSeconds, PRESENCE_TTL_SECONDS);
  assert.deepEqual(online.items, [
   {identityId: alpha.identityId, displayName: 'Alice', avatar: defaultAvatarPath(alpha.identityId)},
   {identityId: beta.identityId, displayName: 'Beta', avatar: defaultAvatarPath(beta.identityId)},
  ]);
  const found = await call(staff, '/presence', 'GET', '?q=bEtA&pageSize=1');
  assert.equal(found.onlineCount, 2);
  assert.equal(found.total, 1);
  assert.equal(found.items[0].identityId, beta.identityId);
  assert.equal((await call(staff, '/presence', 'GET', '?q=PRIVATE-LEGAL-NAME')).total, 0);
  assert.equal((await call(staff, '/presence', 'GET', '?q=UNUSED-NICKNAME')).total, 0);
  assert.equal((await call(staff, '/presence', 'GET', '?q=%25')).total, 0, 'search is literal, not a LIKE wildcard');
  assert.equal((await call(staff, '/presence', 'GET', '?page=2&pageSize=1')).items[0].identityId, beta.identityId);
  assert.equal((await call(staff, '/presence', 'GET', '?page=3&pageSize=1')).items.length, 0);
  await pool.query('DELETE FROM sessions WHERE token_hash=$1', [first.sess.token_hash]);
  assert.equal((await call(staff)).onlineCount, 2, 'another valid session keeps the student online');
  await assert.rejects(heartbeat(first), error => error.status === 401);
  await pool.query("UPDATE sessions SET presence_seen_at=now()-interval '91 seconds' WHERE account_id=$1", [alpha.id]);
  assert.equal((await call(staff)).onlineCount, 1, 'stale clients expire without a cleanup task');
  await heartbeat(second);
  assert.equal((await call(staff)).onlineCount, 2);
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE account_id=$1", [alpha.id]);
  assert.equal((await call(staff)).onlineCount, 1);
  await assert.rejects(heartbeat(second), error => error.status === 401);
  await pool.query('UPDATE accounts SET disabled_at=now() WHERE id=$1', [beta.id]);
  assert.equal((await call(staff)).onlineCount, 0);
  await assert.rejects(heartbeat(b), error => error.status === 401);
  await pool.query('UPDATE accounts SET disabled_at=NULL WHERE id=$1', [beta.id]);
  await pool.query('UPDATE identities SET archived_at=now() WHERE id=$1', [beta.identityId]);
  assert.equal((await call(staff)).onlineCount, 0);
  await pool.query('UPDATE identities SET archived_at=NULL WHERE id=$1', [beta.identityId]);
  await pool.query('UPDATE accounts SET binding_released_at=now() WHERE id=$1', [beta.id]);
  assert.equal((await call(staff)).onlineCount, 0);
  await pool.query('UPDATE accounts SET binding_released_at=NULL WHERE id=$1', [beta.id]);
  await pool.query("DELETE FROM account_roles WHERE account_id=$1 AND role='student'", [beta.id]);
  assert.equal((await call(staff)).onlineCount, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_ledger')).rows[0].n, beforeScholarship, 'heartbeats cannot award Luq');
  assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n, 0);
 } finally {
  await pool.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  await manager.end();
 }
});
