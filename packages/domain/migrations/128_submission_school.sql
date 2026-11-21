-- Preserve the school in which work was received, including after the author
-- graduates, unlinks a login or joins another school.
ALTER TABLE submissions ADD COLUMN school_id uuid REFERENCES schools(id);

UPDATE submissions s SET school_id=d.school_id
FROM legacy_school_identity_ownership d
WHERE d.identity_id=s.identity_id;

-- A row without a school dossier is private to its author. Its presence in a
-- problem bank alone does not authorize sharing it with the school's students.
CREATE FUNCTION bind_submission_school() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_school uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'A submission cannot change schools' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT school_id INTO source_school FROM school_identities
    WHERE id=NEW.identity_id AND account_id=NEW.account_id;
  IF source_school IS NULL THEN
    SELECT school_id INTO source_school FROM legacy_school_identity_ownership WHERE identity_id=NEW.identity_id;
  END IF;
  IF NEW.school_id IS NOT NULL AND NEW.school_id IS DISTINCT FROM source_school THEN
    RAISE EXCEPTION 'Submission school does not match the student dossier' USING ERRCODE='23514';
  END IF;
  NEW.school_id:=source_school;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_school_on_receipt BEFORE INSERT OR UPDATE OF school_id ON submissions
  FOR EACH ROW EXECUTE FUNCTION bind_submission_school();
CREATE INDEX submissions_school_problem_student ON submissions(school_id,problem_id,identity_id,created_at DESC,id DESC)
  WHERE kind='submit';
