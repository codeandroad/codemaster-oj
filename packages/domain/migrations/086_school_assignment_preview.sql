-- Trial submissions reuse the worker queue without joining formal activity
-- attempts, student identities, or any scholarship and ranking context.
ALTER TABLE school_judge_jobs
 DROP CONSTRAINT school_judge_jobs_access_context_check,
 ADD CONSTRAINT school_judge_jobs_access_context_check
  CHECK (access_context IN ('school','public','staff_practice','assignment_preview')),
 ADD COLUMN preview_activity_id uuid,
 ADD COLUMN preview_revision integer,
 ADD FOREIGN KEY (school_id,preview_activity_id) REFERENCES school_activities(school_id,id),
 ADD CONSTRAINT school_judge_job_preview_context CHECK (
  (access_context='assignment_preview' AND preview_activity_id IS NOT NULL
   AND preview_revision IS NOT NULL AND preview_revision>0 AND identity_id IS NULL AND kind<>'validation')
  OR (access_context<>'assignment_preview' AND preview_activity_id IS NULL AND preview_revision IS NULL)
 ),
 ADD CONSTRAINT school_judge_job_staff_practice_context CHECK (
  access_context<>'staff_practice' OR (identity_id IS NULL AND kind<>'validation')
 );

CREATE INDEX school_judge_jobs_preview_history
 ON school_judge_jobs(school_id,preview_activity_id,account_id,preview_revision,problem_id,created_at,id)
 WHERE access_context='assignment_preview' AND kind='submit';
