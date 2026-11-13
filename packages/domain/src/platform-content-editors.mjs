import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { staffSchoolSql } from './platform-content-access.mjs';
import { fail, field, uuid } from './security.mjs';

function resourceIds(raw) {
 if(!Array.isArray(raw)||!raw.length||raw.length>200)fail(400,'VALIDATION','请选择 1 至 200 项平台内容');
 return [...new Set(raw.map(id=>uuid(id).toLowerCase()))];
}
async function editorList(db,kind,ids) {
 const people=`e.account_id AS "accountId",e.school_id AS "schoolId",a.username,i.name,s.name AS "schoolName",
  (a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL AND ${staffSchoolSql('e.account_id','e.school_id')}) active`;
 const joins='JOIN accounts a ON a.id=e.account_id JOIN identities i ON i.id=a.identity_id JOIN schools s ON s.id=e.school_id';
 const direct=(await db.query(`SELECT ${people},e.resource_id AS "resourceId" FROM platform_content_editors e ${joins}
  WHERE e.resource_kind=$1 AND e.resource_id=ANY($2::uuid[]) AND e.revoked_at IS NULL ORDER BY s.name,a.username`,[kind,ids])).rows;
 const inherited=kind==='problem'?(await db.query(`SELECT DISTINCT ${people},cp.problem_id AS "resourceId",c.id AS "courseId",c.title AS "courseTitle"
  FROM platform_content_editors e ${joins} JOIN learning_paths c ON c.id=e.resource_id AND c.owner_scope='platform' AND c.archived_at IS NULL
  JOIN learning_chapters ch ON ch.path_id=c.id AND ch.archived_at IS NULL JOIN chapter_problems cp ON cp.chapter_id=ch.id
  JOIN problems p ON p.id=cp.problem_id AND p.owner_scope='platform' AND p.archived_at IS NULL
  WHERE e.resource_kind='course' AND e.revoked_at IS NULL AND cp.problem_id=ANY($1::uuid[]) ORDER BY s.name,a.username`,[ids])).rows:[];
 const items=new Map();
 for(const row of [...direct,...inherited]){
  const key=`${row.accountId}:${row.schoolId}`;
  if(!items.has(key))items.set(key,{accountId:row.accountId,schoolId:row.schoolId,username:row.username,name:row.name,schoolName:row.schoolName,active:row.active,resourceIds:[],inheritedResources:[]});
  const item=items.get(key);
  if(row.courseId)item.inheritedResources.push({resourceId:row.resourceId,courseId:row.courseId,courseTitle:row.courseTitle});
  else item.resourceIds.push(row.resourceId);
 }
 return {items:[...items.values()],resourceIds:ids};
}
export async function handlePlatformContentEditors({pool,user,route,method,body={},url}) {
 const match=route.match(/^\/platform\/content-editors\/(course|problem)\/([^/]+)$/);
 if(!match&&!['/platform/content-editor-candidates','/platform/content-access'].includes(route))return null;
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,LEGACY_SCHOOL_ID,{shared:method==='GET'});
  await activeAccount(db,user.id);
  if(route==='/platform/content-access'&&method==='GET')return {status:200,body:{canEdit:await isPlatformAdministrator(db,user.id)||(await db.query(`SELECT 1 FROM platform_content_editors e
   WHERE e.account_id=$1 AND e.revoked_at IS NULL AND ${staffSchoolSql('e.account_id','e.school_id')} LIMIT 1`,[user.id])).rowCount>0}};
  if(!await isPlatformAdministrator(db,user.id))fail(403,'PLATFORM_ADMIN_REQUIRED','需要平台管理员权限');
  if(!match&&method==='GET'){
   const q=field(url.searchParams.get('q')??'','搜索',{min:0,max:100});
   if(q.trim().length<2)return {status:200,body:{items:[]}};
   const items=(await db.query(`SELECT a.id AS "accountId",a.username,i.name,s.id AS "schoolId",s.name AS "schoolName"
    FROM accounts a JOIN identities i ON i.id=a.identity_id CROSS JOIN schools s
    WHERE a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
    AND ${staffSchoolSql('a.id','s.id')} AND (strpos(lower(a.username),lower($1))>0 OR strpos(lower(i.name),lower($1))>0)
    ORDER BY s.name,a.username LIMIT 30`,[q.trim()])).rows;
   return {status:200,body:{items}};
  }
  if(!match)return null;
  const [,kind,rawId]=match,batch=rawId==='batch',ids=batch?resourceIds(method==='GET'?url.searchParams.get('resourceIds')?.split(','):body.resourceIds):[uuid(rawId).toLowerCase()];
  const table=kind==='course'?'learning_paths':'problems';
  if((await db.query(`SELECT id FROM ${table} WHERE id=ANY($1::uuid[]) AND owner_scope='platform' FOR SHARE`,[ids])).rowCount!==ids.length)
   fail(404,'NOT_FOUND','所选平台内容不存在');
  if(method==='POST'||method==='DELETE'){
   const accountId=uuid(body.accountId),schoolId=uuid(body.schoolId);
   if(method==='POST'){
    await activeAccount(db,accountId);
    if(!(await db.query(`SELECT 1 WHERE ${staffSchoolSql('$1::uuid','$2::uuid')}`,[accountId,schoolId])).rowCount)
     fail(400,'INVALID_CONTENT_EDITOR','请选择该学校的有效管理员或老师');
    await db.query(`INSERT INTO platform_content_editors(resource_kind,resource_id,account_id,school_id,granted_by)
     SELECT $1,unnest($2::uuid[]),$3,$4,$5 ON CONFLICT(resource_kind,resource_id,account_id,school_id) DO UPDATE
     SET granted_by=EXCLUDED.granted_by,granted_at=clock_timestamp(),revoked_at=NULL`,[kind,ids,accountId,schoolId,user.id]);
   }else await db.query(`UPDATE platform_content_editors SET revoked_at=clock_timestamp()
    WHERE resource_kind=$1 AND resource_id=ANY($2::uuid[]) AND account_id=$3 AND school_id=$4 AND revoked_at IS NULL`,[kind,ids,accountId,schoolId]);
   await db.query(`INSERT INTO platform_audit_events(actor_account_id,action,school_id,target_account_id,detail)
    VALUES($1,$2,$3,$4,$5)`,[user.id,method==='POST'?'platform.content.editor_granted':'platform.content.editor_revoked',schoolId,accountId,
     {resourceKind:kind,...(batch?{resourceIds:ids}:{resourceId:ids[0]})}]);
  }else if(method!=='GET')return null;
  return {status:200,body:await editorList(db,kind,ids)};
 });
}
