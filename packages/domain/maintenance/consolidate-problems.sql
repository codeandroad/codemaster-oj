\set ON_ERROR_STOP on
-- Run as the migration role while API and workers are stopped. Approve
-- reviewed drafts first; this script deliberately refuses to choose for you.
-- Set expected_database to the intended database and apply=1 to commit.
-- An optional comma-separated problem_ids limits the repair to selected legacy problems.
\if :{?problem_ids}
\else
\set problem_ids ''
\endif
BEGIN;
SELECT set_config('campus.consolidation_expected_db', :'expected_database', true);
SELECT nullif(:'problem_ids','') IS NULL AS consolidate_all \gset
DO $$ BEGIN
 IF current_database() <> current_setting('campus.consolidation_expected_db',true) THEN RAISE EXCEPTION 'Wrong database for consolidation'; END IF;
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='115_acsl_stable_problem.sql') THEN
  RAISE EXCEPTION 'Apply editor and judge-input migrations first';
 END IF;
 IF EXISTS (SELECT 1 FROM judge_tasks WHERE state IN ('queued','leased'))
 OR EXISTS (SELECT 1 FROM school_judge_jobs WHERE state IN ('queued','leased')) THEN
  RAISE EXCEPTION 'Active judge jobs must finish first';
 END IF;
END $$;

CREATE TEMP TABLE legacy_keep ON COMMIT DROP AS
SELECT p.id problem_id, COALESCE(
 (SELECT v.id FROM problem_versions v JOIN problem_banks b ON b.id=p.bank_id
   WHERE v.problem_id=p.id AND v.published_at IS NOT NULL
   ORDER BY (p.owner_scope='platform' AND v.id=p.current_version_id
    AND v.rank_review_status='approved' AND v.school_visible_at IS NOT NULL) DESC NULLS LAST,
    (b.visibility='school' AND v.school_visible_at IS NOT NULL AND v.rank_review_status='approved') DESC,
    (b.visibility<>'school' AND v.id=p.current_version_id) DESC,
    v.published_at DESC,v.created_at DESC,v.id DESC LIMIT 1),
 (SELECT v.id FROM problem_versions v WHERE v.problem_id=p.id ORDER BY v.created_at DESC,v.id DESC LIMIT 1)
) keep_id FROM problems p
WHERE nullif(:'problem_ids','') IS NULL OR p.id=ANY(string_to_array(:'problem_ids',',')::uuid[]);
CREATE TEMP TABLE legacy_move ON COMMIT DROP AS
SELECT v.problem_id,v.id old_id,k.keep_id FROM problem_versions v JOIN legacy_keep k USING (problem_id)
WHERE v.id<>k.keep_id;

-- Existing public/course projections may have been created from an old
-- legacy version. Preserve their definition and relink them to the stable
-- legacy ID; the next authorized read refreshes the projection in place.
CREATE TEMP TABLE mirror_relink ON COMMIT DROP AS
SELECT p.school_id,p.id problem_id,k.keep_id,v.definition,v.draft_revision
 FROM school_problems p JOIN legacy_keep k ON k.problem_id=p.id
 JOIN LATERAL (SELECT * FROM school_problem_versions current
  WHERE current.school_id=p.school_id AND current.problem_id=p.id
  ORDER BY (current.id=p.published_version_id) DESC NULLS LAST,current.draft_revision DESC LIMIT 1) v ON true
 WHERE p.school_id='00000000-0000-4000-8000-000000000052'
 AND p.bank_id='00000000-0000-4000-8000-000000000074'
 AND k.keep_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM school_problem_versions current
  WHERE current.school_id=p.school_id AND current.problem_id=p.id AND current.id=k.keep_id);
INSERT INTO school_problem_versions(school_id,id,problem_id,definition,draft_revision)
 SELECT m.school_id,m.keep_id,m.problem_id,m.definition,
  (SELECT max(v.draft_revision)+1 FROM school_problem_versions v WHERE v.school_id=m.school_id AND v.problem_id=m.problem_id)
 FROM mirror_relink m;

CREATE TEMP TABLE school_keep ON COMMIT DROP AS
SELECT p.school_id,p.id problem_id, COALESCE(
 (SELECT a.programming_version_id FROM acsl_papers a WHERE a.school_id=p.school_id AND a.programming_problem_id=p.id),
 (SELECT k.keep_id FROM legacy_keep k WHERE k.problem_id=p.id
   AND p.school_id='00000000-0000-4000-8000-000000000052' AND p.bank_id='00000000-0000-4000-8000-000000000074'),
 p.published_version_id,
 (SELECT v.id FROM school_problem_versions v WHERE v.school_id=p.school_id AND v.problem_id=p.id
   ORDER BY v.draft_revision DESC,v.id DESC LIMIT 1)
) keep_id FROM school_problems p
WHERE :'consolidate_all'::boolean OR EXISTS(SELECT 1 FROM legacy_keep k WHERE k.problem_id=p.id)
 AND p.school_id='00000000-0000-4000-8000-000000000052' AND p.bank_id='00000000-0000-4000-8000-000000000074';
CREATE TEMP TABLE school_move ON COMMIT DROP AS
SELECT v.school_id,v.problem_id,v.id old_id,k.keep_id FROM school_problem_versions v JOIN school_keep k USING (school_id,problem_id)
WHERE v.id<>k.keep_id;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM legacy_move m JOIN problem_versions v ON v.id=m.old_id
  JOIN problems p ON p.id=m.problem_id JOIN problem_banks b ON b.id=p.bank_id
  WHERE NOT (p.archived_at IS NOT NULL OR b.archived_at IS NOT NULL)
  AND v.published_at IS NULL AND v.created_at>(SELECT created_at FROM problem_versions WHERE id=m.keep_id)) THEN
  RAISE EXCEPTION 'Unreviewed newer draft remains';
 END IF;
 IF EXISTS (SELECT 1 FROM legacy_move m JOIN problem_public_statements s ON s.version_id=m.old_id
  WHERE NOT EXISTS(SELECT 1 FROM problem_public_statements replacement WHERE replacement.version_id=m.keep_id)) THEN
  RAISE EXCEPTION 'Replacement is missing its reviewed public statement';
 END IF;
 IF EXISTS (SELECT 1 FROM legacy_move m JOIN legacy_public_problem_requests r ON r.version_id=m.old_id)
 OR EXISTS (SELECT 1 FROM school_move m JOIN school_problem_publication_requests r ON r.school_id=m.school_id AND r.version_id=m.old_id) THEN
  RAISE EXCEPTION 'An older version has a platform publication review request';
 END IF;
END $$;

-- Compare every row except the explicitly migrated reference/provenance fields.
CREATE TEMP TABLE protected_state(name text PRIMARY KEY,digest text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.fingerprint(rel regclass, skip text[] DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
DECLARE digest text;
BEGIN
 EXECUTE format('SELECT md5(coalesce(string_agg(md5((to_jsonb(t)-$1)::text), %L ORDER BY md5((to_jsonb(t)-$1)::text)), %L)) FROM %s t','','',rel)
 INTO digest USING skip;
 RETURN digest;
END $$;

CREATE TEMP TABLE verification_set(name text PRIMARY KEY,skip text[] NOT NULL) ON COMMIT DROP;
INSERT INTO verification_set VALUES
 ('submissions','{version_id,original_problem_version_id}'),('judge_tasks','{version_id}'),
 ('judge_runs','{version_id}'),('legacy_assignment_preview_submissions','{version_id}'),
 ('chapter_problems','{version_id}'),('assignment_problems','{version_id,prior_version_id,original_problem_version_id,original_prior_problem_version_id}'),
 ('timed_practice_problems','{version_id}'),('school_judge_jobs','{version_id}'),
 ('school_activity_problems','{version_id}'),('school_rank_ledger','{version_id}'),
 ('timed_result_snapshots','{}'),('timed_result_revisions','{}'),('school_activity_results','{}'),
 ('acsl_papers','{}'),('acsl_programming_revisions','{}'),('acsl_drafts','{}'),('acsl_paper_grades','{}'),
 ('acsl_point_awards','{}'),('learning_progress','{}'),('school_course_progress','{}'),('public_course_progress','{}'),
 ('point_ledger','{}'),('luq_ledger','{}'),('luq_submission_results','{}'),('luq_problem_solutions','{}'),
 ('luq_assistance_contents','{version_id}'),('luq_assistance_entitlements','{}'),
 ('luq_assistance_deliveries','{}'),('public_luq_receipts','{}'),('public_luq_results','{}'),
 ('school_scholarship_receipts','{}'),('school_scholarship_results','{}'),('public_practice_notes','{}');
INSERT INTO protected_state SELECT name,pg_temp.fingerprint(name::regclass,skip) FROM verification_set;

CREATE TEMP TABLE grade_before ON COMMIT DROP AS
SELECT part.assignment_id,i.id identity_id,i.name,ap.problem_id,ap.points,
   CASE WHEN credit.id IS NOT NULL THEN NULL ELSE s.id END submission_id,
   CASE WHEN credit.id IS NOT NULL THEN 100 ELSE s.score END score,
   CASE WHEN credit.id IS NOT NULL THEN 'AC' ELSE COALESCE(s.status,pending.status) END status,
   (credit.id IS NULL AND pending.status IS NOT NULL) unresolved,
   CASE WHEN credit.id IS NULL THEN pending.status END pending_status,
   (credit.id IS NOT NULL) credited_ac,credit.created_at credited_at,
   attempts.total assignment_attempts,(attempts.total>0) has_assignment_submission
  FROM assignment_participants part JOIN identities i ON i.id=part.identity_id
  JOIN assignments assignment ON assignment.id=part.assignment_id
  JOIN assignment_problems ap ON ap.assignment_id=part.assignment_id
  LEFT JOIN LATERAL (
   SELECT count(*)::integer total FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
  ) attempts ON true
  LEFT JOIN LATERAL (
   SELECT id,score,status FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND created_at<=assignment.due_at AND score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error')
   ORDER BY score DESC,created_at,id LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
   SELECT status FROM submissions WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit' AND created_at<=assignment.due_at
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND status IN ('Waiting','Judging','System Error') ORDER BY created_at DESC LIMIT 1
  ) pending ON true
  LEFT JOIN LATERAL (
   SELECT previous.id,previous.created_at FROM submissions previous
   WHERE COALESCE(s.score,0)<100
    AND previous.assignment_id IS DISTINCT FROM part.assignment_id
    AND
 previous.identity_id=part.identity_id AND previous.problem_id=ap.problem_id
 AND (previous.assignment_id=assignment.id OR previous.version_id IN (ap.version_id,ap.prior_version_id)
  OR previous.created_at>=(SELECT applied_at FROM schema_migrations WHERE name='098_live_problem_activity_results.sql'))
 AND (assignment.required_language IS NULL OR previous.language=assignment.required_language)
 AND previous.kind='submit' AND previous.status='AC' AND previous.score=100 AND previous.created_at<=assignment.due_at
 AND (previous.timed_attempt_id IS NULL OR EXISTS (
  SELECT 1 FROM timed_first_ac_candidates candidate
  JOIN timed_practices practice ON practice.id=candidate.practice_id
  WHERE candidate.submission_id=previous.id AND practice.results_published_at IS NOT NULL
 ))

   ORDER BY previous.created_at,previous.id LIMIT 1
  ) credit ON true
  WHERE NOT part.exempt
  ORDER BY i.name,ap.position;

-- Preserve version identifiers as provenance, without retaining multiple
-- editable problem definitions. Historical credit still compares the original IDs.

ALTER TABLE assignment_problems DISABLE TRIGGER assignment_problems_immutable;
ALTER TABLE timed_practice_problems DISABLE TRIGGER timed_problem_snapshot;
ALTER TABLE school_rank_ledger DISABLE TRIGGER school_rank_ledger_immutable;
ALTER TABLE test_cases DISABLE TRIGGER published_tests_immutable;
ALTER TABLE problem_public_statements DISABLE TRIGGER problem_public_statements_immutable;
ALTER TABLE school_problem_versions DISABLE TRIGGER acsl_programming_version_immutable;

-- Composite foreign keys must observe the old and new references atomically.
ALTER TABLE judge_tasks ALTER CONSTRAINT judge_tasks_preview_submission_id_version_id_fkey DEFERRABLE;
ALTER TABLE school_judge_jobs ALTER CONSTRAINT school_job_activity_problem_fk DEFERRABLE;
SET CONSTRAINTS ALL DEFERRED;

UPDATE assignment_problems a SET original_problem_version_id=COALESCE(a.original_problem_version_id,a.version_id),
 original_prior_problem_version_id=COALESCE(a.original_prior_problem_version_id,a.prior_version_id), version_id=k.keep_id, prior_version_id=NULL
 FROM legacy_keep k WHERE a.problem_id=k.problem_id AND k.keep_id IS NOT NULL
 AND (a.version_id<>k.keep_id OR a.prior_version_id IS NOT NULL);
UPDATE chapter_problems t SET version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE timed_practice_problems t SET version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE submissions t SET original_problem_version_id=COALESCE(t.original_problem_version_id,t.version_id),version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE judge_tasks t SET version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE judge_runs t SET version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE legacy_assignment_preview_submissions t SET version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE school_rank_ledger t SET version_id=m.keep_id FROM legacy_move m WHERE t.version_id=m.old_id;
UPDATE problems p SET current_version_id=k.keep_id FROM legacy_keep k
 JOIN problem_versions v ON v.id=k.keep_id WHERE p.id=k.problem_id AND v.published_at IS NOT NULL
 AND p.current_version_id IS DISTINCT FROM k.keep_id;
-- Preserve the old assistance rows and delivery/receipt identities. When the
-- current content slot is free, move the existing reviewed translation into it.
WITH candidates AS (
 SELECT DISTINCT ON (m.keep_id,c.subject_key,c.kind,c.language) c.id,m.keep_id
 FROM legacy_move m JOIN luq_assistance_contents c ON c.version_id=m.old_id AND c.subject_key='problem:'||m.problem_id
 WHERE c.kind='FULL_TRANSLATION' AND NOT EXISTS(SELECT 1 FROM luq_assistance_contents replacement
 WHERE (replacement.version_id,replacement.subject_key,replacement.kind,replacement.language)=(m.keep_id,c.subject_key,c.kind,c.language))
 ORDER BY m.keep_id,c.subject_key,c.kind,c.language,(c.status='published') DESC,c.published_at DESC NULLS LAST,c.updated_at DESC,c.id DESC
)
UPDATE luq_assistance_contents c SET version_id=q.keep_id FROM candidates q WHERE c.id=q.id;
DELETE FROM problem_public_statements t USING legacy_move m WHERE t.version_id=m.old_id;
DELETE FROM test_cases t USING legacy_move m WHERE t.version_id=m.old_id;
DELETE FROM problem_versions t USING legacy_move m WHERE t.id=m.old_id;

-- The ACSL correction log already carries the reviewed before/after evidence.
-- Keep its historical UUIDs as provenance while its active paper reference stays
-- pinned to the correct judge definition and job payloads stay unchanged.
DO $$
DECLARE fk name;
BEGIN
 FOR fk IN SELECT conname FROM pg_constraint WHERE conrelid='acsl_programming_revisions'::regclass
  AND confrelid='school_problem_versions'::regclass AND contype='f'
 LOOP EXECUTE format('ALTER TABLE acsl_programming_revisions DROP CONSTRAINT %I',fk); END LOOP;
END $$;
UPDATE school_activity_problems t SET version_id=m.keep_id FROM school_move m WHERE t.school_id=m.school_id AND t.version_id=m.old_id;
UPDATE school_judge_jobs t SET version_id=m.keep_id FROM school_move m WHERE t.school_id=m.school_id AND t.version_id=m.old_id;
UPDATE school_problem_publications t SET version_id=m.keep_id FROM school_move m WHERE t.school_id=m.school_id AND t.version_id=m.old_id;
UPDATE school_problems t SET published_version_id=m.keep_id FROM school_move m
 WHERE t.school_id=m.school_id AND t.published_version_id=m.old_id;
DELETE FROM school_problem_versions t USING school_move m WHERE t.school_id=m.school_id AND t.id=m.old_id;
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE assignment_problems ENABLE TRIGGER assignment_problems_immutable;
ALTER TABLE timed_practice_problems ENABLE TRIGGER timed_problem_snapshot;
ALTER TABLE school_rank_ledger ENABLE TRIGGER school_rank_ledger_immutable;
ALTER TABLE test_cases ENABLE TRIGGER published_tests_immutable;
ALTER TABLE problem_public_statements ENABLE TRIGGER problem_public_statements_immutable;
ALTER TABLE school_problem_versions ENABLE TRIGGER acsl_programming_version_immutable;
\if :consolidate_all
CREATE UNIQUE INDEX IF NOT EXISTS problem_versions_one_per_problem ON problem_versions(problem_id);
CREATE UNIQUE INDEX IF NOT EXISTS school_problem_versions_one_per_problem ON school_problem_versions(school_id,problem_id);
\endif

DO $$ DECLARE changed text; BEGIN
 SELECT string_agg(v.name,', ' ORDER BY v.name) INTO changed FROM verification_set v JOIN protected_state p USING(name)
  WHERE pg_temp.fingerprint(v.name::regclass,v.skip)<>p.digest;
 IF changed IS NOT NULL THEN RAISE EXCEPTION 'Protected data changed: %',changed; END IF;
END $$;
SELECT (SELECT count(*) FROM legacy_move) AS old_ordinary_versions,
 (SELECT count(*) FROM school_move) AS old_school_versions,
 (SELECT count(*) FROM protected_state) AS verified_tables;
CREATE TEMP TABLE grade_after ON COMMIT DROP AS
SELECT part.assignment_id,i.id identity_id,i.name,ap.problem_id,ap.points,
   CASE WHEN credit.id IS NOT NULL THEN NULL ELSE s.id END submission_id,
   CASE WHEN credit.id IS NOT NULL THEN 100 ELSE s.score END score,
   CASE WHEN credit.id IS NOT NULL THEN 'AC' ELSE COALESCE(s.status,pending.status) END status,
   (credit.id IS NULL AND pending.status IS NOT NULL) unresolved,
   CASE WHEN credit.id IS NULL THEN pending.status END pending_status,
   (credit.id IS NOT NULL) credited_ac,credit.created_at credited_at,
   attempts.total assignment_attempts,(attempts.total>0) has_assignment_submission
  FROM assignment_participants part JOIN identities i ON i.id=part.identity_id
  JOIN assignments assignment ON assignment.id=part.assignment_id
  JOIN assignment_problems ap ON ap.assignment_id=part.assignment_id
  LEFT JOIN LATERAL (
   SELECT count(*)::integer total FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
  ) attempts ON true
  LEFT JOIN LATERAL (
   SELECT id,score,status FROM submissions
   WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit'
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND created_at<=assignment.due_at AND score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error')
   ORDER BY score DESC,created_at,id LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
   SELECT status FROM submissions WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id
    AND problem_id=ap.problem_id AND kind='submit' AND created_at<=assignment.due_at
    AND (assignment.required_language IS NULL OR language=assignment.required_language)
    AND status IN ('Waiting','Judging','System Error') ORDER BY created_at DESC LIMIT 1
  ) pending ON true
  LEFT JOIN LATERAL (
   SELECT previous.id,previous.created_at FROM submissions previous
   WHERE COALESCE(s.score,0)<100
    AND previous.assignment_id IS DISTINCT FROM part.assignment_id
    AND
 previous.identity_id=part.identity_id AND previous.problem_id=ap.problem_id
 AND (previous.assignment_id=assignment.id OR COALESCE(previous.original_problem_version_id,previous.version_id) IN (COALESCE(ap.original_problem_version_id,ap.version_id),COALESCE(ap.original_prior_problem_version_id,ap.prior_version_id))
  OR previous.created_at>=(SELECT applied_at FROM schema_migrations WHERE name='098_live_problem_activity_results.sql'))
 AND (assignment.required_language IS NULL OR previous.language=assignment.required_language)
 AND previous.kind='submit' AND previous.status='AC' AND previous.score=100 AND previous.created_at<=assignment.due_at
 AND (previous.timed_attempt_id IS NULL OR EXISTS (
  SELECT 1 FROM timed_first_ac_candidates candidate
  JOIN timed_practices practice ON practice.id=candidate.practice_id
  WHERE candidate.submission_id=previous.id AND practice.results_published_at IS NOT NULL
 ))

   ORDER BY previous.created_at,previous.id LIMIT 1
  ) credit ON true
  WHERE NOT part.exempt
  ORDER BY i.name,ap.position;
DO $$ BEGIN
 IF EXISTS (SELECT * FROM grade_before EXCEPT ALL SELECT * FROM grade_after)
 OR EXISTS (SELECT * FROM grade_after EXCEPT ALL SELECT * FROM grade_before) THEN
  RAISE EXCEPTION 'Computed assignment grades changed';
 END IF;
END $$;
SELECT count(*) AS verified_assignment_grade_rows FROM grade_after;
SELECT count(*) AS protected_legacy_judge_inputs FROM judge_tasks WHERE problem_snapshot IS NOT NULL;
\if :apply
COMMIT;
\else
ROLLBACK;
\endif
