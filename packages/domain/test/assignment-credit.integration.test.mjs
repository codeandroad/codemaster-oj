import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';

// Adjudicated synthetic submissions exercise real PostgreSQL triggers and HTTP
// authorization. No candidate code is executed and no production data is used.
test('ordinary assignments recognize prior formal AC without copying submissions or rewards',
 { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
 const manager = createPool(process.env.TEST_DATABASE_URL), schema = `assignment_credit_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const database = new URL(process.env.TEST_DATABASE_URL); database.searchParams.set('options', `-csearch_path=${schema}`);
 const pool = createPool(database.href); let server;
 try {
  await migrate(pool);
  const password = `Credit-${randomUUID()}!`;
  await bootstrap(pool, { name: 'Admin', number: 'CREDIT-ADMIN', username: 'credit-admin', password });
  server = http.createServer(await createApp(pool, loadConfig({ SESSION_SECRET: randomBytes(48).toString('hex'), APP_ORIGIN: 'http://credit.test', COOKIE_SECURE: 'false' })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  function client() {
   let cookie = '', csrf = '';
   return async (path, body, method = body === undefined ? 'GET' : 'POST', status = 200) => {
    const response = await fetch(base + path, { method, headers: { Origin: 'http://credit.test', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (result.csrfToken) csrf = result.csrfToken;
    return result;
   };
  }
  const admin = client(); await admin('/auth/login', { username: 'credit-admin', password });
  const users = {};
  for (const [tag, kind] of [['teacher', 'teacher'], ['colleague', 'teacher'], ['student', 'student'], ['other', 'student']]) {
   const api = client(), number = `CREDIT-${tag}`;
   const created = await admin('/people', { kind, number, name: number }, 'POST', 201);
   const registered = await api('/auth/register', { kind, number, name: number, activationCode: created.activationCode, username: number.toLowerCase(), password }, 'POST', 201);
   users[tag] = { api, ...registered.user };
  }
  const { teacher, colleague, student, other } = users;
  const deadline = new Date(Date.now() + 3600000).toISOString();
  async function problem(existingId) {
   const id = existingId ?? (await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [teacher.id])).rows[0].id;
   const versionId = (await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at,rank_review_status,rank_approved_at,school_visible_at)
    VALUES($1,'Credit task','stdio','Read and print.',500,64,'PRIVATE_REFERENCE_SENTINEL','AC',now(),'approved',now(),now()) RETURNING id`, [id])).rows[0].id;
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [id, versionId]);
   return { id, versionId };
  }
  async function assignment(problems, { owner = teacher, participant = student, dueAt = deadline } = {}) {
   const id = (await pool.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Credit homework',$1,$2,'Draft') RETURNING id", [owner.id, dueAt])).rows[0].id;
   for (const [position, p] of problems.entries()) await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,20,$4)', [id, p.id, p.versionId, position]);
   await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)', [id, participant.identityId]);
   await pool.query(`INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,task_kind,created_by)
    VALUES('assignment',$1,1,6,1,100,'challenge',$2)`, [id, owner.id]);
   await pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1", [id]);
   return id;
  }
  async function submit(p, { user = student, assignmentId = null, timedAttemptId = null, status = 'AC', score = status === 'AC' ? 100 : status === 'WA' ? 60 : null, kind = 'submit', createdAt = new Date().toISOString(), originalId = null } = {}) {
   return (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,assignment_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score,created_at,original_submission_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PRIVATE_STUDENT_CODE_SENTINEL',$8,'credit-fixture',$9,$10,$11,$12) RETURNING id`,
   [user.id, user.identityId, p.id, p.versionId, assignmentId, timedAttemptId, kind, randomUUID(), status, score, createdAt, originalId])).rows[0].id;
  }
  const result = id => student.api(`/assignments/${id}`);
  const cell = async id => (await result(id)).grades[0].problems[0];
  const counts = async () => (await pool.query(`SELECT
   (SELECT count(*) FROM submissions) submissions,(SELECT count(*) FROM judge_tasks) jobs,
   (SELECT count(*) FROM point_ledger) points,(SELECT count(*) FROM school_rank_ledger) rank,
   (SELECT count(*) FROM luq_ledger) luq,(SELECT count(*) FROM luq_activity_awards) rewards`)).rows[0];

  await t.test('course/free AC before assignment gives full credit in student, teacher and reports, without duplicate rewards', async () => {
   const p = await problem(), source = await submit(p), id = await assignment([p]);
   const before = await counts();
   const studentResult = await result(id), teacherResult = await teacher.api(`/assignments/${id}`), report = await teacher.api(`/reports?assignmentId=${id}`);
   assert.equal(studentResult.grades[0].score, 20);
   assert.equal(studentResult.completedStudents, 1);
   assert.equal(studentResult.submittedStudents, 0);
   assert.equal(studentResult.averagePercent, 100);
   assert.deepEqual(teacherResult.grades, studentResult.grades);
   const g = studentResult.grades[0].problems[0];
   assert.equal(g.status, 'AC'); assert.equal(g.score, 100); assert.equal(g.completionSource, 'other_entry');
   assert.equal(g.submissionId, null); assert.equal(g.hasAssignmentSubmission, false); assert.equal(g.assignmentAttempts, 0); assert(g.creditedAt);
   assert.equal(report.summary.averagePercent, 100); assert.equal(report.summary.gradedStudents, 1);
   assert.equal(report.summary.submittedStudents, 0); assert.equal(report.metrics.notStarted, 0);
   assert.equal(report.metrics.incomplete, 0); assert.equal(report.problems[0].averagePercent, 100);
   assert.equal(report.submissions.length, 0);
   const list = await student.api('/assignments');
   assert.equal(list.items.find(a => a.id === id).grades[0].problems[0].status, 'AC');
   const serialized = JSON.stringify([studentResult, teacherResult, report]);
   assert(!serialized.includes('PRIVATE_')); assert(!serialized.includes(`SUB${source}`));
   await Promise.all(Array.from({ length: 12 }, () => result(id)));
   assert.deepEqual(await counts(), before, 'read-side credit must not create submissions, jobs or rewards');
   assert.equal((await pool.query('SELECT count(*)::int n FROM luq_activity_awards WHERE activity_id=$1', [id])).rows[0].n, 0);
   await other.api(`/assignments/${id}`, undefined, 'GET', 403);
   await colleague.api(`/assignments/${id}`, undefined, 'GET', 403);
  });

  await t.test('credit does not grant a teacher access to another teacher’s student code', async () => {
   const p = await problem(), sourceActivity = await assignment([p], { owner: colleague });
   const source = await submit(p, { assignmentId: sourceActivity });
   const id = await assignment([p]);
   assert.equal((await cell(id)).completionSource, 'other_entry');
   await teacher.api(`/submissions/SUB${source}`, undefined, 'GET', 403);
   await colleague.api(`/submissions/SUB${source}`);
   const visible = await teacher.api('/submissions');
   assert(!visible.items.some(s => s.id === `SUB${source}`));
   await pool.query('UPDATE assignment_participants SET exempt=true WHERE assignment_id=$1', [id]);
   assert.equal((await teacher.api(`/assignments/${id}`)).grades.length, 0);
   await student.api(`/assignments/${id}`, undefined, 'GET', 403);
  });

  await t.test('course links and completion stats follow qualifying grades and already-posted rewards', async () => {
   const p = await problem(), q = await problem();
   const courseId = (await pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Completion course',now()) RETURNING id", [teacher.id])).rows[0].id;
   const id = await assignment([p,q]);
   await pool.query('UPDATE assignments SET course_path_id=$2 WHERE id=$1',[id,courseId]);
   const courseLink = async () => (await student.api(`/learning-paths/${courseId}`)).assignments.find(item => item.id === id);
   const completions = (source, user=student, status=200) => user.api(`/submissions/SUB${source}/assignment-completions`, undefined, 'GET', status);

   assert.equal((await result(id)).completion, null);
   assert.deepEqual(await courseLink(), {id,title:'Credit homework',dueAt:deadline,completedProblems:0,totalProblems:2,completed:false});
   const first = await submit(p, {assignmentId:id});
   const waiting = await submit(q, {assignmentId:id,status:'Waiting'});
   assert.deepEqual(await completions(waiting), {items:[]});
   assert.equal((await courseLink()).completedProblems, 1);
   assert.equal((await result(id)).completion, null);

   await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[waiting]);
   const before = await counts();
   const {completion} = await result(id);
   const {created_at} = (await pool.query('SELECT created_at FROM submissions WHERE id=$1',[first])).rows[0];
   assert.equal(completion.completedBySubmissionId, `SUB${waiting}`);
   assert.equal(completion.elapsedMs, Date.parse(completion.completedAt)-created_at.getTime());
   assert.equal(completion.completedProblems, 2);
   assert.equal(completion.totalProblems, 2);
   assert.deepEqual(completion.rewards, {firstAc:8,assignment:6,total:14});
   assert.equal((await courseLink()).completed, true);
   assert.deepEqual(await completions(waiting), {items:[{id,title:'Credit homework',completion}]});
   assert.deepEqual(await completions(first), {items:[]});
   assert.equal((await teacher.api(`/assignments/${id}`)).completion, undefined);
   await completions(waiting, other, 404);
   await completions(waiting, teacher, 403);
   assert.deepEqual(await counts(), before, 'reading stats or completion events never changes grades or grants awards');
   const repeat = await submit(q, {assignmentId:id});
   assert.deepEqual(await completions(repeat), {items:[]});
   assert.deepEqual((await result(id)).completion, completion);
  });

  await t.test('a newly accepted course submission can finish a linked assignment without earning an assignment reward', async () => {
   const p = await problem(), id = await assignment([p]);
   const own = await submit(p);
   const {completion} = await result(id);
   assert.equal(completion.completedBySubmissionId, null);
   assert.equal(completion.elapsedMs, null);
   assert.deepEqual(completion.rewards, {firstAc:0,assignment:0,total:0});
   const url = `/submissions/SUB${own}/assignment-completions`;
   assert.deepEqual(await student.api(url), {items:[{id,title:'Credit homework',completion}]});
   await pool.query('UPDATE assignment_participants SET exempt=true WHERE assignment_id=$1',[id]);
   assert.deepEqual(await student.api(url), {items:[]});
  });

  await t.test('stable identity and the exact assigned version are required', async () => {
   const old = await problem(), latest = await problem(old.id);
   await submit(old);
   const id = await assignment([latest]);
   assert.equal((await cell(id)).status, 'NotSubmitted');
   await submit(latest, { user: other });
   assert.equal((await cell(id)).status, 'NotSubmitted');
   const sameTitle = await problem(); await submit(sameTitle);
   assert.equal((await cell(id)).status, 'NotSubmitted');
   await submit(latest);
   assert.equal((await cell(id)).status, 'AC');
   await pool.query("UPDATE identities SET name='Renamed student',number='CREDIT-renamed' WHERE id=$1", [student.identityId]);
   assert.equal((await cell(id)).completionSource, 'other_entry');
  });

  await t.test('deadline is inclusive; samples, custom runs, corrections and non-AC results do not count', async () => {
   for (const options of [{ kind: 'samples' }, { kind: 'custom' }, { kind: 'correction' }, { status: 'WA' }, { status: 'Waiting' }, { status: 'System Error' }, { createdAt: new Date(Date.parse(deadline) + 1).toISOString() }]) {
    const p = await problem(), id = await assignment([p]);
    const originalId = options.kind === 'correction' ? await submit(p, { status: 'WA' }) : null;
    await submit(p, { ...options, originalId });
    assert.equal((await cell(id)).status, 'NotSubmitted', JSON.stringify(options));
   }
   const p = await problem(), id = await assignment([p]);
   await submit(p, { createdAt: deadline });
   assert.equal((await cell(id)).status, 'AC');
  });

  await t.test('credit supersedes partial and pending grades once, preserves attempts, and follows confirmed source results', async () => {
   const p = await problem(), id = await assignment([p]);
   const own = await submit(p, { assignmentId: id, status: 'WA' });
   assert.equal((await result(id)).grades[0].score, 12);
   const source = await submit(p);
   await submit(p, { assignmentId: id, status: 'Waiting' });
   let a = await result(id);
   assert.equal(a.grades[0].score, 20); assert.equal(a.grades[0].pending, false);
   assert.equal(a.submittedStudents, 1); assert.equal(a.grades[0].problems[0].hasAssignmentSubmission, true);
   assert.equal((await teacher.api(`/reports?assignmentId=${id}`)).summary.submittedStudents, 1);
   await pool.query("UPDATE submissions SET status='WA',score=60 WHERE id=$1", [source]);
   a = await result(id);
   assert.equal(a.grades[0].score, 12); assert.equal(a.grades[0].pending, true);
   assert.equal(a.grades[0].problems[0].submissionId, `SUB${own}`);
   assert.equal(a.grades[0].problems[0].completionSource, null);
   const ownAc = await submit(p, { assignmentId: id });
   await submit(p);
   a = await result(id);
   assert.equal(a.grades[0].score, 20); assert.equal(a.grades[0].problems[0].submissionId, `SUB${ownAc}`);
   assert.equal(a.grades[0].problems[0].completionSource, null);
  });

  await t.test('attempt count is exact for this identity, assignment and pinned version, including pending and late formal submissions', async () => {
   const p = await problem(), id = await assignment([p]);
   await submit(p);
   assert.equal((await cell(id)).assignmentAttempts, 0);
   const own = await submit(p, { assignmentId: id, status: 'WA' });
   await submit(p, { assignmentId: id, status: 'Waiting' });
   await submit(p, { assignmentId: id, createdAt: new Date(Date.parse(deadline) + 1).toISOString() });
   await submit(p, { assignmentId: id, kind: 'samples' });
   await submit(p, { assignmentId: id, kind: 'custom' });
   await submit(p, { assignmentId: id, kind: 'correction', originalId: own });
   const elsewhere = await assignment([p]);
   await submit(p, { assignmentId: elsewhere });
   await submit(p, { user: other, assignmentId: id });
   const anotherVersion = await problem(p.id);
   await submit(anotherVersion, { assignmentId: id });
   assert.equal((await cell(id)).assignmentAttempts, 3);
   // More than a paginated submission history page must still be counted.
   await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,assignment_id,kind,code,idempotency_key,request_hash,status)
    SELECT $1,$2,$3,$4,$5,'submit','count fixture',gen_random_uuid(),'count-fixture','Waiting' FROM generate_series(1,205)`, [student.id, student.identityId, p.id, p.versionId, id]);
   const g = await cell(id);
   assert.equal(g.assignmentAttempts, 208); assert.equal(g.hasAssignmentSubmission, true);
   assert.equal(g.status, 'AC'); assert.equal(g.completionSource, 'other_entry');
   assert.equal((await teacher.api(`/assignments/${id}`)).grades[0].problems[0].assignmentAttempts, 208);
  });

  await t.test('course display ordering is consistent, preserves the scored snapshot and allows switching to saved custom order after submissions', async () => {
   const [c1p1,c1p2,c2p1,outside,archived] = await Promise.all(Array.from({length:5}, () => problem()));
   const courseVersion = await problem(c1p1.id);
   const course = (await pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Ordered course',now()) RETURNING id", [teacher.id])).rows[0].id;
   const chapters=[];
   for (const position of [0,1,2]) chapters.push((await pool.query('INSERT INTO learning_chapters(path_id,title,position) VALUES($1,$2,$3) RETURNING id', [course,`Chapter ${position}`,position])).rows[0].id);
   for (const [chapter,p,position] of [[chapters[0],c1p2,1],[chapters[0],courseVersion,0],[chapters[1],c2p1,0],[chapters[1],c1p1,1],[chapters[2],archived,0]]) await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)',[chapter,p.id,p.versionId,position]);
   await pool.query('UPDATE learning_chapters SET archived_at=now() WHERE id=$1',[chapters[2]]);
   const savedOrder=[outside,c2p1,c1p2,c1p1,archived];
   const id=await assignment(savedOrder);
   await pool.query('UPDATE assignments SET course_path_id=$2 WHERE id=$1',[id,course]);
   await submit(c1p1,{assignmentId:id});
   const stored=await pool.query('SELECT * FROM assignment_problems WHERE assignment_id=$1 ORDER BY position',[id]);
   const beforeCounts=await counts();
   let displayed=await result(id);
   assert.equal(displayed.problemOrder,'course');
   assert.deepEqual(displayed.problems.map(p=>p.problemId),[c1p1,c1p2,c2p1,outside,archived].map(p=>p.id));
   assert.equal(displayed.problems[0].versionId,c1p1.versionId,'course order must not upgrade the assigned version');
   assert.deepEqual(displayed.problems.map(p=>p.position),[3,2,1,0,4]);
   assert.deepEqual((await teacher.api(`/assignments/${id}`)).problems,displayed.problems);
   const revision=displayed.editRevision;
   await student.api(`/assignments/${id}`,{expectedRevision:revision,problemOrder:'custom'},'PATCH',403);
   await colleague.api(`/assignments/${id}`,{expectedRevision:revision,problemOrder:'custom'},'PATCH',403);
   await teacher.api(`/assignments/${id}`,{expectedRevision:revision,problemOrder:'random'},'PATCH',400);
   displayed=await teacher.api(`/assignments/${id}`,{expectedRevision:revision,problemOrder:'custom'},'PATCH');
   assert.equal(displayed.problemOrder,'custom');
   assert.deepEqual(displayed.problems.map(p=>p.problemId),savedOrder.map(p=>p.id));
   await teacher.api(`/assignments/${id}`,{expectedRevision:revision,problemOrder:'course'},'PATCH',409);
   await teacher.api(`/assignments/${id}`,{expectedRevision:displayed.editRevision,problems:[...savedOrder].reverse().map(p=>({problemId:p.id,versionId:p.versionId,points:20}))},'PATCH',409);
   displayed=await teacher.api(`/assignments/${id}`,{expectedRevision:displayed.editRevision,problemOrder:'course'},'PATCH');
   assert.deepEqual((await result(id)).problems,displayed.problems);
   assert.deepEqual((await pool.query('SELECT * FROM assignment_problems WHERE assignment_id=$1 ORDER BY position',[id])).rows,stored.rows);
   assert.deepEqual(await counts(),beforeCounts,'presentation changes must not alter submissions, grading or rewards');
   const edits=(await pool.query("SELECT metadata FROM audit_events WHERE resource_id=$1 AND action='assignment.published_edit' ORDER BY id",[id])).rows;
   assert.equal(edits.length,2);
   assert(edits.every(event=>JSON.stringify(event.metadata.fields)===JSON.stringify(['problemOrder'])));
   const created=await teacher.api('/assignments',{title:'Custom order draft',state:'Draft',coursePathId:course,problemOrder:'custom',dueAt:deadline,participants:[student.identityId],problems:savedOrder.map(p=>({problemId:p.id,points:20}))},'POST',201);
   assert.equal(created.problemOrder,'custom');
   assert.deepEqual(created.problems.map(p=>p.problemId),savedOrder.map(p=>p.id));
   const switched=await teacher.api(`/assignments/${created.id}`,{expectedRevision:created.editRevision,problemOrder:'course'},'PATCH');
   assert.deepEqual(switched.problems.map(p=>p.problemId),[c1p1,c1p2,c2p1,outside,archived].map(p=>p.id));
   const unlinked=await assignment(savedOrder);
   assert.deepEqual((await result(unlinked)).problems.map(p=>p.problemId),savedOrder.map(p=>p.id));
  });

  await t.test('timed submissions require released valid formal AC; late candidates and unpublished exam results are excluded', async () => {
   const p = await problem(), late = await problem(), id = await assignment([p, late]);
   const practice = (await pool.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes)
    VALUES('Private exam',$1,now()-interval '1 minute',now()+interval '1 hour',30) RETURNING id`, [colleague.id])).rows[0].id;
   for (const [position, q] of [p, late].entries()) await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,50,$4)', [practice, q.id, q.versionId, position]);
   await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)', [practice, student.identityId]);
   await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1", [practice]);
   const effectiveDeadline = new Date(Date.now() + 600000);
   const attempt = (await pool.query('INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at) VALUES($1,$2,$3,now(),$4) RETURNING id', [practice, student.identityId, student.id, effectiveDeadline])).rows[0].id;
   const source = await submit(p, { timedAttemptId: attempt });
   await submit(late, { timedAttemptId: attempt, createdAt: new Date(effectiveDeadline.getTime() + 1) });
   assert.equal((await cell(id)).status, 'NotSubmitted');
   await pool.query('INSERT INTO timed_first_ac_candidates(submission_id,practice_id) VALUES($1,$2)', [source, practice]);
   assert.equal((await cell(id)).status, 'NotSubmitted', 'candidate alone must not leak an unpublished exam result');
   await pool.query("UPDATE timed_practices SET state='ResultsPublished',results_published_at=now() WHERE id=$1", [practice]);
   const a = await result(id);
   assert.equal(a.grades[0].problems[0].status, 'AC');
   assert.equal(a.grades[0].problems[1].status, 'NotSubmitted');
   assert.equal(a.grades[0].score, 20); assert.equal(a.grades[0].maxScore, 40);
   // No result is projected in the opposite direction into a timed exam.
   const timed = await colleague.api(`/timed-practices/${practice}`);
   assert(!JSON.stringify(timed).includes('other_entry'));
  });
 } finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
 }
});
