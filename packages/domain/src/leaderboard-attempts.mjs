// Shared by leaderboard and online profile previews. Only eligible formal results count.
// Period filters apply after finding the first eligible practice AC per student and version.
export const leaderboardOrdinaryAttempts = `
  WITH eligible_submissions AS NOT MATERIALIZED (
   SELECT s.id,s.identity_id,s.version_id,s.status,s.created_at,s.timed_attempt_id
   FROM submissions s
   JOIN problem_versions v ON v.id=s.version_id AND v.problem_id=s.problem_id
   JOIN problems p ON p.id=s.problem_id
   JOIN problem_banks bank ON bank.id=p.bank_id
   WHERE s.kind='submit'
    AND v.published_at IS NOT NULL AND v.rank_approved_at IS NOT NULL
    AND s.created_at>=v.rank_approved_at
    AND (
     (v.rank_review_status='approved' AND v.school_visible_at IS NOT NULL
      AND s.created_at>=v.school_visible_at AND p.archived_at IS NULL
      AND bank.archived_at IS NULL AND bank.visibility='school')
     OR (v.rank_review_status='revoked' AND v.rank_reviewed_at IS NOT NULL
      AND s.created_at<v.rank_reviewed_at)
    )
    AND (s.timed_attempt_id IS NULL OR EXISTS (
     SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id
     WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL))
  ), first_ordinary_ac AS (
   SELECT DISTINCT ON (identity_id,version_id) identity_id,version_id,created_at,id
   FROM eligible_submissions
   WHERE timed_attempt_id IS NULL AND status='AC'
   ORDER BY identity_id,version_id,created_at,id
  ), period_submissions AS (
   SELECT s.identity_id,s.status,
    (s.timed_attempt_id IS NOT NULL OR first_ac.id IS NULL
     OR (s.created_at,s.id)<=(first_ac.created_at,first_ac.id)) counts_toward_rate
   FROM eligible_submissions s
   LEFT JOIN first_ordinary_ac first_ac
    ON first_ac.identity_id=s.identity_id AND first_ac.version_id=s.version_id
   CROSS JOIN bounds b
   WHERE b.since_at IS NULL OR s.created_at>=b.since_at
  )
  SELECT identity_id,count(*)::int attempts,
   count(*) FILTER (WHERE counts_toward_rate AND status IN ('AC','WA','CE','RE','TLE','MLE','OLE'))::int assessed,
   count(*) FILTER (WHERE counts_toward_rate AND status='AC')::int accepted
  FROM period_submissions
  GROUP BY identity_id
`;
export const leaderboardPaperAttempts = `
   SELECT a.identity_id,count(*)::int attempts,
    count(*) FILTER (WHERE r.status IN ('AC','WA','CE','RE','TLE','MLE','OLE'))::int assessed,
    count(*) FILTER (WHERE r.rank_ac_valid)::int accepted
   FROM paper4_attempts a
   JOIN paper4_versions v ON v.id=a.version_id AND v.published_at IS NOT NULL
   JOIN paper4_snapshots s ON s.attempt_id=a.id AND s.origin='formal'
   LEFT JOIN LATERAL (SELECT run.status,run.rank_ac_valid FROM paper4_run_tasks task
    JOIN paper4_runs run ON run.task_id=task.id
    WHERE task.snapshot_id=s.id ORDER BY run.created_at DESC,run.id DESC LIMIT 1) r ON true
   CROSS JOIN bounds b
   WHERE a.state='submitted' AND (b.since_at IS NULL OR a.submitted_at>=b.since_at)
   GROUP BY a.identity_id
`;
