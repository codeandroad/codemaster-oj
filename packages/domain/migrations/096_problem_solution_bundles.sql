ALTER TABLE luq_assistance_contents
  ADD COLUMN solution_details jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN pending_solution jsonb,
  ADD CONSTRAINT luq_problem_solution_bundle CHECK (
    (solution_details = '{}' AND pending_solution IS NULL) OR
    (kind = 'FULL_SOLUTION' AND language = '' AND subject_key LIKE 'problem:%'
      AND jsonb_typeof(solution_details) = 'object'
      AND (pending_solution IS NULL OR (status = 'published' AND jsonb_typeof(pending_solution) = 'object')))
  );

ALTER TABLE school_scholarship_contents
  ADD COLUMN solution_details jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN pending_solution jsonb,
  ADD CONSTRAINT school_problem_solution_bundle CHECK (
    (solution_details = '{}' AND pending_solution IS NULL) OR
    (kind = 'FULL_SOLUTION' AND language = '' AND subject_key LIKE 'problem:%'
      AND jsonb_typeof(solution_details) = 'object'
      AND (pending_solution IS NULL OR (status = 'published' AND jsonb_typeof(pending_solution) = 'object')))
  );
