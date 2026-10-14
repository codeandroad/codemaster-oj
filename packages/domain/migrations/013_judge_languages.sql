-- Existing published versions and stored submissions remain Python 3.12.
-- New versions can validate a reference in any supported language; source,
-- starter templates and the chosen submission language are versioned facts.
ALTER TABLE problem_versions ADD COLUMN reference_language text NOT NULL DEFAULT 'python'
  CHECK (reference_language IN ('python','cpp','javascript'));
ALTER TABLE problem_versions ADD COLUMN starter_codes jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(starter_codes) = 'object');
ALTER TABLE submissions ADD COLUMN language text NOT NULL DEFAULT 'python'
  CHECK (language IN ('python','cpp','javascript'));
