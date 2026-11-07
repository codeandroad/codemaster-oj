-- Invitation authority stays inside one school. Accepting an administrator
-- invitation never writes global account_roles or platform_admins.
ALTER TABLE school_invitations DROP CONSTRAINT school_invitations_role_check;
ALTER TABLE school_invitations ADD CONSTRAINT school_invitations_role_check
  CHECK (role IN ('school_admin','teacher','student'));
