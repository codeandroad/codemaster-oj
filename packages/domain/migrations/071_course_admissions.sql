-- The original school edits course rows in place. Explicit review freezes only
-- the student-facing chapter text at the reviewed source version.
CREATE TABLE legacy_course_publication_versions (
 school_id uuid NOT NULL REFERENCES schools(id)
   CHECK (school_id='00000000-0000-4000-8000-000000000052'),
 course_id uuid NOT NULL REFERENCES learning_paths(id),
 revision integer NOT NULL CHECK (revision > 0),
 source_version text NOT NULL,
 title text NOT NULL,
 description text NOT NULL,
 access_scope text NOT NULL CHECK (access_scope IN ('school','classes')),
 chapters jsonb NOT NULL CHECK (jsonb_typeof(chapters)='array' AND jsonb_array_length(chapters)>0),
 PRIMARY KEY (school_id, course_id, revision)
);
ALTER TABLE legacy_course_publication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_course_publication_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY legacy_course_publication_scope ON legacy_course_publication_versions
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);

-- Existing platform-approved listings keep direct access.
ALTER TABLE public_course_listings
 DROP CONSTRAINT public_course_listings_school_id_course_id_revision_fkey,
 ADD COLUMN access_mode text NOT NULL DEFAULT 'direct' CHECK (access_mode IN ('direct','application')),
 ADD COLUMN access_generation uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN school_revision integer GENERATED ALWAYS AS (
  CASE WHEN school_id<>'00000000-0000-4000-8000-000000000052'::uuid THEN revision END
 ) STORED,
 ADD COLUMN legacy_revision integer GENERATED ALWAYS AS (
  CASE WHEN school_id='00000000-0000-4000-8000-000000000052'::uuid THEN revision END
 ) STORED,
 ADD CONSTRAINT public_course_listing_school_unique UNIQUE (id, school_id),
 ADD FOREIGN KEY (school_id,course_id,school_revision)
   REFERENCES school_course_publications(school_id,course_id,revision),
 ADD FOREIGN KEY (school_id,course_id,legacy_revision)
   REFERENCES legacy_course_publication_versions(school_id,course_id,revision);

CREATE TABLE public_course_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 listing_id uuid NOT NULL,
 school_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision > 0),
 access_generation uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 decided_by uuid REFERENCES accounts(id),
 FOREIGN KEY (listing_id, school_id) REFERENCES public_course_listings(id, school_id),
 UNIQUE (listing_id, access_generation, account_id),
 CHECK ((status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
     OR (status <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);

CREATE INDEX public_course_applications_review_idx
 ON public_course_applications(school_id, listing_id, access_generation, created_at, id);

ALTER TABLE public_course_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_course_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY public_course_applications_read ON public_course_applications FOR SELECT
 USING (
  account_id = NULLIF(current_setting('campus.account_id',true),'')::uuid
  OR school_id = NULLIF(current_setting('campus.course_admission_school_id',true),'')::uuid
 );
CREATE POLICY public_course_applications_create ON public_course_applications FOR INSERT
 WITH CHECK (
  account_id = NULLIF(current_setting('campus.account_id',true),'')::uuid
  AND status = 'pending'
 );
CREATE POLICY public_course_applications_review ON public_course_applications FOR UPDATE
 USING (school_id = NULLIF(current_setting('campus.course_admission_school_id',true),'')::uuid)
 WITH CHECK (school_id = NULLIF(current_setting('campus.course_admission_school_id',true),'')::uuid);
