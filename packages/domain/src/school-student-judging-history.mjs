import { transaction } from './db.mjs';
import { lockSchoolTeaching, requireSchoolAdmin } from './schools.mjs';
import { fail, integer, uuid } from './security.mjs';

const pageSize = 50;
// The date is a school calendar day. Use a half-open range on the stored timestamp
// so midnight belongs to exactly one day and timestamp indexes remain usable.
const day = "j.created_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND j.created_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')";
const jobStatus = "CASE j.state WHEN 'leased' THEN 'Judging' WHEN 'queued' THEN 'Waiting' ELSE coalesce(j.result->>'status','System Error') END";

export async function studentJudgingHistory({pool, user, school, identity, record, url}) {
  const schoolId = uuid(school), identityId = uuid(identity);
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId, {shared:true});
    await requireSchoolAdmin(db, schoolId, user.id);
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    const student = (await db.query(`SELECT i.account_id,i.name FROM school_identities i
      WHERE i.school_id=$1 AND i.id=$2 AND i.kind='student' AND i.archived_at IS NULL`, [schoolId,identityId])).rows[0];
    if (!student) fail(404,'NOT_FOUND','Student not found.');
    const date = url.searchParams.get('date') ?? '';
    const parsed = new Date(date);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || date.startsWith('0000') ||
        !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== date)
      fail(400,'VALIDATION','Choose a valid calendar date.');
    const page = integer(Number(url.searchParams.get('page') ?? 1),1,100000,'Page');
    const args = [schoolId,identityId,student.account_id,date];
    // School jobs are owned by the dossier. School ACSL jobs predate the identity
    // column on that entry point and are recorded against the school and login.
    // Public practice uses its own account scope even for school-authored problems.
    const records = `SELECT j.id::text AS id,j.created_at,j.kind,v.definition->>'title' AS title,
        a.title AS activity,${jobStatus} AS status,j.payload->>'language' AS language
        ${record ? ",j.payload->>'code' AS code" : ''}
      FROM school_judge_jobs j JOIN school_problem_versions v ON (v.school_id,v.id)=(j.school_id,j.version_id)
      LEFT JOIN school_activities a ON (a.school_id,a.id)=(j.school_id,j.activity_id)
      WHERE j.school_id=$1 AND ((j.access_context='school' AND j.identity_id=$2)
        OR (j.access_context='acsl' AND j.account_id=$3)) AND j.kind IN ('samples','custom','submit') AND ${day}
      UNION ALL
      SELECT 'SUB'||j.id,j.created_at,j.kind,v.title,a.title,j.status,j.language${record ? ',j.code' : ''}
      FROM submissions j JOIN problem_versions v ON v.id=j.version_id
      LEFT JOIN school_activities a ON (a.school_id,a.id)=(j.school_id,j.assignment_id)
      WHERE j.school_id=$1 AND j.identity_id=$2 AND ${day}
      UNION ALL
      SELECT 'P4-'||j.id||'-'||q.n,j.created_at,CASE WHEN j.kind='submit' OR j.payload#>>'{snapshot,origin}'='formal' THEN 'submit' ELSE 'samples' END,
        coalesce(q.item#>>'{question,title}',q.item->>'key'),v.content->>'title',
        coalesce((SELECT r->>'status' FROM jsonb_array_elements(j.result->'questions') r WHERE r->>'key'=q.item->>'key' LIMIT 1),${jobStatus}),
        'python'${record ? ",q.item->>'sourceCode'" : ''}
      FROM school_paper4_jobs j JOIN school_paper4_versions v ON (v.school_id,v.id)=(j.school_id,j.version_id)
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(j.payload->'questions',
        jsonb_build_array(jsonb_build_object('key',j.payload#>>'{snapshot,question_key}','sourceCode',j.payload#>>'{snapshot,source_code}'))))
        WITH ORDINALITY q(item,n)
      WHERE j.school_id=$1 AND j.identity_id=$2 AND j.kind IN ('run','submit') AND ${day}`;
    if (record) {
      const entry = (await db.query(`SELECT code FROM (${records}) history WHERE id=$5`, [...args,record])).rows[0];
      if (!entry) fail(404,'NOT_FOUND','Judging record not found.');
      return {status:200,body:entry};
    }
    const items = (await db.query(`SELECT id,created_at AS "createdAt",kind,title,activity,status,language,
      count(*) OVER ()::int AS total FROM (${records}) history ORDER BY created_at,id LIMIT $5 OFFSET $6`,
      [...args,pageSize,(page-1)*pageSize])).rows;
    return {status:200,body:{studentName:student.name,date,page,pageSize,total:items[0]?.total ?? 0,
      items:items.map(({total,...item})=>item)}};
  });
}
