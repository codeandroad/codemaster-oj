ALTER TABLE assignments ADD COLUMN cancelled_at timestamptz,
 ADD CHECK (cancelled_at IS NULL OR (state='Published' AND archived_at IS NOT NULL));
ALTER TABLE assignment_participants ADD COLUMN extended_due_at timestamptz;
ALTER TABLE school_activities ADD COLUMN cancelled_at timestamptz,
 ADD CHECK (cancelled_at IS NULL OR (kind='assignment' AND state='Archived' AND published_at IS NOT NULL));
ALTER TABLE school_activity_participants ADD COLUMN extended_due_at timestamptz,
 ADD COLUMN exempt boolean NOT NULL DEFAULT false;

ALTER TABLE student_system_notifications DROP CONSTRAINT student_system_notifications_kind_check;
ALTER TABLE student_system_notifications ADD CHECK
 (kind IN ('scholarship_grant','activity_reward','teacher_feedback','assignment_change'));
CREATE POLICY student_system_notifications_assignment_change ON student_system_notifications FOR INSERT
 TO campus_app, CURRENT_USER WITH CHECK (kind='assignment_change' AND
  (legacy_identity_id IS NOT NULL OR school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid));

CREATE OR REPLACE FUNCTION luq_snapshot_submission() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.luq_solution_assisted,NEW.luq_first_ac_eligible,NEW.luq_first_ac_amount,NEW.luq_activity_deadline,NEW.luq_reward_rule_version)
   IS DISTINCT FROM ROW(OLD.luq_solution_assisted,OLD.luq_first_ac_eligible,OLD.luq_first_ac_amount,OLD.luq_activity_deadline,OLD.luq_reward_rule_version)
   THEN RAISE EXCEPTION 'Luq submission snapshots are immutable'; END IF;
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-assistance:'||NEW.identity_id::text,0));
 NEW.luq_solution_assisted := EXISTS(SELECT 1 FROM luq_assistance_deliveries
  WHERE identity_id=NEW.identity_id AND subject_key='problem:'||NEW.problem_id AND kind='FULL_SOLUTION' AND provided_at<=NEW.created_at);
 NEW.luq_first_ac_eligible := EXISTS(SELECT 1 FROM problem_versions v WHERE v.id=NEW.version_id
  AND v.published_at IS NOT NULL AND v.rank_review_status='approved' AND v.rank_approved_at IS NOT NULL AND v.school_visible_at IS NOT NULL);
 SELECT first_ac_reward,rule_version INTO NEW.luq_first_ac_amount,NEW.luq_reward_rule_version FROM luq_settings WHERE singleton;
 IF NEW.assignment_id IS NOT NULL THEN
  SELECT greatest(a.due_at,p.extended_due_at) INTO NEW.luq_activity_deadline
  FROM assignments a LEFT JOIN assignment_participants p ON p.assignment_id=a.id AND p.identity_id=NEW.identity_id
  WHERE a.id=NEW.assignment_id;
 END IF;
 IF NEW.timed_attempt_id IS NOT NULL THEN SELECT LEAST(a.deadline_at,p.ends_at,p.forced_ended_at)
  INTO NEW.luq_activity_deadline FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=NEW.timed_attempt_id; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION school_scholarship_settle_activity(s uuid,typ text,aid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rule school_scholarship_activity_rules; a school_activities; pa school_paper4_activities; participant record; row_job record; reward school_scholarship_ledger; stats record; total numeric; required integer; previous_scope text; cutoff timestamptz;
BEGIN
 IF s IS DISTINCT FROM NULLIF(current_setting('campus.school_id',true),'')::uuid THEN RAISE EXCEPTION 'SCHOLARSHIP_SCOPE'; END IF;
 PERFORM school_scholarship_activity_wallet_locks(s,typ,aid);
 SELECT * INTO rule FROM school_scholarship_activity_rules WHERE school_id=s AND activity_type=typ AND activity_id=aid ORDER BY revision DESC LIMIT 1;
 IF typ='activity' THEN
  SELECT * INTO a FROM school_activities WHERE school_id=s AND id=aid;
  IF NOT FOUND OR a.state='Draft' OR a.kind='timed' AND a.results_published_at IS NULL THEN RETURN; END IF;
  cutoff:=CASE WHEN a.kind='timed' THEN least(a.ends_at,a.forced_ended_at) ELSE a.cancelled_at END;
  -- A published timed result opens deferred first-AC and rank awards together.
  IF a.kind='timed' THEN
   FOR row_job IN SELECT j.* FROM school_judge_jobs j WHERE j.school_id=s AND j.activity_id=aid AND j.kind='submit' AND j.state='completed' AND j.created_at<=j.activity_deadline_at AND (cutoff IS NULL OR j.created_at<=cutoff) ORDER BY j.created_at,j.id LOOP
    PERFORM school_scholarship_settle_result(s,'problem',row_job.id,'problem:'||row_job.problem_id,COALESCE(row_job.result->>'status','System Error'));
   END LOOP;
  END IF;
  IF rule.amount IS NULL OR rule.amount=0 THEN RETURN; END IF;
  SELECT sum(points),count(*) INTO total,required FROM school_activity_problems WHERE school_id=s AND activity_id=aid;
  FOR participant IN SELECT identity_id FROM school_activity_participants WHERE school_id=s AND activity_id=aid AND NOT exempt ORDER BY identity_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||participant.identity_id,0));
   IF EXISTS(SELECT 1 FROM school_scholarship_activity_awards WHERE school_id=s AND activity_type=typ AND activity_id=aid AND identity_id=participant.identity_id) THEN CONTINUE; END IF;
   SELECT count(*) FILTER(WHERE accepted)::integer AS ac,coalesce(sum(score*points/100.0),0) AS score INTO stats FROM (
    SELECT p.problem_id,p.points,bool_or(r.status='AC') AS accepted,max(CASE WHEN r.status='AC' THEN 100 ELSE least(100,greatest(0,coalesce((j.result->>'score')::numeric,0))) END) AS score
    FROM school_activity_problems p JOIN school_judge_jobs j ON j.school_id=p.school_id AND j.activity_id=p.activity_id AND j.problem_id=p.problem_id AND j.version_id=p.version_id
    JOIN school_scholarship_receipts receipt ON receipt.school_id=j.school_id AND receipt.source_kind='problem' AND receipt.job_id=j.id
    JOIN school_scholarship_results r ON r.school_id=receipt.school_id AND r.source_kind=receipt.source_kind AND r.job_id=receipt.job_id AND r.subject_key=receipt.subject_key
    WHERE p.school_id=s AND p.activity_id=aid AND j.identity_id=participant.identity_id AND j.kind='submit' AND j.state='completed'
     AND (j.activity_deadline_at IS NULL OR j.created_at<=j.activity_deadline_at) AND (cutoff IS NULL OR j.created_at<=cutoff)
     AND (a.kind<>'timed' OR j.completed_at<=a.results_published_at) AND (rule.allow_solution_assisted OR NOT receipt.assisted)
    GROUP BY p.problem_id,p.points
   ) valid;
   IF total>0 AND (CASE WHEN rule.require_all THEN a.kind='assignment' AND stats.ac=required
    ELSE stats.ac>=rule.minimum_ac AND stats.score*100/total>=rule.minimum_score END) THEN
    reward:=school_scholarship_entry(s,participant.identity_id,rule.amount,'activity','activity:'||typ||':'||aid||':'||participant.identity_id,NULL,'Activity achievement reward',jsonb_build_object('activityId',aid,'activityType',a.kind,'ruleVersion',rule.revision));
    INSERT INTO school_scholarship_activity_awards(school_id,activity_type,activity_id,identity_id,rule_revision,ledger_id) VALUES(s,typ,aid,participant.identity_id,rule.revision,reward.id);
   END IF;
  END LOOP;
 ELSIF typ='paper4_activity' THEN
  SELECT * INTO pa FROM school_paper4_activities WHERE school_id=s AND id=aid;
  IF NOT FOUND OR pa.kind='exam' AND pa.results_published_at IS NULL THEN RETURN; END IF;
  FOR row_job IN SELECT j.*,at.paper_id FROM school_paper4_jobs j JOIN school_paper4_attempts at ON at.school_id=j.school_id AND at.id=j.attempt_id WHERE j.school_id=s AND at.activity_id=aid AND j.kind='submit' AND j.state='completed' AND (pa.ends_at IS NULL OR j.created_at<=pa.ends_at) ORDER BY j.created_at,j.id LOOP
   FOR stats IN SELECT value q FROM jsonb_array_elements(COALESCE(row_job.result->'questions','[]')) LOOP PERFORM school_scholarship_settle_result(s,'paper4',row_job.id,'paper4:'||row_job.paper_id||':'||(stats.q->>'key'),COALESCE(stats.q->>'status','System Error')); END LOOP;
  END LOOP;
  IF rule.amount IS NULL OR rule.amount=0 THEN RETURN; END IF;
  SELECT sum((st->>'maxMarks')::numeric) INTO total FROM school_paper4_versions v CROSS JOIN LATERAL jsonb_array_elements(v.content->'definition'->'questions') q CROSS JOIN LATERAL jsonb_array_elements(q->'stages') st WHERE v.school_id=s AND v.id=pa.version_id;
  FOR participant IN SELECT identity_id FROM school_paper4_participants WHERE school_id=s AND activity_id=aid ORDER BY identity_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||participant.identity_id,0));
   IF EXISTS(SELECT 1 FROM school_scholarship_activity_awards WHERE school_id=s AND activity_type=typ AND activity_id=aid AND identity_id=participant.identity_id) THEN CONTINUE; END IF;
   SELECT count(DISTINCT receipt.subject_key) FILTER(WHERE r.status='AC')::integer AS ac,
    coalesce(sum(CASE WHEN stage->>'judgeMode'='auto' THEN least((stage->>'maxMarks')::numeric,greatest(0,coalesce((automatic->>'marks')::numeric,0)))
     WHEN pa.results_published_at IS NOT NULL THEN least((stage->>'maxMarks')::numeric,coalesce(review.marks,0)) ELSE 0 END),0) AS score INTO stats
   FROM school_scholarship_receipts receipt JOIN school_scholarship_results r USING(school_id,source_kind,job_id,subject_key)
   JOIN school_paper4_jobs j ON j.school_id=receipt.school_id AND j.id=receipt.job_id
   JOIN school_paper4_versions v ON v.school_id=j.school_id AND v.id=j.version_id
   CROSS JOIN LATERAL jsonb_array_elements(v.content->'definition'->'questions') question
   CROSS JOIN LATERAL jsonb_array_elements(question->'stages') stage
   LEFT JOIN LATERAL (SELECT st FROM jsonb_array_elements(j.result->'questions') qr CROSS JOIN LATERAL jsonb_array_elements(qr->'stages') st WHERE qr->>'key'=question->>'key' AND st->>'stageKey'=stage->>'id' LIMIT 1) auto_result ON true
   LEFT JOIN LATERAL (SELECT auto_result.st AS automatic) extracted ON true
   LEFT JOIN school_paper4_reviews review ON review.school_id=j.school_id AND review.attempt_id=j.attempt_id AND review.stage_key=stage->>'id'
   WHERE receipt.school_id=s AND receipt.source_kind='paper4' AND receipt.activity_id=aid AND receipt.identity_id=participant.identity_id
    AND receipt.subject_key='paper4:'||pa.paper_id||':'||(question->>'key')
    AND (receipt.deadline_at IS NULL OR receipt.received_at<=receipt.deadline_at) AND (rule.allow_solution_assisted OR NOT receipt.assisted)
    AND (pa.kind<>'exam' OR j.completed_at<=pa.results_published_at);
   IF stats.ac>=rule.minimum_ac AND total>0 AND stats.score*100.0/total>=rule.minimum_score THEN
    reward:=school_scholarship_entry(s,participant.identity_id,rule.amount,'activity','activity:'||typ||':'||aid||':'||participant.identity_id,NULL,'Activity achievement reward',jsonb_build_object('activityId',aid,'activityType',typ,'ruleVersion',rule.revision));
    INSERT INTO school_scholarship_activity_awards(school_id,activity_type,activity_id,identity_id,rule_revision,ledger_id) VALUES(s,typ,aid,participant.identity_id,rule.revision,reward.id);
   END IF;
  END LOOP;
 END IF;
END $$;

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
  SELECT 1 FROM assignments a
  WHERE a.id=s.assignment_id AND s.created_at<=coalesce(s.luq_activity_deadline,a.due_at)
    AND NOT EXISTS (SELECT 1 FROM assignment_participants p WHERE p.assignment_id=a.id AND p.identity_id=s.identity_id AND p.exempt)
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
