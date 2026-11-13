import { transaction } from './db.mjs';
import { assignmentRequiredLanguage } from './assignment-authoring.mjs';
import { assertRequiredLanguage } from './course-language-policy.mjs';
import { parseFunctionInput } from './function-input.mjs';
import { LANGUAGES } from './languages.mjs';
import { LEGACY_SCHOOL_ID } from './legacy-school.mjs';
import { metadataPage } from './problem-submissions.mjs';
import { bytes, canonicalHash, enumValue, fail, integer, uuid } from './security.mjs';
import { submissionCaseFeedback, submissionMeasurements, submissionMeasurementsSql } from './submission-feedback.mjs';
import { assertJudgeAdmission } from './system.mjs';
import { resolveLiveProblemVersion, assertLiveProblemVersion } from './live-problem-version.mjs';

const reply = (body, status = 200) => ({ status, body });
const jobStatus = `CASE t.state WHEN 'queued' THEN 'Waiting' WHEN 'leased' THEN 'Judging'
 WHEN 'failed' THEN 'System Error' ELSE coalesce(r.status,'System Error') END`;
const previewJobs = `FROM legacy_assignment_preview_submissions p
 JOIN judge_tasks t ON t.preview_submission_id=p.id
 LEFT JOIN judge_runs r ON r.task_id=t.id AND r.lease_id=t.lease_id`;
const previewOwner = 'p.assignment_id=$1 AND p.account_id=$2';

async function result(db, scope, id) {
  const { rows: [job] } = await db.query(`SELECT p.*, v.title, t.problem_snapshot,
    ${jobStatus} status,r.score,r.passed,r.total,r.public_output,r.public_message,r.private_results,m.*
    ${previewJobs} JOIN problem_versions v ON v.id=p.version_id
    CROSS JOIN LATERAL (${submissionMeasurementsSql}) m
    WHERE ${previewOwner} AND p.id=$3`, [...scope, id]);
  if (!job) fail(404, 'NOT_FOUND', '试做提交不存在。');
  return reply({
    id: job.id, preview: true, problemId: job.problem_id, problemTitle: job.title, versionId: job.version_id,
    kind: job.kind, language: job.language, status: job.status, score: job.score == null ? null : Number(job.score),
    passed: job.passed, total: job.total, code: job.code, createdAt: job.created_at,
    publicOutput: job.public_output, message: job.public_message,
    ...submissionMeasurements(job),
    testResults: submissionCaseFeedback(job, job.problem_snapshot?.version, job.private_results),
  });
}

async function enqueue(db, { a, user, body, config, submitLimiter, version, requiredLanguage }) {
  const kind = enumValue(body.kind, ['submit','samples','custom'], '试做类型');
  const language = enumValue(body.language ?? 'python', LANGUAGES, '代码语言');
  const code = bytes(body.code, '代码', config.codeLimit);
  if (!code.trim()) fail(400, 'VALIDATION', '请先输入代码。');
  const customInput = kind === 'custom' ? bytes(body.customInput ?? '', '自定义输入') : null;
  const requestId = uuid(body.requestId, '请求 ID');
  const versionId = uuid(body.versionId, '题目版本');
  const revision = integer(body.revision, 0, 2147483647, '作业修订版本');
  const hash = canonicalHash({ assignmentId: a.id, problemId: version.problem_id, revision, versionId, kind, language, code, customInput });
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`assignment-preview:${user.id}:${requestId}`]);
  const { rows: [old] } = await db.query('SELECT id,request_hash FROM legacy_assignment_preview_submissions WHERE account_id=$1 AND request_id=$2', [user.id, requestId]);
  if (old) {
    if (old.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '相同请求键对应的内容不同。');
    return reply({ id: old.id }, 202);
  }
  assertLiveProblemVersion(versionId,version.id);
  if (revision !== a.edit_revision) fail(409, 'STALE_ASSIGNMENT', '作业已更新，请重新进入试做。');
  assertRequiredLanguage(language, requiredLanguage);
  if (kind === 'samples' && !version.samples.some(sample => sample.enabled !== false)) {
    fail(409, 'NO_PUBLIC_SAMPLES', '此版本没有启用的公开样例。');
  }
  if (kind === 'custom' && version.mode === 'function') {
    try { parseFunctionInput(customInput); }
    catch { fail(400, 'VALIDATION', '函数自测输入须为 JSON 参数数组或合法的 args/kwargs 对象。'); }
  }
  submitLimiter.check(user.id);
  await assertJudgeAdmission(db);
  const { rows: [{ pending }] } = await db.query(`SELECT count(*)::int pending
    FROM legacy_assignment_preview_submissions p JOIN judge_tasks t ON t.preview_submission_id=p.id
    WHERE p.account_id=$1 AND t.state IN ('queued','leased')`, [user.id]);
  if (pending >= 5) fail(429, 'TOO_MANY_PENDING', '最多同时等待 5 个试做运行。');
  const { rows: [{ id }] } = await db.query(`INSERT INTO legacy_assignment_preview_submissions
    (assignment_id,assignment_revision,account_id,problem_id,version_id,kind,language,code,custom_input,request_id,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [a.id, revision, user.id, version.problem_id, version.id, kind, language, code, customInput, requestId, hash]);
  await db.query("INSERT INTO judge_tasks(version_id,purpose,preview_submission_id) VALUES($1,'assignment_preview',$2)", [version.id, id]);
  return reply({ id }, 202);
}

export async function handleLegacyAssignmentPreview(ctx, { submitLimiter, assignmentProblemRows, projectProblem }) {
  const { pool, user, route, method, url, helpers } = ctx;
  const match = route.match(/^\/assignments\/([^/]+)\/preview(?:\/(problems|jobs)\/([^/]+)(\/submissions)?)?$/);
  if (!match) return null;
  const [, rawAssignment, target, targetId, submissions] = match;
  const assignmentId = uuid(rawAssignment, '作业 ID');
  return transaction(pool, async db => {
    await db.query('SELECT id FROM assignments WHERE id=$1 FOR SHARE', [assignmentId]);
    const a = await helpers.assignmentAccess(db, user, assignmentId);
    if (!a.canManage || a.school_id !== LEGACY_SCHOOL_ID || a.archived_at) fail(404, 'NOT_FOUND', '此作业不可试做。');
    const scope = [a.id, user.id];
    if (method === 'GET' && target === 'jobs' && !submissions) return result(db, scope, uuid(targetId, '试做提交 ID'));
    if (!target && method === 'GET') {
      const requiredLanguage = await assignmentRequiredLanguage(db, a);
      const problems = (await assignmentProblemRows(db, a)).map(p => ({
        problemId: p.problem_id, versionId: p.version_id, title: p.title, points: Number(p.points),
      }));
      const { rows } = await db.query(`SELECT p.version_id, max(r.score) score
        ${previewJobs} WHERE ${previewOwner} AND p.assignment_revision=$3 AND p.kind='submit' AND t.state='completed'
        AND ($4::text IS NULL OR p.language=$4)
        GROUP BY p.version_id`, [...scope, a.edit_revision, requiredLanguage]);
      const scores = new Map(rows.map(row => [row.version_id, row.score]));
      return reply({
        id: a.id, title: a.title, description: a.description, dueAt: a.due_at, revision: a.edit_revision, requiredLanguage,
        problems: problems.map(problem => {
          const score = scores.get(problem.versionId);
          return { ...problem, score: score == null ? null : Math.round(Number(score) * problem.points) / 100 };
        }),
      });
    }
    if (target !== 'problems') return null;
    const problemId = uuid(targetId, '题目 ID');
    if (!(await db.query('SELECT 1 FROM assignment_problems WHERE assignment_id=$1 AND problem_id=$2',[a.id,problemId])).rowCount) fail(404, 'NOT_FOUND', '此题不在作业中或尚未发布。');
    const enqueueing = method === 'POST' && Boolean(submissions);
    const requiredLanguage = await assignmentRequiredLanguage(db, a, { lock: enqueueing });
    const version = await resolveLiveProblemVersion(db, problemId, {allowArchived:method==='GET'});
    if (enqueueing) return enqueue(db, { ...ctx, a, submitLimiter, version, requiredLanguage });
    if (method !== 'GET') return null;
    if (submissions) {
      return reply(await metadataPage(db, `SELECT p.id::text,p.id received_id,p.account_id actor_key,p.created_at,
        p.language,${jobStatus} status,true is_own,$5::text display_name,r.private_results
        ${previewJobs} WHERE ${previewOwner} AND p.assignment_revision=$3 AND p.problem_id=$4 AND p.kind='submit' AND p.version_id=$6`,
      [...scope, a.edit_revision, problemId, user.name, version.id], url));
    }
    return reply({ problem: await projectProblem(db, version), revision: a.edit_revision, requiredLanguage });
  });
}
