CREATE INDEX submissions_identity_formal_history_idx ON submissions(identity_id,created_at DESC,id DESC) WHERE kind IN ('submit','correction');
CREATE INDEX submissions_identity_problem_formal_idx ON submissions(identity_id,problem_id,created_at DESC,id DESC) WHERE kind='submit';
