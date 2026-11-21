ALTER TABLE student_system_notifications DROP CONSTRAINT student_system_notifications_check;
UPDATE student_system_notifications SET school_identity_id=legacy_identity_id WHERE legacy_identity_id IS NOT NULL;
ALTER TABLE student_system_notifications ALTER COLUMN school_identity_id SET NOT NULL;
DROP POLICY student_system_notifications_recipient ON student_system_notifications;
DROP POLICY student_system_notifications_read_state ON student_system_notifications;
DROP POLICY student_system_notifications_feedback ON student_system_notifications;
DROP POLICY student_system_notifications_assignment_change ON student_system_notifications;
DROP POLICY student_system_notifications_assignment_reminder ON student_system_notifications;
ALTER TABLE student_system_notifications DROP COLUMN legacy_identity_id,
 ADD UNIQUE(school_id,school_identity_id,kind,source_key);
CREATE INDEX student_system_notifications_inbox_idx ON student_system_notifications(school_id,school_identity_id,created_at DESC,id DESC);
CREATE POLICY student_system_notifications_recipient ON student_system_notifications FOR SELECT TO campus_app,CURRENT_USER
 USING(school_id=NULLIF(current_setting('campus.notification_school_id',true),'')::uuid AND school_identity_id=NULLIF(current_setting('campus.notification_identity_id',true),'')::uuid);
CREATE POLICY student_system_notifications_read_state ON student_system_notifications FOR UPDATE TO campus_app,CURRENT_USER
 USING(school_id=NULLIF(current_setting('campus.notification_school_id',true),'')::uuid AND school_identity_id=NULLIF(current_setting('campus.notification_identity_id',true),'')::uuid);
CREATE POLICY school_notifications_issue ON student_system_notifications FOR INSERT TO campus_app,CURRENT_USER
 WITH CHECK(kind IN ('assignment_change','assignment_reminder','teacher_feedback') AND school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
DROP TRIGGER luq_ledger_student_award_notice ON luq_ledger;

CREATE OR REPLACE FUNCTION notify_student_scholarship_ledger() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE activity_title text; details jsonb:=jsonb_build_object('amount',NEW.delta);
BEGIN
 IF NEW.kind='admin_grant' THEN details:=details||jsonb_build_object('reason',NEW.reason);
 ELSIF split_part(NEW.source_key,':',2)='activity' THEN
  SELECT title INTO activity_title FROM school_activities WHERE school_id=NEW.school_id AND id::text=NEW.metadata->>'activityId';
 ELSIF split_part(NEW.source_key,':',2)='paper4_activity' THEN
  SELECT v.content->>'title' INTO activity_title FROM school_paper4_activities a JOIN school_paper4_versions v ON (v.school_id,v.id)=(a.school_id,a.version_id)
   WHERE a.school_id=NEW.school_id AND a.id::text=NEW.metadata->>'activityId';
 END IF;
 INSERT INTO student_system_notifications(school_id,school_identity_id,kind,source_key,data)
  VALUES(NEW.school_id,NEW.identity_id,CASE WHEN NEW.kind='admin_grant' THEN 'scholarship_grant' ELSE 'activity_reward' END,
  NEW.id::text,details||jsonb_strip_nulls(jsonb_build_object('activityTitle',activity_title)));
 RETURN NULL;
END $$;
-- Already approved snapshots of a course subsequently transferred to the
-- platform remain archival editions. They cannot publish its current source.
ALTER TABLE public_course_listings DROP COLUMN school_revision,DROP COLUMN legacy_revision;
ALTER TABLE legacy_course_publication_versions RENAME TO catalog_course_publication_history;
ALTER TABLE catalog_course_publication_history DROP CONSTRAINT legacy_course_publication_versions_school_id_check;
ALTER POLICY legacy_course_publication_scope ON catalog_course_publication_history RENAME TO school_scope;
ALTER TABLE public_course_listings ADD COLUMN catalog_revision integer;
UPDATE public_course_listings l SET catalog_revision=l.revision
 WHERE EXISTS(SELECT 1 FROM catalog_course_publication_history h WHERE (h.school_id,h.course_id,h.revision)=(l.school_id,l.course_id,l.revision));
ALTER TABLE public_course_listings ADD COLUMN school_revision integer GENERATED ALWAYS AS (CASE WHEN catalog_revision IS NULL THEN revision END) STORED,
 ADD CHECK(catalog_revision IS NULL OR catalog_revision=revision),
 ADD FOREIGN KEY(school_id,course_id,catalog_revision) REFERENCES catalog_course_publication_history(school_id,course_id,revision),
 ADD FOREIGN KEY(school_id,course_id,school_revision) REFERENCES school_course_publications(school_id,course_id,revision);
