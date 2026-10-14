-- Reports keep an explicit moderation decision. A deletion closes any
-- outstanding reports; a dismissal leaves the original message visible.
ALTER TABLE student_guestbook_reports
 ADD COLUMN resolved_at timestamptz,
 ADD COLUMN resolved_by_account_id uuid REFERENCES accounts(id),
 ADD COLUMN resolution text CHECK (resolution IN ('dismiss','delete')),
 ADD CONSTRAINT student_guestbook_report_resolution_complete CHECK (
  (resolved_at IS NULL AND resolved_by_account_id IS NULL AND resolution IS NULL) OR
  (resolved_at IS NOT NULL AND resolved_by_account_id IS NOT NULL AND resolution IS NOT NULL)
 );

UPDATE student_guestbook_reports r
 SET resolved_at=m.deleted_at,
     resolved_by_account_id=m.deleted_by_account_id,
     resolution='delete'
 FROM student_guestbook_messages m
 WHERE m.id=r.message_id AND m.deleted_at IS NOT NULL;

CREATE INDEX student_guestbook_reports_open_recent_idx
 ON student_guestbook_reports(created_at DESC,id DESC)
 WHERE resolution IS NULL;
