-- Existing courses and assignments remain unrestricted. Prior qualifying
-- course work is retained when a published language policy changes.
ALTER TABLE learning_paths
 ADD COLUMN required_language text CHECK(required_language IN ('python','cpp','javascript')),
 ADD COLUMN published_required_language text CHECK(published_required_language IN ('python','cpp','javascript')),
 ADD COLUMN language_credit_cutoffs jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(language_credit_cutoffs)='object');
ALTER TABLE legacy_course_publication_versions
 ADD COLUMN required_language text CHECK(required_language IN ('python','cpp','javascript')),
 ADD COLUMN language_credit_cutoffs jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(language_credit_cutoffs)='object');
ALTER TABLE school_courses
 ADD COLUMN required_language text CHECK(required_language IN ('python','cpp','javascript'));
ALTER TABLE school_course_publications
 ADD COLUMN required_language text CHECK(required_language IN ('python','cpp','javascript')),
 ADD COLUMN language_credit_cutoffs jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(language_credit_cutoffs)='object');
ALTER TABLE assignments
 ADD COLUMN required_language text CHECK(required_language IN ('python','cpp','javascript'));
ALTER TABLE submissions
 ADD COLUMN required_language text CHECK(required_language IS NULL OR required_language=language);

-- Each cutoff records when that language was last eligible. Keep the
-- unrestricted cutoff separate so a later change cannot admit intervening
-- submissions that never satisfied any published policy.
CREATE FUNCTION course_language_credit_cutoffs(prior jsonb, old_language text, new_language text, changed_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN old_language IS NOT DISTINCT FROM new_language THEN prior
  ELSE prior || jsonb_build_object(COALESCE(old_language,'any'),changed_at) END
$$;

CREATE FUNCTION course_language_allows_credit(required text, cutoffs jsonb, language text, received_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT required IS NULL OR required=COALESCE(language,'python') OR COALESCE(received_at<GREATEST(
  (cutoffs->>'any')::timestamptz,(cutoffs->>COALESCE(language,'python'))::timestamptz),false)
$$;
