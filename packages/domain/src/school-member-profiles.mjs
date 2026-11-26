export const schoolMemberProfileId = "COALESCE(CASE WHEN membership.role='student' AND dossier.kind='student' THEN dossier.id END, profile_account.id)";
export const schoolMemberProfileName = `COALESCE(
  CASE WHEN profile_account.leaderboard_use_nickname THEN NULLIF(btrim(profile_account.nickname),'') END,
  dossier.name, login_identity.name)`;
export const schoolMemberProfileRows = `FROM school_memberships membership
  JOIN accounts profile_account ON profile_account.id=membership.account_id
  JOIN identities login_identity ON login_identity.id=profile_account.identity_id
  LEFT JOIN school_identities dossier ON dossier.school_id=membership.school_id
    AND dossier.account_id=profile_account.id AND dossier.archived_at IS NULL
  WHERE membership.revoked_at IS NULL AND NOT membership.suspended
    AND profile_account.disabled_at IS NULL AND profile_account.binding_released_at IS NULL
    AND login_identity.archived_at IS NULL`;
