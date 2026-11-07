-- Legacy teaching routes remain a single-school workspace during rollout.
-- Memberships of newly provisioned schools are never copied to account_roles.
CREATE TABLE schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schools (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000052', 'legacy-school', '原有学校');

CREATE TABLE school_memberships (
  school_id uuid NOT NULL REFERENCES schools(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  role text NOT NULL CHECK (role IN ('school_admin','teacher','student')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (school_id, account_id),
  CHECK (school_id <> '00000000-0000-4000-8000-000000000052')
);
CREATE INDEX school_memberships_active_account_idx
  ON school_memberships(account_id, school_id) WHERE revoked_at IS NULL;

CREATE TABLE school_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  issued_by uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('teacher','student')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES accounts(id),
  FOREIGN KEY (school_id, issued_by) REFERENCES school_memberships(school_id, account_id),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);
CREATE INDEX school_invitations_pending_idx
  ON school_invitations(school_id, expires_at) WHERE accepted_at IS NULL;

-- Keep pilot membership activity out of the legacy global audit endpoint.
CREATE TABLE school_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  actor_account_id uuid REFERENCES accounts(id),
  action text NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_audit_events_school_idx ON school_audit_events(school_id, created_at);
