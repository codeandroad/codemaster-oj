// Shared by published course reading and staff solution-use summaries. The join
// condition decides whether a valid linked revision may advance to this one.
export const latestCourseProblemVersion = `LEFT JOIN LATERAL (
 SELECT candidate.id FROM problem_versions candidate
 WHERE candidate.problem_id=cp.problem_id AND candidate.published_at IS NOT NULL
  AND candidate.school_visible_at IS NOT NULL AND candidate.rank_review_status='approved'
 ORDER BY candidate.published_at DESC,candidate.created_at DESC,candidate.id DESC LIMIT 1
) latest ON`;
