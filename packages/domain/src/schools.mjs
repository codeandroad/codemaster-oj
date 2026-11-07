import { transaction } from './db.mjs';
import { archiveRemovedStudent, handleSchoolExits } from './school-exits.mjs';
import { enumValue, fail, field, integer, randomToken, tokenHash, username, uuid } from './security.mjs';

export const LEGACY_SCHOOL_ID = '00000000-0000-4000-8000-000000000052';

const result = (body, status = 200) => ({ status, body });

export async function activeAccount(db, accountId) {
  const { rowCount } = await db.query(`
    SELECT a.id FROM accounts a JOIN identities i ON i.id = a.identity_id
    WHERE a.id = $1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
      AND i.archived_at IS NULL
    FOR SHARE OF a, i`, [accountId]);
  if (!rowCount) fail(401, 'UNAUTHENTICATED', '请重新登录');
}

export async function auditSchool(db, schoolId, actorId, action, targetId) {
  await db.query(`
    INSERT INTO school_audit_events (school_id, actor_account_id, action, target_id)
    VALUES ($1, $2, $3, $4)`, [schoolId, actorId, action, targetId]);
}

// All school identity, class, and roster writers acquire this transaction lock
// before locking target memberships or records. Shared previews see one stable
// plan without storing student data or issuing a database write.
export async function lockSchoolTeaching(db, schoolId, { shared = false } = {}) {
  const lock = shared ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
  await db.query(`SELECT ${lock}(hashtextextended('school-teaching:' || $1::uuid::text, 0))`, [schoolId]);
}

export async function schoolRole(db, schoolId, userId) {
  await activeAccount(db, userId);
  const { rows } = await db.query(`
    SELECT role FROM school_memberships
    WHERE school_id = $1 AND account_id = $2 AND revoked_at IS NULL
    FOR SHARE`, [schoolId, userId]);
  if (!rows.length) fail(404, 'NOT_FOUND', '学校工作区不存在或不可访问');
  const { rowCount: administrator } = await db.query(`
    SELECT account_id FROM school_administrators
    WHERE school_id = $1 AND account_id = $2 AND revoked_at IS NULL
    FOR SHARE`, [schoolId, userId]);
  if (administrator) return 'school_admin';
  return rows[0].role;
}

export async function requireSchoolAdmin(db, schoolId, userId) {
  if (await schoolRole(db, schoolId, userId) !== 'school_admin') {
    fail(403, 'FORBIDDEN', '需要本校管理员权限');
  }
}

export async function provisionSchool(pool, { slug, name, adminUsername }) {
  const schoolSlug = field(slug, '学校标识', { min: 3, max: 50 });
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(schoolSlug) || schoolSlug === 'legacy-school') {
    fail(400, 'VALIDATION', '学校标识须使用 3–50 个小写字母、数字或短横线');
  }
  const schoolName = field(name, '学校名称', { max: 100 });
  const login = username(adminUsername);
  return transaction(pool, async db => {
    const account = (await db.query(`
      SELECT id FROM accounts WHERE username = $1 AND binding_released_at IS NULL`, [login])).rows[0];
    if (!account) fail(404, 'NOT_FOUND', '管理员账号不存在');
    await activeAccount(db, account.id);
    const { rows } = await db.query(`
      INSERT INTO schools (slug, name) VALUES ($1, $2)
      ON CONFLICT (slug) DO NOTHING RETURNING id, slug, name`, [schoolSlug, schoolName]);
    if (!rows.length) {
      const existing = (await db.query(`
        SELECT s.id, s.slug, s.name FROM schools s
        JOIN school_memberships m ON m.school_id = s.id
        WHERE s.slug = $1 AND s.name = $2 AND m.account_id = $3
          AND m.role = 'school_admin' AND m.revoked_at IS NULL`, [schoolSlug, schoolName, account.id])).rows[0];
      if (!existing) fail(409, 'CONFLICT', '学校标识已存在');
      return existing;
    }
    const school = rows[0];
    await db.query(`
      INSERT INTO school_memberships (school_id, account_id, role)
      VALUES ($1, $2, 'school_admin')`, [school.id, account.id]);
    await auditSchool(db, school.id, null, 'school.provision', account.id);
    return school;
  });
}

async function listSchools(pool, user) {
  const { rows } = await pool.query(`
    SELECT s.id, s.slug, s.name, s.name_zh AS "nameZh", s.name_en AS "nameEn",
      CASE WHEN m.role <> 'school_admin' AND g.account_id IS NOT NULL
        THEN ARRAY['school_admin',m.role] ELSE ARRAY[m.role] END roles
    FROM school_memberships m JOIN schools s ON s.id = m.school_id
    LEFT JOIN school_administrators g ON g.school_id=m.school_id AND g.account_id=m.account_id
      AND g.revoked_at IS NULL
    WHERE m.account_id = $1 AND m.revoked_at IS NULL
    ORDER BY s.name, s.id`, [user.id]);
  const legacyRoles = user.roles.map(role => role === 'admin' ? 'school_admin' : role);
  if (legacyRoles.length) {
    const { rows: [legacy] } = await pool.query('SELECT id,slug,name,name_zh AS "nameZh",name_en AS "nameEn" FROM schools WHERE id=$1', [LEGACY_SCHOOL_ID]);
    if (legacy) rows.unshift({ ...legacy, roles: legacyRoles });
  }
  return rows.map(school => ({ ...school, legacy: school.id === LEGACY_SCHOOL_ID }));
}

async function issueInvitation(db, schoolId, actorId, role) {
  const token = randomToken();
  const { rows: [invitation] } = await db.query(`
    INSERT INTO school_invitations (school_id, issued_by, role, token_hash, expires_at)
    VALUES ($1, $2, $3, $4, clock_timestamp() + interval '7 days')
    RETURNING id, expires_at`, [schoolId, actorId, role, tokenHash(token)]);
  await auditSchool(db, schoolId, actorId, 'school.invite', invitation.id);
  return { token, role, expiresAt: invitation.expires_at };
}

async function acceptInvitation(pool, user, token) {
  return transaction(pool, async db => {
    await activeAccount(db, user.id);
    const { rows: [invitation] } = await db.query(`
      SELECT id, school_id, issued_by, role FROM school_invitations
      WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > clock_timestamp()
      FOR UPDATE`, [tokenHash(token)]);
    if (!invitation) fail(400, 'INVALID_INVITATION', '邀请无效、已过期或已使用');
    // Lock the issuing grant and account, so concurrent disable/revoke is serialized.
    try {
      await requireSchoolAdmin(db, invitation.school_id, invitation.issued_by);
    } catch (error) {
      if ([401,403,404].includes(error.status)) fail(400, 'INVALID_INVITATION', '邀请无效、已过期或已使用');
      throw error;
    }
    const member = await db.query(`
      INSERT INTO school_memberships (school_id, account_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (school_id, account_id) DO UPDATE
      SET role = EXCLUDED.role, revoked_at = NULL, joined_at = clock_timestamp()
      WHERE school_memberships.revoked_at IS NOT NULL
      RETURNING account_id`, [invitation.school_id, user.id, invitation.role]);
    if (!member.rowCount) fail(409, 'ALREADY_MEMBER', '已加入该学校');
    const accepted = await db.query(`
      UPDATE school_invitations SET accepted_at = clock_timestamp(), accepted_by = $2
      WHERE id = $1 AND expires_at > clock_timestamp()`, [invitation.id, user.id]);
    if (!accepted.rowCount) fail(400, 'INVALID_INVITATION', '邀请无效、已过期或已使用');
    await auditSchool(db, invitation.school_id, user.id, 'school.join', invitation.id);
    return { schoolId: invitation.school_id, role: invitation.role };
  });
}

export async function handleSchools({ pool, user, route, method, body, url }) {
  const exit = await handleSchoolExits({ pool, user, route, method, body, url });
  if (exit) return exit;
  if (route === '/schools' && method === 'GET') return result({ items: await listSchools(pool, user) });
  if (route === '/school-invitations/accept' && method === 'POST') {
    const token = field(body.token, '邀请码', { min: 32, max: 32 });
    return result(await acceptInvitation(pool, user, token));
  }
  const match = route.match(/^\/schools\/([^/]+)\/(members|invitations)(?:\/([^/]+))?$/);
  if (!match) return null;
  const [, id, resource, memberId] = match;
  const schoolId = uuid(id, '学校 ID');
  if (resource === 'members' && !memberId && method === 'GET') {
    const page = integer(Number(url.searchParams.get('page') ?? '1'), 1, 100000, '页码');
    const role = url.searchParams.has('role')
      ? enumValue(url.searchParams.get('role'), ['teacher', 'student', 'school_admin'], '成员角色')
      : null;
    const unlinked = enumValue(url.searchParams.get('unlinked') ?? 'false', ['true', 'false'], '仅显示未关联成员') === 'true';
    return transaction(pool, async db => {
      await requireSchoolAdmin(db, schoolId, user.id);
      const { rows } = await db.query(`
        SELECT m.account_id AS "accountId", i.name, m.role, m.joined_at AS "joinedAt",
          g.account_id IS NOT NULL AS has_admin_grant
          ${unlinked ? ', a.username' : ''}
        FROM school_memberships m JOIN accounts a ON a.id = m.account_id
        JOIN identities i ON i.id = a.identity_id
        LEFT JOIN school_administrators g ON g.school_id=m.school_id AND g.account_id=m.account_id
          AND g.revoked_at IS NULL
        WHERE m.school_id = $1 AND m.revoked_at IS NULL AND a.disabled_at IS NULL
          AND a.binding_released_at IS NULL AND i.archived_at IS NULL
          AND ($2::text IS NULL OR m.role = $2 OR ($2='school_admin' AND g.account_id IS NOT NULL))
          AND (NOT $3::boolean OR NOT EXISTS (
            SELECT 1 FROM school_identities si WHERE si.school_id = m.school_id AND si.account_id = m.account_id
          ))
        ORDER BY i.name, m.account_id LIMIT 51 OFFSET $4`, [schoolId, role, unlinked, (page - 1) * 50]);
      const items = rows.slice(0,50).map(({ has_admin_grant: administrator,...member }) =>
        ({ ...member,...(administrator ? { administrator:true } : {}) }));
      return result({ items, page, hasMore: rows.length > 50 });
    });
  }
  if (resource === 'invitations' && !memberId && method === 'POST') {
    const role = enumValue(body.role, ['teacher', 'student', 'school_admin'], '邀请角色');
    return transaction(pool, async db => {
      await requireSchoolAdmin(db, schoolId, user.id);
      // Serialize the outstanding invitation cap across school administrators.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-invitations:' || $1::uuid::text, 0))", [schoolId]);
      const { rows: [{ count }] } = await db.query(`
        SELECT count(*)::int AS count FROM school_invitations
        WHERE school_id = $1 AND accepted_at IS NULL AND expires_at > clock_timestamp()`, [schoolId]);
      if (count >= 100) fail(429, 'INVITATION_LIMIT', '该校未使用的邀请已达到上限');
      return result(await issueInvitation(db, schoolId, user.id, role), 201);
    });
  }
  if (resource === 'members' && memberId && method === 'DELETE') {
    const target = uuid(memberId, '账号 ID');
    return transaction(pool, async db => {
      await lockSchoolTeaching(db, schoolId);
      await requireSchoolAdmin(db, schoolId, user.id);
      if (await archiveRemovedStudent(db, schoolId, target, user.id)) return result({ ok: true });
      const { rowCount } = await db.query(`
        UPDATE school_memberships SET revoked_at = clock_timestamp()
        WHERE school_id = $1 AND account_id = $2 AND role <> 'school_admin'
          AND revoked_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM school_administrators g
            WHERE g.school_id=school_memberships.school_id AND g.account_id=school_memberships.account_id
              AND g.revoked_at IS NULL
          )`, [schoolId, target]);
      if (!rowCount) fail(404, 'NOT_FOUND', '可移除的成员不存在');
      const { rows: [identity] } = await db.query(`
        UPDATE school_identities SET account_id = NULL
        WHERE school_id = $1 AND account_id = $2 RETURNING id`, [schoolId, target]);
      if (identity) await auditSchool(db, schoolId, user.id, 'school.identity.unlink', identity.id);
      await auditSchool(db, schoolId, user.id, 'school.revoke_membership', target);
      return result({ ok: true });
    });
  }
  return null;
}
