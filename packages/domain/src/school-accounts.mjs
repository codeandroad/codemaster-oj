import { transaction } from './db.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import { lockSchoolTeaching, requireSchoolAdmin, schoolCredentialCustodySql } from './schools.mjs';

const accountDirectory = `FROM school_memberships m
  JOIN accounts a ON a.id=m.account_id AND a.binding_released_at IS NULL
  JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
  LEFT JOIN school_identities si ON si.school_id=m.school_id AND si.account_id=a.id AND si.archived_at IS NULL
  LEFT JOIN school_administrators g ON g.school_id=m.school_id AND g.account_id=a.id AND g.revoked_at IS NULL`;

async function readAccounts(db, schoolId, accountId, url) {
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
    ORDER BY coalesce(si.name,i.name),a.id LIMIT 51 OFFSET $7`, [schoolId,accountId,q,role,status,className,(page-1)*50]);
  if (!accountId) return { items:rows.slice(0,50), page, hasMore:rows.length>50 };
  if (!rows.length) fail(404,'NOT_FOUND','本校账号不存在');
  const { rows: events } = await db.query(`SELECT action,created_at AS "createdAt" FROM audit_events
    WHERE resource_type='account' AND resource_id=$1 AND metadata->>'schoolId'=$2
    ORDER BY id DESC LIMIT 8`, [accountId,schoolId]);
  return { ...rows[0], events };
}

export async function handleSchoolAccounts({ pool, user, route, method, url }) {
  const match = route.match(/^\/schools\/([^/]+)\/accounts(?:\/([^/]+))?$/);
  if (!match || method !== 'GET') return null;
  const schoolId = uuid(match[1], '学校 ID');
  const accountId = match[2] ? uuid(match[2], '账号 ID') : null;
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId, {shared:true});
    await requireSchoolAdmin(db, schoolId, user.id);
    return { status:200, body:await readAccounts(db,schoolId,accountId,url) };
  });
}
