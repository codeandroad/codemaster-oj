import {moveGroupMembers} from './group-move.mjs';
import { assertJudgeAdmission } from './system.mjs';
import { transaction } from './db.mjs';
import { fail, field, uuid, enumValue, canonicalHash } from './security.mjs';

export async function canReviewActivitySubmission(db,user,submission){
 if(user.roles.includes('admin'))return true;
 if(!user.roles.includes('teacher'))return false;
 return !!(await db.query(`SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id WHERE tc.account_id=$1 AND c.archived_at IS NULL AND (EXISTS(SELECT 1 FROM assignments a WHERE a.id=$2 AND a.class_id=c.id) OR EXISTS(SELECT 1 FROM timed_attempts ta JOIN timed_practices p ON p.id=ta.practice_id WHERE ta.id=$3 AND p.class_id=c.id))`,[user.id,submission.assignment_id,submission.timed_attempt_id])).rowCount;
}
export const SCHOOL_BANK='00000000-0000-4000-8000-000000000001';
const isAdmin=user=>user.roles.includes('admin');
const isStaff=user=>isAdmin(user)||user.roles.includes('teacher');
const required=(result)=>{if(!result.rowCount)fail(404,'NOT_FOUND','题库或分组不存在');return result.rows[0];};
export async function bankAccess(db,user,id) {
 const bank=required(await db.query('SELECT * FROM problem_banks WHERE id=$1 AND archived_at IS NULL',[uuid(id,'题库 ID')]));
 const owner=isAdmin(user)||(isStaff(user)&&bank.owner_account_id===user.id);
 const granted=(await db.query('SELECT permission FROM bank_permissions WHERE bank_id=$1 AND account_id=$2',[id,user.id])).rows[0]?.permission;
 const canEdit=owner||(isStaff(user)&&granted==='edit');
 const canRead=owner||(isStaff(user)&&['read','edit'].includes(granted));
 const canContribute=canEdit||(bank.is_system&&isStaff(user));
 const permission=owner?'owner':canEdit?'edit':canRead?'read':canContribute?'contribute':bank.visibility==='school'?'published':null;
 if(!permission)fail(403,'FORBIDDEN','无权访问该题库');
 return {bank,owner,canRead,canEdit,canContribute,permission};
}
export async function problemPermissions(db,user,problem,version) {
 const own=isAdmin(user)||(isStaff(user)&&problem.owner_account_id===user.id);
 const bank=(await db.query('SELECT * FROM problem_banks WHERE id=$1',[problem.bank_id])).rows[0];
 if(!bank)return {canRead:false,canEdit:false};
 const grant=(await db.query('SELECT permission FROM bank_permissions WHERE bank_id=$1 AND account_id=$2',[bank.id,user.id])).rows[0]?.permission;
 const bankOwner=isStaff(user)&&bank.owner_account_id===user.id;
 const staffRead=isStaff(user)&&(bankOwner||['read','edit'].includes(grant));
 const canEdit=!problem.archived_at&&(own||(isStaff(user)&&(bankOwner||grant==='edit')));
 const schoolRead=!!version.published_at&&!!version.school_visible_at&&bank.visibility==='school'&&!bank.archived_at&&!problem.archived_at;
 if(own||(!bank.archived_at&&staffRead)||schoolRead)return {canRead:true,canEdit:canEdit&&!bank.archived_at,canRunFree:true};
 // A teacher who currently manages the class can still inspect the exact
 // selected version after private-bank access changes, including in a draft.
 // This does not grant access to other versions or authoring-only material.
 const assignmentTeacherRead=user.roles.includes('teacher')&&!!version.published_at&&!!(await db.query(`
  SELECT 1 FROM assignment_problems ap
  JOIN assignments a ON a.id=ap.assignment_id
  JOIN classes c ON c.id=a.class_id AND c.archived_at IS NULL
  JOIN teacher_classes tc ON tc.class_id=c.id AND tc.account_id=$2
  WHERE ap.problem_id=$1 AND ap.version_id=$3 LIMIT 1`,[problem.id,user.id,version.id])).rowCount;
 const assignmentRead=user.roles.includes('student')&&!!version.published_at&&!!(await db.query('SELECT 1 FROM assignment_problems ap JOIN assignments assignment ON assignment.id=ap.assignment_id AND assignment.state=\'Published\' JOIN assignment_participants part ON part.assignment_id=ap.assignment_id WHERE ap.version_id=$1 AND part.identity_id=$2 AND NOT part.exempt LIMIT 1',[version.id,user.identityId])).rowCount;
 let timedRead=false,timedReleased=false;
 if(user.roles.includes('student')&&version.published_at&&(await db.query("SELECT to_regclass('timed_practice_problems') existing")).rows[0].existing) {
  const permitted=(await db.query("SELECT practice.results_published_at FROM timed_practice_problems tp JOIN timed_practices practice ON practice.id=tp.practice_id JOIN timed_practice_participants part ON part.practice_id=tp.practice_id LEFT JOIN timed_attempts attempt ON attempt.practice_id=tp.practice_id AND attempt.identity_id=part.identity_id WHERE tp.version_id=$1 AND part.identity_id=$2 AND NOT part.exempt AND (practice.results_published_at IS NOT NULL OR attempt.id IS NOT NULL) ORDER BY practice.results_published_at DESC NULLS LAST LIMIT 1",[version.id,user.identityId])).rows[0];timedRead=!!permitted;timedReleased=!!permitted?.results_published_at;
 }
 return {canRead:own||(!bank.archived_at&&staffRead)||schoolRead||assignmentTeacherRead||assignmentRead||timedRead,canEdit:canEdit&&!bank.archived_at,canRunFree:assignmentRead||timedReleased};
}

export async function restoreIdentityBindings(db,identityId,newAccountId,{restoreRoles=true,restoreEmail=true}={}) {
 const released=(await db.query('SELECT id,email FROM accounts WHERE identity_id=$1 AND id<>$2 AND binding_released_at IS NOT NULL ORDER BY binding_released_at DESC,id DESC',[identityId,newAccountId])).rows;
 const previous=released[0];
 if(!previous)return null;
 const releasedIds=released.map(account=>account.id);
 if(restoreEmail&&previous.email)await db.query('UPDATE accounts SET email=$1 WHERE id=$2',[previous.email,newAccountId]);
 if(restoreRoles)await db.query('INSERT INTO account_roles(account_id,role) SELECT $1,role FROM account_roles WHERE account_id=$2 ON CONFLICT DO NOTHING',[newAccountId,previous.id]);
 for(const table of ['problem_banks','problems','problem_groups','classes','assignments','learning_paths','learning_resources','timed_practices']) {
  const exists=(await db.query('SELECT to_regclass($1) existing',[table])).rows[0].existing;
  if(exists)await db.query(`UPDATE ${table} SET owner_account_id=$1 WHERE owner_account_id=ANY($2::uuid[])`,[newAccountId,releasedIds]);
 }
 await db.query('INSERT INTO teacher_classes(class_id,account_id) SELECT DISTINCT class_id,$1::uuid FROM teacher_classes WHERE account_id=ANY($2::uuid[]) ON CONFLICT DO NOTHING',[newAccountId,releasedIds]);
 await db.query('DELETE FROM teacher_classes WHERE account_id=ANY($1::uuid[])',[releasedIds]);
 await db.query("INSERT INTO bank_permissions(bank_id,account_id,permission) SELECT bank_id,$1::uuid,CASE WHEN bool_or(permission='edit') THEN 'edit' ELSE 'read' END FROM bank_permissions WHERE account_id=ANY($2::uuid[]) GROUP BY bank_id ON CONFLICT(bank_id,account_id) DO UPDATE SET permission=CASE WHEN bank_permissions.permission='edit' OR EXCLUDED.permission='edit' THEN 'edit' ELSE 'read' END",[newAccountId,releasedIds]);
 await db.query('DELETE FROM bank_permissions WHERE account_id=ANY($1::uuid[])',[releasedIds]);return previous.id;
}

export async function handleLibrary({pool,user,route,method,body,url,helpers}) {
 const {audit,versionAccess,submissionAccess}=helpers;
 const result=body=>({status:200,body});
 const bankShape=a=>({id:a.bank.id,name:a.bank.name,description:a.bank.description,course:a.bank.course,updatedAt:a.bank.updated_at,createdAt:a.bank.created_at,problemCount:a.bank.problemCount??0,visibility:a.bank.visibility,permission:a.permission,canEdit:a.canEdit,canContribute:a.canContribute,isSystem:a.bank.is_system});
 const reviewShape=r=>({problemId:r.problem_id,versionId:r.version_id,title:r.title,bankId:r.bank_id,bankName:r.bank_name,bankVisibility:r.bank_visibility,ownerName:r.owner_name,publishedAt:r.published_at,schoolVisibleAt:r.school_visible_at,rankReviewStatus:r.rank_review_status,rankApprovedAt:r.rank_approved_at,rankReviewReason:r.rank_review_reason,priorAcCount:Number(r.prior_ac_count),isCurrent:r.is_current});
 if(route==='/problems/rank-review'&&method==='GET'){
  if(!isAdmin(user))fail(403,'FORBIDDEN','仅管理员可审核校内公开题');
  const rows=(await pool.query(`SELECT p.id problem_id,v.id version_id,v.title,b.id bank_id,b.name bank_name,
    b.visibility bank_visibility,COALESCE(i.name,'管理员') owner_name,v.published_at,
    v.school_visible_at,v.rank_review_status,v.rank_approved_at,v.rank_review_reason,
    (v.id=p.current_version_id) is_current,
    (SELECT count(DISTINCT s.identity_id)::int FROM submissions s
     WHERE s.version_id=v.id AND s.status='AC' AND s.kind IN ('submit','correction')) prior_ac_count
   FROM problems p JOIN problem_banks b ON b.id=p.bank_id
   JOIN problem_versions v ON v.problem_id=p.id AND v.published_at IS NOT NULL
   LEFT JOIN accounts a ON a.id=p.owner_account_id LEFT JOIN identities i ON i.id=a.identity_id
   WHERE p.archived_at IS NULL AND b.archived_at IS NULL AND b.visibility='school'
   ORDER BY CASE WHEN v.id=p.current_version_id AND v.rank_review_status='pending' THEN 0
    WHEN v.rank_review_status='rejected' THEN 1 WHEN v.school_visible_at IS NOT NULL THEN 2 ELSE 3 END,
    v.published_at DESC,p.id LIMIT 500`)).rows;
  return result({items:rows.map(reviewShape)});
 }
 let reviewMatch=route.match(/^\/problems\/([^/]+)\/rank-review$/);
 if(reviewMatch&&method==='PATCH'){
  if(!isAdmin(user))fail(403,'FORBIDDEN','仅管理员可审核校内公开题');
  const problemId=uuid(reviewMatch[1],'题目 ID'),versionId=uuid(body.versionId,'版本 ID');
  const decision=enumValue(body.decision,['approved','rejected','revoked'],'审核决定');
  const reason=decision==='rejected'||decision==='revoked'?field(body.reason,decision==='revoked'?'撤下原因':'驳回原因',{max:1000}):null;
  return result(await transaction(pool,async db=>{
   const p=required(await db.query(`SELECT p.id,p.current_version_id,p.archived_at,b.id bank_id,b.name bank_name,
    b.visibility bank_visibility,b.archived_at bank_archived_at,i.name owner_name
    FROM problems p JOIN problem_banks b ON b.id=p.bank_id
    LEFT JOIN accounts a ON a.id=p.owner_account_id LEFT JOIN identities i ON i.id=a.identity_id
    WHERE p.id=$1 FOR UPDATE OF p,b`,[problemId]));
   if(p.archived_at||p.bank_archived_at||p.bank_visibility!=='school')fail(409,'NOT_SCHOOL_PUBLIC','仅能审核校内题库中未归档题目');
   const v=required(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2 FOR UPDATE',[versionId,problemId]));
   if(!v.published_at)fail(409,'UNPUBLISHED','只能审核已发布题目版本');
   if(v.rank_review_status==='revoked')fail(409,'REVIEW_TERMINAL','已撤下版本不能恢复；请发布新版本');
   if(decision==='revoked'){
    if(!v.school_visible_at)fail(409,'NOT_SCHOOL_VISIBLE','只有已经校内公开的版本可撤下');
   }else{
    if(p.current_version_id!==versionId)fail(409,'VERSION_CHANGED','只能审核当前已发布版本');
    if(v.rank_review_status==='approved')fail(409,'APPROVAL_IMMUTABLE','已批准版本不可重复审核，可通过撤下操作停止公开');
   }
   await db.query(`UPDATE problem_versions SET rank_review_status=$1,
    rank_reviewed_at=clock_timestamp(),rank_reviewed_by=$2,rank_review_reason=$3,
    school_visible_at=CASE WHEN $1='approved' THEN COALESCE(school_visible_at,clock_timestamp()) ELSE NULL END,
    rank_approved_at=CASE WHEN $1='approved' THEN clock_timestamp() ELSE rank_approved_at END
    WHERE id=$4`,[decision,user.id,reason,versionId]);
   await audit(db,user.id,decision==='approved'?'problem.school_approve':decision==='rejected'?'problem.school_reject':'problem.school_revoke','problem_version',versionId,{problemId,versionId,reason});
   const reviewed=required(await db.query(`SELECT v.id version_id,v.title,v.published_at,v.school_visible_at,
    v.rank_review_status,v.rank_approved_at,v.rank_review_reason,
    (SELECT count(DISTINCT s.identity_id)::int FROM submissions s WHERE s.version_id=v.id
     AND s.status='AC' AND s.kind IN ('submit','correction')) prior_ac_count
    FROM problem_versions v WHERE v.id=$1`,[versionId]));
   return reviewShape({...reviewed,problem_id:problemId,bank_id:p.bank_id,bank_name:p.bank_name,bank_visibility:p.bank_visibility,owner_name:p.owner_name,is_current:p.current_version_id===versionId});
  }));
 }
 if(route==='/teachers'&&method==='GET') {
  if(!isStaff(user))fail(403,'FORBIDDEN','需要教师权限');const items=(await pool.query("SELECT i.id,i.name,i.number FROM identities i JOIN accounts a ON a.identity_id=i.id JOIN account_roles r ON r.account_id=a.id WHERE r.role='teacher' AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL ORDER BY i.name")).rows;return result({items});
 }
 if(route==='/problems/import'&&method==='GET'){if(!isStaff(user))fail(403,'FORBIDDEN','需要教师权限');const bankId=url.searchParams.get('bankId');if(bankId)await bankAccess(pool,user,bankId);const batches=(await pool.query('SELECT b.id,b.bank_id,b.filename,b.created_at,b.result FROM problem_import_batches b WHERE b.account_id=$1 AND ($2::uuid IS NULL OR b.bank_id=$2) ORDER BY created_at DESC LIMIT 100',[user.id,bankId?uuid(bankId):null])).rows;return result({items:batches.map(b=>({id:b.id,bankId:b.bank_id,fileName:b.filename,createdAt:b.created_at,summary:b.result.summary}))});}
 if(route==='/problems/import'&&method==='POST') {
  if(!isStaff(user))fail(403,'FORBIDDEN','需要教师权限');if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>100)fail(400,'VALIDATION','题目导入须包含 1–100 题的 JSON 数组');
  const bankId=uuid(body.bankId||SCHOOL_BANK),key=uuid(body.idempotencyKey,'导入请求去重键'),filename=field(body.filename??body.fileName??'','导入文件名',{min:0,max:300}),requestHash=canonicalHash({bankId,rows:body.rows,filename});const output=await transaction(pool,async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`problem-import:${user.id}:${key}`]);
   const existing=(await db.query('SELECT * FROM problem_import_batches WHERE account_id=$1 AND idempotency_key=$2',[user.id,key])).rows[0];if(existing){if(existing.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','相同导入请求键对应不同内容');return existing.result;}
   const access=await bankAccess(db,user,bankId);if(!access.canContribute)fail(403,'FORBIDDEN','无权向该题库导入');const items=[];let created=0,failed=0;
   for(let index=0;index<body.rows.length;index++){await db.query('SAVEPOINT problem_import_row');try{const input=helpers.problemInput({...body.rows[index],bankId});const p=required(await db.query('INSERT INTO problems(bank_id,owner_account_id) VALUES($1,$2) RETURNING id',[bankId,user.id]));const v=await helpers.insertVersion(db,user,p.id,input);const {tests,referenceCode,...problem}=await helpers.problemResult(db,user,p.id,v.id);items.push({line:index+1,status:'created',problem});created++;await db.query('RELEASE SAVEPOINT problem_import_row');}catch(error){await db.query('ROLLBACK TO SAVEPOINT problem_import_row');await db.query('RELEASE SAVEPOINT problem_import_row');items.push({line:index+1,status:'failed',message:error.status?error.message:'题目格式无效'});failed++;}}
   const summary={created,failed,total:items.length},output={items,summary};await db.query('INSERT INTO problem_import_batches(account_id,idempotency_key,request_hash,result,bank_id,filename) VALUES($1,$2,$3,$4,$5,$6)',[user.id,key,requestHash,JSON.stringify(output),bankId,filename]);await audit(db,user.id,'problem.import','problem_bank',bankId,summary);return output;
  });return result(output);
 }
 if(route==='/problem-banks'&&method==='GET') {
  const banks=(await pool.query('SELECT * FROM problem_banks WHERE archived_at IS NULL ORDER BY is_system DESC,created_at')).rows;
  const items=[];for(const bank of banks){try{const access=await bankAccess(pool,user,bank.id);access.bank.problemCount=Number((await pool.query(`SELECT count(*) FROM problems p
   WHERE p.bank_id=$1 AND p.archived_at IS NULL
    AND ($2::boolean OR p.owner_account_id=$3 OR
     $4::boolean AND EXISTS (SELECT 1 FROM problem_versions v WHERE v.problem_id=p.id
       AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL))`,
   [bank.id,access.canRead||isAdmin(user),user.id,bank.visibility==='school'])).rows[0].count);items.push(bankShape(access));}catch(error){if(error.code!=='FORBIDDEN')throw error;}}return result({items});
 }
 if(route==='/problem-banks'&&method==='POST') {
  if(!isStaff(user))fail(403,'FORBIDDEN','需要教师权限');const name=field(body.name,'题库名称'),description=field(body.description??'','题库简介',{min:0,max:4000}),course=field(body.course??'Python','课程标签',{max:100}),visibility=enumValue(body.visibility??'private',['private','school'],'题库范围');
  if(visibility==='school'&&!isAdmin(user))fail(403,'FORBIDDEN','校内公开题库须由管理员创建');
  const bank=await transaction(pool,async db=>{const bank=required(await db.query('INSERT INTO problem_banks(name,visibility,owner_account_id,description,course) VALUES($1,$2,$3,$4,$5) RETURNING *',[name,visibility,user.id,description,course]));await audit(db,user.id,'bank.create','problem_bank',bank.id,{visibility});return bank;});return {status:201,body:bankShape({bank,permission:'owner',canEdit:true,canContribute:true})};
 }
 let m=route.match(/^\/problem-banks\/([^/]+)$/);
 if(m&&method==='PATCH') {
  const bank=await transaction(pool,async db=>{
   const access=await bankAccess(db,user,m[1]);
   if(!access.owner)fail(403,'FORBIDDEN','只有题库所有者可以修改权限范围');
   if(access.bank.is_system)fail(409,'SYSTEM_BANK','系统校内题库不能修改或归档');
   const name=body.name===undefined?access.bank.name:field(body.name,'题库名称');
   const visibility=body.visibility===undefined?access.bank.visibility:enumValue(body.visibility,['private','school'],'题库范围');
   if(visibility!==access.bank.visibility&&!isAdmin(user))fail(403,'FORBIDDEN','题库校内可见性只能由管理员调整');
   if(body.archived!==undefined&&typeof body.archived!=='boolean')fail(400,'VALIDATION','归档状态无效');
   if(body.archived&&access.bank.visibility==='school'&&!isAdmin(user))fail(403,'FORBIDDEN','校内公开题库只能由管理员归档');
   // Serialize bank demotion with per-version review. Otherwise an approved
   // public version could become private without a revocation timestamp, and
   // its historical submission statistics would silently disappear.
   await db.query('SELECT id FROM problem_banks WHERE id=$1 FOR UPDATE',[access.bank.id]);
   if(access.bank.visibility==='school'&&(visibility==='private'||body.archived)){
    const visible=await db.query(`SELECT 1 FROM problems p JOIN problem_versions v ON v.problem_id=p.id
     WHERE p.bank_id=$1 AND p.archived_at IS NULL AND v.school_visible_at IS NOT NULL LIMIT 1`,[access.bank.id]);
    if(visible.rowCount)fail(409,'REVOKE_PUBLIC_VERSIONS','请先在题目审核中撤下该题库所有已公开版本');
   }
   const description=body.description===undefined?access.bank.description:field(body.description,'题库简介',{min:0,max:4000});
   const course=body.course===undefined?access.bank.course:field(body.course,'课程标签',{max:100});
   const updated=required(await db.query('UPDATE problem_banks SET name=$1,visibility=$2,archived_at=CASE WHEN $3 THEN now() ELSE NULL END,description=$5,course=$6,updated_at=now() WHERE id=$4 RETURNING *',[name,visibility,body.archived??false,m[1],description,course]));
   await audit(db,user.id,'bank.update','problem_bank',m[1],{visibility,archived:!!body.archived});
   return updated;
  });
  return result(bankShape({bank,permission:'owner',canEdit:true,canContribute:true}));
 }
 m=route.match(/^\/problem-banks\/([^/]+)\/permissions(?:\/([^/]+))?$/);
 if(m) {
  const access=await bankAccess(pool,user,m[1]);if(!access.owner)fail(403,'FORBIDDEN','只有题库所有者可以管理共享');
  if(method==='GET'&&!m[2]){const items=(await pool.query('SELECT i.id identity_id,i.name,i.number,p.permission FROM bank_permissions p JOIN accounts a ON a.id=p.account_id JOIN identities i ON i.id=a.identity_id WHERE p.bank_id=$1 AND a.binding_released_at IS NULL ORDER BY i.name',[m[1]])).rows.map(r=>({identityId:r.identity_id,name:r.name,number:r.number,permission:r.permission}));return result({items});}
  if(method==='POST'&&!m[2]){const permission=enumValue(body.permission,['read','edit'],'共享权限'),identityId=uuid(body.identityId);await transaction(pool,async db=>{const a=required(await db.query("SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.identity_id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND r.role='teacher'",[identityId]));await db.query('INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,$3) ON CONFLICT(bank_id,account_id) DO UPDATE SET permission=EXCLUDED.permission',[m[1],a.id,permission]);await audit(db,user.id,'bank.permission_grant','problem_bank',m[1],{identityId,permission});});return result({ok:true});}
  if(method==='DELETE'&&m[2]){const identityId=uuid(m[2]);await transaction(pool,async db=>{await db.query('DELETE FROM bank_permissions WHERE bank_id=$1 AND account_id IN(SELECT id FROM accounts WHERE identity_id=$2)',[m[1],identityId]);await audit(db,user.id,'bank.permission_revoke','problem_bank',m[1],{identityId});});return result({ok:true});}
 }
 async function groupShape(db,g) {
  const bank=await bankAccess(db,user,g.bank_id);const items=[];
  for(const p of (await db.query('SELECT p.id,p.current_version_id FROM problem_group_members gm JOIN problems p ON p.id=gm.problem_id WHERE gm.group_id=$1 AND p.archived_at IS NULL ORDER BY gm.position',[g.id])).rows){try{const {v}=await versionAccess(db,user,p.id);items.push({problemId:p.id,versionId:v.id,title:v.title,published:!!v.published_at});}catch(error){if(!['FORBIDDEN','NOT_FOUND'].includes(error.code))throw error;}}
  return {id:g.id,name:g.name,bankId:g.bank_id,problemIds:items.map(p=>p.problemId),problems:items,canEdit:isStaff(user)&&(g.owner_account_id===user.id||bank.canEdit)};
 }
 async function setMembers(db,groupId,bankId,problemIds) {
  if(!Array.isArray(problemIds)||problemIds.length>500)fail(400,'VALIDATION','分组题目须为最多 500 项的数组');
  const ids=[...new Set(problemIds.map(id=>uuid(id)))];
  for(const id of ids){const {p}=await versionAccess(db,user,id);if(p.bank_id!==bankId)fail(400,'BANK_MISMATCH','分组只能引用所属题库的题目；跨题库须复制新题并保留来源');}
  await db.query('DELETE FROM problem_group_members WHERE group_id=$1',[groupId]);for(let i=0;i<ids.length;i++)await db.query('INSERT INTO problem_group_members(group_id,problem_id,position) VALUES($1,$2,$3)',[groupId,ids[i],i]);
 }
 if(route==='/problem-groups/move'&&method==='POST')return result(await moveGroupMembers({pool,user,body,bankAccess,versionAccess,audit}));
 if(route==='/problem-groups'&&method==='GET') {
  const bankId=url.searchParams.get('bankId');if(bankId)await bankAccess(pool,user,bankId);const groups=(await pool.query('SELECT * FROM problem_groups WHERE archived_at IS NULL AND ($1::uuid IS NULL OR bank_id=$1) ORDER BY created_at',[bankId])).rows;const items=[];for(const g of groups){try{items.push(await groupShape(pool,g));}catch(error){if(error.code!=='FORBIDDEN')throw error;}}return result({items});
 }
 if(route==='/problem-groups'&&method==='POST') {
  if(!isStaff(user))fail(403,'FORBIDDEN','需要教师权限');const name=field(body.name,'分组名称'),bankId=uuid(body.bankId||SCHOOL_BANK);const group=await transaction(pool,async db=>{const access=await bankAccess(db,user,bankId);if(!access.canContribute)fail(403,'FORBIDDEN','无权管理该题库的分组');const group=required(await db.query('INSERT INTO problem_groups(bank_id,name,owner_account_id) VALUES($1,$2,$3) RETURNING *',[bankId,name,user.id]));await setMembers(db,group.id,bankId,body.problemIds??[]);await audit(db,user.id,'group.create','problem_group',group.id);return group;});return {status:201,body:await groupShape(pool,group)};
 }
 m=route.match(/^\/problem-groups\/([^/]+)$/);
 if(m&&['PATCH','DELETE'].includes(method)) {
  if(!isStaff(user))fail(403,'FORBIDDEN','需要教师权限');
  const group=await transaction(pool,async db=>{const g=required(await db.query('SELECT * FROM problem_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[uuid(m[1])]));const access=await bankAccess(db,user,g.bank_id);if(g.owner_account_id!==user.id&&!access.canEdit)fail(403,'FORBIDDEN','无权修改该分组');if(method==='DELETE'){await db.query('UPDATE problem_groups SET archived_at=now() WHERE id=$1',[g.id]);await audit(db,user.id,'group.archive','problem_group',g.id);return g;}if(body.problemIds!==undefined)await setMembers(db,g.id,g.bank_id,body.problemIds);const updated=required(await db.query('UPDATE problem_groups SET name=$1 WHERE id=$2 RETURNING *',[body.name===undefined?g.name:field(body.name,'分组名称'),g.id]));await audit(db,user.id,'group.update','problem_group',g.id);return updated;});return method==='DELETE'?result({ok:true}):result(await groupShape(pool,group));
 }
 m=route.match(/^\/submissions\/([^/]+)\/(rejudge|rejudge-confirm|rejudge-dismiss|rejudge-discard)$/);
 if(m&&method==='POST') {
  if(!isStaff(user))fail(403,'FORBIDDEN','重判与成绩修订需要负责教师或管理员权限');
  const output=await transaction(pool,async db=>{let s=await submissionAccess(db,user,m[1]);s=required(await db.query('SELECT * FROM submissions WHERE id=$1 FOR UPDATE',[s.id]));if(!await canReviewActivitySubmission(db,user,s))fail(403,'FORBIDDEN','只能修订本人负责班级活动中的提交');
   if(m[2]==='rejudge'){
    await assertJudgeAdmission(db);const reason=field(body.reason,'重判原因',{max:2000});if(!['submit','correction'].includes(s.kind))fail(400,'VALIDATION','只重判正式提交或订正');
    if((await db.query("SELECT 1 FROM judge_tasks WHERE submission_id=$1 AND state IN ('queued','leased')",[s.id])).rowCount||s.pending_judge_run_id)fail(409,'REJUDGE_PENDING','已有重判等待完成或确认');
    const task=required(await db.query("INSERT INTO judge_tasks(submission_id,version_id,purpose,rejudge,requested_by,reason) VALUES($1,$2,'submission',true,$3,$4) RETURNING id",[s.id,s.version_id,user.id,reason]));await audit(db,user.id,'submission.rejudge_request','submission',s.id,{taskId:task.id,reason});return {taskId:task.id,submissionId:`SUB${s.id}`,status:'Waiting',originalStatus:s.status,originalScore:s.score===null?null:Number(s.score)};
   }
   const runId=uuid(body.runId,'评测记录 ID');if(['rejudge-dismiss','rejudge-discard'].includes(m[2])){if((await db.query("SELECT 1 FROM judge_tasks WHERE submission_id=$1 AND state IN ('queued','leased')",[s.id])).rowCount)fail(409,'REJUDGE_RUNNING','评测尚在运行，不能放弃候选记录');const reason=field(body.reason,'不发布原因',{max:2000});required(await db.query('UPDATE submissions SET pending_judge_run_id=NULL WHERE id=$1 AND pending_judge_run_id=$2 RETURNING id',[s.id,runId]));await audit(db,user.id,'submission.rejudge_dismiss','submission',s.id,{runId,reason});return {ok:true};}const candidate=required(await db.query("SELECT r.*,t.state task_state FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id JOIN submissions s ON s.pending_judge_run_id=r.id WHERE s.id=$1 AND r.id=$2",[s.id,runId]));if(!['completed','failed'].includes(candidate.task_state)||(await db.query("SELECT 1 FROM judge_tasks WHERE submission_id=$1 AND state IN ('queued','leased')",[s.id])).rowCount||['Waiting','Judging','System Error'].includes(candidate.status)||candidate.score===null)fail(409,'INVALID_REJUDGE','基础设施故障或未完成结果不能发布为成绩');
   await db.query('UPDATE submissions SET status=$1,score=$2,passed=$3,total=$4,public_output=$5,public_message=$6,pending_judge_run_id=NULL WHERE id=$7',[candidate.status,candidate.score,candidate.passed,candidate.total,candidate.public_output,candidate.public_message,s.id]);await audit(db,user.id,'submission.rejudge_confirm','submission',s.id,{runId,oldStatus:s.status,oldScore:s.score,newStatus:candidate.status,newScore:candidate.score});return {ok:true,submissionId:`SUB${s.id}`,status:candidate.status,score:Number(candidate.score)};
  });return result(output);
 }
 return null;
}
