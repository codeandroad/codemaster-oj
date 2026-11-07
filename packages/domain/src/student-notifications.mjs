import { courseAdmissionNotificationRows, inboxItem, readCourseAdmissionNotification, setAccountNotificationRecipient } from './account-notifications.mjs';
import { transaction } from './db.mjs';
import { LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { fail, uuid } from './security.mjs';

const response = body => ({ status: 200, body });

export async function notifyStudent(db, { identityId, kind, sourceKey, data }) {
  await db.query(`INSERT INTO student_system_notifications(school_id, legacy_identity_id, kind, source_key, data)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [LEGACY_SCHOOL_ID, identityId, kind, sourceKey, data]);
}

async function inboxRecipient(db, { user, notificationSchoolId: requestedSchool }) {
  const schoolId = requestedSchool ? uuid(requestedSchool, '学校 ID') : LEGACY_SCHOOL_ID;
  let identityId;
  if (schoolId === LEGACY_SCHOOL_ID) {
    if (requestedSchool) fail(404, 'NOT_FOUND', '通知入口不存在');
    if (!user.roles.includes('student')) fail(403, 'FORBIDDEN', '只有学生可以查看通知');
    const { rows: [identity] } = await db.query(`SELECT i.id FROM identities i JOIN accounts a ON a.identity_id=i.id
      JOIN account_roles r ON r.account_id=a.id AND r.role='student'
      WHERE a.id=$1 AND i.kind='student' AND i.archived_at IS NULL
        AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
      FOR SHARE OF i,a,r`, [user.id]);
    if (!identity) fail(403, 'FORBIDDEN', '只有学生可以查看通知');
    identityId = identity.id;
  } else {
    await lockSchoolTeaching(db, schoolId, { shared: true });
    if (await schoolRole(db, schoolId, user.id) !== 'student') {
      fail(403, 'FORBIDDEN', '只有学生可以查看通知');
    }
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    const { rows: [identity] } = await db.query(`SELECT id FROM school_identities
      WHERE school_id=$1 AND account_id=$2 AND kind='student' AND archived_at IS NULL`, [schoolId, user.id]);
    identityId = identity?.id ?? null;
  }
  await db.query(`SELECT set_config('campus.notification_school_id',$1,true),
    set_config('campus.notification_identity_id',coalesce($2,''),true)`, [schoolId, identityId]);
  await setAccountNotificationRecipient(db, user.id);
  return { schoolId, identityId };
}

const visibleSystemNotification = `n.school_id=$1 AND COALESCE(n.legacy_identity_id,n.school_identity_id)=$2
  AND (n.kind<>'teacher_feedback' OR n.data->>'timedPracticeId' IS NULL
    OR EXISTS(SELECT 1 FROM timed_practices timed
      WHERE timed.id::text=n.data->>'timedPracticeId' AND timed.results_published_at IS NOT NULL))`;

const visibleGuestbookNotification = `FROM student_guestbook_notifications n
  JOIN student_guestbook_messages m ON m.id=n.message_id AND m.deleted_at IS NULL
  JOIN accounts a ON a.id=m.author_account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
  JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
  WHERE n.recipient_identity_id=$2`;

export async function listStudentNotifications(ctx, { page, pageSize }) {
  return transaction(ctx.pool, async db => {
    const { schoolId, identityId } = await inboxRecipient(db, ctx);
    const legacy = schoolId === LEGACY_SCHOOL_ID;
    const totals = (await db.query(`SELECT count(*)::int total,
      count(*) FILTER(WHERE read_at IS NULL)::int unread FROM (
      SELECT n.read_at FROM student_system_notifications n WHERE ${visibleSystemNotification}
      UNION ALL SELECT read_at FROM course_admission_notifications
      ${legacy ? `UNION ALL SELECT n.read_at ${visibleGuestbookNotification}` : ''}
    ) visible`, [schoolId, identityId])).rows[0];
    const { rows } = await db.query(`SELECT * FROM (
      SELECT n.id,n.kind,n.data,n.created_at,n.read_at FROM student_system_notifications n
      WHERE ${visibleSystemNotification}
      UNION ALL ${courseAdmissionNotificationRows}
      ${legacy ? `UNION ALL SELECT n.id,'guestbook',
        jsonb_build_object('messageId',n.message_id,'profileIdentityId',n.recipient_identity_id,
          'body',m.body,'authorNickname',COALESCE(NULLIF(btrim(a.nickname),''),'同学')),
        n.created_at,n.read_at ${visibleGuestbookNotification}` : ''}
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
      WHERE ${visibleSystemNotification} AND ($3::uuid IS NULL OR n.id=$3)
        AND ($3::uuid IS NOT NULL OR n.read_at IS NULL)
      RETURNING n.read_at`, [schoolId, identityId, notificationId]);
    if (notificationId && system) return response({ ok: true, readAt: system.read_at });

    if (schoolId === LEGACY_SCHOOL_ID) {
      const { rows: [guestbook] } = await db.query(`UPDATE student_guestbook_notifications n
        SET read_at=coalesce(n.read_at,clock_timestamp())
        FROM student_guestbook_messages m
        WHERE n.message_id=m.id AND m.deleted_at IS NULL AND n.recipient_identity_id=$1
          AND ($2::uuid IS NULL OR n.id=$2) AND ($2::uuid IS NOT NULL OR n.read_at IS NULL)
        RETURNING n.read_at`, [identityId, notificationId]);
      if (notificationId && guestbook) return response({ ok: true, readAt: guestbook.read_at });
    }

    const decision = await readCourseAdmissionNotification(db, notificationId);
    if (notificationId && decision) return response({ ok: true, readAt: decision.read_at });
    if (notificationId) fail(404, 'NOT_FOUND', '通知不存在');
    return response({ ok: true });
  });
}
