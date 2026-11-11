-- Activity membership is problem-level. Published problem revisions affect new
-- attempts, while every admitted submission keeps its original judging snapshot.
-- Preserve receipts and award idempotency; do not backfill or recalculate awards.
-- This migration's immutable schema_migrations.applied_at also establishes the
-- compatibility boundary for cross-activity mastery in assignment-grades.mjs.
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
   WHERE s.assignment_id=activity AND s.identity_id=student AND s.problem_id=ap.problem_id AND s.kind='submit'
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
