import { avatarForIdentity } from './avatars.mjs';
import { transaction } from './db.mjs';
import { lockSchoolTeaching, schoolRole } from './schools.mjs';
import { fail, field, integer, uuid } from './security.mjs';
import { schoolScholarshipSettings } from './school-scholarship.mjs';
export async function handleSchoolLeaderboard({pool,user,route,method,url}){
 const m=route.match(/^\/schools\/([^/]+)\/leaderboard$/);if(!m)return null;if(method!=='GET')return null;const s=uuid(m[1]);
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,s,{shared:true});await schoolRole(db,s,user.id);await db.query("SELECT set_config('campus.school_id',$1,true)",[s]);
  const settings=await schoolScholarshipSettings(db,s),page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page'),q=field(url.searchParams.get('q')??'','Search',{min:0,max:100}),classId=url.searchParams.get('classId')?uuid(url.searchParams.get('classId')):null;
  const selectedClass=classId?(await db.query('SELECT leaderboard_fields FROM school_classes WHERE school_id=$1 AND id=$2 AND archived_at IS NULL',[s,classId])).rows[0]:null;
  if(classId&&!selectedClass)fail(404,'NOT_FOUND','Class is unavailable.');
  const rows=(await db.query(`WITH formal AS (
   SELECT receipt.identity_id,receipt.subject_key,receipt.received_at,r.status
   FROM school_scholarship_receipts receipt JOIN school_scholarship_results r USING(school_id,source_kind,job_id,subject_key) WHERE receipt.school_id=$1
   UNION ALL SELECT s.identity_id,'problem:'||s.problem_id,s.created_at,s.status FROM submissions s
    LEFT JOIN timed_attempts ta ON ta.id=s.timed_attempt_id
    LEFT JOIN school_activities activity ON activity.school_id=s.school_id AND activity.id=ta.practice_id
    WHERE s.school_id=$1 AND s.kind='submit' AND (s.timed_attempt_id IS NULL OR activity.results_published_at IS NOT NULL)
  ), stats AS (SELECT identity_id,count(*)::integer attempts,count(*) FILTER(WHERE status IN ('AC','WA','CE','RE','TLE','MLE','OLE'))::integer assessed,count(*) FILTER(WHERE status='AC')::integer accepted FROM formal GROUP BY identity_id),
  awards AS (SELECT identity_id,points FROM school_rank_awards WHERE school_id=$1
   UNION ALL SELECT identity_id,points FROM acsl_point_awards WHERE school_id=$1
   UNION ALL SELECT award.identity_id,award.points FROM paper4_rank_ledger award JOIN school_paper4_attempts a ON a.id=award.attempt_id AND a.school_id=$1),
  points AS (SELECT identity_id,sum(points)::integer points FROM awards GROUP BY identity_id),
  solves AS (SELECT identity_id,count(DISTINCT subject_key)::integer solved FROM (
    SELECT identity_id,subject_key FROM school_rank_awards WHERE school_id=$1
    UNION ALL SELECT l.identity_id,'problem:'||l.problem_id FROM point_ledger l JOIN submissions s ON s.id=l.submission_id WHERE s.school_id=$1 AND l.reason='first_ac'
   ) solved GROUP BY identity_id),
  members AS (SELECT i.id,i.name,a.id AS account_id,a.avatar,CASE WHEN a.leaderboard_use_nickname AND btrim(a.nickname)<>'' THEN a.nickname ELSE i.name END display_name,
    coalesce(p.points,0) points,coalesce(sc.solved,0) solved,coalesce(st.attempts,0) attempts,coalesce(st.assessed,0) assessed,CASE WHEN coalesce(st.assessed,0)=0 THEN 0 ELSE st.accepted::numeric/st.assessed END ac_rate,coalesce(w.balance,0) balance
   ,EXISTS(SELECT 1 FROM sessions s WHERE s.account_id=a.id AND s.expires_at>statement_timestamp()
     AND (s.presence_seen_at>statement_timestamp()-interval '90 seconds' OR s.public_presence_seen_at>statement_timestamp()-interval '90 seconds')) online
   FROM school_identities i JOIN accounts a ON a.id=i.account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL JOIN school_memberships m ON m.school_id=i.school_id AND m.account_id=a.id AND m.role='student' AND m.revoked_at IS NULL
   LEFT JOIN points p ON p.identity_id=i.id LEFT JOIN solves sc ON sc.identity_id=i.id LEFT JOIN stats st ON st.identity_id=i.id LEFT JOIN school_scholarship_accounts w ON w.school_id=i.school_id AND w.identity_id=i.id
   WHERE i.school_id=$1 AND i.kind='student' AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM school_class_roster cr WHERE cr.school_id=i.school_id AND cr.identity_id=i.id AND cr.class_id=$2))
  ), ranked AS (SELECT *,rank() OVER(ORDER BY points DESC,ac_rate DESC,balance DESC)::integer rank FROM members)
  SELECT *,count(*) OVER()::integer total FROM ranked WHERE $3='' OR strpos(lower(display_name),lower($3))>0 ORDER BY rank,display_name,id LIMIT 51 OFFSET $4`,[s,classId,q,(page-1)*50])).rows;
  const visible={...settings.displayFields,...selectedClass?.leaderboard_fields},items=rows.slice(0,50).map(r=>({rank:r.rank,identityId:r.id,accountId:r.account_id,name:r.display_name,avatar:avatarForIdentity(r.avatar,r.id),isOwn:r.account_id===user.id,isOnline:r.online,points:r.points,...(visible.solved?{solved:r.solved}:{}),...(visible.attempts?{attempts:r.attempts}:{}),...(visible.acRate?{acRate:r.assessed?Number(r.ac_rate):null}:{}),...(visible.scholarship?{scholarship:r.balance}:{})}));
  return {status:200,body:{items,page,pageSize:50,hasMore:rows.length>50,total:rows[0]?.total??0,displayFields:visible,classes:(await db.query('SELECT id,name FROM school_classes WHERE school_id=$1 AND archived_at IS NULL ORDER BY name,id',[s])).rows}};
 });
}
