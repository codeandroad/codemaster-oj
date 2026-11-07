import { createHmac, randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { auditSchool, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { requireSchoolClassManagement } from './school-teaching.mjs';
import { canonicalHash, fail, safeEqual, tokenHash, uuid } from './security.mjs';

const MAX_ROWS = 500;
const PREVIEW_LIFETIME_MS = 15 * 60 * 1000;
const TOKEN_PURPOSE = 'school-identity-import:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

function invalidRows(message) {
  fail(400, 'IMPORT_INVALID_ROWS', message);
}

function normalizeCell(value, max) {
  if (typeof value !== 'string') return { value: '', valid: false };
  const normalized = value.trim();
  // PostgreSQL text cannot contain NUL; lone surrogates must not silently turn
  // into replacement characters between the signed preview and persistence.
  const valid = normalized.length > 0 && normalized.length <= max && !normalized.includes('\u0000')
    && !Array.from(normalized).some(char => char.codePointAt(0) >= 0xd800 && char.codePointAt(0) <= 0xdfff);
  return { value: normalized.slice(0, max), valid };
}

function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalidRows('导入内容必须是对象');
  if (!['student', 'teacher'].includes(body.kind)) invalidRows('身份类型无效');
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_ROWS) {
    invalidRows(`每批须包含 1–${MAX_ROWS} 行身份资料`);
  }
  let classId = null;
  if (body.classId !== undefined && body.classId !== null) {
    if (typeof body.classId !== 'string' || !UUID.test(body.classId.toLowerCase())) invalidRows('班级 ID 格式无效');
    classId = body.classId.toLowerCase();
  }
  const rows = body.rows.map(row => {
    const record = row !== null && typeof row === 'object' && !Array.isArray(row);
    const number = normalizeCell(record ? row.number : undefined, 64);
    const name = normalizeCell(record ? row.name : undefined, 100);
    return { number: number.value, name: name.value, valid: number.valid && name.valid };
  });
  return { kind: body.kind, classId, rows };
}

function requestHash(input) {
  return canonicalHash({
    kind: input.kind,
    classId: input.classId,
    rows: input.rows.map(({ number, name, valid }) => ({ number, name, valid })),
  });
}

function tokenSignature(encoded, secret) {
  return createHmac('sha256', secret).update(TOKEN_PURPOSE + encoded).digest('base64url');
}

function issuePreviewToken(secret, claims) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encoded}.${tokenSignature(encoded, secret)}`;
}

function readPreviewToken(token, secret, actorId, schoolId, hash) {
  const invalid = () => fail(400, 'IMPORT_PREVIEW_INVALID', '导入预览凭据无效，请重新预览');
  if (typeof token !== 'string' || token.length > 2048) invalid();
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) invalid();
  if (!safeEqual(parts[1], tokenSignature(parts[0], secret))) invalid();
  let claims;
  try {
    const bytes = Buffer.from(parts[0], 'base64url');
    if (bytes.toString('base64url') !== parts[0]) invalid();
    claims = JSON.parse(bytes.toString('utf8'));
  } catch { invalid(); }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || Object.keys(claims).length !== 7 || claims.v !== 1
    || claims.actorId !== actorId || claims.schoolId !== schoolId
    || claims.requestHash !== hash || typeof claims.planHash !== 'string' || !HASH.test(claims.planHash)
    || typeof claims.nonce !== 'string' || !UUID.test(claims.nonce)
    || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= 0) invalid();
  return claims;
}

async function buildPlan(db, schoolId, input) {
  const schoolClass = input.classId ? (await db.query(`
    SELECT id, name, type, revision, archived_at FROM school_classes WHERE school_id = $1 AND id = $2`,
  [schoolId, input.classId])).rows[0] : null;
  const numbers = [...new Set(input.rows.filter(row => row.valid).map(row => row.number))];
  const { rows } = await db.query(`
    SELECT i.id, i.number, i.name, i.account_id AS "accountId", i.archived_at AS "archivedAt",
      EXISTS (SELECT 1 FROM school_class_roster r
        WHERE r.school_id = i.school_id AND r.identity_id = i.id AND r.class_id = $4::uuid) AS "inRoster"
    FROM school_identities i
    WHERE i.school_id = $1 AND i.kind = $2 AND i.number = ANY($3::text[])`,
  [schoolId, input.kind, numbers, input.classId]);
  const existing = new Map(rows.map(identity => [identity.number, identity]));
  const fileNames = new Map();
  for (const row of input.rows) {
    if (!row.valid) continue;
    const names = fileNames.get(row.number) ?? new Set();
    names.add(row.name);
    fileNames.set(row.number, names);
  }
  const summary = { total: input.rows.length, created: 0, existing: 0, duplicates: 0, errors: 0, rosterAdded: 0 };
  const seen = new Set();
  const operations = [];
  const items = input.rows.map((row, index) => {
    const item = { line: index + 1, number: row.number, name: row.name };
    const identity = existing.get(row.number);
    if (!row.valid) {
      summary.errors++;
      return { ...item, status: 'invalid', message: '编号须为 1–64 个字符，姓名须为 1–100 个字符，且均须为有效文本' };
    }
    if (identity?.archivedAt) {
      summary.errors++;
      return { ...item, status: 'conflict', message: '该编号对应的学生档案已归档' };
    }
    if (fileNames.get(row.number).size > 1 || (identity && identity.name !== row.name)) {
      summary.errors++;
      return { ...item, status: 'conflict', message: '同一编号对应不同姓名，请核对后重新预览' };
    }
    if (seen.has(row.number)) {
      summary.duplicates++;
      return { ...item, status: 'duplicate', message: '与本批前面的记录相同，将跳过此行' };
    }
    seen.add(row.number);
    const status = identity ? 'existing' : 'create';
    summary[identity ? 'existing' : 'created']++;
    const addToRoster = Boolean(input.classId && !identity?.inRoster);
    if (addToRoster) summary.rosterAdded++;
    operations.push({ number: row.number, name: row.name, identityId: identity?.id ?? null, addToRoster });
    return { ...item, status, ...(identity ? { message: '保留本校已有身份资料' } : {}) };
  });
  // Hash only the relevant snapshot, in request order. Account links are part
  // of that snapshot even though an import can never modify them.
  const hash = canonicalHash({
    schoolClass: schoolClass ?? null,
    items,
    identities: numbers.map(number => existing.get(number) ?? null),
    summary,
  });
  return { items, summary, hash, operations, classExists: !input.classId || Boolean(schoolClass) };
}

export async function handleSchoolIdentityImports({ pool, config, user, route, method, body }) {
  const match = route.match(/^\/schools\/([^/]+)\/identity-imports\/(preview|commit)$/);
  if (!match || method !== 'POST') return null;
  const schoolId = uuid(match[1], '学校 ID').toLowerCase();
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId, { shared: match[2] === 'preview' });
    const role = await schoolRole(db, schoolId, user.id);
    if (role !== 'school_admin' && role !== 'teacher') fail(403, 'FORBIDDEN', '需要本校教职权限');
    const input = normalizeRequest(body);
    if (role === 'teacher' && (input.kind !== 'student' || !input.classId)) {
      fail(403, 'FORBIDDEN', '教师只能向负责的班级导入学生');
    }
    const hash = requestHash(input);
    if (match[2] === 'preview') {
      if (input.classId) await requireSchoolClassManagement(db, schoolId, user.id, role, input.classId);
      const plan = await buildPlan(db, schoolId, input);
      if (!plan.classExists) fail(404, 'NOT_FOUND', '本校班级不存在');
      const canCommit = plan.summary.errors === 0;
      const expiresAt = canCommit ? Date.now() + PREVIEW_LIFETIME_MS : null;
      const previewToken = canCommit ? issuePreviewToken(config.secret, {
        v: 1, actorId: user.id, schoolId, requestHash: hash, planHash: plan.hash,
        expiresAt, nonce: randomUUID(),
      }) : null;
      return { status: 200, body: {
        items: plan.items, summary: plan.summary, canCommit, previewToken,
        expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
      } };
    }

    const claims = readPreviewToken(body.previewToken, config.secret, user.id, schoolId, hash);
    const schoolClass = input.classId
      ? await requireSchoolClassManagement(db, schoolId, user.id, role, input.classId, { allowArchived: true }) : null;
    const { rows: [receipt] } = await db.query(`
      SELECT request_hash, preview_token_hash, aggregate_result FROM school_identity_imports
      WHERE school_id = $1 AND actor_account_id = $2 AND preview_nonce = $3`, [schoolId, user.id, claims.nonce]);
    if (receipt) {
      if (receipt.request_hash !== hash || receipt.preview_token_hash !== tokenHash(body.previewToken)) {
        fail(400, 'IMPORT_PREVIEW_INVALID', '导入预览凭据无效，请重新预览');
      }
      // A successful receipt is replayable after token expiry, but only after
      // validating the signature, request, actor, school, and current authority.
      return { status: 200, body: receipt.aggregate_result };
    }
    if (schoolClass?.archived) fail(409, 'CLASS_ARCHIVED', '请先恢复已归档班级');
    if (claims.expiresAt <= Date.now()) fail(409, 'IMPORT_PREVIEW_EXPIRED', '导入预览已过期，请重新预览');
    const plan = await buildPlan(db, schoolId, input);
    if (!plan.classExists || plan.hash !== claims.planHash) {
      fail(409, 'IMPORT_PREVIEW_STALE', '本校身份资料或班级名单已变化，请重新预览');
    }
    if (plan.summary.errors) invalidRows('导入内容仍有错误，请修正后重新预览');

    const batchId = randomUUID();
    for (const operation of plan.operations) {
      let identityId = operation.identityId;
      if (!identityId) {
        const { rows: [identity] } = await db.query(`
          INSERT INTO school_identities (school_id, kind, number, name)
          VALUES ($1, $2, $3, $4) RETURNING id`, [schoolId, input.kind, operation.number, operation.name]);
        identityId = identity.id;
        await auditSchool(db, schoolId, user.id, 'school.identity.create', identityId);
      }
      if (operation.addToRoster) {
        await db.query(`INSERT INTO school_class_roster (school_id, class_id, identity_id)
          VALUES ($1, $2, $3)`, [schoolId, input.classId, identityId]);
        await auditSchool(db, schoolId, user.id, 'school.roster.add', identityId);
      }
    }
    const { errors, ...summary } = plan.summary;
    const result = { batchId, summary };
    await db.query(`
      INSERT INTO school_identity_imports
        (id, school_id, actor_account_id, class_id, preview_nonce, preview_token_hash, request_hash, aggregate_result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [batchId, schoolId, user.id, input.classId, claims.nonce, tokenHash(body.previewToken), hash, result]);
    await auditSchool(db, schoolId, user.id, 'school.identity.import', batchId);
    return { status: 200, body: result };
  });
}
