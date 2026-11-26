-- A grant names one existing receipt, its author, and the receiving school dossier.
-- An empty table gives no access to historical personal runs.
CREATE TABLE school_public_run_shares (
  school_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  source_school_id uuid NOT NULL,
  job_id uuid NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('summary','code','classroom')),
  PRIMARY KEY (school_id,identity_id,account_id,source_school_id,job_id),
  FOREIGN KEY (school_id,identity_id) REFERENCES school_identities(school_id,id),
  FOREIGN KEY (source_school_id,job_id) REFERENCES school_judge_jobs(school_id,id)
);
ALTER TABLE school_public_run_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY share_recipient_read ON school_public_run_shares FOR SELECT TO campus_app
  USING (school_id=nullif(current_setting('campus.shared_run_school_id',true),'')::uuid);
CREATE POLICY share_owner_read ON school_public_run_shares FOR SELECT TO campus_app
  USING (account_id=nullif(current_setting('campus.public_history_account_id',true),'')::uuid);
CREATE POLICY share_owner_update ON school_public_run_shares FOR UPDATE TO campus_app
  USING (visibility<>'classroom' AND account_id=nullif(current_setting('campus.public_history_account_id',true),'')::uuid)
  WITH CHECK (visibility<>'classroom' AND account_id=nullif(current_setting('campus.public_history_account_id',true),'')::uuid);
CREATE POLICY share_owner_delete ON school_public_run_shares FOR DELETE TO campus_app
  USING (visibility<>'classroom' AND account_id=nullif(current_setting('campus.public_history_account_id',true),'')::uuid);
CREATE POLICY share_owner_insert ON school_public_run_shares FOR INSERT TO campus_app
  WITH CHECK (account_id=nullif(current_setting('campus.public_history_account_id',true),'')::uuid);

-- School scope is the recipient, which may differ from the problem's storage school.
-- Other school queries do not activate the shared-history read policy.
CREATE POLICY shared_public_job_read ON school_judge_jobs FOR SELECT TO campus_app
  USING (access_context='public' AND activity_id IS NULL AND EXISTS (
    SELECT 1 FROM school_public_run_shares s
    WHERE s.school_id=nullif(current_setting('campus.shared_run_school_id',true),'')::uuid
      AND (s.source_school_id,s.job_id,s.account_id)=(school_judge_jobs.school_id,school_judge_jobs.id,school_judge_jobs.account_id)
  ));
CREATE POLICY own_public_run_read ON school_judge_jobs FOR SELECT TO campus_app
  USING (access_context='public' AND activity_id IS NULL AND kind IN ('samples','custom')
    AND account_id=nullif(current_setting('campus.public_history_account_id',true),'')::uuid);
CREATE UNIQUE INDEX school_classroom_receipt ON school_public_run_shares(source_school_id,job_id) WHERE visibility='classroom';
CREATE INDEX school_public_run_day ON school_judge_jobs(account_id,created_at,id)
  WHERE access_context='public' AND activity_id IS NULL;

-- Personal sharing ends on unlink or loss of school membership. Rejoining or
-- assigning a new login to a dossier must not resurrect that permission.
CREATE FUNCTION clear_personal_run_shares() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  DELETE FROM school_public_run_shares
    WHERE school_id=OLD.school_id AND account_id=OLD.account_id AND visibility <> 'classroom';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION clear_personal_run_shares() FROM PUBLIC;
CREATE TRIGGER revoked_student_run_shares AFTER UPDATE OF revoked_at,role ON school_memberships
  FOR EACH ROW WHEN (OLD.role='student' AND OLD.revoked_at IS NULL AND (NEW.revoked_at IS NOT NULL OR NEW.role <> 'student'))
  EXECUTE FUNCTION clear_personal_run_shares();
CREATE TRIGGER removed_student_run_shares AFTER DELETE ON school_memberships
  FOR EACH ROW WHEN (OLD.role='student') EXECUTE FUNCTION clear_personal_run_shares();
CREATE TRIGGER unlinked_student_run_shares AFTER UPDATE OF account_id,archived_at ON school_identities
  FOR EACH ROW WHEN (OLD.kind='student' AND OLD.account_id IS NOT NULL AND
    (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.archived_at IS DISTINCT FROM OLD.archived_at))
  EXECUTE FUNCTION clear_personal_run_shares();
