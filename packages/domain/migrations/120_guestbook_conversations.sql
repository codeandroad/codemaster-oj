ALTER TABLE student_guestbook_messages
 ADD COLUMN thread_id uuid REFERENCES student_guestbook_messages(id),
 ADD COLUMN quote_id uuid REFERENCES student_guestbook_messages(id),
 ADD CHECK ((thread_id IS NULL) = (quote_id IS NULL)),
 ADD CHECK (thread_id IS NULL OR (thread_id<>id AND quote_id<>id AND length(body)<=300));

CREATE INDEX student_guestbook_replies_idx
 ON student_guestbook_messages(thread_id,created_at,id)
 WHERE thread_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION protect_guestbook_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.profile_identity_id,NEW.author_account_id,NEW.body,NEW.created_at,NEW.practice_profile_account_id,NEW.thread_id,NEW.quote_id)
  IS DISTINCT FROM
  (OLD.id,OLD.profile_identity_id,OLD.author_account_id,OLD.body,OLD.created_at,OLD.practice_profile_account_id,OLD.thread_id,OLD.quote_id) THEN
  RAISE EXCEPTION 'guestbook message content is immutable';
 END IF;
 RETURN NEW;
END $$;

CREATE TABLE student_guestbook_likes (
 message_id uuid NOT NULL REFERENCES student_guestbook_messages(id),
 account_id uuid NOT NULL REFERENCES accounts(id),
 PRIMARY KEY(message_id,account_id)
);

CREATE TABLE student_guestbook_mentions (
 message_id uuid NOT NULL REFERENCES student_guestbook_messages(id),
 account_id uuid NOT NULL REFERENCES accounts(id),
 PRIMARY KEY(message_id,account_id)
);

ALTER TABLE student_guestbook_notifications
 DROP CONSTRAINT student_guestbook_notifications_message_id_key,
 ADD COLUMN recipient_account_id uuid REFERENCES accounts(id),
 ADD COLUMN interaction text NOT NULL DEFAULT 'message' CHECK (interaction IN ('message','reply','mention')),
 ADD UNIQUE(message_id,recipient_identity_id);

CREATE INDEX student_guestbook_notifications_account_idx
 ON student_guestbook_notifications(recipient_account_id,created_at DESC,id DESC)
 WHERE recipient_account_id IS NOT NULL;
