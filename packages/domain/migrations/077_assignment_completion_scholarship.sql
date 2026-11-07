-- Existing achievement rules keep their threshold criteria. Completion rules
-- require an eligible formal AC on every pinned assignment problem.
ALTER TABLE luq_activity_rules ADD COLUMN require_all boolean NOT NULL DEFAULT false
 CHECK(NOT require_all OR activity_type='assignment');
ALTER TABLE school_scholarship_activity_rules ADD COLUMN require_all boolean NOT NULL DEFAULT false
 CHECK(NOT require_all OR activity_type='activity');

CREATE OR REPLACE FUNCTION luq_settle_activity(student uuid,activity_type_value text,activity uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rule luq_activity_rules; ac_count integer; required integer; achieved numeric; possible numeric; entry luq_ledger;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 IF EXISTS(SELECT 1 FROM luq_activity_awards WHERE identity_id=student AND activity_type=activity_type_value AND activity_id=activity) THEN RETURN; END IF;
 SELECT * INTO rule FROM luq_activity_rules WHERE activity_type=activity_type_value AND activity_id=activity ORDER BY rule_version DESC LIMIT 1;
 IF NOT FOUND OR rule.amount=0 THEN RETURN; END IF;
 IF activity_type_value='assignment' THEN
  IF NOT EXISTS(SELECT 1 FROM assignment_participants WHERE assignment_id=activity AND identity_id=student AND NOT exempt) THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE best.accepted),COALESCE(sum(COALESCE(best.score,0)*ap.points/100),0),sum(ap.points),count(*)
  INTO ac_count,achieved,possible,required FROM assignment_problems ap LEFT JOIN LATERAL (
   SELECT max(r.score) score,bool_or(r.status='AC') accepted FROM submissions s JOIN luq_submission_results r ON r.submission_id=s.id
   WHERE s.assignment_id=activity AND s.identity_id=student AND s.problem_id=ap.problem_id AND (NOT rule.require_all OR s.version_id=ap.version_id) AND s.kind='submit'
    AND s.created_at<=s.luq_activity_deadline AND s.created_at>=rule.created_at AND (rule.allow_solution_assisted OR NOT s.luq_solution_assisted)
  ) best ON true WHERE ap.assignment_id=activity;
 ELSIF activity_type_value='timed' THEN
  IF NOT EXISTS(SELECT 1 FROM timed_practices WHERE id=activity AND results_published_at IS NOT NULL) THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE r.status='AC' AND (rule.allow_solution_assisted OR NOT r.assisted)),COALESCE(sum(CASE WHEN rule.allow_solution_assisted OR NOT r.assisted THEN COALESCE(r.score,0)*tp.points/100 ELSE 0 END),0),sum(tp.points)
  INTO ac_count,achieved,possible FROM timed_practice_problems tp LEFT JOIN LATERAL (
   SELECT observed.status,observed.score,s.luq_solution_assisted assisted FROM submissions s JOIN timed_attempts a ON a.id=s.timed_attempt_id
   JOIN luq_submission_results observed ON observed.submission_id=s.id
   WHERE a.practice_id=activity AND s.identity_id=student AND s.problem_id=tp.problem_id AND s.kind='submit'
    AND s.created_at<=LEAST(s.luq_activity_deadline,a.deadline_at,(SELECT forced_ended_at FROM timed_practices WHERE id=activity))
    AND s.created_at>=rule.created_at
   ORDER BY s.created_at DESC,s.id DESC LIMIT 1
  ) r ON true WHERE tp.practice_id=activity;
 ELSIF activity_type_value='paper4_activity' THEN
  IF NOT EXISTS(SELECT 1 FROM paper4_activity_participants WHERE paper_id=activity AND identity_id=student) THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE accepted),count(*) FILTER(WHERE accepted),count(*) INTO ac_count,achieved,possible FROM (
   SELECT q.value->>'key' question_key,EXISTS(SELECT 1 FROM paper4_attempts a JOIN paper4_snapshots snap ON snap.attempt_id=a.id
    JOIN paper4_runs r ON r.snapshot_id=snap.id JOIN luq_paper4_results observed ON observed.run_id=r.id WHERE a.paper_id=activity AND a.identity_id=student AND snap.question_key=q.value->>'key'
     AND snap.origin='formal' AND r.rank_ac_valid AND a.submitted_at>=rule.created_at
     AND (p.ends_at IS NULL OR a.submitted_at<=p.ends_at) AND (p.starts_at IS NULL OR a.submitted_at>=p.starts_at) AND (p.activity_kind<>'exam' OR a.released_at IS NOT NULL)
     AND (rule.allow_solution_assisted OR NOT snap.luq_solution_assisted)) accepted
   FROM paper4_papers p JOIN paper4_versions v ON v.id=p.current_version_id CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE p.id=activity
  ) questions;
 ELSE RETURN;
 END IF;
 IF possible IS NULL OR possible<=0 THEN RETURN; END IF;
 IF rule.require_all THEN
  IF required IS NULL OR required=0 OR ac_count<>required THEN RETURN; END IF;
 ELSIF ac_count<rule.minimum_ac OR achieved*100/possible<rule.minimum_score THEN RETURN;
 END IF;
 entry:=luq_post_entry(student,rule.amount,'activity','activity:'||student||':'||activity_type_value||':'||activity,NULL,
  'Activity target achieved',jsonb_build_object('ruleId',rule.id,'activityType',activity_type_value,'activityId',activity));
 INSERT INTO luq_activity_awards(identity_id,activity_type,activity_id,rule_id,ledger_id) VALUES(student,activity_type_value,activity,rule.id,entry.id);
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
  cutoff:=least(a.ends_at,a.forced_ended_at);
  -- A published timed result opens deferred first-AC and rank awards together.
  IF a.kind='timed' THEN
   FOR row_job IN SELECT j.* FROM school_judge_jobs j WHERE j.school_id=s AND j.activity_id=aid AND j.kind='submit' AND j.state='completed' AND j.created_at<=j.activity_deadline_at AND (cutoff IS NULL OR j.created_at<=cutoff) ORDER BY j.created_at,j.id LOOP
    PERFORM school_scholarship_settle_result(s,'problem',row_job.id,'problem:'||row_job.problem_id,COALESCE(row_job.result->>'status','System Error'));
   END LOOP;
  END IF;
  IF rule.amount IS NULL OR rule.amount=0 THEN RETURN; END IF;
  SELECT sum(points),count(*) INTO total,required FROM school_activity_problems WHERE school_id=s AND activity_id=aid;
  FOR participant IN SELECT identity_id FROM school_activity_participants WHERE school_id=s AND activity_id=aid ORDER BY identity_id LOOP
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
