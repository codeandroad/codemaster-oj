CREATE TABLE school_submission_notes (
 school_id uuid NOT NULL REFERENCES schools(id),
 account_id uuid NOT NULL REFERENCES accounts(id),
 submission_id bigint REFERENCES submissions(id),job_id uuid,
 note text NOT NULL CHECK(length(note)<=10000),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(submission_id,job_id)=1),
 FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id),
 UNIQUE(school_id,account_id,submission_id),UNIQUE(school_id,account_id,job_id)
);
ALTER TABLE school_submission_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_submission_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY own_school_note ON school_submission_notes USING(
 school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid AND account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid);
