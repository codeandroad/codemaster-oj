-- New workspaces keep their resources separate from the legacy teaching tables.
CREATE TABLE school_problem_banks (
 school_id uuid NOT NULL REFERENCES schools(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL REFERENCES accounts(id), name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 120),
 revision integer NOT NULL DEFAULT 1, archived boolean NOT NULL DEFAULT false,
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,owner_account_id,request_id),
 CHECK(school_id<>'00000000-0000-4000-8000-000000000052')
);
CREATE TABLE school_problems (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), bank_id uuid NOT NULL,
 owner_account_id uuid NOT NULL REFERENCES accounts(id), draft jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1, published_version_id uuid, published boolean NOT NULL DEFAULT false,
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,owner_account_id,request_id),
 FOREIGN KEY(school_id,bank_id) REFERENCES school_problem_banks(school_id,id)
);
CREATE TABLE school_problem_versions (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), problem_id uuid NOT NULL,
 draft_revision integer NOT NULL, definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,problem_id,id), UNIQUE(school_id,problem_id,draft_revision),
 FOREIGN KEY(school_id,problem_id) REFERENCES school_problems(school_id,id)
);
ALTER TABLE school_problems ADD CONSTRAINT school_problem_live_version_fk
 FOREIGN KEY(school_id,id,published_version_id) REFERENCES school_problem_versions(school_id,problem_id,id);

-- Trusted snapshots are the worker's only new data access. It never reads the
-- school directory or courses; the executor still has no database access.
CREATE TABLE school_judge_jobs (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), problem_id uuid NOT NULL, version_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id), identity_id uuid,
 request_id uuid NOT NULL, request_hash text NOT NULL, kind text NOT NULL CHECK(kind IN ('validation','samples','submit','custom')),
 access_context text NOT NULL CHECK(access_context IN ('school','public')),
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, lease_id uuid, lease_expires_at timestamptz, node_id text,
 available_at timestamptz NOT NULL DEFAULT now(), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 PRIMARY KEY(school_id,id), UNIQUE(account_id,request_id), UNIQUE(lease_id),
 FOREIGN KEY(school_id,problem_id,version_id) REFERENCES school_problem_versions(school_id,problem_id,id),
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE INDEX school_judge_jobs_queue ON school_judge_jobs(state,available_at,created_at);
CREATE INDEX school_judge_jobs_owner ON school_judge_jobs(school_id,account_id,created_at DESC);

-- Explicit platform authorization only; this directory contains no body,
-- reference code or tests. School publication alone cannot create this row.
CREATE TABLE school_problem_publications (
 problem_id uuid PRIMARY KEY, school_id uuid NOT NULL, version_id uuid NOT NULL,
 approved_by uuid NOT NULL REFERENCES accounts(id), approved_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,
 FOREIGN KEY(school_id,problem_id,version_id) REFERENCES school_problem_versions(school_id,problem_id,id)
);

ALTER TABLE school_problem_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_problem_banks FORCE ROW LEVEL SECURITY;
CREATE POLICY school_problem_banks_scope ON school_problem_banks
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_problems FORCE ROW LEVEL SECURITY;
CREATE POLICY school_problems_scope ON school_problems
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_problem_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_problem_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY school_problem_versions_scope ON school_problem_versions
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_judge_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_judge_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY school_judge_jobs_scope ON school_judge_jobs
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid OR current_user='campus_worker')
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid OR current_user='campus_worker');
