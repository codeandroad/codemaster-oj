-- Each group is editable by the owner of its exercises. A mixed group gets
-- one ordered projection per owner. Group and problem IDs retain their meaning
-- within that catalogue.
CREATE TABLE practice_problem_groups (
 scope_id uuid NOT NULL REFERENCES practice_storage_scopes(id),id uuid NOT NULL,
 name text NOT NULL,bank_id uuid,owner_account_id uuid REFERENCES accounts(id),archived_at timestamptz,created_at timestamptz NOT NULL,
 PRIMARY KEY(scope_id,id)
);
CREATE TABLE practice_problem_group_members (
 scope_id uuid NOT NULL,group_id uuid NOT NULL,problem_id uuid NOT NULL,position integer NOT NULL,
 PRIMARY KEY(scope_id,group_id,problem_id), FOREIGN KEY(scope_id,group_id) REFERENCES practice_problem_groups(scope_id,id)
);
CREATE TEMP TABLE grouped_problem_sources ON COMMIT DROP AS
 SELECT CASE WHEN p.owner_scope='platform' THEN (SELECT id FROM practice_storage_scopes WHERE school_id IS NULL)
 ELSE b.school_id END scope_id,g.id group_id,g.bank_id,g.name,g.owner_account_id,g.archived_at,g.created_at,m.problem_id,m.position
 FROM problem_groups g JOIN problem_banks b ON b.id=g.bank_id LEFT JOIN problem_group_members m ON m.group_id=g.id
 LEFT JOIN problems p ON p.id=m.problem_id;
INSERT INTO practice_problem_groups SELECT DISTINCT scope_id,group_id,name,bank_id,owner_account_id,archived_at,created_at FROM grouped_problem_sources;
INSERT INTO practice_problem_group_members SELECT scope_id,group_id,problem_id,position FROM grouped_problem_sources WHERE problem_id IS NOT NULL;
ALTER TABLE practice_problem_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_problem_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE practice_problem_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_problem_group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY group_workspace ON practice_problem_groups USING(scope_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
CREATE POLICY member_workspace ON practice_problem_group_members USING(scope_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);

CREATE TABLE school_import_history (
 school_id uuid NOT NULL REFERENCES schools(id),id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('identities','problem_bank','roster')),
 actor_account_id uuid REFERENCES accounts(id), created_at timestamptz NOT NULL,result jsonb NOT NULL, bank_id uuid,class_id uuid,filename text,
 PRIMARY KEY(school_id,kind,id)
);
INSERT INTO school_import_history(school_id,id,kind,actor_account_id,created_at,result)
 SELECT '00000000-0000-4000-8000-000000000052',id,'identities',account_id,created_at,nonsecret_result FROM identity_import_batches;
INSERT INTO school_import_history(school_id,id,kind,actor_account_id,created_at,result,class_id)
 SELECT c.school_id,r.id,'roster',r.account_id,r.created_at,r.nonsecret_result,r.class_id FROM member_import_batches r JOIN classes c ON c.id=r.class_id;
INSERT INTO school_import_history(school_id,id,kind,actor_account_id,created_at,result,bank_id,filename)
 SELECT b.school_id,r.id,'problem_bank',r.account_id,r.created_at,r.result,r.bank_id,r.filename FROM problem_import_batches r JOIN problem_banks b ON b.id=r.bank_id;
-- The new import receipts contain aggregate results. Retire transient replay
-- caches together with their writers during the cutover.
UPDATE member_import_batches SET result_ciphertext=NULL WHERE result_ciphertext IS NOT NULL;
UPDATE identity_import_batches SET result_ciphertext=NULL WHERE result_ciphertext IS NOT NULL;
ALTER TABLE school_import_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_import_history FORCE ROW LEVEL SECURITY;
CREATE POLICY import_workspace ON school_import_history USING(school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);

ALTER TABLE school_activity_problems ADD COLUMN reward_points integer CHECK(reward_points BETWEEN 0 AND 1000);
UPDATE school_activity_problems p SET reward_points=old.points FROM point_rewards old
 WHERE (p.activity_id,p.problem_id)=(old.assignment_id,old.problem_id);
ALTER TABLE legacy_assignment_preview_submissions RENAME TO assignment_preview_receipts;
ALTER INDEX legacy_assignment_preview_history RENAME TO assignment_preview_receipt_history;

-- Preserve the underlying rows referenced by immutable judge evidence. Runtime
-- editors now write to the canonical school tables. Platform source editing
-- still uses its existing version, chapter and grant model.
CREATE FUNCTION protect_catalog_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope text;
BEGIN
 IF TG_TABLE_NAME IN ('problems','learning_paths') THEN
  IF TG_OP<>'INSERT' AND OLD.owner_scope='school' THEN RAISE EXCEPTION 'Use the school workspace' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'DELETE' THEN scope:=NEW.owner_scope; END IF;
 ELSIF TG_TABLE_NAME='problem_versions' THEN
  SELECT owner_scope INTO scope FROM problems WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.problem_id ELSE NEW.problem_id END;
 ELSIF TG_TABLE_NAME='test_cases' THEN
  SELECT p.owner_scope INTO scope FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 ELSIF TG_TABLE_NAME IN ('chapter_problems','learning_progress') THEN
  SELECT path.owner_scope INTO scope FROM learning_chapters chapter JOIN learning_paths path ON path.id=chapter.path_id
   WHERE chapter.id=CASE WHEN TG_OP='DELETE' THEN OLD.chapter_id ELSE NEW.chapter_id END;
 ELSIF TG_TABLE_NAME='luq_assistance_contents' THEN
  SELECT p.owner_scope INTO scope FROM problem_versions version JOIN problems p ON p.id=version.problem_id
   WHERE version.id=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF EXISTS(SELECT 1 FROM paper4_versions WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END) THEN scope:='school'; END IF;
 ELSIF TG_TABLE_NAME='learning_chapters' THEN
  SELECT owner_scope INTO scope FROM learning_paths WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.path_id ELSE NEW.path_id END;
 END IF;
 IF scope='school' THEN RAISE EXCEPTION 'Use the school workspace' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$
DECLARE rel text;
BEGIN
 FOREACH rel IN ARRAY ARRAY['problems','problem_versions','test_cases','learning_paths','learning_chapters','chapter_problems','learning_progress','luq_assistance_contents'] LOOP
  EXECUTE format('CREATE TRIGGER protect_school_source BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW WHEN (current_user=''campus_app'') EXECUTE FUNCTION protect_catalog_source()',rel);
 END LOOP;
END $$;

-- Learning materials retain their original audience and course/chapter anchors.
ALTER TABLE school_learning_resources ADD COLUMN platform_course_id uuid REFERENCES learning_paths(id),
 DROP CONSTRAINT school_learning_resources_check, DROP CONSTRAINT school_learning_resources_type_check,
 ADD CHECK(num_nonnulls(course_id,platform_course_id)<=1 AND (chapter_id IS NULL OR num_nonnulls(course_id,platform_course_id)=1)),
 ADD CHECK(type IN ('reading','video','reference','note','article','link'));
INSERT INTO school_learning_resources(school_id,id,owner_account_id,title,type,scope,content,
 course_id,platform_course_id,chapter_id,create_request_id,create_request_hash,deleted_at,created_at,updated_at)
 SELECT r.school_id,r.id,r.owner_account_id,r.title,r.type,r.scope,r.content,
 CASE WHEN p.owner_scope='school' THEN p.id END,CASE WHEN p.owner_scope='platform' THEN p.id END,
 r.chapter_id,r.id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),r.archived_at,r.created_at,r.updated_at
 FROM learning_resources r LEFT JOIN learning_paths p ON p.id=r.path_id;
