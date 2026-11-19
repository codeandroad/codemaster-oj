import { LEGACY_SCHOOL_ID } from './schools.mjs';
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

export async function notifySchoolAssignmentChange(db, activity, action, { identityId = null, reason = null } = {}) {
  await db.query(`INSERT INTO student_system_notifications(school_id,school_identity_id,kind,source_key,data)
    SELECT a.school_id,p.identity_id,'assignment_change',concat(a.id,':',a.revision),
      jsonb_strip_nulls(jsonb_build_object('assignmentId',a.id,'activityTitle',a.title,'action',$3::text,'reason',$5::text,
        'dueAt',CASE WHEN $3 IN ('extended','reinstated') THEN greatest(a.ends_at,p.extended_due_at) END))
    FROM school_activities a JOIN school_activity_participants p ON p.school_id=a.school_id AND p.activity_id=a.id
    WHERE a.school_id=$1 AND a.id=$2 AND ($4::uuid IS NULL OR p.identity_id=$4)
      AND (NOT p.exempt OR $3='exempted')
    ON CONFLICT DO NOTHING`, [activity.school_id, activity.id, action, identityId, reason]);
}
