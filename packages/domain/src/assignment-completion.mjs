import { assignmentPassingSubmission } from './assignment-grades.mjs';
import { fail, submissionId } from './security.mjs';

// Derive the event from the first visible, qualifying result for each
// problem. A repeat AC cannot replace that first result or reopen the celebration.
async function completedAssignments(db, identityId, assignmentIds, matchedSubmissionId = null) {
 if (!assignmentIds.length) return [];
 const {rows} = await db.query(`
  WITH problem_progress AS (
   SELECT assignment.id,assignment.title,first_ac.id AS submission_id,first_ac.assignment_id AS source_assignment_id,
    first_ac.ready_at,first_ac.recorded,attempt.first_at
   FROM assignments assignment
   JOIN assignment_participants part ON part.assignment_id=assignment.id AND part.identity_id=$2 AND NOT part.exempt
   JOIN assignment_problems ap ON ap.assignment_id=assignment.id
   LEFT JOIN LATERAL (
    SELECT previous.id,previous.assignment_id,
     (result.recorded_at IS NOT NULL OR practice.results_published_at IS NOT NULL) AS recorded,
     greatest(assignment.published_at,previous.created_at,result.recorded_at,practice.results_published_at) AS ready_at
    FROM submissions previous
    LEFT JOIN luq_submission_results result ON result.submission_id=previous.id AND result.status='AC'
    LEFT JOIN timed_first_ac_candidates candidate ON candidate.submission_id=previous.id
    LEFT JOIN timed_practices practice ON practice.id=candidate.practice_id
    WHERE ${assignmentPassingSubmission}
    ORDER BY ready_at,previous.id LIMIT 1
   ) first_ac ON true
   LEFT JOIN LATERAL (
    SELECT min(s.created_at) AS first_at FROM submissions s
    WHERE s.assignment_id=assignment.id AND s.identity_id=part.identity_id AND s.problem_id=ap.problem_id
     AND s.kind='submit' AND s.created_at<=assignment.due_at
   ) attempt ON true
   WHERE assignment.id=ANY($1::uuid[]) AND assignment.state='Published'
    AND ($3::bigint IS NULL OR assignment.archived_at IS NULL)
  ), completed AS (
   SELECT DISTINCT ON (id) id,title,submission_id,source_assignment_id,ready_at,recorded,
    count(*) OVER (PARTITION BY id)::int AS total_problems,
    min(first_at) OVER (PARTITION BY id) AS first_at
   FROM problem_progress
   WHERE id NOT IN (SELECT id FROM problem_progress WHERE submission_id IS NULL)
   ORDER BY id,ready_at DESC,submission_id DESC
  )
  SELECT c.*,COALESCE(first_ac.amount,0) AS first_ac_reward,COALESCE(award.amount,0) AS assignment_reward
  FROM completed c
  LEFT JOIN LATERAL (
   SELECT sum(entry.delta) AS amount
   FROM submissions s
   JOIN luq_first_ac_claims claim ON claim.identity_id=s.identity_id AND claim.subject_key='problem:'||s.problem_id
    AND claim.source_key='submission:'||s.id
   JOIN luq_ledger entry ON entry.id=claim.ledger_id AND entry.identity_id=s.identity_id AND entry.kind='first_ac'
   WHERE s.assignment_id=c.id AND s.identity_id=$2 AND s.kind='submit'
  ) first_ac ON true
  LEFT JOIN LATERAL (
   SELECT entry.delta AS amount
   FROM luq_activity_awards activity
   JOIN luq_ledger entry ON entry.id=activity.ledger_id AND entry.identity_id=activity.identity_id AND entry.kind='activity'
   WHERE activity.activity_type='assignment' AND activity.activity_id=c.id AND activity.identity_id=$2
  ) award ON true
  WHERE $3::bigint IS NULL OR c.submission_id=$3
  ORDER BY c.ready_at,c.id
 `, [assignmentIds, identityId, matchedSubmissionId]);
 return rows.map(row => {
  const firstAc = Number(row.first_ac_reward), assignment = Number(row.assignment_reward);
  // Older results may lack a verdict timestamp. Their receipt still orders
  // completion events, but cannot establish the measured submission window.
  const elapsed = row.recorded && row.first_at ? row.ready_at.getTime() - row.first_at.getTime() : -1;
  return {
   id:row.id,title:row.title,
   completion:{
    completedAt:row.ready_at,
    completedBySubmissionId:row.source_assignment_id === row.id ? `SUB${row.submission_id}` : null,
    elapsedMs:elapsed >= 0 ? elapsed : null,
    completedProblems:row.total_problems,totalProblems:row.total_problems,
    rewards:{firstAc,assignment,total:firstAc+assignment},
   },
  };
 });
}

export async function learnerAssignmentCompletion(db, assignmentId, identityId) {
 return (await completedAssignments(db, identityId, [assignmentId]))[0]?.completion ?? null;
}

export async function learnerSubmissionAssignmentCompletions(db, user, id) {
 if (!user.roles.includes('student')) fail(403,'FORBIDDEN','需要学生权限');
 const own = (await db.query('SELECT problem_id,version_id,assignment_id,created_at,kind,status FROM submissions WHERE id=$1 AND identity_id=$2',
  [submissionId(id), user.identityId])).rows[0];
 if (!own) fail(404,'NOT_FOUND','提交不存在');
 if (own.kind !== 'submit' || own.status !== 'AC') return [];
 const candidates = (await db.query(`
  SELECT a.id
  FROM assignment_participants part
  JOIN assignments a ON a.id=part.assignment_id
  JOIN assignment_problems p ON p.assignment_id=a.id
  WHERE part.identity_id=$1 AND NOT part.exempt AND a.state='Published' AND a.archived_at IS NULL
   AND p.problem_id=$2 AND (a.id=$4::uuid OR $3 IN (p.version_id,p.prior_version_id)
    OR $5::timestamptz>=(SELECT applied_at FROM schema_migrations WHERE name='098_live_problem_activity_results.sql'))
 `, [user.identityId, own.problem_id, own.version_id, own.assignment_id, own.created_at])).rows;
 return completedAssignments(db, user.identityId, candidates.map(a => a.id), submissionId(id));
}
