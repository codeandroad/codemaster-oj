import { avatarForIdentity } from './avatars.mjs';
import { fail, field, integer, uuid } from './security.mjs';

export const PRESENCE_HEARTBEAT_SECONDS = 30;
export const PRESENCE_TTL_SECONDS = 90;

const activeSession = `s.expires_at>statement_timestamp() AND a.disabled_at IS NULL
 AND a.binding_released_at IS NULL AND i.archived_at IS NULL`;
// A school presence session counts only for learners with an active student
// membership; staff and released or disabled accounts never appear online.
const schoolOnline = `${activeSession} AND i.kind='student'
 AND s.presence_seen_at>statement_timestamp()-interval '90 seconds'
 AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.account_id=a.id AND m.role='student' AND m.revoked_at IS NULL)`;

function pageNumber(url, key, fallback, maximum) {
 const value = url.searchParams.get(key) ?? String(fallback);
 if (!/^[1-9]\d{0,4}$/.test(value)) fail(400, 'VALIDATION', `${key} is invalid.`);
 return integer(Number(value), 1, maximum, key);
}

const displayName = `COALESCE(CASE WHEN a.leaderboard_use_nickname THEN NULLIF(btrim(a.nickname),'') END, i.name)`;

async function viewer(db, user, sess) {
 const {rows:[account]} = await db.query(`SELECT a.id,i.kind,EXISTS(
  SELECT 1 FROM school_memberships m WHERE m.account_id=a.id AND m.revoked_at IS NULL) AS member
  FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
  WHERE s.token_hash=$1 AND s.account_id=$2 AND ${activeSession}`, [sess.token_hash,user.id]);
 if (!account) fail(401, 'UNAUTHENTICATED', 'Please sign in again.');
 return account;
}

export async function handlePresence({pool,user,sess,route,method,body={},url}) {
 if (!user || !sess) fail(401, 'UNAUTHENTICATED', 'Please sign in.');
 if (method === 'POST' && route === '/presence/heartbeat') {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
   fail(400, 'VALIDATION', 'Presence does not accept identities, timestamps or page information.');
  }
  const account = await viewer(pool,user,sess);
  if (account.kind !== 'student' || !account.member) fail(403, 'FORBIDDEN', 'Learner account required.');
  const {rows:[result]} = await pool.query(`WITH active AS MATERIALIZED (
   SELECT s.token_hash FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
   WHERE s.token_hash=$1 AND s.account_id=$2 AND ${activeSession} AND i.kind='student'
    AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.account_id=a.id AND m.role='student' AND m.revoked_at IS NULL)
  ), touched AS (
   UPDATE sessions SET presence_seen_at=statement_timestamp()
   WHERE token_hash IN (SELECT token_hash FROM active)
    AND (presence_seen_at IS NULL OR presence_seen_at<=statement_timestamp()-interval '15 seconds')
   RETURNING token_hash
  ) SELECT EXISTS(SELECT 1 FROM active) active`, [sess.token_hash,user.id]);
  if (!result?.active) fail(401, 'UNAUTHENTICATED', 'Please sign in again.');
  return {status:200,body:{ok:true,ttlSeconds:PRESENCE_TTL_SECONDS,heartbeatIntervalSeconds:PRESENCE_HEARTBEAT_SECONDS}};
 }
 if (method === 'GET' && route === '/presence') {
  const page=pageNumber(url,'page',1,10000),pageSize=pageNumber(url,'pageSize',20,50);
  const query=field(url.searchParams.get('q') ?? '', 'Search', {min:0,max:80});
  await viewer(pool,user,sess);
  const {rows:[result]} = await pool.query(`WITH online AS MATERIALIZED (
   SELECT DISTINCT i.id,${displayName} display_name,a.avatar FROM sessions s
   JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id WHERE ${schoolOnline}
  ), matching AS MATERIALIZED (SELECT * FROM online WHERE strpos(lower(display_name),lower($1))>0)
  SELECT (SELECT count(*)::int FROM online) online_count,(SELECT count(*)::int FROM matching) total,
   COALESCE((SELECT jsonb_agg(item ORDER BY lower(item.display_name),item.id) FROM (
    SELECT id,display_name,avatar FROM matching ORDER BY lower(display_name),id LIMIT $2 OFFSET $3
   ) item),'[]'::jsonb) items`, [query,pageSize,(page-1)*pageSize]);
  return {status:200,body:{onlineCount:result.online_count,total:result.total,page,pageSize,
   ttlSeconds:PRESENCE_TTL_SECONDS,
   items:result.items.map(item=>({identityId:item.id,displayName:item.display_name,
    avatar:avatarForIdentity(item.avatar,item.id)}))}};
 }
 return null;
}
