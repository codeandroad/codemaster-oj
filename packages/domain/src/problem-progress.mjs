import { transaction } from './db.mjs';
import { schoolActivityJobVisibleSql } from './school-activities.mjs';

// The source problem ID is shared by school practice and its public projection.
// A version records what was judged, not a separate learner achievement.
export function problemProgressRowsSql({ problemId, problemIds = null, accountId, identityId = null, includeStaff = false }) {
 const person=identityId??`(SELECT identity_id FROM accounts WHERE id=${accountId})`;
 const selected=alias=>problemIds?`${alias}.problem_id=ANY(${problemIds})`:`${alias}.problem_id=${problemId}`;
 return `SELECT 'SUB'||s.id::text id,s.problem_id,s.status,s.score,s.created_at,s.language
  FROM submissions s
  LEFT JOIN LATERAL submission_activity_context(s.original_submission_id) original ON true
  LEFT JOIN timed_attempts ta ON ta.id=COALESCE(s.timed_attempt_id,original.timed_attempt_id)
  LEFT JOIN timed_practices tp ON tp.id=ta.practice_id
  WHERE ${selected('s')} AND s.identity_id=${person} AND s.kind IN ('submit','correction')
   AND (s.original_submission_id IS NULL OR original.resolved)
   AND (COALESCE(s.timed_attempt_id,original.timed_attempt_id) IS NULL OR tp.results_published_at IS NOT NULL)
  UNION ALL
  SELECT j.id::text,j.problem_id,
   CASE WHEN j.state='completed' THEN COALESCE(j.result->>'status','System Error') WHEN j.state='failed' THEN 'System Error'
    WHEN j.state='leased' THEN 'Judging' ELSE 'Waiting' END,
   CASE WHEN j.state='completed' THEN (j.result->>'score')::numeric END,j.created_at,COALESCE(j.payload->>'language','python')
  FROM school_judge_jobs j
  WHERE ${selected('j')} AND j.kind='submit' AND ${schoolActivityJobVisibleSql('j')}
   AND ((j.access_context='public' AND j.account_id=${accountId})
    OR (j.access_context='school' AND (
     j.identity_id IS NOT NULL AND EXISTS(SELECT 1 FROM school_identities current_person
      WHERE current_person.school_id=j.school_id AND current_person.id=j.identity_id AND current_person.account_id=${accountId})
     OR j.identity_id IS NULL AND j.account_id=${accountId} AND NOT EXISTS(SELECT 1 FROM school_identities current_person
      WHERE current_person.school_id=j.school_id AND current_person.account_id=${accountId})))
    ${includeStaff ? `OR (j.access_context='staff_practice' AND j.activity_id IS NULL AND j.account_id=${accountId})` : ''})`;
}

export function problemSolvedSql({ requiredLanguage = 'NULL', languageCreditCutoffs = "'{}'::jsonb", ...options }) {
 return `EXISTS(SELECT 1 FROM (${problemProgressRowsSql(options)}) shared_progress
  WHERE shared_progress.status='AC' AND course_language_allows_credit(${requiredLanguage},${languageCreditCutoffs},shared_progress.language,shared_progress.created_at))`;
}

export async function withProblemProgressScope(db,schoolId,fn) {
 if('totalCount' in db)return transaction(db,client=>withProblemProgressScope(client,schoolId,fn));
 const previous=(await db.query("SELECT current_setting('campus.school_id',true) school")).rows[0].school??'';
 await db.query("SELECT set_config('campus.school_id',$1,true)",[schoolId]);
 let failed=false;
 try{return await fn(db);}catch(error){failed=true;throw error;}
 finally{try{await db.query("SELECT set_config('campus.school_id',$1,true)",[previous]);}catch(error){if(!failed)throw error;}}
}

export async function problemProgress(db,user,problemIds,{schoolId=null,includeStaff=false}={}) {
 if(!problemIds.length)return new Map();
 if(schoolId){
  return withProblemProgressScope(db,schoolId,client=>problemProgress(client,user,problemIds,{includeStaff}));
 }
 // Read the learner's visible history once for the complete catalog. Running
 // this union through a lateral lookup per problem repeated scans and made
 // PostgreSQL JIT compilation dominate otherwise small catalog requests.
 const {rows}=await db.query(`WITH visible AS (
  ${problemProgressRowsSql({problemIds:'$2::uuid[]',accountId:'$1',identityId:'$3',includeStaff})}
 ), totals AS (SELECT problem_id,count(*)::int formal_count,bool_or(status='AC') solved FROM visible GROUP BY problem_id),
 latest AS (SELECT DISTINCT ON(problem_id) * FROM visible ORDER BY problem_id,created_at DESC,id DESC),
 best AS (SELECT DISTINCT ON(problem_id) * FROM visible WHERE score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error')
  ORDER BY problem_id,(status='AC') DESC,score DESC,created_at DESC,id DESC)
 SELECT totals.*,COALESCE(best.status,latest.status) status,best.score best_score,latest.id last_id,latest.created_at last_created_at
 FROM totals JOIN latest USING(problem_id) LEFT JOIN best USING(problem_id)`,[user.id,problemIds,user.identityId]);
 return new Map(rows.map(row=>[row.problem_id,{status:row.solved?'AC':row.status,solved:row.solved,bestScore:row.best_score===null?null:Number(row.best_score),formalCount:row.formal_count,lastSubmissionId:row.last_id,lastSubmittedAt:row.last_created_at}]));
}
