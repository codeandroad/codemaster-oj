import { transaction } from './db.mjs';
import { activeAccount } from './schools.mjs';
import { fail } from './security.mjs';

export function setAccountNotificationRecipient(db, accountId) {
  return db.query("SELECT set_config('campus.account_notification_account_id',$1,true)", [accountId]);
}

export const courseAdmissionNotificationRows = `SELECT id,'course_application_result'::text AS kind,
  jsonb_build_object('listingId',listing_id,'courseTitle',course_title,'outcome',outcome) AS data,
  created_at,read_at
  FROM course_admission_notifications`;

export function inboxItem(row) {
  return { ...row.data, id: row.id, kind: row.kind, createdAt: row.created_at, readAt: row.read_at };
}

export async function readCourseAdmissionNotification(db, notificationId) {
  const { rows: [item] } = await db.query(`UPDATE course_admission_notifications
    SET read_at=coalesce(read_at,clock_timestamp())
    WHERE ($1::uuid IS NULL OR id=$1) AND ($1::uuid IS NOT NULL OR read_at IS NULL)
    RETURNING read_at`, [notificationId]);
  return item;
}

export function listAccountNotifications({ pool, user }, { page, pageSize }) {
  return transaction(pool, async db => {
    await activeAccount(db, user.id);
    await setAccountNotificationRecipient(db, user.id);
    const { rows: [totals] } = await db.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE read_at IS NULL)::int unread FROM course_admission_notifications`);
    const { rows } = await db.query(`${courseAdmissionNotificationRows}
      ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
    return { status: 200, body: {
      items: rows.map(inboxItem), total: totals.total, unreadCount: totals.unread, page, pageSize,
    } };
  });
}

export function markAccountNotificationsRead({ pool, user }, notificationId = null) {
  return transaction(pool, async db => {
    await activeAccount(db, user.id);
    await setAccountNotificationRecipient(db, user.id);
    const item = await readCourseAdmissionNotification(db, notificationId);
    if (notificationId && !item) fail(404, 'NOT_FOUND', '通知不存在');
    return { status: 200, body: notificationId ? { ok: true, readAt: item.read_at } : { ok: true } };
  });
}
