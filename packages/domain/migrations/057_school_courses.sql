-- School courses are isolated from legacy teaching and judge resources.
CREATE TABLE school_courses (
 school_id uuid NOT NULL REFERENCES schools(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 owner_account_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=4000),
 access_scope text NOT NULL CHECK(access_scope IN ('school','classes')),
 chapters jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(chapters)='array'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 published_revision integer,
 published boolean NOT NULL DEFAULT false,
 create_request_id uuid NOT NULL,
 create_request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id),
 UNIQUE(school_id,owner_account_id,create_request_id),
 FOREIGN KEY(school_id,owner_account_id) REFERENCES school_memberships(school_id,account_id),
 CHECK(school_id<>'00000000-0000-4000-8000-000000000052'),
 CHECK(NOT published OR published_revision IS NOT NULL)
);
CREATE TABLE school_course_classes (
 school_id uuid NOT NULL, course_id uuid NOT NULL, class_id uuid NOT NULL,
 PRIMARY KEY(school_id,course_id,class_id),
 FOREIGN KEY(school_id,course_id) REFERENCES school_courses(school_id,id),
 FOREIGN KEY(school_id,class_id) REFERENCES school_classes(school_id,id)
);
CREATE TABLE school_course_publications (
 school_id uuid NOT NULL, course_id uuid NOT NULL, revision integer NOT NULL,
 title text NOT NULL, description text NOT NULL, access_scope text NOT NULL CHECK(access_scope IN ('school','classes')),
 chapters jsonb NOT NULL CHECK(jsonb_typeof(chapters)='array'),
 published_by uuid NOT NULL REFERENCES accounts(id), published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,course_id,revision),
 FOREIGN KEY(school_id,course_id) REFERENCES school_courses(school_id,id)
);
ALTER TABLE school_courses ADD CONSTRAINT school_courses_published_revision_fk
 FOREIGN KEY(school_id,id,published_revision) REFERENCES school_course_publications(school_id,course_id,revision);
CREATE TABLE school_course_publication_classes (
 school_id uuid NOT NULL, course_id uuid NOT NULL, revision integer NOT NULL, class_id uuid NOT NULL,
 PRIMARY KEY(school_id,course_id,revision,class_id),
 FOREIGN KEY(school_id,course_id,revision) REFERENCES school_course_publications(school_id,course_id,revision),
 FOREIGN KEY(school_id,class_id) REFERENCES school_classes(school_id,id)
);
CREATE TABLE school_course_progress (
 school_id uuid NOT NULL, course_id uuid NOT NULL, identity_id uuid NOT NULL, chapter_id uuid NOT NULL,
 content_hash text NOT NULL, read boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,course_id,identity_id,chapter_id),
 FOREIGN KEY(school_id,course_id) REFERENCES school_courses(school_id,id),
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE INDEX school_courses_owner_idx ON school_courses(school_id,owner_account_id,created_at DESC,id);

-- Every request uses SET LOCAL through set_config(..., true). Missing context
-- denies access, including when a pooled connection is reused after commit.
ALTER TABLE school_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_courses FORCE ROW LEVEL SECURITY;
CREATE POLICY school_courses_scope ON school_courses
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_course_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_course_classes FORCE ROW LEVEL SECURITY;
CREATE POLICY school_course_classes_scope ON school_course_classes
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_course_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_course_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY school_course_publications_scope ON school_course_publications
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_course_publication_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_course_publication_classes FORCE ROW LEVEL SECURITY;
CREATE POLICY school_course_publication_classes_scope ON school_course_publication_classes
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
ALTER TABLE school_course_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_course_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY school_course_progress_scope ON school_course_progress
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
