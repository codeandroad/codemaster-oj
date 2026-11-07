-- Original-school proposals reference the exact original version. No judge
-- snapshot is created until the platform approves the request.
CREATE TABLE legacy_public_problem_requests (
 problem_id uuid NOT NULL REFERENCES problems(id),
 version_id uuid PRIMARY KEY REFERENCES problem_versions(id),
 requested_by uuid NOT NULL REFERENCES accounts(id),
 requested_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 decided_by uuid REFERENCES accounts(id),
 decided_at timestamptz,
 CHECK ((status='pending' AND decided_by IS NULL AND decided_at IS NULL)
   OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX timed_practice_problems_by_problem ON timed_practice_problems(problem_id);
CREATE INDEX legacy_public_problem_requests_problem ON legacy_public_problem_requests(problem_id);
ALTER TABLE legacy_public_problem_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_public_problem_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY legacy_public_problem_request_scope ON legacy_public_problem_requests
 USING (NULLIF(current_setting('campus.school_id',true),'')::uuid='00000000-0000-4000-8000-000000000052');

-- Public originals use the existing school judge queue and composite version
-- keys. A reserved ID prevents this bank from acting as a second school bank.
ALTER TABLE school_problem_banks DROP CONSTRAINT school_problem_banks_school_id_check;
ALTER TABLE school_problem_banks ADD CONSTRAINT school_problem_banks_legacy_snapshot_check CHECK(
 school_id<>'00000000-0000-4000-8000-000000000052'
 OR (id='00000000-0000-4000-8000-000000000074' AND request_id=id)
);

REVOKE ALL ON legacy_public_problem_requests FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT ON legacy_public_problem_requests TO campus_app;
GRANT UPDATE(status,requested_by,requested_at,decided_by,decided_at) ON legacy_public_problem_requests TO campus_app;
