-- Rank from completed public submissions. Keep the existing app and worker
-- job policies intact: only this read-only function can aggregate across schools.
CREATE POLICY school_judge_jobs_public_rank_owner ON school_judge_jobs FOR SELECT TO CURRENT_USER
 USING (access_context='public' AND kind='submit' AND activity_id IS NULL AND state='completed');

CREATE INDEX school_judge_jobs_public_rank_idx
 ON school_judge_jobs(account_id,problem_id,created_at,id)
 WHERE access_context='public' AND kind='submit' AND activity_id IS NULL AND state='completed'
   AND (result->>'status') IN ('AC','WA','CE','RE','TLE','MLE','OLE');

CREATE FUNCTION public_practice_leaderboard(viewer_id uuid, page_number integer, page_size integer)
RETURNS TABLE (
 rank integer, display_name text, avatar_key text, is_own boolean, solved integer,
 attempts integer, ac_rate numeric, in_page boolean, total integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH formal AS (
   SELECT j.account_id,j.problem_id,j.id,j.created_at,j.result->>'status' AS verdict
   FROM school_judge_jobs j
   WHERE j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL
     AND j.state='completed' AND (j.result->>'status') IN ('AC','WA','CE','RE','TLE','MLE','OLE')
 ), first_pass AS (
   SELECT DISTINCT ON (f.account_id,f.problem_id) f.account_id,f.problem_id,f.created_at,f.id
   FROM formal f WHERE f.verdict='AC'
   ORDER BY f.account_id,f.problem_id,f.created_at,f.id
 ), metrics AS (
   SELECT f.account_id,count(*)::integer AS attempts,
     count(*) FILTER (WHERE f.verdict='AC')::integer AS solved
   FROM formal f LEFT JOIN first_pass p USING(account_id,problem_id)
   WHERE p.id IS NULL OR (f.created_at,f.id)<=(p.created_at,p.id)
   GROUP BY f.account_id
 ), scored AS (
   SELECT a.id AS account_id, 'Learner-'||upper(left(md5('public-practice:'||a.id::text),8)) AS alias,
     CASE WHEN a.leaderboard_use_nickname THEN NULLIF(btrim(a.nickname),'') END AS nickname,
     COALESCE(m.solved,0) AS solved,COALESCE(m.attempts,0) AS attempts,
     m.solved::numeric/NULLIF(m.attempts,0) AS ac_rate
   FROM accounts a JOIN identities i ON i.id=a.identity_id
   LEFT JOIN metrics m ON m.account_id=a.id
   WHERE a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
     AND (m.solved>0 OR a.id=viewer_id)
 ), ranked AS (
   SELECT s.*,CASE WHEN s.solved>0 THEN rank() OVER (
      ORDER BY s.solved DESC,s.ac_rate DESC NULLS LAST)::integer END AS rank,
     row_number() OVER (ORDER BY s.solved DESC,s.ac_rate DESC NULLS LAST,s.account_id) AS position,
     count(*) FILTER (WHERE s.solved>0) OVER ()::integer AS total
   FROM scored s
 ), bounds AS (
   SELECT greatest(1,least(100000,page_number)) AS page,
     greatest(1,least(50,page_size)) AS size
 ), selected AS (
   SELECT r.*, r.solved>0 AND r.position>(b.page-1)*b.size AND r.position<=b.page*b.size AS in_page
   FROM ranked r CROSS JOIN bounds b
 )
 SELECT s.rank,COALESCE(s.nickname,s.alias),s.alias,s.account_id=viewer_id,
   s.solved,s.attempts,s.ac_rate,s.in_page,s.total
 FROM selected s WHERE s.in_page OR s.account_id=viewer_id ORDER BY s.position;
$$;
REVOKE ALL ON FUNCTION public_practice_leaderboard(uuid,integer,integer) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION public_practice_leaderboard(uuid,integer,integer) TO campus_app;
