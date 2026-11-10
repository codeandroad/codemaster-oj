-- ACSL editions are opt-in per school and never become ordinary published problems.
ALTER TABLE school_problem_banks ADD COLUMN resource_kind text NOT NULL DEFAULT 'ordinary'
 CHECK (resource_kind IN ('ordinary','acsl'));
ALTER TABLE school_problem_banks DROP CONSTRAINT school_problem_banks_legacy_snapshot_check;
ALTER TABLE school_problem_banks ADD CONSTRAINT school_problem_banks_legacy_snapshot_check
 CHECK (school_id<>'00000000-0000-4000-8000-000000000052' OR (id='00000000-0000-4000-8000-000000000074' AND request_id=id) OR resource_kind='acsl');
ALTER TABLE school_judge_jobs DROP CONSTRAINT school_judge_jobs_access_context_check;
ALTER TABLE school_judge_jobs ADD CONSTRAINT school_judge_jobs_access_context_check
 CHECK (access_context IN ('school','public','staff_practice','assignment_preview','acsl'));

CREATE TABLE acsl_papers (
 school_id uuid NOT NULL REFERENCES schools(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 slug text NOT NULL, version_id uuid NOT NULL DEFAULT gen_random_uuid(), content_hash text NOT NULL,
 definition jsonb NOT NULL, programming_problem_id uuid NOT NULL, programming_version_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,slug), UNIQUE(school_id,id,version_id),
 FOREIGN KEY(school_id,programming_problem_id,programming_version_id)
 REFERENCES school_problem_versions(school_id,problem_id,id)
);
CREATE TABLE acsl_drafts (
 school_id uuid NOT NULL, paper_id uuid NOT NULL, version_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id), question_id text NOT NULL,
 selected_option_ids jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,paper_id,version_id,account_id,question_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
CREATE TABLE acsl_submissions (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), paper_id uuid NOT NULL, version_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id), question_id text NOT NULL,
 selected_option_ids jsonb NOT NULL, correct boolean NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 draft_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(account_id,request_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
CREATE INDEX acsl_submissions_progress ON acsl_submissions(school_id,paper_id,version_id,account_id,question_id,created_at DESC);
DO $$ DECLARE table_name text; BEGIN
 FOR table_name IN SELECT unnest(ARRAY['acsl_papers','acsl_drafts','acsl_submissions']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY school_scope ON %I USING (school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid) WITH CHECK (school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid)',table_name);
 END LOOP;
END $$;
REVOKE ALL ON acsl_papers,acsl_drafts,acsl_submissions FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_papers TO campus_app;
GRANT SELECT,INSERT,UPDATE ON acsl_drafts TO campus_app;
GRANT SELECT,INSERT ON acsl_submissions TO campus_app;
