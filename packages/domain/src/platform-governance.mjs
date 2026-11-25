import { transaction } from './db.mjs';
import { issuePasswordResetCode } from './password-reset-tokens.mjs';
import { enumValue, fail, field, integer, tokenHash, username, uuid } from './security.mjs';
import { activeAccount, auditSchool, lockSchoolTeaching } from './schools.mjs';

const result = (body, status = 200) => ({ status, body });
const schoolFields = 'id, slug, name, name_zh AS "nameZh", name_en AS "nameEn", settings_revision AS revision, created_at AS "createdAt"';


export async function isPlatformAdministrator(db, accountId) {
  const { rowCount } = await db.query(`
    SELECT 1 FROM platform_admins p
    JOIN accounts a ON a.id = p.account_id JOIN identities i ON i.id = a.identity_id
    WHERE p.account_id = $1 AND p.revoked_at IS NULL AND a.disabled_at IS NULL
      AND a.binding_released_at IS NULL AND i.archived_at IS NULL`, [accountId]);
  return rowCount > 0;
}

export async function requirePlatformAdministrator(db, accountId, issuedAt = null) {
  await activeAccount(db, accountId);
  // Runtime has SELECT-only access to platform grants. Capability maintenance
  // locks the credential first, so the account lock above serializes with it
  // without granting the API UPDATE rights on its own authorization table.
  const { rowCount } = await db.query(`
    SELECT account_id FROM platform_admins WHERE account_id = $1 AND revoked_at IS NULL
      AND ($2::timestamptz IS NULL OR granted_at <= $2)`, [accountId,issuedAt]);
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
        (SELECT count(*) FROM school_memberships m JOIN accounts a ON a.id=m.account_id
          JOIN identities i ON i.id=a.identity_id WHERE m.school_id=$1 AND m.revoked_at IS NULL
            AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL)::int members,
        (SELECT count(*)::int FROM school_identities WHERE school_id=$1) identities,
        (SELECT count(*)::int FROM school_classes WHERE school_id=$1) classes,
        (SELECT count(*)::int FROM school_problem_banks WHERE school_id=$1 AND resource_kind='ordinary') banks,
        (SELECT count(*)::int FROM school_courses WHERE school_id=$1) courses,
        (SELECT count(*)::int FROM school_activities WHERE school_id=$1 AND kind='assignment') assignments,
        (SELECT count(*)::int FROM school_paper4_papers WHERE school_id=$1) papers`, [school.id]);
    const { rows: administrators } = await db.query(`
      SELECT a.id AS "accountId", i.name, a.username,
        CASE WHEN g.account_id IS NOT NULL THEN 'grant' ELSE 'membership' END AS source
      FROM school_memberships m JOIN accounts a ON a.id=m.account_id JOIN identities i ON i.id=a.identity_id
      LEFT JOIN school_administrators g ON g.school_id=m.school_id AND g.account_id=m.account_id AND g.revoked_at IS NULL
      WHERE m.school_id=$1 AND m.revoked_at IS NULL AND (m.role='school_admin' OR g.account_id IS NOT NULL)
        AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
      ORDER BY i.name,a.id`, [school.id]);
    items.push({ ...school, counts, administrators });
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

const loginAccount = `FROM accounts a JOIN identities i ON i.id=a.identity_id
  WHERE a.binding_released_at IS NULL AND i.archived_at IS NULL`;
const platformGrant = 'EXISTS (SELECT 1 FROM platform_admins p WHERE p.account_id=a.id AND p.revoked_at IS NULL)';
const canResetPassword = `a.disabled_at IS NULL AND NOT ${platformGrant}`;
const schoolAdmin = `i.kind='admin' OR EXISTS (SELECT 1 FROM school_memberships m
  WHERE m.account_id=a.id AND m.role='school_admin' AND (m.revoked_at IS NULL OR m.suspended))
  OR EXISTS (SELECT 1 FROM school_administrators g WHERE g.account_id=a.id AND g.revoked_at IS NULL)`;

export async function lockPlatformResetTarget(db, accountId) {
  const query = `SELECT a.username,(${schoolAdmin}) AS "schoolAdmin" ${loginAccount} AND a.id=$1 AND ${canResetPassword}`;
  if (!(await db.query(query+' FOR UPDATE OF a',[accountId])).rowCount) return null;
  // An enrollment or grant could have committed while we waited for the account.
  return (await db.query(query,[accountId])).rows[0];
}

async function issuePlatformReset(db, actorId, accountId, body) {
  const note = field(body.verificationNote, '人工核验记录', {max:300});
  const account = await lockPlatformResetTarget(db, accountId);
  if (!account) fail(403,'ACCOUNT_RESET_UNAVAILABLE','此账号无法通过平台管理页面重置密码');
  const resetCode = await issuePasswordResetCode(db, accountId, actorId, account.schoolAdmin ? 'platform-school-admin' : 'platform');
  await auditPlatform(db,actorId,'platform.password_reset.issue',{accountId,detail:{verificationNote:note}});
  return result({username:account.username,resetCode});
}

// The migration owner runs this from the deployment CLI. Runtime grants allow
// checking the proof on redemption but never creating or replacing one.
export async function issueDeploymentReset(pool, rawUsername, verificationNote) {
  const note = field(verificationNote, '人工核验记录', {max:300});
  return transaction(pool, async db => {
    const account = await findActiveAccount(db, rawUsername, {exclusive:true});
    await requirePlatformAdministrator(db, account.accountId);
    const code = await issuePasswordResetCode(db, account.accountId, null, 'deployment');
    const {rows:[operator]} = await db.query(`INSERT INTO platform_admin_recovery_issues(account_id,token_hash,granted_at,expires_at)
      SELECT p.account_id,t.token_hash,p.granted_at,t.expires_at
      FROM platform_admins p JOIN reset_tokens t USING(account_id)
      WHERE p.account_id=$1 AND p.revoked_at IS NULL AND t.token_hash=$2
      ON CONFLICT(account_id) DO UPDATE SET token_hash=excluded.token_hash,granted_at=excluded.granted_at,expires_at=excluded.expires_at
      RETURNING current_user AS name`,[account.accountId,tokenHash(code)]);
    if (!operator) fail(409,'GRANT_CHANGED','平台授权已变更，请重新核验');
    await auditPlatform(db,null,'deployment.password_reset.issue',{
      accountId:account.accountId,detail:{operator:operator.name,verificationNote:note},
    });
    return {username:account.username,resetCode:code};
  });
}

const accountFields = `a.id AS "accountId",a.username,i.name,a.created_at AS "createdAt",
  a.last_login_at AS "lastLoginAt",a.disabled_at AS "disabledAt",a.disabled_at IS NOT NULL AS disabled,
  ${platformGrant} AS "platformAdmin",(${schoolAdmin}) AS "schoolAdmin",(${canResetPassword}) AS "canResetPassword"`;
const directoryMembership = 'm.account_id=a.id AND (m.revoked_at IS NULL OR m.suspended)';
const additionalSchoolAdmin = `EXISTS (SELECT 1 FROM school_administrators g
  WHERE g.school_id=m.school_id AND g.account_id=m.account_id AND g.revoked_at IS NULL)`;

function accountSchools({details = false} = {}) {
  return `(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'nameZh',s.name_zh,'nameEn',s.name_en,'slug',s.slug,
      'roles',CASE WHEN m.role<>'school_admin' AND ${additionalSchoolAdmin}
        THEN ARRAY[m.role,'school_admin'] ELSE ARRAY[m.role] END,
      'suspended',m.suspended
      ${details ? `, 'joinedAt',m.joined_at, 'identity',
        CASE WHEN dossier.id IS NOT NULL THEN jsonb_build_object('name',dossier.name,'number',dossier.number) END` : ''}
    ) ORDER BY s.name,s.id),'[]'::jsonb)
    FROM school_memberships m JOIN schools s ON s.id=m.school_id
    ${details ? `LEFT JOIN school_identities dossier ON dossier.school_id=m.school_id
      AND dossier.account_id=m.account_id AND dossier.archived_at IS NULL` : ''}
    WHERE ${directoryMembership}) AS schools`;
}

const accountOrders = {
  username: 'a.username,a."accountId"',
  recent: 'a."lastLoginAt" DESC NULLS LAST,a.username,a."accountId"',
  newest: 'a."createdAt" DESC,a.username,a."accountId"',
};
const ACCOUNT_PAGE_SIZE = 50;

async function listLoginAccounts(db, url) {
  const page = integer(Number(url.searchParams.get('page') ?? 1),1,100000,'页码');
  const term = field(url.searchParams.get('q') ?? '', '关键词', {min:0,max:100}).toLowerCase();
  const status = enumValue(url.searchParams.get('status') ?? 'all', ['all','enabled','disabled'], '平台登录状态');
  const role = enumValue(url.searchParams.get('role') ?? 'all',
    ['all','platform_admin','school_admin','teacher','student'], '角色');
  const school = url.searchParams.get('schoolId') ?? 'all';
  const schoolId = school === 'all' || school === 'none' ? null : uuid(school,'学校 ID');
  const sort = enumValue(url.searchParams.get('sort') ?? 'username', Object.keys(accountOrders), '排序');
  const order = accountOrders[sort];
  // A school role and school filter must match the same membership.
  const {rows:[directory]} = await db.query(`
    WITH filtered AS (
      SELECT a.id AS "accountId",a.username,a.created_at AS "createdAt",a.last_login_at AS "lastLoginAt" ${loginAccount}
      AND ($1='' OR strpos(lower(a.username),$1)>0 OR strpos(lower(i.name),$1)>0
        OR EXISTS (SELECT 1 FROM school_identities dossier JOIN school_memberships m
          ON (m.school_id,m.account_id)=(dossier.school_id,dossier.account_id)
          WHERE ${directoryMembership} AND dossier.archived_at IS NULL
            AND ($4::uuid IS NULL OR dossier.school_id=$4)
            AND (strpos(lower(dossier.number),$1)>0 OR strpos(lower(dossier.name),$1)>0)))
      AND ($2='all' OR (a.disabled_at IS NOT NULL)=($2='disabled'))
      AND ($3<>'platform_admin' OR ${platformGrant})
      AND (NOT $5::boolean OR NOT EXISTS (SELECT 1 FROM school_memberships m WHERE ${directoryMembership}))
      AND (($4::uuid IS NULL AND $3 IN ('all','platform_admin')) OR EXISTS (
        SELECT 1 FROM school_memberships m WHERE ${directoryMembership}
          AND ($4::uuid IS NULL OR m.school_id=$4)
          AND ($3 IN ('all','platform_admin') OR m.role=$3 OR ($3='school_admin' AND ${additionalSchoolAdmin}))))
    ), paginated AS (
      SELECT * FROM filtered a ORDER BY ${order} LIMIT $6 OFFSET $7
    ), enriched AS (
      SELECT ${accountFields}, ${accountSchools()}
      FROM paginated p JOIN accounts a ON a.id=p."accountId" JOIN identities i ON i.id=a.identity_id
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total, coalesce((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY ${order}) FROM enriched a
    ),'[]'::jsonb) AS items`, [term,status,role,schoolId,school==='none',ACCOUNT_PAGE_SIZE,(page-1)*ACCOUNT_PAGE_SIZE]);
  return result({...directory,page,hasMore:page*ACCOUNT_PAGE_SIZE<directory.total});
}

async function accountFilterSchools(db) {
  const {rows} = await db.query(`SELECT id,name,slug,name_zh AS "nameZh",name_en AS "nameEn"
    FROM schools ORDER BY name,id`);
  return result({schools:rows});
}

async function loginAccountDetail(db, accountId) {
  const {rows:[account]} = await db.query(`SELECT ${accountFields}, ${accountSchools({details:true})}
    ${loginAccount} AND a.id=$1`, [accountId]);
  if (!account) fail(404,'NOT_FOUND','账号不存在');
  const {rows: events} = await db.query(`
    SELECT e.id,e.action,e.created_at AS "createdAt",actor.username AS "actorUsername"
    FROM platform_audit_events e LEFT JOIN accounts actor ON actor.id=e.actor_account_id
    WHERE e.target_account_id=$1 AND e.action IN (
      'platform.administrator.provision','platform.password_reset.issue','deployment.password_reset.issue',
      'platform.login.disable','platform.login.restore')
    ORDER BY e.created_at DESC,e.id DESC LIMIT 12`, [accountId]);
  return result({...account,events});
}

async function setPlatformLogin(db, actorId, accountId, disabled) {
  if (typeof disabled !== 'boolean') fail(400,'VALIDATION','请指定平台登录状态');
  const protectedAccount = () => fail(403,'PROTECTED_ACCOUNT','平台管理员账号受保护');
  if (actorId===accountId) protectedAccount();
  // Don't queue a write lock on a peer administrator's credential. Re-check
  // after the lock to account for concurrent provisioning of a new admin.
  const {rows:[candidate]} = await db.query(`SELECT ${platformGrant} AS protected ${loginAccount} AND a.id=$1`, [accountId]);
  if (!candidate) fail(404,'NOT_FOUND','账号不存在');
  if (candidate.protected) protectedAccount();
  const {rows:[target]} = await db.query(`SELECT a.disabled_at IS NOT NULL AS disabled ${loginAccount}
    AND a.id=$1 FOR UPDATE OF a FOR SHARE OF i`,[accountId]);
  if (!target) fail(404,'NOT_FOUND','账号不存在');
  if ((await db.query('SELECT 1 FROM platform_admins WHERE account_id=$1 AND revoked_at IS NULL',[accountId])).rowCount) protectedAccount();
  if (disabled!==target.disabled) {
    await db.query('UPDATE accounts SET disabled_at=CASE WHEN $2::boolean THEN clock_timestamp() END WHERE id=$1',[accountId,disabled]);
    // Purge sessions on restoration as well: older disabled accounts may have
    // retained dormant sessions or reset credentials from before migration.
    await db.query('DELETE FROM sessions WHERE account_id=$1',[accountId]);
    await db.query('UPDATE reset_tokens SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[accountId]);
    await auditPlatform(db,actorId,disabled ? 'platform.login.disable' : 'platform.login.restore',{accountId});
  }
  return result({disabled});
}

function validateSchool(body) {
  // The form sends a stable request ID so a lost response can be retried
  // against the same generated code. Existing clients can still supply a slug.
  const slug = body.slug === undefined
    ? `school-${uuid(body.requestId, '请求 ID').toLowerCase()}`
    : field(body.slug, '学校标识', { min: 3, max: 50 });
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
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
    return result(existing);
  }
  const { rows: [school] } = await db.query(`INSERT INTO schools (slug,name) VALUES ($1,$2) RETURNING ${schoolFields}`, [slug,name]);
  await db.query(`INSERT INTO school_memberships (school_id,account_id,role) VALUES ($1,$2,'school_admin')`, [school.id,account.accountId]);
  await auditSchool(db, school.id, actorId, 'school.provision', account.accountId);
  await auditPlatform(db, actorId, 'platform.school.create', { schoolId: school.id, accountId: account.accountId });
  return result(school, 201);
}

async function renameSchool(db, actorId, schoolId, body) {
  const name = field(body.name, '学校名称', { max: 100 });
  const expectedName = field(body.expectedName, '原学校名称', { max: 100 });
  const { rows: [school] } = await db.query(`SELECT ${schoolFields} FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
  if (!school) fail(404, 'NOT_FOUND', '学校不存在');
  if (school.name === name) return result(school);
  if (school.name !== expectedName) fail(409, 'STALE_SCHOOL', '学校名称已变更，请刷新后重试');
  const { rows: [updated] } = await db.query(`UPDATE schools SET name=$2 WHERE id=$1 RETURNING ${schoolFields}`, [schoolId,name]);
  await auditPlatform(db, actorId, 'platform.school.rename', { schoolId, detail: { before: school.name, after: name } });
  return result(updated);
}

async function appointAdministrator(db, actorId, schoolId, body) {
  const { rowCount } = await db.query('SELECT id FROM schools WHERE id=$1 FOR SHARE', [schoolId]);
  if (!rowCount) fail(404, 'NOT_FOUND', '学校不存在');
  await lockSchoolTeaching(db, schoolId);
  const account = await findActiveAccount(db, body.username);
  if ((await db.query('SELECT 1 FROM school_memberships WHERE school_id=$1 AND account_id=$2 AND suspended',[schoolId,account.accountId])).rowCount) {
    fail(409,'SCHOOL_ACCESS_SUSPENDED','请先由学校管理员恢复此成员的本校访问');
  }
  await db.query(`
    INSERT INTO school_memberships (school_id,account_id,role) VALUES ($1,$2,'school_admin')
    ON CONFLICT (school_id,account_id) DO UPDATE SET revoked_at=NULL, joined_at=clock_timestamp()
    WHERE school_memberships.revoked_at IS NOT NULL`, [schoolId,account.accountId]);
  const { rowCount: granted } = await db.query(`
    INSERT INTO school_administrators (school_id,account_id,granted_by) VALUES ($1,$2,$3)
    ON CONFLICT (school_id,account_id) DO UPDATE SET granted_by=EXCLUDED.granted_by,
      granted_at=clock_timestamp(), revoked_at=NULL, delegated_by_school=false
    WHERE school_administrators.revoked_at IS NOT NULL OR school_administrators.delegated_by_school`, [schoolId,account.accountId,actorId]);
  if (granted) {
    await auditSchool(db, schoolId, actorId, 'school.administrator.grant', account.accountId);
    await auditPlatform(db, actorId, 'platform.school.administrator.grant', { schoolId, accountId: account.accountId });
  }
  return result({ ...account, source: 'grant', created: granted > 0 });
}

export async function handlePlatformGovernance({ pool,user,route,method,body,url }) {
  const searching = route === '/platform/school-admin-candidates' && method === 'GET';
  const accounts = route === '/platform/accounts' && method === 'GET';
  const account = method === 'GET' && route.match(/^\/platform\/accounts\/([^/]+)$/);
  const login = method === 'PATCH' && route.match(/^\/platform\/accounts\/([^/]+)\/login$/);
  const reset = method === 'POST' && route.match(/^\/platform\/accounts\/([^/]+)\/reset$/);
  const match = route.match(/^\/platform\/schools(?:\/([^/]+)(?:\/(administrators))?)?$/);
  if (!searching && !match && !accounts && !account && !login && !reset) return null;
  const schoolId = match?.[1] ? uuid(match[1], '学校 ID') : null;
  return transaction(pool, async db => {
    await requirePlatformAdministrator(db, user.id);
    if (accounts) return listLoginAccounts(db,url);
    if (account) return account[1] === 'filters' ? accountFilterSchools(db) : loginAccountDetail(db,uuid(account[1],'账号 ID'));
    if (reset) return issuePlatformReset(db,user.id,uuid(reset[1],'账号 ID'),body);
    if (login) return setPlatformLogin(db,user.id,uuid(login[1],'账号 ID'),body.disabled);
    if (searching) return searchSchoolAdminCandidates(db,url);
    if (!schoolId && method === 'GET') return listSchools(db,url);
    if (!schoolId && method === 'POST') return createSchool(db,user.id,body);
    if (schoolId && !match[2] && method === 'PATCH') return renameSchool(db,user.id,schoolId,body);
    if (schoolId && match[2] === 'administrators' && method === 'POST') return appointAdministrator(db,user.id,schoolId,body);
    return null;
  });
}
