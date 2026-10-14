ALTER TABLE accounts ADD COLUMN nickname text NOT NULL DEFAULT '' CHECK(length(nickname)<=40);
ALTER TABLE accounts ADD COLUMN bio text NOT NULL DEFAULT '' CHECK(length(bio)<=500);
ALTER TABLE accounts ADD COLUMN avatar text NOT NULL DEFAULT '' CHECK(length(avatar)<=100000);
CREATE TABLE point_rewards(problem_id uuid NOT NULL REFERENCES problems(id),assignment_id uuid REFERENCES assignments(id),points integer NOT NULL CHECK(points BETWEEN 0 AND 1000),updated_by uuid NOT NULL REFERENCES accounts(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX point_rewards_unique ON point_rewards(problem_id,COALESCE(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE point_ledger(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,identity_id uuid NOT NULL REFERENCES identities(id),problem_id uuid NOT NULL REFERENCES problems(id),submission_id bigint NOT NULL REFERENCES submissions(id),assignment_id uuid REFERENCES assignments(id),reason text NOT NULL CHECK(reason IN ('first_ac','assignment')),points integer NOT NULL CHECK(points BETWEEN 0 AND 1000),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX point_ledger_unique ON point_ledger(identity_id,problem_id,reason,COALESCE(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX point_ledger_identity ON point_ledger(identity_id);
CREATE FUNCTION award_submission_points(s submissions) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reward integer;
BEGIN
 IF s.status<>'AC' OR s.kind NOT IN ('submit','correction') THEN RETURN; END IF;
 IF s.timed_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=s.timed_attempt_id AND p.results_published_at IS NOT NULL) THEN RETURN; END IF;
 SELECT points INTO reward FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id IS NULL;
 INSERT INTO point_ledger(identity_id,problem_id,submission_id,reason,points) VALUES(s.identity_id,s.problem_id,s.id,'first_ac',COALESCE(reward,10)) ON CONFLICT DO NOTHING;
 IF s.assignment_id IS NOT NULL THEN
 SELECT points INTO reward FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id=s.assignment_id;
 IF reward IS NOT NULL THEN INSERT INTO point_ledger(identity_id,problem_id,submission_id,assignment_id,reason,points) VALUES(s.identity_id,s.problem_id,s.id,s.assignment_id,'assignment',reward) ON CONFLICT DO NOTHING; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION award_submission_points(submissions) FROM PUBLIC;
CREATE FUNCTION points_on_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM award_submission_points(NEW);RETURN NEW;END $$;
CREATE TRIGGER submission_points AFTER INSERT OR UPDATE OF status ON submissions FOR EACH ROW EXECUTE FUNCTION points_on_submission();
CREATE FUNCTION points_on_timed_publish() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE s submissions;BEGIN IF OLD.results_published_at IS NULL AND NEW.results_published_at IS NOT NULL THEN FOR s IN SELECT sub.* FROM submissions sub JOIN timed_attempts a ON a.id=sub.timed_attempt_id WHERE a.practice_id=NEW.id AND sub.status='AC' LOOP PERFORM award_submission_points(s);END LOOP;END IF;RETURN NEW;END $$;
CREATE TRIGGER timed_points AFTER UPDATE OF results_published_at ON timed_practices FOR EACH ROW EXECUTE FUNCTION points_on_timed_publish();
