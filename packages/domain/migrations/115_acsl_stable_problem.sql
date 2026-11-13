-- An audited ACSL correction updates the pinned programming problem. The
-- before/after judge definitions remain in the append-only correction log.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname,contype FROM pg_constraint
  WHERE conrelid='acsl_programming_revisions'::regclass
   AND (confrelid='school_problem_versions'::regclass OR
    pg_get_constraintdef(oid) IN ('UNIQUE (school_id, paper_id, before_programming_version_id)',
     'UNIQUE (school_id, paper_id, after_programming_version_id)',
     'CHECK ((before_programming_version_id <> after_programming_version_id))'))
 LOOP EXECUTE format('ALTER TABLE acsl_programming_revisions DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION protect_acsl_programming_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM acsl_papers WHERE school_id=OLD.school_id AND programming_version_id=OLD.id)
    OR EXISTS(SELECT 1 FROM acsl_programming_revisions WHERE school_id=OLD.school_id
      AND (before_programming_version_id=OLD.id OR after_programming_version_id=OLD.id)) THEN
  IF TG_OP='UPDATE' AND current_setting('role') NOT IN ('campus_app','campus_worker')
   AND pg_has_role(session_user,(SELECT relowner FROM pg_class WHERE oid=TG_RELID),'MEMBER')
   AND NEW.school_id=OLD.school_id AND NEW.id=OLD.id AND NEW.problem_id=OLD.problem_id
   AND NEW.draft_revision=OLD.draft_revision+1 AND EXISTS(
    SELECT 1 FROM acsl_programming_revisions a WHERE a.school_id=OLD.school_id AND a.problem_id=OLD.problem_id
      AND a.before_programming_version_id=OLD.id AND a.after_programming_version_id=NEW.id
      AND a.id::text=current_setting('campus.acsl_programming_correction',true)
      AND a.before_judge_definition=OLD.definition AND a.after_judge_definition=NEW.definition)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ACSL_PROGRAMMING_VERSION_IMMUTABLE';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
