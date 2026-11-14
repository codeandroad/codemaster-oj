ALTER TABLE platform_content_editors ADD COLUMN can_review_linked_problems boolean NOT NULL DEFAULT false
 CHECK (NOT can_review_linked_problems OR resource_kind='course');
ALTER TABLE problem_versions ADD COLUMN course_only_published boolean NOT NULL DEFAULT false;

-- This role check is also used when a platform administrator changes a grant.
CREATE FUNCTION platform_review_school_admin(actor uuid, school uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM school_memberships m
  WHERE m.account_id=actor AND m.school_id=school AND m.revoked_at IS NULL
   AND (m.role='school_admin' OR EXISTS(SELECT 1 FROM school_administrators a
    WHERE a.school_id=m.school_id AND a.account_id=m.account_id AND a.revoked_at IS NULL)))
 OR (school='00000000-0000-4000-8000-000000000052'::uuid AND EXISTS(
  SELECT 1 FROM legacy_school_account_ownership o JOIN account_roles r ON r.account_id=o.account_id
  WHERE o.account_id=actor AND o.school_id=school AND r.role='admin'));
$$;

CREATE FUNCTION platform_problem_review_grants(actor uuid, school uuid DEFAULT NULL)
RETURNS TABLE(problem_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT p.id
 FROM platform_content_editors g
 JOIN learning_paths c ON c.id=g.resource_id AND c.owner_scope='platform' AND c.archived_at IS NULL
 JOIN learning_chapters ch ON ch.path_id=c.id AND ch.archived_at IS NULL
 JOIN chapter_problems cp ON cp.chapter_id=ch.id
 JOIN problems p ON p.id=cp.problem_id AND p.owner_scope='platform' AND p.archived_at IS NULL
 WHERE g.resource_kind='course' AND g.account_id=actor AND g.revoked_at IS NULL
  AND g.can_review_linked_problems AND (school IS NULL OR g.school_id=school)
  AND platform_review_school_admin(actor,g.school_id);
$$;
REVOKE ALL ON FUNCTION platform_review_school_admin(uuid,uuid),platform_problem_review_grants(uuid,uuid) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION platform_review_school_admin(uuid,uuid),platform_problem_review_grants(uuid,uuid) TO campus_app;

-- Keep the existing promotion transaction and testcase/presentation handling.
-- Delegated review can activate linked exercises without expanding the audience.
CREATE OR REPLACE FUNCTION promote_problem_draft(source_id uuid, expected_revision integer, actor_id uuid, approve_school boolean)
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
  IF NOT EXISTS(SELECT 1 FROM platform_admins WHERE account_id=actor_id AND revoked_at IS NULL)
   AND (approve_school OR v.draft_review_status IS DISTINCT FROM 'pending'
    OR NOT EXISTS(SELECT 1 FROM platform_problem_review_grants(actor_id) g WHERE g.problem_id=p.id))
   THEN RAISE EXCEPTION 'Platform problem review authorization required' USING ERRCODE='42501'; END IF;
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
  course_only_published=CASE WHEN approve_school THEN false ELSE v.course_only_published OR (p.owner_scope='platform' AND v.published_at IS NULL) END,
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
