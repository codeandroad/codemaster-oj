import { courseAdmissionNotificationRows, inboxItem, readCourseAdmissionNotification, setAccountNotificationRecipient } from './account-notifications.mjs';
import { transaction } from './db.mjs';
import { lockSchoolTeaching, schoolRole } from './schools.mjs';
import { fail, uuid } from './security.mjs';
import { guestbookNotificationRows, readGuestbookNotification } from './guestbook-notifications.mjs';
import { insertSchoolAssignmentReminders } from './assignment-changes.mjs';

const response = body => ({ status: 200, body });

export async function notifyStudent(db, { identityId, kind, sourceKey, data }) {
  await db.query(`INSERT INTO student_system_notifications(school_id,school_identity_id,kind,source_key,data)
    SELECT school_id,id,$2,$3,$4 FROM school_identities WHERE id=$1 ON CONFLICT DO NOTHING`, [identityId,kind,sourceKey,data]);
}

async function inboxRecipient(db, { user, notificationSchoolId: requestedSchool }) {
  const schoolId = uuid(requestedSchool, '学校 ID');
    await lockSchoolTeaching(db, schoolId, { shared: true });
    if (await schoolRole(db, schoolId, user.id) !== 'student') {
      fail(403, 'FORBIDDEN', '只有学生可以查看通知');
    }
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    const { rows: [identity] } = await db.query(`SELECT id FROM school_identities
      WHERE school_id=$1 AND account_id=$2 AND kind='student' AND archived_at IS NULL`, [schoolId, user.id]);
  const identityId = identity?.id ?? null;
  await db.query(`SELECT set_config('campus.notification_school_id',$1,true),
    set_config('campus.notification_identity_id',coalesce($2,''),true)`, [schoolId, identityId]);
  await setAccountNotificationRecipient(db, user.id);
  return { schoolId, identityId };
}

const visibleSystemNotification = `n.school_id=$1 AND n.school_identity_id=$2
  AND n.kind<>'assignment_reminder'
  AND (n.kind<>'teacher_feedback' OR n.data->>'timedPracticeId' IS NULL
    OR EXISTS(SELECT 1 FROM school_activities timed
      WHERE timed.school_id=n.school_id AND timed.id::text=n.data->>'timedPracticeId' AND timed.results_published_at IS NOT NULL))`;

const unreadReminderNotification = `n.school_id=$1 AND n.school_identity_id=$2 AND n.kind='assignment_reminder' AND n.read_at IS NULL`;

export async function listStudentNotifications(ctx, { page, pageSize }) {
  return transaction(ctx.pool, async db => {
    const { schoolId, identityId } = await inboxRecipient(db, ctx);
    if (identityId) await insertSchoolAssignmentReminders(db, schoolId, identityId);
    const totals = (await db.query(`SELECT count(*)::int total,
      count(*) FILTER(WHERE read_at IS NULL)::int unread FROM (
      SELECT n.read_at FROM student_system_notifications n WHERE ${visibleSystemNotification} OR ${unreadReminderNotification}
      UNION ALL SELECT read_at FROM course_admission_notifications
      UNION ALL SELECT read_at FROM (${guestbookNotificationRows(false,'$2')}) guestbook
    ) visible`, [schoolId, identityId])).rows[0];
    const { rows } = await db.query(`SELECT * FROM (
      SELECT n.id,n.kind,n.data,n.created_at,n.read_at FROM student_system_notifications n
      WHERE ${visibleSystemNotification} OR ${unreadReminderNotification}
      UNION ALL ${courseAdmissionNotificationRows}
      UNION ALL ${guestbookNotificationRows(false,'$2')}
    ) visible ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,
    [schoolId, identityId, pageSize, (page-1)*pageSize]);
    const items = rows.map(inboxItem);
    return response({ items, total: totals.total, unreadCount: totals.unread, page, pageSize });
  });
}

export async function markStudentNotificationsRead(ctx, notificationId = null) {
  return transaction(ctx.pool, async db => {
    const { schoolId, identityId } = await inboxRecipient(db, ctx);
    const { rows: [system] } = await db.query(`UPDATE student_system_notifications n
      SET read_at=coalesce(n.read_at,clock_timestamp())
      WHERE (${visibleSystemNotification} OR ${unreadReminderNotification}) AND ($3::uuid IS NULL OR n.id=$3)
        AND ($3::uuid IS NOT NULL OR n.read_at IS NULL)
      RETURNING n.read_at`, [schoolId, identityId, notificationId]);
    if (notificationId && system) return response({ ok: true, readAt: system.read_at });

    if (identityId) {
      const guestbook = await readGuestbookNotification(db, notificationId, false, identityId);
      if (notificationId && guestbook) return response({ ok: true, readAt: guestbook.read_at });
    }

    const decision = await readCourseAdmissionNotification(db, notificationId);
    if (notificationId && decision) return response({ ok: true, readAt: decision.read_at });
    if (notificationId) fail(404, 'NOT_FOUND', '通知不存在');
    return response({ ok: true });
  });
}
