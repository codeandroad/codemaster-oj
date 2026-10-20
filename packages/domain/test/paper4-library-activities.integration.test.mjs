import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { handlePaper4 } from '../src/paper4.mjs';
import { handleEducation } from '../src/education.mjs';
import { completePaper4Task } from '../paper4-worker.mjs';

const upgrade = '037_paper4_catalog_activities.sql';
const audienceUpgrade = '039_paper4_activity_audiences.sql';
const courseLinksUpgrade = '042_course_paper4_links.sql';
const luqUpgrades = ['043_luq.sql', '044_luq_initial_grant.sql', '045_luq_assistance_prices.sql', '046_luq_content_batches.sql', '047_problem_public_statements.sql'];
const questions = [{ key: 'Q1', title: 'Preserve a queue', statement: 'Implement the queue in English.',
  starterCode: '# Start here\n', initialFiles: { 'Data.txt': 'original\r\n' }, outputFiles: ['Result.txt'],
  stages: [{ id: 'Q1a', title: 'Queue operations', maxMarks: 75, judgeMode: 'auto' }] }];
const runnerCases = { Q1a: [
  { id: 'public', public: true, expectedStdout: '1\n' },
  { id: 'hidden', public: false, expectedStdout: '2\n', driverCode: 'print("hidden-driver-secret")' },
] };
const referenceSolutions = { Q1: 'print("reference-only-secret")\n' };
const acCases = runnerCases.Q1a.map(c => ({ stageId: 'Q1a', caseId: c.id, public: c.public, status: 'AC' }));

// No candidate program runs in this fixture. Results enter through the real
// leased-worker completion contract, with the complete frozen case evidence.
async function fixture(run, { beforeUpgrade = false } = {}) {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = `paper4_library_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(url.href);
  try {
    if (beforeUpgrade) {
      await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
      await pool.query('INSERT INTO schema_migrations(name) SELECT unnest($1::text[])', [[upgrade,audienceUpgrade,courseLinksUpgrade,...luqUpgrades]]);
    }
    await migrate(pool);
    async function account(role) {
      const identityId = (await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
        [role, randomUUID(), `${role} Paper 4 library`])).rows[0].id;
      const id = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
        [identityId, randomUUID(), 'fixture-hash-not-a-password'])).rows[0].id;
      await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id, role]);
      return { id, identityId, roles: [role] };
    }
    const teacher = await account('teacher'), otherTeacher = await account('teacher'), admin = await account('admin');
    const student = await account('student'), outsider = await account('student');
    async function classroom(owner, member, name) {
      const id = (await pool.query('INSERT INTO classes(name,owner_account_id) VALUES($1,$2) RETURNING id', [name, owner.id])).rows[0].id;
      await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)', [id, owner.id]);
      await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [id, member.identityId]);
      return id;
    }
    const classA = await classroom(teacher, student, 'Class A'), classB = await classroom(teacher, student, 'Class B');
    const foreignClass = await classroom(otherTeacher, outsider, 'Other teacher class');
    const request = async (user, path, method = 'GET', body = {}, expected = 200) => {
      const parsed = new URL(`http://paper4.test/api/v1${path}`);
      const response = await handlePaper4({ pool, user, route: parsed.pathname.replace('/api/v1', ''), method, body, url: parsed });
      assert.ok(response, `${method} ${path} must be handled`);
      if (response.status >= 400) {
        const error = new Error(response.body?.error?.message ?? `${method} ${path} failed`);
        error.status = response.status; error.body = response.body; throw error;
      }
      if (expected !== null) assert.equal(response.status, expected, `${method} ${path}`);
      return JSON.parse(JSON.stringify(response.body));
    };
    const rejected = (user, path, method, body, status) => assert.rejects(request(user, path, method, body), error => error.status === status);
    async function finish(taskId, results = acCases) {
      const leased = (await pool.query(`UPDATE paper4_run_tasks SET state='leased',lease_id=$2,
        lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *`, [taskId, randomUUID()])).rows[0];
      const result = { status: 'AC', publicOutput: '', publicMessage: '', privateResults: results, environmentVersion: 'fixture' };
      assert.equal(await completePaper4Task(pool, leased, result), true);
      assert.equal(await completePaper4Task(pool, leased, result), false, 'worker result is accepted once');
    }
    async function validate(paperId, user = teacher) {
      const queued = await request(user, `/paper4/papers/${paperId}/reference-runs`, 'POST', { questionKey: 'Q1' }, 201);
      for (const task of queued.items) await finish(task.id);
    }
    async function draft(title = 'Public practice') {
      return request(teacher, '/paper4/papers', 'POST', { title, questions, runnerCases, referenceSolutions }, 201);
    }
    async function publish(title) {
      const created = await draft(title); await validate(created.id);
      return request(teacher, `/paper4/papers/${created.id}/publish`, 'POST');
    }
    async function completeAttempt(attemptId) {
      await request(student, `/paper4/attempts/${attemptId}/submit`, 'POST');
      const tasks = (await pool.query(`SELECT t.id FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id
        WHERE s.attempt_id=$1 AND s.origin='formal' ORDER BY s.question_key`, [attemptId])).rows;
      assert.equal(tasks.length, 1); await finish(tasks[0].id);
    }
    await run({ pool, teacher, otherTeacher, admin, student, outsider, classA, classB, foreignClass,
      request, rejected, finish, validate, draft, publish, completeAttempt });
  } finally {
    await pool.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
  }
}

const options = { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 };

test('Paper 4 catalogue publication is school-wide and classroom delivery is an independent frozen copy', options, async () => {
  await fixture(async f => {
    const { pool, teacher, otherTeacher, admin, student, outsider, classA, foreignClass, request, rejected, validate, draft } = f;
    const first = await draft('First catalogue paper'), second = await draft('Second catalogue paper');
    await validate(first.id);
    const state = async () => ({
      papers: (await pool.query('SELECT * FROM paper4_papers ORDER BY id')).rows,
      versions: (await pool.query('SELECT * FROM paper4_versions ORDER BY id')).rows,
      audit: (await pool.query("SELECT * FROM audit_events WHERE action='paper4.publish' ORDER BY id")).rows,
    });
    const before = await state();
    await rejected(teacher, '/paper4/papers/batch-publish', 'POST', { paperIds: [first.id, second.id] }, 409);
    assert.deepEqual(await state(), before, 'a failing reference check rolls back the complete batch');
    await rejected(student, '/paper4/papers/batch-publish', 'POST', { paperIds: [first.id] }, 403);
    await validate(second.id);
    const catalogue = await request(teacher, '/paper4/papers/batch-publish', 'POST', { paperIds: [second.id, first.id] });
    assert.deepEqual(catalogue.items.map(p => p.id), [second.id, first.id]);
    for (const paper of catalogue.items) {
      assert.equal(paper.deliveryKind, 'catalog'); assert.equal(paper.status, 'published');
      assert.equal(paper.classId, null); assert.equal(paper.startsAt, null); assert.equal(paper.endsAt, null);
      for (const reader of [student, outsider, otherTeacher]) {
        const visible = await request(reader, `/paper4/papers/${paper.id}`);
        assert.equal(visible.canManage, false); assert.equal(visible.referenceSolutions, undefined);
        assert.equal(visible.runnerCases, undefined); assert.equal(JSON.stringify(visible).includes('secret'), false);
        assert.equal((await request(reader, '/paper4/papers?scope=catalog')).items.some(p => p.id === paper.id), true);
      }
    }
    const source = catalogue.items.find(p => p.id === first.id);
    await rejected(otherTeacher, `/paper4/papers/${source.id}`, 'PATCH', { title: 'Hijacked source' }, 403);
    await rejected(otherTeacher, `/paper4/papers/${source.id}/reference-runs`, 'POST', { questionKey: 'Q1' }, 403);
    await rejected(otherTeacher, `/paper4/papers/${source.id}/export`, 'GET', {}, 403);
    const sourceBefore = (await pool.query('SELECT * FROM paper4_papers WHERE id=$1', [source.id])).rows[0];
    const versionBefore = (await pool.query('SELECT * FROM paper4_versions WHERE id=$1', [source.versionId])).rows[0];
    const runCountBefore = (await pool.query('SELECT count(*)::int n FROM paper4_run_tasks')).rows[0].n;
    await rejected(teacher, `/paper4/papers/${source.id}/activities`, 'POST', { classId: foreignClass, activityKind: 'practice' }, 403);
    for (const body of [{ activityKind: 'practice' }, { classId: classA, activityKind: 'exam' },
      { classId: classA, activityKind: 'exam', startsAt: new Date().toISOString() }])
      await rejected(teacher, `/paper4/papers/${source.id}/activities`, 'POST', body, 400);
    const activity = await request(teacher, `/paper4/papers/${source.id}/activities`, 'POST', { participants:[student.identityId],classId: classA, activityKind: 'practice' }, 201);
    const foreignActivity = await request(otherTeacher, `/paper4/papers/${source.id}/activities`, 'POST', { participants:[outsider.identityId],classId: foreignClass, activityKind: 'practice' }, 201);
    const adminActivity = await request(admin, `/paper4/papers/${source.id}/activities`, 'POST', { participants:[outsider.identityId],classId: foreignClass, activityKind: 'practice' }, 201);
    for (const item of [activity, foreignActivity, adminActivity]) {
      assert.equal(item.deliveryKind, 'activity'); assert.equal(item.activityKind, 'practice');
      assert.equal(item.sourcePaperId, source.id); assert.equal(item.sourceVersionId, source.versionId);
      assert.equal(item.status, 'published'); assert.equal(item.startsAt, null); assert.equal(item.endsAt, null);
      assert.deepEqual(item.questions, source.questions);
      assert.ok(Object.values(item.referenceValidation).every(v => v.status === 'AC'));
    }
    assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_run_tasks')).rows[0].n, runCountBefore,
      'unchanged source validation is inherited without fabricated reference tasks');
    const copyVersion = (await pool.query('SELECT * FROM paper4_versions WHERE id=$1', [activity.versionId])).rows[0];
    for (const field of ['definition', 'runner_cases', 'reference_solutions']) assert.deepEqual(copyVersion[field], versionBefore[field]);
    assert.deepEqual((await pool.query('SELECT * FROM paper4_papers WHERE id=$1', [source.id])).rows[0], sourceBefore);
    assert.deepEqual((await pool.query('SELECT * FROM paper4_versions WHERE id=$1', [source.versionId])).rows[0], versionBefore);
    await rejected(teacher, `/paper4/papers/${activity.id}/draft`, 'POST', {}, 409);
    await rejected(teacher, `/paper4/papers/${activity.id}`, 'PATCH', { questions: [{ ...questions[0], statement: 'Weakened class question' }], runnerCases: { Q1a: [{ id: 'public', public: true, expectedStdout: '1\n' }] }, referenceSolutions: { Q1: 'print(1)' } }, 409);
    const activityAfterRejectedEdit = await request(teacher, `/paper4/papers/${activity.id}`);
    assert.deepEqual(activityAfterRejectedEdit.questions, source.questions);
    assert.equal(activityAfterRejectedEdit.hasDraft, false, 'source-backed activities do not acquire editable content revisions');
    await assert.rejects(pool.query(`INSERT INTO paper4_versions(paper_id,version_number,title,description,class_id,definition,runner_cases,reference_solutions)
      VALUES($1,2,'Weakened copy','',$2,$3::jsonb,$4::jsonb,$5::jsonb)`,
      [activity.id, classA, JSON.stringify(versionBefore.definition), JSON.stringify({ Q1a: [runnerCases.Q1a[0]] }), JSON.stringify(referenceSolutions)]),
      /activity content is immutable/, 'the database also rejects weakening a frozen activity through another write path');
    assert.ok((await request(teacher, `/paper4/papers/${activity.id}/archive`, 'POST')).archivedAt);
    assert.equal((await request(teacher, `/paper4/papers/${activity.id}/restore`, 'POST')).archivedAt, null);
    assert.equal((await request(student, '/paper4/papers?scope=activities')).items.some(p => p.id === activity.id), true);
    assert.equal((await request(outsider, '/paper4/papers?scope=activities')).items.some(p => p.id === activity.id), false);
    assert.equal((await request(outsider, '/paper4/papers?scope=activities')).items.some(p => p.id === foreignActivity.id), true);
    await rejected(outsider, `/paper4/papers/${activity.id}`, 'GET', {}, 403);
    await rejected(outsider, `/paper4/papers/${activity.id}/attempt`, 'POST', {}, 403);
    const outsiderPractice = await request(outsider, `/paper4/papers/${source.id}/attempt`, 'POST', {}, 201);
    assert.equal(outsiderPractice.paper.classId, null);
    const revised = await request(teacher, `/paper4/papers/${source.id}/draft`, 'POST', {}, 201);
    assert.notEqual(revised.versionId, source.versionId);
    const changedQuestions = structuredClone(questions); changedQuestions[0].statement = 'Revised source statement.';
    await request(teacher, `/paper4/papers/${source.id}`, 'PATCH', { questions: changedQuestions });
    await validate(source.id); await request(teacher, `/paper4/papers/${source.id}/publish`, 'POST');
    const frozenCopy = await request(teacher, `/paper4/papers/${activity.id}`);
    assert.equal(frozenCopy.sourceVersionId, source.versionId); assert.deepEqual(frozenCopy.questions, source.questions);
    assert.ok(Object.values(frozenCopy.referenceValidation).every(v => v.status === 'AC'));
    assert.equal((await request(outsider, `/paper4/attempts/${outsiderPractice.id}`)).paper.versionId, source.versionId);
  });
});

test('free Paper 4 retries preserve submitted work and earn one canonical question reward across classroom copies', options, async () => {
  await fixture(async f => {
    const { pool, teacher, student, classA, classB, request, rejected, publish, completeAttempt } = f;
    const source = await publish('Retry and reward source');
    const activityA = await request(teacher, `/paper4/papers/${source.id}/activities`, 'POST', { participants:[student.identityId],classId: classA, activityKind: 'practice' }, 201);
    const startsAt = new Date(Date.now() - 60000).toISOString(), endsAt = new Date(Date.now() + 3600000).toISOString();
    const activityB = await request(teacher, `/paper4/papers/${source.id}/activities`, 'POST', { participants:[student.identityId],classId: classB, activityKind: 'exam', startsAt, endsAt }, 201);
    assert.equal(activityB.startsAt, startsAt); assert.equal(activityB.endsAt, endsAt);
    const starts = await Promise.all(Array.from({ length: 4 }, () => request(student, `/paper4/papers/${source.id}/attempt`, 'POST', {}, null)));
    assert.equal(new Set(starts.map(a => a.id)).size, 1, 'concurrent starts share a single active free attempt');
    const original = starts[0]; assert.equal(original.attemptNumber, 1);
    await request(student, `/paper4/attempts/${original.id}/files/Q1`, 'PATCH', { content: 'print("first submitted version")', revision: 0 });
    const classAttemptA = await request(student, `/paper4/papers/${activityA.id}/attempt`, 'POST', {}, 201);
    assert.equal(classAttemptA.files[0].content, questions[0].starterCode, 'activity does not share the free practice buffer');
    await completeAttempt(original.id);
    const frozen = await request(student, `/paper4/attempts/${original.id}`);
    assert.equal(frozen.snapshots[0].sourceCode, 'print("first submitted version")');
    await rejected(student, `/paper4/attempts/${original.id}/files/Q1`, 'PATCH', { content: 'replace old submission', revision: 1 }, 409);
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => request(student, `/paper4/papers/${source.id}/attempt`, 'POST', { restart: true }, 201)));
    const successes = attempts.filter(r => r.status === 'fulfilled');
    assert.equal(successes.length, 1, 'a simultaneous retry creates exactly one active fresh attempt');
    for (const failure of attempts.filter(r => r.status === 'rejected')) assert.equal(failure.reason.status, 409);
    const retry = successes[0].value;
    assert.notEqual(retry.id, original.id); assert.equal(retry.attemptNumber, 2);
    assert.equal(retry.files[0].content, questions[0].starterCode); assert.equal(retry.files[0].revision, 0);
    assert.equal((await request(student, `/paper4/papers/${source.id}/attempt`)).id, retry.id);
    assert.deepEqual(await request(student, `/paper4/attempts/${original.id}`), frozen, 'retry leaves old files, snapshots, results and dates intact');
    await rejected(student, `/paper4/papers/${source.id}/attempt`, 'POST', { restart: true }, 409);
    await completeAttempt(retry.id); await completeAttempt(classAttemptA.id);
    const classAttemptB = await request(student, `/paper4/papers/${activityB.id}/attempt`, 'POST', {}, 201);
    await request(student, `/paper4/attempts/${classAttemptB.id}/files/Q1`, 'PATCH', { content: 'print("exam-only work")', revision: 0 });
    await completeAttempt(classAttemptB.id);
    await rejected(student, `/paper4/papers/${activityA.id}/attempt`, 'POST', { restart: true }, 409);
    await rejected(student, `/paper4/papers/${activityB.id}/attempt`, 'POST', { restart: true }, 409);
    const awards = (await pool.query('SELECT * FROM paper4_rank_ledger WHERE identity_id=$1', [student.identityId])).rows;
    assert.equal(awards.length, 1); assert.equal(awards[0].points, 10); assert.equal(awards[0].paper_id, source.id);
    assert.equal(awards[0].attempt_id, original.id); assert.equal(awards[0].version_id, source.versionId);
    await assert.rejects(pool.query('UPDATE paper4_rank_ledger SET points=20 WHERE identity_id=$1', [student.identityId]), /immutable/);
    const points = await handleEducation({ pool, user: student, route: '/points/me', method: 'GET' });
    assert.equal(points.body.rankPoints, 10);
    for (const id of [original.id, retry.id, classAttemptA.id, classAttemptB.id]) {
      const detail = await request(student, `/paper4/attempts/${id}`);
      assert.equal(detail.rankAwards.length, 1); assert.equal(detail.rankAwards[0].points, 10);
    }
    assert.equal((await pool.query("SELECT count(*)::int n FROM paper4_attempts WHERE paper_id=$1 AND state='active'", [source.id])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n, 0, 'ordinary OJ submissions remain separate');
  });
});

test('Paper 4 catalogue migration retains legacy class access, saved files, formal results and immutable rewards', options, async () => {
  await fixture(async f => {
    const { pool, teacher, student, outsider, classA, request, rejected, finish } = f;
    const definition = { language: 'python', totalMarks: 75, questions };
    const legacyPaper = (await pool.query(`INSERT INTO paper4_papers(owner_account_id,class_id,title,status,published_at)
      VALUES($1,$2,'Legacy class paper','published',now()) RETURNING id`, [teacher.id, classA])).rows[0].id;
    const version = (await pool.query(`INSERT INTO paper4_versions(paper_id,title,description,class_id,definition,runner_cases,reference_solutions,published_at)
      VALUES($1,'Legacy class paper','',$2,$3::jsonb,$4::jsonb,$5::jsonb,now()) RETURNING id`,
      [legacyPaper, classA, JSON.stringify(definition), JSON.stringify(runnerCases), JSON.stringify(referenceSolutions)])).rows[0].id;
    await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1', [legacyPaper, version]);
    const attempt = (await pool.query(`INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at)
      VALUES($1,$2,$3,$4,'submitted',now()) RETURNING id`, [legacyPaper, version, student.identityId, student.id])).rows[0].id;
    await pool.query("INSERT INTO paper4_attempt_files(attempt_id,question_key,content,revision) VALUES($1,'Q1','saved legacy code',7)", [attempt]);
    const snapshot = (await pool.query(`INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin)
      VALUES($1,'Q1','saved legacy code',7,'formal') RETURNING id`, [attempt])).rows[0].id;
    const task = (await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id', [snapshot])).rows[0].id;
    await finish(task);
    const preserve = async () => ({
      versions: (await pool.query('SELECT * FROM paper4_versions ORDER BY id')).rows,
      snapshots: (await pool.query(`SELECT to_jsonb(s)-'luq_solution_assisted'-'luq_first_ac_amount'-'luq_reward_rule_version' AS data FROM paper4_snapshots s ORDER BY id`)).rows.map(r=>r.data),
      files: (await pool.query('SELECT * FROM paper4_attempt_files ORDER BY attempt_id,question_key')).rows,
      ledger: (await pool.query('SELECT * FROM paper4_rank_ledger ORDER BY identity_id,paper_id,question_key')).rows,
      runs: (await pool.query('SELECT * FROM paper4_runs ORDER BY id')).rows,
    });
    const before = await preserve(); assert.equal(before.ledger.length, 1);
    const attemptBefore = (await pool.query('SELECT * FROM paper4_attempts WHERE id=$1', [attempt])).rows[0];
    await pool.query('DELETE FROM schema_migrations WHERE name=ANY($1::text[])', [[upgrade,audienceUpgrade,courseLinksUpgrade,...luqUpgrades]]); await migrate(pool);
    assert.deepEqual(await preserve(), before, 'upgrade does not rewrite evidence or historical awards');
    const after = (await pool.query('SELECT * FROM paper4_attempts WHERE id=$1', [attempt])).rows[0];
    assert.deepEqual(after, { ...attemptBefore, attempt_number: 1 });
    const legacy = await request(teacher, `/paper4/papers/${legacyPaper}`);
    assert.equal(legacy.deliveryKind, 'activity'); assert.equal(legacy.activityKind, 'practice');
    assert.equal(legacy.sourcePaperId, null); assert.equal(legacy.classId, classA);
    assert.equal((await request(student, `/paper4/attempts/${attempt}`)).files[0].content, 'saved legacy code');
    assert.equal((await request(student, '/paper4/papers?scope=activities')).items.some(p => p.id === legacyPaper), true);
    assert.equal((await request(student, '/paper4/papers?scope=catalog')).items.some(p => p.id === legacyPaper), false);
    await rejected(outsider, `/paper4/papers/${legacyPaper}`, 'GET', {}, 403);
    await rejected(student, `/paper4/papers/${legacyPaper}/attempt`, 'POST', { restart: true }, 409);
  }, { beforeUpgrade: true });
});
