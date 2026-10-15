ALTER TABLE assignments ADD COLUMN course_path_id uuid REFERENCES learning_paths(id) ON DELETE SET NULL;
CREATE INDEX assignments_course_path_idx ON assignments(course_path_id) WHERE course_path_id IS NOT NULL;
