-- These editions belong to the platform course authoring catalogue. Keep
-- every previously offered option, including editions not linked to a chapter.
CREATE TABLE platform_course_acsl_editions (
 id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, version_id uuid NOT NULL UNIQUE,
 enabled boolean NOT NULL, programming_problem_id uuid, title jsonb NOT NULL,
 division text NOT NULL, season text NOT NULL, round integer NOT NULL, questions jsonb NOT NULL
);
INSERT INTO platform_course_acsl_editions
 SELECT id,slug,version_id,enabled,programming_problem_id,definition->'title',definition->>'division',definition->>'season',
 (definition->>'round')::integer,coalesce((SELECT jsonb_agg(jsonb_build_object('id',q->>'id','number',q->'number','topic',q->'topic') ORDER BY position)
 FROM jsonb_array_elements(definition->'questions') WITH ORDINALITY v(q,position)),'[]'::jsonb)
 FROM acsl_papers WHERE school_id='00000000-0000-4000-8000-000000000052';
REVOKE ALL ON platform_course_acsl_editions FROM PUBLIC,campus_worker,campus_app;
GRANT SELECT ON platform_course_acsl_editions TO campus_app;

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

 FOR source_school IN SELECT id FROM schools LOOP
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
