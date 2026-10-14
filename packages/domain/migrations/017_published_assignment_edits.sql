-- Formal submissions lock the scored question list. Sample/custom runs do not
-- affect grades, so they permit set/points/order corrections, but even those
-- runs lock an existing question's pinned version for reproducibility.
ALTER TABLE assignments ADD COLUMN edit_revision integer NOT NULL DEFAULT 0 CHECK (edit_revision >= 0);

CREATE OR REPLACE FUNCTION protect_published_assignment_problems() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 assignment_id_to_check uuid;
BEGIN
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

DROP TRIGGER assignment_problems_immutable ON assignment_problems;
CREATE TRIGGER assignment_problems_immutable
 BEFORE INSERT OR UPDATE OR DELETE ON assignment_problems
 FOR EACH ROW EXECUTE FUNCTION protect_published_assignment_problems();
