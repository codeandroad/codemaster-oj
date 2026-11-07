import { transaction } from './db.mjs';
import { LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { fail, field, integer, uuid } from './security.mjs';
import { schoolScholarshipSettings } from './school-scholarship.mjs';
export async function handleSchoolLeaderboard({pool,user,route,method,url}){
 const m=route.match(/^\/schools\/([^/]+)\/leaderboard$/);if(!m)return null;if(method!=='GET')return null;const s=uuid(m[1]);if(s===LEGACY_SCHOOL_ID)fail(404,'NOT_FOUND','Use the existing school leaderboard.');
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,s,{shared:true});await schoolRole(db,s,user.id);await db.query("SELECT set_config('campus.school_id',$1,true)",[s]);
  const settings=await schoolScholarshipSettings(db,s),page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page'),q=field(url.searchParams.get('q')??'','Search',{min:0,max:100}),classId=url.searchParams.get('classId')?uuid(url.searchParams.get('classId')):null;
  if(classId&&!(await db.query('SELECT 1 FROM school_classes WHERE school_id=$1 AND id=$2 AND archived_at IS NULL',[s,classId])).rowCount)fail(404,'NOT_FOUND','Class is unavailable.');
  const rows=(await db.query(`WITH formal AS (
   SELECT receipt.identity_id,receipt.subject_key,receipt.received_at,r.status
   FROM school_scholarship_receipts receipt JOIN school_scholarship_results r USING(school_id,source_kind,job_id,subject_key) WHERE receipt.school_id=$1
  ), stats AS (SELECT identity_id,count(*)::integer attempts,count(*) FILTER(WHERE status IN ('AC','WA','CE','RE','TLE','MLE','OLE'))::integer assessed,count(*) FILTER(WHERE status='AC')::integer accepted FROM formal GROUP BY identity_id),
  points AS (SELECT identity_id,sum(points)::integer points,count(*)::integer solved FROM school_rank_awards WHERE school_id=$1 GROUP BY identity_id),
  members AS (SELECT i.id,i.name,a.id AS account_id,a.avatar,CASE WHEN a.leaderboard_use_nickname AND btrim(a.nickname)<>'' THEN a.nickname ELSE i.name END display_name,
    coalesce(p.points,0) points,coalesce(p.solved,0) solved,coalesce(st.attempts,0) attempts,coalesce(st.assessed,0) assessed,CASE WHEN coalesce(st.assessed,0)=0 THEN 0 ELSE st.accepted::numeric/st.assessed END ac_rate,coalesce(w.balance,0) balance
   FROM school_identities i JOIN accounts a ON a.id=i.account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL JOIN school_memberships m ON m.school_id=i.school_id AND m.account_id=a.id AND m.role='student' AND m.revoked_at IS NULL
   LEFT JOIN points p ON p.identity_id=i.id LEFT JOIN stats st ON st.identity_id=i.id LEFT JOIN school_scholarship_accounts w ON w.school_id=i.school_id AND w.identity_id=i.id
   WHERE i.school_id=$1 AND i.kind='student' AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM school_class_roster cr WHERE cr.school_id=i.school_id AND cr.identity_id=i.id AND cr.class_id=$2))
  ), ranked AS (SELECT *,rank() OVER(ORDER BY points DESC,ac_rate DESC,balance DESC)::integer rank FROM members)
  SELECT *,count(*) OVER()::integer total FROM ranked WHERE $3='' OR strpos(lower(display_name),lower($3))>0 ORDER BY rank,display_name,id LIMIT 51 OFFSET $4`,[s,classId,q,(page-1)*50])).rows;
  const visible=settings.displayFields,items=rows.slice(0,50).map(r=>({rank:r.rank,identityId:r.id,accountId:r.account_id,name:r.display_name,avatar:r.avatar,isOwn:r.account_id===user.id,points:r.points,...(visible.solved?{solved:r.solved}:{}),...(visible.attempts?{attempts:r.attempts}:{}),...(visible.acRate?{acRate:r.assessed?Number(r.ac_rate):null}:{}),...(visible.scholarship?{scholarship:r.balance}:{})}));
  return {status:200,body:{items,page,pageSize:50,hasMore:rows.length>50,total:rows[0]?.total??0,displayFields:visible,classes:(await db.query('SELECT id,name FROM school_classes WHERE school_id=$1 AND archived_at IS NULL ORDER BY name,id',[s])).rows}};
 });
}
