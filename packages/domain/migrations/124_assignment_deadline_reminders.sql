ALTER TABLE student_system_notifications DROP CONSTRAINT student_system_notifications_kind_check;
ALTER TABLE student_system_notifications ADD CONSTRAINT student_system_notifications_kind_check CHECK
 (kind IN ('scholarship_grant','activity_reward','teacher_feedback','assignment_change','assignment_reminder'));
CREATE POLICY student_system_notifications_assignment_reminder ON student_system_notifications FOR INSERT
 TO campus_app, CURRENT_USER WITH CHECK (kind='assignment_reminder' AND
  (legacy_identity_id IS NOT NULL OR school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid));
