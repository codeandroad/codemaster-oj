-- Paper 4 classroom practice is deliberately independent of ordinary OJ
-- problems, submissions, judge tasks, AC rewards and leaderboards.
CREATE TABLE paper4_papers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL REFERENCES accounts(id),
 class_id uuid REFERENCES classes(id),
 title text NOT NULL,
 description text NOT NULL DEFAULT '',
 starts_at timestamptz,
 ends_at timestamptz,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 current_version_id uuid,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at),
 CHECK((status='draft' AND published_at IS NULL) OR (status='published' AND published_at IS NOT NULL))
);
CREATE TABLE paper4_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 paper_id uuid NOT NULL REFERENCES paper4_papers(id),
 definition jsonb NOT NULL,
 runner_cases jsonb NOT NULL DEFAULT '{}'::jsonb,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(definition)='object'),
 CHECK(jsonb_typeof(runner_cases)='object')
);
ALTER TABLE paper4_papers ADD CONSTRAINT paper4_papers_current_version_fk
 FOREIGN KEY(current_version_id) REFERENCES paper4_versions(id);
CREATE INDEX paper4_papers_class_idx ON paper4_papers(class_id,status,created_at DESC);
CREATE TABLE paper4_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 paper_id uuid NOT NULL REFERENCES paper4_papers(id),
 version_id uuid NOT NULL REFERENCES paper4_versions(id),
 identity_id uuid NOT NULL REFERENCES identities(id),
 account_id uuid NOT NULL REFERENCES accounts(id),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','submitted')),
 started_at timestamptz NOT NULL DEFAULT now(),
 submitted_at timestamptz,
 released_at timestamptz,
 UNIQUE(paper_id,identity_id),
 CHECK((state='active' AND submitted_at IS NULL) OR (state='submitted' AND submitted_at IS NOT NULL)),
 CHECK(released_at IS NULL OR submitted_at IS NOT NULL)
);
CREATE INDEX paper4_attempts_paper_idx ON paper4_attempts(paper_id,started_at DESC);
CREATE TABLE paper4_attempt_files (
 attempt_id uuid NOT NULL REFERENCES paper4_attempts(id),
 question_key text NOT NULL,
 content text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(attempt_id,question_key)
);
CREATE TABLE paper4_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL REFERENCES paper4_attempts(id),
 question_key text NOT NULL,
 stage_key text,
 source_code text NOT NULL,
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper4_snapshots_attempt_idx ON paper4_snapshots(attempt_id,created_at DESC);
CREATE TABLE paper4_stage_marks (
 attempt_id uuid NOT NULL REFERENCES paper4_attempts(id),
 stage_key text NOT NULL,
 marks integer NOT NULL CHECK(marks>=0),
 note text NOT NULL DEFAULT '',
 reviewer_account_id uuid NOT NULL REFERENCES accounts(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(attempt_id,stage_key)
);
CREATE TABLE paper4_run_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 snapshot_id uuid NOT NULL REFERENCES paper4_snapshots(id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','completed','failed')),
 lease_id uuid,
 lease_expires_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 node_id text,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper4_run_tasks_queue_idx ON paper4_run_tasks(state,available_at,created_at);
CREATE TABLE paper4_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES paper4_run_tasks(id),
 lease_id uuid NOT NULL UNIQUE,
 snapshot_id uuid NOT NULL REFERENCES paper4_snapshots(id),
 status text NOT NULL,
 public_output text NOT NULL DEFAULT '',
 public_message text NOT NULL DEFAULT '',
 private_results jsonb NOT NULL DEFAULT '[]'::jsonb,
 environment_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION protect_paper4_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'published paper4 versions are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paper4_version_immutable BEFORE UPDATE ON paper4_versions
 FOR EACH ROW EXECUTE FUNCTION protect_paper4_version();
CREATE FUNCTION protect_paper4_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'paper4 snapshots are immutable';
END $$;
CREATE TRIGGER paper4_snapshot_immutable BEFORE UPDATE OR DELETE ON paper4_snapshots
 FOR EACH ROW EXECUTE FUNCTION protect_paper4_snapshot();
