ALTER TABLE assignments DROP CONSTRAINT assignments_school_id_check;
ALTER TABLE classes DROP CONSTRAINT classes_school_id_check;
ALTER TABLE learning_paths DROP CONSTRAINT learning_paths_school_id_check;
ALTER TABLE learning_resources DROP CONSTRAINT learning_resources_school_id_check;
ALTER TABLE paper4_papers DROP CONSTRAINT paper4_papers_school_id_check;
ALTER TABLE problem_banks DROP CONSTRAINT problem_banks_school_id_check;
ALTER TABLE timed_practices DROP CONSTRAINT timed_practices_school_id_check;
UPDATE site_settings SET settings=settings-'schoolName' WHERE settings?'schoolName';
DO $$
DECLARE c record; prefix text;
BEGIN
 FOR c IN SELECT conrelid::regclass relation,conname FROM pg_constraint
  WHERE conrelid IN ('assignment_preview_receipts'::regclass,'catalog_course_publication_history'::regclass) AND conname LIKE 'legacy_%'
 LOOP
  prefix:=CASE WHEN c.relation='assignment_preview_receipts'::regclass THEN 'assignment_preview_receipts_' ELSE 'catalog_course_history_' END;
  EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',c.relation,c.conname,
    prefix||regexp_replace(c.conname,'^legacy_(assignment_preview_submissions|course_publication_versions?)_',''));
 END LOOP;
END $$;
