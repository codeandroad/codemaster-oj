CREATE TABLE legacy_assignment_preview_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 assignment_id uuid NOT NULL REFERENCES assignments(id),
 assignment_revision integer NOT NULL CHECK(assignment_revision>=0),
 account_id uuid NOT NULL REFERENCES accounts(id),
 problem_id uuid NOT NULL REFERENCES problems(id),
 version_id uuid NOT NULL REFERENCES problem_versions(id),
 kind text NOT NULL CHECK(kind IN ('submit','samples','custom')),
 code text NOT NULL,
 language text NOT NULL CHECK(language IN ('python','cpp','javascript')),
 custom_input text,
 request_id uuid NOT NULL,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,request_id),
 UNIQUE(id,version_id)
);
CREATE INDEX legacy_assignment_preview_history
 ON legacy_assignment_preview_submissions(assignment_id,account_id,assignment_revision,problem_id,created_at,id)
 WHERE kind='submit';

-- The existing queue leases and evaluates preview work, but its result can
-- never be applied to a student submission or to a problem's validation.
ALTER TABLE judge_tasks
 DROP CONSTRAINT judge_tasks_purpose_check,
 DROP CONSTRAINT judge_tasks_check,
 ADD COLUMN preview_submission_id uuid UNIQUE,
 ADD FOREIGN KEY(preview_submission_id,version_id) REFERENCES legacy_assignment_preview_submissions(id,version_id),
 ADD CONSTRAINT judge_tasks_context_check CHECK (
   (purpose='submission' AND submission_id IS NOT NULL AND preview_submission_id IS NULL)
   OR (purpose='validation' AND submission_id IS NULL AND preview_submission_id IS NULL)
   OR (purpose='assignment_preview' AND submission_id IS NULL AND preview_submission_id IS NOT NULL AND NOT rejudge)
 );
