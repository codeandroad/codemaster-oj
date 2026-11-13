// Prior mastery contributes to the assignment grade without creating a
// submission, changing its original context, or settling any reward. Existing
// cross-activity credit retains its original version scope; only work received
// after live references were introduced gains problem-level cross-activity credit.
export const assignmentPassingSubmission = `
 previous.identity_id=part.identity_id AND previous.problem_id=ap.problem_id
 AND (previous.assignment_id=assignment.id
  OR COALESCE(previous.original_problem_version_id,previous.version_id) IN (
    COALESCE(ap.original_problem_version_id,ap.version_id),COALESCE(ap.original_prior_problem_version_id,ap.prior_version_id))
  OR previous.created_at>=(SELECT applied_at FROM schema_migrations WHERE name='098_live_problem_activity_results.sql'))
 AND (assignment.required_language IS NULL OR previous.language=assignment.required_language)
 AND previous.kind='submit' AND previous.status='AC' AND previous.score=100 AND previous.created_at<=assignment.due_at
 AND (previous.timed_attempt_id IS NULL OR EXISTS (
  SELECT 1 FROM timed_first_ac_candidates candidate
  JOIN timed_practices practice ON practice.id=candidate.practice_id
  WHERE candidate.submission_id=previous.id AND practice.results_published_at IS NOT NULL
 ))
`;

export async function assignmentGradeRows(db, assignment, identityId) {
 return loadAssignmentGradeRows(db, [assignment.id], identityId);
}

export async function assignmentProgressById(db, assignmentIds, identityId) {
 if (!assignmentIds.length) return new Map();
 const progress = new Map(assignmentIds.map(id => [id, {completedProblems:0,totalProblems:0,completed:false}]));
 for (const grade of await loadAssignmentGradeRows(db, assignmentIds, identityId)) {
  const summary = progress.get(grade.assignment_id);
  summary.totalProblems++;
  if (grade.status === 'AC') summary.completedProblems++;
 }
 for (const summary of progress.values()) {
  summary.completed = summary.totalProblems > 0 && summary.completedProblems === summary.totalProblems;
 }
 return progress;
}

async function loadAssignmentGradeRows(db, assignmentIds, identityId) {
 return (await db.query(`
  SELECT part.assignment_id,i.id identity_id,i.name,ap.problem_id,ap.points,
   CASE WHEN credit.id IS NOT NULL THEN NULL ELSE s.id END submission_id,
   CASE WHEN credit.id IS NOT NULL THEN 100 ELSE s.score END score,
   CASE WHEN credit.id IS NOT NULL THEN 'AC' ELSE COALESCE(s.status,pending.status) END status,
   (credit.id IS NULL AND pending.status IS NOT NULL) unresolved,
   CASE WHEN credit.id IS NULL THEN pending.status END pending_status,
   (credit.id IS NOT NULL) credited_ac,credit.created_at credited_at,
   attempts.total assignment_attempts,(attempts.total>0) has_assignment_submission
  FROM assignment_participants part JOIN identities i ON i.id=part.identity_id
  JOIN assignments assignment ON assignment.id=part.assignment_id
  JOIN assignment_problems ap ON ap.assignment_id=part.assignment_id
  LEFT JOIN LATERAL (
   SELECT count(*)::integer total FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
  ) attempts ON true
  LEFT JOIN LATERAL (
   SELECT id,score,status FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND created_at<=assignment.due_at AND score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error')
   ORDER BY score DESC,created_at,id LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
   SELECT status FROM submissions WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit' AND created_at<=assignment.due_at
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND status IN ('Waiting','Judging','System Error') ORDER BY created_at DESC LIMIT 1
  ) pending ON true
  LEFT JOIN LATERAL (
   SELECT previous.id,previous.created_at FROM submissions previous
   WHERE COALESCE(s.score,0)<100
    AND previous.assignment_id IS DISTINCT FROM part.assignment_id
    AND ${assignmentPassingSubmission}
   ORDER BY previous.created_at,previous.id LIMIT 1
  ) credit ON true
  WHERE part.assignment_id=ANY($1::uuid[]) AND NOT part.exempt AND ($2::uuid IS NULL OR part.identity_id=$2)
  ORDER BY i.name,ap.position
 `, [assignmentIds, identityId])).rows;
}
