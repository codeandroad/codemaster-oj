import { transaction } from './db.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import { auditSchool, lockSchoolTeaching, requireSchoolAdmin, schoolCredentialCustodySql } from './schools.mjs';

const accountDirectory = `FROM school_memberships m
  JOIN accounts a ON a.id=m.account_id AND a.binding_released_at IS NULL
  JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
  LEFT JOIN school_identities si ON si.school_id=m.school_id AND si.account_id=a.id AND si.archived_at IS NULL
  LEFT JOIN school_administrators g ON g.school_id=m.school_id AND g.account_id=a.id AND g.revoked_at IS NULL`;

const editableRoles = `m.role <> 'school_admin' AND a.disabled_at IS NULL
  AND (g.account_id IS NULL OR g.delegated_by_school)
  AND NOT EXISTS (SELECT 1 FROM platform_admins p WHERE p.account_id=a.id AND p.revoked_at IS NULL)`;

async function readAccounts(db, schoolId, accountId, url, actorId) {
  const params = url.searchParams;
  const page = integer(Number(params.get('page') ?? 1), 1, 100000, '页码');
  const q = field(params.get('q') ?? '', '关键词', { min: 0, max: 100 });
  const role = enumValue(params.get('role') ?? 'all', ['all','student','teacher','school_admin'], '角色');
  const status = enumValue(params.get('status') ?? 'all', ['all','enabled','disabled'], '状态');
  const className = field(params.get('className') ?? '', '班级名称', { min:0, max:100 });
  const {rows} = await db.query(`SELECT a.id AS "accountId", a.username, coalesce(si.name,i.name) AS name, si.number,
    si.id AS "identityId", si.gender, m.role, m.joined_at AS "joinedAt",
    (m.role='school_admin' OR g.account_id IS NOT NULL) AS administrator, a.disabled_at IS NOT NULL AS disabled,
    custody.managed AND a.disabled_at IS NULL AS "canResetPassword",
    (a.id<>$8 AND ${editableRoles}) AS "canEditRoles",
    CASE WHEN custody.managed THEN a.last_login_at END AS "lastLoginAt",
    ARRAY(SELECT c.name FROM school_class_roster r JOIN school_classes c ON c.school_id=r.school_id AND c.id=r.class_id
      WHERE r.school_id=m.school_id AND r.identity_id=si.id AND c.archived_at IS NULL ORDER BY c.name,c.id) AS classes
    ${accountDirectory}
    CROSS JOIN LATERAL (SELECT (${schoolCredentialCustodySql}) AS managed) custody
    WHERE m.school_id=$1 AND m.revoked_at IS NULL AND ($2::uuid IS NULL OR a.id=$2)
      AND ($3='' OR strpos(lower(coalesce(si.name,i.name)),lower($3))>0 OR strpos(a.username,lower($3))>0 OR strpos(lower(si.number),lower($3))>0)
      AND ($4='all' OR m.role=$4 OR ($4 IN ('school_admin','teacher') AND (m.role='school_admin' OR g.account_id IS NOT NULL)))
      AND ($5='all' OR (a.disabled_at IS NOT NULL)=($5='disabled'))
      AND ($6='' OR EXISTS (SELECT 1 FROM school_class_roster r JOIN school_classes c
        ON c.school_id=r.school_id AND c.id=r.class_id WHERE r.school_id=m.school_id AND r.identity_id=si.id
        AND c.archived_at IS NULL AND strpos(lower(c.name),lower($6))>0))
    ORDER BY coalesce(si.name,i.name),a.id LIMIT 51 OFFSET $7`, [schoolId,accountId,q,role,status,className,(page-1)*50,actorId]);
  if (!accountId) return { items:rows.slice(0,50), page, hasMore:rows.length>50 };
  if (!rows.length) fail(404,'NOT_FOUND','本校账号不存在');
  const { rows: events } = await db.query(`SELECT action,created_at AS "createdAt" FROM audit_events
    WHERE resource_type='account' AND resource_id=$1 AND metadata->>'schoolId'=$2
    ORDER BY id DESC LIMIT 8`, [accountId,schoolId]);
  return { ...rows[0], events };
}

async function editRoles(db, schoolId, accountId, actorId, body) {
  const role = enumValue(body.role, ['student','teacher'], '成员角色');
  const expectedRole = enumValue(body.expectedRole, ['student','teacher'], '原成员角色');
  if (typeof body.administrator !== 'boolean' || typeof body.expectedAdministrator !== 'boolean') {
    fail(400,'VALIDATION','请确认本校管理权限');
  }
  // Platform grants lock the target credential. Check protected roles in a fresh
  // statement after the lock, including changes committed while we waited.
  const locked = await db.query(`SELECT a.id FROM accounts a JOIN school_memberships m ON m.account_id=a.id
    WHERE m.school_id=$1 AND a.id=$2 AND m.revoked_at IS NULL FOR UPDATE OF a,m`,[schoolId,accountId]);
  if (!locked.rowCount) fail(404,'NOT_FOUND','本校成员不存在');
  const {rows:[target]} = await db.query(`SELECT m.role, si.id AS identity, (g.account_id IS NOT NULL) AS administrator,
    (${editableRoles}) AS editable ${accountDirectory}
    WHERE m.school_id=$1 AND a.id=$2 AND m.revoked_at IS NULL`, [schoolId,accountId]);
  if (!target) fail(404,'NOT_FOUND','本校成员不存在');
  if (accountId===actorId || !target.editable) fail(403,'FORBIDDEN','此成员的角色受保护');
  if (target.role===role && target.administrator===body.administrator) return;
  if (target.role!==expectedRole || target.administrator!==body.expectedAdministrator) fail(409,'ROLE_CHANGED','成员角色已变化，请刷新后重试');
  if (target.role!==role) {
    if (target.identity) fail(409,'IDENTITY_ROLE_BOUND','请先在校内身份档案解除原关联，再更改基础角色并关联相应档案');
    await db.query('UPDATE school_memberships SET role=$3 WHERE school_id=$1 AND account_id=$2',[schoolId,accountId,role]);
  }
  if (body.administrator!==target.administrator) {
    if (body.administrator) {
      await db.query(`INSERT INTO school_administrators(school_id,account_id,granted_by,delegated_by_school)
        VALUES($1,$2,$3,true) ON CONFLICT(school_id,account_id) DO UPDATE SET granted_by=$3,
          granted_at=now(),revoked_at=NULL,delegated_by_school=true WHERE school_administrators.revoked_at IS NOT NULL`,[schoolId,accountId,actorId]);
    } else {
      await db.query('UPDATE school_administrators SET revoked_at=now() WHERE school_id=$1 AND account_id=$2 AND delegated_by_school',[schoolId,accountId]);
    }
  }
  await auditSchool(db,schoolId,actorId,'school.account.roles',accountId);
  await db.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata)
    VALUES($1,'school.account.roles','account',$2,$3)`,[actorId,accountId,{schoolId,role,administrator:body.administrator,previousRole:target.role,previousAdministrator:target.administrator}]);
}

export async function handleSchoolAccounts({ pool, user, route, method, url, body }) {
  const match = route.match(/^\/schools\/([^/]+)\/accounts(?:\/([^/]+)(?:\/(roles))?)?$/);
  if (!match) return null;
  const schoolId = uuid(match[1], '学校 ID');
  const accountId = match[2] ? uuid(match[2], '账号 ID') : null;
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId, {shared:method==='GET'});
    await requireSchoolAdmin(db, schoolId, user.id);
    if (!match[3] && method==='GET') return { status:200, body:await readAccounts(db,schoolId,accountId,url,user.id) };
    if (match[3]==='roles' && method==='PATCH') {
      await editRoles(db,schoolId,accountId,user.id,body);
      return {status:200,body:{ok:true}};
    }
    return null;
  });
}
