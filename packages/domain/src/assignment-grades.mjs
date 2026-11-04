// Prior mastery contributes to the assignment grade without creating a
// submission, changing its original context, or settling any reward.
export async function assignmentGradeRows(db, assignment, identityId) {
 return (await db.query(`
  SELECT i.id identity_id,i.name,ap.problem_id,ap.points,
   CASE WHEN credit.id IS NOT NULL THEN NULL ELSE s.id END submission_id,
   CASE WHEN credit.id IS NOT NULL THEN 100 ELSE s.score END score,
   CASE WHEN credit.id IS NOT NULL THEN 'AC' ELSE COALESCE(s.status,pending.status) END status,
   (credit.id IS NULL AND pending.status IS NOT NULL) unresolved,
   CASE WHEN credit.id IS NULL THEN pending.status END pending_status,
   (credit.id IS NOT NULL) credited_ac,credit.created_at credited_at,
   attempts.total assignment_attempts,(attempts.total>0) has_assignment_submission
  FROM assignment_participants part JOIN identities i ON i.id=part.identity_id
  JOIN assignment_problems ap ON ap.assignment_id=part.assignment_id
  LEFT JOIN LATERAL (
   SELECT count(*)::integer total FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND version_id=ap.version_id AND kind='submit'
  ) attempts ON true
  LEFT JOIN LATERAL (
   SELECT id,score,status FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND version_id=ap.version_id AND kind='submit'
    AND created_at<=$2 AND score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error')
   ORDER BY score DESC,created_at,id LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
   SELECT status FROM submissions WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND version_id=ap.version_id AND kind='submit' AND created_at<=$2
    AND status IN ('Waiting','Judging','System Error') ORDER BY created_at DESC LIMIT 1
  ) pending ON true
  LEFT JOIN LATERAL (
   SELECT previous.id,previous.created_at FROM submissions previous
   WHERE COALESCE(s.score,0)<100 AND previous.identity_id=part.identity_id
    AND previous.problem_id=ap.problem_id AND previous.version_id=ap.version_id
    AND previous.assignment_id IS DISTINCT FROM part.assignment_id
    AND previous.kind='submit' AND previous.status='AC' AND previous.score=100
    AND previous.created_at<=$2
    AND (previous.timed_attempt_id IS NULL OR EXISTS (
     SELECT 1 FROM timed_first_ac_candidates candidate
     JOIN timed_practices practice ON practice.id=candidate.practice_id
     WHERE candidate.submission_id=previous.id AND practice.results_published_at IS NOT NULL
    ))
   ORDER BY previous.created_at,previous.id LIMIT 1
  ) credit ON true
  WHERE part.assignment_id=$1 AND NOT part.exempt AND ($3::uuid IS NULL OR part.identity_id=$3)
  ORDER BY i.name,ap.position
 `, [assignment.id, assignment.due_at, identityId])).rows;
}
