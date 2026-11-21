CREATE TABLE platform_problem_audiences (
  problem_id uuid NOT NULL REFERENCES problems(id),
  school_id uuid REFERENCES schools(id),
  account_id uuid REFERENCES accounts(id),
  CHECK (num_nonnulls(school_id, account_id) = 1),
  UNIQUE NULLS NOT DISTINCT (problem_id, school_id, account_id)
);

CREATE INDEX platform_problem_audiences_school_idx
  ON platform_problem_audiences(school_id, problem_id) WHERE school_id IS NOT NULL;
CREATE INDEX platform_problem_audiences_account_idx
  ON platform_problem_audiences(account_id, problem_id) WHERE account_id IS NOT NULL;
