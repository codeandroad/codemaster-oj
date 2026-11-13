-- The Python route exists with different IDs in local and hosted databases.
-- Select its chapter exercises and same-named system-bank group in the legacy school.
-- Preserve the pinned problem versions and their grading and publication state.
ALTER TABLE problem_versions DISABLE TRIGGER published_version_immutable;

WITH target_course AS (
 SELECT id, school_id FROM learning_paths
 WHERE title = 'Python 专项训练 · 全目录学习路线'
  AND school_id = '00000000-0000-4000-8000-000000000052'
  AND owner_scope = 'platform' AND archived_at IS NULL
), target_problems AS (
 SELECT cp.problem_id
 FROM target_course c
 JOIN learning_chapters ch ON ch.path_id = c.id AND ch.archived_at IS NULL
 JOIN chapter_problems cp ON cp.chapter_id = ch.id
 UNION
 SELECT m.problem_id
 FROM problem_group_members m
 JOIN problem_groups g ON g.id = m.group_id AND g.archived_at IS NULL
 JOIN problem_banks b ON b.id = g.bank_id AND b.is_system AND b.visibility = 'school'
 WHERE g.name = 'Python 专项训练 · 全目录学习路线'
  AND b.school_id = '00000000-0000-4000-8000-000000000052'
)
UPDATE problem_versions v
SET tags = CASE WHEN jsonb_typeof(v.tags) = 'array' THEN v.tags - 'Original practice' ELSE v.tags END,
 source = ''
FROM target_problems p
WHERE v.problem_id = p.problem_id
 AND ((jsonb_typeof(v.tags) = 'array' AND v.tags ? 'Original practice') OR v.source <> '');

ALTER TABLE problem_versions ENABLE TRIGGER published_version_immutable;
