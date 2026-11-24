import { studentClassroom } from './student-classroom.mjs';
import { transaction } from './db.mjs';
import { auditSchool, lockSchoolTeaching, requireSchoolAdmin, schoolRole } from './schools.mjs';
import { canonicalHash, enumValue, fail, field, genderValue, integer, uuid } from './security.mjs';

const PAGE_SIZE = 50;
const IDENTITY_KINDS = ['student', 'teacher'];
const identityFields = 'id, kind, number, name, account_id AS "accountId", created_at AS "createdAt"';
const identityClasses = `(SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
  'archived', c.archived_at IS NOT NULL) ORDER BY c.name, c.id), '[]') FROM school_class_roster r
  JOIN school_classes c ON c.school_id = r.school_id AND c.id = r.class_id
  WHERE r.school_id = i.school_id AND r.identity_id = i.id) AS classes`;
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

// Unlinking a credential must not turn a previously activated dossier into
// a deletable record. The original school also has pre-migration accounts.
const archivedByExit = `EXISTS (SELECT 1 FROM school_exit_requests e WHERE e.school_id=i.school_id
  AND e.identity_id=i.id AND e.status='approved')`;
const canArchiveIdentity = `i.kind IN ('student','teacher') AND i.account_id IS NULL
  AND NOT i.has_account_history
  AND NOT (${archivedByExit})`;
const directoryFields = `i.id,i.kind,i.number,i.name,i.gender,i.account_id AS "accountId",i.created_at AS "createdAt",
  (SELECT username FROM accounts a WHERE a.id=i.account_id) AS username,${identityClasses},
  i.archived_at AS "archivedAt",(${canArchiveIdentity}) AS "canArchive",${archivedByExit} AS "archivedByExit"`;

async function listIdentities(db, schoolId, url) {
  const params=url.searchParams;
  const archived=params.get('archived')==='true';
  if (params.get('view')==='filters') {
    const classes=(await db.query('SELECT id,name FROM school_classes WHERE school_id=$1 AND archived_at IS NULL ORDER BY name,id',[schoolId])).rows;
    const counts=(await db.query('SELECT kind,count(*)::int n FROM school_identities WHERE school_id=$1 AND (archived_at IS NOT NULL)=$2 GROUP BY kind',[schoolId,archived])).rows;
    return {status:200,body:{classes,counts:Object.fromEntries(counts.map(row=>[row.kind,row.n]))}};
  }
  const page = requestedPage(url);
  const kind = params.has('kind') ? enumValue(params.get('kind'), [...IDENTITY_KINDS,'school_admin'], '身份类型') : null;
  const pendingActivation = enumValue(params.get('pendingActivation') ?? 'false', ['true','false'], '仅显示待激活身份')==='true';
  const status=enumValue(params.get('status') ?? 'all',['all','pending','active'],'激活状态');
  const classId=params.has('classId') ? uuid(params.get('classId'),'班级') : null;
  const query = field(params.get('q') ?? '', '搜索关键词', { min: 0, max: 100 });
  const { rows } = await db.query(`
    SELECT ${directoryFields} FROM school_identities i
    WHERE i.school_id=$1 AND (i.archived_at IS NOT NULL)=$7 AND ($2::text IS NULL OR i.kind=$2)
      AND ($3='' OR strpos(lower(i.name),lower($3))>0 OR strpos(lower(i.number),lower($3))>0
        OR EXISTS(SELECT 1 FROM accounts a WHERE a.id=i.account_id AND strpos(lower(a.username),lower($3))>0))
      AND (NOT $6 OR (i.account_id IS NULL AND i.archived_at IS NULL AND i.kind IN ('student','teacher')))
      AND ($8='all' OR (i.account_id IS NULL)=($8='pending'))
      AND ($9::uuid IS NULL OR EXISTS(SELECT 1 FROM school_class_roster r JOIN school_classes c
        ON (c.school_id,c.id)=(r.school_id,r.class_id) WHERE r.school_id=i.school_id AND r.identity_id=i.id
        AND r.class_id=$9 AND c.archived_at IS NULL))
    ORDER BY i.number,i.id LIMIT $4 OFFSET $5`, [schoolId,kind,query,PAGE_SIZE+1,(page-1)*PAGE_SIZE,pendingActivation,archived,status,classId]);
  return pageResult(page, rows);
}

async function identityRecord(db,schoolId,id) {
  const {rows:[person]}=await db.query(`SELECT ${directoryFields},i.notes FROM school_identities i
    WHERE i.school_id=$1 AND i.id=$2`,[schoolId,id]);
  if (!person) fail(404,'NOT_FOUND','本校身份档案不存在');
  return person;
}

async function archiveIdentity(db,schoolId,actorId,id,archive) {
  const person=await identityRecord(db,schoolId,id);
  if (!person.canArchive) fail(409,'IDENTITY_PROTECTED','此档案有账号历史、管理身份或退校记录，须保留');
  if (archive!==Boolean(person.archivedAt)) {
    await db.query('UPDATE school_identities SET archived_at=CASE WHEN $3 THEN now() END WHERE school_id=$1 AND id=$2',[schoolId,id,archive]);
    if (archive) await db.query('UPDATE school_activation_tokens SET expires_at=least(expires_at,now()) WHERE school_id=$1 AND identity_id=$2 AND consumed_at IS NULL',[schoolId,id]);
    await auditSchool(db,schoolId,actorId,archive?'school.identity.archive':'school.identity.restore',id);
  }
  return {status:200,body:{ok:true}};
}

function readClassIds(value) {
  if (!Array.isArray(value)) fail(400, 'VALIDATION', '班级须为列表');
  return [...new Set(value.map(id => uuid(id, '班级 ID').toLowerCase()))];
}

async function requireActiveClasses(db, schoolId, classes) {
  if (!classes.length) return;
  const { rows } = await db.query(`SELECT archived_at FROM school_classes
    WHERE school_id = $1 AND id = ANY($2::uuid[])`, [schoolId, classes]);
  if (rows.length !== classes.length) fail(404, 'NOT_FOUND', '班级不存在或不可访问');
  if (rows.some(row => row.archived_at)) fail(409, 'CLASS_ARCHIVED', '请选择使用中的班级');
}

async function createIdentity(db, schoolId, actorId, body) {
  const kind = enumValue(body.kind, IDENTITY_KINDS, '身份类型');
  const number = field(body.number, '编号', { max: 64 });
  const name = field(body.name, '姓名', { max: 100 });
  const gender = genderValue(body.gender ?? null);
  const notes = identityNotes(body.notes ?? null);
  const accountId = body.accountId == null ? null : uuid(body.accountId, '账号 ID');
  const { classIds = [] } = body;
  const classes = readClassIds(classIds);
  await requireMatchingMember(db, schoolId, accountId, kind);
  await requireActiveClasses(db, schoolId, classes);
  const { rows: [identity] } = await db.query(`
    INSERT INTO school_identities (school_id, kind, number, name, account_id, gender, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${identityFields}`, [schoolId, kind, number, name, accountId, gender, notes]);
  await auditSchool(db, schoolId, actorId, 'school.identity.create', identity.id);
  if (classes.length) await addToClassRosters(db, schoolId, actorId, identity.id, classes);
  return { status: 201, body: identity };
}

function identityNotes(value) {
  return value === null ? null : field(value, '备注', { min: 0, max: 2000 }) || null;
}

async function manageIdentityProfile(db, schoolId, actorId, identityId, method, body) {
  const { rows: [profile] } = await db.query(`SELECT kind, name, number, gender, notes FROM school_identities
    WHERE school_id=$1 AND id=$2 AND archived_at IS NULL`, [schoolId, identityId]);
  if (!profile) fail(404, 'NOT_FOUND', '本校身份档案不存在');
  const version = canonicalHash([profile.name, profile.number, profile.gender, profile.notes]);
  if (method === 'GET') return { status: 200, body: { ...profile, version } };

  const expectedVersion = field(body.expectedVersion, '档案版本', { min: 64, max: 64 });
  const name = body.name === undefined ? profile.name : field(body.name, '姓名', { max: 100 });
  const number = body.number === undefined ? profile.number : field(body.number, '编号', { max: 64 });
  const gender = body.gender === undefined ? profile.gender : genderValue(body.gender);
  const notes = body.notes === undefined ? profile.notes : identityNotes(body.notes);
  if (name === profile.name && number === profile.number && gender === profile.gender && notes === profile.notes) {
    return { status: 200, body: { ok: true } };
  }
  if (expectedVersion !== version) fail(409, 'PROFILE_CHANGED', '档案资料已变更，请重新加载后确认');
  await db.query(`UPDATE school_identities SET name=$3, number=$4, gender=$5, notes=$6
    WHERE school_id=$1 AND id=$2`, [schoolId, identityId, name, number, gender, notes]);
  await auditSchool(db, schoolId, actorId, 'school.identity.update', identityId);
  return { status: 200, body: { ok: true } };
}

async function manageIdentityClasses(db, schoolId, actorId, identityId, method, body) {
  const { rows: [identity] } = await db.query(`SELECT kind, name, number, ${identityClasses}
    FROM school_identities i WHERE school_id=$1 AND id=$2 AND archived_at IS NULL
    AND kind IN ('student','teacher')`, [schoolId, identityId]);
  if (!identity) fail(404, 'NOT_FOUND', '未找到本校的师生身份档案');
  if (method === 'GET') return { status: 200, body: identity };

  const expected = readClassIds(body.expectedClassIds);
  const desired = readClassIds(body.classIds);
  const current = new Set(identity.classes.filter(c => !c.archived).map(c => c.id));
  const additions = desired.filter(id => !current.has(id));
  const selected = new Set(desired);
  const removals = [...current].filter(id => !selected.has(id));
  if (additions.length || removals.length) {
    if (expected.length !== current.size || expected.some(id => !current.has(id))) {
      fail(409, 'ROSTER_CHANGED', '班级名单已变更，请重新加载后确认');
    }
    await requireActiveClasses(db, schoolId, additions);
    if (additions.length) await addToClassRosters(db, schoolId, actorId, identityId, additions);
    if (removals.length) await removeFromClassRosters(db, schoolId, actorId, identityId, removals);
  }
  return { status: 200, body: { ok: true } };
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
const classProjection = `c.id, c.name, c.description, c.type, c.created_at AS "createdAt",
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

async function addToClassRosters(db, schoolId, actorId, identityId, classIds) {
  await db.query(`WITH added AS (
    INSERT INTO school_class_roster (school_id, class_id, identity_id)
    SELECT $1, class_id, $3 FROM unnest($4::uuid[]) AS classes(class_id)
    ON CONFLICT (school_id, class_id, identity_id) DO NOTHING
    RETURNING school_id, identity_id
  )
  INSERT INTO school_audit_events (school_id, actor_account_id, action, target_id)
  SELECT school_id, $2, 'school.roster.add', identity_id FROM added`, [schoolId, actorId, identityId, classIds]);
}

async function addRosterIdentity(db, schoolId, actorId, role, classId, identityId) {
  await requireSchoolClassManagement(db, schoolId, actorId, role, classId);
  await requireRosterIdentity(db, schoolId, role, identityId);
  await addToClassRosters(db, schoolId, actorId, identityId, [classId]);
  return { status: 201, body: { ok: true } };
}

async function removeRosterIdentity(db, schoolId, actorId, role, classId, identityId) {
  await requireSchoolClassManagement(db, schoolId, actorId, role, classId);
  await requireRosterIdentity(db, schoolId, role, identityId);
  const rowCount = await removeFromClassRosters(db, schoolId, actorId, identityId, [classId]);
  if (!rowCount) fail(404, 'NOT_FOUND', '班级名单中未找到该身份档案');
  return { status: 200, body: { ok: true } };
}

async function removeFromClassRosters(db, schoolId, actorId, identityId, classIds) {
  const { rowCount } = await db.query(`WITH removed AS (
    DELETE FROM school_class_roster WHERE school_id=$1 AND identity_id=$3 AND class_id=ANY($4::uuid[])
    RETURNING school_id, identity_id
  )
  INSERT INTO school_audit_events (school_id, actor_account_id, action, target_id)
  SELECT school_id, $2, 'school.roster.remove', identity_id FROM removed`, [schoolId, actorId, identityId, classIds]);
  return rowCount;
}

export async function handleSchoolTeaching({ pool, user, route, method, body, url }) {
  const directory = route.match(/^\/schools\/([^/]+)\/identities(?:\/([^/]+)\/(account|classes|profile|details|archive|restore))?$/);
  if (directory) {
    const schoolId = uuid(directory[1], '学校 ID');
    const identityId = directory[2];
    return transaction(pool, async db => {
      await lockSchoolTeaching(db, schoolId, { shared: method === 'GET' });
      await requireSchoolAdmin(db, schoolId, user.id);
      if (!identityId && method === 'GET') return listIdentities(db, schoolId, url);
      if (!identityId && method === 'POST') return createIdentity(db, schoolId, user.id, body);
      if (directory[3]==='details' && method==='GET') return {status:200,body:await identityRecord(db,schoolId,uuid(identityId))};
      if (['archive','restore'].includes(directory[3]) && method==='POST')
        return archiveIdentity(db,schoolId,user.id,uuid(identityId),directory[3]==='archive');
      if (directory[3] === 'profile' && ['GET', 'PATCH'].includes(method)) {
        return manageIdentityProfile(db, schoolId, user.id, uuid(identityId, '身份档案 ID'), method, body);
      }
      if (directory[3] === 'classes' && ['GET', 'PATCH'].includes(method)) {
        return manageIdentityClasses(db, schoolId, user.id, uuid(identityId, '身份档案 ID'), method, body);
      }
      if (directory[3] === 'account' && method === 'PATCH') {
        return setIdentityAccount(db, schoolId, user.id, uuid(identityId, '身份档案 ID'), body);
      }
      return null;
    });
  }

  const classes = route.match(/^\/schools\/([^/]+)\/classes(?:\/([^/]+)(?:\/(roster|members|candidates|archive|restore)(?:\/([^/]+))?)?)?$/);
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
      if ((!action || action === 'members') && role === 'student') {
        await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
        return {status:200, body:await studentClassroom(db,schoolId,classId,user,action === 'members')};
      }
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
