ALTER TABLE problems
  ADD COLUMN tutorial_mode text NOT NULL DEFAULT 'course',
  ADD COLUMN tutorial_body text NOT NULL DEFAULT '',
  ADD COLUMN tutorial_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT problems_tutorial_check CHECK (
    (tutorial_mode IN ('course', 'none') AND tutorial_body = '')
    OR (tutorial_mode = 'custom' AND btrim(tutorial_body) <> '' AND octet_length(tutorial_body) <= 65536)
  );

ALTER TABLE school_problems
  ADD COLUMN tutorial_mode text NOT NULL DEFAULT 'course',
  ADD COLUMN tutorial_body text NOT NULL DEFAULT '',
  ADD COLUMN tutorial_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT school_problems_tutorial_check CHECK (
    (tutorial_mode IN ('course', 'none') AND tutorial_body = '')
    OR (tutorial_mode = 'custom' AND btrim(tutorial_body) <> '' AND octet_length(tutorial_body) <= 65536)
  );

CREATE INDEX chapter_problems_tutorial_lookup ON chapter_problems (problem_id, version_id);
