import { transaction } from './db.mjs';
import { fail, field, integer, username, uuid } from './security.mjs';
import { activeAccount, auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';

const result = (body, status = 200) => ({ status, body });
const schoolFields = 'id, slug, name, name_zh AS "nameZh", name_en AS "nameEn", settings_revision AS revision, created_at AS "createdAt"';
const schoolShape = school => ({ ...school, legacy: school.id === LEGACY_SCHOOL_ID });

export async function isPlatformAdministrator(db, accountId) {
  const { rowCount } = await db.query(`
    SELECT 1 FROM platform_admins p
    JOIN accounts a ON a.id = p.account_id JOIN identities i ON i.id = a.identity_id
    WHERE p.account_id = $1 AND p.revoked_at IS NULL AND a.disabled_at IS NULL
      AND a.binding_released_at IS NULL AND i.archived_at IS NULL`, [accountId]);
  return rowCount > 0;
}

async function requirePlatformAdministrator(db, accountId) {
  await activeAccount(db, accountId);
  // Runtime has SELECT-only access to platform grants. Capability maintenance
  // locks the credential first, so the account lock above serializes with it
  // without granting the API UPDATE rights on its own authorization table.
  const { rowCount } = await db.query(`
    SELECT account_id FROM platform_admins WHERE account_id = $1 AND revoked_at IS NULL`, [accountId]);
  if (!rowCount) fail(403, 'PLATFORM_ADMIN_REQUIRED', '需要平台管理员权限');
}

async function auditPlatform(db, actorId, action, { schoolId = null, accountId = null, detail = {} } = {}) {
  await db.query(`
    INSERT INTO platform_audit_events (actor_account_id, action, school_id, target_account_id, detail)
    VALUES ($1, $2, $3, $4, $5::jsonb)`, [actorId, action, schoolId, accountId, JSON.stringify(detail)]);
}

async function findActiveAccount(db, rawUsername, { exclusive = false, accountId } = {}) {
  const byId = accountId !== undefined;
  const target = byId ? uuid(accountId, '账号 ID') : username(rawUsername);
  if (exclusive) {
    const { rows: [candidate] } = await db.query(`
      SELECT id,identity_id FROM accounts WHERE username=$1
        AND binding_released_at IS NULL AND disabled_at IS NULL`, [target]);
    if (!candidate) fail(404, 'ACCOUNT_NOT_FOUND', '未找到有效的指定账号');
    // Match legacy identity editing/unbinding: identity first, credential next.
    // Separate statements make the lock order independent of the query plan.
    const { rows: [identity] } = await db.query(`
      SELECT name FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [candidate.identity_id]);
    if (!identity) fail(404, 'ACCOUNT_NOT_FOUND', '未找到有效的指定账号');
    const { rows: [account] } = await db.query(`
      SELECT id AS "accountId",username FROM accounts WHERE id=$1 AND identity_id=$2
        AND username=$3 AND binding_released_at IS NULL AND disabled_at IS NULL FOR UPDATE`,
    [candidate.id,candidate.identity_id,target]);
    if (!account) fail(404, 'ACCOUNT_NOT_FOUND', '未找到有效的指定账号');
    return { ...account,name:identity.name };
  }
  const { rows: [account] } = await db.query(`
    SELECT a.id AS "accountId", a.username, i.name FROM accounts a
    JOIN identities i ON i.id = a.identity_id
    WHERE a.${byId ? 'id' : 'username'} = $1 AND a.binding_released_at IS NULL AND a.disabled_at IS NULL
      AND i.archived_at IS NULL FOR SHARE OF a, i`, [target]);
  if (!account) fail(404, 'ACCOUNT_NOT_FOUND', '未找到有效的指定账号');
  return account;
}

// Initial platform access is granted only by an operator with migration-level
// database credentials. No HTTP account/role mutation can invoke this helper.
export async function provisionPlatformAdministrator(pool, { username: rawUsername }) {
  return transaction(pool, async db => {
    const account = await findActiveAccount(db, rawUsername, { exclusive: true });
    const { rowCount } = await db.query(`
      INSERT INTO platform_admins (account_id) VALUES ($1)
      ON CONFLICT (account_id) DO UPDATE SET granted_by = NULL,
        granted_at = clock_timestamp(), revoked_at = NULL
      WHERE platform_admins.revoked_at IS NOT NULL`, [account.accountId]);
    if (rowCount) await auditPlatform(db, null, 'platform.administrator.provision', { accountId: account.accountId });
    return { ...account, created: rowCount > 0 };
  });
}

async function listSchools(db, url) {
  const page = integer(Number(url.searchParams.get('page') ?? '1'), 1, 100000, '页码');
  const { rows } = await db.query(`SELECT ${schoolFields} FROM schools ORDER BY name, id LIMIT 51 OFFSET $1`, [(page - 1) * 50]);
  const items = [];
  for (const school of rows.slice(0, 50)) {
    // Aggregate only after platform authorization; course RLS still requires a
    // transaction-local school context and never exposes chapter bodies here.
    await db.query("SELECT set_config('campus.school_id',$1,true)", [school.id]);
    const { rows: [counts] } = await db.query(`
      SELECT
        ((SELECT count(*) FROM school_memberships m JOIN accounts a ON a.id=m.account_id
          JOIN identities i ON i.id=a.identity_id WHERE m.school_id=$1 AND m.revoked_at IS NULL
            AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL)
          + (SELECT count(*) FROM legacy_school_account_ownership o JOIN accounts a ON a.id=o.account_id
            JOIN identities i ON i.id=a.identity_id WHERE o.school_id=$1
              AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL))::int members,
        ((SELECT count(*) FROM school_identities WHERE school_id=$1)
          + (SELECT count(*) FROM legacy_school_identity_ownership WHERE school_id=$1))::int identities,
        ((SELECT count(*) FROM school_classes WHERE school_id=$1)
          + (SELECT count(*) FROM classes WHERE school_id=$1))::int classes,
        (SELECT count(*)::int FROM problem_banks WHERE school_id=$1) banks,
        ((SELECT count(*) FROM learning_paths WHERE school_id=$1)
          + (SELECT count(*) FROM school_courses WHERE school_id=$1))::int courses,
        (SELECT count(*)::int FROM assignments WHERE school_id=$1) assignments,
        (SELECT count(*)::int FROM paper4_papers WHERE school_id=$1) papers`, [school.id]);
    const { rows: administrators } = await db.query(school.id === LEGACY_SCHOOL_ID ? `
      SELECT a.id AS "accountId", i.name, a.username, 'legacy' AS source
      FROM accounts a JOIN identities i ON i.id=a.identity_id
      JOIN account_roles r ON r.account_id=a.id AND r.role='admin'
      JOIN legacy_school_account_ownership o ON o.account_id=a.id AND o.school_id=$1
      WHERE a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
      ORDER BY i.name,a.id` : `
      SELECT a.id AS "accountId", i.name, a.username,
        CASE WHEN g.account_id IS NOT NULL THEN 'grant' ELSE 'membership' END AS source
      FROM school_memberships m JOIN accounts a ON a.id=m.account_id JOIN identities i ON i.id=a.identity_id
      LEFT JOIN school_administrators g ON g.school_id=m.school_id AND g.account_id=m.account_id AND g.revoked_at IS NULL
      WHERE m.school_id=$1 AND m.revoked_at IS NULL AND (m.role='school_admin' OR g.account_id IS NOT NULL)
        AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
      ORDER BY i.name,a.id`, [school.id]);
    items.push({ ...schoolShape(school), counts, administrators });
  }
  return result({ items, page, hasMore: rows.length > 50 });
}

async function searchSchoolAdminCandidates(db, url) {
  const term = field(url.searchParams.get('q') ?? '', '搜索内容', { min: 0, max: 100 }).toLowerCase();
  if (term.length < 2) return result({ items: [] });
  const { rows } = await db.query(`
    SELECT a.id AS "accountId", i.name, a.username
    FROM accounts a JOIN identities i ON i.id = a.identity_id
    WHERE a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
      AND (strpos(a.username, $1) > 0 OR strpos(lower(i.name), $1) > 0)
    ORDER BY (a.username = $1) DESC, (lower(i.name) = $1) DESC, a.username
    LIMIT 12`, [term]);
  return result({ items: rows });
}

function validateSchool(body) {
  // The form sends a stable request ID so a lost response can be retried
  // against the same generated code. Existing clients can still supply a slug.
  const slug = body.slug === undefined
    ? `school-${uuid(body.requestId, '请求 ID').toLowerCase()}`
    : field(body.slug, '学校标识', { min: 3, max: 50 });
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug) || slug === 'legacy-school') {
    fail(400, 'VALIDATION', '学校标识须使用 3–50 个小写字母、数字或短横线');
  }
  return { slug, name: field(body.name, '学校名称', { max: 100 }) };
}

async function createSchool(db, actorId, body) {
  const { slug, name } = validateSchool(body);
  const account = await findActiveAccount(db, body.adminUsername, { accountId: body.adminAccountId });
  // The unique slug doubles as the create request's stable idempotency key.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-provision:' || $1, 0))", [slug]);
  const { rows: [existing] } = await db.query(`SELECT ${schoolFields} FROM schools WHERE slug=$1`, [slug]);
  if (existing) {
    const { rowCount } = await db.query(`
      SELECT 1 FROM school_memberships m WHERE m.school_id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL
        AND (m.role='school_admin' OR EXISTS (SELECT 1 FROM school_administrators g
          WHERE g.school_id=m.school_id AND g.account_id=m.account_id AND g.revoked_at IS NULL))`, [existing.id, account.accountId]);
    if (existing.name !== name || !rowCount) fail(409, 'CONFLICT', '学校标识已存在');
    return result(schoolShape(existing));
  }
  const { rows: [school] } = await db.query(`INSERT INTO schools (slug,name) VALUES ($1,$2) RETURNING ${schoolFields}`, [slug,name]);
  await db.query(`INSERT INTO school_memberships (school_id,account_id,role) VALUES ($1,$2,'school_admin')`, [school.id,account.accountId]);
  await auditSchool(db, school.id, actorId, 'school.provision', account.accountId);
  await auditPlatform(db, actorId, 'platform.school.create', { schoolId: school.id, accountId: account.accountId });
  return result(schoolShape(school), 201);
}

async function renameSchool(db, actorId, schoolId, body) {
  const name = field(body.name, '学校名称', { max: 100 });
  const expectedName = field(body.expectedName, '原学校名称', { max: 100 });
  const { rows: [school] } = await db.query(`SELECT ${schoolFields} FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
  if (!school) fail(404, 'NOT_FOUND', '学校不存在');
  if (school.name === name) return result(schoolShape(school));
  if (school.name !== expectedName) fail(409, 'STALE_SCHOOL', '学校名称已变更，请刷新后重试');
  const { rows: [updated] } = await db.query(`UPDATE schools SET name=$2 WHERE id=$1 RETURNING ${schoolFields}`, [schoolId,name]);
  if (schoolId === LEGACY_SCHOOL_ID) {
    await db.query(`UPDATE site_settings SET settings=jsonb_set(settings,'{schoolName}',to_jsonb($1::text)),
      updated_at=now() WHERE id=true`, [name]);
  }
  await auditPlatform(db, actorId, 'platform.school.rename', { schoolId, detail: { before: school.name, after: name } });
  return result(schoolShape(updated));
}

async function appointAdministrator(db, actorId, schoolId, body) {
  if (schoolId === LEGACY_SCHOOL_ID) fail(409, 'LEGACY_ADMIN_MANAGEMENT', '原学校管理员仍按原角色管理，暂不支持平台任命');
  const { rowCount } = await db.query('SELECT id FROM schools WHERE id=$1 FOR SHARE', [schoolId]);
  if (!rowCount) fail(404, 'NOT_FOUND', '学校不存在');
  const account = await findActiveAccount(db, body.username);
  await lockSchoolTeaching(db, schoolId);
  await db.query(`
    INSERT INTO school_memberships (school_id,account_id,role) VALUES ($1,$2,'school_admin')
    ON CONFLICT (school_id,account_id) DO UPDATE SET revoked_at=NULL, joined_at=clock_timestamp()
    WHERE school_memberships.revoked_at IS NOT NULL`, [schoolId,account.accountId]);
  const { rowCount: granted } = await db.query(`
    INSERT INTO school_administrators (school_id,account_id,granted_by) VALUES ($1,$2,$3)
    ON CONFLICT (school_id,account_id) DO UPDATE SET granted_by=EXCLUDED.granted_by,
      granted_at=clock_timestamp(), revoked_at=NULL
    WHERE school_administrators.revoked_at IS NOT NULL`, [schoolId,account.accountId,actorId]);
  if (granted) {
    await auditSchool(db, schoolId, actorId, 'school.administrator.grant', account.accountId);
    await auditPlatform(db, actorId, 'platform.school.administrator.grant', { schoolId, accountId: account.accountId });
  }
  return result({ ...account, source: 'grant', created: granted > 0 });
}

export async function handlePlatformGovernance({ pool,user,route,method,body,url }) {
  const searching = route === '/platform/school-admin-candidates' && method === 'GET';
  const match = route.match(/^\/platform\/schools(?:\/([^/]+)(?:\/(administrators))?)?$/);
  if (!searching && !match) return null;
  const schoolId = match?.[1] ? uuid(match[1], '学校 ID') : null;
  return transaction(pool, async db => {
    await requirePlatformAdministrator(db, user.id);
    if (searching) return searchSchoolAdminCandidates(db,url);
    if (!schoolId && method === 'GET') return listSchools(db,url);
    if (!schoolId && method === 'POST') return createSchool(db,user.id,body);
    if (schoolId && !match[2] && method === 'PATCH') return renameSchool(db,user.id,schoolId,body);
    if (schoolId && match[2] === 'administrators' && method === 'POST') return appointAdministrator(db,user.id,schoolId,body);
    return null;
  });
}
