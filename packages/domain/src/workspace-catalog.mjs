import { transaction } from './db.mjs';
import { lockPlatformContent } from './platform-content-access.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { auditSchool, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { canonicalHash, fail, field, uuid } from './security.mjs';

export async function handleWorkspaceCatalog({pool,user,route,method,body={}}) {
 const match=route.match(/^\/(?:schools\/([^/]+)|platform)\/(problem-groups|import-history)(?:\/([^/]+))?$/);
 if(!match)return null;
 const schoolId=match[1]?uuid(match[1]):null;
 const [, ,section,groupParam]=match;
 return transaction(pool,async db=>{
  let role;
  if(schoolId){
   await lockSchoolTeaching(db,schoolId,{shared:method==='GET'});
   role=await schoolRole(db,schoolId,user.id);
   if(role==='student')fail(403,'FORBIDDEN','题组管理和导入记录仅对教职员开放');
  }else{
   await lockPlatformContent(db,{shared:method==='GET'});
   if(!await isPlatformAdministrator(db,user.id))fail(403,'FORBIDDEN','需要平台管理员权限');
  }
  const scope=schoolId??(await db.query('SELECT id FROM practice_storage_scopes WHERE school_id IS NULL')).rows[0].id;
  await db.query("SELECT set_config('campus.school_id',$1,true)",[scope]);
  if(section==='import-history'){
   if(!schoolId||method!=='GET'||groupParam)return null;
   const {rows}=await db.query(`SELECT id,kind,created_at AS "createdAt",filename FROM (
    SELECT id,kind,created_at,filename,actor_account_id FROM school_import_history WHERE school_id=$1
    UNION ALL SELECT id,'identities',created_at,NULL,actor_account_id FROM school_identity_imports WHERE school_id=$1
    ) imports WHERE $2::boolean OR actor_account_id=$3 ORDER BY created_at DESC,id`,[schoolId,role==='school_admin',user.id]);
   return {status:200,body:{items:rows}};
  }
  const groupId=groupParam?uuid(groupParam):null;
  const {rows}=await db.query(`SELECT g.id,g.name,g.bank_id AS "bankId",g.owner_account_id,
   COALESCE((SELECT array_agg(m.problem_id ORDER BY m.position,m.problem_id) FROM practice_problem_group_members m
    WHERE (m.scope_id,m.group_id)=(g.scope_id,g.id)),'{}') AS "problemIds"
   FROM practice_problem_groups g WHERE g.scope_id=$1 AND g.archived_at IS NULL AND ($2::uuid IS NULL OR g.id=$2)
   AND ($3::boolean OR g.owner_account_id=$4) ORDER BY g.name,g.id`,
   [scope,groupId,!schoolId||role==='school_admin',user.id]);
  if(groupId&&!rows.length)fail(404,'NOT_FOUND','题组不存在');
  const items=rows.map(({owner_account_id,...group})=>({...group,revision:canonicalHash(group)}));
  if(method==='GET')return {status:200,body:groupId?items[0]:{items}};
  if(method!=='PATCH'||!groupId)return null;
  const group=items[0];
  if(body.expectedRevision!==group.revision)fail(409,'REVISION_CONFLICT','题组已更新，请刷新');
  const name=body.name===undefined?group.name:field(body.name,'题组名称',{max:200});
  if(body.problemIds!==undefined){
   if(!Array.isArray(body.problemIds)||body.problemIds.length>2000)fail(400,'VALIDATION','题目列表无效');
   const ids=body.problemIds.map(id=>uuid(id).toLowerCase());
   if(new Set(ids).size!==ids.length)fail(400,'VALIDATION','题目重复');
   const sql=schoolId?`SELECT p.id FROM school_problems p JOIN school_problem_banks b ON (b.school_id,b.id)=(p.school_id,p.bank_id)
    WHERE b.resource_kind='ordinary' AND p.school_id=$2 AND p.id=ANY($1) AND (p.published OR p.owner_account_id=$3 OR $4::boolean)`
    :"SELECT id FROM problems WHERE owner_scope='platform' AND id=ANY($1)";
   const valid=await db.query(sql,schoolId?[ids,schoolId,user.id,role==='school_admin']:[ids]);
   if(valid.rowCount!==ids.length)fail(404,'NOT_FOUND','题目不在可用题库中');
   await db.query('DELETE FROM practice_problem_group_members WHERE scope_id=$1 AND group_id=$2',[scope,groupId]);
   await db.query(`INSERT INTO practice_problem_group_members(scope_id,group_id,problem_id,position)
    SELECT $1,$2,id,position FROM unnest($3::uuid[]) WITH ORDINALITY p(id,position)`,[scope,groupId,ids]);
   group.problemIds=ids;
  }
  await db.query('UPDATE practice_problem_groups SET name=$3 WHERE scope_id=$1 AND id=$2',[scope,groupId,name]);
  if(schoolId)await auditSchool(db,scope,user.id,'school.problem_group.update',groupId);
  else await db.query("INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,'platform.problem_group.update',$2)",[user.id,{groupId}]);
  const updated={id:groupId,name,bankId:group.bankId,problemIds:group.problemIds};
  return {status:200,body:{...updated,revision:canonicalHash(updated)}};
 });
}
