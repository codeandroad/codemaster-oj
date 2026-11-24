GRANT INSERT(scope_id,id,name,bank_id,owner_account_id,created_at), UPDATE(archived_at) ON practice_problem_groups TO campus_app;

ALTER TABLE school_problems ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT school_archived_problem_unpublished CHECK (archived_at IS NULL OR NOT published);
-- Restore the archive marker for unpublished school copies from the original migration.
SELECT set_config('campus.school_id','00000000-0000-4000-8000-000000000052',true);
UPDATE school_problems p SET archived_at=source.archived_at
FROM problems source WHERE p.school_id='00000000-0000-4000-8000-000000000052' AND p.id=source.id
  AND source.owner_scope='school' AND source.archived_at IS NOT NULL AND NOT p.published;
