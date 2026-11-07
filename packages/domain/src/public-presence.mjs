import { avatarForIdentity } from './avatars.mjs';
import { transaction } from './db.mjs';
import { availableLegacyPublicProblemVersions } from './legacy-public-problems.mjs';
import { LEGACY_SCHOOL_ID } from './legacy-school.mjs';
import { PRESENCE_HEARTBEAT_SECONDS, PRESENCE_TTL_SECONDS } from './presence.mjs';
import { fail, field, integer, uuid } from './security.mjs';

const displayName = `COALESCE(CASE WHEN a.leaderboard_use_nickname THEN NULLIF(btrim(a.nickname),'') END,
 'Learner-'||upper(left(md5('public-practice:'||a.id::text),8)))`;
const activeSession = `s.expires_at>statement_timestamp() AND a.disabled_at IS NULL
 AND a.binding_released_at IS NULL AND i.archived_at IS NULL`;
const publicOnline = `${activeSession} AND i.kind IN ('student','personal')
 AND s.public_presence_seen_at>statement_timestamp()-interval '90 seconds'`;

function pageNumber(url, key, fallback, maximum) {
 const value = url.searchParams.get(key) ?? String(fallback);
 if (!/^[1-9]\d{0,4}$/.test(value)) fail(400, 'VALIDATION', `${key} is invalid.`);
 return integer(Number(value), 1, maximum, key);
}

async function viewer(db, user, sess) {
 const {rows:[account]} = await db.query(`SELECT a.id,i.kind FROM sessions s
  JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
  WHERE s.token_hash=$1 AND s.account_id=$2 AND ${activeSession}`, [sess.token_hash,user.id]);
 if (!account) fail(401, 'UNAUTHENTICATED', 'Please sign in again.');
 return account;
}

async function preview(db, accountId, targetId) {
 const {rows:[person]} = await db.query(`SELECT DISTINCT a.id,a.identity_id,${displayName} display_name,a.avatar
  FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
  WHERE a.id=$1 AND ${publicOnline}`, [targetId]);
 if (!person) fail(404, 'NOT_FOUND', 'This learner is not currently online in public practice.');
 const {rows:[row]} = await db.query('SELECT public_practice_presence_stats($1) stats', [targetId]);
 const {solved,attempts,recent} = row.stats;
 // The public wallet is keyed by the stable global identity. School-specific
 // scholarship accounts and private school grades are never queried here.
 const {rows:[wallet]} = await db.query('SELECT balance FROM luq_accounts WHERE identity_id=$1', [person.identity_id]);
 const activity = [];
 for (const item of recent) {
  await db.query("SELECT set_config('campus.school_id',$1,true)", [item.schoolId]);
  const {rows:[problem]} = await db.query(`SELECT v.definition->>'title' title
   FROM school_problem_publications pub
   JOIN school_problems p ON p.school_id=pub.school_id AND p.id=pub.problem_id
   JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
   JOIN school_problem_versions v ON v.school_id=pub.school_id AND v.id=pub.version_id AND v.problem_id=p.id
   WHERE pub.school_id=$1 AND pub.problem_id=$2 AND pub.version_id=$3 AND pub.withdrawn_at IS NULL
    AND p.published AND p.published_version_id=pub.version_id AND NOT b.archived`,
  [item.schoolId,item.problemId,item.versionId]);
  if (!problem?.title) continue;
  if (item.schoolId === LEGACY_SCHOOL_ID &&
   !(await availableLegacyPublicProblemVersions(db, [item.versionId])).has(item.versionId)) continue;
  activity.push({id:item.id,problemTitle:problem.title,createdAt:item.createdAt});
  if (activity.length === 3) break;
 }
 return {student:{identityId:person.id,displayName:person.display_name,
  avatar:avatarForIdentity(person.avatar,person.display_name),isSelf:person.id === accountId},
 stats:{points:solved*10,solvedProblems:solved,acRate:attempts ? Math.round(solved*1000/attempts)/10 : null,
  scholarship:wallet?.balance ?? 0},activity};
}

export async function handlePublicPresence({pool,user,sess,route,method,body={},url}) {
 if (!user || !sess) fail(401, 'UNAUTHENTICATED', 'Please sign in.');
 if (method === 'POST' && route === '/practice/presence/heartbeat') {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
   fail(400, 'VALIDATION', 'Presence does not accept identities, timestamps or page information.');
  }
  const account = await viewer(pool,user,sess);
  if (!['personal','student'].includes(account.kind)) fail(403, 'FORBIDDEN', 'Learner account required.');
  const {rows:[result]} = await pool.query(`WITH active AS MATERIALIZED (
   SELECT s.token_hash FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id
   WHERE s.token_hash=$1 AND s.account_id=$2 AND ${activeSession} AND i.kind IN ('student','personal')
  ), touched AS (
   UPDATE sessions SET public_presence_seen_at=statement_timestamp()
   WHERE token_hash IN (SELECT token_hash FROM active)
    AND (public_presence_seen_at IS NULL OR public_presence_seen_at<=statement_timestamp()-interval '15 seconds')
   RETURNING token_hash
  ) SELECT EXISTS(SELECT 1 FROM active) active`, [sess.token_hash,user.id]);
  if (!result?.active) fail(401, 'UNAUTHENTICATED', 'Please sign in again.');
  return {status:200,body:{ok:true,ttlSeconds:PRESENCE_TTL_SECONDS,heartbeatIntervalSeconds:PRESENCE_HEARTBEAT_SECONDS}};
 }
 if (method === 'GET' && route === '/practice/presence') {
  const page=pageNumber(url,'page',1,10000),pageSize=pageNumber(url,'pageSize',20,50);
  const query=field(url.searchParams.get('q') ?? '', 'Search', {min:0,max:80});
  await viewer(pool,user,sess);
  const {rows:[result]} = await pool.query(`WITH online AS MATERIALIZED (
   SELECT DISTINCT a.id,${displayName} display_name,a.avatar FROM sessions s
   JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id WHERE ${publicOnline}
  ), matching AS MATERIALIZED (SELECT * FROM online WHERE strpos(lower(display_name),lower($1))>0)
  SELECT (SELECT count(*)::int FROM online) online_count,(SELECT count(*)::int FROM matching) total,
   COALESCE((SELECT jsonb_agg(item ORDER BY lower(item.display_name),item.id) FROM (
    SELECT id,display_name,avatar FROM matching ORDER BY lower(display_name),id LIMIT $2 OFFSET $3
   ) item),'[]'::jsonb) items`, [query,pageSize,(page-1)*pageSize]);
  return {status:200,body:{onlineCount:result.online_count,total:result.total,page,pageSize,
   items:result.items.map(item=>({identityId:item.id,displayName:item.display_name,
    avatar:avatarForIdentity(item.avatar,item.display_name)}))}};
 }
 const match=route.match(/^\/practice\/presence\/students\/([^/]+)$/);
 if (method === 'GET' && match) {
  const targetId=uuid(match[1]);
  return transaction(pool,async db=>{
   await viewer(db,user,sess);
   return {status:200,body:await preview(db,user.id,targetId)};
  });
 }
 return null;
}
