ALTER TABLE school_identities ADD COLUMN archived_at timestamptz;
ALTER TABLE school_identities ADD CONSTRAINT school_identity_archive_unlinked
  CHECK (archived_at IS NULL OR account_id IS NULL);

CREATE TABLE school_exit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  identity_id uuid,
  student_name text NOT NULL,
  student_number text,
  membership_started_at timestamptz NOT NULL,
  requested_by uuid NOT NULL REFERENCES accounts(id),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES accounts(id),
  review_note text NOT NULL DEFAULT '' CHECK (length(review_note) <= 500),
  CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);
CREATE UNIQUE INDEX school_exit_one_pending
  ON school_exit_requests(school_id, account_id) WHERE status = 'pending';
CREATE INDEX school_exit_history ON school_exit_requests(school_id, requested_at DESC, id);
CREATE INDEX school_exit_identity ON school_exit_requests(school_id, identity_id)
  WHERE status = 'approved';

REVOKE ALL ON school_exit_requests FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT, INSERT ON school_exit_requests TO campus_app;
GRANT UPDATE(status,reviewed_at,reviewed_by,review_note) ON school_exit_requests TO campus_app;
GRANT UPDATE(archived_at) ON school_identities TO campus_app;

-- The original account remains the global login and retains every
-- account-scoped record. Legacy business records keep the stable student
-- identity and original account ID. Only the authorized exit procedure may
-- move the active login to a fresh personal identity.
CREATE OR REPLACE FUNCTION protect_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.identity_id IS NOT DISTINCT FROM OLD.identity_id THEN RETURN NEW; END IF;
  IF current_user::regrole::oid = (SELECT relowner FROM pg_catalog.pg_class WHERE oid=TG_RELID)
    AND EXISTS (SELECT 1 FROM identities i WHERE i.id=OLD.identity_id AND i.kind='student' AND i.archived_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM identities i WHERE i.id=NEW.identity_id AND i.kind='personal' AND i.archived_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.identity_id=NEW.identity_id)
    AND NOT EXISTS (SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=OLD.id)
    AND EXISTS (SELECT 1 FROM school_exit_requests e
      WHERE e.school_id='00000000-0000-4000-8000-000000000052' AND e.account_id=OLD.id
        AND e.identity_id=OLD.identity_id AND e.status='approved') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'historical account identity is immutable';
END $$;

CREATE FUNCTION detach_legacy_school_student(actor uuid, student uuid, dossier uuid, exit_request uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  personal_id uuid := gen_random_uuid();
  student_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('legacy-school-ownership', 0));
  IF NOT EXISTS (
    SELECT 1 FROM accounts a JOIN account_roles r ON r.account_id=a.id
    JOIN legacy_school_account_ownership o ON o.account_id=a.id
    JOIN identities i ON i.id=a.identity_id
    WHERE a.id=actor AND r.role='admin' AND a.disabled_at IS NULL
      AND a.binding_released_at IS NULL AND i.archived_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM school_exit_requests e
    WHERE e.id=exit_request AND e.school_id='00000000-0000-4000-8000-000000000052'
      AND e.account_id=student AND e.identity_id=dossier AND e.status='approved' AND e.reviewed_by=actor
  ) THEN
    RETURN false;
  END IF;
  SELECT i.name INTO student_name FROM identities i
    JOIN accounts a ON a.identity_id=i.id
    JOIN legacy_school_account_ownership o ON o.account_id=a.id
    JOIN legacy_school_identity_ownership d ON d.identity_id=i.id AND d.school_id=o.school_id
    WHERE a.id=student AND i.id=dossier AND i.kind='student'
      AND i.archived_at IS NULL AND a.binding_released_at IS NULL
      AND EXISTS (SELECT 1 FROM account_roles WHERE account_id=student AND role='student')
      AND NOT EXISTS (SELECT 1 FROM account_roles WHERE account_id=student AND role<>'student')
    FOR UPDATE OF i,a;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO identities(id,kind,number,name) VALUES(personal_id,'personal',personal_id::text,student_name);
  UPDATE identities SET archived_at=clock_timestamp() WHERE id=dossier;
  DELETE FROM account_roles WHERE account_id=student AND role='student';
  DELETE FROM legacy_school_account_ownership WHERE account_id=student;
  UPDATE accounts SET identity_id=personal_id,
    default_school_id=CASE WHEN default_school_id='00000000-0000-4000-8000-000000000052' THEN NULL ELSE default_school_id END
    WHERE id=student;
  DELETE FROM activation_tokens WHERE identity_id=dossier;
  DELETE FROM reset_tokens WHERE account_id=student;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION detach_legacy_school_student(uuid,uuid,uuid,uuid) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION detach_legacy_school_student(uuid,uuid,uuid,uuid) TO campus_app;
