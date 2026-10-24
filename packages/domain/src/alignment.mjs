import { transaction } from './db.mjs';
import { cacheResult,restoreResult } from './member-import.mjs';
import { restoreIdentityBindings } from './library.mjs';
import { canonicalHash,fail, field, uuid, integer, enumValue, genderValue, tokenHash, safeEqual } from './security.mjs';
const admin=u=>{if(!u.roles.includes('admin'))fail(403,'FORBIDDEN','需要管理员权限');};
const staff=u=>{if(!u.roles.some(r=>['teacher','admin'].includes(r)))fail(403,'FORBIDDEN','需要教师权限');};
const row=r=>{if(!r.rowCount)fail(404,'NOT_FOUND','资源不存在');return r.rows[0];};
const respond=body=>({status:200,body});
const ids=(value,name='身份')=>{if(!Array.isArray(value)||value.length>500)fail(400,'VALIDATION',`${name}须为最多 500 项的数组`);return [...new Set(value.map(id=>uuid(id,name)))];};

export async function personDetails(db,id,{includeArchived=false}={}) {
 const p=row(await db.query(`SELECT i.*,a.id account_id,a.username,a.last_login_at,
  EXISTS(SELECT 1 FROM accounts history WHERE history.identity_id=i.id) has_account_history
  FROM identities i LEFT JOIN accounts a ON a.identity_id=i.id AND a.binding_released_at IS NULL WHERE i.id=$1 AND ($2 OR i.archived_at IS NULL)`,[id,includeArchived]));
 const classes=(await db.query(`SELECT DISTINCT c.id,c.name FROM classes c WHERE c.archived_at IS NULL AND (EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.identity_id=$1) OR EXISTS(SELECT 1 FROM identity_teacher_classes itc WHERE itc.class_id=c.id AND itc.identity_id=$1) OR EXISTS(SELECT 1 FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id WHERE tc.class_id=c.id AND a.identity_id=$1 AND a.binding_released_at IS NULL)) ORDER BY c.name`,[id])).rows;
 return {id:p.id,kind:p.kind,number:p.number,name:p.name,gender:p.gender??null,notes:p.notes,classes,activated:!!p.account_id,accountId:p.account_id||null,username:p.username||null,lastLoginAt:p.last_login_at||null,deletedAt:p.archived_at??null,canDelete:p.kind!=='admin'&&!p.has_account_history,deleteBlockedReason:p.kind==='admin'?'管理员身份不能删除':p.has_account_history?'此档案有账号历史，请编辑资料或停用账号；解除关联后也不能删除。':null};
}
async function setIdentityClasses(ctx,db,person,classIds) {
 const selected=ids(classIds,'班级');for(const id of selected)await ctx.helpers.classAccess(db,ctx.user,id);
 if(person.kind==='student'){
  await db.query('DELETE FROM class_members WHERE identity_id=$1',[person.id]);
  for(const classId of selected)await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,person.id]);
 }else if(person.kind==='teacher'){
  await db.query('DELETE FROM identity_teacher_classes WHERE identity_id=$1',[person.id]);
  for(const classId of selected)await db.query('INSERT INTO identity_teacher_classes(identity_id,class_id) VALUES($1,$2)',[person.id,classId]);
  await db.query('DELETE FROM teacher_classes WHERE account_id IN(SELECT id FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL)',[person.id]);
  await db.query(`INSERT INTO teacher_classes(class_id,account_id) SELECT itc.class_id,a.id FROM identity_teacher_classes itc JOIN accounts a ON a.identity_id=itc.identity_id JOIN account_roles ar ON ar.account_id=a.id AND ar.role='teacher' WHERE itc.identity_id=$1 AND a.binding_released_at IS NULL ON CONFLICT DO NOTHING`,[person.id]);
 }else if(selected.length)fail(400,'VALIDATION','管理员身份不能作为学生或教师加入班级');
}
export async function bindPendingTeacherClasses(db,identityId,accountId) {
 await db.query(`INSERT INTO teacher_classes(class_id,account_id) SELECT class_id,$2 FROM identity_teacher_classes WHERE identity_id=$1 ON CONFLICT DO NOTHING`,[identityId,accountId]);
}
export async function handlePeopleAlignment(ctx) {
 const {pool,user,route,method,body,url,helpers}=ctx;let m;
 if(route==='/accounts'&&method==='GET'){
  admin(user);const accounts=(await pool.query(`SELECT a.id,a.identity_id,a.username,a.original_username,a.disabled_at,a.binding_released_at,a.credentials_moved_to_account_id,a.last_login_at,i.kind,i.number,i.name,ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) roles,(a.binding_released_at IS NOT NULL AND a.credentials_moved_to_account_id IS NULL AND NOT EXISTS(SELECT 1 FROM accounts occupied WHERE occupied.username=COALESCE(a.original_username,a.username) AND occupied.id<>a.id)) can_link FROM accounts a JOIN identities i ON i.id=a.identity_id ORDER BY a.created_at DESC LIMIT 5000`)).rows;
  const items=[];for(const a of accounts){const p=await personDetails(pool,a.identity_id);items.push({id:a.id,identityId:a.identity_id,username:a.username,originalUsername:a.original_username||null,name:a.name,number:a.number,gender:p.gender,kind:a.kind,roles:a.roles,disabled:!!a.disabled_at,bindingReleased:!!a.binding_released_at,credentialsTransferred:!!a.credentials_moved_to_account_id,canLink:!!a.can_link,lastLoginAt:a.last_login_at,classes:p.classes});}return respond({items});
 }
 if(route==='/people'&&method==='GET'){
  staff(user);const deleted=url.searchParams.get('deleted')==='true';if(deleted)admin(user);
  const people=(await pool.query(`SELECT i.id FROM identities i WHERE (i.archived_at IS NOT NULL)=$4 AND ($1 OR i.id=$2 OR EXISTS(SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=i.id AND tc.account_id=$3 AND c.archived_at IS NULL)) ORDER BY i.kind,i.number LIMIT 5000`,[user.roles.includes('admin'),user.identityId,user.id,deleted])).rows;
  const items=[];for(const p of people)items.push(await personDetails(pool,p.id,{includeArchived:deleted}));return respond({items});
 }
 if(route==='/people'&&method==='POST'){
  admin(user);const kind=enumValue(body.kind,['student','teacher','admin'],'身份类型'),number=field(body.number,'编号'),name=field(body.name,'姓名'),gender=body.gender===undefined?null:genderValue(body.gender),notes=field(body.notes??'','备注',{min:0,max:4000});
  const result=await transaction(pool,async db=>{if((await db.query('SELECT 1 FROM identities WHERE kind=$1 AND number=$2 AND archived_at IS NOT NULL',[kind,number])).rowCount)fail(409,'IDENTITY_DELETED','该编号的档案已删除，请在“已删除”列表恢复后编辑。');const p=row(await db.query('INSERT INTO identities(kind,number,name,gender,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',[kind,number,name,gender,notes]));await setIdentityClasses(ctx,db,p,body.classIds??[]);await helpers.audit(db,user.id,'identity.create','identity',p.id);const issued=await helpers.issueActivation(db,user,p.id);return {...issued,person:await personDetails(db,p.id)};});return {status:201,body:result};
 }
 m=route.match(/^\/people\/([^/]+)$/);
 if(m&&method==='DELETE'){
  admin(user);const id=uuid(m[1]);
  const result=await transaction(pool,async db=>{
   const p=row(await db.query('SELECT * FROM identities WHERE id=$1 FOR UPDATE',[id]));
   if(p.kind==='admin')fail(409,'IDENTITY_PROTECTED','管理员身份不能删除');
   if((await db.query('SELECT 1 FROM accounts WHERE identity_id=$1',[id])).rowCount)fail(409,'IDENTITY_HAS_ACCOUNT','此档案有账号历史，请编辑资料或停用账号；解除关联后也不能删除。');
   if(body.number!==p.number||body.name!==p.name)fail(409,'IDENTITY_CHANGED','档案已变更，请刷新后重新确认删除。');
   if(!p.archived_at){
    await db.query('UPDATE identities SET archived_at=now() WHERE id=$1',[id]);
    await db.query('DELETE FROM activation_tokens WHERE identity_id=$1',[id]);
    await helpers.audit(db,user.id,'identity.delete','identity',id,{kind:p.kind,number:p.number,name:p.name,recoverable:true});
   }
   return {ok:true,deleted:true};
  });return respond(result);
 }
 const restore=route.match(/^\/people\/([^/]+)\/restore$/);
 if(restore&&method==='POST'){
  admin(user);const id=uuid(restore[1]);
  const person=await transaction(pool,async db=>{
   const p=row(await db.query('SELECT * FROM identities WHERE id=$1 FOR UPDATE',[id]));
   if(p.kind==='admin'||(await db.query('SELECT 1 FROM accounts WHERE identity_id=$1',[id])).rowCount)fail(409,'IDENTITY_PROTECTED','仅能恢复未激活的学生或教师档案');
   if(p.archived_at){await db.query('UPDATE identities SET archived_at=NULL WHERE id=$1',[id]);await helpers.audit(db,user.id,'identity.restore','identity',id);}
   return personDetails(db,id);
  });return respond(person);
 }
 if(m&&method==='PATCH'){
  admin(user);const person=await transaction(pool,async db=>{const p=row(await db.query('SELECT * FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[uuid(m[1])]));const name=body.name===undefined?p.name:field(body.name,'姓名'),number=body.number===undefined?p.number:field(body.number,'编号'),gender=body.gender===undefined?p.gender:genderValue(body.gender),notes=body.notes===undefined?p.notes:field(body.notes,'备注',{min:0,max:4000});await db.query('UPDATE identities SET name=$1,number=$2,gender=$3,notes=$4 WHERE id=$5',[name,number,gender,notes,p.id]);if(body.classIds!==undefined)await setIdentityClasses(ctx,db,p,body.classIds);await helpers.audit(db,user.id,'identity.update','identity',p.id);return personDetails(db,p.id);});return respond(person);
 }
 if(route==='/people/activation-batch'&&method==='POST'){
  admin(user);const selected=ids(body.identityIds);if(!selected.length)fail(400,'VALIDATION','请选择待激活身份');const result=await transaction(pool,async db=>{const items=[];for(const id of [...selected].sort()){const issued=await helpers.issueActivation(db,user,id);items.push({...issued,person:await personDetails(db,id)});}return {items};});return respond(result);
 }
 // Teachers may issue activation credentials only for their own unclaimed students.
 m=route.match(/^\/people\/([^/]+)\/activation$/);
 if(m&&method==='POST'&&!user.roles.includes('admin')){
  staff(user);const id=uuid(m[1]);if(!(await pool.query(`SELECT 1 FROM identities i JOIN class_members cm ON cm.identity_id=i.id JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes c ON c.id=cm.class_id WHERE i.id=$1 AND i.kind='student' AND i.archived_at IS NULL AND tc.account_id=$2 AND c.archived_at IS NULL`,[id,user.id])).rowCount)fail(403,'FORBIDDEN','只能为本人负责班级中的学生生成激活码');return respond(await transaction(pool,db=>helpers.issueActivation(db,user,id)));
 }
 m=route.match(/^\/people\/([^/]+)\/link$/);
 if(m&&method==='POST'){
  admin(user);const targetId=uuid(m[1]),accountId=uuid(body.accountId),reason=field(body.reason,'关联原因',{max:2000});
  await transaction(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(798944)');
   const target=row(await db.query('SELECT * FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[targetId]));
   if((await db.query('SELECT 1 FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL',[targetId])).rowCount)fail(409,'ACTIVATED','目标身份已有绑定账号');
   const source=row(await db.query('SELECT a.*,i.kind FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.id=$1 FOR UPDATE OF a',[accountId]));
   if(source.kind!==target.kind)fail(409,'IDENTITY_KIND_MISMATCH','只能关联同类型身份的账号');
   if(!source.binding_released_at)fail(409,'ACCOUNT_BOUND','该账号已有绑定身份，请先在原身份详情中明确解绑');
   if(source.credentials_moved_to_account_id)fail(409,'CREDENTIALS_TRANSFERRED','该历史账号的登录凭据已转移，请选择尚未转移的账号或使用激活码认领');
   const login=source.original_username||source.username;
   if((await db.query('SELECT 1 FROM accounts WHERE username=$1 AND id<>$2',[login,source.id])).rowCount)fail(409,'USERNAME_IN_USE','原用户名已被其他账号使用，请使用激活码认领新账号');
   await db.query('DELETE FROM sessions WHERE account_id=$1',[source.id]);
   await db.query('DELETE FROM reset_tokens WHERE account_id=$1',[source.id]);
   let linkedAccountId=source.id;
   const moving=source.identity_id!==targetId;
   if(moving){
    if(!['student','teacher'].includes(target.kind))fail(409,'ADMIN_TRANSFER','管理员账号不能跨身份转移');
    await db.query('UPDATE accounts SET username=$1,original_username=$2,disabled_at=COALESCE(disabled_at,now()) WHERE id=$3',[`__released__${source.id}`,login,source.id]);
    linkedAccountId=row(await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[targetId,login,source.password_hash])).id;
    await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[linkedAccountId,target.kind]);
    await db.query('UPDATE accounts SET credentials_moved_to_account_id=$1 WHERE id=$2',[linkedAccountId,source.id]);
   }else{
    await db.query('UPDATE accounts SET username=$1,binding_released_at=NULL,disabled_at=NULL WHERE id=$2',[login,source.id]);
   }
   const previousAccountId=await restoreIdentityBindings(db,targetId,linkedAccountId,{restoreRoles:!moving,restoreEmail:!moving});
   if(target.kind==='teacher')await bindPendingTeacherClasses(db,targetId,linkedAccountId);
   await db.query('DELETE FROM activation_tokens WHERE identity_id=$1',[targetId]);
   await helpers.audit(db,user.id,'identity.account_link','identity',targetId,{previousIdentityId:source.identity_id,accountId:linkedAccountId,sourceAccountId:source.id,previousAccountId,reason});
  });return respond(await personDetails(pool,targetId));
 }
 if(route==='/people/import'&&method==='POST'){
  admin(user);if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>5000)fail(400,'VALIDATION','身份导入须包含 1–5000 行');
  const destination=body.classId?uuid(body.classId):null,readClassNames=body.readClassNames===true||body.classNameColumn===true||body.useRowClassNames===true;
  const key=body.idempotencyKey?uuid(body.idempotencyKey):null,requestHash=canonicalHash({rows:body.rows,destination,readClassNames}),cacheContext=`identity-import:${user.id}:${key}`;
  const output=await transaction(pool,async db=>{if(key){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[cacheContext]);const previous=(await db.query('SELECT *,replay_expires_at>now() replay_available FROM identity_import_batches WHERE account_id=$1 AND idempotency_key=$2',[user.id,key])).rows[0];if(previous){if(previous.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','相同导入请求键对应不同内容');if(!previous.replay_available)return previous.nonsecret_result;return restoreResult(previous.result_ciphertext,ctx.config.secret,cacheContext,previous.nonsecret_result);}}if(destination)await helpers.classAccess(db,user,destination);const items=[],summary={created:0,skipped:0,failed:0,total:body.rows.length};for(let index=0;index<body.rows.length;index++){await db.query('SAVEPOINT aligned_import_row');try{const e=body.rows[index],kind=enumValue(e?.kind,['student','teacher'],'身份类型'),number=field(e.number,'编号'),name=field(e.name,'姓名'),gender=e.gender===undefined||e.gender===''?null:genderValue(e.gender);let p=(await db.query('INSERT INTO identities(kind,number,name,gender,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,number) DO NOTHING RETURNING *',[kind,number,name,gender,field(e.notes??'','备注',{min:0,max:4000})])).rows[0],created=!!p;if(!p){p=row(await db.query('SELECT * FROM identities WHERE kind=$1 AND number=$2 FOR UPDATE',[kind,number]));if(p.archived_at||p.name!==name||(gender!==null&&p.gender!==gender))fail(409,'IMPORT_CONFLICT','编号已存在且身份资料不同或已归档，须人工核对');}let classId=destination;if(readClassNames&&e.className){const name=field(e.className,'班级名称');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`class-name:${name}`]);const old=(await db.query('SELECT id FROM classes WHERE name=$1 AND archived_at IS NULL',[name])).rows[0];classId=old?.id||(await db.query("INSERT INTO classes(name,type,owner_account_id) VALUES($1,'administrative',$2) RETURNING id",[name,user.id])).rows[0].id;}if(classId){if(kind==='student')await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[classId,p.id]);else{await db.query('INSERT INTO identity_teacher_classes(identity_id,class_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.id,classId]);const account=(await db.query('SELECT id FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL',[p.id])).rows[0];if(account)await bindPendingTeacherClasses(db,p.id,account.id);}}const issued=created?await helpers.issueActivation(db,user,p.id):null,status=created?'created':'skipped';items.push({line:index+1,status,person:await personDetails(db,p.id),...(issued?{activationCode:issued.activationCode}:{}),...(created?{}:{message:'保留现有身份、账号与激活状态'})});summary[status]++;await db.query('RELEASE SAVEPOINT aligned_import_row');}catch(error){await db.query('ROLLBACK TO SAVEPOINT aligned_import_row');await db.query('RELEASE SAVEPOINT aligned_import_row');items.push({line:index+1,status:'failed',message:error.status?error.message:'该行数据无效'});summary.failed++;}}await helpers.audit(db,user.id,'identity.import','identity','batch',summary);const result={items,summary};if(key){const nonsecret={items:items.map(({activationCode,...item})=>({...item,...(activationCode?{activationUnavailable:true}:{})})),summary};await db.query("INSERT INTO identity_import_batches(account_id,idempotency_key,request_hash,nonsecret_result,result_ciphertext,replay_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes')",[user.id,key,requestHash,nonsecret,cacheResult(result,ctx.config.secret,cacheContext)]);}return result;});return respond(output);
 }
 return null;
}
export async function handleFavorites(ctx){
 const {pool,user,route,method,body,helpers}=ctx;
 if(route==='/problem-favorites'&&method==='GET')return respond({items:(await pool.query('SELECT problem_id FROM problem_favorites WHERE identity_id=$1 ORDER BY created_at DESC',[user.identityId])).rows.map(p=>p.problem_id)});
 const m=route.match(/^\/problem-favorites\/([^/]+)$/);if(!m||method!=='PUT')return null;
 const id=uuid(m[1]);if(typeof body.favorite!=='boolean')fail(400,'VALIDATION','收藏状态无效');await helpers.versionAccess(pool,user,id);
 if(body.favorite)await pool.query('INSERT INTO problem_favorites(identity_id,problem_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.identityId,id]);else await pool.query('DELETE FROM problem_favorites WHERE identity_id=$1 AND problem_id=$2',[user.identityId,id]);return respond({problemId:id,favorite:body.favorite});
}
