-- Retain the verified number used for an inline creation, including after
-- later roster corrections, so retries refer to the original decision.
ALTER TABLE school_join_requests
  ADD COLUMN created_student_number text,
  DROP CONSTRAINT school_join_requests_check4,
  ADD CONSTRAINT school_join_created_student CHECK (created_student_number IS NULL OR
    (kind='student' AND status='approved' AND char_length(btrim(created_student_number)) BETWEEN 1 AND 64
     AND (number IS NULL OR number=created_student_number))),
  ADD CONSTRAINT school_join_verified_approval CHECK ((verification_method IS NOT NULL)=
    (status='approved' AND (number IS NULL OR created_student_number IS NOT NULL)));
GRANT UPDATE(created_student_number) ON school_join_requests TO campus_app;
