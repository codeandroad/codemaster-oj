-- Institutional ownership is independent of the historical creator and of the
-- legacy storage school used by exercise/publication foreign keys.
ALTER TABLE learning_paths
 ADD COLUMN owner_scope text NOT NULL DEFAULT 'school' CHECK(owner_scope IN ('school','platform')),
 ADD COLUMN platform_access_scope text NOT NULL DEFAULT 'all' CHECK(platform_access_scope IN ('all','schools','students')),
 ADD COLUMN platform_school_ids uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN platform_student_ids uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN platform_revision integer NOT NULL DEFAULT 1 CHECK(platform_revision>0),
 ADD COLUMN platform_create_request_hash text,
 ADD CONSTRAINT platform_course_audience_shape CHECK (
   cardinality(platform_school_ids)<=500 AND cardinality(platform_student_ids)<=5000
   AND (platform_access_scope='schools' OR cardinality(platform_school_ids)=0)
   AND (platform_access_scope='students' OR cardinality(platform_student_ids)=0)
 );

-- Only the two explicitly requested sources move. Stable IDs, creators,
-- timestamps, editions, linked exercises and all student records are retained.
UPDATE learning_paths SET owner_scope='platform'
 WHERE school_id='00000000-0000-4000-8000-000000000052'
 AND title IN ('Python 专项训练 · 全目录学习路线','9618 Paper 4 Practical Programming with Python');

INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail)
 SELECT NULL,'platform.course.source_migrated',school_id,
 jsonb_build_object('courseId',id,'title',title,'previousOwnerAccountId',owner_account_id,'ownerScope','platform')
 FROM learning_paths WHERE owner_scope='platform';
