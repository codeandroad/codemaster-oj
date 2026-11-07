-- Keep course editions immutable; catalogue properties are copied when published.
ALTER TABLE school_courses ADD COLUMN properties jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(properties)='object');
ALTER TABLE school_course_publications ADD COLUMN properties jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(properties)='object');
ALTER TABLE school_courses ADD COLUMN archived_at timestamptz;
CREATE TABLE school_learning_resources (
 school_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL,
 course_id uuid,
 chapter_id uuid,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200),
 type text NOT NULL CHECK(type IN ('note','article','reference')),
 scope text NOT NULL CHECK(scope IN ('school','private')),
 content text NOT NULL CHECK(char_length(content)<=100000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 create_request_id uuid NOT NULL,
 create_request_hash text NOT NULL,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id),
 UNIQUE(school_id,owner_account_id,create_request_id),
 FOREIGN KEY(school_id,owner_account_id) REFERENCES school_memberships(school_id,account_id),
 FOREIGN KEY(school_id,course_id) REFERENCES school_courses(school_id,id),
 CHECK(chapter_id IS NULL OR course_id IS NOT NULL)
);
ALTER TABLE school_learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_learning_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY school_learning_resources_scope ON school_learning_resources
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
CREATE INDEX school_learning_resources_course_idx ON school_learning_resources(school_id,course_id) WHERE deleted_at IS NULL;
