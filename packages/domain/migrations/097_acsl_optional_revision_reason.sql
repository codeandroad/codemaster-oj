-- Keep the existing audit rows and request fingerprints. An omitted or
-- blank teacher revision reason is recorded as an empty string.
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
 IF target_school='00000000-0000-4000-8000-000000000052' THEN
  PERFORM 1 FROM legacy_school_account_ownership o JOIN account_roles r ON r.account_id=o.account_id
   WHERE o.account_id=actor AND r.role IN ('teacher','admin') FOR SHARE OF o,r;
  permitted:=FOUND;
 ELSE
  PERFORM 1 FROM school_memberships m WHERE m.school_id=target_school AND m.account_id=actor AND m.revoked_at IS NULL
   AND (m.role IN ('teacher','school_admin') OR EXISTS(SELECT 1 FROM school_administrators a
    WHERE a.school_id=m.school_id AND a.account_id=m.account_id AND a.revoked_at IS NULL)) FOR SHARE OF m;
  permitted:=FOUND;
 END IF;
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
