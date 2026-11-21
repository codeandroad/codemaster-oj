import { transaction } from './db.mjs';
import { platformProblemCatalogRows } from './legacy-public-problems.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { enumValue, fail, field, uuid } from './security.mjs';

export const matchingProblemAudienceSql = account => `(
 audience.account_id=${account} OR audience.school_id IN (
  SELECT school_id FROM school_memberships WHERE account_id=${account} AND role='student' AND revoked_at IS NULL
  UNION
  SELECT ownership.school_id FROM legacy_school_account_ownership ownership
  JOIN account_roles role ON role.account_id=ownership.account_id AND role.role='student'
  WHERE ownership.account_id=${account}
 ))`;

const active = 'a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL';
const targetsSql = `SELECT 'school'::text kind,s.id,s.name,s.slug AS handle,true AS active FROM schools s
 UNION ALL SELECT 'account',a.id,i.name,a.username,(${active}) FROM accounts a JOIN identities i ON i.id=a.identity_id`;
const normalId = value => uuid(value).toLowerCase();

function problemIds(values) {
 if(!Array.isArray(values)||values.length<1||values.length>200)fail(400,'VALIDATION','请选择 1–200 道平台题目');
 return [...new Set(values.map(normalId))].sort();
}

export async function handlePlatformProblemAudiences({pool,user,route,url,method,body}) {
 const search = route==='/platform/problem-audience-targets' && method==='GET';
 if(!search && (route!=='/platform/problem-audiences'||!['GET','POST'].includes(method)))return null;
 return transaction(pool,async db=>{
  await activeAccount(db,user.id);
  if(!await isPlatformAdministrator(db,user.id))fail(403,'PLATFORM_ADMIN_REQUIRED','需要平台管理员权限');
  if(search){
   const kind=enumValue(url.searchParams.get('kind'),['school','account'],'开放对象');
   const query=field(url.searchParams.get('q')??'','搜索',{min:0,max:100});
   const {rows}=await db.query(`SELECT * FROM (${targetsSql}) target WHERE kind=$1 AND active
    AND ($2='' OR strpos(lower(name||' '||handle),lower($2))>0) ORDER BY name,id LIMIT 25`,[kind,query]);
   return {status:200,body:{items:rows}};
  }
  const ids=problemIds(method==='GET'?url.searchParams.get('problemIds')?.split(','):body.problemIds);
  if(method==='GET'){
   const {rows}=await db.query(`SELECT target.*,count(*)::int count
    FROM platform_problem_audiences audience JOIN (${targetsSql}) target ON
      (target.kind='school' AND target.id=audience.school_id OR target.kind='account' AND target.id=audience.account_id)
    WHERE audience.problem_id=ANY($1::uuid[]) GROUP BY target.kind,target.id,target.name,target.handle,target.active
    ORDER BY target.kind,target.name,target.id`,[ids]);
   return {status:200,body:{items:rows}};
  }
  const operation=enumValue(body.operation,['grant','revoke'],'操作');
  if(!Array.isArray(body.targets)||!body.targets.length||body.targets.length>50)fail(400,'VALIDATION','请选择 1–50 个开放对象');
  const targets=[...new Map(body.targets.map(target=>{
   const kind=enumValue(target?.kind,['school','account'],'开放对象'),id=normalId(target?.id);
   return [`${kind}:${id}`,{kind,id}];
  })).values()];
  await lockSchoolTeaching(db,LEGACY_SCHOOL_ID);
  await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);
  if(operation==='grant'){
   if((await platformProblemCatalogRows(db,ids)).length!==ids.length)
    fail(409,'PROBLEM_UNAVAILABLE','请先发布并验证所选平台题目');
   const {rowCount}=await db.query(`SELECT 1 FROM (${targetsSql}) target WHERE active AND EXISTS(
    SELECT 1 FROM jsonb_to_recordset($1::jsonb) requested(kind text,id uuid)
    WHERE requested.kind=target.kind AND requested.id=target.id)`,[JSON.stringify(targets)]);
   if(rowCount!==targets.length)fail(409,'AUDIENCE_UNAVAILABLE','有开放对象已失效，请重新选择');
   await db.query(`INSERT INTO platform_problem_audiences(problem_id,school_id,account_id)
    SELECT problem_id,CASE WHEN kind='school' THEN id END,CASE WHEN kind='account' THEN id END
    FROM unnest($1::uuid[]) AS problems(problem_id) CROSS JOIN jsonb_to_recordset($2::jsonb) AS targets(kind text,id uuid)
    ON CONFLICT DO NOTHING`,[ids,JSON.stringify(targets)]);
  }else{
   await db.query(`DELETE FROM platform_problem_audiences audience USING jsonb_to_recordset($2::jsonb) target(kind text,id uuid)
    WHERE audience.problem_id=ANY($1::uuid[])
     AND (target.kind='school' AND audience.school_id=target.id OR target.kind='account' AND audience.account_id=target.id)`,[ids,JSON.stringify(targets)]);
  }
  await db.query('INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,$2,$3)',
   [user.id,`platform.problem.audience.${operation}`,{problemIds:ids,targets}]);
  return {status:200,body:{ok:true}};
 });
}
