import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { canonicalHash, fail } from './security.mjs';
import { publicProblemMetadata, publicStatementSourceHash } from './problem-public-statements.mjs';
import { assertJudgeAdmission, getSettings } from './system.mjs';

export async function draftValidation(db, version) {
 if (!version.edit_draft) return { status: version.validation_status, message: version.validation_message };
 if (!version.draft_validation_task_id) return { status: 'Incomplete', message: null };
 const { rows: [result] } = await db.query(`SELECT CASE t.state WHEN 'queued' THEN 'Waiting' WHEN 'leased' THEN 'Judging'
  ELSE COALESCE(r.status,'System Error') END status,r.public_message message
  FROM judge_tasks t LEFT JOIN judge_runs r ON r.task_id=t.id AND r.lease_id=t.lease_id WHERE t.id=$1`, [version.draft_validation_task_id]);
 return result ?? { status: 'Waiting', message: null };
}

export function requireDraftRevision(version, expectedRevision) {
 if (expectedRevision !== version.edit_revision) fail(409, 'REVISION_CONFLICT', '题目草稿已更新，请重新载入后再操作');
}

export async function queueDraftValidation(db, version) {
 const { rows: [task] } = await db.query(`INSERT INTO judge_tasks(version_id,purpose,draft_revision)
  VALUES($1,'validation',$2) RETURNING id`, [version.id,version.edit_revision]);
 await db.query('UPDATE problem_versions SET draft_validation_task_id=$2 WHERE id=$1', [version.id,task.id]);
}

export async function saveProblemDraft(db, user, version, input, expectedRevision, audit) {
 requireDraftRevision(version, expectedRevision);
 const settings = input.incomplete ? await getSettings(db) : await assertJudgeAdmission(db);
 if (!input.incomplete && (input.timeLimitMs > settings.runtime.maxProblemCpuMs || input.memoryLimitMb > settings.runtime.maxProblemMemoryMb))
  fail(400, 'RESOURCE_LIMIT', '题目资源上限超过当前运行环境设置');
 const draft = {
  title: input.title, mode: input.mode, statement: input.statement, function_name: input.functionName,
  starter_code: input.starterCode, starter_codes: input.starterCodes, samples: input.samples,
  time_limit_ms: input.timeLimitMs, memory_limit_mb: input.memoryLimitMb, comparator: input.comparator,
  reference_code: input.referenceCode, reference_language: input.referenceLanguage, tags: input.tags,
  source: input.source, metadata: input.metadata,
  tests: input.tests.map((test,position)=>({ ...test,id:randomUUID(),position })),
 };
 const { rows: [saved] } = await db.query(`UPDATE problem_versions SET edit_draft=$2,edit_revision=edit_revision+1,
  draft_validation_task_id=NULL,draft_review_status=NULL,draft_review_at=NULL,draft_review_reason=NULL,draft_presentation=NULL
  WHERE id=$1 RETURNING *`, [version.id,JSON.stringify(draft)]);
 if (!input.incomplete) await queueDraftValidation(db, saved);
 await audit(db,user.id,'problem.draft_save','problem_version',version.id,{revision:saved.edit_revision});
}

export async function prepareDraftPublication(db, version) {
 if ((await draftValidation(db,version)).status !== 'AC') fail(409,'NOT_VALIDATED','参考解答须通过全部测试后才能发布');
 if (version.draft_presentation) return;
 const { rows: [current] } = await db.query('SELECT * FROM problem_public_statements WHERE version_id=$1', [version.id]);
 if (!current) return;
 const source = {...version,...version.edit_draft};
 const equivalentStatement = source.statement === version.statement || source.statement.trim() === current.statement.trim();
 if (!equivalentStatement || !isDeepStrictEqual(publicProblemMetadata(source.metadata,{complete:true}),publicProblemMetadata(version.metadata,{complete:true})))
  fail(409,'PRESENTATION_REVIEW_REQUIRED','题面已修改，请先审核本次草稿的公开英文题面');
 const sourceHash=publicStatementSourceHash(source);
 const contentHash=canonicalHash({versionId:version.id,language:current.language,statement:current.statement,metadata:current.metadata,sourceHash});
 await db.query('UPDATE problem_versions SET draft_presentation=$2 WHERE id=$1',[version.id,JSON.stringify({
  statement:current.statement,metadata:current.metadata,sourceHash,contentHash,reviewerAccountId:current.reviewer_account_id,
 })]);
}

export async function publishProblemDraft(db, user, version, {schoolApproval, reviewRequired=false}) {
 if(reviewRequired&&version.draft_review_status==='pending')return;
 await prepareDraftPublication(db, version);
 if (reviewRequired) {
  await db.query(`UPDATE problem_versions SET draft_review_status='pending',draft_review_at=clock_timestamp(),draft_review_reason=NULL WHERE id=$1`, [version.id]);
 } else {
  await db.query('SELECT promote_problem_draft($1,$2,$3,$4)',[version.id,version.edit_revision,user.id,schoolApproval]);
 }
}

export async function validateProblemDraft(db, version, expectedRevision) {
 requireDraftRevision(version,expectedRevision);
 const { status } = await draftValidation(db,version);
 if (status === 'Incomplete') fail(409,'INCOMPLETE','请补齐题面、参考解答、样例与正式测试并保存草稿后验证');
 if (version.draft_review_status==='pending') fail(409,'REVIEW_PENDING','草稿正在审核，请先保存修改');
 if (!['Waiting','Judging'].includes(status)) {
  await assertJudgeAdmission(db);
  await queueDraftValidation(db,version);
 }
 return {versionId:version.id,editRevision:version.edit_revision,validationStatus:'Waiting'};
}
