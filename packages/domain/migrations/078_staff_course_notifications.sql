-- Applications are the source of the actionable notifications. Only read
-- receipts are stored separately, so older pending applications also appear.
CREATE TABLE staff_course_notification_reads (
  school_id uuid NOT NULL REFERENCES schools(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  application_id uuid NOT NULL REFERENCES public_course_applications(id),
  read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (school_id, account_id, application_id)
);

ALTER TABLE staff_course_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_course_notification_reads FORCE ROW LEVEL SECURITY;

CREATE POLICY staff_course_notification_reads_scope ON staff_course_notification_reads
  USING (
    school_id = NULLIF(current_setting('campus.course_admission_school_id', true), '')::uuid
    AND account_id = NULLIF(current_setting('campus.staff_notification_account_id', true), '')::uuid
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('campus.course_admission_school_id', true), '')::uuid
    AND account_id = NULLIF(current_setting('campus.staff_notification_account_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public_course_applications a
      WHERE a.id = application_id AND a.school_id = staff_course_notification_reads.school_id
    )
  );
