const source = practice => `FROM student_guestbook_messages m
 JOIN accounts a ON a.id=m.author_account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
 JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
 JOIN ${practice?"identities":"school_identities"} profile ON profile.id=m.profile_identity_id AND profile.archived_at IS NULL
 JOIN accounts owner ON ${practice?"owner.identity_id=profile.id":"owner.id=profile.account_id"} AND owner.disabled_at IS NULL AND owner.binding_released_at IS NULL
  AND (m.practice_profile_account_id IS NULL OR owner.id=m.practice_profile_account_id)
 LEFT JOIN public_practice_preferences pref ON pref.account_id=m.practice_profile_account_id
 LEFT JOIN student_guestbook_messages root ON root.id=m.thread_id AND root.deleted_at IS NULL
 LEFT JOIN accounts root_author ON root_author.id=root.author_account_id
  AND root_author.disabled_at IS NULL AND root_author.binding_released_at IS NULL
 LEFT JOIN identities root_identity ON root_identity.id=root_author.identity_id AND root_identity.archived_at IS NULL`;

function visible(practice, recipient) {
 return `m.id=n.message_id AND m.deleted_at IS NULL
  AND (m.thread_id IS NULL OR root_identity.id IS NOT NULL)
  AND ${practice ? `m.practice_profile_account_id IS NOT NULL
    AND (pref.profile_enabled OR m.practice_profile_account_id=${recipient})` : `m.practice_profile_account_id IS NULL
    AND EXISTS(SELECT 1 FROM school_identities i JOIN school_memberships membership USING(school_id,account_id)
      WHERE i.id=m.profile_identity_id AND i.account_id=owner.id AND i.kind='student' AND i.archived_at IS NULL
      AND membership.revoked_at IS NULL AND i.school_id=NULLIF(current_setting('campus.notification_school_id',true),'')::uuid)`}
  AND NOT EXISTS (SELECT 1 FROM student_guestbook_reports r
   WHERE r.reporter_account_id=${recipient} AND r.resolution IS NULL
    AND r.message_id IN (m.id,m.thread_id) AND owner.id<>${recipient})`;
}

const accountRecipient = "NULLIF(current_setting('campus.account_notification_account_id',true),'')::uuid";

export function guestbookNotificationRows(practice, identity = null) {
 const nickname = practice
  ? `COALESCE(CASE WHEN a.leaderboard_use_nickname THEN NULLIF(btrim(a.nickname),'') END,
    'Learner-'||upper(left(md5('public-practice:'||a.id::text),8)))`
  : `COALESCE(NULLIF(btrim(a.nickname),''),'同学')`;
 return `SELECT n.id,'guestbook'::text kind,
   jsonb_build_object('messageId',m.id,'profileIdentityId',${practice ? 'm.practice_profile_account_id' : 'm.profile_identity_id'},
    'practice',${practice},'interaction',n.interaction,'body',m.body,'authorNickname',${nickname},
    'authorAvatar',a.avatar,'authorIdentityId',i.id,
    'authorAlias','Learner-'||upper(left(md5('public-practice:'||a.id::text),8))) data,n.created_at,n.read_at
  ${source(practice)} JOIN student_guestbook_notifications n ON n.message_id=m.id
  WHERE ${visible(practice,accountRecipient)} AND ${recipientFilter(identity)}`;
}

function recipientFilter(identity) {
 return identity
  ? `(n.recipient_account_id=${accountRecipient} OR n.recipient_account_id IS NULL AND n.recipient_identity_id=${identity})`
  : `n.recipient_account_id=${accountRecipient}`;
}

export async function readGuestbookNotification(db, notificationId, practice, identity = null) {
 const {rows:[item]}=await db.query(`UPDATE student_guestbook_notifications n
  SET read_at=coalesce(n.read_at,clock_timestamp())
  WHERE n.id IN (SELECT id FROM (${guestbookNotificationRows(practice,identity ? '$2' : null)}) visible)
   AND ($1::uuid IS NULL OR n.id=$1) AND ($1::uuid IS NOT NULL OR n.read_at IS NULL)
  RETURNING read_at`,identity ? [notificationId,identity] : [notificationId]);
 return item;
}
