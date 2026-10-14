CREATE TABLE timed_practices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, class_id uuid NOT NULL REFERENCES classes(id),
 owner_account_id uuid NOT NULL REFERENCES accounts(id), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 1 AND 240), show_verdict boolean NOT NULL DEFAULT true,
 state text NOT NULL DEFAULT 'Draft' CHECK(state IN ('Draft','Published','ResultsPublished','Archived')),
 results_published_at timestamptz, forced_ended_at timestamptz, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at)
);
CREATE TABLE timed_practice_problems (
 practice_id uuid NOT NULL REFERENCES timed_practices(id), problem_id uuid NOT NULL REFERENCES problems(id),
 version_id uuid NOT NULL REFERENCES problem_versions(id), points numeric(10,2) NOT NULL CHECK(points>0 AND points<=1000),
 position integer NOT NULL, PRIMARY KEY(practice_id,problem_id), UNIQUE(practice_id,position)
);
CREATE TABLE timed_practice_participants (
 practice_id uuid NOT NULL REFERENCES timed_practices(id), identity_id uuid NOT NULL REFERENCES identities(id),
 exempt boolean NOT NULL DEFAULT false, PRIMARY KEY(practice_id,identity_id)
);
CREATE TABLE timed_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES timed_practices(id),
 identity_id uuid NOT NULL REFERENCES identities(id), account_id uuid NOT NULL REFERENCES accounts(id),
 started_at timestamptz NOT NULL, deadline_at timestamptz NOT NULL, finished_at timestamptz,
 state text NOT NULL DEFAULT 'Active' CHECK(state IN ('Active','Finished')),
 UNIQUE(practice_id,identity_id), CHECK(deadline_at>=started_at),
 FOREIGN KEY(practice_id,identity_id) REFERENCES timed_practice_participants(practice_id,identity_id)
);
CREATE INDEX timed_attempts_identity_idx ON timed_attempts(identity_id,practice_id);
ALTER TABLE submissions ADD COLUMN timed_attempt_id uuid REFERENCES timed_attempts(id);
ALTER TABLE submissions ADD CONSTRAINT submissions_timed_context CHECK(timed_attempt_id IS NULL OR (assignment_id IS NULL AND kind<>'correction' AND original_submission_id IS NULL));
CREATE INDEX submissions_timed_idx ON submissions(timed_attempt_id,problem_id,created_at DESC,id DESC);
CREATE TABLE timed_result_snapshots (
 practice_id uuid NOT NULL REFERENCES timed_practices(id), identity_id uuid NOT NULL REFERENCES identities(id),
 grade jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(practice_id,identity_id)
);
CREATE TABLE timed_result_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES timed_practices(id),
 revision integer NOT NULL CHECK(revision>0), grades jsonb NOT NULL, reason text NOT NULL,
 actor_account_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(practice_id,revision)
);
ALTER TABLE timed_practices ADD COLUMN current_result_revision_id uuid REFERENCES timed_result_revisions(id);

CREATE FUNCTION protect_timed_practice_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state<>'Draft' AND (to_jsonb(NEW)-'state'-'results_published_at'-'forced_ended_at'-'archived_at'-'owner_account_id'-'current_result_revision_id') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'results_published_at'-'forced_ended_at'-'archived_at'-'owner_account_id'-'current_result_revision_id') THEN
   RAISE EXCEPTION 'published timed practice settings are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER timed_practice_snapshot BEFORE UPDATE ON timed_practices FOR EACH ROW EXECUTE FUNCTION protect_timed_practice_snapshot();

CREATE FUNCTION protect_timed_problem_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM timed_practices WHERE id=OLD.practice_id AND state<>'Draft') THEN RAISE EXCEPTION 'published timed problems are immutable'; END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM timed_practices WHERE id=NEW.practice_id AND state<>'Draft') THEN RAISE EXCEPTION 'published timed problems are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER timed_problem_snapshot BEFORE INSERT OR UPDATE OR DELETE ON timed_practice_problems FOR EACH ROW EXECUTE FUNCTION protect_timed_problem_snapshot();

CREATE FUNCTION protect_timed_participant_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.practice_id=OLD.practice_id AND (to_jsonb(NEW)-'exempt')=(to_jsonb(OLD)-'exempt') THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM timed_practices WHERE id=OLD.practice_id AND state<>'Draft') THEN RAISE EXCEPTION 'published timed participants are immutable'; END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM timed_practices WHERE id=NEW.practice_id AND state<>'Draft') THEN RAISE EXCEPTION 'published timed participants are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER timed_participant_snapshot BEFORE INSERT OR UPDATE OR DELETE ON timed_practice_participants FOR EACH ROW EXECUTE FUNCTION protect_timed_participant_snapshot();

CREATE FUNCTION protect_timed_result_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM timed_practices WHERE id=OLD.practice_id AND results_published_at IS NOT NULL) THEN RAISE EXCEPTION 'published timed results are immutable'; END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM timed_practices WHERE id=NEW.practice_id AND results_published_at IS NOT NULL) THEN RAISE EXCEPTION 'published timed results are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER timed_result_snapshot BEFORE INSERT OR UPDATE OR DELETE ON timed_result_snapshots FOR EACH ROW EXECUTE FUNCTION protect_timed_result_snapshot();
CREATE FUNCTION protect_timed_result_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'timed result revisions are immutable';
END $$;
CREATE TRIGGER timed_result_revision_immutable BEFORE UPDATE OR DELETE ON timed_result_revisions FOR EACH ROW EXECUTE FUNCTION protect_timed_result_revision();
