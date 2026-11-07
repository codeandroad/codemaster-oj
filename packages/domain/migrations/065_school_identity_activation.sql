-- School activation claims the existing directory record. Credentials are
-- single-use, scoped by the same school/identity FK as class rosters.
CREATE TABLE school_activation_tokens (
  school_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  issued_by uuid NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (school_id, identity_id),
  FOREIGN KEY (school_id, identity_id) REFERENCES school_identities(school_id, id)
);
REVOKE ALL ON school_activation_tokens FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT, INSERT, UPDATE ON school_activation_tokens TO campus_app;
