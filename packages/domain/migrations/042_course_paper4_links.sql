-- Course practice links pin a public catalogue version; a whole paper expands
-- to its questions for progress, without changing any existing OJ references.
CREATE TABLE chapter_paper4_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 chapter_id uuid NOT NULL REFERENCES learning_chapters(id) ON DELETE CASCADE,
 paper_id uuid NOT NULL REFERENCES paper4_papers(id),
 version_id uuid NOT NULL,
 question_key text CHECK(question_key IS NULL OR length(question_key) BETWEEN 1 AND 40 AND question_key ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'),
 position integer NOT NULL CHECK(position>=0),
 FOREIGN KEY(version_id,paper_id) REFERENCES paper4_versions(id,paper_id)
);
CREATE UNIQUE INDEX chapter_paper4_link_unique ON chapter_paper4_links(chapter_id,version_id,COALESCE(question_key,''));
CREATE INDEX chapter_paper4_links_version_idx ON chapter_paper4_links(version_id,chapter_id);
