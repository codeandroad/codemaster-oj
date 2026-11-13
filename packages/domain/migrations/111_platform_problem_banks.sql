-- Platform catalog categories do not replace a problem's original school bank.
-- Keeping bank_id, problem IDs and versions intact preserves school links/history.
CREATE TABLE platform_problem_banks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 archived_at timestamptz
);
CREATE UNIQUE INDEX platform_problem_banks_active_name ON platform_problem_banks(lower(name)) WHERE archived_at IS NULL;
ALTER TABLE problems ADD COLUMN platform_bank_id uuid REFERENCES platform_problem_banks(id);
CREATE INDEX problems_platform_bank ON problems(platform_bank_id) WHERE owner_scope='platform';
CREATE TABLE platform_problem_imports (
 account_id uuid NOT NULL REFERENCES accounts(id),
 idempotency_key text NOT NULL,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,idempotency_key)
);
REVOKE ALL ON platform_problem_banks,platform_problem_imports FROM PUBLIC,campus_worker;
GRANT SELECT,INSERT,UPDATE ON platform_problem_banks TO campus_app;
GRANT SELECT,INSERT ON platform_problem_imports TO campus_app;
