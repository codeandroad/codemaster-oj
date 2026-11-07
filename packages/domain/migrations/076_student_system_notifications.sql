CREATE TABLE student_system_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  legacy_identity_id uuid REFERENCES identities(id),
  school_identity_id uuid,
  kind text NOT NULL CHECK (kind IN ('scholarship_grant', 'activity_reward', 'teacher_feedback')),
  source_key text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  FOREIGN KEY (school_id, school_identity_id) REFERENCES school_identities(school_id, id),
  CHECK ((school_id = '00000000-0000-4000-8000-000000000052' AND legacy_identity_id IS NOT NULL AND school_identity_id IS NULL)
      OR (school_id <> '00000000-0000-4000-8000-000000000052' AND legacy_identity_id IS NULL AND school_identity_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (school_id, legacy_identity_id, school_identity_id, kind, source_key)
);

CREATE INDEX student_system_notifications_inbox_idx ON student_system_notifications
  (school_id, COALESCE(legacy_identity_id, school_identity_id), created_at DESC, id DESC);

ALTER TABLE student_system_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_system_notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY student_system_notifications_recipient ON student_system_notifications FOR SELECT
  TO campus_app, CURRENT_USER
  USING (school_id = NULLIF(current_setting('campus.notification_school_id', true), '')::uuid
    AND COALESCE(legacy_identity_id, school_identity_id) = NULLIF(current_setting('campus.notification_identity_id', true), '')::uuid);

CREATE POLICY student_system_notifications_read_state ON student_system_notifications FOR UPDATE
  TO campus_app, CURRENT_USER
  USING (school_id = NULLIF(current_setting('campus.notification_school_id', true), '')::uuid
    AND COALESCE(legacy_identity_id, school_identity_id) = NULLIF(current_setting('campus.notification_identity_id', true), '')::uuid);

CREATE POLICY student_system_notifications_feedback ON student_system_notifications FOR INSERT
  TO campus_app, CURRENT_USER
  WITH CHECK (kind = 'teacher_feedback' AND legacy_identity_id IS NOT NULL);

CREATE POLICY student_system_notifications_awards ON student_system_notifications FOR INSERT
  TO CURRENT_USER WITH CHECK (kind IN ('scholarship_grant', 'activity_reward'));

CREATE FUNCTION notify_student_scholarship_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  notification_kind text;
  notification_data jsonb;
  target_school uuid;
  legacy_identity uuid;
  school_identity uuid;
  activity_id uuid;
  activity_type text;
  activity_title text;
BEGIN
  notification_kind := CASE WHEN NEW.kind = 'admin_grant' THEN 'scholarship_grant' ELSE 'activity_reward' END;
  notification_data := jsonb_build_object('amount', NEW.delta);
  IF NEW.kind = 'admin_grant' THEN
    notification_data := notification_data || jsonb_build_object('reason', NEW.reason);
  ELSIF NEW.metadata->>'activityId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    activity_id := (NEW.metadata->>'activityId')::uuid;
  END IF;

  IF TG_TABLE_NAME = 'luq_ledger' THEN
    target_school := '00000000-0000-4000-8000-000000000052';
    legacy_identity := NEW.identity_id;
    IF activity_id IS NOT NULL THEN
      activity_type := NEW.metadata->>'activityType';
      CASE activity_type
        WHEN 'assignment' THEN SELECT title INTO activity_title FROM assignments WHERE id = activity_id;
        WHEN 'timed' THEN SELECT title INTO activity_title FROM timed_practices WHERE id = activity_id;
        WHEN 'paper4_activity' THEN SELECT title INTO activity_title FROM paper4_papers WHERE id = activity_id;
        ELSE NULL;
      END CASE;
    END IF;
  ELSE
    target_school := NEW.school_id;
    school_identity := NEW.identity_id;
    IF activity_id IS NOT NULL THEN
      activity_type := split_part(NEW.source_key, ':', 2);
      IF activity_type = 'activity' THEN
        SELECT title INTO activity_title FROM school_activities WHERE school_id = target_school AND id = activity_id;
      ELSIF activity_type = 'paper4_activity' THEN
        SELECT version.content->>'title' INTO activity_title
        FROM school_paper4_activities activity
        JOIN school_paper4_versions version ON version.school_id = activity.school_id AND version.id = activity.version_id
        WHERE activity.school_id = target_school AND activity.id = activity_id;
      END IF;
    END IF;
  END IF;

  IF activity_title IS NOT NULL THEN
    notification_data := notification_data || jsonb_build_object('activityTitle', activity_title);
  END IF;
  INSERT INTO student_system_notifications(school_id, legacy_identity_id, school_identity_id, kind, source_key, data)
    VALUES (target_school, legacy_identity, school_identity, notification_kind, NEW.id::text, notification_data);
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION notify_student_scholarship_ledger() FROM PUBLIC, campus_app, campus_worker;

CREATE TRIGGER luq_ledger_student_award_notice
  AFTER INSERT ON luq_ledger FOR EACH ROW
  WHEN (NEW.kind IN ('admin_grant', 'activity') AND NEW.delta > 0)
  EXECUTE FUNCTION notify_student_scholarship_ledger();

CREATE TRIGGER school_scholarship_ledger_student_award_notice
  AFTER INSERT ON school_scholarship_ledger FOR EACH ROW
  WHEN (NEW.kind IN ('admin_grant', 'activity') AND NEW.delta > 0)
  EXECUTE FUNCTION notify_student_scholarship_ledger();
