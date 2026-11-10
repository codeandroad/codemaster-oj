-- Migration-owner maintenance only: display repairs never create a new grading version.
CREATE TABLE acsl_presentation_updates (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), batch_id uuid NOT NULL,
 paper_id uuid NOT NULL, version_id uuid NOT NULL,
 actor_account_id uuid NOT NULL REFERENCES accounts(id), database_actor text NOT NULL DEFAULT current_user,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
 before_hash text NOT NULL CHECK (before_hash ~ '^[a-f0-9]{64}$'),
 after_hash text NOT NULL CHECK (after_hash ~ '^[a-f0-9]{64}$'),
 grading_contract_hash text NOT NULL CHECK (grading_contract_hash ~ '^[a-f0-9]{64}$'),
 before_definition jsonb NOT NULL, after_definition jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,paper_id,batch_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
CREATE INDEX acsl_presentation_updates_paper ON acsl_presentation_updates(school_id,paper_id,created_at);
CREATE TRIGGER acsl_presentation_updates_immutable BEFORE UPDATE OR DELETE ON acsl_presentation_updates
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
ALTER TABLE acsl_presentation_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_presentation_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_presentation_updates
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
REVOKE ALL ON acsl_presentation_updates FROM PUBLIC,campus_app,campus_worker;
