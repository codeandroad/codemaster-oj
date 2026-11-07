-- School Paper 4 is independent of legacy papers, activities, points and Luq.
CREATE TABLE school_paper4_papers (
 school_id uuid NOT NULL REFERENCES schools(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL REFERENCES accounts(id), draft jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1, published_version_id uuid, published boolean NOT NULL DEFAULT false,
 archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), CHECK(school_id<>'00000000-0000-4000-8000-000000000052')
);
CREATE TABLE school_paper4_versions (
 school_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),paper_id uuid NOT NULL,draft_revision integer NOT NULL,
 content jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,paper_id,id), UNIQUE(school_id,paper_id,draft_revision),
 FOREIGN KEY(school_id,paper_id) REFERENCES school_paper4_papers(school_id,id)
);
ALTER TABLE school_paper4_papers ADD FOREIGN KEY(school_id,id,published_version_id) REFERENCES school_paper4_versions(school_id,paper_id,id);
CREATE TABLE school_paper4_activities (
 school_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),paper_id uuid NOT NULL,version_id uuid NOT NULL,
 owner_account_id uuid NOT NULL REFERENCES accounts(id),kind text NOT NULL CHECK(kind IN ('practice','exam')),
 starts_at timestamptz,ends_at timestamptz,results_published_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id),UNIQUE(school_id,id,paper_id,version_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES school_paper4_versions(school_id,paper_id,id),
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at),
 CHECK(kind<>'exam' OR starts_at IS NOT NULL AND ends_at IS NOT NULL)
);
CREATE TABLE school_paper4_participants (
 school_id uuid NOT NULL,activity_id uuid NOT NULL,identity_id uuid NOT NULL,
 PRIMARY KEY(school_id,activity_id,identity_id),
 FOREIGN KEY(school_id,activity_id) REFERENCES school_paper4_activities(school_id,id),
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE TABLE school_paper4_attempts (
 school_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),paper_id uuid NOT NULL,version_id uuid NOT NULL,activity_id uuid,
 identity_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES accounts(id),state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted')),
 revision integer NOT NULL DEFAULT 1,submitted_at timestamptz,results_published_at timestamptz,assistance_snapshot jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,id),UNIQUE(school_id,id,version_id),UNIQUE(school_id,id,identity_id),
 UNIQUE(school_id,activity_id,identity_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES school_paper4_versions(school_id,paper_id,id),
 FOREIGN KEY(school_id,activity_id,paper_id,version_id) REFERENCES school_paper4_activities(school_id,id,paper_id,version_id),
 FOREIGN KEY(school_id,activity_id,identity_id) REFERENCES school_paper4_participants(school_id,activity_id,identity_id),
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE UNIQUE INDEX school_paper4_one_free_draft ON school_paper4_attempts(school_id,identity_id,paper_id,version_id) WHERE activity_id IS NULL AND state='draft';
CREATE TABLE school_paper4_files (
 school_id uuid NOT NULL,attempt_id uuid NOT NULL,question_key text NOT NULL,code text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,attempt_id,question_key),
 FOREIGN KEY(school_id,attempt_id) REFERENCES school_paper4_attempts(school_id,id)
);
CREATE TABLE school_paper4_jobs (
 school_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),version_id uuid NOT NULL,attempt_id uuid,
 account_id uuid NOT NULL REFERENCES accounts(id),identity_id uuid,kind text NOT NULL CHECK(kind IN ('validation','run','submit')),
 payload jsonb NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,lease_id uuid UNIQUE,lease_expires_at timestamptz,node_id text,
 available_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,result jsonb,
 PRIMARY KEY(school_id,id),FOREIGN KEY(school_id,version_id) REFERENCES school_paper4_versions(school_id,id),
 FOREIGN KEY(school_id,attempt_id,version_id) REFERENCES school_paper4_attempts(school_id,id,version_id),
 FOREIGN KEY(school_id,attempt_id,identity_id) REFERENCES school_paper4_attempts(school_id,id,identity_id),
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id),
 CHECK(kind='validation' AND attempt_id IS NULL AND identity_id IS NULL OR kind<>'validation' AND attempt_id IS NOT NULL AND identity_id IS NOT NULL)
);
CREATE INDEX school_paper4_jobs_queue ON school_paper4_jobs(state,available_at,created_at);
CREATE UNIQUE INDEX school_paper4_one_submission ON school_paper4_jobs(school_id,attempt_id) WHERE kind='submit';
CREATE TABLE school_paper4_reviews (
 school_id uuid NOT NULL,attempt_id uuid NOT NULL,stage_key text NOT NULL,marks integer NOT NULL CHECK(marks>=0),
 private_note text NOT NULL DEFAULT '',reviewed_by uuid NOT NULL REFERENCES accounts(id),reviewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,attempt_id,stage_key),FOREIGN KEY(school_id,attempt_id) REFERENCES school_paper4_attempts(school_id,id)
);
CREATE TABLE school_paper4_requests (
 school_id uuid NOT NULL REFERENCES schools(id),account_id uuid NOT NULL REFERENCES accounts(id),request_id uuid NOT NULL,
 operation text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,account_id,request_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['school_paper4_papers','school_paper4_versions','school_paper4_activities','school_paper4_participants','school_paper4_attempts','school_paper4_files','school_paper4_reviews','school_paper4_requests'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY school_scope ON %I USING(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid) WITH CHECK(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
ALTER TABLE school_paper4_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_paper4_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON school_paper4_jobs USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid OR current_user='campus_worker') WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid OR current_user='campus_worker');
