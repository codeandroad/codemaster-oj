-- Preserve source courses as read-only aliases; chapter identities and progress remain intact.
ALTER TABLE learning_paths ADD COLUMN merged_into_id uuid REFERENCES learning_paths(id);
ALTER TABLE learning_paths ADD COLUMN merged_first_chapter_id uuid REFERENCES learning_chapters(id);
ALTER TABLE learning_paths ADD CONSTRAINT learning_paths_merge_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);
ALTER TABLE learning_paths ADD CONSTRAINT learning_paths_merge_archived CHECK (merged_into_id IS NULL OR (archived_at IS NOT NULL AND published_at IS NULL));
CREATE INDEX learning_paths_merged_into_idx ON learning_paths(merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE TABLE learning_course_merges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_path_id uuid NOT NULL REFERENCES learning_paths(id),
 actor_account_id uuid NOT NULL REFERENCES accounts(id),
 request_hash text NOT NULL,
 plan_hash text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL,
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- A resource editor can have read its old course before a concurrent merge.
-- Recheck the parent while holding a lock so that delayed writes cannot attach
-- new resources or chapters to a source course after it has become an alias.
CREATE FUNCTION reject_merged_learning_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_merge uuid;
BEGIN
 IF NEW.path_id IS NOT NULL THEN
  SELECT merged_into_id INTO parent_merge FROM learning_paths WHERE id=NEW.path_id FOR SHARE;
  IF parent_merge IS NOT NULL THEN
   RAISE EXCEPTION 'Merged courses cannot receive chapters or resources' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER learning_chapters_merge_parent BEFORE INSERT OR UPDATE OF path_id ON learning_chapters
 FOR EACH ROW EXECUTE FUNCTION reject_merged_learning_parent();
CREATE TRIGGER learning_resources_merge_parent BEFORE INSERT OR UPDATE OF path_id,chapter_id ON learning_resources
 FOR EACH ROW EXECUTE FUNCTION reject_merged_learning_parent();
