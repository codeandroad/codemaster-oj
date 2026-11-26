import { assignmentPassingProgressSubmission } from './assignment-grades.mjs';
import { schoolActivityJobVisibleSql } from './school-activities.mjs';
import { fail, field } from './security.mjs';

export function assignmentChange(body) {
  const reason = field(body.reason, 'Reason', { max: 2000 });
  if (typeof body.exempt === 'boolean' && body.dueAt === undefined) {
    return { action: body.exempt ? 'exempted' : 'reinstated', exempt: body.exempt, reason };
  }
  if (body.exempt !== undefined || typeof body.dueAt !== 'string') fail(400, 'VALIDATION', 'Choose a deadline or an exemption.');
  const dueAt = new Date(body.dueAt);
  if (!Number.isFinite(+dueAt) || +dueAt <= Date.now()) fail(400, 'VALIDATION', 'The new deadline must be in the future.');
  return { action: 'extended', dueAt, reason };
}

export async function notifySchoolAssignmentChange(db, activity, action, { identityId = null, reason = null } = {}) {
  await db.query(`INSERT INTO student_system_notifications(school_id,school_identity_id,kind,source_key,data)
    SELECT a.school_id,p.identity_id,'assignment_change',concat(a.id,':',a.revision),
      jsonb_strip_nulls(jsonb_build_object('assignmentId',a.id,'activityTitle',a.title,'action',$3::text,'reason',$5::text,
        'dueAt',CASE WHEN $3 IN ('assigned','extended','reinstated') THEN greatest(a.ends_at,p.extended_due_at) END))
    FROM school_activities a JOIN school_activity_participants p ON p.school_id=a.school_id AND p.activity_id=a.id
    WHERE a.school_id=$1 AND a.id=$2 AND ($4::uuid IS NULL OR p.identity_id=$4)
      AND (NOT p.exempt OR $3='exempted')
    ON CONFLICT DO NOTHING`, [activity.school_id, activity.id, action, identityId, reason]);
}

const reminderHorizon = `interval '48 hours'`;

export async function insertSchoolAssignmentReminders(db, schoolId, identityId) {
  await db.query(`INSERT INTO student_system_notifications(school_id,school_identity_id,kind,source_key,data)
    SELECT assignment.school_id,part.identity_id,'assignment_reminder',concat('reminder:',assignment.id),
      jsonb_build_object('assignmentId',assignment.id,'activityTitle',assignment.title,'dueAt',greatest(assignment.ends_at,part.extended_due_at))
    FROM school_activities assignment JOIN school_activity_participants part
      ON part.school_id=assignment.school_id AND part.activity_id=assignment.id AND part.identity_id=$2 AND NOT part.exempt
    WHERE assignment.school_id=$1 AND assignment.kind='assignment' AND assignment.state='Published' AND assignment.cancelled_at IS NULL
      AND greatest(assignment.ends_at,part.extended_due_at)>clock_timestamp()
      AND greatest(assignment.ends_at,part.extended_due_at)<=clock_timestamp()+${reminderHorizon}
      AND EXISTS(SELECT 1 FROM school_activity_problems ap WHERE ap.school_id=assignment.school_id AND ap.activity_id=assignment.id
        AND NOT EXISTS(SELECT 1 FROM submissions previous WHERE previous.school_id=assignment.school_id
          AND ${assignmentPassingProgressSubmission})
        AND NOT EXISTS(SELECT 1 FROM school_assignment_public_credit credit
          WHERE (credit.school_id,credit.activity_id,credit.identity_id,credit.problem_id)=(part.school_id,part.activity_id,part.identity_id,ap.problem_id))
        AND NOT EXISTS(SELECT 1 FROM school_judge_jobs j
          WHERE j.school_id=assignment.school_id AND j.identity_id=part.identity_id AND j.problem_id=ap.problem_id AND j.version_id=ap.version_id
            AND j.access_context='school' AND j.kind='submit' AND j.state='completed' AND j.result->>'status'='AC'
            AND (assignment.required_language IS NULL OR coalesce(j.payload->>'language','python')=assignment.required_language)
            AND ${schoolActivityJobVisibleSql('j')}))
    ON CONFLICT DO NOTHING`, [schoolId, identityId]);
}
