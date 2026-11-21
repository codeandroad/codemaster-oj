// Prior mastery contributes to the assignment grade without creating a
// submission, changing its original context, or settling any reward. Existing
// cross-activity credit retains its original version scope; only work received
// after live references were introduced gains problem-level cross-activity credit.
const effectiveDue = 'greatest(assignment.due_at,part.extended_due_at)';
const assignmentPassingResult = `
 previous.identity_id=part.identity_id AND previous.problem_id=ap.problem_id
 AND (previous.assignment_id=assignment.id
  OR COALESCE(previous.original_problem_version_id,previous.version_id) IN (
    COALESCE(ap.original_problem_version_id,ap.version_id),COALESCE(ap.original_prior_problem_version_id,ap.prior_version_id))
  OR previous.created_at>=(SELECT applied_at FROM schema_migrations WHERE name='098_live_problem_activity_results.sql'))
 AND (assignment.required_language IS NULL OR previous.language=assignment.required_language)
 AND (assignment.cancelled_at IS NULL OR previous.created_at<=assignment.cancelled_at)
 AND previous.kind='submit' AND previous.status='AC' AND previous.score=100
 AND (previous.timed_attempt_id IS NULL OR EXISTS (
  SELECT 1 FROM timed_first_ac_candidates candidate
  JOIN timed_practices practice ON practice.id=candidate.practice_id
  WHERE candidate.submission_id=previous.id AND practice.results_published_at IS NOT NULL
 ))
`;

export const assignmentPassingSubmission = `${assignmentPassingResult} AND previous.created_at<=${effectiveDue}`;
export const assignmentPassingProgressSubmission = assignmentPassingResult;

export async function assignmentGradeRows(db, assignment, identityId, { includeLate = false } = {}) {
 return loadAssignmentGradeRows(db, [assignment.id], identityId, includeLate);
}

export async function assignmentProgressById(db, assignmentIds, identityId) {
 if (!assignmentIds.length) return new Map();
 const progress = new Map(assignmentIds.map(id => [id, {completedProblems:0,totalProblems:0,completed:false}]));
 for (const grade of await loadAssignmentGradeRows(db, assignmentIds, identityId, true)) {
  const summary = progress.get(grade.assignment_id);
  summary.totalProblems++;
  if (grade.status === 'AC') summary.completedProblems++;
 }
 for (const summary of progress.values()) {
  summary.completed = summary.totalProblems > 0 && summary.completedProblems === summary.totalProblems;
 }
 return progress;
}

// Use the current school assignment and roster when reading older numeric
// receipts. The immutable school on the receipt survives account relinking.
export async function schoolAssignmentReceiptGrades(db, activity, identityId, includeLate) {
 return loadAssignmentGradeRows(db, [activity.id], identityId, includeLate, activity.school_id);
}

async function loadAssignmentGradeRows(db, assignmentIds, identityId, includeLate = false, schoolId = null) {
 const sources = schoolId ? `WITH
  assignments AS (SELECT id,ends_at AS due_at,cancelled_at,required_language FROM school_activities WHERE school_id=$4 AND kind='assignment'),
  assignment_participants AS (SELECT activity_id AS assignment_id,identity_id,exempt,extended_due_at FROM school_activity_participants WHERE school_id=$4),
  assignment_problems AS (SELECT activity_id AS assignment_id,problem_id,version_id,prior_version_id,original_problem_version_id,
    original_prior_problem_version_id,points,position FROM school_activity_problems WHERE school_id=$4),
  identities AS (SELECT id,name FROM school_identities WHERE school_id=$4),
  receipts AS NOT MATERIALIZED (SELECT id,school_id,assignment_id,identity_id,problem_id,version_id,original_problem_version_id,
    kind,status,score,language,created_at,timed_attempt_id FROM submissions WHERE school_id=$4 AND identity_id=$2)` : '';
 const receipts = schoolId ? 'receipts' : 'submissions';
 const withinCutoff = schoolId ? `coalesce(${effectiveDue},'infinity'::timestamptz)` : effectiveDue;
 return (await db.query(`${sources}
  SELECT part.assignment_id,i.id identity_id,i.name,ap.problem_id,ap.points,
   CASE WHEN credit.id IS NOT NULL THEN NULL ELSE s.id END submission_id,
   CASE WHEN credit.id IS NOT NULL THEN 100 ELSE s.score END score,
   CASE WHEN credit.id IS NOT NULL THEN 'AC' ELSE COALESCE(s.status,pending.status) END status,
   (credit.id IS NULL AND pending.status IS NOT NULL) unresolved,
   CASE WHEN credit.id IS NULL THEN pending.status END pending_status,
   (credit.id IS NOT NULL) credited_ac,credit.created_at credited_at,
   attempts.total assignment_attempts,attempts.in_time eligible_attempts,(attempts.total>0) has_assignment_submission
  FROM assignment_participants part JOIN identities i ON i.id=part.identity_id
  JOIN assignments assignment ON assignment.id=part.assignment_id
  JOIN assignment_problems ap ON ap.assignment_id=part.assignment_id
  LEFT JOIN LATERAL (
   SELECT count(*)::integer total, count(*) FILTER(WHERE $3::boolean OR created_at<=${withinCutoff})::integer in_time FROM ${receipts}
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
  ) attempts ON true
  LEFT JOIN LATERAL (
   SELECT id,score,status FROM ${receipts}
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND ($3::boolean OR created_at<=${withinCutoff}) AND score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error')
   ORDER BY score DESC,created_at,id LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
   SELECT status FROM ${receipts} WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit' AND ($3::boolean OR created_at<=${withinCutoff})
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND status IN ('Waiting','Judging','System Error') ORDER BY created_at DESC LIMIT 1
  ) pending ON true
  LEFT JOIN LATERAL (
   SELECT previous.id,previous.created_at FROM ${receipts} previous
   WHERE COALESCE(s.score,0)<100
    AND previous.assignment_id IS DISTINCT FROM part.assignment_id
    AND ${assignmentPassingProgressSubmission}
    ${includeLate ? '' : `AND previous.created_at<=${withinCutoff}`}
   ORDER BY previous.created_at,previous.id LIMIT 1
  ) credit ON true
  WHERE part.assignment_id=ANY($1::uuid[]) AND NOT part.exempt AND ($2::uuid IS NULL OR part.identity_id=$2)
  ORDER BY i.name,ap.position
 `, schoolId ? [assignmentIds,identityId,includeLate,schoolId] : [assignmentIds,identityId,includeLate])).rows;
}

// Both views use the same grading rules. Only the receipt cutoff differs.
export function assignmentGradeSummaries(rows) {
 const students = new Map();
 for (const row of rows) {
  let student = students.get(row.identity_id);
  if (!student) {
   student = { identityId:row.identity_id, name:row.name, score:0, maxScore:0, pending:false, hasScore:false, problems:[] };
   students.set(row.identity_id, student);
  }
  const points = Number(row.points), score = row.score === null ? null : Number(row.score);
  student.score += score === null ? 0 : score * points / 100;
  student.maxScore += points;
  student.pending ||= row.unresolved;
  student.hasScore ||= score !== null;
  student.problems.push({ problemId:row.problem_id, submissionId:row.submission_id ? `SUB${row.submission_id}` : null,
   score, status:row.status || 'NotSubmitted', pending:row.unresolved, pendingStatus:row.pending_status,
   completionSource:row.credited_ac ? 'other_entry' : null, creditedAt:row.credited_at ?? null,
   hasAssignmentSubmission:row.has_assignment_submission, assignmentAttempts:Number(row.assignment_attempts) });
 }
 return [...students.values()].map(({ hasScore, ...student }) => ({ ...student,
  score:student.pending && !hasScore ? null : Math.round(student.score * 100) / 100 }));
}
