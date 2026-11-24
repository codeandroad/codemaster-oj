CREATE TABLE school_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('student','teacher')),
  number text NOT NULL CHECK (char_length(number) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES accounts(id),
  identity_id uuid,
  FOREIGN KEY (school_id,identity_id) REFERENCES school_identities(school_id,id),
  CHECK ((status='pending')=(decided_at IS NULL)),
  CHECK ((decided_at IS NULL)=(decided_by IS NULL)),
  CHECK ((status='approved')=(identity_id IS NOT NULL))
);
CREATE UNIQUE INDEX school_join_requests_pending ON school_join_requests(school_id,account_id) WHERE status='pending';
CREATE INDEX school_join_requests_queue ON school_join_requests(school_id,status,created_at);
CREATE INDEX school_join_requests_personal ON school_join_requests(account_id,created_at DESC);
REVOKE ALL ON school_join_requests FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT, INSERT, UPDATE(status,decided_at,decided_by,identity_id) ON school_join_requests TO campus_app;
REVOKE ALL ON school_invitations FROM campus_app;
