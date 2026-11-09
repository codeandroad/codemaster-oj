-- Retain the original judging snapshot for accepted work while an open
-- assignment can deliver a newer, equivalent version for future attempts.
ALTER TABLE assignment_problems
 ADD COLUMN prior_version_id uuid REFERENCES problem_versions(id),
 ADD CHECK (prior_version_id IS NULL OR prior_version_id <> version_id);

CREATE OR REPLACE FUNCTION protect_published_assignment_problems() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 assignment_id_to_check uuid;
 assignment_open boolean;
 latest_id uuid;
 original problem_versions;
 replacement problem_versions;
 original_cases jsonb;
 replacement_cases jsonb;
BEGIN
 IF TG_OP = 'INSERT' AND NEW.prior_version_id IS NOT NULL THEN
  RAISE EXCEPTION 'only an existing assignment problem can retain a prior version';
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.prior_version_id IS DISTINCT FROM OLD.prior_version_id THEN
  -- The migration owner can switch an open assignment to a judging-equivalent
  -- revision once. The ordinary application role cannot alter this history.
  IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
   OR OLD.prior_version_id IS NOT NULL OR NEW.prior_version_id IS DISTINCT FROM OLD.version_id
   OR ROW(NEW.assignment_id,NEW.problem_id,NEW.points,NEW.position)
    IS DISTINCT FROM ROW(OLD.assignment_id,OLD.problem_id,OLD.points,OLD.position) THEN
   RAISE EXCEPTION 'invalid assignment version upgrade';
  END IF;
  SELECT state='Published' AND archived_at IS NULL AND due_at>clock_timestamp()
   INTO assignment_open FROM assignments WHERE id=OLD.assignment_id FOR UPDATE;
  SELECT p.current_version_id INTO latest_id
   FROM problems p JOIN problem_banks b ON b.id=p.bank_id
   WHERE p.id=OLD.problem_id AND p.archived_at IS NULL AND b.archived_at IS NULL AND b.visibility='school'
   FOR SHARE OF p,b;
  SELECT * INTO original FROM problem_versions WHERE id=OLD.version_id AND problem_id=OLD.problem_id;
  SELECT * INTO replacement FROM problem_versions WHERE id=NEW.version_id AND problem_id=OLD.problem_id;
  IF assignment_open IS DISTINCT FROM true OR latest_id IS DISTINCT FROM NEW.version_id
   OR original.published_at IS NULL OR replacement.published_at IS NULL OR replacement.school_visible_at IS NULL
   OR replacement.rank_review_status <> 'approved'
   OR original.validation_status <> 'AC' OR replacement.validation_status <> 'AC'
   OR ROW(original.mode,original.function_name,original.comparator,original.time_limit_ms,original.memory_limit_mb,original.samples)
    IS DISTINCT FROM ROW(replacement.mode,replacement.function_name,replacement.comparator,replacement.time_limit_ms,replacement.memory_limit_mb,replacement.samples) THEN
   RAISE EXCEPTION 'assignment version upgrade requires equivalent judging rules and the current approved version';
  END IF;
  SELECT jsonb_agg(to_jsonb(t)-'id'-'version_id' ORDER BY position) INTO original_cases FROM test_cases t WHERE version_id=original.id;
  SELECT jsonb_agg(to_jsonb(t)-'id'-'version_id' ORDER BY position) INTO replacement_cases FROM test_cases t WHERE version_id=replacement.id;
  IF original_cases IS NULL OR original_cases IS DISTINCT FROM replacement_cases THEN
   RAISE EXCEPTION 'assignment version upgrade requires identical formal test cases';
  END IF;
  RETURN NEW;
 END IF;
 assignment_id_to_check := CASE WHEN TG_OP = 'INSERT' THEN NEW.assignment_id ELSE OLD.assignment_id END;
 IF EXISTS (
  SELECT 1 FROM assignments a
  WHERE a.id = assignment_id_to_check AND a.state = 'Published'
   AND EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.kind = 'submit')
 ) THEN
  RAISE EXCEPTION 'published assignment problems with formal submissions are immutable';
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.assignment_id <> OLD.assignment_id AND EXISTS (
  SELECT 1 FROM assignments a
  WHERE a.id = NEW.assignment_id AND a.state = 'Published'
   AND EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.kind = 'submit')
 ) THEN
  RAISE EXCEPTION 'published assignment problems with formal submissions are immutable';
 END IF;
 IF TG_OP = 'UPDATE' AND (
  NEW.version_id <> OLD.version_id OR NEW.problem_id <> OLD.problem_id OR NEW.assignment_id <> OLD.assignment_id
 ) AND EXISTS (
  SELECT 1 FROM assignments a
  WHERE a.id IN (OLD.assignment_id, NEW.assignment_id) AND a.state = 'Published'
   AND EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id)
 ) THEN
  RAISE EXCEPTION 'published assignment versions with activity are immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;


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
   WHERE s.assignment_id=activity AND s.identity_id=student AND s.problem_id=ap.problem_id AND (NOT rule.require_all OR s.version_id IN (ap.version_id,ap.prior_version_id)) AND s.kind='submit'
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
