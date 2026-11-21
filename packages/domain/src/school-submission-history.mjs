import { fail } from './security.mjs';
import { loadSubmissionResult } from './submission-feedback.mjs';

// The original receipt IDs and judge evidence stay immutable. Result release is
// controlled by the owning school's current activity, including after migration.
export const receiptActivityJoin = `LEFT JOIN LATERAL submission_activity_context(s.original_submission_id) original_context ON true
 LEFT JOIN timed_attempts ta ON ta.id=COALESCE(s.timed_attempt_id,original_context.timed_attempt_id)
 LEFT JOIN school_activities activity ON activity.school_id=s.school_id AND activity.id=ta.practice_id`;
export const receiptVisible = '((s.original_submission_id IS NULL OR original_context.resolved) AND (COALESCE(s.timed_attempt_id,original_context.timed_attempt_id) IS NULL OR activity.results_published_at IS NOT NULL))';

export async function ownSchoolReceipt(db, schoolId, accountId, id) {
 const row=(await db.query(`SELECT s.*,ta.id AS receipt_timed_attempt_id,v.title,v.mode AS problem_mode,${receiptVisible} results_visible
  FROM submissions s JOIN problem_versions v ON v.id=s.version_id ${receiptActivityJoin}
  WHERE s.school_id=$1 AND s.account_id=$2 AND s.id=$3`,[schoolId,accountId,id])).rows[0];
 if(!row)fail(404,'NOT_FOUND','Submission not found.');
 const status=row.results_visible?row.status:'Submitted';
 const feedback=await loadSubmissionResult(db,row,{...row,status},{revealFormalFailure:row.results_visible&&!row.receipt_timed_attempt_id});
 const reviews=row.results_visible?(await db.query('SELECT note,created_at AS "createdAt" FROM review_entries WHERE submission_id=$1 ORDER BY created_at,id',[id])).rows:[];
 return {id:'SUB'+row.id,problemId:row.problem_id,versionId:row.version_id,problemTitle:row.title,code:row.code,language:row.language,
  kind:row.kind,state:status==='Waiting'?'queued':status==='Judging'?'leased':'completed',createdAt:row.created_at,status,
  score:row.results_visible&&row.score!==null?Number(row.score):null,passed:row.results_visible?row.passed:0,total:row.results_visible?row.total:0,
  message:row.results_visible?row.public_message:'Results will be available after publication.',resultsVisible:row.results_visible,
  runtimeMs:feedback.runtimeMs,memoryKb:feedback.memoryKb,caseFeedback:feedback.testResults,reviews};
}
