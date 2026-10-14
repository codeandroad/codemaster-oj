-- Ranked points are a separate, immutable award. Personal first-AC and
-- assignment/timed bonuses continue to use point_ledger unchanged.
CREATE TABLE school_rank_ledger (
 identity_id uuid NOT NULL REFERENCES identities(id),
 problem_id uuid NOT NULL REFERENCES problems(id),
 version_id uuid NOT NULL REFERENCES problem_versions(id),
 submission_id bigint NOT NULL UNIQUE REFERENCES submissions(id),
 points integer NOT NULL CHECK (points BETWEEN 0 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (identity_id, problem_id)
);
CREATE INDEX school_rank_ledger_period_idx ON school_rank_ledger(created_at,identity_id);

CREATE FUNCTION award_school_rank_points(s submissions) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reward integer;
BEGIN
 IF s.status<>'AC' OR s.kind NOT IN ('submit','correction') THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM identities i WHERE i.id=s.identity_id AND i.kind='student') THEN RETURN; END IF;
 -- The version must have been both school-visible and approved before this
 -- particular submission was received. A past private AC never consumes the
 -- separate school-rank award. Eligibility is frozen at award time.
 IF NOT EXISTS (
  SELECT 1 FROM problem_versions v
  JOIN problems p ON p.id=v.problem_id
  JOIN problem_banks b ON b.id=p.bank_id
  WHERE v.id=s.version_id AND v.problem_id=s.problem_id
   AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL
   AND v.rank_review_status='approved' AND v.rank_approved_at IS NOT NULL
   AND s.created_at>=GREATEST(v.school_visible_at,v.rank_approved_at)
   AND p.archived_at IS NULL AND b.archived_at IS NULL AND b.visibility='school'
 ) THEN RETURN; END IF;
 -- Timed first-AC candidates freeze every on-time formal AC at first release.
 -- A later WA may be the final scored attempt, yet the earlier AC still earns
 -- the one-time first-AC award, matching the personal ledger's policy.
 IF s.timed_attempt_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM timed_attempts a
  JOIN timed_practices practice ON practice.id=a.practice_id
  JOIN timed_first_ac_candidates candidate ON candidate.practice_id=practice.id AND candidate.submission_id=s.id
  WHERE a.id=s.timed_attempt_id AND practice.results_published_at IS NOT NULL
 ) THEN RETURN; END IF;
 SELECT COALESCE((SELECT points FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id IS NULL),10) INTO reward;
 INSERT INTO school_rank_ledger(identity_id,problem_id,version_id,submission_id,points)
 VALUES(s.identity_id,s.problem_id,s.version_id,s.id,reward)
 ON CONFLICT(identity_id,problem_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION award_school_rank_points(submissions) FROM PUBLIC;

CREATE FUNCTION school_rank_on_submission() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM award_school_rank_points(NEW); RETURN NEW; END $$;
CREATE TRIGGER school_rank_submission
 AFTER INSERT OR UPDATE OF status ON submissions
 FOR EACH ROW EXECUTE FUNCTION school_rank_on_submission();

CREATE FUNCTION school_rank_on_timed_publish() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate submissions;
BEGIN
 IF OLD.results_published_at IS NULL AND NEW.results_published_at IS NOT NULL THEN
  FOR candidate IN SELECT s.* FROM timed_first_ac_candidates frozen
   JOIN submissions s ON s.id=frozen.submission_id
   WHERE frozen.practice_id=NEW.id ORDER BY s.created_at,s.id
  LOOP PERFORM award_school_rank_points(candidate); END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER school_rank_timed_publish
 AFTER UPDATE OF results_published_at ON timed_practices
 FOR EACH ROW EXECUTE FUNCTION school_rank_on_timed_publish();

-- Runtime services may read awards, but cannot rewrite an awarded snapshot.
CREATE FUNCTION protect_school_rank_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'school ranked awards are immutable'; END $$;
CREATE TRIGGER school_rank_ledger_immutable
 BEFORE UPDATE OR DELETE ON school_rank_ledger
 FOR EACH ROW EXECUTE FUNCTION protect_school_rank_ledger();
