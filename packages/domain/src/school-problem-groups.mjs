import { auditSchool } from './schools.mjs';
import { canonicalHash, fail, field, uuid } from './security.mjs';

export function groupWithRevision(group) {
  return { ...group, revision: canonicalHash(group) };
}

export async function listPracticeGroups(db, scope, userId, seeAll, { groupId = null, bankId = null } = {}) {
  const { rows } = await db.query(`
    SELECT g.id,g.name,g.bank_id AS "bankId",
      ARRAY(SELECT m.problem_id FROM practice_problem_group_members m
        WHERE (m.scope_id,m.group_id)=(g.scope_id,g.id) ORDER BY m.position,m.problem_id) AS "problemIds"
    FROM practice_problem_groups g WHERE g.scope_id=$1 AND g.archived_at IS NULL
      AND ($2::uuid IS NULL OR g.id=$2) AND ($3 OR g.owner_account_id=$4)
      AND ($5::uuid IS NULL OR g.bank_id=$5) ORDER BY g.name,g.id`, [scope, groupId, seeAll, userId, bankId]);
  if (groupId && !rows.length) fail(404, 'NOT_FOUND', '分组不存在');
  return rows.map(groupWithRevision);
}

function checkRevision(group, revision) {
  if (revision !== group.revision) fail(409, 'REVISION_CONFLICT', '分组已更新，请重新加载');
}

function memberIds(input) {
  if (!Array.isArray(input)) fail(400, 'VALIDATION', '题目列表无效');
  const ids = input.map(id => uuid(id).toLowerCase());
  if (new Set(ids).size !== ids.length) fail(400, 'VALIDATION', '题目重复');
  return ids;
}

// Use the published title when the teacher cannot see the draft. Platform sources
// remain managed through the platform catalog even if an old school copy exists.
async function bankProblems(db, schoolId, bankId, userId, admin, ids = null) {
  const { rows } = await db.query(`
    SELECT p.id,CASE WHEN $4 OR p.owner_account_id=$3 THEN p.draft->>'title'
      ELSE v.definition->>'title' END AS title
    FROM school_problems p LEFT JOIN school_problem_versions v
      ON (v.school_id,v.problem_id,v.id)=(p.school_id,p.id,p.published_version_id)
    WHERE p.archived_at IS NULL AND p.school_id=$1 AND p.bank_id=$2 AND ($4 OR p.owner_account_id=$3 OR p.published)
      AND ($5::uuid[] IS NULL OR p.id=ANY($5))
      AND NOT EXISTS(SELECT 1 FROM problems source WHERE source.id=p.id AND source.owner_scope='platform')
    ORDER BY title,p.id`, [schoolId, bankId, userId, admin, ids]);
  return rows;
}

async function checkAdditions(db, schoolId, bankId, userId, admin, ids) {
  if (ids.length && (await bankProblems(db, schoolId, bankId, userId, admin, ids)).length !== ids.length)
    fail(404, 'NOT_FOUND', '题目不在当前可管理的题库中');
}

async function replaceMembers(db, schoolId, groupId, ids) {
  await db.query('DELETE FROM practice_problem_group_members WHERE scope_id=$1 AND group_id=$2', [schoolId, groupId]);
  await db.query(`INSERT INTO practice_problem_group_members(scope_id,group_id,problem_id,position)
    SELECT $1,$2,id,position FROM unnest($3::uuid[]) WITH ORDINALITY p(id,position)`, [schoolId, groupId, ids]);
}

export async function schoolProblemGroups(db, { schoolId, userId, role, groupId, move, method, body, url }) {
  const admin = role === 'school_admin';
  const creating = method === 'POST' && !groupId;
  const requestedBank = url.searchParams.get('bankId');
  const bankFilter = creating ? uuid(body.bankId) : requestedBank ? uuid(requestedBank) : null;
  const groups = await listPracticeGroups(db, schoolId, userId, admin, { groupId, bankId: bankFilter });
  const group = groups[0];
  const managing = method === 'GET' && !groupId && url.searchParams.get('view') === 'manage';
  if (method === 'GET' && !managing) return { status: 200, body: groupId ? group : { items: groups } };
  if (managing && !bankFilter) fail(400, 'VALIDATION', '请选择题库');
  const bankId = bankFilter ?? group?.bankId;
  const bank = (await db.query(`SELECT owner_account_id,archived FROM school_problem_banks
    WHERE school_id=$1 AND id=$2 AND resource_kind='ordinary'`, [schoolId, bankId])).rows[0];
  const canCreate = bank && (admin || bank.owner_account_id === userId);
  if (!bank || (!canCreate && (!groups.length || creating))) fail(404, 'NOT_FOUND', '题库不可用');
  if (bank.archived) fail(409, 'BANK_ARCHIVED', '请先恢复已归档的题库');
  if (managing) return { status: 200, body: {
    items: groups, problems: await bankProblems(db, schoolId, bankId, userId, admin),
  } };
  if (creating) {
    const id = uuid(body.requestId).toLowerCase();
    const name = field(body.name, '分组名称');
    const problemIds = memberIds(body.problemIds ?? []);
    const result = groupWithRevision({ id, name, bankId, problemIds });
    const existing = groups.find(item => item.id === id);
    if (existing?.revision === result.revision) return { status: 200, body: existing };
    await checkAdditions(db, schoolId, bankId, userId, admin, problemIds);
    const inserted = await db.query(`INSERT INTO practice_problem_groups(scope_id,id,name,bank_id,owner_account_id,created_at)
      VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT DO NOTHING`, [schoolId, id, name, bankId, userId]);
    if (!inserted.rowCount) fail(409, 'REQUEST_CONFLICT', '该请求已被使用');
    await replaceMembers(db, schoolId, id, problemIds);
    await auditSchool(db, schoolId, userId, 'school.problem_group.create', id);
    return { status: 201, body: result };
  }
  checkRevision(group, body.expectedRevision);
  if (method === 'DELETE') {
    await db.query('UPDATE practice_problem_groups SET archived_at=now() WHERE scope_id=$1 AND id=$2', [schoolId, groupId]);
    await auditSchool(db, schoolId, userId, 'school.problem_group.dissolve', groupId);
    return { status: 200, body: { id: groupId } };
  }
  const original = new Set(group.problemIds);
  if (method === 'POST' && move) {
    const id = uuid(body.targetGroupId);
    if (id === groupId) fail(400, 'VALIDATION', '请选择不同的目标分组');
    const [target] = await listPracticeGroups(db, schoolId, userId, admin, { groupId: id, bankId });
    checkRevision(target, body.targetRevision);
    const ids = memberIds(body.problemIds);
    if (!ids.length || ids.some(member => !original.has(member))) fail(400, 'VALIDATION', '请选择来源分组中的题目');
    await checkAdditions(db, schoolId, bankId, userId, admin, ids);
    const moved = new Set(ids);
    await replaceMembers(db, schoolId, groupId, group.problemIds.filter(member => !moved.has(member)));
    await replaceMembers(db, schoolId, id, [...new Set([...target.problemIds, ...group.problemIds.filter(member => moved.has(member))])]);
    await auditSchool(db, schoolId, userId, 'school.problem_group.move', groupId, { targetGroupId: id, count: ids.length });
    return { status: 200, body: { count: ids.length } };
  }
  if (method !== 'PATCH') return null;
  const name = body.name === undefined ? group.name : field(body.name, '分组名称');
  const problemIds = body.problemIds === undefined ? group.problemIds : memberIds(body.problemIds);
  if (body.problemIds !== undefined) {
    await checkAdditions(db, schoolId, bankId, userId, admin, problemIds.filter(id => !original.has(id)));
    await replaceMembers(db, schoolId, groupId, problemIds);
  }
  await db.query('UPDATE practice_problem_groups SET name=$3 WHERE scope_id=$1 AND id=$2', [schoolId, groupId, name]);
  await auditSchool(db, schoolId, userId, 'school.problem_group.update', groupId);
  return { status: 200, body: groupWithRevision({ id: groupId, name, bankId, problemIds }) };
}
