CREATE INDEX school_platform_course_adoptions_course_idx ON school_platform_course_adoptions(course_id);

ALTER TABLE school_platform_course_adoptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_platform_course_adoptions_read ON school_platform_course_adoptions
 FOR SELECT TO campus_app USING (true);
CREATE POLICY school_platform_course_adoptions_insert ON school_platform_course_adoptions
 FOR INSERT TO campus_app WITH CHECK (EXISTS (
  SELECT 1 FROM platform_admins
  WHERE account_id = NULLIF(current_setting('campus.account_id', true), '')::uuid AND revoked_at IS NULL
 ));
CREATE POLICY school_platform_course_adoptions_delete ON school_platform_course_adoptions
 FOR DELETE TO campus_app USING (EXISTS (
  SELECT 1 FROM platform_admins
  WHERE account_id = NULLIF(current_setting('campus.account_id', true), '')::uuid AND revoked_at IS NULL
 ));

GRANT INSERT,DELETE ON school_platform_course_adoptions TO campus_app;
