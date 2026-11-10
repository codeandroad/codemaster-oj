-- School staff may edit a narrowly bounded ACSL document through this entry
-- point. Runtime roles still cannot write papers, snapshots, or audit rows.
CREATE TABLE acsl_management_updates (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 paper_id uuid NOT NULL, version_id uuid NOT NULL, actor_account_id uuid NOT NULL REFERENCES accounts(id),
 request_id uuid NOT NULL, request_hash text NOT NULL, reason text NOT NULL,
 before_hash text NOT NULL, after_hash text NOT NULL,
 before_grading_hash text NOT NULL, after_grading_hash text NOT NULL,
 before_definition jsonb NOT NULL, after_definition jsonb NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id), UNIQUE(school_id,actor_account_id,request_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
CREATE TRIGGER acsl_management_updates_immutable BEFORE UPDATE OR DELETE ON acsl_management_updates
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
ALTER TABLE acsl_management_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_management_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_management_updates
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
REVOKE ALL ON acsl_management_updates FROM PUBLIC,campus_app,campus_worker;

CREATE FUNCTION acsl_edit_contract(document jsonb, keep_answers boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE contract jsonb; question jsonb; stripped jsonb; questions jsonb:='[]'; program jsonb;
BEGIN
 contract:=document-ARRAY['title','questions','programming'];
 FOR question IN SELECT value FROM jsonb_array_elements(document->'questions') LOOP
  stripped:=question-ARRAY['topic','statement','statementDiagrams','explanation','explanationDiagrams','options'];
  IF NOT keep_answers THEN stripped:=stripped-'correctOptionIds'; END IF;
  stripped:=stripped||jsonb_build_object('options',(SELECT jsonb_agg(value-ARRAY['text','diagrams'] ORDER BY ordinal)
   FROM jsonb_array_elements(question->'options') WITH ORDINALITY options(value,ordinal)));
  questions:=questions||jsonb_build_array(stripped);
 END LOOP;
 contract:=contract||jsonb_build_object('questions',questions);
 IF document ? 'programming' THEN
  program:=document->'programming';
  IF jsonb_typeof(program)='object' THEN
   program:=(program-ARRAY['statementZh','statementDiagrams','definition'])||
    jsonb_build_object('definition',(program->'definition')-ARRAY['title','statement']);
  END IF;
  contract:=contract||jsonb_build_object('programming',program);
 END IF;
 RETURN contract;
END $$;
CREATE FUNCTION acsl_edit_localized(value jsonb, maximum integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND value-ARRAY['en','zh']='{}'::jsonb
  AND jsonb_typeof(value->'en')='string' AND length(btrim(value->>'en')) BETWEEN 1 AND maximum
  AND jsonb_typeof(value->'zh')='string' AND length(btrim(value->>'zh')) BETWEEN 1 AND maximum,false);
$$;
REVOKE ALL ON FUNCTION acsl_edit_contract(jsonb,boolean),acsl_edit_localized(jsonb,integer) FROM PUBLIC,campus_app,campus_worker;

CREATE FUNCTION acsl_edit_number(value jsonb,minimum numeric,maximum numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::numeric BETWEEN minimum AND maximum ELSE false END;
$$;
CREATE FUNCTION acsl_edit_diagrams(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE language text; diagram jsonb; element jsonb; point jsonb; key text; keys text[]; required text[];
 colors text[]:=ARRAY['ink','muted','accent','surface','none','red','green','blue','yellow','orange','cyan','magenta','white','black'];
 path text; token text[]; arity integer; coordinates integer;
BEGIN
 IF value IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(value)<>'object' OR value-ARRAY['en','zh']<>'{}'::jsonb THEN RETURN false; END IF;
 FOREACH language IN ARRAY ARRAY['en','zh'] LOOP
  IF jsonb_typeof(value->language) IS DISTINCT FROM 'array' OR jsonb_array_length(value->language)>20 THEN RETURN false; END IF;
  IF (SELECT count(*)<>count(DISTINCT d->>'id') FROM jsonb_array_elements(value->language) d) THEN RETURN false; END IF;
  FOR diagram IN SELECT d FROM jsonb_array_elements(value->language) d LOOP
   IF jsonb_typeof(diagram)<>'object' OR diagram-ARRAY['id','width','height','alt','elements']<>'{}'::jsonb
    OR coalesce(diagram->>'id','')!~'^[A-Za-z0-9-]{1,100}$'
    OR NOT acsl_edit_number(diagram->'width',1,4096) OR NOT acsl_edit_number(diagram->'height',1,4096)
    OR NOT acsl_edit_localized(diagram->'alt',1000) OR jsonb_typeof(diagram->'elements') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF jsonb_array_length(diagram->'elements') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
   FOR element IN SELECT e FROM jsonb_array_elements(diagram->'elements') e LOOP
    IF jsonb_typeof(element)<>'object' OR element ? 'stroke' AND NOT coalesce(element->>'stroke'=ANY(colors),false)
      OR element ? 'fill' AND NOT coalesce(element->>'fill'=ANY(colors),false)
      OR element ? 'strokeWidth' AND NOT acsl_edit_number(element->'strokeWidth',0,32) THEN RETURN false; END IF;
    required:=CASE element->>'type' WHEN 'line' THEN ARRAY['x1','y1','x2','y2'] WHEN 'circle' THEN ARRAY['cx','cy']
      WHEN 'ellipse' THEN ARRAY['cx','cy'] WHEN 'rect' THEN ARRAY['x','y'] WHEN 'text' THEN ARRAY['x','y'] ELSE '{}'::text[] END;
    keys:=CASE element->>'type' WHEN 'path' THEN ARRAY['d'] WHEN 'line' THEN required WHEN 'polyline' THEN ARRAY['points']
      WHEN 'circle' THEN ARRAY['cx','cy','r'] WHEN 'ellipse' THEN ARRAY['cx','cy','rx','ry']
      WHEN 'rect' THEN ARRAY['x','y','width','height','rx'] WHEN 'text' THEN ARRAY['x','y','text','fontSize','anchor','font','weight'] ELSE NULL END;
    IF keys IS NULL OR element-(ARRAY['type','stroke','fill','strokeWidth']||keys)<>'{}'::jsonb THEN RETURN false; END IF;
    FOREACH key IN ARRAY required LOOP IF NOT acsl_edit_number(element->key,-16384,16384) THEN RETURN false; END IF; END LOOP;
    IF element->>'type'='circle' AND NOT acsl_edit_number(element->'r',0.01,4096)
      OR element->>'type'='ellipse' AND (NOT acsl_edit_number(element->'rx',0.01,4096) OR NOT acsl_edit_number(element->'ry',0.01,4096))
      OR element->>'type'='rect' AND (NOT acsl_edit_number(element->'width',0.01,4096) OR NOT acsl_edit_number(element->'height',0.01,4096)
        OR element ? 'rx' AND NOT acsl_edit_number(element->'rx',0,2048)) THEN RETURN false; END IF;
    IF element->>'type'='text' THEN
     IF jsonb_typeof(element->'text') IS DISTINCT FROM 'string' OR length(btrim(element->>'text')) NOT BETWEEN 1 AND 1000
      OR element ? 'fontSize' AND NOT acsl_edit_number(element->'fontSize',1,256)
      OR element ? 'anchor' AND NOT coalesce(element->>'anchor'=ANY(ARRAY['start','middle','end']),false)
      OR element ? 'font' AND NOT coalesce(element->>'font'=ANY(ARRAY['sans','serif','mono']),false)
      OR element ? 'weight' AND NOT coalesce(element->>'weight'=ANY(ARRAY['normal','bold']),false) THEN RETURN false; END IF;
    ELSIF element->>'type'='polyline' THEN
     IF jsonb_typeof(element->'points') IS DISTINCT FROM 'array' OR jsonb_array_length(element->'points') NOT BETWEEN 2 AND 2000 THEN RETURN false; END IF;
     FOR point IN SELECT p FROM jsonb_array_elements(element->'points') p LOOP
      IF jsonb_typeof(point)<>'array' OR jsonb_array_length(point)<>2 OR NOT acsl_edit_number(point->0,-16384,16384) OR NOT acsl_edit_number(point->1,-16384,16384) THEN RETURN false; END IF;
     END LOOP;
    ELSIF element->>'type'='path' THEN
     path:=element->>'d';
     IF jsonb_typeof(element->'d') IS DISTINCT FROM 'string' OR length(path) NOT BETWEEN 1 AND 128000 OR ltrim(path)!~'^[Mm]'
       OR regexp_replace(path,'[MmLlCcQqZz]|[-+]?(?:[0-9]*\.[0-9]+|[0-9]+\.?[0-9]*)(?:[eE][-+]?[0-9]+)?','','g')!~'^[[:space:],]*$' THEN RETURN false; END IF;
     arity:=NULL; coordinates:=0;
     FOR token IN SELECT regexp_matches(path,'([MmLlCcQqZz])|([-+]?(?:[0-9]*\.[0-9]+|[0-9]+\.?[0-9]*)(?:[eE][-+]?[0-9]+)?)','g') LOOP
      IF token[1] IS NOT NULL THEN
       IF arity IS NOT NULL AND (arity=0 AND coordinates<>0 OR arity>0 AND (coordinates=0 OR coordinates%arity<>0)) THEN RETURN false; END IF;
       arity:=CASE upper(token[1]) WHEN 'M' THEN 2 WHEN 'L' THEN 2 WHEN 'C' THEN 6 WHEN 'Q' THEN 4 ELSE 0 END; coordinates:=0;
      ELSE
       IF token[2]::numeric NOT BETWEEN -16384 AND 16384 THEN RETURN false; END IF;
       coordinates:=coordinates+1;
      END IF;
     END LOOP;
     IF arity=0 AND coordinates<>0 OR arity>0 AND (coordinates=0 OR coordinates%arity<>0) THEN RETURN false; END IF;
    END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION acsl_edit_number(jsonb,numeric,numeric),acsl_edit_diagrams(jsonb) FROM PUBLIC,campus_app,campus_worker;

CREATE FUNCTION acsl_edit_paper(target_school uuid,target_paper uuid,actor uuid,request_text text,content_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; permitted boolean; paper acsl_papers; prior acsl_management_updates;
 request jsonb; document jsonb; fingerprint text; new_hash text; request_key uuid; revision uuid;
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
 IF jsonb_typeof(request)<>'object' OR jsonb_typeof(document)<>'object'
   OR request-ARRAY['expectedContentHash','requestId','reason','title','questions','programming']<>'{}'::jsonb
   OR coalesce(request->>'expectedContentHash','')!~'^[a-f0-9]{64}$'
   OR jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 2000
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
 VALUES(target_school,target_paper,paper.version_id,actor,request_key,fingerprint,btrim(request->>'reason'),paper.content_hash,new_hash,
  encode(sha256(convert_to(acsl_edit_contract(paper.definition,true)::text,'UTF8')),'hex'),
  encode(sha256(convert_to(acsl_edit_contract(document,true)::text,'UTF8')),'hex'),paper.definition,document,result);
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION acsl_edit_paper(uuid,uuid,uuid,text,text) FROM PUBLIC,campus_app,campus_worker;
GRANT EXECUTE ON FUNCTION acsl_edit_paper(uuid,uuid,uuid,text,text) TO campus_app;
