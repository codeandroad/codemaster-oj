import { courseAdmissionNotificationRows, inboxItem, readCourseAdmissionNotification, setAccountNotificationRecipient } from './account-notifications.mjs';
import { transaction } from './db.mjs';
import { legacyCourseStaffRole } from './legacy-public-course.mjs';
import { currentCourseAdmissionsJoin } from './public-learning.mjs';
import { LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { fail, uuid } from './security.mjs';

const response = body => ({ status: 200, body });

async function inboxRecipient(db, { user, notificationSchoolId: requestedSchool }) {
  const schoolId = requestedSchool ? uuid(requestedSchool, '学校 ID') : LEGACY_SCHOOL_ID;
  if (requestedSchool && schoolId === LEGACY_SCHOOL_ID) fail(404, 'NOT_FOUND', '通知入口不存在');
  await lockSchoolTeaching(db, schoolId, { shared: true });
  const role = requestedSchool
    ? await schoolRole(db, schoolId, user.id)
    : await legacyCourseStaffRole(db, user.id);
  if (role !== 'school_admin' && role !== 'teacher') fail(403, 'FORBIDDEN', '需要教师或本校管理员权限');
  if (role === 'school_admin') {
    await db.query(`SELECT set_config('campus.school_id',$1,true),
      set_config('campus.course_admission_school_id',$1,true),
      set_config('campus.staff_notification_account_id',$2,true)`, [schoolId, user.id]);
  }
  await setAccountNotificationRecipient(db, user.id);
  return { schoolId, accountId: user.id, canReview: role === 'school_admin' };
}

// Only pending applications for an open, current edition require action.
// Use the approved title and never include applicant details in the inbox.
const pendingApplications = `SELECT a.id,l.course_id,course.title,a.created_at
  FROM public_course_applications a
  JOIN public_course_listings l ON l.school_id=a.school_id AND l.id=a.listing_id
    AND l.revision=a.revision AND l.access_generation=a.access_generation
  ${currentCourseAdmissionsJoin}
  WHERE a.school_id=$1 AND a.status='pending'`;

export function listStaffCourseNotifications(ctx, { page, pageSize }) {
  return transaction(ctx.pool, async db => {
    const { schoolId, accountId, canReview } = await inboxRecipient(db, ctx);

    const { rows } = await db.query(`WITH notices AS (
      SELECT a.id,'course_application'::text AS kind,
        jsonb_build_object('schoolId',$1::uuid,'courseId',a.course_id,'courseTitle',a.title) AS data,
        a.created_at,r.read_at
      FROM (${pendingApplications}) a
      LEFT JOIN staff_course_notification_reads r
        ON r.school_id=$1 AND r.account_id=$2 AND r.application_id=a.id
      WHERE $5::boolean
      UNION ALL ${courseAdmissionNotificationRows}
    )
    SELECT totals.total, totals.unread, items.*
    FROM (
      SELECT count(*)::int total, count(*) FILTER(WHERE read_at IS NULL)::int unread FROM notices
    ) totals
    LEFT JOIN (
      SELECT * FROM notices ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4
    ) items ON true
    ORDER BY items.created_at DESC,items.id DESC`, [schoolId, accountId, pageSize, (page - 1) * pageSize, canReview]);
    const items = rows.filter(row => row.id).map(inboxItem);
    return response({ items, total: rows[0].total, unreadCount: rows[0].unread, page, pageSize });
  });
}

export function markStaffCourseNotificationsRead(ctx, notificationId = null) {
  return transaction(ctx.pool, async db => {
    const { schoolId, accountId, canReview } = await inboxRecipient(db, ctx);
    if (canReview) {
      const { rows: [inserted] } = await db.query(`INSERT INTO staff_course_notification_reads(school_id,account_id,application_id)
        SELECT $1,$2,a.id FROM (${pendingApplications}) a
        WHERE ($3::uuid IS NULL OR a.id=$3)
        ORDER BY a.id
        ON CONFLICT DO NOTHING
        RETURNING read_at`, [schoolId, accountId, notificationId]);
      if (notificationId) {
        // A concurrent read can win the insert. Return the original timestamp.
        const receipt = inserted ?? (await db.query(`SELECT r.read_at
          FROM (${pendingApplications}) a
          JOIN staff_course_notification_reads r
            ON r.school_id=$1 AND r.account_id=$2 AND r.application_id=a.id
          WHERE a.id=$3`, [schoolId, accountId, notificationId])).rows[0];
        if (receipt) return response({ ok: true, readAt: receipt.read_at });
      }
    }
    const decision = await readCourseAdmissionNotification(db, notificationId);
    if (notificationId && decision) return response({ ok: true, readAt: decision.read_at });
    if (notificationId) fail(404, 'NOT_FOUND', '通知不存在');
    return response({ ok: true });
  });
}
