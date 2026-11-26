import { transaction } from './db.mjs';
import { activeAccount, lockSchoolTeaching, lockWorkspaceMembership } from './schools.mjs';
import { setPublicPracticeHistoryAccount } from './public-practice-records.mjs';
import { enumValue, fail, uuid } from './security.mjs';

export function judgingDate(value) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') ||
      !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== value)
    fail(400,'VALIDATION','Choose a valid calendar date.');
  return value;
}
export const judgingDaySql = param => `j.created_at >= (${param}::date::timestamp AT TIME ZONE 'Asia/Shanghai')
  AND j.created_at < ((${param}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')`;
export const judgingStatusSql = "CASE j.state WHEN 'leased' THEN 'Judging' WHEN 'queued' THEN 'Waiting' ELSE coalesce(j.result->>'status','System Error') END";
const personal = "j.access_context='public' AND j.activity_id IS NULL AND j.kind IN ('samples','custom','submit') AND j.account_id=$1";
const keySql = "j.school_id::text||':'||j.id::text";

export async function sharingStudent(db, schoolId, userId) {
  await lockSchoolTeaching(db,schoolId,{shared:true});
  if (!await lockWorkspaceMembership(db,schoolId,userId,{studentOnly:true}))
    fail(403,'FORBIDDEN','An active student membership is required.');
  const row=(await db.query(`SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2
    AND kind='student' AND archived_at IS NULL FOR SHARE`,[schoolId,userId])).rows[0];
  if (!row) fail(403,'FORBIDDEN','A linked student profile is required.');
  return row.id;
}

export async function publicRunSharing({pool,user,url,method,body,detail}) {
  return transaction(pool,async db=>{
    await activeAccount(db,user.id);
    await setPublicPracticeHistoryAccount(db,user.id);
    if (detail) {
      const row=(await db.query(`SELECT j.payload->>'code' AS code FROM school_judge_jobs j
        WHERE ${personal} AND j.school_id=$2 AND j.id=$3`,[user.id,uuid(detail[0]),uuid(detail[1])])).rows[0];
      if (!row) fail(404,'NOT_FOUND','Run not found.');
      return {status:200,body:row};
    }
    const reading=method==='GET';
    const date=judgingDate(reading?url.searchParams.get('date'):body.date);
    const rawSchool=reading?url.searchParams.get('schoolId'):body.schoolId;
    const schoolId=reading && !rawSchool?null:uuid(rawSchool);
    const identityId=schoolId?await sharingStudent(db,schoolId,user.id):null;
    const args=[user.id,date,schoolId,identityId];
    const from=`FROM school_judge_jobs j LEFT JOIN school_public_run_shares s
        ON (s.source_school_id,s.job_id,s.account_id,s.school_id,s.identity_id)=(j.school_id,j.id,j.account_id,$3::uuid,$4::uuid)
      LEFT JOIN school_public_run_shares c ON (c.source_school_id,c.job_id,c.account_id)=(j.school_id,j.id,j.account_id)
        AND c.visibility='classroom'
      WHERE ${personal} AND ${judgingDaySql('$2')}`;
    if (reading) {
      const {rows}=await db.query(`SELECT ${keySql} AS id,j.created_at AS "createdAt",j.kind,
        j.payload#>>'{version,title}' AS title,j.payload->>'language' AS language,${judgingStatusSql} AS status,
        coalesce(c.visibility,s.visibility,'private') AS visibility ${from} ORDER BY j.created_at,j.school_id,j.id`,args);
      return {status:200,body:{items:rows}};
    }
    const visibility=enumValue(body.visibility,['private','summary','code'],'Sharing level');
    if (!Array.isArray(body.records) || !body.records.length || body.records.length>20000)
      fail(400,'VALIDATION','Select runs to update.');
    const ids=body.records.map(key=>{
      if(typeof key!=='string' || key.length!==73 || key[36]!==':')fail(400,'VALIDATION','Invalid record.');
      return uuid(key.slice(0,36)).toLowerCase()+':'+uuid(key.slice(37)).toLowerCase();
    });
    // Serialize competing updates, including two first-time shares with no row to lock.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('public-run-share:'||$1::text||':'||$2::text,0))",[user.id,schoolId]);
    const selected=from+` AND ${keySql}=ANY($5::text[]) AND c.job_id IS NULL`;
    const params=[...args,ids];
    const {rows:[{n}]}=await db.query(`SELECT count(*)::int n ${selected}`,params);
    if(n!==ids.length)fail(404,'NOT_FOUND','A selected personal run is unavailable.');
    if(visibility==='private'){
      await db.query(`DELETE FROM school_public_run_shares WHERE account_id=$1 AND school_id=$2 AND identity_id=$3
        AND visibility<>'classroom' AND (source_school_id::text||':'||job_id::text)=ANY($4::text[])`,[user.id,schoolId,identityId,ids]);
    }else{
      await db.query(`INSERT INTO school_public_run_shares(school_id,identity_id,account_id,source_school_id,job_id,visibility)
        SELECT $3,$4,$1,j.school_id,j.id,$6 ${selected}
        ON CONFLICT (school_id,identity_id,account_id,source_school_id,job_id)
        DO UPDATE SET visibility=excluded.visibility WHERE school_public_run_shares.visibility<>'classroom'`,[...params,visibility]);
    }
    return {status:200,body:{updated:n}};
  });
}
