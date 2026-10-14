-- School-internal student guestbooks. Messages are immutable plain text; a
-- deletion is a tombstone so moderation and report history remain auditable.
CREATE TABLE student_guestbook_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_identity_id uuid NOT NULL REFERENCES identities(id),
 author_account_id uuid NOT NULL REFERENCES accounts(id),
 body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 deleted_by_account_id uuid REFERENCES accounts(id),
 CHECK ((deleted_at IS NULL) = (deleted_by_account_id IS NULL))
);
CREATE INDEX student_guestbook_profile_recent_idx
 ON student_guestbook_messages(profile_identity_id, created_at DESC, id DESC)
 WHERE deleted_at IS NULL;
CREATE INDEX student_guestbook_author_recent_idx
 ON student_guestbook_messages(author_account_id, created_at DESC);

CREATE TABLE student_guestbook_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 message_id uuid NOT NULL REFERENCES student_guestbook_messages(id),
 reporter_account_id uuid NOT NULL REFERENCES accounts(id),
 reason text NOT NULL CHECK (reason IN ('spam','abuse','privacy','other')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(message_id, reporter_account_id)
);
CREATE INDEX student_guestbook_reports_recent_idx
 ON student_guestbook_reports(created_at DESC, id DESC);

CREATE FUNCTION protect_guestbook_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.profile_identity_id,NEW.author_account_id,NEW.body,NEW.created_at)
  IS DISTINCT FROM
  (OLD.id,OLD.profile_identity_id,OLD.author_account_id,OLD.body,OLD.created_at) THEN
  RAISE EXCEPTION 'guestbook message content is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guestbook_message_immutable BEFORE UPDATE ON student_guestbook_messages
 FOR EACH ROW EXECUTE FUNCTION protect_guestbook_message();
