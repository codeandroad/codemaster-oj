import { schoolActivityJobVisibleSql } from './school-activities.mjs';
import { enumValue, integer, uuid, fail } from './security.mjs';

// Public submission history exposes a safe display name, never identity IDs, code, output,
// case data, score, teacher feedback, or link to another user's private record.
export function submissionListOptions(url) {
 const get=name=>url?.searchParams?.get(name);
 return {page:integer(Number(get('page')??1),1,100000,'Page'),
  pageSize:integer(Number(get('pageSize')??25),1,100,'Page size'),
  sort:enumValue(get('sort')??'createdAt',['createdAt','language','status','runtimeMs','memoryKb'],'Sort'),
  order:enumValue(get('order')??'desc',['asc','desc'],'Order')};
}

export async function metadataPage(db, source, params, url, { schoolProgress = false } = {}) {
 const {page,pageSize,sort,order}=submissionListOptions(url);
 const columns={createdAt:'created_at',language:'language',status:'status',runtimeMs:'runtime_ms',memoryKb:'memory_kb'};
 // Filter visibility before choosing a person's latest formal submission. Keep
 // historical verdicts separate: a later WA does not undo a previous formal AC.
 const base=`WITH visible AS (${source}), latest AS (
  SELECT DISTINCT ON (actor_key) * FROM visible ORDER BY actor_key,created_at DESC,received_id DESC
 ), measured AS (
  SELECT id,received_id,created_at,language,status,is_own,display_name,
   CASE WHEN status NOT IN ('Waiting','Judging','System Error') THEN m.runtime_ms END runtime_ms,
   CASE WHEN status NOT IN ('Waiting','Judging','System Error') THEN m.memory_kb END memory_kb
  FROM latest LEFT JOIN LATERAL (
   SELECT CASE WHEN count(*)>0 AND count(*)=count(cpu) THEN sum(cpu) END runtime_ms,
    CASE WHEN count(*)>0 AND count(*)=count(memory) THEN ceil(max(memory)/1024) END memory_kb
   FROM (SELECT CASE WHEN jsonb_typeof(item->'cpuMs')='number' AND (item->>'cpuMs')::numeric>=0 THEN (item->>'cpuMs')::numeric END cpu,
    CASE WHEN jsonb_typeof(item->'memoryBytes')='number' AND (item->>'memoryBytes')::numeric>=0 THEN (item->>'memoryBytes')::numeric END memory
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(private_results)='array' THEN private_results ELSE '[]'::jsonb END) item) measurements
  ) m ON true)`;
 const summary=(await db.query(`${base} SELECT (SELECT count(*)::int FROM latest) total,
  EXISTS(SELECT 1 FROM visible WHERE ${schoolProgress?'is_current_student':'is_own'} AND status='AC') solved`,params)).rows[0];
 const rows=(await db.query(`${base} SELECT id,created_at,language,status,is_own,display_name,runtime_ms,memory_kb FROM measured
  ORDER BY ${columns[sort]} ${order.toUpperCase()} NULLS LAST,created_at DESC,received_id DESC
  LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,pageSize,(page-1)*pageSize])).rows;
 return {items:rows.map(r=>({id:String(r.id),createdAt:r.created_at,language:r.language,status:r.status,isOwn:r.is_own,displayName:r.display_name,
  runtimeMs:r.runtime_ms===null||!Number.isFinite(Number(r.runtime_ms))?null:Number(r.runtime_ms),memoryKb:r.memory_kb===null||!Number.isFinite(Number(r.memory_kb))?null:Number(r.memory_kb)})),
  page,pageSize,total:summary.total,hasMore:page*pageSize<summary.total,solved:summary.solved};
}

export const legacyVisibleSubmissions=`FROM submissions s
 JOIN legacy_school_identity_ownership own_scope ON own_scope.identity_id=s.identity_id
 LEFT JOIN timed_attempts ta ON ta.id=s.timed_attempt_id
 LEFT JOIN timed_practices tp ON tp.id=ta.practice_id
 WHERE s.problem_id=$1 AND s.version_id=$2 AND s.kind='submit'
 AND (s.timed_attempt_id IS NULL OR tp.results_published_at IS NOT NULL)`;

export async function legacyProblemSolved(db,user,problemId,versionId) {
 return (await db.query(`SELECT EXISTS(SELECT 1 ${legacyVisibleSubmissions} AND s.identity_id=$3 AND s.status='AC') solved`,[problemId,versionId,user.identityId])).rows[0].solved;
}

export async function legacyProblemSubmissions(db,user,problemId,url,helpers) {
 const assignmentId=url.searchParams.get('assignmentId'),practiceId=url.searchParams.get('timedPracticeId');
 if(assignmentId&&practiceId)fail(400,'VALIDATION','Choose one activity context.');
 let versionId=url.searchParams.get('versionId');
 if(assignmentId){
  await db.query('SELECT id FROM assignments WHERE id=$1 FOR SHARE',[uuid(assignmentId)]);
  await helpers.assignmentAccess(db,user,assignmentId);
  const pin=(await db.query('SELECT version_id FROM assignment_problems WHERE assignment_id=$1 AND problem_id=$2',[assignmentId,uuid(problemId)])).rows[0];
  if(!pin)fail(404,'NOT_FOUND','Problem is not in this assignment.');
  if(versionId&&uuid(versionId)!==pin.version_id)fail(409,'VERSION_MISMATCH','Use the assigned version.');
  versionId=pin.version_id;
 }
 if(practiceId){
  const practice=(await db.query(`SELECT p.* FROM timed_practices p WHERE p.id=$1 AND
   ($3::boolean OR p.owner_account_id=$4 OR p.state IN ('Published','ResultsPublished','Archived') AND EXISTS(
    SELECT 1 FROM timed_practice_participants part WHERE part.practice_id=p.id AND part.identity_id=$2 AND NOT part.exempt)) FOR SHARE`,
  [uuid(practiceId),user.identityId,user.roles.includes('admin'),user.id])).rows[0];
  if(!practice)fail(404,'NOT_FOUND','Practice is unavailable.');
  const pin=(await db.query('SELECT version_id FROM timed_practice_problems WHERE practice_id=$1 AND problem_id=$2',[practiceId,uuid(problemId)])).rows[0];
  if(!pin)fail(404,'NOT_FOUND','Problem is not in this practice.');
  if(versionId&&uuid(versionId)!==pin.version_id)fail(409,'VERSION_MISMATCH','Use the assigned version.');
  versionId=pin.version_id;
 }
 // Keep publication/archive visibility coherent while collecting metadata.
 await db.query('SELECT id FROM problems WHERE id=$1 FOR SHARE',[uuid(problemId)]);
 await db.query('SELECT b.id FROM problem_banks b JOIN problems p ON p.bank_id=b.id WHERE p.id=$1 FOR SHARE OF b',[problemId]);
 await db.query('SELECT id FROM problem_versions WHERE problem_id=$1 FOR SHARE',[problemId]);
 const {p,v,permissions}=await helpers.versionAccess(db,user,problemId,versionId);
 const bank=(await db.query('SELECT visibility,archived_at FROM problem_banks WHERE id=$1',[p.bank_id])).rows[0];
 const schoolVisible=!!v.published_at&&!!v.school_visible_at&&bank?.visibility==='school'&&!bank.archived_at&&!p.archived_at;
 return metadataPage(db,`SELECT 'SUB'||s.id::text id,s.id received_id,s.identity_id actor_key,s.created_at,COALESCE(s.language,'python') language,s.status,s.identity_id=$3 is_own,r.private_results,
  COALESCE(CASE WHEN profile.leaderboard_use_nickname THEN NULLIF(btrim(profile.nickname),'') END,NULLIF(btrim(person.name),''),'Student') display_name
  FROM (SELECT s.* ${legacyVisibleSubmissions} AND ($4::boolean OR s.identity_id=$3 OR
   s.assignment_id IS NOT NULL AND EXISTS(SELECT 1 FROM assignments a WHERE a.id=s.assignment_id AND
    (a.owner_account_id=$5 OR a.state='Published' AND EXISTS(SELECT 1 FROM assignment_participants ap WHERE ap.assignment_id=a.id AND ap.identity_id=$3 AND NOT ap.exempt))) OR
   tp.results_published_at IS NOT NULL AND EXISTS(SELECT 1 FROM timed_practice_participants part WHERE part.practice_id=tp.id AND part.identity_id=$3 AND NOT part.exempt))) s
  JOIN identities person ON person.id=s.identity_id
  LEFT JOIN accounts profile ON profile.identity_id=person.id AND profile.binding_released_at IS NULL
  LEFT JOIN LATERAL (SELECT r.private_results FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id
   WHERE r.submission_id=s.id AND r.id IS DISTINCT FROM s.pending_judge_run_id AND r.status=s.status AND r.score IS NOT DISTINCT FROM s.score
    AND (NOT t.rejudge OR EXISTS(SELECT 1 FROM audit_events e WHERE e.action='submission.rejudge_confirm' AND e.resource_id=s.id::text AND e.metadata->>'runId'=r.id::text))
   ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON true`,[problemId,v.id,user.identityId,schoolVisible||permissions.canEdit,user.id],url);
}

export async function schoolProblemSubmissions(db,p,user,url,accessContext) {
 const requested=url.searchParams.get('versionId');
 if(requested&&uuid(requested)!==p.published_version_id)fail(404,'NOT_FOUND','This version is not available.');
 if(!p.published||!p.published_version_id||p.archived)fail(404,'NOT_FOUND','Problem is unavailable.');
 const identityId=accessContext==='school'?(await db.query('SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2',[p.school_id,user.id])).rows[0]?.id??null:null;
 // The job's identity is a receipt-time snapshot. Never infer historical
 // ownership from a later school-account binding. Unlinked history remains an
 // account bucket; owning that history does not transfer its AC to a new pupil.
 return metadataPage(db,`SELECT j.id::text,j.id received_id,
  CASE WHEN $5='public' THEN 'person:'||a.identity_id::text WHEN j.identity_id IS NOT NULL THEN 'school:'||j.identity_id::text ELSE 'account:'||j.account_id::text END actor_key,
  j.created_at,COALESCE(j.payload->>'language','python') language,
  CASE WHEN j.state='completed' THEN COALESCE(j.result->>'status','System Error') WHEN j.state='failed' THEN 'System Error' WHEN j.state='leased' THEN 'Judging' ELSE 'Waiting' END status,
  (j.account_id=$6 OR j.identity_id=$7::uuid) IS TRUE is_own,
  CASE WHEN $5='public' THEN a.identity_id=$4 WHEN $7::uuid IS NOT NULL THEN j.identity_id=$7 ELSE j.identity_id IS NULL AND j.account_id=$6 END is_current_student,
  CASE WHEN j.state='completed' THEN j.result->'privateResults' END private_results,
  CASE WHEN $5='public' OR person.id IS NULL THEN COALESCE(NULLIF(btrim(a.nickname),''),a.username)
   ELSE COALESCE(CASE WHEN profile.leaderboard_use_nickname THEN NULLIF(btrim(profile.nickname),'') END,NULLIF(btrim(person.name),''),'Student') END display_name
  FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
  LEFT JOIN school_identities person ON person.school_id=j.school_id AND person.id=j.identity_id
  LEFT JOIN accounts profile ON profile.id=person.account_id
  WHERE j.school_id=$1 AND j.problem_id=$2 AND j.version_id=$3 AND j.kind='submit' AND j.access_context=$5 AND ${schoolActivityJobVisibleSql('j')}`,
 [p.school_id,p.id,p.published_version_id,user.identityId,accessContext,user.id,identityId],url,{schoolProgress:true});
}

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
