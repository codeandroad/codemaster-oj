-- An operator's authorization for a platform administrator cannot be issued
-- by the application role. The shared one-time token supplies expiry and use.
CREATE TABLE platform_admin_recovery_issues (
  account_id uuid PRIMARY KEY REFERENCES platform_admins(account_id),
  token_hash text NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON platform_admin_recovery_issues FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON platform_admin_recovery_issues TO campus_app;

ALTER TABLE school_join_requests
  ALTER COLUMN number DROP NOT NULL,
  ADD COLUMN roster_hint text,
  ADD COLUMN verification_method text,
  ADD CHECK ((number IS NOT NULL AND roster_hint IS NULL) OR
    (number IS NULL AND kind='student' AND roster_hint IS NOT NULL AND char_length(trim(roster_hint)) BETWEEN 1 AND 160)),
  ADD CHECK (verification_method IS NULL OR verification_method IN ('in_person','school_contact')),
  ADD CHECK ((verification_method IS NOT NULL)=(number IS NULL AND status='approved'));
GRANT UPDATE(verification_method) ON school_join_requests TO campus_app;
