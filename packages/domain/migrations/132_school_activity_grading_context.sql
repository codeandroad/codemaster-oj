-- Keep original grading references for assignments whose published exercise was
-- relinked. These references qualify earlier receipts; they grant no new access.
ALTER TABLE school_activity_problems ADD COLUMN prior_version_id uuid,
 ADD COLUMN original_problem_version_id uuid, ADD COLUMN original_prior_problem_version_id uuid;
ALTER TABLE school_activities ADD COLUMN required_language text
 CHECK (required_language IN ('python','cpp','javascript'));
