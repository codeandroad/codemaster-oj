-- A school membership and its optional administrative grant authorize every
-- school. Historical submission and account identities remain immutable.
CREATE OR REPLACE VIEW school_workspace_roles WITH (security_invoker=true) AS
 SELECT school_id, account_id, role FROM school_memberships WHERE revoked_at IS NULL
 UNION SELECT m.school_id,m.account_id,'school_admin' FROM school_memberships m
 JOIN school_administrators g USING(school_id,account_id)
 WHERE m.revoked_at IS NULL AND g.revoked_at IS NULL;
-- Keep the original affiliation timestamps and role history as immutable audit
-- events, including credentials that were subsequently released or disabled.
INSERT INTO school_audit_events(school_id,action,target_id,created_at)
 SELECT school_id,'school.account.affiliation_recorded',account_id,assigned_at FROM legacy_school_account_ownership
 UNION ALL SELECT school_id,'school.identity.affiliation_recorded',identity_id,assigned_at FROM legacy_school_identity_ownership
 UNION ALL SELECT o.school_id,'school.role.recorded.'||r.role,r.account_id,o.assigned_at
  FROM account_roles r JOIN legacy_school_account_ownership o USING(account_id);
DROP TRIGGER legacy_school_role_insert ON account_roles;
DROP TRIGGER legacy_school_account_insert ON accounts;
DROP TRIGGER legacy_school_identity_insert ON identities;
DROP FUNCTION legacy_school_ownership_on_role(),legacy_school_ownership_on_account(),legacy_school_ownership_on_identity();
DROP FUNCTION assign_legacy_school_identity(uuid),detach_legacy_school_student(uuid,uuid,uuid,uuid);
DROP TABLE legacy_school_account_ownership,legacy_school_identity_ownership,account_roles;
ALTER TABLE school_identity_imports DROP CONSTRAINT school_identity_imports_school_id_check;
CREATE OR REPLACE FUNCTION protect_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.identity_id IS DISTINCT FROM OLD.identity_id THEN RAISE EXCEPTION 'Historical account identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION bind_submission_school() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_school uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN RAISE EXCEPTION 'A submission cannot change schools' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT i.school_id INTO source_school FROM school_identities i JOIN school_memberships m USING (school_id,account_id)
 WHERE i.id=NEW.identity_id AND i.account_id=NEW.account_id AND m.revoked_at IS NULL AND i.archived_at IS NULL;
 IF NEW.school_id IS NOT NULL AND NEW.school_id IS DISTINCT FROM source_school THEN RAISE EXCEPTION 'Submission school does not match the student dossier' USING ERRCODE='23514'; END IF;
 NEW.school_id:=source_school;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION platform_review_school_admin(actor uuid, school uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM school_workspace_roles WHERE account_id=actor AND school_id=school AND role='school_admin');
$$;
CREATE OR REPLACE FUNCTION acsl_edit_paper(target_school uuid,target_paper uuid,actor uuid,request_text text,content_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; permitted boolean; paper acsl_papers; prior acsl_management_updates;
 request jsonb; document jsonb; fingerprint text; new_hash text; request_key uuid; revision uuid; edit_reason text;
 question jsonb; old_question jsonb; option jsonb; revision_time text; requirements jsonb;
 changed_ids text[]:='{}'; changed_question_id text; written_changed boolean; changed boolean; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('school-teaching:'||target_school::text,0));
 previous_scope:=current_setting('campus.school_id',true);
 PERFORM set_config('campus.school_id',target_school::text,true);
 PERFORM 1 FROM accounts a JOIN identities i ON i.id=a.identity_id
  WHERE a.id=actor AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL FOR SHARE OF a,i;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACSL_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM school_memberships m WHERE m.school_id=target_school AND m.account_id=actor AND m.revoked_at IS NULL
   AND (m.role IN ('teacher','school_admin') OR EXISTS(SELECT 1 FROM school_administrators a
    WHERE a.school_id=m.school_id AND a.account_id=m.account_id AND a.revoked_at IS NULL)) FOR SHARE OF m;
  permitted:=FOUND;
 IF NOT permitted THEN RAISE EXCEPTION 'ACSL_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF octet_length(request_text)>2000000 OR octet_length(content_text)>2000000 THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
 request:=request_text::jsonb; document:=content_text::jsonb;
 edit_reason:=regexp_replace(coalesce(request->>'reason',''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
 IF jsonb_typeof(request)<>'object' OR jsonb_typeof(document)<>'object'
   OR request-ARRAY['expectedContentHash','requestId','reason','title','questions','programming']<>'{}'::jsonb
   OR coalesce(request->>'expectedContentHash','')!~'^[a-f0-9]{64}$'
   OR (request ? 'reason' AND jsonb_typeof(request->'reason') IS DISTINCT FROM 'string') OR length(edit_reason)>2000
   OR coalesce(request->>'requestId','')!~'^[a-fA-F0-9-]{36}$' THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
 request_key:=(request->>'requestId')::uuid;
 fingerprint:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 SELECT * INTO prior FROM acsl_management_updates WHERE school_id=target_school AND actor_account_id=actor AND request_id=request_key;
 IF FOUND THEN
  IF prior.paper_id<>target_paper OR prior.request_hash<>fingerprint THEN RAISE EXCEPTION 'ACSL_REQUEST_CONFLICT'; END IF;
  PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
  RETURN prior.result;
 END IF;
 SELECT * INTO paper FROM acsl_papers WHERE school_id=target_school AND id=target_paper FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACSL_NOT_FOUND'; END IF;
 IF paper.content_hash<>request->>'expectedContentHash' THEN RAISE EXCEPTION 'ACSL_CONTENT_CONFLICT'; END IF;
 IF jsonb_typeof(document->'questions') IS DISTINCT FROM 'array'
   OR acsl_edit_contract(document,false) IS DISTINCT FROM acsl_edit_contract(paper.definition,false)
   OR NOT acsl_edit_localized(document->'title',200) THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
 FOR question IN SELECT value FROM jsonb_array_elements(document->'questions') LOOP
  IF NOT acsl_edit_localized(question->'topic',200) OR NOT acsl_edit_localized(question->'statement',100000)
    OR NOT acsl_edit_localized(question->'explanation',100000)
    OR NOT acsl_edit_diagrams(question->'statementDiagrams') OR NOT acsl_edit_diagrams(question->'explanationDiagrams')
    OR jsonb_typeof(question->'correctOptionIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
  IF jsonb_array_length(question->'correctOptionIds')<1
    OR question->>'type'='single' AND jsonb_array_length(question->'correctOptionIds')<>1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(question->'correctOptionIds') answer WHERE jsonb_typeof(answer)<>'string'
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(question->'options') o WHERE o->'id'=answer))
    OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(question->'correctOptionIds')) THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
  FOR option IN SELECT value FROM jsonb_array_elements(question->'options') LOOP
   IF NOT acsl_edit_localized(option->'text',10000) OR NOT acsl_edit_diagrams(option->'diagrams') THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
  END LOOP;
  SELECT value INTO old_question FROM jsonb_array_elements(paper.definition->'questions') WHERE value->>'id'=question->>'id';
  IF question-ARRAY['topic','explanation','explanationDiagrams'] IS DISTINCT FROM old_question-ARRAY['topic','explanation','explanationDiagrams'] THEN
   changed_ids:=array_append(changed_ids,question->>'id');
  END IF;
 END LOOP;
 IF jsonb_typeof(document->'programming')='object' AND (
   jsonb_typeof(document#>'{programming,definition,title}') IS DISTINCT FROM 'string'
   OR length(btrim(document#>>'{programming,definition,title}')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(document#>'{programming,definition,statement}') IS DISTINCT FROM 'string'
   OR length(btrim(document#>>'{programming,definition,statement}')) NOT BETWEEN 1 AND 100000
   OR jsonb_typeof(document#>'{programming,statementZh}') IS DISTINCT FROM 'string'
   OR length(btrim(document#>>'{programming,statementZh}')) NOT BETWEEN 1 AND 100000
   OR NOT acsl_edit_diagrams(document#>'{programming,statementDiagrams}')) THEN RAISE EXCEPTION 'ACSL_INVALID_EDIT'; END IF;
 changed:=document IS DISTINCT FROM paper.definition;
 written_changed:=changed AND (document->'questions' IS DISTINCT FROM paper.definition->'questions' OR document->'title' IS DISTINCT FROM paper.definition->'title');
 revision:=coalesce(paper.written_revision,paper.version_id); requirements:=paper.written_question_revisions;
 IF written_changed THEN
  INSERT INTO acsl_grade_question_snapshots(school_id,grade_id,written_revision,questions)
   SELECT school_id,id,revision,paper.definition->'questions' FROM acsl_paper_grades
   WHERE school_id=target_school AND paper_id=target_paper AND version_id=paper.version_id ON CONFLICT DO NOTHING;
  INSERT INTO acsl_submission_question_snapshots(school_id,submission_id,written_revision,question)
   SELECT s.school_id,s.id,revision,q FROM acsl_submissions s CROSS JOIN jsonb_array_elements(paper.definition->'questions') q
   WHERE s.school_id=target_school AND s.paper_id=target_paper AND s.version_id=paper.version_id AND q->>'id'=s.question_id ON CONFLICT DO NOTHING;
  revision:=gen_random_uuid(); revision_time:=clock_timestamp()::text;
  FOREACH changed_question_id IN ARRAY changed_ids LOOP requirements:=requirements||jsonb_build_object(changed_question_id,revision_time); END LOOP;
 END IF;
 new_hash:=CASE WHEN changed THEN encode(sha256(convert_to(content_text,'UTF8')),'hex') ELSE paper.content_hash END;
 IF changed THEN
  UPDATE acsl_papers SET definition=document,content_hash=new_hash,
   written_revision=CASE WHEN written_changed THEN revision ELSE written_revision END,
   written_revision_at=CASE WHEN written_changed THEN revision_time::timestamptz ELSE written_revision_at END,
   written_changed_question_ids=CASE WHEN written_changed THEN changed_ids ELSE written_changed_question_ids END,
   written_question_revisions=requirements WHERE school_id=target_school AND id=target_paper;
 END IF;
 result:=jsonb_build_object('changed',changed,'contentHash',new_hash,'writtenRevision',revision,'changedQuestionIds',changed_ids);
 INSERT INTO acsl_management_updates(school_id,paper_id,version_id,actor_account_id,request_id,request_hash,reason,
  before_hash,after_hash,before_grading_hash,after_grading_hash,before_definition,after_definition,result)
 VALUES(target_school,target_paper,paper.version_id,actor,request_key,fingerprint,edit_reason,paper.content_hash,new_hash,
  encode(sha256(convert_to(acsl_edit_contract(paper.definition,true)::text,'UTF8')),'hex'),
  encode(sha256(convert_to(acsl_edit_contract(document,true)::text,'UTF8')),'hex'),paper.definition,document,result);
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION promote_problem_draft(source_id uuid, expected_revision integer, actor_id uuid, approve_school boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v problem_versions; d problem_versions; p problems; bank problem_banks; previous problem_versions; editor jsonb; presentation jsonb;
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
 ELSE
  RAISE EXCEPTION 'Use the school problem editor for school content' USING ERRCODE='42501';
 END IF;
 -- A retained draft may predate single-definition editing. Carry forward
 -- the same school access and first-AC dates as the live platform problem.
 previous:=v;
 IF p.owner_scope='platform' AND v.published_at IS NULL THEN
  SELECT * INTO previous FROM problem_versions earlier WHERE earlier.problem_id=p.id AND earlier.published_at IS NOT NULL
  ORDER BY (bank.visibility='school' AND earlier.school_visible_at IS NOT NULL AND earlier.rank_review_status='approved') DESC,
   earlier.published_at DESC,earlier.created_at DESC,earlier.id DESC LIMIT 1;
  IF NOT FOUND THEN previous:=v; END IF;
 END IF;
 editor:=v.edit_draft;
 IF editor IS NULL OR v.edit_revision<>expected_revision OR NOT EXISTS(
  SELECT 1 FROM judge_tasks t JOIN judge_runs r ON r.task_id=t.id AND r.lease_id=t.lease_id
  WHERE t.id=v.draft_validation_task_id AND t.version_id=v.id AND t.draft_revision=v.edit_revision
   AND t.state='completed' AND r.status='AC'
 ) THEN RAISE EXCEPTION 'Draft changed or validation is incomplete' USING ERRCODE='23514'; END IF;

 PERFORM set_config('campus.promoting_problem',source_id::text,true);
 presentation:=v.draft_presentation;
 IF previous.id<>source_id AND presentation IS NULL AND EXISTS(SELECT 1 FROM problem_public_statements WHERE version_id=previous.id)
 THEN RAISE EXCEPTION 'Previous English presentation requires review' USING ERRCODE='23514'; END IF;
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
  school_visible_at=CASE WHEN approve_school THEN COALESCE(v.school_visible_at,clock_timestamp()) ELSE previous.school_visible_at END,
  course_only_published=CASE WHEN approve_school THEN false ELSE previous.course_only_published OR (p.owner_scope='platform' AND previous.published_at IS NULL) END,
  rank_review_status=CASE WHEN approve_school THEN 'approved' ELSE previous.rank_review_status END,
  rank_reviewed_at=CASE WHEN approve_school THEN clock_timestamp() ELSE previous.rank_reviewed_at END,
  rank_reviewed_by=CASE WHEN approve_school THEN actor_id ELSE previous.rank_reviewed_by END,
  rank_approved_at=CASE WHEN approve_school THEN
   CASE WHEN v.rank_review_status='approved' AND v.school_visible_at IS NOT NULL THEN COALESCE(v.rank_approved_at,clock_timestamp()) ELSE clock_timestamp() END
   ELSE previous.rank_approved_at END,
  rank_review_reason=CASE WHEN approve_school THEN NULL ELSE previous.rank_review_reason END,
  edit_draft=NULL,draft_validation_task_id=NULL,draft_review_status=NULL,draft_review_at=NULL,draft_review_reason=NULL,draft_presentation=NULL
  WHERE id=source_id;
 UPDATE problems SET current_version_id=source_id WHERE id=v.problem_id;
 PERFORM set_config('campus.promoting_problem','',true);
END $$;

-- Point rules remain opt-in per edition. A native dossier identifies the
-- pupil who earned an award, including after that account leaves the school.
ALTER TABLE acsl_point_rules DROP CONSTRAINT acsl_point_rules_school_id_check;
ALTER TABLE acsl_point_awards DROP CONSTRAINT acsl_point_awards_school_id_check,
 DROP CONSTRAINT acsl_point_awards_identity_id_fkey,
 ADD FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id);
ALTER TABLE acsl_programming_point_receipts DROP CONSTRAINT acsl_programming_point_receipts_school_id_check,
 DROP CONSTRAINT acsl_programming_point_receipts_identity_id_fkey,
 ADD FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id);
DROP POLICY legacy_scope ON acsl_point_awards;
CREATE POLICY school_scope ON acsl_point_awards
 USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
CREATE FUNCTION acsl_point_student(school uuid,actor uuid) RETURNS uuid
 LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT i.id FROM school_identities i JOIN school_memberships m USING(school_id,account_id)
 JOIN accounts a ON a.id=m.account_id JOIN identities holder ON holder.id=a.identity_id
 WHERE i.school_id=school AND i.account_id=actor AND i.kind='student' AND i.archived_at IS NULL AND m.role='student'
  AND m.revoked_at IS NULL AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND holder.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION acsl_point_student(uuid,uuid) FROM PUBLIC,campus_app,campus_worker;
CREATE OR REPLACE FUNCTION acsl_written_point_award() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; student uuid; rule acsl_point_rules;
BEGIN
 previous_scope:=current_setting('campus.school_id',true);
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT * INTO rule FROM acsl_point_rules WHERE school_id=NEW.school_id AND paper_id=NEW.paper_id AND version_id=NEW.version_id AND enabled_at<=NEW.created_at;
 IF FOUND THEN
  student:=acsl_point_student(NEW.school_id,NEW.account_id);
  IF student IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('acsl-points:'||NEW.school_id||':'||NEW.paper_id||':'||student,0));
   INSERT INTO acsl_point_awards(school_id,paper_id,version_id,identity_id,section,grade_id,points)
    VALUES(NEW.school_id,NEW.paper_id,NEW.version_id,student,'written',NEW.id,NEW.correct_count*rule.written_points_per_correct)
    ON CONFLICT(school_id,paper_id,identity_id,section) DO NOTHING;
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION acsl_programming_point_award() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; student uuid; paper acsl_papers; rule acsl_point_rules;
 receipt acsl_programming_point_receipts; verdict text; prior_ac boolean;
BEGIN
 IF NEW.access_context<>'acsl' OR NEW.kind<>'submit' THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true);
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 IF TG_OP='INSERT' THEN
  SELECT * INTO paper FROM acsl_papers WHERE school_id=NEW.school_id
   AND programming_problem_id=NEW.problem_id AND programming_version_id=NEW.version_id AND enabled;
  IF FOUND THEN
   SELECT * INTO rule FROM acsl_point_rules WHERE school_id=NEW.school_id AND paper_id=paper.id
    AND version_id=paper.version_id AND enabled_at<=NEW.created_at;
   IF FOUND THEN
    student:=acsl_point_student(NEW.school_id,NEW.account_id);
    IF student IS NOT NULL THEN
     PERFORM pg_advisory_xact_lock(hashtextextended('acsl-points:'||NEW.school_id||':'||paper.id||':'||student,0));
     SELECT EXISTS (
      SELECT 1 FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
      LEFT JOIN acsl_programming_point_receipts r ON r.school_id=j.school_id AND r.job_id=j.id
      WHERE j.school_id=NEW.school_id AND j.problem_id=NEW.problem_id AND j.id<>NEW.id
       AND coalesce(r.identity_id,j.identity_id)=student AND j.access_context='acsl' AND j.kind='submit'
       AND j.state='completed' AND j.result->>'status'='AC'
     ) INTO prior_ac;
     INSERT INTO acsl_programming_point_receipts(school_id,job_id,paper_id,version_id,identity_id,points,eligible,received_at)
      VALUES(NEW.school_id,NEW.id,paper.id,paper.version_id,student,rule.programming_points,NOT prior_ac,NEW.created_at);
    END IF;
   END IF;
  END IF;
 ELSIF NEW.state='completed' THEN
  verdict:=NEW.result->>'status';
  IF verdict IN ('AC','WA','CE','RE','TLE','MLE','OLE') THEN
   SELECT * INTO receipt FROM acsl_programming_point_receipts WHERE school_id=NEW.school_id AND job_id=NEW.id FOR UPDATE;
   IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('acsl-points:'||NEW.school_id||':'||receipt.paper_id||':'||receipt.identity_id,0));
    IF receipt.settled_status IS NOT NULL THEN
     IF receipt.settled_status<>verdict AND receipt.review_status IS DISTINCT FROM verdict THEN
      UPDATE acsl_programming_point_receipts SET review_status=verdict,review_detected_at=clock_timestamp()
       WHERE school_id=NEW.school_id AND job_id=NEW.id;
     END IF;
    ELSE
     UPDATE acsl_programming_point_receipts SET settled_status=verdict WHERE school_id=NEW.school_id AND job_id=NEW.id;
     IF verdict='AC' AND receipt.eligible THEN
      -- An earlier unreceipted success is a baseline, including work accepted
      -- after this job was queued. Enabling rewards never pays historical ACs.
      SELECT EXISTS (
       SELECT 1 FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
       LEFT JOIN acsl_programming_point_receipts r ON r.school_id=j.school_id AND r.job_id=j.id
       WHERE j.school_id=NEW.school_id AND j.problem_id=NEW.problem_id AND j.id<>NEW.id
        AND coalesce(r.identity_id,j.identity_id)=receipt.identity_id AND j.access_context='acsl' AND j.kind='submit'
        AND j.state='completed' AND j.result->>'status'='AC' AND r.job_id IS NULL
      ) INTO prior_ac;
      IF NOT prior_ac THEN
       INSERT INTO acsl_point_awards(school_id,paper_id,version_id,identity_id,section,job_id,points)
        VALUES(NEW.school_id,receipt.paper_id,receipt.version_id,receipt.identity_id,'programming',NEW.id,receipt.points)
        ON CONFLICT(school_id,paper_id,identity_id,section) DO NOTHING;
      END IF;
     END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN NEW;
END $$;
DROP FUNCTION acsl_point_student(uuid);
