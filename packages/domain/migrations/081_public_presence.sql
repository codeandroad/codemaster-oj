-- Public learning presence is explicit and independent from school presence.
-- Existing logged-in school sessions are not backfilled into the directory.
ALTER TABLE sessions ADD COLUMN public_presence_seen_at timestamptz;
CREATE INDEX sessions_public_presence_seen_idx ON sessions(public_presence_seen_at)
 WHERE public_presence_seen_at IS NOT NULL;

-- Reuse the narrow owner policy from 075: this function cannot aggregate
-- school submissions, assessments, samples, custom runs or incomplete jobs.
CREATE FUNCTION public_practice_presence_stats(target_account uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH formal AS (
  SELECT j.id,j.school_id,j.problem_id,j.version_id,j.created_at,j.result->>'status' verdict
  FROM school_judge_jobs j WHERE j.account_id=target_account
   AND j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL
   AND j.state='completed' AND (j.result->>'status') IN ('AC','WA','CE','RE','TLE','MLE','OLE')
 ), first_pass AS (
  SELECT DISTINCT ON(problem_id) * FROM formal WHERE verdict='AC'
  ORDER BY problem_id,created_at,id
 ), assessed AS (
  SELECT f.* FROM formal f LEFT JOIN first_pass p USING(problem_id)
  WHERE p.id IS NULL OR (f.created_at,f.id)<=(p.created_at,p.id)
 ) SELECT jsonb_build_object(
  'solved', (SELECT count(*) FROM first_pass),
  'attempts', (SELECT count(*) FROM assessed),
  'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'schoolId',school_id,'problemId',problem_id,'versionId',version_id,'createdAt',created_at)
   ORDER BY created_at DESC,id DESC) FROM (
    SELECT * FROM first_pass ORDER BY created_at DESC,id DESC LIMIT 50
   ) recent),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION public_practice_presence_stats(uuid) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION public_practice_presence_stats(uuid) TO campus_app;
