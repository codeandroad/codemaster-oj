import { metadataPage } from '../../../src/problem-submissions.mjs';
export async function paper4QuestionSubmissions(db,attempt,question,user,url) {
 const automatic=question.stages.filter(stage=>stage.judgeMode==='auto');
 const complete=automatic.length>0&&automatic.every(stage=>Array.isArray(attempt.runner_cases?.[stage.id])&&attempt.runner_cases[stage.id].length>0);
 const required=complete?automatic.flatMap(stage=>attempt.runner_cases[stage.id].map(c=>({stageId:stage.id,caseId:c.id}))):[];
 return metadataPage(db,`SELECT s.id::text,s.id received_id,a.identity_id actor_key,s.created_at,'python'::text language,a.identity_id=$4 is_own,
  CASE WHEN t.id IS NULL THEN 'NeedsReview' WHEN t.state='failed' THEN 'System Error' WHEN t.state='leased' THEN 'Judging'
   WHEN t.state='queued' THEN 'Waiting' WHEN r.id IS NULL THEN 'System Error'
   WHEN jsonb_array_length($5::jsonb)=0 THEN 'NeedsReview'
   WHEN r.status='AC' AND jsonb_typeof(r.private_results)='array' AND jsonb_array_length(CASE WHEN jsonb_typeof(r.private_results)='array' THEN r.private_results ELSE '[]'::jsonb END)=jsonb_array_length($5::jsonb)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) required WHERE
     (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.private_results)='array' THEN r.private_results ELSE '[]'::jsonb END) result WHERE result->>'stageId'=required->>'stageId'
      AND result->>'caseId'=required->>'caseId' AND result->>'status'='AC')<>1) THEN 'AC'
   ELSE 'NotPassed' END status,
  r.private_results,
  COALESCE(CASE WHEN profile.leaderboard_use_nickname THEN NULLIF(btrim(profile.nickname),'') END,NULLIF(btrim(person.name),''),'Student') display_name
  FROM paper4_snapshots s JOIN paper4_attempts a ON a.id=s.attempt_id
  JOIN paper4_papers paper ON paper.id=a.paper_id
  JOIN identities person ON person.id=a.identity_id
  LEFT JOIN accounts profile ON profile.identity_id=person.id AND profile.binding_released_at IS NULL
  JOIN legacy_school_identity_ownership ownership ON ownership.identity_id=a.identity_id
  LEFT JOIN LATERAL (SELECT * FROM paper4_run_tasks t WHERE t.snapshot_id=s.id AND t.reference_snapshot_id IS NULL ORDER BY t.created_at DESC,t.id DESC LIMIT 1) t ON true
  LEFT JOIN LATERAL (SELECT id,status,private_results FROM paper4_runs r WHERE r.task_id=t.id AND r.snapshot_id=s.id AND r.lease_id=t.lease_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON t.state='completed'
  WHERE a.paper_id=$1 AND a.version_id=$2 AND s.question_key=$3 AND s.origin='formal' AND s.stage_key IS NULL AND a.state='submitted'
   AND (paper.delivery_kind='catalog' OR paper.activity_kind='practice' OR a.released_at IS NOT NULL)`,
 [attempt.paper_id,attempt.version_id,question.key,user.identityId,JSON.stringify(required)],url);
}
