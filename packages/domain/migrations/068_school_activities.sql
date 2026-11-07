-- School-scoped assignments and timed assessments. Legacy activities are untouched.
CREATE TABLE school_activities (
 school_id uuid NOT NULL REFERENCES schools(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL REFERENCES accounts(id), kind text NOT NULL CHECK(kind IN ('assignment','timed')),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200), description text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','Published','Archived')),
 revision integer NOT NULL DEFAULT 1, request_id uuid NOT NULL, request_hash text NOT NULL,
 starts_at timestamptz, ends_at timestamptz, duration_minutes integer CHECK(duration_minutes BETWEEN 1 AND 1440),
 published_at timestamptz, results_published_at timestamptz, forced_ended_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,owner_account_id,request_id),
 CHECK(school_id<>'00000000-0000-4000-8000-000000000052'),
 CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at<ends_at),
 CHECK(kind<>'timed' OR state<>'Published' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND duration_minutes IS NOT NULL))
);
CREATE TABLE school_activity_problems (
 school_id uuid NOT NULL, activity_id uuid NOT NULL, problem_id uuid NOT NULL, version_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 100), points integer NOT NULL CHECK(points BETWEEN 1 AND 1000),
 PRIMARY KEY(school_id,activity_id,problem_id), UNIQUE(school_id,activity_id,position), UNIQUE(school_id,activity_id,problem_id,version_id),
 FOREIGN KEY(school_id,activity_id) REFERENCES school_activities(school_id,id),
 FOREIGN KEY(school_id,problem_id,version_id) REFERENCES school_problem_versions(school_id,problem_id,id)
);
CREATE TABLE school_activity_participants (
 school_id uuid NOT NULL, activity_id uuid NOT NULL, identity_id uuid NOT NULL,
 PRIMARY KEY(school_id,activity_id,identity_id),
 FOREIGN KEY(school_id,activity_id) REFERENCES school_activities(school_id,id),
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE TABLE school_activity_classes (
 school_id uuid NOT NULL, activity_id uuid NOT NULL, class_id uuid NOT NULL,
 PRIMARY KEY(school_id,activity_id,class_id),
 FOREIGN KEY(school_id,activity_id) REFERENCES school_activities(school_id,id),
 FOREIGN KEY(school_id,class_id) REFERENCES school_classes(school_id,id)
);
CREATE TABLE school_activity_attempts (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), activity_id uuid NOT NULL, identity_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id), started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz, finished_at timestamptz,
 PRIMARY KEY(school_id,id), UNIQUE(school_id,activity_id,identity_id), UNIQUE(school_id,activity_id,id),
 FOREIGN KEY(school_id,activity_id,identity_id) REFERENCES school_activity_participants(school_id,activity_id,identity_id),
 CHECK(deadline_at IS NULL OR deadline_at>=started_at)
);
CREATE TABLE school_activity_results (
 school_id uuid NOT NULL, activity_id uuid NOT NULL, identity_id uuid NOT NULL,
 grade jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,activity_id,identity_id),
 FOREIGN KEY(school_id,activity_id,identity_id) REFERENCES school_activity_participants(school_id,activity_id,identity_id)
);
CREATE FUNCTION school_activity_result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Published activity results are immutable' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION school_activity_result_immutable() FROM PUBLIC;
CREATE TRIGGER school_activity_result_immutable BEFORE UPDATE OR DELETE ON school_activity_results
 FOR EACH ROW EXECUTE FUNCTION school_activity_result_immutable();
ALTER TABLE school_judge_jobs ADD COLUMN activity_id uuid, ADD COLUMN activity_attempt_id uuid, ADD COLUMN activity_deadline_at timestamptz;
ALTER TABLE school_judge_jobs ADD CONSTRAINT school_job_activity_problem_fk FOREIGN KEY(school_id,activity_id,problem_id,version_id) REFERENCES school_activity_problems(school_id,activity_id,problem_id,version_id);
ALTER TABLE school_judge_jobs ADD CONSTRAINT school_job_activity_attempt_fk FOREIGN KEY(school_id,activity_id,activity_attempt_id) REFERENCES school_activity_attempts(school_id,activity_id,id);
ALTER TABLE school_judge_jobs ADD CONSTRAINT school_job_activity_context_check CHECK((activity_id IS NULL AND activity_attempt_id IS NULL AND activity_deadline_at IS NULL) OR (activity_id IS NOT NULL AND activity_attempt_id IS NOT NULL AND identity_id IS NOT NULL AND access_context='school' AND kind<>'validation'));
CREATE INDEX school_activity_jobs ON school_judge_jobs(school_id,activity_id,identity_id,problem_id,created_at);
CREATE INDEX school_activities_directory ON school_activities(school_id,kind,state,created_at DESC,id);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['school_activities','school_activity_problems','school_activity_participants','school_activity_classes','school_activity_attempts','school_activity_results'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY %I ON %I USING(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid) WITH CHECK(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid)',table_name||'_scope',table_name);
 END LOOP;
END $$;
