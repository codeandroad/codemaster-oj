-- Freeze the on-time formal AC submissions at first result publication.
-- A student may have reached AC and then submitted WA as the final scored
-- attempt: that practice earns no timed bonus, but the earlier AC still counts
-- toward the independent global first-AC reward. Rejudges after publication
-- cannot add new candidates or retroactively mint that global reward.
CREATE TABLE timed_first_ac_candidates (
 submission_id bigint PRIMARY KEY REFERENCES submissions(id),
 practice_id uuid NOT NULL REFERENCES timed_practices(id)
);
CREATE INDEX timed_first_ac_candidates_practice_idx ON timed_first_ac_candidates(practice_id);

CREATE FUNCTION protect_timed_first_ac_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'released timed first-AC candidates are immutable'; END IF;
 IF EXISTS(SELECT 1 FROM timed_practices WHERE id=NEW.practice_id AND results_published_at IS NOT NULL)
 THEN RAISE EXCEPTION 'cannot add timed first-AC candidates after result publication'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER timed_first_ac_candidates_immutable
 BEFORE INSERT OR UPDATE OR DELETE ON timed_first_ac_candidates
 FOR EACH ROW EXECUTE FUNCTION protect_timed_first_ac_candidate();

CREATE OR REPLACE FUNCTION award_submission_points(s submissions) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reward integer; used integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM identities WHERE id=s.identity_id AND kind='student') THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('points:'||s.identity_id::text,0));
 IF s.status<>'AC' OR s.kind NOT IN ('submit','correction') THEN RETURN; END IF;
 IF s.timed_attempt_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM timed_attempts a
  JOIN timed_practices p ON p.id=a.practice_id
  JOIN timed_first_ac_candidates candidate ON candidate.practice_id=p.id AND candidate.submission_id=s.id
  WHERE a.id=s.timed_attempt_id AND p.results_published_at IS NOT NULL
 ) THEN RETURN; END IF;
 SELECT points INTO reward FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id IS NULL;
 INSERT INTO point_ledger(identity_id,problem_id,submission_id,reason,points)
 VALUES(s.identity_id,s.problem_id,s.id,'first_ac',COALESCE(reward,10)) ON CONFLICT DO NOTHING;
 IF s.assignment_id IS NOT NULL AND s.kind='submit' AND EXISTS(
  SELECT 1 FROM assignments a WHERE a.id=s.assignment_id AND s.created_at<=a.due_at
 ) THEN
  SELECT points INTO reward FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id=s.assignment_id;
  IF reward IS NOT NULL THEN
   SELECT COALESCE(sum(points),0)::int INTO used FROM point_ledger
   WHERE identity_id=s.identity_id AND reason='assignment'
    AND created_at>=date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
   reward=LEAST(reward,GREATEST(0,200-used));
   INSERT INTO point_ledger(identity_id,problem_id,submission_id,assignment_id,reason,points)
   VALUES(s.identity_id,s.problem_id,s.id,s.assignment_id,'assignment',reward) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION points_on_timed_publish() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s submissions;
BEGIN
 IF OLD.results_published_at IS NULL AND NEW.results_published_at IS NOT NULL THEN
  FOR s IN SELECT sub.* FROM timed_first_ac_candidates candidate
    JOIN submissions sub ON sub.id=candidate.submission_id
    WHERE candidate.practice_id=NEW.id ORDER BY sub.created_at,sub.id
  LOOP PERFORM award_submission_points(s); END LOOP;
 END IF;
 RETURN NEW;
END $$;
