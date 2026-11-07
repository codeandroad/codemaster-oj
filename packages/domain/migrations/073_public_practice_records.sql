CREATE TABLE school_problem_publication_requests (
 school_id uuid NOT NULL, problem_id uuid NOT NULL, version_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES accounts(id), requested_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
 decided_by uuid REFERENCES accounts(id), decided_at timestamptz,
 PRIMARY KEY (school_id,problem_id,version_id),
 FOREIGN KEY (school_id,problem_id,version_id) REFERENCES school_problem_versions(school_id,problem_id,id),
 CHECK ((status='pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
ALTER TABLE school_problem_publication_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_problem_publication_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY school_problem_publication_request_scope ON school_problem_publication_requests
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);

-- The public history reader selects the account's own formal public jobs only.
-- It can still display those records after the source publication is withdrawn.
CREATE POLICY school_judge_jobs_public_history ON school_judge_jobs FOR SELECT TO campus_app
 USING (access_context='public' AND kind='submit'
   AND account_id=NULLIF(current_setting('campus.public_history_account_id',true),'')::uuid);
CREATE INDEX school_judge_jobs_public_history_idx ON school_judge_jobs(account_id,created_at DESC,id DESC)
 WHERE access_context='public' AND kind='submit';

CREATE TABLE public_practice_notes (
 account_id uuid NOT NULL REFERENCES accounts(id), school_id uuid NOT NULL, submission_id uuid NOT NULL,
 note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 8000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id,school_id,submission_id),
 FOREIGN KEY (school_id,submission_id) REFERENCES school_judge_jobs(school_id,id)
);
ALTER TABLE public_practice_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_practice_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY public_practice_note_owner ON public_practice_notes
 USING (account_id=NULLIF(current_setting('campus.public_history_account_id',true),'')::uuid);
