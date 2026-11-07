-- Personal credentials are global, not a student/teacher identity in a school.
-- Existing accounts, ownership and rewards remain unchanged.
ALTER TABLE identities DROP CONSTRAINT identities_kind_check;
ALTER TABLE identities ADD CONSTRAINT identities_kind_check CHECK(kind IN ('student','teacher','admin','personal'));

CREATE OR REPLACE FUNCTION assign_legacy_school_identity(person uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM identities WHERE id = person AND kind <> 'personal') THEN RETURN; END IF;
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
