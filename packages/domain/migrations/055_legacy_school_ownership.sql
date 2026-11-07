-- Give the original, single-school business data a durable home. Existing
-- identity, account, course, submission and ledger IDs remain unchanged.
UPDATE schools SET name = '天行创世纪学校'
 WHERE id = '00000000-0000-4000-8000-000000000052';
UPDATE site_settings SET settings = jsonb_set(settings, '{schoolName}', '"天行创世纪学校"')
 WHERE id AND settings->>'schoolName' IS DISTINCT FROM '天行创世纪学校';

-- Global login holders for the new school pilot also use identities/accounts.
-- Explicit ownership keeps those credential holders out of the original school.
-- Preserve the existing, potentially multi-role account_roles relation.
CREATE TABLE legacy_school_identity_ownership (
 identity_id uuid PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
 school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052' REFERENCES schools(id),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 CHECK (school_id = '00000000-0000-4000-8000-000000000052')
);
CREATE TABLE legacy_school_account_ownership (
 account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052' REFERENCES schools(id),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 CHECK (school_id = '00000000-0000-4000-8000-000000000052')
);
CREATE INDEX legacy_school_identity_school_idx ON legacy_school_identity_ownership(school_id, identity_id);
CREATE INDEX legacy_school_account_school_idx ON legacy_school_account_ownership(school_id, account_id);

-- These services have not yet been converted to tenant-scoped reads/writes.
-- Fail closed: their roots can only belong to the original school for now.
-- Child ownership follows existing FKs, including immutable published versions,
-- scored snapshots, account history and Luq records; do not rewrite children.
ALTER TABLE classes ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');
ALTER TABLE problem_banks ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');
ALTER TABLE learning_paths ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');
ALTER TABLE assignments ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');
ALTER TABLE timed_practices ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');
ALTER TABLE paper4_papers ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');
ALTER TABLE learning_resources ADD COLUMN school_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000052'
 REFERENCES schools(id) CHECK (school_id = '00000000-0000-4000-8000-000000000052');

CREATE FUNCTION assign_legacy_school_identity(person uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM identities WHERE id = person) THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM legacy_school_identity_ownership WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE a.identity_id = person)
  OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.identity_id = person)
  OR EXISTS (SELECT 1 FROM class_members WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM identity_teacher_classes WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM submissions WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM assignment_participants WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM timed_practice_participants WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM timed_attempts WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM paper4_attempts WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM paper4_activity_participants WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM learning_progress WHERE identity_id = person)
  OR EXISTS (SELECT 1 FROM point_ledger WHERE identity_id = person)
  OR EXISTS (
   SELECT 1 FROM accounts a WHERE a.identity_id = person AND (
    EXISTS (SELECT 1 FROM classes WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM teacher_classes WHERE account_id = a.id)
    OR EXISTS (SELECT 1 FROM problem_banks WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM problems WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM learning_paths WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM assignments WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM timed_practices WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM paper4_papers WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM learning_resources WHERE owner_account_id = a.id)
    OR EXISTS (SELECT 1 FROM review_entries WHERE author_account_id = a.id)
   )
  )
 THEN
  INSERT INTO legacy_school_identity_ownership(identity_id) VALUES(person) ON CONFLICT DO NOTHING;
  -- Include released/disabled historical credentials; no credentials or roles
  -- are restored, and historical authors continue to point at the same IDs.
  INSERT INTO legacy_school_account_ownership(account_id)
   SELECT id FROM accounts WHERE identity_id = person ON CONFLICT DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION assign_legacy_school_identity(uuid) FROM PUBLIC;

SELECT assign_legacy_school_identity(id) FROM identities ORDER BY id;

-- Evaluate at commit, after a registration transaction has created both its
-- credential and roles. A new membership-only login must not be mistaken for
-- an unactivated school identity between its two INSERTs.
CREATE FUNCTION legacy_school_ownership_on_identity() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM assign_legacy_school_identity(NEW.id);
 RETURN NULL;
END $$;
CREATE FUNCTION legacy_school_ownership_on_account() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM assign_legacy_school_identity(NEW.identity_id);
 RETURN NULL;
END $$;
CREATE FUNCTION legacy_school_ownership_on_role() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM assign_legacy_school_identity(identity_id) FROM accounts WHERE id = NEW.account_id;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION legacy_school_ownership_on_identity(), legacy_school_ownership_on_account(),
 legacy_school_ownership_on_role() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER legacy_school_identity_insert AFTER INSERT ON identities
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION legacy_school_ownership_on_identity();
CREATE CONSTRAINT TRIGGER legacy_school_account_insert AFTER INSERT ON accounts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION legacy_school_ownership_on_account();
CREATE CONSTRAINT TRIGGER legacy_school_role_insert AFTER INSERT ON account_roles
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION legacy_school_ownership_on_role();

INSERT INTO school_audit_events(school_id, action, target_id)
 VALUES('00000000-0000-4000-8000-000000000052', 'school.legacy.attributed', '00000000-0000-4000-8000-000000000052');
