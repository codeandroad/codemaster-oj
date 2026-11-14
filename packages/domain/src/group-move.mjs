import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { enumValue, fail, field, uuid } from './security.mjs';

function selectedIds(value, max, label, min = 1) {
 if (!Array.isArray(value) || value.length < min || value.length > max) fail(400, 'VALIDATION', `${label}数量无效`);
 return [...new Set(value.map(id => uuid(id).toLowerCase()))];
}

export async function changeGroupMembers({ pool, user, body, bankAccess, versionAccess, audit, move }) {
 if (!user.roles.some(role => role === 'teacher' || role === 'admin')) fail(403, 'FORBIDDEN', '需要教师权限');
 const bankId = uuid(body.bankId).toLowerCase();
 const operation = move ? 'move' : enumValue(body.operation, ['add', 'remove'], '分组操作');
 const source = move ? uuid(body.sourceGroupId).toLowerCase() : null;
 const name = operation === 'add' && body.newGroupName != null ? field(body.newGroupName, '分组名称') : null;
 const targets = selectedIds(move ? body.targetGroupIds : body.groupIds, 50, '目标分组', name ? 0 : 1);
 const problems = selectedIds(body.problemIds, 500, '题目');
 if (targets.includes(source)) fail(400, 'VALIDATION', '来源和目标分组不能相同');

 return transaction(pool, async db => {
  await lockSchoolTeaching(db, LEGACY_SCHOOL_ID, { shared: true });
  await activeAccount(db, user.id);
  const groupIds = source ? [source, ...targets] : targets;
  // Use the same row locks as PATCH and order them consistently across batches.
  const groups = (await db.query('SELECT * FROM problem_groups WHERE id=ANY($1::uuid[]) AND archived_at IS NULL ORDER BY id FOR UPDATE', [groupIds])).rows;
  if (groups.length !== groupIds.length) fail(404, 'NOT_FOUND', '分组不存在或已解散');
  const access = await bankAccess(db, user, bankId);
  for (const group of groups) {
   if (group.bank_id !== bankId) fail(400, 'BANK_MISMATCH', '只能整理同一题库内的分组');
   if (group.owner_account_id !== user.id && !access.canEdit) fail(403, 'FORBIDDEN', '无权修改所选分组');
  }
  if (name && !access.canContribute) fail(403, 'FORBIDDEN', '无权在此题库创建分组');
  for (const id of problems) {
   const { p, permissions } = await versionAccess(db, user, id);
   if (p.bank_id !== bankId) fail(400, 'BANK_MISMATCH', '题目不属于所选题库');
   if (p.owner_scope === 'platform' && !permissions.canEdit) fail(403, 'CONTENT_EDITOR_REQUIRED', '未获所选平台题目的编辑授权');
  }

  const members = (await db.query('SELECT group_id,problem_id,position FROM problem_group_members WHERE group_id=ANY($1::uuid[])', [groupIds])).rows;
  const contains = (group, id) => members.some(member => member.group_id === group && member.problem_id === id);
  if (source && !problems.every(id => contains(source, id))) {
   if (problems.every(id => !contains(source, id) && targets.every(target => contains(target, id)))) return { ok: true, moved: 0, alreadyMoved: true };
   fail(409, 'STALE_GROUP', '来源分组的题目已变化，请刷新后重新选择');
  }
  if (name) {
   const { rows: [created] } = await db.query('INSERT INTO problem_groups(bank_id,name,owner_account_id) VALUES($1,$2,$3) RETURNING id', [bankId, name, user.id]);
   targets.push(created.id);
   await audit(db, user.id, 'group.create', 'problem_group', created.id);
  }
  if (operation === 'remove') {
   await db.query('DELETE FROM problem_group_members WHERE group_id=ANY($1::uuid[]) AND problem_id=ANY($2::uuid[])', [targets, problems]);
  } else {
   for (const target of targets) {
    const rows = members.filter(member => member.group_id === target);
    const missing = problems.filter(id => !contains(target, id));
    if (rows.length + missing.length > 500) fail(400, 'VALIDATION', '目标分组最多容纳 500 道题');
    const position = rows.reduce((max, member) => Math.max(max, member.position), -1);
    await db.query(`INSERT INTO problem_group_members(group_id,problem_id,position)
     SELECT $1,id,$3+ordinality FROM unnest($2::uuid[]) WITH ORDINALITY AS entry(id,ordinality)`, [target, missing, position]);
   }
  }
  if (source) {
   await db.query('DELETE FROM problem_group_members WHERE group_id=$1 AND problem_id=ANY($2::uuid[])', [source, problems]);
   await audit(db, user.id, 'group.move', 'problem_group', source, { targetGroupIds: targets, problemIds: problems });
   return { ok: true, moved: problems.length, alreadyMoved: false };
  }
  for (const target of targets) await audit(db, user.id, `group.members_${operation}`, 'problem_group', target, { problemIds: problems });
  return { ok: true };
 });
}
