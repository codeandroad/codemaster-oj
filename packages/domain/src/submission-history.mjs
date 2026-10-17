import {createHmac,timingSafeEqual} from 'node:crypto';
import {canonicalHash,enumValue,fail,integer,submissionId,uuid} from './security.mjs';

const kinds=['submit','correction','samples','custom'];
const statuses=['Waiting','Judging','Executed','AC','WA','CE','RE','TLE','MLE','OLE','System Error'];

// Live verdicts are visible during timed practice. Keep scores masked until
// publication, including in aggregate progress and filtered history.
const maskedFields=`status displayed_status,
 CASE WHEN masked THEN NULL ELSE score END displayed_score`;
const maskedCondition=`practice.id IS NOT NULL AND practice.results_published_at IS NULL AND NOT ($2 OR $3 AND practice.owner_account_id=$1)`;

function sign(payload,secret){return createHmac('sha256',secret).update(payload).digest('base64url');}
function decodeCursor(raw,secret,scope){
 if(!raw)return null;
 if(raw.length>1000||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw))fail(400,'VALIDATION','提交分页游标无效');
 const [payload,signature]=raw.split('.'),expected=sign(payload,secret),actual=Buffer.from(signature),known=Buffer.from(expected);
 if(actual.length!==known.length||!timingSafeEqual(actual,known))fail(400,'VALIDATION','提交分页游标无效');
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{fail(400,'VALIDATION','提交分页游标无效');}
 if(data.v!==1||data.scope!==scope||typeof data.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(data.at)||!Number.isFinite(Date.parse(data.at)))fail(400,'VALIDATION','提交分页游标与当前筛选不匹配');
 return {at:data.at,id:submissionId(data.id)};
}
function encodeCursor(row,secret,scope){const payload=Buffer.from(JSON.stringify({v:1,scope,at:row.cursor_created_at,id:String(row.id)})).toString('base64url');return `${payload}.${sign(payload,secret)}`;}

export async function submissionHistory(ctx){
 const {pool,url,user,config,helpers}=ctx;
 const identity=url.searchParams.get('identityId')||null,assignment=url.searchParams.get('assignmentId')||null,problem=url.searchParams.get('problemId')||null,timedPractice=url.searchParams.get('timedPracticeId')||null;
 if(identity)uuid(identity);if(assignment)await helpers.assignmentAccess(pool,user,assignment);if(problem)uuid(problem);if(timedPractice)uuid(timedPractice);
 const requestedKinds=url.searchParams.has('kind')?[...new Set(url.searchParams.getAll('kind').flatMap(value=>value.split(',')))].sort():null;
 if(requestedKinds)for(const kind of requestedKinds)enumValue(kind,kinds,'提交类型');
 const status=url.searchParams.get('status')||url.searchParams.get('verdict')||null,context=url.searchParams.get('context')||null;
 if(status)enumValue(status,statuses,'提交状态');if(context)enumValue(context,['practice','assignment','timed','correction'],'提交来源');
 const rawLimit=url.searchParams.get('limit');const limit=rawLimit===null?200:integer(Number(rawLimit),1,200,'每页记录数');
 const scope=canonicalHash({accountId:user.id,identityId:user.identityId,identity,assignment,problem,timedPractice,requestedKinds,status,context});
 const cursor=decodeCursor(url.searchParams.get('cursor'),config.secret,scope);
 const result=await pool.query(`WITH scoped AS(
  SELECT s.*,v.title problem_title,i.name student_name,attempt.practice_id timed_practice_id,
   (${maskedCondition}) masked,to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at
  FROM submissions s JOIN problem_versions v ON v.id=s.version_id JOIN identities i ON i.id=s.identity_id
  LEFT JOIN LATERAL submission_activity_context(s.original_submission_id) original ON true
  LEFT JOIN timed_attempts attempt ON attempt.id=COALESCE(s.timed_attempt_id,original.timed_attempt_id) LEFT JOIN timed_practices practice ON practice.id=attempt.practice_id
  WHERE (s.identity_id=$6 OR $2 OR $3 AND (
   COALESCE(s.assignment_id,original.assignment_id) IS NOT NULL AND EXISTS(SELECT 1 FROM assignments a WHERE a.id=COALESCE(s.assignment_id,original.assignment_id) AND a.owner_account_id=$1)
   OR COALESCE(s.timed_attempt_id,original.timed_attempt_id) IS NOT NULL AND practice.owner_account_id=$1
   OR COALESCE(s.assignment_id,original.assignment_id) IS NULL AND COALESCE(s.timed_attempt_id,original.timed_attempt_id) IS NULL AND (s.original_submission_id IS NULL OR original.resolved) AND EXISTS(SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id AND c.archived_at IS NULL JOIN class_members cm ON cm.class_id=c.id WHERE tc.account_id=$1 AND cm.identity_id=s.identity_id)))
   AND ($4::uuid IS NULL OR s.identity_id=$4) AND ($5::uuid IS NULL OR COALESCE(s.assignment_id,original.assignment_id)=$5) AND ($7::uuid IS NULL OR s.problem_id=$7)
   AND ($8::uuid IS NULL OR attempt.practice_id=$8) AND ($9::text[] IS NULL OR s.kind=ANY($9))
 ), visible AS(SELECT scoped.*,${maskedFields} FROM scoped)
 SELECT * FROM visible WHERE ($10::text IS NULL OR displayed_status=$10)
  AND ($11::text IS NULL OR $11='correction' AND kind='correction' OR $11='timed' AND timed_attempt_id IS NOT NULL OR $11='assignment' AND assignment_id IS NOT NULL AND kind<>'correction' OR $11='practice' AND assignment_id IS NULL AND timed_attempt_id IS NULL AND kind<>'correction')
  AND ($12::timestamptz IS NULL OR (created_at,id)<($12::timestamptz,$13::bigint))
 ORDER BY created_at DESC,id DESC LIMIT $14`,[user.id,user.roles.includes('admin'),user.roles.includes('teacher'),identity,assignment,user.identityId,problem,timedPractice,requestedKinds,status,context,cursor?.at||null,cursor?.id||null,limit+1]);
 const rows=result.rows.slice(0,limit);
 return {rows,nextCursor:result.rows.length>limit?encodeCursor(rows.at(-1),config.secret,scope):null};
}

export async function problemOwnProgress(pool,user,problemIds){
 if(!problemIds.length)return new Map();
 const {rows}=await pool.query(`WITH scoped AS(
  SELECT s.id,s.problem_id,s.status,s.score,s.created_at,(${maskedCondition}) masked
  FROM submissions s LEFT JOIN timed_attempts attempt ON attempt.id=s.timed_attempt_id LEFT JOIN timed_practices practice ON practice.id=attempt.practice_id
  WHERE s.identity_id=$4 AND s.kind='submit' AND s.problem_id=ANY($5::uuid[])
 ), visible AS(SELECT scoped.*,${maskedFields} FROM scoped),
 totals AS(SELECT problem_id,count(*)::int formal_count FROM visible GROUP BY problem_id),
 latest AS(SELECT DISTINCT ON(problem_id) * FROM visible ORDER BY problem_id,created_at DESC,id DESC),
 best AS(SELECT DISTINCT ON(problem_id) * FROM visible WHERE displayed_score IS NOT NULL AND displayed_status NOT IN ('Waiting','Judging','System Error') ORDER BY problem_id,displayed_score DESC,created_at DESC,id DESC)
 SELECT totals.problem_id,totals.formal_count,COALESCE(best.displayed_status,latest.displayed_status) status,best.displayed_score best_score,latest.id last_id,latest.created_at last_created_at
 FROM totals JOIN latest USING(problem_id) LEFT JOIN best USING(problem_id)`,[user.id,user.roles.includes('admin'),user.roles.includes('teacher'),user.identityId,problemIds]);
 return new Map(rows.map(row=>[row.problem_id,{status:row.status,bestScore:row.best_score===null?null:Number(row.best_score),formalCount:row.formal_count,lastSubmissionId:`SUB${row.last_id}`,lastSubmittedAt:row.last_created_at}]));
}

export const emptyOwnProgress=()=>({status:'NotStarted',bestScore:null,formalCount:0,lastSubmissionId:null,lastSubmittedAt:null});
