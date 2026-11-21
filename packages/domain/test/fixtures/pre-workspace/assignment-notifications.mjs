const reminderHorizon = `interval '48 hours'`;
import { assignmentPassingProgressSubmission } from '../../../src/assignment-grades.mjs';
import { LEGACY_SCHOOL_ID } from './legacy-school.mjs';
export async function notifyLegacyAssignmentChange(db, assignmentId, action, { identityId = null, previousDueAt = null, reason = null } = {}) {
  await db.query(`INSERT INTO student_system_notifications(school_id,legacy_identity_id,kind,source_key,data)
    SELECT $1,p.identity_id,'assignment_change',concat(a.id,':',a.edit_revision),
      jsonb_strip_nulls(jsonb_build_object('assignmentId',a.id,'activityTitle',a.title,'action',$3::text,'reason',$5::text,
        'dueAt',CASE WHEN $3 IN ('extended','reinstated') THEN greatest(a.due_at,p.extended_due_at) END))
    FROM assignments a JOIN assignment_participants p ON p.assignment_id=a.id
    WHERE a.id=$2 AND a.state='Published' AND ($4::uuid IS NULL OR p.identity_id=$4)
      AND (NOT p.exempt OR $3='exempted')
      AND ($6::timestamptz IS NULL OR greatest(a.due_at,p.extended_due_at)>greatest($6,p.extended_due_at))
    ON CONFLICT DO NOTHING`, [LEGACY_SCHOOL_ID, assignmentId, action, identityId, reason, previousDueAt]);
}

export async function notifyLegacyAssignmentAssigned(db, assignmentId) {
  await db.query(`INSERT INTO student_system_notifications(school_id,legacy_identity_id,kind,source_key,data)
    SELECT $1,p.identity_id,'assignment_change',concat(a.id,':assigned:',a.edit_revision),
      jsonb_build_object('assignmentId',a.id,'activityTitle',a.title,'action','assigned','dueAt',a.due_at)
    FROM assignments a JOIN assignment_participants p ON p.assignment_id=a.id
    WHERE a.id=$2 AND a.state='Published' AND NOT p.exempt
    ON CONFLICT DO NOTHING`, [LEGACY_SCHOOL_ID, assignmentId]);
}

export async function insertLegacyAssignmentReminders(db, identityId) {
  await db.query(`INSERT INTO student_system_notifications(school_id,legacy_identity_id,kind,source_key,data)
    SELECT $1,part.identity_id,'assignment_reminder',concat('reminder:',assignment.id),
      jsonb_build_object('assignmentId',assignment.id,'activityTitle',assignment.title,'dueAt',greatest(assignment.due_at,part.extended_due_at))
    FROM assignments assignment JOIN assignment_participants part ON part.assignment_id=assignment.id AND part.identity_id=$2 AND NOT part.exempt
    WHERE assignment.state='Published' AND assignment.cancelled_at IS NULL AND assignment.archived_at IS NULL
      AND greatest(assignment.due_at,part.extended_due_at)>clock_timestamp()
      AND greatest(assignment.due_at,part.extended_due_at)<=clock_timestamp()+${reminderHorizon}
      AND EXISTS(SELECT 1 FROM assignment_problems ap WHERE ap.assignment_id=assignment.id
        AND NOT EXISTS(SELECT 1 FROM submissions previous
          WHERE previous.identity_id=part.identity_id AND previous.problem_id=ap.problem_id
            AND ${assignmentPassingProgressSubmission}))
    ON CONFLICT DO NOTHING`, [LEGACY_SCHOOL_ID, identityId]);
}
