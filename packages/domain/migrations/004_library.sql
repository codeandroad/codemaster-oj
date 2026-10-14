CREATE TABLE problem_banks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, owner_account_id uuid REFERENCES accounts(id),
 visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','school')), is_system boolean NOT NULL DEFAULT false,
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
-- A system collection preserves the existing school-wide publication scope.
-- This is structural configuration, not a sample problem or sample grade.
INSERT INTO problem_banks(id,name,visibility,is_system) VALUES('00000000-0000-4000-8000-000000000001','校内公开题库','school',true);
CREATE TABLE bank_permissions (bank_id uuid REFERENCES problem_banks(id),account_id uuid REFERENCES accounts(id),permission text NOT NULL CHECK(permission IN ('read','edit')),PRIMARY KEY(bank_id,account_id));
ALTER TABLE problems ADD COLUMN bank_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES problem_banks(id);
ALTER TABLE problem_versions ADD COLUMN tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE problem_versions ADD COLUMN source text NOT NULL DEFAULT '';
CREATE TABLE problem_groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bank_id uuid NOT NULL REFERENCES problem_banks(id),name text NOT NULL,owner_account_id uuid NOT NULL REFERENCES accounts(id),archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE problem_group_members (group_id uuid REFERENCES problem_groups(id),problem_id uuid REFERENCES problems(id),position integer NOT NULL,PRIMARY KEY(group_id,problem_id));

ALTER TABLE accounts ADD COLUMN binding_released_at timestamptz;
ALTER TABLE accounts ADD COLUMN email text CHECK(email IS NULL OR length(email)<=254);
ALTER TABLE accounts DROP CONSTRAINT accounts_identity_id_key;
CREATE UNIQUE INDEX accounts_active_identity_idx ON accounts(identity_id) WHERE binding_released_at IS NULL;
ALTER TABLE judge_tasks ADD COLUMN rejudge boolean NOT NULL DEFAULT false;
ALTER TABLE judge_tasks ADD COLUMN requested_by uuid REFERENCES accounts(id);
ALTER TABLE judge_tasks ADD COLUMN reason text;
ALTER TABLE submissions ADD COLUMN pending_judge_run_id uuid REFERENCES judge_runs(id);
