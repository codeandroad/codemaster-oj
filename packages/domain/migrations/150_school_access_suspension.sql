-- revoked_at closes every existing membership-based access check. A suspension
-- keeps the membership and its dossier available for an explicit restoration.
ALTER TABLE school_memberships ADD COLUMN suspended boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT school_suspension_requires_revocation CHECK (NOT suspended OR revoked_at IS NOT NULL);
