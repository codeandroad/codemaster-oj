import { transaction } from './db.mjs';
import { fail, field, integer, uuid } from './security.mjs';
import { activeAccount, auditSchool, LEGACY_SCHOOL_ID, requireSchoolAdmin } from './schools.mjs';

const fields = 'id, name, name_zh AS "nameZh", name_en AS "nameEn", settings_revision AS revision';

async function authorize(db, schoolId, accountId) {
  if (schoolId !== LEGACY_SCHOOL_ID) return requireSchoolAdmin(db, schoolId, accountId);
  await activeAccount(db, accountId);
  // Legacy grants remain authoritative: joining another school cannot confer
  // access to the original school's settings, or revoke an existing admin.
  const { rowCount } = await db.query(`
    SELECT r.account_id FROM account_roles r
    JOIN legacy_school_account_ownership o ON o.account_id=r.account_id
    WHERE r.account_id=$1 AND r.role='admin' AND o.school_id=$2
    FOR SHARE OF r`, [accountId, schoolId]);
  if (!rowCount) fail(403, 'FORBIDDEN', '需要本校管理员权限');
}

export async function handleSchoolSettings({ pool, user, route, method, body }) {
  const match = route.match(/^\/schools\/([^/]+)\/settings$/);
  if (!match || !['GET', 'PATCH'].includes(method)) return null;
  if (!user) fail(401, 'UNAUTHENTICATED', '请先登录');
  const schoolId = uuid(match[1], '学校 ID');
  return transaction(pool, async db => {
    await authorize(db, schoolId, user.id);
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
    if (schoolId === LEGACY_SCHOOL_ID) {
      await db.query(`UPDATE site_settings SET settings=jsonb_set(settings,'{schoolName}',to_jsonb($1::text)),
        updated_at=now() WHERE id=true`, [updated.name]);
    }
    await auditSchool(db, schoolId, user.id, 'school.settings.update', schoolId);
    await db.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata)
      VALUES($1,'school.settings.update','school',$2,$3::jsonb)`, [user.id, schoolId,
      JSON.stringify({ before: current, after: updated })]);
    return { status: 200, body: updated };
  });
}
