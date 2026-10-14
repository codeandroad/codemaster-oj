import {transaction} from './db.mjs';
import {fail,uuid} from './security.mjs';
export async function moveGroupMembers({pool,user,body,bankAccess,versionAccess,audit}){
 if(!user.roles.some(r=>r==='teacher'||r==='admin'))fail(403,'FORBIDDEN','需要教师权限');
 const bankId=uuid(body.bankId),source=uuid(body.sourceGroupId);
 const ids=(value,max,label)=>{if(!Array.isArray(value)||!value.length||value.length>max)fail(400,'VALIDATION',`${label}数量无效`);return [...new Set(value.map(v=>uuid(v)))];};
 const targets=ids(body.targetGroupIds,50,'目标分组'),problems=ids(body.problemIds,500,'题目');
 if(targets.includes(source))fail(400,'VALIDATION','来源和目标分组不能相同');
 return transaction(pool,async db=>{
  // Stable ordering and the same row locks as PATCH prevent deadlocks/lost memberships.
  const groups=(await db.query('SELECT * FROM problem_groups WHERE id=ANY($1::uuid[]) AND archived_at IS NULL ORDER BY id FOR UPDATE',[[source,...targets]])).rows;
  if(groups.length!==targets.length+1)fail(404,'NOT_FOUND','分组不存在或已解散');
  const access=await bankAccess(db,user,bankId);
  for(const group of groups){if(group.bank_id!==bankId)fail(400,'BANK_MISMATCH','只能在同一题库内移动分组');if(group.owner_account_id!==user.id&&!access.canEdit)fail(403,'FORBIDDEN','无权修改来源或目标分组');}
  for(const id of problems){const {p}=await versionAccess(db,user,id);if(p.bank_id!==bankId)fail(400,'BANK_MISMATCH','题目不属于所选题库');}
  const members=(await db.query('SELECT group_id,problem_id,position FROM problem_group_members WHERE group_id=ANY($1::uuid[])',[[source,...targets]])).rows;
  const contains=(group,id)=>members.some(m=>m.group_id===group&&m.problem_id===id);
  if(!problems.every(id=>contains(source,id))){
   if(problems.every(id=>!contains(source,id)&&targets.every(t=>contains(t,id))))return {ok:true,moved:0,alreadyMoved:true};
   fail(409,'STALE_GROUP','来源分组的题目已变化，请刷新后重新选择');
  }
  for(const target of targets){const rows=members.filter(m=>m.group_id===target),missing=problems.filter(id=>!contains(target,id));if(rows.length+missing.length>500)fail(400,'VALIDATION','目标分组最多容纳 500 道题');let position=rows.reduce((max,m)=>Math.max(max,m.position),-1);for(const id of missing)await db.query('INSERT INTO problem_group_members(group_id,problem_id,position) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[target,id,++position]);}
  await db.query('DELETE FROM problem_group_members WHERE group_id=$1 AND problem_id=ANY($2::uuid[])',[source,problems]);
  await audit(db,user.id,'group.move','problem_group',source,{targetGroupIds:targets,problemIds:problems});
  return {ok:true,moved:problems.length,alreadyMoved:false};
 });
}
