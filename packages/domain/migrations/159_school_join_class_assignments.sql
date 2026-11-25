-- Keep the original approval independent of later roster edits when a reviewer retries.
ALTER TABLE school_join_requests
  ADD COLUMN created_class_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT school_join_created_classes CHECK (cardinality(created_class_ids)=0 OR created_student_number IS NOT NULL);
GRANT UPDATE(created_class_ids) ON school_join_requests TO campus_app;
