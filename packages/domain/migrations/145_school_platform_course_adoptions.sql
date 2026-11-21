-- Adoption adds a catalogue entry for a school. Course admission is still
-- evaluated against the platform course's own publication and audience rules.
CREATE TABLE school_platform_course_adoptions (
 school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 course_id uuid NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
 PRIMARY KEY (school_id, course_id)
);

REVOKE ALL ON school_platform_course_adoptions FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON school_platform_course_adoptions TO campus_app;

INSERT INTO school_platform_course_adoptions (school_id, course_id)
SELECT s.id, p.id
FROM schools s CROSS JOIN learning_paths p
WHERE s.id = '00000000-0000-4000-8000-000000000052'
 -- The independently seeded pilot has its own ID for this course.
 AND p.id IN ('743d18d3-50b7-4b25-8841-9bab5ed06285','d088799f-ca20-42ab-ad5a-8ed9aa47b243')
 AND p.owner_scope = 'platform';
