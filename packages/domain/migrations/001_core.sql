CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('student','teacher','admin')),
 number text NOT NULL, name text NOT NULL, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,number)
);
CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_id uuid NOT NULL UNIQUE REFERENCES identities(id),
 username text NOT NULL UNIQUE, password_hash text NOT NULL, disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_roles (account_id uuid REFERENCES accounts(id), role text CHECK(role IN ('student','teacher','admin')), PRIMARY KEY(account_id,role));
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), csrf_token text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions(account_id);
CREATE TABLE activation_tokens (identity_id uuid PRIMARY KEY REFERENCES identities(id), token_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE TABLE reset_tokens (account_id uuid PRIMARY KEY REFERENCES accounts(id), token_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE TABLE classes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, type text NOT NULL DEFAULT 'training' CHECK(type IN ('administrative','training')), owner_account_id uuid NOT NULL REFERENCES accounts(id), archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE class_members (class_id uuid REFERENCES classes(id), identity_id uuid REFERENCES identities(id), PRIMARY KEY(class_id,identity_id));
CREATE TABLE teacher_classes (class_id uuid REFERENCES classes(id), account_id uuid REFERENCES accounts(id), PRIMARY KEY(class_id,account_id));
CREATE TABLE problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_account_id uuid NOT NULL REFERENCES accounts(id), current_version_id uuid, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE problem_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), problem_id uuid NOT NULL REFERENCES problems(id), title text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('stdio','function')), statement text NOT NULL, function_name text,
 starter_code text NOT NULL DEFAULT '', samples jsonb NOT NULL DEFAULT '[]', time_limit_ms integer NOT NULL CHECK(time_limit_ms BETWEEN 100 AND 5000),
 memory_limit_mb integer NOT NULL CHECK(memory_limit_mb BETWEEN 32 AND 256), comparator text NOT NULL DEFAULT 'tokens' CHECK(comparator IN ('tokens','exact','json')),
 reference_code text NOT NULL, validation_status text NOT NULL DEFAULT 'Waiting' CHECK(validation_status IN ('Waiting','Judging','AC','WA','CE','RE','TLE','MLE','OLE','System Error')),
 validation_message text, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE problems ADD CONSTRAINT problems_current_version_fk FOREIGN KEY(current_version_id) REFERENCES problem_versions(id);
CREATE TABLE test_cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES problem_versions(id), position integer NOT NULL, input text NOT NULL, expected text NOT NULL, weight numeric(8,4) NOT NULL CHECK(weight>0 AND weight<=100), UNIQUE(version_id,position));
CREATE TABLE assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, class_id uuid NOT NULL REFERENCES classes(id), owner_account_id uuid NOT NULL REFERENCES accounts(id), due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE assignment_problems (assignment_id uuid REFERENCES assignments(id), problem_id uuid REFERENCES problems(id), version_id uuid NOT NULL REFERENCES problem_versions(id), points numeric(10,2) NOT NULL CHECK(points>0), position integer NOT NULL, PRIMARY KEY(assignment_id,problem_id));
CREATE TABLE assignment_participants (assignment_id uuid REFERENCES assignments(id), identity_id uuid REFERENCES identities(id), exempt boolean NOT NULL DEFAULT false, PRIMARY KEY(assignment_id,identity_id));
CREATE TABLE submissions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), identity_id uuid NOT NULL REFERENCES identities(id),
 problem_id uuid NOT NULL REFERENCES problems(id), version_id uuid NOT NULL REFERENCES problem_versions(id), assignment_id uuid REFERENCES assignments(id),
 kind text NOT NULL CHECK(kind IN ('submit','samples','custom','correction')), original_submission_id bigint REFERENCES submissions(id), code text NOT NULL,
 custom_input text, idempotency_key text NOT NULL, request_hash text NOT NULL, status text NOT NULL DEFAULT 'Waiting',
 score numeric(8,4), passed integer, total integer, public_output text, public_message text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,idempotency_key),
 CHECK(status IN ('Waiting','Judging','Executed','AC','WA','CE','RE','TLE','MLE','OLE','System Error')),
 CHECK(score IS NULL OR (score>=0 AND score<=100)), CHECK(status<>'AC' OR kind='custom' OR score=100)
);
CREATE INDEX submissions_identity_idx ON submissions(identity_id,created_at DESC);
CREATE INDEX submissions_assignment_idx ON submissions(assignment_id,identity_id);
CREATE TABLE judge_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id bigint REFERENCES submissions(id), version_id uuid NOT NULL REFERENCES problem_versions(id),
 purpose text NOT NULL CHECK(purpose IN ('submission','validation')), state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','completed','failed')),
 lease_id uuid, lease_expires_at timestamptz, attempts integer NOT NULL DEFAULT 0, last_error text, available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((purpose='submission' AND submission_id IS NOT NULL) OR (purpose='validation' AND submission_id IS NULL))
);
CREATE INDEX judge_tasks_queue_idx ON judge_tasks(state,available_at,created_at);
CREATE TABLE judge_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES judge_tasks(id), lease_id uuid NOT NULL UNIQUE,
 submission_id bigint REFERENCES submissions(id), version_id uuid NOT NULL REFERENCES problem_versions(id), status text NOT NULL,
 score numeric(8,4), passed integer, total integer, public_output text, public_message text, private_results jsonb NOT NULL DEFAULT '[]',
 environment_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE review_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id bigint NOT NULL REFERENCES submissions(id), author_account_id uuid NOT NULL REFERENCES accounts(id), note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_account_id uuid REFERENCES accounts(id), action text NOT NULL, resource_type text, resource_id text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());

-- Published version content is immutable; judging may only change validation fields.
CREATE FUNCTION protect_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published_at IS NOT NULL AND (to_jsonb(NEW)-'validation_status'-'validation_message') IS DISTINCT FROM (to_jsonb(OLD)-'validation_status'-'validation_message') THEN
   RAISE EXCEPTION 'published problem versions are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER published_version_immutable BEFORE UPDATE ON problem_versions FOR EACH ROW EXECUTE FUNCTION protect_published_version();
CREATE FUNCTION protect_published_tests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM problem_versions WHERE id=COALESCE(OLD.version_id,NEW.version_id) AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'published tests are immutable'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER published_tests_immutable BEFORE INSERT OR UPDATE OR DELETE ON test_cases FOR EACH ROW EXECUTE FUNCTION protect_published_tests();
