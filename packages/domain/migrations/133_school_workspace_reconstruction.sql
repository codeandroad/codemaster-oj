CREATE TEMP TABLE rebuilding_school ON COMMIT DROP AS SELECT id FROM schools WHERE id='00000000-0000-4000-8000-000000000052';
SELECT set_config('campus.school_id',id::text,true) FROM rebuilding_school;
ALTER TABLE school_memberships DROP CONSTRAINT school_memberships_school_id_check;
ALTER TABLE school_administrators DROP CONSTRAINT school_administrators_school_id_check;
ALTER TABLE school_classes DROP CONSTRAINT school_classes_school_id_check;
ALTER TABLE school_identities DROP CONSTRAINT school_identities_school_id_check;
ALTER TABLE school_identities DROP CONSTRAINT school_identities_kind_check;
ALTER TABLE school_identities ADD CHECK (kind IN ('teacher','student','school_admin'));
ALTER TABLE school_identities ADD COLUMN gender text, ADD COLUMN notes text;
ALTER TABLE school_classes ADD COLUMN description text, ADD COLUMN owner_account_id uuid REFERENCES accounts(id);
ALTER TABLE school_identities DISABLE TRIGGER school_scholarship_identity_insert;
CREATE TEMP TABLE expected_members ON COMMIT DROP AS
 SELECT o.school_id,a.id AS account_id,
  CASE WHEN bool_or(r.role=i.kind AND r.role IN ('student','teacher')) THEN i.kind
       WHEN bool_or(r.role='teacher') THEN 'teacher'
       WHEN bool_or(r.role='student') THEN 'student' ELSE 'school_admin' END role,
  a.created_at joined_at,bool_or(r.role='admin') administrator
 FROM legacy_school_account_ownership o
 JOIN rebuilding_school s ON s.id=o.school_id JOIN accounts a ON a.id=o.account_id
 JOIN identities i ON i.id=a.identity_id JOIN account_roles r ON r.account_id=a.id
 WHERE a.binding_released_at IS NULL AND a.disabled_at IS NULL AND i.archived_at IS NULL
 GROUP BY o.school_id,a.id,i.kind;
INSERT INTO school_memberships(school_id,account_id,role,joined_at)
 SELECT school_id,account_id,role,joined_at FROM expected_members;
INSERT INTO school_administrators(school_id,account_id,granted_by,granted_at)
 SELECT school_id,account_id,account_id,joined_at FROM expected_members WHERE administrator AND role<>'school_admin';
CREATE TEMP TABLE expected_profiles ON COMMIT DROP AS
 SELECT i.id,o.school_id,CASE WHEN i.kind='admin' THEN 'school_admin' ELSE i.kind END kind,i.number,i.name,m.account_id,i.created_at,i.archived_at,i.gender,i.notes
 FROM legacy_school_identity_ownership o JOIN rebuilding_school s ON s.id=o.school_id
 JOIN identities i ON i.id=o.identity_id
 LEFT JOIN accounts a ON a.identity_id=i.id AND a.binding_released_at IS NULL AND a.disabled_at IS NULL
 LEFT JOIN expected_members m ON m.school_id=o.school_id AND m.account_id=a.id AND m.role=CASE WHEN i.kind='admin' THEN 'school_admin' ELSE i.kind END
 WHERE i.kind IN ('teacher','student','admin');
INSERT INTO school_identities(id,school_id,kind,number,name,account_id,created_at,archived_at,gender,notes)
 SELECT * FROM expected_profiles;
ALTER TABLE school_identities ENABLE TRIGGER school_scholarship_identity_insert;
INSERT INTO school_classes(id,school_id,name,type,created_at,archived_at,description,owner_account_id)
 SELECT c.id,c.school_id,c.name,c.type,c.created_at,c.archived_at,c.description,c.owner_account_id
 FROM classes c JOIN rebuilding_school s ON s.id=c.school_id;
CREATE TEMP TABLE expected_roster ON COMMIT DROP AS
 SELECT c.school_id,m.class_id,m.identity_id FROM class_members m JOIN classes c ON c.id=m.class_id JOIN rebuilding_school s ON s.id=c.school_id
 UNION
 SELECT c.school_id,m.class_id,m.identity_id FROM identity_teacher_classes m JOIN classes c ON c.id=m.class_id JOIN rebuilding_school s ON s.id=c.school_id
 UNION
 SELECT c.school_id,m.class_id,a.identity_id FROM teacher_classes m JOIN classes c ON c.id=m.class_id JOIN rebuilding_school s ON s.id=c.school_id
 JOIN accounts a ON a.id=m.account_id;
INSERT INTO school_class_roster(school_id,class_id,identity_id) SELECT * FROM expected_roster;
DO $$ BEGIN
 IF EXISTS (SELECT * FROM expected_profiles EXCEPT SELECT id,school_id,kind,number,name,account_id,created_at,archived_at,gender,notes FROM school_identities)
 OR EXISTS(SELECT * FROM expected_roster EXCEPT SELECT school_id,class_id,identity_id FROM school_class_roster)
 OR EXISTS(SELECT role.account_id, CASE WHEN role.role='admin' THEN 'school_admin' ELSE role.role END FROM account_roles role JOIN expected_members m USING(account_id)
   EXCEPT (SELECT account_id,role FROM school_memberships WHERE school_id IN (SELECT id FROM rebuilding_school)
   UNION SELECT account_id,'school_admin' FROM school_administrators WHERE school_id IN (SELECT id FROM rebuilding_school)))
 THEN RAISE EXCEPTION 'Roster, profiles or role mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM school_scholarship_ledger WHERE school_id IN (SELECT id FROM rebuilding_school))
 THEN RAISE EXCEPTION 'Backfill emitted scholarship entries'; END IF;
END $$;
-- Preserve the original shared balance, ledger IDs, and refund history on the platform.
CREATE TEMP TABLE platform_balances ON COMMIT DROP AS TABLE luq_accounts;
CREATE TEMP TABLE platform_entries ON COMMIT DROP AS TABLE luq_ledger;
CREATE TEMP TABLE migrating_students ON COMMIT DROP AS SELECT school_id,id FROM school_identities
 WHERE school_id=current_setting('campus.school_id')::uuid AND kind='student';
-- Keep proof of the original transaction. Posting fabricated school credits or
-- purchases would create a second spendable balance and a second refund path.
ALTER TABLE school_scholarship_entitlements ADD COLUMN platform_entitlement_id uuid UNIQUE REFERENCES luq_assistance_entitlements(id);
ALTER TABLE school_scholarship_claims ADD COLUMN platform_ledger_id bigint REFERENCES luq_ledger(id);
ALTER TABLE school_scholarship_activity_awards ALTER COLUMN ledger_id DROP NOT NULL,
 ADD COLUMN platform_ledger_id bigint REFERENCES luq_ledger(id),
 ADD CHECK(num_nonnulls(ledger_id,platform_ledger_id)=1);
INSERT INTO school_scholarship_settings(school_id,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap)
 SELECT current_setting('campus.school_id')::uuid,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap FROM luq_settings WHERE singleton;
INSERT INTO school_scholarship_accounts(school_id,identity_id,balance,initial_granted)
 SELECT school_id,id,0,true FROM migrating_students;
INSERT INTO school_scholarship_entitlements(school_id,identity_id,subject_key,kind,language,created_at,platform_entitlement_id)
 SELECT s.school_id,s.id,e.subject_key,e.kind,e.language,e.created_at,e.id FROM migrating_students s
 JOIN luq_assistance_entitlements e ON e.identity_id=s.id;
INSERT INTO school_scholarship_claims(school_id,identity_id,subject_key,eligible,reason,platform_ledger_id,created_at)
 SELECT s.school_id,s.id,c.subject_key,c.eligible,c.reason,c.ledger_id,c.created_at FROM migrating_students s
 JOIN luq_first_ac_claims c ON c.identity_id=s.id;
INSERT INTO school_scholarship_activity_awards(school_id,identity_id,activity_id,activity_type,rule_revision,platform_ledger_id)
 SELECT s.school_id,s.id,a.activity_id,CASE WHEN a.activity_type IN ('assignment','timed') THEN 'activity' ELSE a.activity_type END,
 r.rule_version,a.ledger_id FROM migrating_students s JOIN luq_activity_awards a ON a.identity_id=s.id JOIN luq_activity_rules r ON r.id=a.rule_id;
DO $$ BEGIN
 IF EXISTS(TABLE platform_balances EXCEPT TABLE luq_accounts) OR EXISTS(TABLE luq_accounts EXCEPT TABLE platform_balances)
 OR EXISTS(TABLE platform_entries EXCEPT TABLE luq_ledger) OR EXISTS(TABLE luq_ledger EXCEPT TABLE platform_entries)
 OR EXISTS (SELECT 1 FROM migrating_students s LEFT JOIN school_scholarship_accounts w ON (w.school_id,w.identity_id)=(s.school_id,s.id)
 WHERE w.balance IS DISTINCT FROM 0 OR w.initial_granted IS DISTINCT FROM true)
 OR EXISTS (SELECT 1 FROM school_scholarship_ledger WHERE school_id=current_setting('campus.school_id')::uuid)
 OR EXISTS(SELECT s.id,e.id,e.subject_key,e.kind,e.language FROM migrating_students s JOIN luq_assistance_entitlements e ON e.identity_id=s.id
 EXCEPT SELECT identity_id,platform_entitlement_id,subject_key,kind,language FROM school_scholarship_entitlements)
 OR EXISTS(SELECT s.id,c.subject_key,c.ledger_id FROM migrating_students s JOIN luq_first_ac_claims c ON c.identity_id=s.id
 EXCEPT SELECT identity_id,subject_key,platform_ledger_id FROM school_scholarship_claims)
 OR EXISTS(SELECT s.id,a.activity_id,a.ledger_id FROM migrating_students s JOIN luq_activity_awards a ON a.identity_id=s.id
 EXCEPT SELECT identity_id,activity_id,platform_ledger_id FROM school_scholarship_activity_awards)
 THEN RAISE EXCEPTION 'Financial reconciliation failed'; END IF;
END $$;
ALTER TABLE school_courses DROP CONSTRAINT school_courses_school_id_check;
ALTER TABLE school_activities DROP CONSTRAINT school_activities_school_id_check;
-- A school-managed bank can have institutional ownership. Keep its null owner.
ALTER TABLE school_problem_banks ALTER COLUMN owner_account_id DROP NOT NULL;
INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,archived,request_id,created_at)
 SELECT b.school_id,b.id,b.owner_account_id,b.name,b.archived_at IS NOT NULL,b.id,b.created_at
 FROM problem_banks b WHERE b.school_id=current_setting('campus.school_id')::uuid AND EXISTS
 (SELECT 1 FROM problems p WHERE p.bank_id=b.id AND p.owner_scope='school');
CREATE TEMP TABLE catalog_editions ON COMMIT DROP AS
 SELECT p.bank_id,p.owner_scope,p.owner_account_id,p.created_at problem_created,p.current_version_id,coalesce(p.current_version_id,first_value(v.id) OVER(PARTITION BY p.id ORDER BY v.created_at DESC,v.id DESC)) authoring_version_id,p.archived_at,p.tutorial_mode,p.tutorial_body,p.tutorial_revision,
 v.*,b.school_id,b.archived_at bank_archived,b.visibility,ps.statement reviewed_statement,ps.metadata reviewed_metadata,
 row_number() OVER(PARTITION BY v.problem_id ORDER BY v.created_at,v.id)::int ordinal
 FROM problems p JOIN problem_banks b ON b.id=p.bank_id JOIN problem_versions v ON v.problem_id=p.id
 LEFT JOIN problem_public_statements ps ON ps.version_id=v.id
 WHERE b.school_id=current_setting('campus.school_id')::uuid AND (p.owner_scope='school' OR
  EXISTS(SELECT 1 FROM assignment_problems pin JOIN assignments a ON a.id=pin.assignment_id
   WHERE (pin.problem_id,pin.version_id,a.school_id)=(p.id,v.id,b.school_id)) OR
  EXISTS(SELECT 1 FROM timed_practice_problems pin JOIN timed_practices t ON t.id=pin.practice_id
   WHERE (pin.problem_id,pin.version_id,t.school_id)=(p.id,v.id,b.school_id)));
CREATE TEMP TABLE prior_publications ON COMMIT DROP AS TABLE school_problem_publications;
CREATE TEMP TABLE scoped_versions ON COMMIT DROP AS SELECT e.*,
 jsonb_build_object('title',title,'statement',coalesce(reviewed_statement,statement),'metadata',coalesce(reviewed_metadata,metadata),
 'mode',mode,'function_name',function_name,'comparator',comparator,'reference_code',reference_code,'reference_language',reference_language,
 'starter_code',starter_code,'starter_codes',starter_codes,'time_limit_ms',time_limit_ms,'memory_limit_mb',memory_limit_mb,'tags',tags,
 'samples',coalesce((SELECT jsonb_agg(s.value ORDER BY n) FROM jsonb_array_elements(samples) WITH ORDINALITY AS s(value,n) WHERE coalesce((value->>'enabled')::boolean,true)),'[]'::jsonb),
 'tests',coalesce((SELECT jsonb_agg(to_jsonb(t)-'version_id' ORDER BY position) FROM test_cases t WHERE t.version_id=e.id AND t.enabled),'[]'::jsonb)) AS definition
 FROM catalog_editions e;
INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,revision,request_id,created_at,updated_at,tutorial_mode,tutorial_body,tutorial_revision)
 SELECT school_id,problem_id,bank_id,owner_account_id,coalesce(edit_draft,definition || jsonb_build_object('statement',statement,'metadata',metadata)),ordinal+CASE WHEN edit_draft IS NOT NULL THEN 1 ELSE 0 END,problem_id,
 problem_created,created_at,tutorial_mode,tutorial_body,tutorial_revision FROM scoped_versions WHERE owner_scope='school' AND authoring_version_id=id;
INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition,created_at)
 SELECT school_id,id,problem_id,ordinal,definition,created_at FROM scoped_versions WHERE owner_scope='school';
UPDATE school_problem_publication_requests r SET catalog_version_id=NULL FROM scoped_versions e
 WHERE e.owner_scope='school' AND (r.school_id,r.problem_id,r.catalog_version_id)=(e.school_id,e.problem_id,e.id);
UPDATE school_problems p SET published_version_id=CASE WHEN e.published_at IS NOT NULL THEN e.id END,published=e.archived_at IS NULL AND e.bank_archived IS NULL AND e.visibility='school'
 AND e.published_at IS NOT NULL AND e.school_visible_at IS NOT NULL AND e.rank_review_status='approved'
 FROM scoped_versions e WHERE e.owner_scope='school' AND e.current_version_id=e.id AND (p.school_id,p.id)=(e.school_id,e.problem_id);
-- Historical assignments can pin platform-owned versions that never entered the
-- public judge. Use the service-managed bank without changing catalog ownership,
-- publication, or the school's authoring access.
INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,request_id,resource_kind)
 SELECT DISTINCT ON(school_id) school_id,'00000000-0000-4000-8000-000000000074',owner_account_id,
 'Public practice','00000000-0000-4000-8000-000000000074','publication'
 FROM scoped_versions WHERE owner_scope='platform' ORDER BY school_id,problem_id,id
 ON CONFLICT(school_id,id) DO NOTHING;
INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id,created_at)
 SELECT DISTINCT ON(school_id,problem_id) school_id,problem_id,'00000000-0000-4000-8000-000000000074',
 owner_account_id,'{}',problem_id,problem_created FROM scoped_versions WHERE owner_scope='platform'
 ORDER BY school_id,problem_id,id ON CONFLICT(school_id,id) DO NOTHING;
INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition,created_at)
 SELECT e.school_id,e.id,e.problem_id,e.ordinal+coalesce(existing.last_revision,0),
 e.definition-'reference_code'-'reference_language',e.created_at
 FROM scoped_versions e LEFT JOIN LATERAL (
  SELECT max(v.draft_revision) last_revision FROM school_problem_versions v
  WHERE (v.school_id,v.problem_id)=(e.school_id,e.problem_id)
 ) existing ON true WHERE e.owner_scope='platform'
 ON CONFLICT(school_id,id) DO NOTHING;
CREATE TEMP TABLE migrating_courses ON COMMIT DROP AS SELECT p.*,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'body',c.content,'sectionKey',c.section_key,'localizations',c.localizations,
 'objective',c.objective,'checkpoint',c.checkpoint,'checkpointAnswer',c.checkpoint_answer,'acslLinks',c.acsl_links,
 'problems',coalesce((SELECT jsonb_agg(jsonb_build_object('problemId',cp.problem_id,'versionId',cp.version_id) ORDER BY cp.position,cp.problem_id)
 FROM chapter_problems cp WHERE cp.chapter_id=c.id),'[]'::jsonb)) ORDER BY c.position,c.id) FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL),'[]'::jsonb) chapters,
 jsonb_build_object('sections',p.sections,'localizations',p.localizations,'category',p.category,'difficulty',p.difficulty,'coverKey',p.cover_key,
 'estimatedMinutes',p.estimated_minutes,'authorName',p.author_name,'authoredAt',p.authored_at,'coverImage',p.cover_image,'listed',p.listed,'availableFrom',p.available_from,'availableUntil',p.available_until) properties
 FROM learning_paths p WHERE p.owner_scope='school' AND p.school_id=current_setting('campus.school_id')::uuid;
INSERT INTO school_courses(school_id,id,owner_account_id,title,description,access_scope,chapters,create_request_id,create_request_hash,created_at,updated_at,
 properties,archived_at,required_language)
 SELECT school_id,id,owner_account_id,title,description,access_scope,chapters,id,encode(sha256(convert_to(chapters::text,'UTF8')),'hex'),created_at,updated_at,
 properties,archived_at,required_language FROM migrating_courses;
INSERT INTO school_course_publications(school_id,course_id,revision,title,description,access_scope,chapters,published_by,published_at,properties,required_language,language_credit_cutoffs)
 SELECT school_id,id,1,title,description,access_scope,chapters,owner_account_id,published_at,properties,published_required_language,language_credit_cutoffs FROM migrating_courses WHERE published_at IS NOT NULL;
UPDATE school_courses c SET published_revision=1,published=p.archived_at IS NULL AND p.withdrawn_at IS NULL FROM migrating_courses p
 WHERE p.published_at IS NOT NULL AND (c.school_id,c.id)=(p.school_id,p.id);
INSERT INTO school_course_classes(school_id,course_id,class_id)
 SELECT c.school_id,c.id,r.class_id FROM migrating_courses c JOIN learning_path_classes r ON r.path_id=c.id;
INSERT INTO school_course_publication_classes(school_id,course_id,revision,class_id)
 SELECT c.school_id,c.id,1,r.class_id FROM migrating_courses c JOIN learning_path_classes r ON r.path_id=c.id WHERE c.published_at IS NOT NULL;
INSERT INTO school_course_progress(school_id,course_id,identity_id,chapter_id,content_hash,read,updated_at)
 SELECT p.school_id,p.id,r.identity_id,r.chapter_id,encode(sha256(convert_to('{"title":'||to_json(c.title)::text||',"body":'||to_json(c.content)::text||'}','UTF8')),'hex'),r.completed,r.updated_at
 FROM learning_progress r JOIN learning_chapters c ON c.id=r.chapter_id JOIN migrating_courses p ON p.id=c.path_id;
CREATE TEMP TABLE migrating_activities ON COMMIT DROP AS
 SELECT school_id,id,owner_account_id,'assignment' kind,title,description,
 CASE WHEN archived_at IS NOT NULL THEN 'Archived' ELSE state END state,greatest(1,edit_revision) revision,NULL::timestamptz starts_at,due_at ends_at,NULL::int duration_minutes,
 published_at,NULL::timestamptz results_published_at,NULL::timestamptz forced_ended_at,created_at,cancelled_at FROM assignments
 UNION ALL SELECT school_id,id,owner_account_id,'timed',title,description,
 CASE WHEN archived_at IS NOT NULL THEN 'Archived' WHEN state='Draft' THEN 'Draft' ELSE 'Published' END,1,starts_at,ends_at,duration_minutes,
 CASE WHEN state<>'Draft' THEN created_at END,results_published_at,forced_ended_at,created_at,NULL FROM timed_practices;
INSERT INTO school_activities(school_id,id,owner_account_id,kind,title,description,state,revision,starts_at,ends_at,duration_minutes,published_at,results_published_at,forced_ended_at,created_at,cancelled_at,request_id,request_hash,updated_at)
 SELECT a.*,id,encode(sha256(convert_to(id::text,'UTF8')),'hex'),created_at FROM migrating_activities a;
CREATE TEMP TABLE pins ON COMMIT DROP AS
 SELECT a.school_id,a.id activity_id,p.problem_id,p.version_id,row_number() OVER(PARTITION BY a.id ORDER BY CASE WHEN a.problem_order='fixed' THEN p.position END,p.position,p.problem_id)::int position,p.points::int points
 FROM assignments a JOIN assignment_problems p ON p.assignment_id=a.id
 UNION ALL SELECT t.school_id,t.id,p.problem_id,p.version_id,row_number() OVER(PARTITION BY t.id ORDER BY p.position,p.problem_id)::int,p.points::int
 FROM timed_practices t JOIN timed_practice_problems p ON p.practice_id=t.id;
INSERT INTO school_activity_problems(school_id,activity_id,problem_id,version_id,position,points) SELECT * FROM pins;
INSERT INTO school_activity_participants(school_id,activity_id,identity_id,exempt,extended_due_at)
 SELECT a.school_id,a.id,p.identity_id,p.exempt,p.extended_due_at FROM assignments a JOIN assignment_participants p ON p.assignment_id=a.id
 UNION ALL SELECT a.school_id,a.id,p.identity_id,p.exempt,NULL FROM timed_practices a JOIN timed_practice_participants p ON p.practice_id=a.id;
INSERT INTO school_activity_classes(school_id,activity_id,class_id)
 SELECT a.school_id,a.id,p.class_id FROM assignments a JOIN assignment_classes p ON p.assignment_id=a.id
 UNION SELECT school_id,id,class_id FROM assignments WHERE class_id IS NOT NULL
 UNION SELECT a.school_id,a.id,p.class_id FROM timed_practices a JOIN timed_practice_classes p ON p.practice_id=a.id
 UNION SELECT school_id,id,class_id FROM timed_practices WHERE class_id IS NOT NULL;
INSERT INTO school_activity_attempts(school_id,id,activity_id,identity_id,account_id,started_at,deadline_at,finished_at)
 SELECT p.school_id,t.id,p.id,t.identity_id,t.account_id,t.started_at,t.deadline_at,t.finished_at FROM timed_attempts t JOIN timed_practices p ON p.id=t.practice_id;
DO $$ BEGIN
 IF EXISTS(SELECT school_id,problem_id,id,definition FROM scoped_versions WHERE owner_scope='school' EXCEPT SELECT school_id,problem_id,id,definition FROM school_problem_versions)
 OR EXISTS(TABLE pins EXCEPT SELECT school_id,activity_id,problem_id,version_id,position,points FROM school_activity_problems)
 OR EXISTS(SELECT c.school_id,c.id,c.chapters,c.properties FROM migrating_courses c EXCEPT SELECT school_id,id,chapters,properties FROM school_courses)
 OR EXISTS(SELECT c.school_id,cp.chapter_id,cp.problem_id,cp.version_id FROM migrating_courses c JOIN learning_chapters lc ON lc.path_id=c.id JOIN chapter_problems cp ON cp.chapter_id=lc.id
 EXCEPT SELECT c.school_id,(ch->>'id')::uuid,(pin->>'problemId')::uuid,(pin->>'versionId')::uuid FROM school_courses c CROSS JOIN jsonb_array_elements(c.chapters) ch CROSS JOIN jsonb_array_elements(ch->'problems') pin)
 OR EXISTS(SELECT c.school_id,r.identity_id,r.chapter_id,r.completed,r.updated_at FROM migrating_courses c JOIN learning_chapters lc ON lc.path_id=c.id JOIN learning_progress r ON r.chapter_id=lc.id
 EXCEPT SELECT school_id,identity_id,chapter_id,read,updated_at FROM school_course_progress)
 OR EXISTS(TABLE prior_publications EXCEPT TABLE school_problem_publications)
 OR EXISTS(TABLE school_problem_publications EXCEPT TABLE prior_publications)
 THEN RAISE EXCEPTION 'Academic reconciliation failed'; END IF;
END $$;
ALTER TABLE school_paper4_papers DROP CONSTRAINT school_paper4_papers_school_id_check;
CREATE TEMP TABLE editions ON COMMIT DROP AS SELECT p.school_id,p.id AS paper_id,p.owner_account_id,p.current_version_id,p.draft_version_id,
 p.status,p.archived_at,p.created_at paper_created,p.updated_at,v.id version_id,v.version_number,v.draft_revision,v.created_at,
 jsonb_build_object('title',v.title,'shortTitle',p.short_title,'description',v.description,'definition',v.definition,'referenceSolutions',v.reference_solutions,'runnerCases',v.runner_cases) content
 FROM paper4_papers p JOIN paper4_versions v ON v.paper_id=p.id WHERE p.school_id=current_setting('campus.school_id')::uuid;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM paper4_papers WHERE delivery_kind<>'catalog' OR class_id IS NOT NULL OR starts_at IS NOT NULL OR ends_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM paper4_attempts WHERE state<>'active' OR submitted_at IS NOT NULL OR released_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM paper4_snapshots WHERE origin<>'practice') OR EXISTS(SELECT 1 FROM paper4_run_tasks WHERE state<>'completed')
 THEN RAISE EXCEPTION 'Unexpected assessment or pending job'; END IF;
END $$;
INSERT INTO school_paper4_papers(school_id,id,owner_account_id,draft,revision,archived,created_at,updated_at)
 SELECT school_id,paper_id,owner_account_id,content,version_number,archived_at IS NOT NULL,paper_created,updated_at FROM editions WHERE version_id=coalesce(draft_version_id,current_version_id);
INSERT INTO school_paper4_versions(school_id,id,paper_id,draft_revision,content,created_at)
 SELECT school_id,version_id,paper_id,version_number,content,created_at FROM editions;
UPDATE school_paper4_papers p SET published_version_id=e.version_id,published=e.status='published'
 FROM editions e WHERE (p.school_id,p.id)=(e.school_id,e.paper_id) AND e.version_id=e.current_version_id;
INSERT INTO school_paper4_attempts(school_id,id,paper_id,version_id,identity_id,account_id,state,revision,created_at)
 SELECT p.school_id,a.id,a.paper_id,a.version_id,a.identity_id,a.account_id,'draft',1,a.started_at
 FROM paper4_attempts a JOIN paper4_papers p ON p.id=a.paper_id;
INSERT INTO school_paper4_files(school_id,attempt_id,question_key,code,revision,updated_at)
 SELECT a.school_id,f.attempt_id,f.question_key,f.content,f.revision+1,f.updated_at FROM paper4_attempt_files f JOIN school_paper4_attempts a ON a.id=f.attempt_id;
CREATE TEMP TABLE reference_actor ON COMMIT DROP AS
 SELECT s.id,(array_agg(DISTINCT a.actor_account_id))[1] actor FROM paper4_reference_snapshots s JOIN paper4_versions v ON v.id=s.version_id
 JOIN audit_events a ON a.action='paper4.reference_run' AND a.resource_type='paper4_paper' AND a.resource_id=v.paper_id::text
 AND a.metadata->>'versionId'=s.version_id::text AND a.metadata->>'questionKey'=s.question_key
 GROUP BY s.id HAVING count(DISTINCT a.actor_account_id)=1;
ALTER TABLE school_paper4_jobs ADD COLUMN stage_key text;
-- A stage receipt certifies only that stage. It must never act as an
-- approval or whole-paper validation when a teacher later publishes.
CREATE TEMP TABLE jobs ON COMMIT DROP AS
 SELECT e.school_id,t.id,e.version_id,a.id attempt_id,coalesce(u.actor,a.account_id) account_id,a.identity_id,
 CASE WHEN rs.id IS NULL THEN 'run' ELSE 'validation' END kind,coalesce(rs.stage_key,ss.stage_key) stage_key,
 jsonb_build_object('snapshot',coalesce(to_jsonb(rs),to_jsonb(ss))) payload,
 t.state,t.attempts,t.lease_id,t.lease_expires_at,t.node_id,t.available_at,t.created_at,r.created_at completed_at,
 jsonb_build_object('status',r.status,'publicMessage',r.public_message,'receipt',to_jsonb(r),'questions',
  jsonb_build_array(jsonb_build_object('key',coalesce(ss.question_key,rs.question_key),'status',r.status,'publicOutput',r.public_output,'publicMessage',r.public_message,
  'stages',jsonb_build_array(jsonb_build_object('stageKey',coalesce(rs.stage_key,ss.stage_key),'status',r.status))))) result
 FROM paper4_run_tasks t JOIN paper4_runs r ON r.task_id=t.id
 LEFT JOIN paper4_reference_snapshots rs ON rs.id=t.reference_snapshot_id LEFT JOIN reference_actor u ON u.id=rs.id
 LEFT JOIN paper4_snapshots ss ON ss.id=t.snapshot_id LEFT JOIN paper4_attempts a ON a.id=ss.attempt_id
 JOIN editions e ON e.version_id=coalesce(rs.version_id,a.version_id);
INSERT INTO school_paper4_jobs(school_id,id,version_id,attempt_id,account_id,identity_id,kind,stage_key,payload,state,attempts,lease_id,lease_expires_at,node_id,available_at,created_at,completed_at,result)
 SELECT * FROM jobs;
DO $$ BEGIN
 IF EXISTS(SELECT version_id,content FROM editions EXCEPT SELECT id,content FROM school_paper4_versions)
 OR EXISTS(SELECT a.id,a.paper_id,a.version_id,a.identity_id,a.account_id,a.started_at FROM paper4_attempts a EXCEPT SELECT id,paper_id,version_id,identity_id,account_id,created_at FROM school_paper4_attempts)
 OR EXISTS(SELECT attempt_id,question_key,content,revision+1,updated_at FROM paper4_attempt_files EXCEPT SELECT attempt_id,question_key,code,revision,updated_at FROM school_paper4_files)
 OR EXISTS(SELECT to_jsonb(s) FROM paper4_reference_snapshots s EXCEPT SELECT payload->'snapshot' FROM school_paper4_jobs)
 OR EXISTS(SELECT to_jsonb(s) FROM paper4_snapshots s EXCEPT SELECT payload->'snapshot' FROM school_paper4_jobs)
 OR EXISTS(SELECT to_jsonb(r) FROM paper4_runs r EXCEPT SELECT result->'receipt' FROM school_paper4_jobs)
 OR EXISTS(SELECT id FROM paper4_run_tasks EXCEPT SELECT id FROM school_paper4_jobs WHERE payload ? 'snapshot')
 THEN RAISE EXCEPTION 'Paper 4 reconciliation failed'; END IF;
END $$;
-- Restore the language and the precise pin lineage used for older grading receipts.
UPDATE school_activities a SET required_language=o.required_language
 FROM assignments o WHERE (a.school_id,a.id)=(o.school_id,o.id);
UPDATE school_activity_problems p SET prior_version_id=o.prior_version_id,original_problem_version_id=o.original_problem_version_id,
 original_prior_problem_version_id=o.original_prior_problem_version_id
 FROM assignment_problems o JOIN assignments a ON a.id=o.assignment_id
 WHERE (p.school_id,p.activity_id,p.problem_id)=(a.school_id,a.id,o.problem_id);
-- Old timed reports are already adjudicated. Keep the frozen report and its
-- evidence, including the scores as adjudicated at publication.
INSERT INTO school_activity_results(school_id,activity_id,identity_id,grade,published_at)
 SELECT a.school_id,a.id,t.identity_id,jsonb_build_object('score',t.grade->'score','total',t.grade->'maxScore',
 'attempted',details.attempted,'solved',details.solved,'items',details.items,'receipt',t.grade),t.published_at
 FROM timed_result_snapshots t JOIN timed_practices a ON a.id=t.practice_id
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',p.problem_id,'versionId',p.version_id,'title',v.definition->>'title',
 'position',p.position,'points',p.points,'status',coalesce(g->>'status','NotStarted'),'score',round(coalesce((g->>'score')::numeric,0)*p.points/100,2),
 'solved',coalesce(g->>'status'='AC',false),'attempts',n.attempts,'activityAttempts',n.attempts,'inherited',false,'submissionId',g->>'submissionId') ORDER BY p.position) items,
 count(*) FILTER(WHERE n.attempts>0) attempted,count(*) FILTER(WHERE g->>'status'='AC') solved
 FROM school_activity_problems p JOIN school_problem_versions v ON (v.school_id,v.problem_id,v.id)=(p.school_id,p.problem_id,p.version_id)
 LEFT JOIN jsonb_array_elements(t.grade->'problems') g ON (g->>'problemId')::uuid=p.problem_id
 CROSS JOIN LATERAL(SELECT count(*) attempts FROM submissions s JOIN timed_attempts att ON att.id=s.timed_attempt_id
  WHERE s.school_id=a.school_id AND att.practice_id=a.id AND s.identity_id=t.identity_id AND s.problem_id=p.problem_id AND s.kind='submit')n
 WHERE (p.school_id,p.activity_id)=(a.school_id,a.id)) details;
-- Only import the school's own reviewed assistance. Platform editions retain
-- their existing course admission and editorial authorization.
INSERT INTO school_scholarship_contents(school_id,id,subject_key,version_id,kind,language,body,
 status,author_account_id,reviewer_account_id,published_at,updated_at,solution_details,pending_solution)
 SELECT current_setting('campus.school_id')::uuid,c.id,c.subject_key,c.version_id,c.kind,c.language,c.body,c.status,
 c.author_account_id,c.reviewer_account_id,c.published_at,c.updated_at,c.solution_details,c.pending_solution
 FROM luq_assistance_contents c WHERE EXISTS(SELECT 1 FROM school_problem_versions v JOIN problems p ON p.id=v.problem_id AND p.owner_scope='school'
 WHERE v.school_id=current_setting('campus.school_id')::uuid AND v.id=c.version_id AND c.subject_key='problem:'||p.id)
 OR EXISTS(SELECT 1 FROM school_paper4_versions v WHERE v.school_id=current_setting('campus.school_id')::uuid AND v.id=c.version_id
 AND split_part(c.subject_key,':',1)='paper4' AND split_part(c.subject_key,':',2)=v.paper_id::text);
INSERT INTO school_scholarship_deliveries(school_id,id,identity_id,subject_key,version_id,kind,content_id,context_type,context_id,provided_at)
 SELECT c.school_id,d.id,d.identity_id,d.subject_key,d.version_id,d.kind,d.content_id,d.context_type,d.context_id,d.provided_at
 FROM luq_assistance_deliveries d JOIN school_scholarship_contents c ON c.id=d.content_id AND c.school_id=current_setting('campus.school_id')::uuid
 JOIN school_identities i ON (i.school_id,i.id)=(c.school_id,d.identity_id);
INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode,price,opens_at,revision)
 SELECT DISTINCT ON(school_id,target_key,lp.kind) b.school_id,'subject','problem:'||p.id AS target_key,lp.kind,lp.mode,lp.price,lp.opens_at,lp.rule_version
 FROM luq_assistance_policies lp JOIN problems p ON p.id=lp.target_id AND lp.target_type='problem' AND p.owner_scope='school'
 JOIN problem_banks b ON b.id=p.bank_id WHERE b.school_id=current_setting('campus.school_id')::uuid ORDER BY school_id,target_key,lp.kind,lp.rule_version DESC,lp.created_at DESC,lp.id DESC;
INSERT INTO school_scholarship_activity_rules(school_id,activity_type,activity_id,revision,amount,minimum_ac,minimum_score,task_kind,allow_solution_assisted,require_all,created_at)
 SELECT a.school_id,'activity',r.activity_id,r.rule_version,r.amount,r.minimum_ac,r.minimum_score,r.task_kind,r.allow_solution_assisted,r.require_all,r.created_at
 FROM luq_activity_rules r JOIN school_activities a ON a.id=r.activity_id AND a.kind=r.activity_type WHERE a.school_id=current_setting('campus.school_id')::uuid;
INSERT INTO school_rank_awards(school_id,identity_id,subject_key,points,created_at)
 SELECT i.school_id,r.identity_id,'problem:'||r.problem_id,r.points,r.created_at FROM school_rank_ledger r
 JOIN school_identities i ON i.id=r.identity_id AND i.school_id=current_setting('campus.school_id')::uuid;
INSERT INTO school_activation_tokens(school_id,identity_id,token_hash,issued_by,expires_at,consumed_at)
 SELECT i.school_id,t.identity_id,t.token_hash,issuer.actor_account_id,t.expires_at,t.consumed_at
 FROM activation_tokens t JOIN school_identities i ON i.id=t.identity_id
 LEFT JOIN LATERAL(SELECT actor_account_id FROM audit_events WHERE action='identity.activation_issue'
 AND resource_type='identity' AND resource_id=t.identity_id::text ORDER BY created_at DESC,id DESC LIMIT 1) issuer ON true
 WHERE i.school_id=current_setting('campus.school_id')::uuid;
UPDATE school_courses c SET properties=c.properties||jsonb_strip_nulls(jsonb_build_object('mergedIntoId',p.merged_into_id,
 'mergedFirstChapterId',p.merged_first_chapter_id,'availableFrom',p.available_from,'availableUntil',p.available_until,'listed',p.listed))
 FROM learning_paths p WHERE p.owner_scope='school' AND (c.school_id,c.id)=(p.school_id,p.id);
DO $$ BEGIN
 IF EXISTS(SELECT a.school_id,t.practice_id,t.identity_id,t.grade,t.published_at FROM timed_result_snapshots t JOIN timed_practices a ON a.id=t.practice_id
  EXCEPT SELECT school_id,activity_id,identity_id,grade->'receipt',published_at FROM school_activity_results)
 OR EXISTS(SELECT e.identity_id,e.subject_key,e.kind FROM luq_assistance_entitlements e JOIN school_identities i ON i.id=e.identity_id
  WHERE e.subject_key LIKE 'paper4:%' AND NOT EXISTS(SELECT 1 FROM school_scholarship_contents c WHERE c.school_id=i.school_id AND c.subject_key=e.subject_key AND c.kind=e.kind AND c.language=e.language AND c.status='published'))
 THEN RAISE EXCEPTION 'Missing frozen assessment evidence or purchased materials'; END IF;
END $$;
