-- Whole-section grades are new immutable snapshots. Historical per-question
-- submissions remain stored but do not confer whole-paper grading or reveal access.
CREATE TABLE acsl_paper_grades (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 paper_id uuid NOT NULL, version_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id),
 answers jsonb NOT NULL CHECK (jsonb_typeof(answers)='array'),
 correct_count integer NOT NULL CHECK (correct_count>=0),
 question_count integer NOT NULL CHECK (question_count>0 AND correct_count<=question_count),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,paper_id,version_id,account_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
ALTER TABLE acsl_paper_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_paper_grades FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_paper_grades
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
REVOKE ALL ON acsl_paper_grades FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT ON acsl_paper_grades TO campus_app;

-- The retired per-question route cannot append new historical verdicts.
REVOKE INSERT ON acsl_submissions FROM campus_app;
