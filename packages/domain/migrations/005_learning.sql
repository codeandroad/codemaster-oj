CREATE TABLE learning_paths (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_account_id uuid NOT NULL REFERENCES accounts(id),
 title text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'Python',
 published_at timestamptz, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE learning_chapters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), path_id uuid NOT NULL REFERENCES learning_paths(id),
 title text NOT NULL, content text NOT NULL DEFAULT '', position integer NOT NULL CHECK(position>=0),
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learning_chapters_path_idx ON learning_chapters(path_id,position,created_at);
CREATE TABLE chapter_problems (
 chapter_id uuid REFERENCES learning_chapters(id) ON DELETE CASCADE,
 problem_id uuid REFERENCES problems(id), version_id uuid NOT NULL REFERENCES problem_versions(id), position integer NOT NULL,
 PRIMARY KEY(chapter_id,problem_id)
);
CREATE TABLE learning_progress (
 identity_id uuid REFERENCES identities(id), chapter_id uuid REFERENCES learning_chapters(id) ON DELETE CASCADE,
 completed boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(identity_id,chapter_id)
);
