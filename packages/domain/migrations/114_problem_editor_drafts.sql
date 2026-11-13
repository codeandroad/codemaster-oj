ALTER TABLE problem_versions
 ADD COLUMN edit_draft jsonb,
 ADD COLUMN edit_revision integer NOT NULL DEFAULT 0,
 ADD COLUMN published_revision integer NOT NULL DEFAULT 0,
 ADD COLUMN draft_validation_task_id uuid REFERENCES judge_tasks(id),
 ADD COLUMN draft_review_status text CHECK(draft_review_status IN ('pending','rejected')),
 ADD COLUMN draft_review_at timestamptz,
 ADD COLUMN draft_review_reason text,
 ADD COLUMN draft_presentation jsonb;
ALTER TABLE judge_tasks ADD COLUMN draft_revision integer;
ALTER TABLE school_judge_jobs ADD COLUMN validation_revision integer;
UPDATE school_judge_jobs j SET validation_revision=v.draft_revision FROM school_problem_versions v
 WHERE j.kind='validation' AND (j.school_id,j.problem_id,j.version_id)=(v.school_id,v.problem_id,v.id);

-- An editor may change the proposed content and review state. Only promotion
-- changes the published definition. Existing judge and review writes retain
-- their previous privileges.
CREATE OR REPLACE FUNCTION protect_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[]:=ARRAY['validation_status','validation_message','school_visible_at','rank_review_status',
 'rank_approved_at','rank_reviewed_at','rank_reviewed_by','rank_review_reason','edit_draft','edit_revision',
 'draft_validation_task_id','draft_review_status','draft_review_at','draft_review_reason','draft_presentation'];
BEGIN
 IF OLD.published_at IS NOT NULL AND (to_jsonb(NEW)-mutable) IS DISTINCT FROM (to_jsonb(OLD)-mutable)
  AND NOT (current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
   AND OLD.edit_draft IS NOT NULL AND NEW.edit_draft IS NULL
   AND NEW.published_revision=OLD.edit_revision AND NEW.id=OLD.id AND NEW.problem_id=OLD.problem_id)
 THEN RAISE EXCEPTION 'published problem versions are immutable'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION capture_judge_task_problem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_submission bigint; proposal jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.problem_snapshot,NEW.draft_revision) IS DISTINCT FROM ROW(OLD.problem_snapshot,OLD.draft_revision)
   THEN RAISE EXCEPTION 'Judge task inputs are immutable'; END IF;
  RETURN NEW;
 END IF;

 NEW.problem_snapshot:=NULL;
 IF NEW.draft_revision IS NOT NULL THEN
  IF NEW.purpose<>'validation' THEN RAISE EXCEPTION 'Only validation may use a draft'; END IF;
  SELECT edit_draft INTO STRICT proposal FROM problem_versions WHERE id=NEW.version_id AND edit_revision=NEW.draft_revision;
  IF proposal IS NULL THEN RAISE EXCEPTION 'Draft is missing'; END IF;
  NEW.problem_snapshot:=jsonb_build_object('version',proposal-'tests',
   'tests',COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(proposal->'tests') WHERE (value->>'enabled')::boolean),'[]'::jsonb));
  RETURN NEW;
 END IF;

 IF NEW.rejudge THEN
  original_submission:=NEW.submission_id;
 ELSE
  SELECT s.original_submission_id INTO original_submission FROM submissions s WHERE s.id=NEW.submission_id;
 END IF;
 IF original_submission IS NOT NULL THEN
  SELECT initial.problem_snapshot INTO NEW.problem_snapshot FROM judge_tasks initial
   WHERE initial.submission_id=original_submission AND initial.purpose='submission' AND NOT initial.rejudge
   ORDER BY initial.created_at,initial.id LIMIT 1;
 END IF;
 NEW.problem_snapshot:=COALESCE(NEW.problem_snapshot,judge_task_problem_snapshot(NEW.version_id));
 RETURN NEW;
END $$;
DROP TRIGGER judge_task_problem_inputs ON judge_tasks;
CREATE TRIGGER judge_task_problem_inputs BEFORE INSERT OR UPDATE OF problem_snapshot,draft_revision ON judge_tasks
 FOR EACH ROW EXECUTE FUNCTION capture_judge_task_problem();

-- A published problem's formal cases can only be replaced by the migration
-- owner while promoting that exact problem's staged definition.
CREATE OR REPLACE FUNCTION protect_published_tests() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid;
BEGIN
 FOR source_id IN SELECT id FROM problem_versions WHERE id IN
  (CASE WHEN TG_OP<>'INSERT' THEN OLD.version_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.version_id END)
  AND published_at IS NOT NULL LOOP
  IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
    OR current_setting('campus.promoting_problem',true) IS DISTINCT FROM source_id::text
   THEN RAISE EXCEPTION 'published tests are immutable'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION protect_problem_presentation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.version_id=NEW.version_id
  AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  AND current_setting('campus.promoting_problem',true)=OLD.version_id::text THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Public problem presentations are immutable outside publication';
END $$;
DROP TRIGGER problem_public_statements_immutable ON problem_public_statements;
CREATE TRIGGER problem_public_statements_immutable BEFORE UPDATE OR DELETE ON problem_public_statements
 FOR EACH ROW EXECUTE FUNCTION protect_problem_presentation();

CREATE FUNCTION promote_problem_draft(source_id uuid, expected_revision integer, actor_id uuid, approve_school boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v problem_versions; d problem_versions; p problems; bank problem_banks; editor jsonb; presentation jsonb;
BEGIN
 SELECT * INTO STRICT v FROM problem_versions WHERE id=source_id FOR UPDATE;
 SELECT * INTO STRICT p FROM problems WHERE id=v.problem_id;
 SELECT * INTO STRICT bank FROM problem_banks WHERE id=p.bank_id;
 IF p.archived_at IS NOT NULL OR bank.archived_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.id=actor_id
   AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
 ) THEN RAISE EXCEPTION 'Publication is unavailable' USING ERRCODE='42501'; END IF;
 IF p.owner_scope='platform' THEN
  IF NOT approve_school OR NOT EXISTS(SELECT 1 FROM platform_admins WHERE account_id=actor_id AND revoked_at IS NULL)
   THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 ELSIF approve_school THEN
  IF bank.visibility<>'school' OR v.draft_review_status<>'pending' OR v.draft_review_status IS NULL
   OR NOT EXISTS(SELECT 1 FROM account_roles WHERE account_id=actor_id AND role='admin')
   THEN RAISE EXCEPTION 'School administrator review required' USING ERRCODE='42501'; END IF;
 ELSIF bank.visibility<>'private' OR NOT EXISTS (
  SELECT 1 FROM account_roles r WHERE r.account_id=actor_id AND (r.role='admin' OR r.role='teacher' AND
   (actor_id IN (p.owner_account_id,bank.owner_account_id) OR EXISTS (
    SELECT 1 FROM bank_permissions WHERE bank_id=p.bank_id AND account_id=actor_id AND permission='edit')))
 ) THEN RAISE EXCEPTION 'Problem edit permission required' USING ERRCODE='42501'; END IF;
 editor:=v.edit_draft;
 IF editor IS NULL OR v.edit_revision<>expected_revision OR NOT EXISTS(
  SELECT 1 FROM judge_tasks t JOIN judge_runs r ON r.task_id=t.id AND r.lease_id=t.lease_id
  WHERE t.id=v.draft_validation_task_id AND t.version_id=v.id AND t.draft_revision=v.edit_revision
   AND t.state='completed' AND r.status='AC'
 ) THEN RAISE EXCEPTION 'Draft changed or validation is incomplete' USING ERRCODE='23514'; END IF;

 PERFORM set_config('campus.promoting_problem',source_id::text,true);
 presentation:=v.draft_presentation;
 IF presentation IS NOT NULL THEN
  INSERT INTO problem_public_statements(version_id,language,statement,metadata,source_hash,content_hash,author_account_id,reviewer_account_id)
   VALUES(source_id,'en',presentation->>'statement',presentation->'metadata',presentation->>'sourceHash',
    presentation->>'contentHash',(presentation->>'reviewerAccountId')::uuid,(presentation->>'reviewerAccountId')::uuid)
   ON CONFLICT(version_id) DO UPDATE SET statement=EXCLUDED.statement,metadata=EXCLUDED.metadata,
    source_hash=EXCLUDED.source_hash,content_hash=EXCLUDED.content_hash,author_account_id=EXCLUDED.author_account_id,
    reviewer_account_id=EXCLUDED.reviewer_account_id,published_at=clock_timestamp();
 END IF;
 DELETE FROM test_cases WHERE version_id=source_id;
 INSERT INTO test_cases(id,version_id,position,input,expected,weight,name,enabled)
  SELECT t.id,source_id,t.position,t.input,t.expected,t.weight,t.name,t.enabled
  FROM jsonb_to_recordset(editor->'tests') t(id uuid,position integer,input text,expected text,weight numeric,name text,enabled boolean);
 d:=jsonb_populate_record(NULL::problem_versions,editor);
 UPDATE problem_versions SET title=d.title,statement=d.statement,mode=d.mode,function_name=d.function_name,
  starter_code=d.starter_code,starter_codes=d.starter_codes,samples=d.samples,time_limit_ms=d.time_limit_ms,
  memory_limit_mb=d.memory_limit_mb,comparator=d.comparator,reference_code=d.reference_code,reference_language=d.reference_language,
  tags=d.tags,source=d.source,metadata=d.metadata,validation_status='AC',validation_message=NULL,
  published_at=clock_timestamp(),published_revision=expected_revision,
  school_visible_at=CASE WHEN approve_school THEN COALESCE(v.school_visible_at,clock_timestamp()) ELSE v.school_visible_at END,
  rank_review_status=CASE WHEN approve_school THEN 'approved' ELSE v.rank_review_status END,
  rank_reviewed_at=CASE WHEN approve_school THEN clock_timestamp() ELSE v.rank_reviewed_at END,
  rank_reviewed_by=CASE WHEN approve_school THEN actor_id ELSE v.rank_reviewed_by END,
  rank_approved_at=CASE WHEN approve_school THEN
   CASE WHEN v.rank_review_status='approved' AND v.school_visible_at IS NOT NULL THEN COALESCE(v.rank_approved_at,clock_timestamp()) ELSE clock_timestamp() END
   ELSE v.rank_approved_at END,
  rank_review_reason=CASE WHEN approve_school THEN NULL ELSE v.rank_review_reason END,
  edit_draft=NULL,draft_validation_task_id=NULL,draft_review_status=NULL,draft_review_at=NULL,draft_review_reason=NULL,draft_presentation=NULL
  WHERE id=source_id;
 UPDATE problems SET current_version_id=source_id WHERE id=v.problem_id;
 PERFORM set_config('campus.promoting_problem','',true);
END $$;
REVOKE ALL ON FUNCTION promote_problem_draft(uuid,integer,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_problem_draft(uuid,integer,uuid,boolean) TO campus_app;
GRANT UPDATE(definition,draft_revision) ON school_problem_versions TO campus_app;
