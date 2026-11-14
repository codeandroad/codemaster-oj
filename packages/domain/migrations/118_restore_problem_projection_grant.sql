-- Restore the column grants required to refresh a learner-facing problem
-- projection. Earlier deployment grant refreshes could remove them.
GRANT UPDATE(definition,draft_revision) ON school_problem_versions TO campus_app;
