import { transaction } from './db.mjs';
import { canonicalHash, fail, field, integer, uuid } from './security.mjs';

const response = body => ({ status: 200, body });
const admin = user => { if (!user.roles.includes('admin')) fail(403, 'FORBIDDEN', '需要管理员权限'); };
export const luqLedgerShape = row => ({ id: String(row.id), identityId: row.identity_id, delta: row.delta,
 balanceAfter: row.balance_after, kind: row.kind, reason: row.reason, metadata: row.metadata,
 createdAt: row.created_at, refundOf: row.refund_of ? String(row.refund_of) : null, refunded: row.refunded,
 studentName: row.student_name, studentNumber: row.student_number });
export async function getLuqSettings(db) {
 const row = (await db.query('SELECT * FROM luq_settings WHERE singleton')).rows[0];
 return { initialGrant: row.initial_grant, firstAcReward: row.first_ac_reward, translationPrice: row.translation_price,
  solutionPrice: row.solution_price, activityRewardCap: row.activity_reward_cap, ruleVersion: row.rule_version, enabledAt: row.enabled_at };
}
export async function postLuqEntry(db, { identityId, delta, kind, sourceKey, actorAccountId = null,
 reason, metadata = {}, refundOf = null, requestHash = null, requestKey = null }) {
 try {
  const row = (await db.query('SELECT * FROM luq_post_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [identityId, delta, kind, sourceKey, actorAccountId, reason, metadata, refundOf, requestHash, requestKey])).rows[0];
  return luqLedgerShape(row);
 } catch (error) {
  if (error.message.includes('LUQ_INSUFFICIENT_BALANCE')) fail(409, 'LUQ_INSUFFICIENT_BALANCE', 'Luq 余额不足');
  if (error.code === '23505' || error.message.includes('LUQ_IDEMPOTENCY_CONFLICT')) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求编号已用于其他操作');
  if (error.message.includes('LUQ_INVALID_REFUND')) fail(400, 'LUQ_INVALID_REFUND', '只能全额退还原 Luq 消费');
  if (error.message.includes('LUQ_BALANCE_LIMIT')) fail(409, 'LUQ_BALANCE_LIMIT', 'Luq 余额超过上限');
  if (error.message.includes('LUQ_STUDENT_REQUIRED')) fail(400, 'LUQ_STUDENT_REQUIRED', 'Luq 账户必须关联学生身份');
  throw error;
 }
}
const ids = (value, name) => {
 if (value === undefined) return [];
 if (!Array.isArray(value) || value.length > 1000) fail(400, 'VALIDATION', `${name}最多 1000 项`);
 return [...new Set(value.map(id => uuid(id, name)))].sort();
};
async function changeBatch(ctx, kind) {
 admin(ctx.user);
 const body = ctx.body, requestId = uuid(body.requestId, '请求编号');
 const identityIds = ids(body.identityIds, '学生身份'), classIds = ids(body.classIds, '班级');
 const amount = integer(body.amount, kind === 'admin_grant' ? 1 : -100000, 100000, 'Luq 数量');
 if (!amount) fail(400, 'VALIDATION', '调整数量不能为零');
 const reason = field(body.reason, '原因', { max: 2000 });
 const hash = canonicalHash({ identityIds, classIds, amount, reason, kind, actor: ctx.user.id });
 return transaction(ctx.pool, async db => {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-batch:'||$1,0))", [requestId]);
  let batch = (await db.query('SELECT * FROM luq_admin_batches WHERE request_id=$1', [requestId])).rows[0];
  if (batch && batch.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求编号已用于其他操作');
  if (!batch) {
   if (classIds.length && (await db.query('SELECT id FROM classes WHERE id=ANY($1::uuid[]) AND archived_at IS NULL', [classIds])).rowCount !== classIds.length)
    fail(400, 'VALIDATION', '包含不存在或已归档的班级');
   const recipients = (await db.query(`SELECT DISTINCT i.id FROM identities i WHERE i.kind='student' AND i.archived_at IS NULL
    AND (i.id=ANY($1::uuid[]) OR EXISTS(SELECT 1 FROM class_members cm WHERE cm.identity_id=i.id AND cm.class_id=ANY($2::uuid[]))) ORDER BY i.id`, [identityIds, classIds])).rows.map(row => row.id);
   if (!recipients.length || identityIds.some(id => !recipients.includes(id))) fail(400, 'VALIDATION', '请选择有效学生或班级');
   if (recipients.length > 5000) fail(400, 'VALIDATION', '每批最多 5000 名学生');
   batch = (await db.query(`INSERT INTO luq_admin_batches(request_id,request_hash,actor_account_id,identity_ids,amount,kind,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [requestId, hash, ctx.user.id, recipients, amount, kind, reason])).rows[0];
  }
  const items = [];
  for (const identityId of batch.identity_ids) items.push(await postLuqEntry(db, { identityId, delta: amount, kind,
   sourceKey: `admin:${requestId}:${identityId}`, actorAccountId: ctx.user.id, reason, requestHash: hash,
   metadata: { batchId: requestId } }));
  return response({ requestId, count: items.length, items });
 });
}
export async function handleLuqLedger(ctx) {
 const { pool, route, method, user, body, url } = ctx;
 if (route === '/luq/me' && method === 'GET') {
  if (!user.roles.includes('student')) fail(403, 'FORBIDDEN', '需要学生身份');
  const balance = (await pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1', [user.identityId])).rows[0]?.balance ?? 0;
  const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, '页码'), pageSize = 50;
  const total = Number((await pool.query('SELECT count(*) FROM luq_ledger WHERE identity_id=$1', [user.identityId])).rows[0].count);
  const items = (await pool.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3', [user.identityId,pageSize,(page-1)*pageSize])).rows.map(luqLedgerShape);
  return response({ balance, items, total, page, pageSize });
 }
 if (route === '/luq/reviews' && method === 'GET') {
  admin(user);
  const items = (await pool.query('SELECT r.*,i.name student_name FROM luq_review_cases r JOIN identities i ON i.id=r.identity_id ORDER BY r.id DESC LIMIT 200')).rows.map(r => ({id:String(r.id),identityId:r.identity_id,studentName:r.student_name,subjectKey:r.subject_key,reason:r.reason,metadata:r.metadata,createdAt:r.created_at}));
  return response({items});
 }
 if (route === '/luq/ledger' && method === 'GET') {
  admin(user);
  const identityId = url.searchParams.get('identityId') ? uuid(url.searchParams.get('identityId')) : null;
  const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, '页码'), pageSize = 50;
  const total = Number((await pool.query('SELECT count(*) FROM luq_ledger WHERE ($1::uuid IS NULL OR identity_id=$1)', [identityId])).rows[0].count);
  const rows = (await pool.query(`SELECT l.*,i.name student_name,i.number student_number,
   EXISTS(SELECT 1 FROM luq_ledger refund WHERE refund.refund_of=l.id) refunded
   FROM luq_ledger l JOIN identities i ON i.id=l.identity_id
   WHERE ($1::uuid IS NULL OR l.identity_id=$1) ORDER BY l.id DESC LIMIT $2 OFFSET $3`, [identityId, pageSize, (page - 1) * pageSize])).rows;
  return response({ items: rows.map(luqLedgerShape), total, page, pageSize });
 }
 if (route === '/luq/settings' && method === 'GET') return response(await getLuqSettings(pool));
 if (route === '/luq/settings' && method === 'PATCH') {
  admin(user);
  return transaction(pool, async db => {
   await db.query('SELECT singleton FROM luq_settings WHERE singleton FOR UPDATE');
   const old = await getLuqSettings(db);
   const next = { initialGrant: integer(body.initialGrant ?? old.initialGrant, 0, 100000, '初始 Luq'),
    firstAcReward: integer(body.firstAcReward ?? old.firstAcReward, 0, 100, '首次 AC Luq'),
    translationPrice: integer(body.translationPrice ?? old.translationPrice, 0, 1000, '翻译价格'),
    solutionPrice: integer(body.solutionPrice ?? old.solutionPrice, 0, 1000, '题解价格'),
    activityRewardCap: integer(body.activityRewardCap ?? old.activityRewardCap, 0, 1000, '活动奖励额度') };
   await db.query('UPDATE luq_settings SET first_ac_reward=$1,translation_price=$2,solution_price=$3,activity_reward_cap=$4,updated_by=$5,initial_grant=$6,rule_version=rule_version+1,updated_at=clock_timestamp() WHERE singleton',
    [next.firstAcReward, next.translationPrice, next.solutionPrice, next.activityRewardCap, user.id, next.initialGrant]);
   await db.query("INSERT INTO audit_events(actor_account_id,action,resource_type,metadata) VALUES($1,'luq.settings','luq',$2)", [user.id, { previous: old, next }]);
   return response(await getLuqSettings(db));
  });
 }
 if (route === '/luq/grants' && method === 'POST') return changeBatch(ctx, 'admin_grant');
 if (route === '/luq/adjustments' && method === 'POST') return changeBatch(ctx, 'admin_adjustment');
 if (route === '/luq/refunds' && method === 'POST') {
  admin(user);
  const requestId = uuid(body.requestId, '请求编号'), ledgerId = String(body.ledgerId ?? '');
  if (!/^[1-9][0-9]{0,18}$/.test(ledgerId)) fail(400, 'VALIDATION', '消费流水编号无效');
  const reason = field(body.reason, '退款原因', { max: 2000 });
  return transaction(pool, async db => {
   const original = (await db.query("SELECT * FROM luq_ledger WHERE id=$1 AND kind='purchase'", [ledgerId])).rows[0];
   if (!original) fail(404, 'NOT_FOUND', '原消费不存在');
   return response(await postLuqEntry(db, { identityId: original.identity_id, delta: -original.delta, kind: 'refund',
    sourceKey: `refund:${ledgerId}`, requestKey: `refund:${user.id}:${requestId}`, actorAccountId: user.id, reason,
    refundOf: ledgerId, metadata: { originalLedgerId: ledgerId }, requestHash: canonicalHash({ ledgerId }) }));
  });
 }
 return null;
}
