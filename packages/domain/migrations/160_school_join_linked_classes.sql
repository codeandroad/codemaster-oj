-- NULL denotes approval without a class selection, including historical approvals.
-- An empty selection explicitly clears active classes on the linked student record.
ALTER TABLE school_join_requests
  ADD COLUMN linked_class_ids uuid[],
  ADD CONSTRAINT school_join_linked_classes CHECK (
    linked_class_ids IS NULL OR (kind='student' AND status='approved' AND created_student_number IS NULL)
  );
GRANT UPDATE(linked_class_ids) ON school_join_requests TO campus_app;
