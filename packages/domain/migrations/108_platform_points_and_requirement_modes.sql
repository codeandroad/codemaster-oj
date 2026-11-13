ALTER TABLE platform_course_rules ADD COLUMN requirement_mode text NOT NULL DEFAULT 'all'
 CHECK (requirement_mode IN ('all','any'));

CREATE INDEX platform_problem_approval_history_idx
 ON platform_audit_events(school_id,(detail->>'versionId'),created_at DESC,id DESC)
 WHERE action IN ('problem.approve','problem.withdraw');

-- Points are calculated from formal results and frozen awards owned by the
-- login account. The old school dossier can be detached without losing them.
CREATE FUNCTION platform_points_for_account(target_account uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 previous_scope text := current_setting('campus.school_id',true);
 source_school uuid;
 extra_points bigint;
 approved_solves bigint := 0;
BEGIN
 PERFORM set_config('campus.school_id','00000000-0000-4000-8000-000000000052',true);
 SELECT COALESCE(sum(awards.points),0) INTO extra_points FROM (
  SELECT award.points FROM paper4_rank_ledger award
   JOIN paper4_attempts attempt ON attempt.id=award.attempt_id
   WHERE attempt.account_id=target_account
  UNION ALL
  SELECT award.points FROM acsl_point_awards award
   LEFT JOIN acsl_paper_grades grade ON grade.school_id=award.school_id AND grade.id=award.grade_id
   LEFT JOIN school_judge_jobs job ON job.school_id=award.school_id AND job.id=award.job_id
   WHERE COALESCE(grade.account_id,job.account_id)=target_account
 ) awards;

 FOR source_school IN SELECT id FROM schools LOOP
  PERFORM set_config('campus.school_id',source_school::text,true);
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
REVOKE ALL ON FUNCTION platform_points_for_account(uuid) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION platform_points_for_account(uuid) TO campus_app;
