-- Migration-owner maintenance: corrected expected outputs get a new immutable
-- judge snapshot. Written grades, paper versions and points are not rewritten.
CREATE TABLE acsl_programming_revisions (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 paper_id uuid NOT NULL, version_id uuid NOT NULL, problem_id uuid NOT NULL,
 before_programming_version_id uuid NOT NULL, after_programming_version_id uuid NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id uuid NOT NULL REFERENCES accounts(id), database_actor text NOT NULL DEFAULT current_user,
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
 source_evidence jsonb NOT NULL CHECK (jsonb_typeof(source_evidence)='object'),
 corrections jsonb NOT NULL CHECK (jsonb_typeof(corrections)='array' AND jsonb_array_length(corrections)>0),
 before_hash text NOT NULL CHECK (before_hash ~ '^[a-f0-9]{64}$'),
 after_hash text NOT NULL CHECK (after_hash ~ '^[a-f0-9]{64}$'),
 before_definition jsonb NOT NULL, after_definition jsonb NOT NULL,
 before_judge_definition jsonb NOT NULL, after_judge_definition jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,request_id),
 UNIQUE(school_id,paper_id,before_programming_version_id),
 UNIQUE(school_id,paper_id,after_programming_version_id),
 CHECK(before_programming_version_id<>after_programming_version_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id),
 FOREIGN KEY(school_id,problem_id,before_programming_version_id) REFERENCES school_problem_versions(school_id,problem_id,id),
 FOREIGN KEY(school_id,problem_id,after_programming_version_id) REFERENCES school_problem_versions(school_id,problem_id,id)
);
CREATE TRIGGER acsl_programming_revisions_immutable BEFORE UPDATE OR DELETE ON acsl_programming_revisions
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
ALTER TABLE acsl_programming_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_programming_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_programming_revisions
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
REVOKE ALL ON acsl_programming_revisions FROM PUBLIC,campus_app,campus_worker;
-- Runtime reads only the reviewed lineage, never the private correction audit.
GRANT SELECT(school_id,paper_id,problem_id,before_programming_version_id,after_programming_version_id)
 ON acsl_programming_revisions TO campus_app;

CREATE FUNCTION protect_acsl_programming_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM acsl_papers WHERE school_id=OLD.school_id AND programming_version_id=OLD.id)
    OR EXISTS(SELECT 1 FROM acsl_programming_revisions WHERE school_id=OLD.school_id
      AND (before_programming_version_id=OLD.id OR after_programming_version_id=OLD.id)) THEN
  RAISE EXCEPTION 'ACSL_PROGRAMMING_VERSION_IMMUTABLE';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_acsl_programming_version() FROM PUBLIC,campus_app,campus_worker;
CREATE TRIGGER acsl_programming_version_immutable BEFORE UPDATE OR DELETE ON school_problem_versions
 FOR EACH ROW EXECUTE FUNCTION protect_acsl_programming_version();
