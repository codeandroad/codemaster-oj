-- A class is an optional organization/source tag. Explicit participant rows
-- remain the sole audience of assignments and timed practice; historical
-- participants, submissions and grades are never expanded or rewritten.
ALTER TABLE assignments ALTER COLUMN class_id DROP NOT NULL;
ALTER TABLE timed_practices ALTER COLUMN class_id DROP NOT NULL;
CREATE TABLE assignment_classes (
 assignment_id uuid NOT NULL REFERENCES assignments(id),
 class_id uuid NOT NULL REFERENCES classes(id),
 PRIMARY KEY(assignment_id,class_id)
);
CREATE TABLE timed_practice_classes (
 practice_id uuid NOT NULL REFERENCES timed_practices(id),
 class_id uuid NOT NULL REFERENCES classes(id),
 PRIMARY KEY(practice_id,class_id)
);
INSERT INTO assignment_classes SELECT id,class_id FROM assignments WHERE class_id IS NOT NULL;
INSERT INTO timed_practice_classes SELECT id,class_id FROM timed_practices WHERE class_id IS NOT NULL;
CREATE INDEX assignment_classes_class_idx ON assignment_classes(class_id,assignment_id);
CREATE INDEX timed_practice_classes_class_idx ON timed_practice_classes(class_id,practice_id);
ALTER TABLE timed_practices ADD COLUMN course_path_id uuid REFERENCES learning_paths(id);

-- Notebook corrections can refer to earlier corrections. Resolve their
-- original activity without rewriting historical records; a malformed cycle
-- is unresolved and must never be treated as unrestricted free practice.
CREATE FUNCTION submission_activity_context(origin_id bigint)
 RETURNS TABLE(assignment_id uuid,timed_attempt_id uuid,resolved boolean)
 LANGUAGE sql STABLE STRICT AS $$
 WITH RECURSIVE lineage AS (
  SELECT s.id,s.original_submission_id,s.assignment_id,s.timed_attempt_id,ARRAY[s.id] visited
   FROM submissions s WHERE s.id=origin_id
  UNION ALL
  SELECT p.id,p.original_submission_id,COALESCE(l.assignment_id,p.assignment_id),
   COALESCE(l.timed_attempt_id,p.timed_attempt_id),l.visited||p.id
   FROM lineage l JOIN submissions p ON p.id=l.original_submission_id
   WHERE l.assignment_id IS NULL AND l.timed_attempt_id IS NULL AND NOT p.id=ANY(l.visited)
 )
 SELECT l.assignment_id,l.timed_attempt_id,
  (l.assignment_id IS NOT NULL OR l.timed_attempt_id IS NOT NULL OR l.original_submission_id IS NULL)
 FROM lineage l ORDER BY cardinality(l.visited) DESC LIMIT 1
$$;
