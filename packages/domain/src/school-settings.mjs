import { transaction } from './db.mjs';
import { fail, field, integer, uuid } from './security.mjs';
import { auditSchool, requireSchoolAdmin } from './schools.mjs';

const fields = 'id, name, name_zh AS "nameZh", name_en AS "nameEn", settings_revision AS revision';


export async function handleSchoolSettings({ pool, user, route, method, body }) {
  const match = route.match(/^\/schools\/([^/]+)\/settings$/);
  if (!match || !['GET', 'PATCH'].includes(method)) return null;
  if (!user) fail(401, 'UNAUTHENTICATED', '请先登录');
  const schoolId = uuid(match[1], '学校 ID');
  return transaction(pool, async db => {
    await requireSchoolAdmin(db, schoolId, user.id);
    const { rows: [current] } = await db.query(`SELECT ${fields} FROM schools WHERE id=$1${method === 'PATCH' ? ' FOR UPDATE' : ''}`, [schoolId]);
    if (!current) fail(404, 'NOT_FOUND', '学校不存在');
    if (method === 'GET') return { status: 200, body: current };
    const nameZh = field(body.nameZh, '学校中文名', { min: 0, max: 100 });
    const nameEn = field(body.nameEn, '学校英文名', { min: 0, max: 100 });
    if (!nameZh && !nameEn) fail(400, 'VALIDATION', '请至少填写一个学校名称');
    const expectedRevision = integer(body.expectedRevision, 1, 2147483647, '设置版本');
    if (current.revision !== expectedRevision) fail(409, 'STALE_SCHOOL_SETTINGS', '学校设置已更新，请重新加载后再保存');
    if (current.nameZh === nameZh && current.nameEn === nameEn) return { status: 200, body: current };
    const { rows: [updated] } = await db.query(`
      UPDATE schools SET name_zh=$2, name_en=$3 WHERE id=$1 RETURNING ${fields}`, [schoolId, nameZh, nameEn]);
    await auditSchool(db, schoolId, user.id, 'school.settings.update', schoolId);
    await db.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata)
      VALUES($1,'school.settings.update','school',$2,$3::jsonb)`, [user.id, schoolId,
      JSON.stringify({ before: current, after: updated })]);
    return { status: 200, body: updated };
  });
}
