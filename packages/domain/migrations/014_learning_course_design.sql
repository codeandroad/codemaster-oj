ALTER TABLE learning_paths ADD COLUMN difficulty text NOT NULL DEFAULT 'beginner' CHECK(difficulty IN ('beginner','intermediate','advanced'));
ALTER TABLE learning_paths ADD COLUMN cover_key text NOT NULL DEFAULT 'general' CHECK(cover_key IN ('python','algorithms','general'));
ALTER TABLE learning_paths ADD COLUMN practice_bundle jsonb NOT NULL DEFAULT '[]';
CREATE INDEX learning_formal_task_progress_idx ON submissions(identity_id,version_id) WHERE kind IN ('submit','correction') AND status='AC';
