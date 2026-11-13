import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { canonicalHash, hashPassword } from '../src/security.mjs';
import { LEGACY_SCHOOL_ID } from '../src/schools.mjs';
import { importAcslPaper } from '../src/acsl-import.mjs';
import { handleAcsl } from '../src/acsl.mjs';
import { applyAcslProgrammingCorrections, reviseAcslProgramming } from '../src/acsl-programming-revision.mjs';

const original = JSON.parse(await readFile(new URL('../content/acsl/editions/2023-2024/Senior/contest-4/paper.json', import.meta.url), 'utf8'));
original.programming.definition.tests[4].expected = original.programming.definition.tests[4].expected.replace(/2048(?=\s*$)/, '204');
const beforeExpected = original.programming.definition.tests[4].expected;
assert.match(beforeExpected, /204\s*$/);
const afterExpected = beforeExpected.replace(/204(?=\s*$)/, '2048');
const corrections = [{ index: 4, beforeExpected, afterExpected }];
const sourceEvidence = { path: 'resource/acsl-problems/Senior/2023-2024/第四轮/c_4_ACSL 2248_sr.pdf',
  sha256: 'a2dc47170aec63b6c2c192ad1c0182f14863a8de98150a7f2adb0dbf1ba7a698', pages: [6, 12],
  note: 'The English output is truncated to 204; the Chinese page retains the complete final tile 2048.' };

test('programming corrections accept only exact reviewed expected-output substitutions', () => {
  const after = applyAcslProgrammingCorrections(original, corrections);
  assert.equal(after.programming.definition.tests[4].expected, afterExpected);
  after.programming.definition.tests[4].expected = beforeExpected;
  assert.deepEqual(after, original);
  for (const changes of [[], [...corrections, ...corrections], [{ ...corrections[0], input: 'changed' }],
    [{ ...corrections[0], weight: 100 }], [{ ...corrections[0], beforeExpected: 'stale' }],
    [{ ...corrections[0], afterExpected: beforeExpected }], [{ ...corrections[0], index: 99 }],
    [{ ...corrections[0], index: '4' }], [{ ...corrections[0], afterExpected: '\0' }]]) {
    assert.throws(() => applyAcslProgrammingCorrections(original, changes));
  }
});

test('audited programming correction updates one problem and preserves written work and pending awards',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
    const base = new URL(process.env.TEST_DATABASE_URL); assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
    const schema = `acsl_code_revision_${randomBytes(5).toString('hex')}`, manager = createPool(base.href);
    const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(scoped.href); let app, worker;
    try {
      await manager.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
      const grants = (await readFile(new URL('../grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
      await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const passwordHash = await hashPassword(randomBytes(24).toString('base64url')), users = {};
      for (const name of ['actor', 'accepted', 'pending', 'other']) {
        const identity = randomUUID();
        await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2)", [identity, name]);
        const account = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity, name, passwordHash])).rows[0];
        await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [account.id]);
        await pool.query('INSERT INTO legacy_school_identity_ownership(identity_id) VALUES($1) ON CONFLICT DO NOTHING', [identity]);
        await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [account.id]);
        users[name] = { ...account, username: name, roles: ['student'] };
      }
      const paper = await importAcslPaper(pool, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.actor.id, content: original, enablePoints: true });
      const asRole = role => { const url = new URL(scoped); url.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`); return url.href; };
      app = createPool(asRole('campus_app')); worker = createPool(asRole('campus_worker'));
      const path = `/schools/${LEGACY_SCHOOL_ID}/acsl/${paper.id}`;
      const request = (user, suffix = '', method = 'GET', body = {}) => handleAcsl({ pool: app, user: users[user],
        route: path + suffix.split('?')[0], method, body, url: new URL(`http://acsl.test${path}${suffix}`) });
      const catalog = async user => (await handleAcsl({ pool: app, user: users[user], method: 'GET',
        route: `/schools/${LEGACY_SCHOOL_ID}/acsl`, url: new URL(`http://acsl.test/schools/${LEGACY_SCHOOL_ID}/acsl`) })).body.items[0];
      const programming = (await request('accepted', '/programming')).body;
      for (const question of original.questions) await request('accepted', `/questions/${question.id}/draft`, 'PATCH',
        { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: question.correctOptionIds });
      const grade = (await request('accepted', '/submit', 'POST', { versionId: paper.versionId,
        revisions: Object.fromEntries(original.questions.map(q => [q.id, 1])) })).body;
      await request('pending', '/questions/q1/draft', 'PATCH', { versionId: paper.versionId, expectedRevision: 0, selectedOptionIds: ['A'] });
      const submit = (user, versionId = programming.versionId, publishedRevision = programming.publishedRevision) => request(user, '/programming/submissions', 'POST',
        { paperVersionId: paper.versionId, versionId, publishedRevision, requestId: randomUUID(), kind: 'submit', language: 'python', code: 'print(1)\n' });
      const acceptedJob = (await submit('accepted')).body, pendingJob = (await submit('pending')).body;
      const finish = job => worker.query(`UPDATE school_judge_jobs SET state='completed',completed_at=clock_timestamp(),
        result='{"status":"AC","score":100,"passed":5,"total":5}' WHERE school_id=$1 AND id=$2`, [LEGACY_SCHOOL_ID, job.id]);
      await finish(acceptedJob);
      const unchangedTables = ['acsl_drafts', 'acsl_paper_grades', 'acsl_grade_question_snapshots', 'acsl_point_rules',
        'acsl_point_awards', 'acsl_programming_point_receipts', 'school_judge_jobs', 'school_problems'];
      const snapshot = async () => Object.fromEntries(await Promise.all(unchangedTables.map(async table =>
        [table, (await pool.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows])));
      const before = await snapshot();
      const oldVersion = (await pool.query('SELECT * FROM school_problem_versions WHERE id=$1', [programming.versionId])).rows[0];
      const oldPaper = (await pool.query('SELECT * FROM acsl_papers WHERE id=$1', [paper.id])).rows[0];
      const args = { schoolId: LEGACY_SCHOOL_ID, actorAccountId: users.actor.id, slug: original.slug,
        expectedContentHash: canonicalHash(original), requestId: randomUUID(), reason: 'Verified truncated ACSL 2248 output', corrections, sourceEvidence };
      await t.test('dry runs and invalid/stale requests cannot write', async () => {
        const dry = await reviseAcslProgramming(pool, { ...args, dryRun: true });
        assert.equal(dry.changed, true); assert.equal(dry.afterProgrammingVersionId, null);
        assert.deepEqual(await snapshot(), before);
        assert.equal((await pool.query('SELECT count(*)::integer n FROM school_problem_versions')).rows[0].n, 1);
        await assert.rejects(reviseAcslProgramming(pool, { ...args, expectedContentHash: 'f'.repeat(64) }), /changed since review/);
        await assert.rejects(reviseAcslProgramming(pool, { ...args, corrections: [{ ...corrections[0], input: 'changed' }] }), /correction/);
        await assert.rejects(reviseAcslProgramming(pool, { ...args, sourceEvidence: { ...sourceEvidence, sha256: 'wrong' } }), /source hash/);
        assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_programming_revisions')).rows[0].n, 0);
      });
      const revisions = await Promise.all([reviseAcslProgramming(pool, args), reviseAcslProgramming(pool, args)]);
      assert.deepEqual(revisions.map(result => result.changed).sort(), [false, true]);
      const revision = revisions.find(result => result.changed);
      await t.test('only the pinned judge definition and correction log change', async () => {
        assert.deepEqual(await snapshot(), before);
        assert.equal((await pool.query('SELECT count(*)::integer n FROM school_problem_versions')).rows[0].n, 1);
        const current = (await pool.query('SELECT * FROM acsl_papers WHERE id=$1', [paper.id])).rows[0];
        assert.equal(current.version_id, oldPaper.version_id); assert.equal(current.written_revision, oldPaper.written_revision);
        assert.equal(current.programming_version_id, oldPaper.programming_version_id);
        assert.equal(revision.afterProgrammingVersionId, oldVersion.id);
        assert.deepEqual(current.definition, applyAcslProgrammingCorrections(original, corrections));
        const next = (await pool.query('SELECT * FROM school_problem_versions WHERE id=$1', [revision.afterProgrammingVersionId])).rows[0];
        assert.equal(next.draft_revision, oldVersion.draft_revision + 1);
        next.definition.tests[4].expected = beforeExpected;
        assert.deepEqual(next.definition, oldVersion.definition, 'test IDs, inputs, weights, resources and all other judge fields remain exact');
        const audit = (await pool.query('SELECT * FROM acsl_programming_revisions')).rows[0];
        assert.deepEqual(audit.source_evidence, sourceEvidence); assert.deepEqual(audit.corrections, corrections);
        assert.deepEqual(audit.before_judge_definition, oldVersion.definition);
        assert.equal(audit.after_judge_definition.tests[4].expected, afterExpected);
        for (const versionId of [programming.versionId, revision.afterProgrammingVersionId]) {
          await assert.rejects(pool.query('UPDATE school_problem_versions SET definition=definition WHERE id=$1', [versionId]), /IMMUTABLE/);
          await assert.rejects(pool.query('DELETE FROM school_problem_versions WHERE id=$1', [versionId]), /IMMUTABLE/);
        }
        await assert.rejects(pool.query("UPDATE acsl_programming_revisions SET reason='tamper'"));
        await assert.rejects(pool.query('DELETE FROM acsl_programming_revisions'));
        await assert.rejects(reviseAcslProgramming(pool, { ...args, reason: 'different request' }), /request ID/);
        await assert.rejects(reviseAcslProgramming(pool, { ...args, requestId: randomUUID() }), /changed since review/);
      });
      await t.test('historical progress and owned submissions stay accessible, new submissions require current version', async () => {
        const current = (await request('accepted', '/programming')).body;
        assert.equal(current.solved, true); assert.equal(current.attempts, 1); assert.equal(current.versionId, revision.afterProgrammingVersionId);
        const reviewed = (await request('accepted')).body;
        assert.equal(reviewed.gradeId, grade.gradeId); assert.equal(reviewed.score, grade.score); assert.equal(reviewed.programmingPointsAwarded, 10);
        for (const [key, value] of Object.entries(await catalog('accepted'))) assert.deepEqual(value, reviewed[key], key);
        const history = (await request('accepted', '/programming/submissions')).body;
        assert.equal(history.total, 1); assert.equal(history.items[0].id, acceptedJob.id);
        assert.equal((await request('accepted', `/programming/submissions/${acceptedJob.id}`)).body.versionId, programming.versionId);
        assert.equal((await request('pending', `/programming/submissions/${pendingJob.id}`)).body.state, 'queued');
        assert.equal((await request('accepted', `/programming/submissions?view=resume&versionId=${revision.afterProgrammingVersionId}`)).body.submission.code, 'print(1)\n');
        await assert.rejects(request('other', `/programming/submissions/${acceptedJob.id}`), error => error.status === 404);
        await assert.rejects(submit('other'), error => error.status === 409 && error.code === 'PROBLEM_UPDATED');
        const fresh = (await submit('other', revision.afterProgrammingVersionId, current.publishedRevision)).body;
        const payload = (await pool.query('SELECT version_id,payload FROM school_judge_jobs WHERE id=$1', [fresh.id])).rows[0];
        assert.equal(payload.version_id, revision.afterProgrammingVersionId); assert.equal(payload.payload.tests[4].expected, afterExpected);
        const queued = (await pool.query('SELECT payload FROM school_judge_jobs WHERE id=$1', [pendingJob.id])).rows[0];
        assert.equal(queued.payload.tests[4].expected, beforeExpected, 'previously queued jobs retain their immutable test snapshot');
      });
      await t.test('an old queued result still settles its original award exactly once', async () => {
        await finish(pendingJob); await finish(pendingJob);
        const result = (await request('pending', `/programming/submissions/${pendingJob.id}`)).body;
        assert.equal(result.status, 'AC'); assert.equal(result.practicePointsAwarded, 10);
        assert.equal((await request('pending', '/programming')).body.solved, true);
        assert.equal((await pool.query('SELECT count(*)::integer n FROM acsl_point_awards WHERE job_id=$1', [pendingJob.id])).rows[0].n, 1);
        const receipt = (await pool.query('SELECT * FROM acsl_programming_point_receipts WHERE job_id=$1', [pendingJob.id])).rows[0];
        assert.equal(receipt.version_id, paper.versionId); assert.equal(receipt.settled_status, 'AC');
      });
      await t.test('recursive lineage retains both ancestors and excludes an unaudited version of the same problem', async () => {
        const currentPaper = (await pool.query('SELECT * FROM acsl_papers WHERE id=$1', [paper.id])).rows[0];
        // A deliberately unlinked QA snapshot must not become student history
        // merely because it shares the same problem ID.
        const alienVersion = (await pool.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
          SELECT school_id,problem_id,99,definition FROM school_problem_versions WHERE id=$1 RETURNING id`,
          [revision.afterProgrammingVersionId])).rows[0];
        const alienJob = (await pool.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result)
          SELECT school_id,problem_id,$2,account_id,$3,'unlinked-qa-version',kind,access_context,payload,state,result
          FROM school_judge_jobs WHERE id=$1 RETURNING id`, [acceptedJob.id, alienVersion.id, randomUUID()])).rows[0];
        await pool.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result)
          SELECT school_id,problem_id,$2,$4,$3,'other-unlinked-qa-version',kind,access_context,payload,state,result
          FROM school_judge_jobs WHERE id=$1`, [acceptedJob.id, alienVersion.id, randomUUID(), users.other.id]);
        assert.equal((await request('accepted', '/programming/submissions')).body.total, 1);
        await assert.rejects(request('accepted', `/programming/submissions/${alienJob.id}`), error => error.status === 404);
        // A second expected-only revision (whitespace-equivalent under tokens)
        // exercises a genuine two-hop ancestry chain without changing grading.
        const next = await reviseAcslProgramming(pool, { ...args, expectedContentHash: currentPaper.content_hash,
          requestId: randomUUID(), reason: 'QA two-generation expected-output lineage',
          corrections: [{ index: 4, beforeExpected: afterExpected, afterExpected: afterExpected + '\n' }] });
        const current = (await request('accepted', '/programming')).body;
        assert.equal(current.versionId, next.afterProgrammingVersionId);
        assert.equal(current.solved, true); assert.equal(current.attempts, 1);
        assert.equal((await request('accepted', `/programming/submissions/${acceptedJob.id}`)).body.versionId, programming.versionId);
        const pendingHistory = (await request('pending', '/programming/submissions')).body;
        assert.equal(pendingHistory.items[0].id, pendingJob.id);
        const otherHistory = (await request('other', '/programming/submissions')).body;
        assert.equal(otherHistory.total, 1, 'the intermediate reviewed version is retained as well');
        assert.equal((await catalog('accepted')).programmingSolved, true, 'catalog retains audited ancestor AC');
        assert.equal((await catalog('other')).programmingSolved, false, 'pending jobs and an unaudited AC do not become catalog AC');
        await assert.rejects(submit('other', revision.afterProgrammingVersionId), error => error.status === 409);
      });
      await t.test('only tenant-scoped lineage columns are readable by the application; worker has no audit access', async () => {
        await assert.rejects(app.query('SELECT * FROM acsl_programming_revisions'), error => error.code === '42501');
        await assert.rejects(worker.query('SELECT school_id FROM acsl_programming_revisions'), error => error.code === '42501');
        await assert.rejects(app.query('DELETE FROM acsl_programming_revisions'), error => error.code === '42501');
        await assert.rejects(app.query('UPDATE acsl_papers SET programming_version_id=programming_version_id'), error => error.code === '42501');
        const lineages = await transaction(app, async db => {
          await db.query("SELECT set_config('campus.school_id',$1,true)", [LEGACY_SCHOOL_ID]);
          return (await db.query('SELECT before_programming_version_id,after_programming_version_id FROM acsl_programming_revisions')).rows;
        });
        assert.equal(lineages.length, 2);
        const foreign = await transaction(app, async db => {
          await db.query("SELECT set_config('campus.school_id',$1,true)", [randomUUID()]);
          return (await db.query('SELECT before_programming_version_id FROM acsl_programming_revisions')).rows;
        });
        assert.equal(foreign.length, 0);
      });
    } finally {
      await app?.end(); await worker?.end(); await pool.end();
      await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
    }
  });
