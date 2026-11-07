-- Public course access is granted to an account, including applicants with no school identity.
CREATE TABLE course_admission_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public_course_applications(id),
  recipient_account_id uuid NOT NULL REFERENCES accounts(id),
  listing_id uuid NOT NULL REFERENCES public_course_listings(id),
  outcome text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  course_title text NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz
);

CREATE INDEX course_admission_notifications_inbox_idx
  ON course_admission_notifications(recipient_account_id, created_at DESC, id DESC);

ALTER TABLE course_admission_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_admission_notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY course_admission_notifications_recipient ON course_admission_notifications FOR SELECT
  USING (recipient_account_id = NULLIF(current_setting('campus.account_notification_account_id', true), '')::uuid);

CREATE POLICY course_admission_notifications_read_state ON course_admission_notifications FOR UPDATE
  USING (recipient_account_id = NULLIF(current_setting('campus.account_notification_account_id', true), '')::uuid)
  WITH CHECK (recipient_account_id = NULLIF(current_setting('campus.account_notification_account_id', true), '')::uuid);

CREATE POLICY course_admission_notifications_review ON course_admission_notifications FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public_course_applications a
    WHERE a.id = course_admission_notifications.application_id
      AND a.school_id = NULLIF(current_setting('campus.course_admission_school_id', true), '')::uuid
      AND a.account_id = course_admission_notifications.recipient_account_id
      AND a.listing_id = course_admission_notifications.listing_id
      AND a.status = course_admission_notifications.outcome
      AND a.decided_at = course_admission_notifications.created_at
  ));
