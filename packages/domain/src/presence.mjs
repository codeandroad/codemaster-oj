import { avatarForIdentity } from './avatars.mjs';
import { fail, field, integer } from './security.mjs';

export const PRESENCE_TTL_SECONDS = 90;
export const PRESENCE_HEARTBEAT_SECONDS = 30;

function pageNumber(url, key, fallback, maximum) {
 const value = url.searchParams.get(key) ?? String(fallback);
 if (!/^[1-9]\d{0,4}$/.test(value)) fail(400, 'VALIDATION', `${key}无效`);
 return integer(Number(value), 1, maximum, key);
}

export async function handlePresence({pool, user, sess, route, method, body = {}, url}) {
 if (!user || !sess) fail(401, 'UNAUTHENTICATED', '请先登录');
 if (!user.roles.some(role => ['student', 'teacher', 'admin'].includes(role))) {
  fail(403, 'FORBIDDEN', '需要校内用户权限');
 }

 if (method === 'POST' && route === '/presence/heartbeat') {
  if (!user.roles.includes('student')) fail(403, 'FORBIDDEN', '仅学生账号可发送在线心跳');
  // Identity, location and time are never accepted from the browser. Presence
  // has no reward event and stores neither a page URL nor a problem/activity ID.
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
   fail(400, 'VALIDATION', '在线心跳不接受用户身份、时间或页面参数');
  }
  const result = await pool.query(`WITH active_session AS MATERIALIZED (
   SELECT s.token_hash FROM sessions s
   JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
   WHERE s.token_hash=$1 AND s.account_id=$2 AND s.expires_at>statement_timestamp()
    AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
    AND i.archived_at IS NULL AND i.kind='student'
    AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')
  ), touched AS (
   UPDATE sessions SET presence_seen_at=statement_timestamp()
   WHERE token_hash IN (SELECT token_hash FROM active_session)
    AND (presence_seen_at IS NULL OR presence_seen_at<=statement_timestamp()-interval '15 seconds')
   RETURNING token_hash
  ) SELECT EXISTS(SELECT 1 FROM active_session) AS active`, [sess.token_hash, user.id]);
  if (!result.rows[0]?.active) fail(401, 'UNAUTHENTICATED', '登录状态已失效');
  return {status: 200, body: {ok: true, ttlSeconds: PRESENCE_TTL_SECONDS,
   heartbeatIntervalSeconds: PRESENCE_HEARTBEAT_SECONDS}};
 }

 if (method === 'GET' && route === '/presence') {
  const page = pageNumber(url, 'page', 1, 10000);
  const pageSize = pageNumber(url, 'pageSize', 20, 50);
  const query = field(url.searchParams.get('q') ?? '', '搜索内容', {min: 0, max: 80});
  // One query keeps the total and page on the same snapshot. A person with
  // several tabs or devices is counted once, and revoked sessions stop counting
  // immediately even when their last heartbeat has not reached the TTL yet.
  const {rows: [result]} = await pool.query(`WITH online_students AS MATERIALIZED (
   SELECT DISTINCT i.id,
    CASE WHEN a.leaderboard_use_nickname THEN COALESCE(NULLIF(btrim(a.nickname),''),i.name)
     ELSE i.name END AS display_name, a.avatar
   FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
   WHERE s.presence_seen_at>statement_timestamp()-($1::int * interval '1 second')
    AND s.expires_at>statement_timestamp() AND a.disabled_at IS NULL
    AND a.binding_released_at IS NULL AND i.archived_at IS NULL AND i.kind='student'
    AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')
  ), matching AS MATERIALIZED (
   SELECT * FROM online_students WHERE strpos(lower(display_name),lower($2))>0
  ) SELECT (SELECT count(*)::int FROM online_students) AS online_count,
   (SELECT count(*)::int FROM matching) AS total,
   COALESCE((SELECT jsonb_agg(item ORDER BY lower(item.display_name),item.id) FROM (
    SELECT id,display_name,avatar FROM matching ORDER BY lower(display_name),id LIMIT $3 OFFSET $4
   ) item),'[]'::jsonb) AS items`, [PRESENCE_TTL_SECONDS, query, pageSize, (page - 1) * pageSize]);
  return {status: 200, body: {onlineCount: result.online_count, total: result.total,
   page, pageSize, ttlSeconds: PRESENCE_TTL_SECONDS,
   items: result.items.map(person => ({identityId: person.id, displayName: person.display_name,
    avatar: avatarForIdentity(person.avatar, person.id)}))}};
 }
 return null;
}
