ALTER TABLE school_activities ADD COLUMN school_course_id uuid, ADD COLUMN platform_course_id uuid REFERENCES learning_paths(id),
 ADD CHECK(num_nonnulls(school_course_id,platform_course_id)<=1),
 ADD FOREIGN KEY(school_id,school_course_id) REFERENCES school_courses(school_id,id);
UPDATE school_activities a SET school_course_id=CASE WHEN p.owner_scope='school' THEN p.id END,
 platform_course_id=CASE WHEN p.owner_scope='platform' THEN p.id END
 FROM (SELECT id,school_id,course_path_id FROM assignments UNION ALL SELECT id,school_id,course_path_id FROM timed_practices) original
 JOIN learning_paths p ON p.id=original.course_path_id
 WHERE (a.school_id,a.id)=(original.school_id,original.id);
CREATE TABLE school_activity_result_revisions(
 school_id uuid NOT NULL, id uuid NOT NULL,activity_id uuid NOT NULL,revision integer NOT NULL,grades jsonb NOT NULL,
 reason text,actor_account_id uuid REFERENCES accounts(id),created_at timestamptz NOT NULL,
 PRIMARY KEY(school_id,id),UNIQUE(school_id,activity_id,revision),FOREIGN KEY(school_id,activity_id) REFERENCES school_activities(school_id,id)
);
INSERT INTO school_activity_result_revisions SELECT a.school_id,r.id,r.practice_id,r.revision,r.grades,r.reason,r.actor_account_id,r.created_at
 FROM timed_result_revisions r JOIN timed_practices a ON a.id=r.practice_id;
ALTER TABLE school_activity_result_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_activity_result_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON school_activity_result_revisions USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_classes ADD COLUMN leaderboard_fields jsonb;
UPDATE school_classes c SET leaderboard_fields=jsonb_build_object('solved',s.show_solved_problems,'attempts',s.show_attempts,'acRate',s.show_ac_rate)
 FROM class_leaderboard_settings s WHERE s.class_id=c.id;
UPDATE school_scholarship_settings SET display_fields=jsonb_build_object('solved',s.show_solved_problems,
 'attempts',s.show_attempts,'acRate',s.show_ac_rate,'scholarship',s.show_luq_balance)
 FROM leaderboard_settings s WHERE s.id AND school_id='00000000-0000-4000-8000-000000000052';
