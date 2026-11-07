-- Platform-approved school course editions form the independent learning catalogue.
-- A school publication alone never grants global access. No legacy courses are copied.
CREATE TABLE public_course_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id uuid NOT NULL,
 course_id uuid NOT NULL,
 revision integer NOT NULL,
 approved_by uuid NOT NULL REFERENCES accounts(id),
 approved_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,
 UNIQUE(school_id,course_id),
 FOREIGN KEY(school_id,course_id,revision) REFERENCES school_course_publications(school_id,course_id,revision)
);
CREATE TABLE public_course_progress (
 listing_id uuid NOT NULL REFERENCES public_course_listings(id),
 account_id uuid NOT NULL REFERENCES accounts(id),
 chapter_id uuid NOT NULL,
 content_hash text NOT NULL,
 read boolean NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(listing_id,account_id,chapter_id)
);
ALTER TABLE public_course_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_course_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY public_course_progress_owner ON public_course_progress
 USING(account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid)
 WITH CHECK(account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid);
