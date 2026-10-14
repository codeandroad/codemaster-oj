-- Timed rewards are configured per published practice and settle once, when
-- its first immutable result snapshot is released. Existing practices retain
-- zero extra rewards; the separate global first-AC award remains one-time.
ALTER TABLE timed_practice_problems
 ADD COLUMN reward_points integer NOT NULL DEFAULT 0 CHECK (reward_points BETWEEN 0 AND 20),
 ADD COLUMN speed_bonus_points integer NOT NULL DEFAULT 0 CHECK (speed_bonus_points BETWEEN 0 AND 20),
 ADD COLUMN attempt_bonus_points integer NOT NULL DEFAULT 0 CHECK (attempt_bonus_points BETWEEN 0 AND 20);

ALTER TABLE point_ledger
 ADD COLUMN timed_practice_id uuid REFERENCES timed_practices(id);
ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_reason_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_reason_check
 CHECK (reason IN ('first_ac','assignment','timed'));
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_timed_context
 CHECK ((reason='timed')=(timed_practice_id IS NOT NULL));
DROP INDEX point_ledger_unique;
CREATE UNIQUE INDEX point_ledger_unique ON point_ledger(
 identity_id,problem_id,reason,
 COALESCE(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid),
 COALESCE(timed_practice_id,'00000000-0000-0000-0000-000000000000'::uuid)
);

-- A timed submission counts for global first AC only if it is the scored
-- final submission in the first released snapshot. Later rejudges cannot
-- mint points against a previously released WA snapshot.
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
  JOIN timed_result_snapshots snapshot ON snapshot.practice_id=p.id AND snapshot.identity_id=a.identity_id
  CROSS JOIN LATERAL jsonb_array_elements(snapshot.grade->'problems') AS scored(value)
  WHERE a.id=s.timed_attempt_id AND p.results_published_at IS NOT NULL
   AND scored.value->>'submissionId'='SUB'||s.id::text AND scored.value->>'status'='AC'
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
