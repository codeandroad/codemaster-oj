import { transaction } from './db.mjs';
import { activeAccount, auditSchool, lockSchoolTeaching, requireSchoolAdmin } from './schools.mjs';
import { enumValue, fail, field, uuid } from './security.mjs';

const result = (body, status = 200) => ({ status, body });

// Callers hold the school teaching lock. Existing unlinked members can complete
// their dossier without changing their existing school role.
async function checkApplicant(db, schoolId, accountId, kind) {
  await activeAccount(db, accountId);
  const {
    rows: [member],
  } = await db.query(
    `SELECT m.role,m.suspended,m.revoked_at,
    EXISTS(SELECT 1 FROM school_administrators g WHERE g.school_id=m.school_id
      AND g.account_id=m.account_id AND g.revoked_at IS NULL) AS administrator
    FROM school_memberships m WHERE school_id=$1 AND account_id=$2 FOR UPDATE`,
    [schoolId, accountId],
  );
  if (member?.suspended) fail(409, 'SCHOOL_ACCESS_SUSPENDED', '本校访问已暂停，请联系学校管理员');
  if (member && ((!member.revoked_at && member.role !== kind) || (member.revoked_at && member.administrator)))
    fail(409, 'ROLE_CONFLICT', '成员角色与申请不符，请联系学校管理员');
  const linked = await db.query('SELECT 1 FROM school_identities WHERE school_id=$1 AND account_id=$2', [schoolId, accountId]);
  if (linked.rowCount) fail(409, 'ALREADY_LINKED', '账号已经关联本校身份');
}

export async function bindSchoolIdentity(db, schoolId, accountId, identity, actorId, requestId = null) {
  await checkApplicant(db, schoolId, accountId, identity.kind);
  await db.query(
    `INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)
    ON CONFLICT(school_id,account_id) DO UPDATE SET role=excluded.role,revoked_at=NULL,joined_at=clock_timestamp()
    WHERE school_memberships.revoked_at IS NOT NULL AND NOT school_memberships.suspended`,
    [schoolId, accountId, identity.kind],
  );
  const bound = await db.query(
    `UPDATE school_identities SET account_id=$3 WHERE school_id=$1 AND id=$2
    AND account_id IS NULL AND archived_at IS NULL AND kind IN ('student','teacher')`,
    [schoolId, identity.id, accountId],
  );
  if (!bound.rowCount) fail(409, 'IDENTITY_UNAVAILABLE', '身份已变更，请重新核对档案');
  const consumed = await db.query(
    `UPDATE school_activation_tokens SET consumed_at=clock_timestamp()
    WHERE school_id=$1 AND identity_id=$2 AND consumed_at IS NULL AND ($3::boolean OR expires_at>clock_timestamp())`,
    [schoolId, identity.id, requestId !== null],
  );
  if (!requestId && !consumed.rowCount) fail(400, 'CLAIM_FAILED', '认领码已失效');
  if (!requestId) await closePendingSchoolRequests(db, schoolId, accountId, actorId);
}

export async function closePendingSchoolRequests(db, schoolId, accountId, actorId) {
  await db.query(
    `UPDATE school_join_requests SET status='superseded',decided_at=clock_timestamp(),decided_by=$3
    WHERE school_id=$1 AND account_id=$2 AND status='pending'`,
    [schoolId, accountId, actorId],
  );
}

export async function handleSchoolJoinRequests({ pool, route, method, user, body }) {
  if (method === 'GET' && route === '/schools/join-requests') {
    const { rows } = await pool.query(
      `SELECT r.id,s.name AS "schoolName",r.status,r.number,r.name,r.kind FROM school_join_requests r
      JOIN schools s ON s.id=r.school_id WHERE r.account_id=$1 ORDER BY r.created_at DESC`,
      [user.id],
    );
    return result({ items: rows });
  }
  const match = route.match(/^\/schools\/([^/]+)\/join-requests(?:\/([^/]+)\/(decision|candidates))?$/);
  if (!match) return null;
  const schoolId = uuid(match[1]);
  return transaction(pool, async (db) => {
    await lockSchoolTeaching(db, schoolId, { shared: method === 'GET' });
    if (!match[2] && method === 'POST') {
      const kind = enumValue(body.kind, ['student', 'teacher'], '身份类型');
      const number = field(body.number ?? '', '学号或工号', { min:kind === 'student' ? 0 : 1, max:64 }) || null;
      const name = field(body.name, '姓名', { max:100 });
      const hint = number ? null : field(body.rosterHint, '班级或核验线索', { max:160 });
      if (!(await db.query('SELECT 1 FROM schools WHERE id=$1', [schoolId])).rowCount)
        fail(404, 'NOT_FOUND', '学校不存在');
      await checkApplicant(db, schoolId, user.id, kind);
      const {
        rows: [pending],
      } = await db.query(
        `SELECT id,kind,number,name,roster_hint FROM school_join_requests
        WHERE school_id=$1 AND account_id=$2 AND status='pending'`,
        [schoolId, user.id],
      );
      if (pending) {
        if (pending.kind !== kind || pending.number !== number || pending.name !== name || pending.roster_hint !== hint)
          fail(409, 'REQUEST_PENDING', '已有待审核申请，请联系学校管理员');
        return result({ id: pending.id, status: 'pending' });
      }
      const {
        rows: [created],
      } = await db.query(
        `INSERT INTO school_join_requests(school_id,account_id,kind,number,name,roster_hint)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status`,
        [schoolId, user.id, kind, number, name, hint],
      );
      return result(created, 201);
    }
    await requireSchoolAdmin(db, schoolId, user.id);
    if (method === 'GET' && !match[2]) {
      const { rows } = await db.query(
        `SELECT r.id,r.name,r.number,r.kind,r.roster_hint AS "rosterHint",a.username,i.id AS "identityId"
        FROM school_join_requests r JOIN accounts a ON a.id=r.account_id LEFT JOIN school_identities i
        ON i.school_id=r.school_id AND i.kind=r.kind AND i.number=r.number AND i.name=r.name
        AND i.archived_at IS NULL AND i.account_id IS NULL
        WHERE r.school_id=$1 AND r.status='pending' ORDER BY r.created_at,r.id`,
        [schoolId],
      );
      return result({ items: rows });
    }
    if (method === 'GET' && match[3] === 'candidates') {
      const { rows } = await db.query(`SELECT i.id,i.number,ARRAY(
        SELECT c.name FROM school_class_roster roster JOIN school_classes c
          ON c.school_id=roster.school_id AND c.id=roster.class_id
        WHERE roster.school_id=i.school_id AND roster.identity_id=i.id AND c.archived_at IS NULL ORDER BY c.name,c.id
      ) AS classes FROM school_join_requests r JOIN school_identities i
        ON i.school_id=r.school_id AND i.kind=r.kind AND i.name=r.name
        WHERE r.school_id=$1 AND r.id=$2 AND r.status='pending' AND r.number IS NULL
          AND i.archived_at IS NULL AND i.account_id IS NULL ORDER BY i.number,i.id`,[schoolId,uuid(match[2])]);
      return result({items:rows});
    }
    if (method !== 'POST' || match[3] !== 'decision') return null;
    const id = uuid(match[2]),
      decision = enumValue(body.decision, ['approved', 'rejected'], '审核结果');
    const identityId = decision === 'approved' ? uuid(body.identityId, '身份档案') : null;
    const {
      rows: [request],
    } = await db.query('SELECT * FROM school_join_requests WHERE school_id=$1 AND id=$2 FOR UPDATE', [
      schoolId,
      id,
    ]);
    if (!request) fail(404, 'NOT_FOUND', '入校申请不存在');
    if (request.status !== 'pending') {
      if (request.status === decision && request.identity_id === identityId)
        return result({ id, status: decision });
      fail(409, 'ALREADY_REVIEWED', '申请状态已变更，请刷新');
    }
    const verification = identityId && request.number === null
      ? enumValue(body.verificationMethod, ['in_person','school_contact'], '独立核验方式') : null;
    if (identityId) {
      const {
        rows: [identity],
      } = await db.query(
        `SELECT id,kind FROM school_identities WHERE school_id=$1 AND id=$2 AND kind=$3
        AND ($4::text IS NULL OR number=$4) AND name=$5 AND account_id IS NULL AND archived_at IS NULL FOR UPDATE`,
        [schoolId, identityId, request.kind, request.number, request.name],
      );
      if (!identity) fail(409, 'IDENTITY_UNAVAILABLE', '请重新核对本校未关联的身份档案');
      await bindSchoolIdentity(db, schoolId, request.account_id, identity, user.id, id);
      await auditSchool(db, schoolId, user.id, 'school.identity.link', identityId);
    }
    await db.query(
      `UPDATE school_join_requests SET status=$2,identity_id=$3,decided_at=clock_timestamp(),decided_by=$4,verification_method=$5
      WHERE id=$1`,
      [id, decision, identityId, user.id, verification],
    );
    await auditSchool(db, schoolId, user.id, 'school.join_request.' + decision, id);
    return result({ id, status: decision });
  });
}
