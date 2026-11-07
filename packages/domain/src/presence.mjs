import { leaderboardOrdinaryAttempts, leaderboardPaperAttempts } from './leaderboard-attempts.mjs';
import { avatarForIdentity } from './avatars.mjs';
import { transaction } from './db.mjs';
import { LEGACY_SCHOOL_ID } from './legacy-school.mjs';
import { fail, field, integer, uuid } from './security.mjs';

export const PRESENCE_TTL_SECONDS = 90;
export const PRESENCE_HEARTBEAT_SECONDS = 30;

function pageNumber(url, key, fallback, maximum) {
 const value = url.searchParams.get(key) ?? String(fallback);
 if (!/^[1-9]\d{0,4}$/.test(value)) fail(400, 'VALIDATION', `${key}无效`);
 return integer(Number(value), 1, maximum, key);
}

// Legacy-school membership is represented by durable ownership plus live
// account roles, not school_memberships (which deliberately excludes it).
// Recheck the session and persisted role rather than trusting caller metadata.
async function presenceViewer(db, user, sess) {
 const viewer = (await db.query(`SELECT a.identity_id,
  ARRAY(SELECT role FROM account_roles WHERE account_id=a.id) roles,
  EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=a.id AND o.school_id=$3)
   AND EXISTS(SELECT 1 FROM legacy_school_identity_ownership o WHERE o.identity_id=i.id AND o.school_id=$3) AS owned
  FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
  WHERE s.token_hash=$1 AND s.account_id=$2 AND s.expires_at>statement_timestamp()
   AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL`,
 [sess.token_hash, user.id, LEGACY_SCHOOL_ID])).rows[0];
 if (!viewer) fail(401, 'UNAUTHENTICATED', '登录状态已失效');
 if (!viewer.owned || !viewer.roles.some(role => ['student', 'teacher', 'admin'].includes(role))) {
  fail(403, 'FORBIDDEN', '需要本校有效用户权限');
 }
 return viewer;
}

async function studentPreview(db, viewer, identityId) {
 const person = (await db.query(`SELECT i.id,
  CASE WHEN a.leaderboard_use_nickname THEN COALESCE(NULLIF(btrim(a.nickname),''),i.name)
   ELSE i.name END display_name, a.avatar
  FROM identities i JOIN accounts a ON a.identity_id=i.id
  JOIN legacy_school_identity_ownership io ON io.identity_id=i.id AND io.school_id=$2
  JOIN legacy_school_account_ownership ao ON ao.account_id=a.id AND ao.school_id=io.school_id
  WHERE i.id=$1 AND i.kind='student' AND i.archived_at IS NULL
   AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
   AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')`,
 [identityId, LEGACY_SCHOOL_ID])).rows[0];
 if (!person) fail(404, 'NOT_FOUND', '学生近况不可访问');
 const isSelf = viewer.identity_id === person.id;
 const fullStats = isSelf || viewer.roles.some(role => ['teacher', 'admin'].includes(role));
 const totals = (await db.query(`SELECT
  ((SELECT COALESCE(sum(points),0) FROM point_ledger WHERE identity_id=$1)
   +(SELECT COALESCE(sum(points),0) FROM paper4_rank_ledger WHERE identity_id=$1))::int points,
  ((SELECT count(DISTINCT problem_id) FROM point_ledger WHERE identity_id=$1 AND reason='first_ac')
   +(SELECT count(*) FROM paper4_rank_ledger WHERE identity_id=$1))::int solved_problems,
  COALESCE((SELECT balance FROM luq_accounts WHERE identity_id=$1),0)::int scholarship,
  COALESCE((SELECT show_solved_problems FROM leaderboard_settings WHERE id=true),true) show_solved_problems,
  COALESCE((SELECT show_ac_rate FROM leaderboard_settings WHERE id=true),true) show_ac_rate,
  COALESCE((SELECT show_luq_balance FROM leaderboard_settings WHERE id=true),true) show_luq_balance`,
 [identityId])).rows[0];
 const ac = fullStats || totals.show_ac_rate ? (await db.query(`WITH bounds AS (SELECT NULL::timestamptz since_at),
  attempts AS (${leaderboardOrdinaryAttempts}), paper4_attempts AS (${leaderboardPaperAttempts})
  SELECT COALESCE(sum(assessed),0)::int assessed,COALESCE(sum(accepted),0)::int accepted
  FROM (SELECT assessed,accepted FROM attempts WHERE identity_id=$1
   UNION ALL SELECT assessed,accepted FROM paper4_attempts WHERE identity_id=$1) totals`,[identityId])).rows[0] : null;
 // Keep the original profile's first-AC timeline, but do not grant an owner
 // exception for private exercises. Both the accepted version and the current
 // version must remain published for this school's students. No activity,
 // submission detail, reference code or tests are included in the response.
 const activity = (await db.query(`SELECT l.id,v.title,l.created_at
  FROM point_ledger l JOIN submissions s ON s.id=l.submission_id AND s.identity_id=l.identity_id
  JOIN problems p ON p.id=l.problem_id AND p.id=s.problem_id
  JOIN problem_banks b ON b.id=p.bank_id AND b.school_id=$2
  JOIN problem_versions v ON v.id=s.version_id AND v.problem_id=p.id
  JOIN problem_versions current ON current.id=p.current_version_id AND current.problem_id=p.id
  WHERE l.identity_id=$1 AND l.reason='first_ac' AND s.kind='submit' AND s.status='AC'
   AND b.visibility='school' AND b.archived_at IS NULL AND p.archived_at IS NULL
   AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL AND v.rank_review_status='approved'
   AND current.published_at IS NOT NULL AND current.school_visible_at IS NOT NULL AND current.rank_review_status='approved'
   AND (s.timed_attempt_id IS NULL OR EXISTS (
    SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id
    WHERE ta.id=s.timed_attempt_id AND tp.school_id=$2 AND tp.results_published_at IS NOT NULL))
  ORDER BY l.created_at DESC,l.id DESC LIMIT 3`, [identityId, LEGACY_SCHOOL_ID])).rows;
 return {student: {identityId: person.id, displayName: person.display_name,
  avatar: avatarForIdentity(person.avatar, person.id), isSelf},
 stats: {points: totals.points,
  ...(fullStats || totals.show_solved_problems ? {solvedProblems: totals.solved_problems} : {}),
  ...(ac ? {acRate: ac.assessed ? Math.round(ac.accepted * 1000 / ac.assessed) / 10 : null} : {}),
  ...(fullStats || totals.show_luq_balance ? {scholarship: totals.scholarship} : {})},
 activity: activity.map(item => ({id: String(item.id), problemTitle: item.title, createdAt: item.created_at}))};
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
  const viewer = await presenceViewer(pool, user, sess);
  if (!viewer.roles.includes('student')) fail(403, 'FORBIDDEN', '仅学生账号可发送在线心跳');
  const result = await pool.query(`WITH active_session AS MATERIALIZED (
   SELECT s.token_hash FROM sessions s
   JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
   JOIN legacy_school_account_ownership ao ON ao.account_id=a.id AND ao.school_id=$3
   JOIN legacy_school_identity_ownership io ON io.identity_id=i.id AND io.school_id=ao.school_id
   WHERE s.token_hash=$1 AND s.account_id=$2 AND s.expires_at>statement_timestamp()
    AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
    AND i.archived_at IS NULL AND i.kind='student'
    AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')
  ), touched AS (
   UPDATE sessions SET presence_seen_at=statement_timestamp()
   WHERE token_hash IN (SELECT token_hash FROM active_session)
    AND (presence_seen_at IS NULL OR presence_seen_at<=statement_timestamp()-interval '15 seconds')
   RETURNING token_hash
  ) SELECT EXISTS(SELECT 1 FROM active_session) AS active`, [sess.token_hash, user.id, LEGACY_SCHOOL_ID]);
  if (!result.rows[0]?.active) fail(401, 'UNAUTHENTICATED', '登录状态已失效');
  return {status: 200, body: {ok: true, ttlSeconds: PRESENCE_TTL_SECONDS,
   heartbeatIntervalSeconds: PRESENCE_HEARTBEAT_SECONDS}};
 }

 if (method === 'GET' && route === '/presence') {
  const page = pageNumber(url, 'page', 1, 10000);
  const pageSize = pageNumber(url, 'pageSize', 20, 50);
  const query = field(url.searchParams.get('q') ?? '', '搜索内容', {min: 0, max: 80});
  await presenceViewer(pool, user, sess);
  // One query keeps the total and page on the same snapshot. A person with
  // several tabs or devices is counted once, and revoked sessions stop counting
  // immediately even when their last heartbeat has not reached the TTL yet.
  const {rows: [result]} = await pool.query(`WITH online_students AS MATERIALIZED (
   SELECT DISTINCT i.id,
    CASE WHEN a.leaderboard_use_nickname THEN COALESCE(NULLIF(btrim(a.nickname),''),i.name)
     ELSE i.name END AS display_name, a.avatar
   FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
   JOIN legacy_school_account_ownership ao ON ao.account_id=a.id AND ao.school_id=$5
   JOIN legacy_school_identity_ownership io ON io.identity_id=i.id AND io.school_id=ao.school_id
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
   ) item),'[]'::jsonb) AS items`, [PRESENCE_TTL_SECONDS, query, pageSize, (page - 1) * pageSize, LEGACY_SCHOOL_ID]);
  return {status: 200, body: {onlineCount: result.online_count, total: result.total,
   page, pageSize, ttlSeconds: PRESENCE_TTL_SECONDS,
   items: result.items.map(person => ({identityId: person.id, displayName: person.display_name,
    avatar: avatarForIdentity(person.avatar, person.id)}))}};
 }
 const preview = route.match(/^\/presence\/students\/([^/]+)$/);
 if (method === 'GET' && preview) {
  const identityId = uuid(preview[1], '学生 ID');
  const result = await transaction(pool, async db => {
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const viewer = await presenceViewer(db, user, sess);
   return studentPreview(db, viewer, identityId);
  });
  return {status: 200, body: result};
 }
 return null;
}
