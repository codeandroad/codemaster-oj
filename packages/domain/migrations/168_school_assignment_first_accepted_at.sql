-- Return the earliest eligible classroom-shared receipt alongside its count.
CREATE OR REPLACE VIEW school_assignment_public_credit WITH (security_barrier=true) AS
SELECT a.school_id,a.id AS activity_id,part.identity_id,p.problem_id,count(*)::int AS accepted_runs,
       min(j.created_at) AS first_accepted_at
FROM school_public_run_shares s
JOIN school_judge_jobs j ON (j.school_id,j.id,j.account_id)=(s.source_school_id,s.job_id,s.account_id)
JOIN school_activity_participants part ON (part.school_id,part.identity_id)=(s.school_id,s.identity_id)
JOIN school_activities a ON (a.school_id,a.id)=(part.school_id,part.activity_id)
JOIN school_activity_problems p ON (p.school_id,p.activity_id,p.problem_id,p.version_id)=(a.school_id,a.id,j.problem_id,j.version_id)
WHERE s.school_id=nullif(current_setting('campus.school_id',true),'')::uuid AND s.visibility='classroom'
  AND a.kind='assignment' AND a.published_at IS NOT NULL AND NOT part.exempt
  AND j.access_context='public' AND j.activity_id IS NULL AND j.kind='submit'
  AND j.state='completed' AND j.result->>'status'='AC'
  AND (a.required_language IS NULL OR a.required_language=coalesce(j.payload->>'language','python'))
  AND j.created_at<=coalesce(greatest(a.ends_at,part.extended_due_at),'infinity'::timestamptz)
  AND (a.cancelled_at IS NULL OR j.created_at<=a.cancelled_at)
GROUP BY a.school_id,a.id,part.identity_id,p.problem_id;
