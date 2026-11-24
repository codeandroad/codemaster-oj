import { listPracticeGroups, schoolProblemGroups } from './school-problem-groups.mjs';
import { transaction } from './db.mjs';
import { lockPlatformContent } from './platform-content-access.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { lockSchoolTeaching, schoolRole } from './schools.mjs';
import { canonicalHash, fail, field, uuid } from './security.mjs';

export async function handleWorkspaceCatalog({pool,user,route,method,url,body={}}) {
 const match=route.match(/^\/(?:schools\/([^/]+)|platform)\/(problem-groups|import-history)(?:\/([^/]+))?(\/move)?$/);
 if(!match)return null;
 const schoolId=match[1]?uuid(match[1]):null;
 const [, ,section,groupParam,move]=match;
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
  if(schoolId)return schoolProblemGroups(db,{schoolId,userId:user.id,role,groupId,move,method,body,url});
  const items=await listPracticeGroups(db,scope,user.id,true,{groupId});
  if(method==='GET')return {status:200,body:groupId?items[0]:{items}};
  if(method!=='PATCH'||!groupId)return null;
  const group=items[0];
  if(body.expectedRevision!==group.revision)fail(409,'REVISION_CONFLICT','题组已更新，请刷新');
  const name=body.name===undefined?group.name:field(body.name,'题组名称',{max:200});
  if(body.problemIds!==undefined){
   if(!Array.isArray(body.problemIds)||body.problemIds.length>2000)fail(400,'VALIDATION','题目列表无效');
   const ids=body.problemIds.map(id=>uuid(id).toLowerCase());
   if(new Set(ids).size!==ids.length)fail(400,'VALIDATION','题目重复');
   const valid=await db.query("SELECT id FROM problems WHERE owner_scope='platform' AND id=ANY($1)",[ids]);
   if(valid.rowCount!==ids.length)fail(404,'NOT_FOUND','题目不在可用题库中');
   await db.query('DELETE FROM practice_problem_group_members WHERE scope_id=$1 AND group_id=$2',[scope,groupId]);
   await db.query(`INSERT INTO practice_problem_group_members(scope_id,group_id,problem_id,position)
    SELECT $1,$2,id,position FROM unnest($3::uuid[]) WITH ORDINALITY p(id,position)`,[scope,groupId,ids]);
   group.problemIds=ids;
  }
  await db.query('UPDATE practice_problem_groups SET name=$3 WHERE scope_id=$1 AND id=$2',[scope,groupId,name]);
  await db.query("INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,'platform.problem_group.update',$2)",[user.id,{groupId}]);
  const updated={id:groupId,name,bankId:group.bankId,problemIds:group.problemIds};
  return {status:200,body:{...updated,revision:canonicalHash(updated)}};
 });
}
