ALTER TABLE school_activities ADD COLUMN subject_label text NOT NULL DEFAULT '',
 ADD COLUMN problem_order text NOT NULL DEFAULT 'custom' CHECK (problem_order IN ('course','custom'));
SELECT set_config('campus.school_id','00000000-0000-4000-8000-000000000052',true);
UPDATE school_activities a SET subject_label=old.course,problem_order=old.problem_order
 FROM assignments old WHERE a.school_id=old.school_id AND a.id=old.id AND a.kind='assignment';
ALTER TABLE school_activity_problems DROP CONSTRAINT school_activity_problems_points_check,
 ALTER COLUMN points TYPE numeric(6,2), ADD CHECK(points>0 AND points<=1000);

-- Award on a new formal school result. Historical awards and deadlines are authoritative.
CREATE FUNCTION school_assignment_problem_award() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pin record; used integer; week_start timestamptz; entry_key text;
BEGIN
 IF NEW.source_kind<>'problem' OR NEW.status<>'AC' THEN RETURN NEW; END IF;
 SELECT j.school_id,j.activity_id,j.problem_id,j.identity_id,p.reward_points INTO pin
 FROM school_judge_jobs j
 JOIN school_activities a ON (a.school_id,a.id)=(j.school_id,j.activity_id)
 JOIN school_activity_problems p ON (p.school_id,p.activity_id,p.problem_id,p.version_id)=(j.school_id,j.activity_id,j.problem_id,j.version_id)
 JOIN school_activity_participants part ON (part.school_id,part.activity_id,part.identity_id)=(j.school_id,j.activity_id,j.identity_id)
 WHERE j.school_id=NEW.school_id AND j.id=NEW.job_id AND a.kind='assignment' AND a.published_at IS NOT NULL
 AND j.access_context='school' AND j.kind='submit' AND NOT part.exempt AND p.reward_points>0
 AND (j.activity_deadline_at IS NULL OR j.created_at<=j.activity_deadline_at) AND (a.cancelled_at IS NULL OR j.created_at<=a.cancelled_at);
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||pin.school_id||':'||pin.identity_id,0));
 entry_key:='assignment-problem:'||pin.activity_id||':'||pin.problem_id||':'||pin.identity_id;
 IF EXISTS(SELECT 1 FROM school_scholarship_ledger WHERE school_id=pin.school_id AND source_key=entry_key)
 OR EXISTS(SELECT 1 FROM point_ledger WHERE assignment_id=pin.activity_id AND problem_id=pin.problem_id AND identity_id=pin.identity_id AND reason='assignment')
 OR EXISTS(SELECT 1 FROM submissions s JOIN school_activity_participants part ON (part.school_id,part.activity_id,part.identity_id)=(s.school_id,s.assignment_id,s.identity_id)
   JOIN school_activities a ON (a.school_id,a.id)=(part.school_id,part.activity_id)
   WHERE s.school_id=pin.school_id AND s.assignment_id=pin.activity_id AND s.identity_id=pin.identity_id AND s.problem_id=pin.problem_id
   AND s.kind='submit' AND s.status='AC' AND s.created_at<=coalesce(s.luq_activity_deadline,greatest(a.ends_at,part.extended_due_at),'infinity'))
 OR EXISTS(SELECT 1 FROM school_scholarship_results r JOIN school_judge_jobs j ON j.id=r.job_id AND j.school_id=r.school_id
   WHERE j.school_id=pin.school_id AND j.activity_id=pin.activity_id AND j.identity_id=pin.identity_id AND j.problem_id=pin.problem_id
   AND j.kind='submit' AND r.source_kind='problem' AND r.status='AC' AND j.id<>NEW.job_id
   AND (j.activity_deadline_at IS NULL OR j.created_at<=j.activity_deadline_at)) THEN RETURN NEW; END IF;
 week_start:=date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
 SELECT coalesce(sum(delta),0) INTO used FROM school_scholarship_ledger WHERE school_id=pin.school_id AND identity_id=pin.identity_id
 AND kind='activity' AND source_key LIKE 'assignment-problem:%' AND created_at>=week_start;
 SELECT used+coalesce(sum(l.points),0) INTO used FROM point_ledger l JOIN assignments a ON a.id=l.assignment_id
 WHERE a.school_id=pin.school_id AND l.identity_id=pin.identity_id AND l.reason='assignment' AND l.created_at>=week_start;
 IF used<200 THEN
  PERFORM school_scholarship_entry(pin.school_id,pin.identity_id,least(200-used,pin.reward_points),'activity',entry_key,NULL,
   'Assignment problem scholarship',jsonb_build_object('activityId',pin.activity_id,'problemId',pin.problem_id));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION school_assignment_problem_award() FROM PUBLIC;
CREATE TRIGGER school_assignment_problem_award AFTER INSERT ON school_scholarship_results
 FOR EACH ROW EXECUTE FUNCTION school_assignment_problem_award();

CREATE TABLE school_assignment_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id uuid NOT NULL REFERENCES schools(id), job_id uuid NOT NULL,
 author_account_id uuid NOT NULL REFERENCES accounts(id),
 note text NOT NULL CHECK (length(note) BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id)
);
CREATE INDEX school_assignment_feedback_job ON school_assignment_feedback(school_id,job_id,created_at);
ALTER TABLE school_assignment_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_assignment_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY school_feedback_scope ON school_assignment_feedback
 USING(school_id=nullif(current_setting('campus.school_id',true),'')::uuid);
