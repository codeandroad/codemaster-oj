-- Optional navigation structure; chapter identities, progress and grades remain intact.
ALTER TABLE learning_paths ADD COLUMN sections jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(sections)='array' AND jsonb_array_length(sections)<=100);
ALTER TABLE learning_chapters ADD COLUMN section_key text
 CHECK (section_key IS NULL OR section_key ~ '^[a-z][a-z0-9-]{0,59}$');
-- Public review snapshots retain the section metadata approved with their chapters.
ALTER TABLE legacy_course_publication_versions ADD COLUMN sections jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(sections)='array' AND jsonb_array_length(sections)<=100);
