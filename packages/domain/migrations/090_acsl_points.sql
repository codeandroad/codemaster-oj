-- ACSL points are explicitly enabled for an exact edition in the original
-- school. They do not write scholarship wallets or ordinary problem ledgers.
CREATE TABLE acsl_point_rules (
 school_id uuid NOT NULL CHECK (school_id='00000000-0000-4000-8000-000000000052'),
 paper_id uuid NOT NULL, version_id uuid NOT NULL,
 written_points_per_correct integer NOT NULL DEFAULT 1 CHECK (written_points_per_correct BETWEEN 0 AND 1000),
 programming_points integer NOT NULL DEFAULT 10 CHECK (programming_points BETWEEN 0 AND 100000),
 enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,paper_id,version_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
CREATE TABLE acsl_point_awards (
 school_id uuid NOT NULL CHECK (school_id='00000000-0000-4000-8000-000000000052'),
 id uuid NOT NULL DEFAULT gen_random_uuid(), paper_id uuid NOT NULL, version_id uuid NOT NULL,
 identity_id uuid NOT NULL REFERENCES identities(id),
 section text NOT NULL CHECK (section IN ('written','programming')),
 grade_id uuid, job_id uuid, points integer NOT NULL CHECK (points>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,paper_id,identity_id,section),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id),
 FOREIGN KEY(school_id,grade_id) REFERENCES acsl_paper_grades(school_id,id),
 FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id),
 CHECK ((section='written' AND grade_id IS NOT NULL AND job_id IS NULL)
     OR (section='programming' AND job_id IS NOT NULL AND grade_id IS NULL))
);
CREATE TRIGGER acsl_point_awards_immutable BEFORE UPDATE OR DELETE ON acsl_point_awards
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE UNIQUE INDEX acsl_point_awards_grade ON acsl_point_awards(school_id,grade_id) WHERE grade_id IS NOT NULL;
CREATE UNIQUE INDEX acsl_point_awards_job ON acsl_point_awards(school_id,job_id) WHERE job_id IS NOT NULL;
CREATE INDEX acsl_point_awards_identity ON acsl_point_awards(identity_id,created_at,id);

-- Identity, amount and eligibility are frozen at formal enqueue. Only the
-- first terminal status and a later changed-status review marker are updated.
CREATE TABLE acsl_programming_point_receipts (
 school_id uuid NOT NULL CHECK (school_id='00000000-0000-4000-8000-000000000052'),
 job_id uuid NOT NULL, paper_id uuid NOT NULL, version_id uuid NOT NULL,
 identity_id uuid NOT NULL REFERENCES identities(id), points integer NOT NULL CHECK (points>=0),
 eligible boolean NOT NULL, received_at timestamptz NOT NULL,
 settled_status text, review_status text, review_detected_at timestamptz,
 PRIMARY KEY(school_id,job_id),
 FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
ALTER TABLE acsl_point_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_point_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_point_rules
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE acsl_programming_point_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_programming_point_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_programming_point_receipts
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE acsl_point_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_point_awards FORCE ROW LEVEL SECURITY;
-- Legacy totals share the original school ledgers and do not set a tenant GUC.
-- The table CHECK and this policy both restrict every row to that school.
CREATE POLICY legacy_scope ON acsl_point_awards
 USING (school_id='00000000-0000-4000-8000-000000000052')
 WITH CHECK (school_id='00000000-0000-4000-8000-000000000052');
REVOKE ALL ON acsl_point_rules,acsl_point_awards,acsl_programming_point_receipts FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_point_rules,acsl_point_awards TO campus_app;

CREATE FUNCTION acsl_point_student(actor uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.identity_id FROM accounts a
 JOIN identities i ON i.id=a.identity_id AND i.kind='student' AND i.archived_at IS NULL
 JOIN legacy_school_account_ownership o ON o.account_id=a.id
 JOIN legacy_school_identity_ownership io ON io.identity_id=i.id AND io.school_id=o.school_id
 WHERE a.id=actor AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
   AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student');
$$;
REVOKE ALL ON FUNCTION acsl_point_student(uuid) FROM PUBLIC,campus_app,campus_worker;

CREATE FUNCTION acsl_written_point_award() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; student uuid; rule acsl_point_rules;
BEGIN
 IF NEW.school_id<>'00000000-0000-4000-8000-000000000052' THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true);
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT * INTO rule FROM acsl_point_rules WHERE school_id=NEW.school_id AND paper_id=NEW.paper_id AND version_id=NEW.version_id AND enabled_at<=NEW.created_at;
 IF FOUND THEN
  student:=acsl_point_student(NEW.account_id);
  IF student IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('acsl-points:'||NEW.school_id||':'||NEW.paper_id||':'||student,0));
   INSERT INTO acsl_point_awards(school_id,paper_id,version_id,identity_id,section,grade_id,points)
    VALUES(NEW.school_id,NEW.paper_id,NEW.version_id,student,'written',NEW.id,NEW.correct_count*rule.written_points_per_correct)
    ON CONFLICT(school_id,paper_id,identity_id,section) DO NOTHING;
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION acsl_written_point_award() FROM PUBLIC,campus_app,campus_worker;
CREATE TRIGGER acsl_written_point_award AFTER INSERT ON acsl_paper_grades
 FOR EACH ROW EXECUTE FUNCTION acsl_written_point_award();

CREATE FUNCTION acsl_programming_point_award() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; student uuid; paper acsl_papers; rule acsl_point_rules;
 receipt acsl_programming_point_receipts; verdict text; prior_ac boolean;
BEGIN
 IF NEW.school_id<>'00000000-0000-4000-8000-000000000052' OR NEW.access_context<>'acsl' OR NEW.kind<>'submit' THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true);
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 IF TG_OP='INSERT' THEN
  SELECT * INTO paper FROM acsl_papers WHERE school_id=NEW.school_id
   AND programming_problem_id=NEW.problem_id AND programming_version_id=NEW.version_id AND enabled;
  IF FOUND THEN
   SELECT * INTO rule FROM acsl_point_rules WHERE school_id=NEW.school_id AND paper_id=paper.id
    AND version_id=paper.version_id AND enabled_at<=NEW.created_at;
   IF FOUND THEN
    student:=acsl_point_student(NEW.account_id);
    IF student IS NOT NULL THEN
     PERFORM pg_advisory_xact_lock(hashtextextended('acsl-points:'||NEW.school_id||':'||paper.id||':'||student,0));
     SELECT EXISTS (
      SELECT 1 FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
      LEFT JOIN acsl_programming_point_receipts r ON r.school_id=j.school_id AND r.job_id=j.id
      WHERE j.school_id=NEW.school_id AND j.problem_id=NEW.problem_id AND j.id<>NEW.id
       AND coalesce(r.identity_id,a.identity_id)=student AND j.access_context='acsl' AND j.kind='submit'
       AND j.state='completed' AND j.result->>'status'='AC'
     ) INTO prior_ac;
     INSERT INTO acsl_programming_point_receipts(school_id,job_id,paper_id,version_id,identity_id,points,eligible,received_at)
      VALUES(NEW.school_id,NEW.id,paper.id,paper.version_id,student,rule.programming_points,NOT prior_ac,NEW.created_at);
    END IF;
   END IF;
  END IF;
 ELSIF NEW.state='completed' THEN
  verdict:=NEW.result->>'status';
  IF verdict IN ('AC','WA','CE','RE','TLE','MLE','OLE') THEN
   SELECT * INTO receipt FROM acsl_programming_point_receipts WHERE school_id=NEW.school_id AND job_id=NEW.id FOR UPDATE;
   IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('acsl-points:'||NEW.school_id||':'||receipt.paper_id||':'||receipt.identity_id,0));
    IF receipt.settled_status IS NOT NULL THEN
     IF receipt.settled_status<>verdict AND receipt.review_status IS DISTINCT FROM verdict THEN
      UPDATE acsl_programming_point_receipts SET review_status=verdict,review_detected_at=clock_timestamp()
       WHERE school_id=NEW.school_id AND job_id=NEW.id;
     END IF;
    ELSE
     UPDATE acsl_programming_point_receipts SET settled_status=verdict WHERE school_id=NEW.school_id AND job_id=NEW.id;
     IF verdict='AC' AND receipt.eligible THEN
      -- An earlier unreceipted success is a baseline, including work accepted
      -- after this job was queued. Enabling rewards never pays historical ACs.
      SELECT EXISTS (
       SELECT 1 FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
       LEFT JOIN acsl_programming_point_receipts r ON r.school_id=j.school_id AND r.job_id=j.id
       WHERE j.school_id=NEW.school_id AND j.problem_id=NEW.problem_id AND j.id<>NEW.id
        AND coalesce(r.identity_id,a.identity_id)=receipt.identity_id AND j.access_context='acsl' AND j.kind='submit'
        AND j.state='completed' AND j.result->>'status'='AC' AND r.job_id IS NULL
      ) INTO prior_ac;
      IF NOT prior_ac THEN
       INSERT INTO acsl_point_awards(school_id,paper_id,version_id,identity_id,section,job_id,points)
        VALUES(NEW.school_id,receipt.paper_id,receipt.version_id,receipt.identity_id,'programming',NEW.id,receipt.points)
        ON CONFLICT(school_id,paper_id,identity_id,section) DO NOTHING;
      END IF;
     END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION acsl_programming_point_award() FROM PUBLIC,campus_app,campus_worker;
CREATE TRIGGER acsl_programming_point_receipt AFTER INSERT ON school_judge_jobs
 FOR EACH ROW EXECUTE FUNCTION acsl_programming_point_award();
CREATE TRIGGER acsl_programming_point_result AFTER UPDATE OF state,result ON school_judge_jobs
 FOR EACH ROW EXECUTE FUNCTION acsl_programming_point_award();
