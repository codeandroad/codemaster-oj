import { problemProgress } from './problem-progress.mjs';
import { lockWorkspaceMembership } from './schools.mjs';
import { schoolActivityJobVisibleSql } from './school-activities.mjs';
import { enumValue, integer, uuid, fail } from './security.mjs';
import { submissionMeasurements, submissionMeasurementsSql } from './submission-feedback.mjs';

// Public submission history exposes a safe display name, never identity IDs, code, output,
// case data, score, teacher feedback, or link to another user's private record.
export function submissionListOptions(url) {
 const get=name=>url?.searchParams?.get(name);
 return {page:integer(Number(get('page')??1),1,100000,'Page'),
  pageSize:integer(Number(get('pageSize')??25),1,100,'Page size'),
  sort:enumValue(get('sort')??'createdAt',['createdAt','language','status','runtimeMs','memoryKb'],'Sort'),
  order:enumValue(get('order')??'desc',['asc','desc'],'Order')};
}

export async function metadataPage(db, source, params, url, { schoolProgress = false, ownDetails = false } = {}) {
 const {page,pageSize,sort,order}=submissionListOptions(url);
 const columns={createdAt:'created_at',language:'language',status:'status',runtimeMs:'runtime_ms',memoryKb:'memory_kb'};
 // Filter visibility before choosing a person's latest formal submission. Keep
 // historical verdicts separate: a later WA does not undo a previous formal AC.
 const base=`WITH visible AS (${source}), latest AS (
  SELECT DISTINCT ON (actor_key) * FROM visible ORDER BY actor_key,created_at DESC,received_id DESC
 ), measured AS (
  SELECT id,received_id,created_at,language,status,is_own,display_name,${ownDetails ? 'detail_scope,detail_school,' : ''}
   CASE WHEN status NOT IN ('Waiting','Judging','System Error') THEN m.runtime_ms END runtime_ms,
   CASE WHEN status NOT IN ('Waiting','Judging','System Error') THEN m.memory_kb END memory_kb
  FROM latest r CROSS JOIN LATERAL (${submissionMeasurementsSql}) m)`;
 const summary=(await db.query(`${base} SELECT (SELECT count(*)::int FROM latest) total,
  EXISTS(SELECT 1 FROM visible WHERE ${schoolProgress?'is_current_student':'is_own'} AND status='AC') solved`,params)).rows[0];
 const rows=(await db.query(`${base} SELECT * FROM measured
  ORDER BY ${columns[sort]} ${order.toUpperCase()} NULLS LAST,created_at DESC,received_id DESC
  LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,pageSize,(page-1)*pageSize])).rows;
 return {items:rows.map(r=>({id:String(r.id),createdAt:r.created_at,language:r.language,status:r.status,isOwn:r.is_own,displayName:r.display_name,
  ...submissionMeasurements(r)})),
  ...(ownDetails && {ownDetails:Object.fromEntries(rows.filter(r=>r.is_own && r.detail_scope).map(r=>[r.id,{scope:r.detail_scope,schoolId:r.detail_school}]))}),
  page,pageSize,total:summary.total,hasMore:page*pageSize<summary.total,solved:summary.solved};
}

const confirmedMeasurementsJoin = `LEFT JOIN LATERAL (
 SELECT r.private_results FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id
 WHERE r.submission_id=s.id AND r.id IS DISTINCT FROM s.pending_judge_run_id
  AND r.status=s.status AND r.score IS NOT DISTINCT FROM s.score
  AND (NOT t.rejudge OR EXISTS(SELECT 1 FROM audit_events e WHERE e.action='submission.rejudge_confirm'
   AND e.resource_id=s.id::text AND e.metadata->>'runId'=r.id::text))
 ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON true`;

const ordinarySchoolReceipts = `SELECT 'SUB'||s.id::text id,lpad(s.id::text,20,'0') received_id,
 'person:'||s.identity_id::text actor_key,s.created_at,s.language,s.status,
 s.identity_id=$4 is_own,s.identity_id=$4 is_current_student,r.private_results,
 COALESCE(CASE WHEN profile.leaderboard_use_nickname THEN NULLIF(btrim(profile.nickname),'') END,
 NULLIF(btrim(person.name),''),'Student') display_name,
 CASE WHEN s.account_id=$6 AND s.identity_id=$4 THEN 'school' END detail_scope,s.school_id detail_school
 FROM submissions s
 JOIN identities person ON person.id=s.identity_id
 LEFT JOIN accounts profile ON profile.identity_id=person.id AND profile.binding_released_at IS NULL
 JOIN problems source ON source.id=s.problem_id AND source.archived_at IS NULL
 JOIN problem_banks bank ON bank.id=source.bank_id AND bank.school_id=$8 AND bank.visibility='school' AND bank.archived_at IS NULL
 JOIN problem_versions receipt ON receipt.id=s.version_id AND receipt.published_at IS NOT NULL AND receipt.school_visible_at IS NOT NULL
 JOIN problem_versions live ON live.id=$3 AND live.problem_id=source.id AND live.school_visible_at IS NOT NULL AND live.published_at IS NOT NULL
 ${confirmedMeasurementsJoin}
 WHERE s.school_id=$8 AND s.problem_id=$2 AND s.kind='submit' AND s.assignment_id IS NULL AND s.timed_attempt_id IS NULL
 AND s.original_submission_id IS NULL`;

const jobVerdict=`CASE WHEN j.state='completed' THEN COALESCE(j.result->>'status','System Error') WHEN j.state='failed' THEN 'System Error' WHEN j.state='leased' THEN 'Judging' ELSE 'Waiting' END`;

export async function schoolProblemSubmissions(db,p,user,url,accessContext,{workspaceSchoolId=null,includePlatform=false}={}) {
 const requested=url.searchParams.get('versionId');
 if(requested&&uuid(requested)!==p.published_version_id&&!(await db.query(`SELECT 1
  FROM school_problem_versions requested JOIN school_problem_versions current ON current.school_id=requested.school_id
   AND current.problem_id=requested.problem_id AND current.id=$4
  WHERE requested.school_id=$1 AND requested.problem_id=$2 AND requested.id=$3
   AND requested.draft_revision<=current.draft_revision`,[p.school_id,p.id,requested,p.published_version_id])).rowCount)
  fail(404,'NOT_FOUND','This version is not available.');
 if(!p.published||!p.published_version_id||p.archived)fail(404,'NOT_FOUND','Problem is unavailable.');
 if(accessContext==='public'&&url.searchParams.get('view')==='resume'){
  const {rows}=await db.query(`SELECT j.payload->>'code' code,COALESCE(j.payload->>'language','python') language
   FROM school_judge_jobs j
   WHERE j.school_id=$1 AND j.problem_id=$2 AND $3::uuid IS NOT NULL AND j.account_id=$4
    AND j.access_context='public' AND j.kind='submit'
    AND ${schoolActivityJobVisibleSql('j')}
   ORDER BY j.created_at DESC,j.id DESC LIMIT 1`,[p.school_id,p.id,p.published_version_id,user.id]);
  return {submission:rows[0]??null};
 }
 const identityId=accessContext==='school'?(await db.query('SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2',[p.school_id,user.id])).rows[0]?.id??null:null;
 // The job's identity is a receipt-time snapshot. Never infer historical
 // ownership from a later school-account binding. Unlinked history remains an
 // account bucket; owning that history does not transfer its AC to a new pupil.
 const values=[p.school_id,p.id,p.published_version_id,user.identityId,accessContext,user.id,identityId];
 let schoolHistory='';
 let schoolJobs=includePlatform?"OR (j.access_context='public' AND j.activity_id IS NULL)":'';
 if(workspaceSchoolId || accessContext==='school') {
  const schoolId=uuid(workspaceSchoolId??p.school_id,'School ID');
  if(!await lockWorkspaceMembership(db,schoolId,user.id,{studentOnly:true}))fail(404,'NOT_FOUND','School practice history is unavailable.');
  values.push(schoolId);
  schoolHistory=`UNION ALL ${ordinarySchoolReceipts}`;
  if(workspaceSchoolId)schoolJobs=`OR (j.school_id=$8 AND j.access_context='school' AND j.activity_id IS NULL)`;
 }
 const page=await metadataPage(db,`SELECT j.id::text,j.id::text received_id,
  CASE WHEN j.access_context='public' THEN 'person:'||a.identity_id::text
   WHEN person.account_id=j.account_id THEN 'person:'||a.identity_id::text
   WHEN $5<>'staff_practice' AND j.identity_id IS NOT NULL THEN 'school:'||j.identity_id::text ELSE 'account:'||j.account_id::text END actor_key,
  j.created_at,COALESCE(j.payload->>'language','python') language,
  ${jobVerdict} status,
  (j.account_id=$6 OR j.identity_id=$7::uuid) IS TRUE is_own,
  CASE WHEN $5='public' THEN a.identity_id=$4 WHEN $5='staff_practice' THEN j.account_id=$6 WHEN $7::uuid IS NOT NULL THEN j.identity_id=$7 ELSE j.identity_id IS NULL AND j.account_id=$6 END is_current_student,
  CASE WHEN j.state='completed' THEN j.result->'privateResults' END private_results,
  CASE WHEN j.access_context='public' OR person.id IS NULL THEN COALESCE(NULLIF(btrim(a.nickname),''),a.username)
   ELSE COALESCE(CASE WHEN profile.leaderboard_use_nickname THEN NULLIF(btrim(profile.nickname),'') END,NULLIF(btrim(person.name),''),'Student') END display_name,
  CASE WHEN j.account_id=$6 AND j.access_context IN ('school','public') THEN j.access_context END detail_scope,j.school_id detail_school
  FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
  LEFT JOIN school_identities person ON person.school_id=j.school_id AND person.id=j.identity_id
  LEFT JOIN accounts profile ON profile.id=person.account_id
  WHERE j.school_id=$1 AND j.problem_id=$2 AND $3::uuid IS NOT NULL AND j.kind='submit'
   AND (j.access_context=$5 OR $5='staff_practice' AND j.access_context='school' AND j.activity_id IS NULL ${schoolJobs})
   AND ($5<>'staff_practice' OR j.account_id=$6) AND ${schoolActivityJobVisibleSql('j')}
   ${schoolHistory}`,values,url,{schoolProgress:true,ownDetails:true});
 return {...page,solved:(await problemProgress(db,user,[p.id],{includeStaff:accessContext==='staff_practice'})).get(p.id)?.solved??false};
}
