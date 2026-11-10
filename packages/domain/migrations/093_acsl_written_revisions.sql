-- A semantic wording repair keeps grading/version identities, but requires
-- unfinished answers to be confirmed against the revised question.
ALTER TABLE acsl_papers
 ADD COLUMN written_revision uuid,
 ADD COLUMN written_revision_at timestamptz,
 ADD COLUMN written_changed_question_ids text[] NOT NULL DEFAULT '{}',
 ADD COLUMN written_question_revisions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(written_question_revisions)='object'),
 ADD CHECK ((written_revision IS NULL)=(written_revision_at IS NULL));
ALTER TABLE acsl_presentation_updates
 ADD COLUMN written_revision uuid,
 ADD COLUMN changed_question_ids text[] NOT NULL DEFAULT '{}';

-- Existing grades are frozen by the owner repair transaction before wording
-- changes. Future grades on a revised paper are frozen by the insert trigger.
CREATE TABLE acsl_grade_question_snapshots (
 school_id uuid NOT NULL, grade_id uuid NOT NULL, written_revision uuid NOT NULL,
 questions jsonb NOT NULL CHECK (jsonb_typeof(questions)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,grade_id),
 FOREIGN KEY(school_id,grade_id) REFERENCES acsl_paper_grades(school_id,id)
);
-- Retired individual verdicts have no student-facing result route. Preserve
-- their original question meaning as owner-only audit evidence as well.
CREATE TABLE acsl_submission_question_snapshots (
 school_id uuid NOT NULL, submission_id uuid NOT NULL, written_revision uuid NOT NULL,
 question jsonb NOT NULL CHECK (jsonb_typeof(question)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,submission_id),
 FOREIGN KEY(school_id,submission_id) REFERENCES acsl_submissions(school_id,id)
);
DO $$ DECLARE table_name text; BEGIN
 FOR table_name IN SELECT unnest(ARRAY['acsl_grade_question_snapshots','acsl_submission_question_snapshots']) LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only()',table_name||'_immutable',table_name);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY school_scope ON %I USING (school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid) WITH CHECK (school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid)',table_name);
 END LOOP;
END $$;
REVOKE ALL ON acsl_grade_question_snapshots,acsl_submission_question_snapshots FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_grade_question_snapshots TO campus_app;

CREATE FUNCTION acsl_freeze_graded_questions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; paper acsl_papers;
BEGIN
 previous_scope:=current_setting('campus.school_id',true);
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT * INTO STRICT paper FROM acsl_papers
  WHERE school_id=NEW.school_id AND id=NEW.paper_id AND version_id=NEW.version_id;
 IF paper.written_revision IS NOT NULL THEN
  INSERT INTO acsl_grade_question_snapshots(school_id,grade_id,written_revision,questions)
   VALUES(NEW.school_id,NEW.id,paper.written_revision,paper.definition->'questions');
 END IF;
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION acsl_freeze_graded_questions() FROM PUBLIC,campus_app,campus_worker;
CREATE TRIGGER acsl_freeze_graded_questions AFTER INSERT ON acsl_paper_grades
 FOR EACH ROW EXECUTE FUNCTION acsl_freeze_graded_questions();
