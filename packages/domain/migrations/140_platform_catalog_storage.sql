-- Judge receipts and editions share a storage namespace. Only school
-- namespaces grant memberships. The platform has its own unpublished sources.
CREATE TABLE practice_storage_scopes (
 id uuid PRIMARY KEY, school_id uuid UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
 CHECK((school_id IS NULL AND id='00000000-0000-4000-8000-000000000140') OR (school_id IS NOT NULL AND school_id=id AND id<>'00000000-0000-4000-8000-000000000140'))
);
INSERT INTO practice_storage_scopes VALUES('00000000-0000-4000-8000-000000000140',NULL);
INSERT INTO practice_storage_scopes SELECT id,id FROM schools;
CREATE FUNCTION add_school_practice_scope() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO practice_storage_scopes VALUES(NEW.id,NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION add_school_practice_scope() FROM PUBLIC;
CREATE TRIGGER school_practice_scope AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION add_school_practice_scope();
ALTER TABLE school_problem_banks DROP CONSTRAINT school_problem_banks_school_id_fkey,
 ADD FOREIGN KEY(school_id) REFERENCES practice_storage_scopes(id),
 ADD CHECK(school_id<>'00000000-0000-4000-8000-000000000140' OR resource_kind='publication');
ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_school_id_fkey, ADD FOREIGN KEY(school_id) REFERENCES practice_storage_scopes(id);
ALTER TABLE problem_banks ALTER COLUMN school_id DROP DEFAULT,ALTER COLUMN school_id DROP NOT NULL,
 ADD COLUMN catalog_scope_id uuid GENERATED ALWAYS AS (coalesce(school_id,'00000000-0000-4000-8000-000000000140'::uuid)) STORED REFERENCES practice_storage_scopes(id);
ALTER TABLE learning_paths ALTER COLUMN school_id DROP DEFAULT,ALTER COLUMN school_id DROP NOT NULL,
 ADD CHECK(owner_scope='platform' OR school_id IS NOT NULL);
ALTER TABLE classes ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE assignments ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE timed_practices ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE paper4_papers ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE learning_resources ALTER COLUMN school_id DROP DEFAULT;

CREATE OR REPLACE FUNCTION platform_points_for_account(target_account uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 previous_scope text := current_setting('campus.school_id',true);
 source_school uuid;
 extra_points bigint;
 approved_solves bigint := 0;
BEGIN
 SELECT coalesce(sum(award.points),0) INTO extra_points FROM paper4_rank_ledger award
 JOIN paper4_attempts attempt ON attempt.id=award.attempt_id WHERE attempt.account_id=target_account;

 FOR source_school IN SELECT id FROM practice_storage_scopes LOOP
  PERFORM set_config('campus.school_id',source_school::text,true);
  SELECT extra_points+coalesce(sum(award.points),0) INTO extra_points FROM acsl_point_awards award
   LEFT JOIN acsl_paper_grades grade ON (grade.school_id,grade.id)=(award.school_id,award.grade_id)
   LEFT JOIN school_judge_jobs job ON (job.school_id,job.id)=(award.school_id,award.job_id)
   WHERE award.school_id=source_school AND coalesce(grade.account_id,job.account_id)=target_account;
  SELECT approved_solves + count(DISTINCT job.problem_id)*10 INTO approved_solves
  FROM school_judge_jobs job
  JOIN school_problems problem ON problem.school_id=job.school_id AND problem.id=job.problem_id
  LEFT JOIN LATERAL (
   SELECT event.action FROM platform_audit_events event
    WHERE event.school_id=job.school_id AND event.detail->>'versionId'=job.version_id::text
      AND event.detail->>'problemId'=job.problem_id::text
      AND event.action IN ('problem.approve','problem.withdraw') AND event.created_at<=job.created_at
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  ) review ON job.access_context='school'
  WHERE job.school_id=source_school AND job.account_id=target_account
    AND job.kind='submit' AND problem.owner_account_id<>target_account
    AND (
     (job.access_context='public' AND job.activity_id IS NULL AND EXISTS (
       SELECT 1 FROM public_luq_results result
       WHERE result.school_id=job.school_id AND result.job_id=job.id AND result.status='AC'
     ))
     OR (job.access_context='school' AND
       COALESCE(review.action='problem.approve',EXISTS (
        SELECT 1 FROM school_problem_publications publication
        WHERE publication.school_id=job.school_id AND publication.problem_id=job.problem_id
          AND publication.version_id=job.version_id AND publication.approved_at<=job.created_at
          AND (publication.withdrawn_at IS NULL OR publication.withdrawn_at>job.created_at)
       )) AND EXISTS (
        SELECT 1 FROM school_scholarship_results result
        WHERE result.school_id=job.school_id AND result.source_kind='problem' AND result.job_id=job.id
          AND result.subject_key='problem:'||job.problem_id AND result.status='AC'
       ))
    )
    AND NOT EXISTS (
     SELECT 1 FROM school_rank_ledger award JOIN submissions submission ON submission.id=award.submission_id
     WHERE award.problem_id=job.problem_id AND submission.account_id=target_account
    );
 END LOOP;
 PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true);
 RETURN extra_points + approved_solves + COALESCE((
  SELECT sum(earned.points) FROM (
   SELECT DISTINCT ON (award.problem_id) award.points
   FROM school_rank_ledger award JOIN submissions submission ON submission.id=award.submission_id
   WHERE submission.account_id=target_account
   ORDER BY award.problem_id,award.created_at,award.submission_id
  ) earned
 ),0);
END $$;
