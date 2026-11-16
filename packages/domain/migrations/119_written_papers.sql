-- Written practice is independent of programming attempts and existing learner history.
CREATE TABLE written_papers (
 school_id uuid NOT NULL REFERENCES schools(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 slug text NOT NULL, draft_version_id uuid, published_version_id uuid,
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,slug)
);
CREATE TABLE written_paper_versions (
 school_id uuid NOT NULL, paper_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 content_hash text NOT NULL, definition jsonb NOT NULL, created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,id), UNIQUE(school_id,paper_id,id),
 UNIQUE(school_id,paper_id,content_hash), FOREIGN KEY(school_id,paper_id) REFERENCES written_papers(school_id,id)
);
ALTER TABLE written_papers ADD FOREIGN KEY(school_id,id,draft_version_id) REFERENCES written_paper_versions(school_id,paper_id,id);
ALTER TABLE written_papers ADD FOREIGN KEY(school_id,id,published_version_id) REFERENCES written_paper_versions(school_id,paper_id,id);
CREATE TABLE written_assets (
 school_id uuid NOT NULL, version_id uuid NOT NULL, id text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('question','marking')),
 mime_type text NOT NULL CHECK(mime_type IN ('image/png','application/pdf')),
 sha256 text NOT NULL, content bytea NOT NULL CHECK(octet_length(content)<=2097152),
 PRIMARY KEY(school_id,version_id,id), FOREIGN KEY(school_id,version_id) REFERENCES written_paper_versions(school_id,id)
);
CREATE TABLE written_attempts (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), paper_id uuid NOT NULL, version_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id), request_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','released')),
 answers jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 save_request_id uuid, save_hash text, grading_revision integer NOT NULL DEFAULT 0 CHECK(grading_revision>=0),
 review_request_id uuid, review_hash text, marks jsonb NOT NULL DEFAULT '{}',
 self_marks jsonb NOT NULL DEFAULT '{}', notes jsonb NOT NULL DEFAULT '{}',
 score integer CHECK(score BETWEEN 0 AND 75), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz, released_at timestamptz,
 PRIMARY KEY(school_id,id), UNIQUE(school_id,account_id,request_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES written_paper_versions(school_id,paper_id,id),
 CHECK ((state='draft' AND submitted_at IS NULL AND released_at IS NULL AND score IS NULL)
 OR (state='submitted' AND submitted_at IS NOT NULL AND released_at IS NULL AND score IS NULL)
 OR (state='released' AND submitted_at IS NOT NULL AND released_at IS NOT NULL AND score IS NOT NULL))
);
CREATE UNIQUE INDEX written_one_draft ON written_attempts(school_id,paper_id,account_id) WHERE state='draft';
CREATE INDEX written_review_queue ON written_attempts(school_id,paper_id,state,submitted_at);
CREATE TABLE written_attachments (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL,
 question_id text NOT NULL, request_id uuid NOT NULL, sha256 text NOT NULL,
 content bytea NOT NULL CHECK(octet_length(content)<=1048576), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,attempt_id,request_id),
 FOREIGN KEY(school_id,attempt_id) REFERENCES written_attempts(school_id,id)
);
CREATE TABLE written_events (
 school_id uuid NOT NULL REFERENCES schools(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES accounts(id), action text NOT NULL, target_id uuid NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,id)
);
CREATE FUNCTION protect_written_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME IN ('written_paper_versions','written_assets','written_attachments','written_events') THEN
  RAISE EXCEPTION 'Written history is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.school_id,NEW.id,NEW.paper_id,NEW.version_id,NEW.account_id,NEW.request_id,NEW.created_at)
 IS DISTINCT FROM (OLD.school_id,OLD.id,OLD.paper_id,OLD.version_id,OLD.account_id,OLD.request_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Attempt identity is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state<>'draft' AND (NEW.answers,NEW.revision,NEW.submitted_at,NEW.save_request_id,NEW.save_hash)
 IS DISTINCT FROM (OLD.answers,OLD.revision,OLD.submitted_at,OLD.save_request_id,OLD.save_hash) THEN
  RAISE EXCEPTION 'Submitted answers are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state='released' AND (NEW.state,NEW.marks,NEW.score,NEW.released_at,NEW.grading_revision,NEW.review_request_id,NEW.review_hash)
 IS DISTINCT FROM (OLD.state,OLD.marks,OLD.score,OLD.released_at,OLD.grading_revision,OLD.review_request_id,OLD.review_hash) THEN
  RAISE EXCEPTION 'Released grades are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.state='submitted' AND NEW.state='draft' OR OLD.state='draft' AND NEW.state='released' THEN
  RAISE EXCEPTION 'Invalid attempt transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
 FOR name IN SELECT unnest(ARRAY['written_papers','written_paper_versions','written_assets','written_attempts','written_attachments','written_events']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY school_scope ON %I USING(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid) WITH CHECK(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid)',name);
  IF name<>'written_papers' THEN
   EXECUTE format('CREATE TRIGGER freeze_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_written_history()',name);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON written_papers,written_paper_versions,written_assets,written_attempts,written_attachments,written_events FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT ON written_papers,written_paper_versions,written_assets,written_attempts,written_attachments,written_events TO campus_app;
GRANT UPDATE(draft_version_id,published_version_id) ON written_papers TO campus_app;
GRANT UPDATE(answers,revision,save_request_id,save_hash,state,updated_at,submitted_at,released_at,score,marks,grading_revision,review_request_id,review_hash,self_marks,notes) ON written_attempts TO campus_app;
