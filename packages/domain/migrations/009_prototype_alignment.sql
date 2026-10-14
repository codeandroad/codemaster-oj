-- Additive production features. Existing activities and grades remain intact.
ALTER TABLE identities ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN last_login_at timestamptz;
UPDATE accounts a SET last_login_at=(SELECT max(created_at) FROM audit_events e WHERE e.actor_account_id=a.id AND e.action='auth.login');
CREATE TABLE identity_teacher_classes(identity_id uuid REFERENCES identities(id),class_id uuid REFERENCES classes(id),PRIMARY KEY(identity_id,class_id));
INSERT INTO identity_teacher_classes SELECT DISTINCT a.identity_id,tc.class_id FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id WHERE a.binding_released_at IS NULL;
CREATE TABLE site_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),settings jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO site_settings(id) VALUES(true);
CREATE TABLE judge_control(id boolean PRIMARY KEY DEFAULT true CHECK(id),maintenance boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES accounts(id));
INSERT INTO judge_control(id) VALUES(true);
CREATE TABLE judge_nodes(id text PRIMARY KEY,concurrency integer NOT NULL CHECK(concurrency BETWEEN 1 AND 2),runtime_version text NOT NULL,executor_ready boolean NOT NULL,heartbeat_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE judge_tasks ADD COLUMN node_id text;
CREATE TABLE problem_favorites(identity_id uuid REFERENCES identities(id),problem_id uuid REFERENCES problems(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(identity_id,problem_id));
ALTER TABLE assignments ADD COLUMN state text NOT NULL DEFAULT 'Published' CHECK(state IN ('Draft','Published'));
ALTER TABLE assignments ADD COLUMN published_at timestamptz;
ALTER TABLE assignments ADD COLUMN description text NOT NULL DEFAULT '';
UPDATE assignments SET published_at=created_at;
ALTER TABLE problem_banks ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE problem_banks ADD COLUMN course text NOT NULL DEFAULT 'Python';
ALTER TABLE problem_banks ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE learning_paths ADD COLUMN estimated_minutes integer NOT NULL DEFAULT 30 CHECK(estimated_minutes BETWEEN 1 AND 10080);
ALTER TABLE learning_chapters ADD COLUMN objective text NOT NULL DEFAULT '';
ALTER TABLE learning_chapters ADD COLUMN checkpoint text NOT NULL DEFAULT '';
ALTER TABLE learning_chapters ADD COLUMN checkpoint_answer text NOT NULL DEFAULT '';
CREATE FUNCTION protect_published_assignment_problems() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM assignments WHERE id=COALESCE(OLD.assignment_id,NEW.assignment_id) AND state='Published') THEN
  RAISE EXCEPTION 'published assignment problem snapshots are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER assignment_problems_immutable BEFORE UPDATE OR DELETE ON assignment_problems FOR EACH ROW EXECUTE FUNCTION protect_published_assignment_problems();
CREATE TABLE identity_import_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),idempotency_key uuid NOT NULL,request_hash text NOT NULL,nonsecret_result jsonb NOT NULL,result_ciphertext text,replay_expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,idempotency_key));
ALTER TABLE problem_import_batches ADD COLUMN bank_id uuid REFERENCES problem_banks(id);
ALTER TABLE problem_import_batches ADD COLUMN filename text NOT NULL DEFAULT '';
ALTER TABLE problem_versions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE problem_versions DROP CONSTRAINT problem_versions_validation_status_check;
ALTER TABLE problem_versions ADD CONSTRAINT problem_versions_validation_status_check CHECK(validation_status IN ('Incomplete','Waiting','Judging','AC','WA','CE','RE','TLE','MLE','OLE','System Error'));
ALTER TABLE test_cases ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE test_cases ADD COLUMN enabled boolean NOT NULL DEFAULT true;
CREATE TABLE learning_resources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_account_id uuid NOT NULL REFERENCES accounts(id),type text NOT NULL CHECK(type IN ('reading','video','reference','note','article','link')),title text NOT NULL,content text NOT NULL DEFAULT '',path_id uuid REFERENCES learning_paths(id),chapter_id uuid REFERENCES learning_chapters(id),scope text NOT NULL DEFAULT 'school' CHECK(scope IN ('school','private')),archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
