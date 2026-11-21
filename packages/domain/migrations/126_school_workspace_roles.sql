CREATE VIEW school_workspace_roles WITH (security_invoker=true) AS
 SELECT school_id, account_id, role
 FROM school_memberships
 WHERE revoked_at IS NULL
 UNION
 SELECT membership.school_id, membership.account_id, 'school_admin'
 FROM school_memberships membership
 JOIN school_administrators administrator USING (school_id, account_id)
 WHERE membership.revoked_at IS NULL AND administrator.revoked_at IS NULL
 UNION
 SELECT ownership.school_id, ownership.account_id,
   CASE WHEN credential.role='admin' THEN 'school_admin' ELSE credential.role END
 FROM legacy_school_account_ownership ownership
 JOIN account_roles credential USING (account_id);
