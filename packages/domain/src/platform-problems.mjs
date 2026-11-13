import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { canEditPlatformContent, requirePlatformContentEditor } from './platform-content-access.mjs';
import { fail, uuid } from './security.mjs';

export async function handlePlatformProblems({pool,user,route,method,body,helpers}) {
 const match=route.match(/^\/platform\/source-problems(?:\/([^/]+)(?:\/(versions|publish))?)?$/);
 if(!match)return null;
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,LEGACY_SCHOOL_ID,{shared:method==='GET'});
  await activeAccount(db,user.id);
  const admin=await isPlatformAdministrator(db,user.id);
  if(!match[1]&&method==='GET'){
   const rows=(await db.query(`SELECT p.id,v.id AS "versionId",v.title,v.validation_status AS "validationStatus",
    v.published_at IS NOT NULL published FROM problems p JOIN LATERAL
    (SELECT * FROM problem_versions WHERE problem_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
    WHERE p.owner_scope='platform' AND p.archived_at IS NULL ORDER BY v.title,p.id`)).rows;
   const items=[];for(const row of rows)if(await canEditPlatformContent(db,user.id,'problem',row.id))items.push(row);
   return {status:200,body:{items,canManage:admin}};
  }
  const id=uuid(match[1]);
  if(!(await db.query("SELECT 1 FROM problems WHERE id=$1 AND owner_scope='platform' AND archived_at IS NULL",[id])).rowCount)fail(404,'NOT_FOUND','平台题目不存在');
  await requirePlatformContentEditor(db,user,'problem',id);
  const detail=async()=>({...await helpers.problemResult(db,user,id),canPublish:admin});
  if(method==='GET'&&!match[2])return {status:200,body:await detail()};
  if(method!=='POST')return null;
  const p=(await db.query('SELECT * FROM problems WHERE id=$1 FOR UPDATE',[id])).rows[0];
  const v=(await db.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id])).rows[0];
  if(body.expectedVersionId!==v.id)fail(409,'REVISION_CONFLICT','题目已更新，请重新载入');
  if(match[2]==='versions'){
   await helpers.insertVersion(db,user,id,helpers.problemInput({...body,bankId:p.bank_id}));
  }else if(match[2]==='publish'){
   if(!admin)fail(403,'PLATFORM_ADMIN_REQUIRED','仅平台管理员可发布题目');
   if(v.published_at)fail(409,'ALREADY_PUBLISHED','当前版本已发布');
   if(v.validation_status!=='AC')fail(409,'NOT_VALIDATED','参考解答须通过全部测试后才能发布');
   await db.query(`UPDATE problem_versions SET published_at=clock_timestamp(),school_visible_at=clock_timestamp(),
    rank_review_status='approved',rank_approved_at=clock_timestamp(),rank_reviewed_at=clock_timestamp(),rank_reviewed_by=$2 WHERE id=$1`,[v.id,user.id]);
   await db.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[id,v.id]);
  }else return null;
  await db.query('INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,$2,$3)',
   [user.id,`platform.problem.${match[2]}`,{problemId:id,previousVersionId:v.id}]);
  return {status:match[2]==='versions'?201:200,body:await detail()};
 });
}
