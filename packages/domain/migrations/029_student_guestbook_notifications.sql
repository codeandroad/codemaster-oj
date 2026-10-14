-- A successful guestbook post creates one durable notification for its owner.
-- Message deletion is a tombstone; the notification remains for audit but is
-- hidden from the owner's inbox once its source message is deleted.
CREATE TABLE student_guestbook_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_identity_id uuid NOT NULL REFERENCES identities(id),
 message_id uuid NOT NULL UNIQUE REFERENCES student_guestbook_messages(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX student_guestbook_notifications_recipient_recent_idx
 ON student_guestbook_notifications(recipient_identity_id,created_at DESC,id DESC);
CREATE INDEX student_guestbook_notifications_recipient_unread_idx
 ON student_guestbook_notifications(recipient_identity_id,created_at DESC)
 WHERE read_at IS NULL;
