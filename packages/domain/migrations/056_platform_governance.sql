-- Platform governance is an explicit capability, never inferred from legacy
-- account_roles or a school's administrator membership.
CREATE TABLE platform_admins (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  granted_by uuid REFERENCES accounts(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- A teacher/student can administer the same school without changing the
-- membership role referenced by their school identity and class roster.
CREATE TABLE school_administrators (
  school_id uuid NOT NULL,
  account_id uuid NOT NULL,
  granted_by uuid NOT NULL REFERENCES accounts(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (school_id, account_id),
  FOREIGN KEY (school_id, account_id) REFERENCES school_memberships(school_id, account_id),
  CHECK (school_id <> '00000000-0000-4000-8000-000000000052')
);
CREATE INDEX school_administrators_active_account_idx
  ON school_administrators(account_id, school_id) WHERE revoked_at IS NULL;

-- Application grants are append-only for this audit table. There is no public
-- school-administration endpoint exposing cross-school governance events.
CREATE TABLE platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_account_id uuid REFERENCES accounts(id),
  action text NOT NULL,
  school_id uuid REFERENCES schools(id),
  target_account_id uuid REFERENCES accounts(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_events_school_idx ON platform_audit_events(school_id, created_at);
