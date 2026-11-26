ALTER TABLE student_guestbook_messages
 ALTER COLUMN profile_identity_id DROP NOT NULL,
 ADD COLUMN school_profile_account_id uuid,
 ADD FOREIGN KEY (school_id,school_profile_account_id) REFERENCES school_memberships(school_id,account_id),
 ADD CHECK (num_nonnulls(profile_identity_id,school_profile_account_id)=1
   AND (school_profile_account_id IS NULL OR school_id IS NOT NULL));

CREATE INDEX school_member_guestbook_messages_idx
 ON student_guestbook_messages(school_id,school_profile_account_id,created_at DESC,id DESC)
 WHERE school_profile_account_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION protect_guestbook_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.profile_identity_id,NEW.author_account_id,NEW.body,NEW.created_at,NEW.practice_profile_account_id,
     NEW.thread_id,NEW.quote_id,NEW.school_id,NEW.school_profile_account_id)
  IS DISTINCT FROM
  (OLD.id,OLD.profile_identity_id,OLD.author_account_id,OLD.body,OLD.created_at,OLD.practice_profile_account_id,
     OLD.thread_id,OLD.quote_id,OLD.school_id,OLD.school_profile_account_id) THEN
  RAISE EXCEPTION 'guestbook message content is immutable';
 END IF;
 RETURN NEW;
END $$;
