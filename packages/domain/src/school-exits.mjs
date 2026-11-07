import { transaction } from './db.mjs';
import { activeAccount, auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, requireSchoolAdmin } from './schools.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';

const PAGE_SIZE = 30;
const requestFields = `id,account_id AS "accountId",identity_id AS "identityId",
  student_name AS "studentName",student_number AS "studentNumber",
  membership_started_at::text AS "membershipStartedAt",
  requested_by AS "requestedBy",reason,status,requested_at AS "requestedAt",
  reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt",review_note AS "reviewNote"`;
const reply = (body, status = 200) => ({ status, body });

async function authorizeAdmin(db, schoolId, actorId) {
  if (schoolId !== LEGACY_SCHOOL_ID) return requireSchoolAdmin(db, schoolId, actorId);
  await activeAccount(db, actorId);
  const admin = await db.query(`SELECT 1 FROM account_roles r
    JOIN legacy_school_account_ownership o ON o.account_id=r.account_id
    WHERE o.school_id=$1 AND r.account_id=$2 AND r.role='admin' FOR SHARE OF r`, [schoolId, actorId]);
  if (!admin.rowCount) fail(403, 'FORBIDDEN', '需要本校管理员权限');
}

function studentSelection(schoolId) {
  if (schoolId === LEGACY_SCHOOL_ID) return `
    SELECT a.id AS "accountId",i.id AS "identityId",i.name,i.number,a.created_at::text AS "membershipStartedAt"
    FROM accounts a JOIN identities i ON i.id=a.identity_id
    JOIN legacy_school_account_ownership o ON o.account_id=a.id
    JOIN legacy_school_identity_ownership d ON d.identity_id=i.id AND d.school_id=o.school_id
    WHERE o.school_id=$1 AND i.kind='student' AND i.archived_at IS NULL
      AND a.binding_released_at IS NULL
      AND EXISTS (SELECT 1 FROM account_roles WHERE account_id=a.id AND role='student')
      AND NOT EXISTS (SELECT 1 FROM account_roles WHERE account_id=a.id AND role<>'student')`;
  return `
    SELECT a.id AS "accountId",s.id AS "identityId",COALESCE(s.name,i.name) AS name,s.number,
      m.joined_at::text AS "membershipStartedAt"
    FROM school_memberships m JOIN accounts a ON a.id=m.account_id
    JOIN identities i ON i.id=a.identity_id
    LEFT JOIN school_identities s ON s.school_id=m.school_id AND s.account_id=m.account_id
    WHERE m.school_id=$1 AND m.role='student' AND m.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM school_administrators g
        WHERE g.school_id=m.school_id AND g.account_id=m.account_id AND g.revoked_at IS NULL)`;
}

async function findStudent(db, schoolId, accountId) {
  return (await db.query(`${studentSelection(schoolId)} AND a.id=$2`, [schoolId, accountId])).rows[0];
}

function requireStudent(student) {
  if (!student) fail(404, 'NOT_FOUND', '本校学生不存在或已退出');
  return student;
}

async function pendingRequest(db, schoolId, accountId) {
  return (await db.query(`SELECT ${requestFields} FROM school_exit_requests
    WHERE school_id=$1 AND account_id=$2 AND status='pending' FOR UPDATE`, [schoolId, accountId])).rows[0];
}

async function createRequest(db, schoolId, student, actorId, reason) {
  const { rows: [record] } = await db.query(`INSERT INTO school_exit_requests
    (school_id,account_id,identity_id,student_name,student_number,membership_started_at,requested_by,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${requestFields}`,
  [schoolId, student.accountId, student.identityId, student.name, student.number, student.membershipStartedAt, actorId, reason]);
  return record;
}

function sameMembership(student, record) {
  return student.identityId === record.identityId && student.membershipStartedAt === record.membershipStartedAt;
}

async function archiveStudent(db, schoolId, student, actorId, requestId) {
  if (schoolId === LEGACY_SCHOOL_ID) {
    const { rows: [{ detached }] } = await db.query(
      'SELECT detach_legacy_school_student($1,$2,$3,$4) AS detached', [actorId, student.accountId, student.identityId, requestId]);
    if (!detached) fail(409, 'EXIT_STATE_CHANGED', '学生身份已变更，请刷新后重试');
    return;
  }
  // Lock the account before changing membership, matching default-school writes.
  await db.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [student.accountId]);
  const revoked = await db.query(`UPDATE school_memberships SET revoked_at=clock_timestamp()
    WHERE school_id=$1 AND account_id=$2 AND role='student' AND revoked_at IS NULL
      AND joined_at=$3
      AND NOT EXISTS (SELECT 1 FROM school_administrators g
        WHERE g.school_id=$1 AND g.account_id=$2 AND g.revoked_at IS NULL)`, [schoolId, student.accountId, student.membershipStartedAt]);
  if (!revoked.rowCount) fail(409, 'EXIT_STATE_CHANGED', '学生身份已变更，请刷新后重试');
  if (student.identityId) {
    await db.query(`UPDATE school_identities SET account_id=NULL,archived_at=clock_timestamp()
      WHERE school_id=$1 AND id=$2 AND account_id=$3`, [schoolId, student.identityId, student.accountId]);
    await db.query(`UPDATE school_activation_tokens SET consumed_at=clock_timestamp()
      WHERE school_id=$1 AND identity_id=$2 AND consumed_at IS NULL`, [schoolId, student.identityId]);
  }
  await db.query('UPDATE accounts SET default_school_id=NULL WHERE id=$1 AND default_school_id=$2', [student.accountId, schoolId]);
}

async function decide(db, schoolId, record, actorId, status, note) {
  if (record.status === status) return record;
  if (record.status !== 'pending') fail(409, 'EXIT_STATE_CHANGED', '申请已处理，请刷新后重试');
  const student = status === 'approved' ? requireStudent(await findStudent(db, schoolId, record.accountId)) : null;
  // A request belongs to the dossier that was active when it was filed.
  if (student && !sameMembership(student, record)) fail(409, 'EXIT_STATE_CHANGED', '学生档案已变更，请驳回旧申请后重新办理');
  const { rows: [updated] } = await db.query(`UPDATE school_exit_requests
    SET status=$3,reviewed_at=clock_timestamp(),reviewed_by=$4,review_note=$5
    WHERE school_id=$1 AND id=$2 RETURNING ${requestFields}`, [schoolId, record.id, status, actorId, note]);
  if (student) await archiveStudent(db, schoolId, student, actorId, record.id);
  await auditSchool(db, schoolId, actorId, `school.exit.${status}`, record.id);
  return updated;
}

async function directExit(db, schoolId, student, actorId, reason) {
  const pending = await pendingRequest(db, schoolId, student.accountId);
  const sameDossier = pending && sameMembership(student, pending);
  if (pending && !sameDossier) {
    await decide(db, schoolId, pending, actorId, 'rejected', '学生档案已变更');
  }
  const record = sameDossier ? pending : await createRequest(db, schoolId, student, actorId, reason);
  return decide(db, schoolId, record, actorId, 'approved', sameDossier ? reason : '');
}

// Preserve the established DELETE member API for staff clients. Student
// removal through that API must produce the same archive as the new action.
export async function archiveRemovedStudent(db, schoolId, accountId, actorId) {
  const student = await findStudent(db, schoolId, accountId);
  if (!student) return false;
  await directExit(db, schoolId, student, actorId, '');
  return true;
}

function studentExitStatus(record) {
  if (!record) return null;
  const { id, status, reason, requestedAt, reviewedAt, reviewNote } = record;
  return { id, status, reason, requestedAt, reviewedAt, reviewNote };
}

async function studentRequest(db, schoolId, user, method, body) {
  await activeAccount(db, user.id);
  if (method === 'GET') {
    const { rows: [record] } = await db.query(`SELECT ${requestFields} FROM school_exit_requests
      WHERE school_id=$1 AND account_id=$2 ORDER BY requested_at DESC,id DESC LIMIT 1`, [schoolId, user.id]);
    if (!record) requireStudent(await findStudent(db, schoolId, user.id));
    return reply({ request: studentExitStatus(record) });
  }
  const student = requireStudent(await findStudent(db, schoolId, user.id));
  const pending = await pendingRequest(db, schoolId, user.id);
  if (pending) {
    if (!sameMembership(student, pending)) fail(409, 'EXIT_STATE_CHANGED', '请联系学校处理之前提交的退校申请');
    return reply({ request: studentExitStatus(pending) });
  }
  const reason = field(body.reason ?? '', '申请原因', { min: 0, max: 500 });
  const record = await createRequest(db, schoolId, student, user.id, reason);
  await auditSchool(db, schoolId, user.id, 'school.exit.request', record.id);
  return reply({ request: studentExitStatus(record) }, 201);
}

async function adminRead(db, schoolId, resource, url) {
  const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, '页码');
  const offset = (page - 1) * PAGE_SIZE;
  const query = field(url.searchParams.get('q') ?? '', '搜索关键词', { min: 0, max: 100 });
  let rows;
  if (resource === 'student-exits') {
    ({ rows } = await db.query(`SELECT * FROM (${studentSelection(schoolId)}) students
      WHERE $2='' OR strpos(lower(name),lower($2))>0 OR strpos(lower(number),lower($2))>0
      ORDER BY name,"accountId" LIMIT $3 OFFSET $4`, [schoolId, query, PAGE_SIZE + 1, offset]));
  } else {
    const status = enumValue(url.searchParams.get('status') ?? 'pending',
      ['pending','approved','rejected'], '处理状态');
    ({ rows } = await db.query(`SELECT ${requestFields} FROM school_exit_requests
      WHERE school_id=$1 AND status=$2
      AND ($3='' OR strpos(lower(student_name),lower($3))>0 OR strpos(lower(student_number),lower($3))>0)
      ORDER BY requested_at DESC,id DESC LIMIT $4 OFFSET $5`, [schoolId, status, query, PAGE_SIZE + 1, offset]));
  }
  return reply({ items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE });
}

export async function handleSchoolExits({ pool, user, route, method, body, url }) {
  const match = route.match(/^\/schools\/([^/]+)\/(exit-request|exit-requests|student-exits)(?:\/([^/]+)\/decision)?$/);
  if (!match) return null;
  const [, school, resource, requestId] = match;
  const read = method === 'GET' && !requestId;
  const write = method === 'POST' && (resource === 'exit-requests' ? !!requestId : !requestId);
  if (!read && !write) return null;
  const schoolId = uuid(school, '学校 ID');
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId, { shared: read });
    if (write && schoolId === LEGACY_SCHOOL_ID) await db.query('SELECT pg_advisory_xact_lock(798944)');
    if (resource === 'exit-request') return studentRequest(db, schoolId, user, method, body);
    await authorizeAdmin(db, schoolId, user.id);
    if (read) return adminRead(db, schoolId, resource, url);
    if (resource === 'student-exits') {
      const accountId = uuid(body.accountId, '学生账号 ID');
      const student = requireStudent(await findStudent(db, schoolId, accountId));
      const membershipStartedAt = field(body.membershipStartedAt, '入校时间', { max: 80 });
      const identityId = body.identityId == null ? null : uuid(body.identityId, '学生档案 ID').toLowerCase();
      if (membershipStartedAt !== student.membershipStartedAt || identityId !== student.identityId) fail(409, 'EXIT_STATE_CHANGED', '学生身份已变更，请刷新后重试');
      const reason = field(body.reason ?? '', '办理说明', { min: 0, max: 500 });
      return reply(await directExit(db, schoolId, student, user.id, reason), 201);
    }
    const status = enumValue(body.decision, ['approve','reject'], '审批结果') === 'approve' ? 'approved' : 'rejected';
    const note = field(body.note ?? '', '审批说明', { min: 0, max: 500 });
    const { rows: [record] } = await db.query(`SELECT ${requestFields} FROM school_exit_requests
      WHERE school_id=$1 AND id=$2 FOR UPDATE`, [schoolId, uuid(requestId, '退校申请 ID')]);
    if (!record) fail(404, 'NOT_FOUND', '本校退校申请不存在');
    return reply(await decide(db, schoolId, record, user.id, status, note));
  });
}
