-- Optional translations and links share the original course/chapter identities.
-- No progress, grades, publications or reward rows are rewritten.
ALTER TABLE learning_paths ADD COLUMN localizations jsonb
 CHECK(localizations IS NULL OR jsonb_typeof(localizations)='object');
ALTER TABLE learning_chapters ADD COLUMN localizations jsonb
 CHECK(localizations IS NULL OR jsonb_typeof(localizations)='object');
ALTER TABLE learning_chapters ADD COLUMN acsl_links jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(acsl_links)='array' AND jsonb_array_length(acsl_links)<=100);
ALTER TABLE legacy_course_publication_versions ADD COLUMN localizations jsonb
 CHECK(localizations IS NULL OR jsonb_typeof(localizations)='object');
CREATE INDEX learning_chapters_acsl_links ON learning_chapters USING gin(acsl_links);
