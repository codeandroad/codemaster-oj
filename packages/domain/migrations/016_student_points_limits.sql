UPDATE point_rewards SET points=LEAST(points,CASE WHEN assignment_id IS NULL THEN 30 ELSE 20 END);
CREATE OR REPLACE FUNCTION award_submission_points(s submissions) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reward integer; used integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM identities WHERE id=s.identity_id AND kind='student') THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('points:'||s.identity_id::text,0));
 IF s.status<>'AC' OR s.kind NOT IN ('submit','correction') THEN RETURN; END IF;
 IF s.timed_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=s.timed_attempt_id AND p.results_published_at IS NOT NULL) THEN RETURN; END IF;
 SELECT points INTO reward FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id IS NULL;
 INSERT INTO point_ledger(identity_id,problem_id,submission_id,reason,points) VALUES(s.identity_id,s.problem_id,s.id,'first_ac',COALESCE(reward,10)) ON CONFLICT DO NOTHING;
 IF s.assignment_id IS NOT NULL THEN
 SELECT points INTO reward FROM point_rewards WHERE problem_id=s.problem_id AND assignment_id=s.assignment_id;
 IF reward IS NOT NULL THEN
 SELECT COALESCE(sum(points),0)::int INTO used FROM point_ledger WHERE identity_id=s.identity_id AND reason='assignment' AND created_at>=date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
 reward=LEAST(reward,GREATEST(0,200-used));
 INSERT INTO point_ledger(identity_id,problem_id,submission_id,assignment_id,reason,points) VALUES(s.identity_id,s.problem_id,s.id,s.assignment_id,'assignment',reward) ON CONFLICT DO NOTHING; END IF;
 END IF;
END $$;

WITH budget AS (
 SELECT problem_id,assignment_id,GREATEST(0,LEAST(points,100-COALESCE(sum(points) OVER(PARTITION BY assignment_id ORDER BY problem_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))) allowed
 FROM point_rewards WHERE assignment_id IS NOT NULL
) UPDATE point_rewards r SET points=b.allowed FROM budget b WHERE r.problem_id=b.problem_id AND r.assignment_id=b.assignment_id;
