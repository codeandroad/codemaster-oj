-- Keep Paper 4 versions, attempts, submissions and teacher marks intact when a
-- paper is retired from the student list. Restoring only clears this flag.
ALTER TABLE paper4_papers ADD COLUMN archived_at timestamptz;
CREATE INDEX paper4_papers_visible_idx
 ON paper4_papers(class_id,created_at DESC) WHERE status='published' AND archived_at IS NULL;
