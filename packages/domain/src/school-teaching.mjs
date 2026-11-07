import { transaction } from './db.mjs';
import { auditSchool, lockSchoolTeaching, requireSchoolAdmin, schoolRole } from './schools.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';

const PAGE_SIZE = 50;
const IDENTITY_KINDS = ['student', 'teacher'];
const identityFields = 'id, kind, number, name, account_id AS "accountId", created_at AS "createdAt"';
const assignedTeacher = `EXISTS (
  SELECT 1 FROM school_class_roster r
  JOIN school_identities i ON i.school_id = r.school_id AND i.id = r.identity_id
  WHERE r.school_id = c.school_id AND r.class_id = c.id
    AND i.kind = 'teacher' AND i.account_id = $2
)`;

function pageResult(page, rows) {
  return { status: 200, body: { items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE } };
}

function requestedPage(url) {
  return integer(Number(url.searchParams.get('page') ?? '1'), 1, 100000, '页码');
}

function requestedKind(url) {
  if (!url.searchParams.has('kind')) return null;
  return enumValue(url.searchParams.get('kind'), IDENTITY_KINDS, '身份类型');
}

async function requireMatchingMember(db, schoolId, accountId, kind) {
  if (accountId === null) return;
  // Lock membership before touching the identity, as membership revocation does.
  const { rows: [member] } = await db.query(`
    SELECT m.role FROM school_memberships m
    JOIN accounts a ON a.id = m.account_id
    JOIN identities i ON i.id = a.identity_id
    WHERE m.school_id = $1 AND m.account_id = $2 AND m.revoked_at IS NULL
      AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
    FOR SHARE OF m, a, i`, [schoolId, accountId]);
  if (!member) fail(404, 'NOT_FOUND', '未找到本校有效成员');
  if (member.role !== kind) fail(400, 'VALIDATION', '成员角色须与身份类型一致');
}

async function listIdentities(db, schoolId, url) {
  const page = requestedPage(url);
  const kind = requestedKind(url);
  const query = field(url.searchParams.get('q') ?? '', '搜索关键词', { min: 0, max: 100 });
  const { rows } = await db.query(`
    SELECT ${identityFields} FROM school_identities
    WHERE school_id = $1 AND archived_at IS NULL AND ($2::text IS NULL OR kind = $2)
      AND ($3 = '' OR strpos(lower(name), lower($3)) > 0 OR strpos(lower(number), lower($3)) > 0)
    ORDER BY name, id LIMIT $4 OFFSET $5`, [schoolId, kind, query, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
  return pageResult(page, rows);
}

async function createIdentity(db, schoolId, actorId, body) {
  const kind = enumValue(body.kind, IDENTITY_KINDS, '身份类型');
  const number = field(body.number, '编号', { max: 64 });
  const name = field(body.name, '姓名', { max: 100 });
  const accountId = body.accountId == null ? null : uuid(body.accountId, '账号 ID');
  await requireMatchingMember(db, schoolId, accountId, kind);
  const { rows: [identity] } = await db.query(`
    INSERT INTO school_identities (school_id, kind, number, name, account_id)
    VALUES ($1, $2, $3, $4, $5) RETURNING ${identityFields}`, [schoolId, kind, number, name, accountId]);
  await auditSchool(db, schoolId, actorId, 'school.identity.create', identity.id);
  return { status: 201, body: identity };
}

async function setIdentityAccount(db, schoolId, actorId, identityId, body) {
  const accountId = body.accountId === null ? null : uuid(body.accountId, '账号 ID');
  const expectedAccountId = accountId === null && body.expectedAccountId !== undefined
    ? uuid(body.expectedAccountId, '原账号 ID')
    : undefined;
  const { rows: [identity] } = await db.query(`
    SELECT kind FROM school_identities WHERE school_id = $1 AND id = $2 AND archived_at IS NULL`, [schoolId, identityId]);
  if (!identity) fail(404, 'NOT_FOUND', '本校身份档案不存在');
  await requireMatchingMember(db, schoolId, accountId, identity.kind);
  const { rows: [current] } = await db.query(`
    SELECT ${identityFields} FROM school_identities WHERE school_id = $1 AND id = $2
    FOR UPDATE`, [schoolId, identityId]);
  if (current.accountId === accountId) return { status: 200, body: current };
  if (expectedAccountId !== undefined && current.accountId !== expectedAccountId) {
    fail(409, 'CONFLICT', '账号关联已变化，请刷新后重新确认');
  }
  if (current.accountId !== null && accountId !== null) {
    fail(409, 'CONFLICT', '请先解除身份档案与原账号的关联');
  }
  const { rows: [updated] } = await db.query(`
    UPDATE school_identities SET account_id = $3 WHERE school_id = $1 AND id = $2
    RETURNING ${identityFields}`, [schoolId, identityId, accountId]);
  await auditSchool(db, schoolId, actorId, accountId === null ? 'school.identity.unlink' : 'school.identity.link', identityId);
  return { status: 200, body: updated };
}

const assignedStudent = `EXISTS (
  SELECT 1 FROM school_class_roster r
  JOIN school_identities i ON i.school_id = r.school_id AND i.id = r.identity_id
  WHERE r.school_id = c.school_id AND r.class_id = c.id
    AND i.kind = 'student' AND i.account_id = $2
)`;
const classProjection = `c.id, c.name, c.type, c.created_at AS "createdAt",
  c.archived_at IS NOT NULL AS archived, c.revision`;

async function teacherIdentity(db, schoolId, accountId) {
  return (await db.query(`SELECT id FROM school_identities
    WHERE school_id = $1 AND account_id = $2 AND kind = 'teacher'`, [schoolId, accountId])).rows[0];
}

// Callers hold the school teaching advisory lock for the whole read/write.
// Never accept a client-provided role: role comes from schoolRole in this transaction.
export async function requireSchoolClassManagement(db, schoolId, accountId, role, classId, { allowArchived = false } = {}) {
  if (role !== 'school_admin' && role !== 'teacher') fail(403, 'FORBIDDEN', '需要本校教职权限');
  const { rows: [schoolClass] } = await db.query(`
    SELECT ${classProjection} FROM school_classes c
    WHERE c.school_id = $1 AND c.id = $3 AND ($2::uuid IS NULL OR ${assignedTeacher})`,
  [schoolId, role === 'teacher' ? accountId : null, classId]);
  if (!schoolClass) fail(404, 'NOT_FOUND', '班级不存在或不可访问');
  if (!allowArchived && schoolClass.archived) fail(409, 'CLASS_ARCHIVED', '请先恢复已归档班级');
  return schoolClass;
}

async function listClasses(db, schoolId, actorId, role, url) {
  let page = requestedPage(url);
  let archived = url.searchParams.get('archived') === 'true' && role !== 'student';
  const access = role === 'school_admin' ? 'true' : role === 'teacher' ? assignedTeacher : assignedStudent;
  if (url.searchParams.has('classId')) {
    const classId = uuid(url.searchParams.get('classId'), '班级 ID');
    // Locate only within the caller's authorized directory. An inaccessible ID
    // must not silently open a different class or reveal its page/archive state.
    const { rows: [located] } = await db.query(`WITH accessible AS (
      SELECT c.id, c.archived_at IS NOT NULL AS archived,
        ((row_number() OVER (PARTITION BY c.archived_at IS NOT NULL ORDER BY c.name, c.id) - 1) / $4::int + 1)::int AS page
      FROM school_classes c WHERE c.school_id = $1 AND $2::uuid IS NOT NULL AND ${access}
        AND ($3::boolean OR c.archived_at IS NULL)
    ) SELECT page, archived FROM accessible WHERE id = $5`,
    [schoolId, actorId, role !== 'student', PAGE_SIZE, classId]);
    if (!located) fail(404, 'NOT_FOUND', '班级不存在或不可访问');
    page = located.page;
    archived = located.archived;
  }
  const { rows } = await db.query(`
    SELECT ${classProjection},
      (SELECT count(*)::int FROM school_class_roster r JOIN school_identities i
        ON i.school_id = r.school_id AND i.id = r.identity_id
        WHERE r.school_id = c.school_id AND r.class_id = c.id AND i.kind = 'student' AND i.archived_at IS NULL) AS "studentCount",
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) ORDER BY i.name, i.id), '[]')
        FROM school_class_roster r JOIN school_identities i ON i.school_id = r.school_id AND i.id = r.identity_id
        WHERE r.school_id = c.school_id AND r.class_id = c.id AND i.kind = 'teacher') AS teachers
    FROM school_classes c
    WHERE c.school_id = $1 AND $2::uuid IS NOT NULL AND ${access} AND (c.archived_at IS NOT NULL) = $3
    ORDER BY c.name, c.id LIMIT $4 OFFSET $5`,
  [schoolId, actorId, archived, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
  const result = pageResult(page, rows.map(row => ({ ...row, canManage: role !== 'student' })));
  result.body.archived = archived;
  result.body.canCreate = role === 'school_admin' || (role === 'teacher' && Boolean(await teacherIdentity(db, schoolId, actorId)));
  return result;
}

async function createClass(db, schoolId, actorId, role, body) {
  if (role !== 'school_admin' && role !== 'teacher') fail(403, 'FORBIDDEN', '需要本校教职权限');
  const teacher = role === 'teacher' ? await teacherIdentity(db, schoolId, actorId) : null;
  if (role === 'teacher' && !teacher) fail(403, 'TEACHER_IDENTITY_REQUIRED', '请先由学校管理员关联教师身份档案');
  const name = field(body.name, '班级名称', { max: 100 });
  const type = enumValue(body.type, ['administrative', 'training'], '班级类型');
  const { rows: [schoolClass] } = await db.query(`
    INSERT INTO school_classes (school_id, name, type) VALUES ($1, $2, $3)
    RETURNING id, name, type, created_at AS "createdAt", archived_at IS NOT NULL AS archived, revision`, [schoolId, name, type]);
  if (teacher) {
    await db.query('INSERT INTO school_class_roster (school_id, class_id, identity_id) VALUES ($1, $2, $3)',
      [schoolId, schoolClass.id, teacher.id]);
    await auditSchool(db, schoolId, actorId, 'school.roster.add', teacher.id);
  }
  await auditSchool(db, schoolId, actorId, 'school.class.create', schoolClass.id);
  return { status: 201, body: schoolClass };
}

async function updateClass(db, schoolId, actorId, role, classId, action, body) {
  const current = await requireSchoolClassManagement(db, schoolId, actorId, role, classId, { allowArchived: action !== 'edit' });
  const expectedRevision = integer(body.expectedRevision, 1, 2147483647, '班级版本');
  if (current.revision !== expectedRevision) fail(409, 'CONFLICT', '班级信息已变化，请刷新后重试');
  const name = action === 'edit' ? field(body.name, '班级名称', { max: 100 }) : current.name;
  const type = action === 'edit' ? enumValue(body.type, ['administrative', 'training'], '班级类型') : current.type;
  const archived = action === 'archive' || (action === 'edit' && current.archived);
  if (current.name === name && current.type === type && current.archived === archived) return { status: 200, body: current };
  const { rows: [updated] } = await db.query(`UPDATE school_classes SET name = $3, type = $4,
      archived_at = CASE WHEN $5 THEN coalesce(archived_at, now()) ELSE NULL END, revision = revision + 1
    WHERE school_id = $1 AND id = $2
    RETURNING id, name, type, created_at AS "createdAt", archived_at IS NOT NULL AS archived, revision`,
  [schoolId, classId, name, type, archived]);
  await auditSchool(db, schoolId, actorId, `school.class.${action}`, classId);
  return { status: 200, body: updated };
}

async function listRoster(db, schoolId, actorId, role, classId, url) {
  const page = requestedPage(url);
  const kind = role === 'student' ? 'student' : requestedKind(url);
  if (role === 'student') {
    const { rowCount } = await db.query(`SELECT 1 FROM school_classes c
      WHERE c.school_id = $1 AND c.id = $3 AND c.archived_at IS NULL AND ${assignedStudent}`, [schoolId, actorId, classId]);
    if (!rowCount) fail(404, 'NOT_FOUND', '班级不存在或不可访问');
  } else {
    await requireSchoolClassManagement(db, schoolId, actorId, role, classId, { allowArchived: true });
  }
  const staffFields = role === 'student' ? '' : `, i.number, r.added_at AS "addedAt",
    i.account_id IS NOT NULL AS "accountLinked",
    CASE WHEN i.account_id IS NULL THEN 'unlinked'
      WHEN a.disabled_at IS NOT NULL OR a.binding_released_at IS NOT NULL THEN 'disabled' ELSE 'active' END AS "accountStatus"`;
  const { rows } = await db.query(`SELECT i.id, i.kind, i.name ${staffFields}
    FROM school_class_roster r
    JOIN school_identities i ON i.school_id = r.school_id AND i.id = r.identity_id
    LEFT JOIN accounts a ON a.id = i.account_id
    WHERE r.school_id = $1 AND r.class_id = $2 AND i.archived_at IS NULL AND ($3::text IS NULL OR i.kind = $3)
    ORDER BY i.name, i.id LIMIT $4 OFFSET $5`, [schoolId, classId, kind, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
  return pageResult(page, rows);
}

async function listCandidates(db, schoolId, actorId, role, classId, url) {
  await requireSchoolClassManagement(db, schoolId, actorId, role, classId);
  const kind = requestedKind(url) ?? 'student';
  if (role === 'teacher' && kind !== 'student') fail(403, 'FORBIDDEN', '教师只能管理学生名单');
  const query = field(url.searchParams.get('q') ?? '', '搜索关键词', { min: 0, max: 100 });
  const page = requestedPage(url);
  const { rows } = await db.query(`SELECT i.id, i.name, i.kind, i.number, i.account_id IS NOT NULL AS "accountLinked"
    FROM school_identities i WHERE i.school_id = $1 AND i.kind = $3 AND i.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM school_class_roster r
        WHERE r.school_id = i.school_id AND r.class_id = $2 AND r.identity_id = i.id)
      AND ($4 = '' OR strpos(lower(i.name), lower($4)) > 0 OR strpos(lower(i.number), lower($4)) > 0)
    ORDER BY i.name, i.id LIMIT $5 OFFSET $6`, [schoolId, classId, kind, query, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
  return pageResult(page, rows);
}

async function requireRosterIdentity(db, schoolId, role, identityId) {
  const { rows: [identity] } = await db.query('SELECT kind FROM school_identities WHERE school_id = $1 AND id = $2 AND archived_at IS NULL', [schoolId, identityId]);
  if (!identity) fail(404, 'NOT_FOUND', '本校身份档案不存在');
  if (role === 'teacher' && identity.kind !== 'student') fail(403, 'FORBIDDEN', '教师只能管理学生名单');
}

async function addRosterIdentity(db, schoolId, actorId, role, classId, identityId) {
  await requireSchoolClassManagement(db, schoolId, actorId, role, classId);
  await requireRosterIdentity(db, schoolId, role, identityId);
  const { rowCount } = await db.query(`
    INSERT INTO school_class_roster (school_id, class_id, identity_id) VALUES ($1, $2, $3)
    ON CONFLICT (school_id, class_id, identity_id) DO NOTHING`, [schoolId, classId, identityId]);
  if (rowCount) await auditSchool(db, schoolId, actorId, 'school.roster.add', identityId);
  return { status: 201, body: { ok: true } };
}

async function removeRosterIdentity(db, schoolId, actorId, role, classId, identityId) {
  await requireSchoolClassManagement(db, schoolId, actorId, role, classId);
  await requireRosterIdentity(db, schoolId, role, identityId);
  const { rowCount } = await db.query(`
    DELETE FROM school_class_roster WHERE school_id = $1 AND class_id = $2 AND identity_id = $3`,
  [schoolId, classId, identityId]);
  if (!rowCount) fail(404, 'NOT_FOUND', '班级名单中未找到该身份档案');
  await auditSchool(db, schoolId, actorId, 'school.roster.remove', identityId);
  return { status: 200, body: { ok: true } };
}

export async function handleSchoolTeaching({ pool, user, route, method, body, url }) {
  const directory = route.match(/^\/schools\/([^/]+)\/identities(?:\/([^/]+)\/account)?$/);
  if (directory) {
    const schoolId = uuid(directory[1], '学校 ID');
    const identityId = directory[2];
    return transaction(pool, async db => {
      await lockSchoolTeaching(db, schoolId, { shared: method === 'GET' });
      await requireSchoolAdmin(db, schoolId, user.id);
      if (!identityId && method === 'GET') return listIdentities(db, schoolId, url);
      if (!identityId && method === 'POST') return createIdentity(db, schoolId, user.id, body);
      if (identityId && method === 'PATCH') {
        return setIdentityAccount(db, schoolId, user.id, uuid(identityId, '身份档案 ID'), body);
      }
      return null;
    });
  }

  const classes = route.match(/^\/schools\/([^/]+)\/classes(?:\/([^/]+)(?:\/(roster|candidates|archive|restore)(?:\/([^/]+))?)?)?$/);
  if (!classes) return null;
  const schoolId = uuid(classes[1], '学校 ID');
  const classId = classes[2] ? uuid(classes[2], '班级 ID') : null;
  const action = classes[3];
  const rosterIdentity = classes[4];
  return transaction(pool, async db => {
    // School lock precedes membership row locks: revocation takes this lock
    // before updating the target member, so a waiting teacher must not hold it.
    await lockSchoolTeaching(db, schoolId, { shared: method === 'GET' });
    const role = await schoolRole(db, schoolId, user.id);
    if (method === 'GET' && !rosterIdentity) {
      if (!classId) return listClasses(db, schoolId, user.id, role, url);
      if (action === 'roster') return listRoster(db, schoolId, user.id, role, classId, url);
      if (action === 'candidates') return listCandidates(db, schoolId, user.id, role, classId, url);
    }
    if (role !== 'school_admin' && role !== 'teacher') fail(403, 'FORBIDDEN', '需要本校教职权限');
    if (method === 'POST' && !classId) return createClass(db, schoolId, user.id, role, body);
    if (classId && !rosterIdentity) {
      if (method === 'PATCH' && !action) return updateClass(db, schoolId, user.id, role, classId, 'edit', body);
      if (method === 'POST' && ['archive', 'restore'].includes(action)) return updateClass(db, schoolId, user.id, role, classId, action, body);
      if (method === 'POST' && action === 'roster') return addRosterIdentity(db, schoolId, user.id, role, classId, uuid(body.identityId, '身份档案 ID'));
    }
    if (method === 'DELETE' && action === 'roster' && rosterIdentity) {
      return removeRosterIdentity(db, schoolId, user.id, role, classId, uuid(rosterIdentity, '身份档案 ID'));
    }
    return null;
  });
}
