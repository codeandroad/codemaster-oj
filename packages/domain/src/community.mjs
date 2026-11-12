import { transaction } from './db.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import { avatarForIdentity, defaultAvatarPath } from './avatars.mjs';
import { activeAccount } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { publicPracticeFirstAc, setPublicPracticeHistoryAccount } from './public-practice-records.mjs';
import { POINTS_PER_SOLVED } from './public-practice-leaderboard.mjs';
import { listAccountNotifications, markAccountNotificationsRead } from './account-notifications.mjs';
import { listStudentNotifications, markStudentNotificationsRead } from './student-notifications.mjs';
import { listStaffCourseNotifications, markStaffCourseNotificationsRead } from './staff-course-notifications.mjs';

const response = (body, status = 200) => ({status, body});
const student = user => user.roles.includes('student');
const admin = user => user.roles.includes('admin');
const publicAlias = (account='a') => `'Learner-'||upper(left(md5('public-practice:'||${account}.id::text),8))`;
const publicName = (account='a') => `COALESCE(CASE WHEN ${account}.leaderboard_use_nickname THEN NULLIF(btrim(${account}.nickname),'') END,${publicAlias(account)})`;

function paging(url) {
 const number = (key, fallback, max) => {
  const raw = url.searchParams.get(key) ?? String(fallback);
  if (!/^[1-9]\d{0,4}$/.test(raw)) fail(400, 'VALIDATION', `${key}无效`);
  return integer(Number(raw), 1, max, key);
 };
 return {page: number('page', 1, 10000), pageSize: number('pageSize', 10, 50)};
}

async function activeStudent(db, identityId) {
 const row = (await db.query(`SELECT i.id, a.id account_id,
  COALESCE(NULLIF(btrim(a.nickname),''),'同学') nickname, a.avatar, a.bio
  FROM identities i JOIN accounts a ON a.identity_id=i.id
  WHERE i.id=$1 AND i.kind='student' AND i.archived_at IS NULL
   AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
   AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')`,
  [identityId])).rows[0];
 if (!row) fail(404, 'NOT_FOUND', '学生主页不存在');
 return row;
}

async function visibleProfile(db, user, identityId) {
 const p=await activeStudent(db,identityId);
 // The school-wide leaderboard links to every active student's profile.
 // Keep the audience inside authenticated school accounts.
 if(admin(user) || student(user) || user.roles.includes('teacher')) return p;
 fail(403,'FORBIDDEN','无权查看学生主页');
}

function authorShape(row, publicPractice) {
 if (publicPractice) return {nickname:row.author_nickname,avatar:defaultAvatarPath(row.author_alias)};
 return {id:row.author_identity_id,nickname:row.author_nickname,
  avatar:avatarForIdentity(row.author_avatar,row.author_identity_id)};
}

function messageShape(row, user, own, moderator, publicPractice) {
 return {id:row.id,body:row.body,createdAt:row.created_at,
  author:authorShape(row,publicPractice),
  canDelete:row.author_account_id===user.id || own || moderator,
  reportedByMe:!!row.reported_by_me,
  canReport:(publicPractice || student(user)) && row.author_account_id!==user.id && !row.reported_by_me};
}

const visibleMessageSql = `FROM student_guestbook_messages m
 JOIN accounts a ON a.id=m.author_account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
 JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
 WHERE ($4::uuid IS NOT NULL OR m.profile_identity_id=$1) AND m.deleted_at IS NULL
  AND m.practice_profile_account_id IS NOT DISTINCT FROM $4::uuid
  AND ($3::boolean OR NOT EXISTS (SELECT 1 FROM student_guestbook_reports r
   WHERE r.message_id=m.id AND r.reporter_account_id=$2 AND r.resolution IS NULL))`;

async function profile(ctx, identityId) {
 const p = await visibleProfile(ctx.pool, ctx.user, identityId);
 const totals = (await ctx.pool.query(`SELECT
  ((SELECT COALESCE(sum(points),0) FROM school_rank_ledger WHERE identity_id=$1)
   +(SELECT COALESCE(sum(points),0) FROM paper4_rank_ledger WHERE identity_id=$1)
   +(SELECT COALESCE(sum(points),0) FROM acsl_point_awards WHERE identity_id=$1))::int points,
  ((SELECT count(DISTINCT problem_id) FROM point_ledger WHERE identity_id=$1 AND reason='first_ac')
   +(SELECT count(*) FROM paper4_rank_ledger WHERE identity_id=$1))::int solved_problems,
  CASE WHEN $2::boolean OR COALESCE((SELECT show_luq_balance FROM leaderboard_settings WHERE id=true),true)
   THEN COALESCE((SELECT balance FROM luq_accounts WHERE identity_id=$1),0)::int END scholarship`,
 [identityId,ctx.user.identityId===p.id || ctx.user.roles.some(role=>role==='admin'||role==='teacher')])).rows[0];
 return response({profile:{id:p.id,nickname:p.nickname,avatar:avatarForIdentity(p.avatar,p.id),bio:p.bio,
  points:totals.points,rankPoints:totals.points,solvedProblems:totals.solved_problems,isSelf:ctx.user.identityId===p.id,
  ...(totals.scholarship===null?{}:{scholarship:totals.scholarship})}});
}

async function activity(ctx, identityId) {
 await visibleProfile(ctx.pool, ctx.user, identityId);
 const {page,pageSize} = paging(ctx.url);
 // A reward is the immutable first-AC event. Other users may only see titles
 // from currently school-visible, published problems. Never join private test
 // results or unpublished timed submissions into the public timeline.
 const visibility = `FROM point_ledger l
  JOIN submissions s ON s.id=l.submission_id
  JOIN problems p ON p.id=l.problem_id
  JOIN problem_banks b ON b.id=p.bank_id
  JOIN problem_versions v ON v.id=s.version_id
  WHERE l.identity_id=$1 AND l.reason='first_ac'
   AND ($2::boolean OR (b.visibility='school' AND b.archived_at IS NULL
   AND p.archived_at IS NULL AND v.published_at IS NOT NULL
   AND v.school_visible_at IS NOT NULL))
   AND (s.timed_attempt_id IS NULL OR EXISTS (
    SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id
    WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL))`;
 const params = [identityId,ctx.user.identityId===identityId];
 const total = (await ctx.pool.query(`SELECT count(*)::int total ${visibility}`,params)).rows[0].total;
 const rows = (await ctx.pool.query(`SELECT l.id,l.problem_id,v.title,
  COALESCE((SELECT r.points FROM school_rank_ledger r WHERE r.submission_id=l.submission_id),0) points,l.created_at
  ${visibility} ORDER BY l.created_at DESC,l.id DESC LIMIT $3 OFFSET $4`,
  [...params,pageSize,(page-1)*pageSize])).rows;
 return response({items:rows.map(r=>({id:String(r.id),type:'first_ac',problemId:r.problem_id,
  problemTitle:r.title,points:r.points,createdAt:r.created_at})),total,page,pageSize});
}

async function practiceProfileTarget(db, user, accountId, deleting) {
 const {rows:[target]}=await db.query(`SELECT a.identity_id,${publicAlias()} alias,${publicName()} nickname,
  COALESCE(pref.profile_enabled,false) enabled
  FROM accounts a JOIN identities i ON i.id=a.identity_id
  LEFT JOIN public_practice_preferences pref ON pref.account_id=a.id
  WHERE a.id=$1 AND ($2::boolean OR (a.disabled_at IS NULL AND a.binding_released_at IS NULL
   AND i.archived_at IS NULL AND (a.id=$3 OR pref.profile_enabled)))`,[accountId,deleting,user.id]);
 if (!target) fail(404,'NOT_FOUND','This practice profile is unavailable.');
 return target;
}

async function practiceProfileOperation(ctx, accountId, section, messageId, report) {
 const {user,method}=ctx, own=user.id===accountId;
 if (!section && method==='PATCH') {
  if (!own) fail(403,'FORBIDDEN','You can only manage your own practice profile.');
  const enabled=ctx.body.profileEnabled;
  if (typeof enabled!=='boolean') fail(400,'VALIDATION','Choose whether to share your practice profile.');
  return transaction(ctx.pool,async db=>{
   await activeAccount(db,user.id);
   await db.query(`INSERT INTO public_practice_preferences(account_id,profile_enabled) VALUES($1,$2)
    ON CONFLICT(account_id) DO UPDATE SET profile_enabled=EXCLUDED.profile_enabled`,[user.id,enabled]);
   return response({profileEnabled:enabled});
  });
 }
 const target=await practiceProfileTarget(ctx.pool,user,accountId,method==='DELETE');
 if (section==='messages') {
  if (!messageId && method==='GET') return listMessages(ctx,target.identity_id,accountId);
  if (!messageId && method==='POST') return createMessage(ctx,target.identity_id,accountId);
  if (messageId && !report && method==='DELETE') return deleteMessage(ctx,target.identity_id,messageId,accountId);
  if (messageId && report && method==='POST') return reportMessage(ctx,target.identity_id,messageId,accountId);
 }
 if (method!=='GET') return null;
 if (section==='activity' && !own) fail(404,'NOT_FOUND','This activity is private.');
 if (!own) return response({profile:{nickname:target.nickname,avatar:defaultAvatarPath(target.alias),isSelf:false}});
 return transaction(ctx.pool,async db=>{
  await activeAccount(db,user.id);
  await setPublicPracticeHistoryAccount(db,user.id);
  const {rows:[{total}]}=await db.query(`SELECT count(*)::int total FROM (${publicPracticeFirstAc}) first_ac`,[user.id]);
  if (section==='activity') {
   const {page,pageSize}=paging(ctx.url);
   const {rows}=await db.query(`SELECT * FROM (${publicPracticeFirstAc}) first_ac
    ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,[user.id,pageSize,(page-1)*pageSize]);
   return response({items:rows.map(row=>({id:row.id,type:'first_ac',problemId:row.problem_id,
    problemTitle:row.title,createdAt:row.created_at})),total,page,pageSize});
  }
  const {rows:[stats]}=await db.query(`SELECT
    (SELECT solved FROM public_practice_leaderboard($1,1,1) WHERE is_own)*$3 points,
    COALESCE((SELECT balance FROM luq_accounts WHERE identity_id=$2),0)::int scholarship`,
  [user.id,user.identityId,POINTS_PER_SOLVED]);
  return response({profile:{...stats,solvedProblems:total,nickname:target.nickname,avatar:defaultAvatarPath(target.alias),
   isSelf:true,profileEnabled:target.enabled}});
 });
}

async function listMessages(ctx, identityId, practiceAccountId = null) {
 const publicPractice=practiceAccountId!==null;
 if (!publicPractice) await visibleProfile(ctx.pool, ctx.user, identityId);
 const {page,pageSize} = paging(ctx.url);
 const own=publicPractice ? ctx.user.id===practiceAccountId : ctx.user.identityId===identityId;
 const params=[identityId,ctx.user.id,own,practiceAccountId];
 const total=(await ctx.pool.query(`SELECT count(*)::int total ${visibleMessageSql}`,params)).rows[0].total;
 const rows=(await ctx.pool.query(`SELECT m.id,m.body,m.created_at,m.author_account_id,
  EXISTS (SELECT 1 FROM student_guestbook_reports r
   WHERE r.message_id=m.id AND r.reporter_account_id=$2) reported_by_me,
  ${publicPractice ? `${publicAlias()} author_alias,${publicName()} author_nickname`
    : `i.id author_identity_id,COALESCE(NULLIF(btrim(a.nickname),''),'同学') author_nickname,a.avatar author_avatar`}
  ${visibleMessageSql} ORDER BY m.created_at DESC,m.id DESC LIMIT $5 OFFSET $6`,
  [...params,pageSize,(page-1)*pageSize])).rows;
 const moderator=publicPractice ? await isPlatformAdministrator(ctx.pool,ctx.user.id) : admin(ctx.user);
 return response({items:rows.map(r=>messageShape(r,ctx.user,own,moderator,publicPractice)),total,page,pageSize});
}

async function createMessage(ctx, identityId, practiceAccountId = null) {
 const publicPractice=practiceAccountId!==null;
 if (!publicPractice && !student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以留言');
 if (ctx.user.identityId===identityId) fail(400,'VALIDATION','不能给自己的主页留言');
 const body=field(ctx.body.body,'留言',{min:1,max:500});
 if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body))
  fail(400,'VALIDATION','留言包含无效字符');
 if (/(?:https?:\/\/|www\.)/iu.test(body))
  fail(400,'VALIDATION','留言不支持外部链接');
 const created=await transaction(ctx.pool,async db=>{
  if (!publicPractice) await visibleProfile(db,ctx.user,identityId);
  // The account-scoped transaction lock makes the database throttle work even
  // with multiple API processes. Count only successfully created messages.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,78314))',[ctx.user.id]);
  const recent=(await db.query(`SELECT
   count(*) FILTER (WHERE created_at>clock_timestamp()-interval '30 seconds')::int recent,
   count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 day')::int daily
   FROM student_guestbook_messages WHERE author_account_id=$1`,[ctx.user.id])).rows[0];
  if(recent.recent || recent.daily>=20) fail(429,'RATE_LIMIT','留言过于频繁，请稍后再试');
  const m=(await db.query(`INSERT INTO student_guestbook_messages(profile_identity_id,author_account_id,body,practice_profile_account_id)
   VALUES($1,$2,$3,$4) RETURNING id,body,created_at,author_account_id`,
   [identityId,ctx.user.id,body,practiceAccountId])).rows[0];
  if (!publicPractice) await db.query(`INSERT INTO student_guestbook_notifications(recipient_identity_id,message_id)
   VALUES($1,$2)`,[identityId,m.id]);
  await ctx.helpers.audit(db,ctx.user.id,'profile.message_create','student_guestbook_message',m.id,
   {profileIdentityId:identityId});
  if (!publicPractice) return {...m,author_identity_id:ctx.user.identityId,
   author_nickname:ctx.user.nickname?.trim()||'同学',author_avatar:ctx.user.avatar||''};
  const {rows:[author]}=await db.query(`SELECT ${publicAlias()} author_alias,${publicName()} author_nickname
   FROM accounts a WHERE a.id=$1`,[ctx.user.id]);
  return {...m,...author};
 });
 return response(messageShape(created,ctx.user,false,false,publicPractice),201);
}

async function deleteMessage(ctx, identityId, messageId, practiceAccountId = null) {
 const publicPractice=practiceAccountId!==null;
 await transaction(ctx.pool,async db=>{
  // Administrators must be able to resolve historical reports even after
  // the target student account or identity was disabled, unbound or archived.
  // Students and class teachers still need the normal live-profile access.
  if(!publicPractice && !admin(ctx.user)) await visibleProfile(db,ctx.user,identityId);
  const m=(await db.query(`SELECT id,author_account_id,deleted_at FROM student_guestbook_messages
   WHERE id=$1 AND ($3::uuid IS NOT NULL OR profile_identity_id=$2)
    AND practice_profile_account_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,[messageId,identityId,practiceAccountId])).rows[0];
  if(!m) fail(404,'NOT_FOUND','留言不存在');
  const moderator=publicPractice ? await isPlatformAdministrator(db,ctx.user.id) : admin(ctx.user);
  const own=publicPractice ? ctx.user.id===practiceAccountId : ctx.user.identityId===identityId;
  if(m.author_account_id!==ctx.user.id && !own && !moderator)
   fail(403,'FORBIDDEN','无权删除该留言');
  if(m.deleted_at) return;
  const deleted=(await db.query(`UPDATE student_guestbook_messages
   SET deleted_at=clock_timestamp(),deleted_by_account_id=$1
   WHERE id=$2 RETURNING deleted_at`,[ctx.user.id,messageId])).rows[0];
  await db.query(`UPDATE student_guestbook_reports
   SET resolution='delete',resolved_at=$3,resolved_by_account_id=$1
   WHERE message_id=$2`,[ctx.user.id,messageId,deleted.deleted_at]);
  await ctx.helpers.audit(db,ctx.user.id,'profile.message_delete','student_guestbook_message',messageId,
   {profileIdentityId:identityId,authorAccountId:m.author_account_id,
    moderation:m.author_account_id!==ctx.user.id});
 });
 return response({ok:true});
}

async function reportMessage(ctx, identityId, messageId, practiceAccountId = null) {
 const publicPractice=practiceAccountId!==null;
 if (!publicPractice && !student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以举报留言');
 const reason=enumValue(ctx.body.reason,['spam','abuse','privacy','other'],'举报原因');
 await transaction(ctx.pool,async db=>{
  if (!publicPractice) await visibleProfile(db,ctx.user,identityId);
  const m=(await db.query(`SELECT id,author_account_id,deleted_at FROM student_guestbook_messages
   WHERE id=$1 AND ($3::uuid IS NOT NULL OR profile_identity_id=$2)
    AND practice_profile_account_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,[messageId,identityId,practiceAccountId])).rows[0];
  if(!m || m.deleted_at) fail(404,'NOT_FOUND','留言不存在');
  if(m.author_account_id===ctx.user.id) fail(400,'VALIDATION','不能举报自己的留言');
  if((await db.query(`SELECT 1 FROM student_guestbook_reports
    WHERE message_id=$1 AND reporter_account_id=$2`,[messageId,ctx.user.id])).rowCount)
   fail(409,'ALREADY_REPORTED','已举报该留言');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,78315))',[ctx.user.id]);
  const daily=(await db.query(`SELECT count(*)::int n FROM student_guestbook_reports
   WHERE reporter_account_id=$1 AND created_at>clock_timestamp()-interval '1 day'`,[ctx.user.id])).rows[0].n;
  if(daily>=10) fail(429,'RATE_LIMIT','举报过于频繁，请稍后再试');
  await db.query(`INSERT INTO student_guestbook_reports(message_id,reporter_account_id,reason)
   VALUES($1,$2,$3)`,[messageId,ctx.user.id,reason]);
  await ctx.helpers.audit(db,ctx.user.id,'profile.message_report','student_guestbook_message',messageId,
   {profileIdentityId:identityId,reason});
 });
 return response({ok:true});
}

async function reports(ctx, identityId) {
 if(!admin(ctx.user)) fail(403,'FORBIDDEN','需要管理员权限');
 const {page,pageSize}=paging(ctx.url);
 const status=reportFilter(ctx.url);
 const base=`FROM student_guestbook_reports r
  JOIN student_guestbook_messages m ON m.id=r.message_id
  WHERE m.profile_identity_id=$1 AND m.practice_profile_account_id IS NULL`;
 const counts=reportCounts((await ctx.pool.query(`SELECT ${reportCountSelect} ${base}`,[identityId])).rows[0]);
 const total=(await ctx.pool.query(`SELECT count(*)::int n ${base}
  AND ($2::text='all' OR ${reportStatusSql}=$2)`,[identityId,status])).rows[0].n;
 const rows=(await ctx.pool.query(`SELECT r.id,r.message_id,r.reason,r.created_at,r.resolved_at,
  m.body,m.deleted_at,${reportStatusSql} status ${base}
  AND ($2::text='all' OR ${reportStatusSql}=$2)
  ORDER BY CASE WHEN ${reportStatusSql}='pending' THEN 0 ELSE 1 END,
   r.created_at DESC,r.id DESC LIMIT $3 OFFSET $4`,
  [identityId,status,pageSize,(page-1)*pageSize])).rows;
 return response({items:rows.map(r=>({id:r.id,messageId:r.message_id,reason:r.reason,
  createdAt:r.created_at,body:r.body,deleted:!!r.deleted_at,
  status:r.status,resolvedAt:r.resolved_at})),total,page,pageSize,counts});
}

const reportStatusSql=`CASE WHEN m.deleted_at IS NOT NULL OR r.resolution='delete' THEN 'deleted'
 WHEN r.resolution='dismiss' THEN 'dismissed' ELSE 'pending' END`;
const reportCountSelect=`count(*) FILTER (WHERE m.deleted_at IS NULL AND r.resolution IS NULL)::int pending,
 count(*) FILTER (WHERE m.deleted_at IS NOT NULL OR r.resolution='delete')::int deleted,
 count(*) FILTER (WHERE m.deleted_at IS NULL AND r.resolution='dismiss')::int dismissed`;
const reportCounts=row=>({pending:row.pending,deleted:row.deleted,dismissed:row.dismissed});
const reportFilter=url=>enumValue(url.searchParams.get('status')??'pending',
 ['pending','deleted','dismissed','all'],'举报状态');

async function allReports(ctx, publicPractice = false) {
 if (!(publicPractice ? await isPlatformAdministrator(ctx.pool,ctx.user.id) : admin(ctx.user))) fail(403,'FORBIDDEN','需要管理员权限');
 const {page,pageSize}=paging(ctx.url);
 const status=reportFilter(ctx.url);
 const base=`FROM student_guestbook_reports r
  JOIN student_guestbook_messages m ON m.id=r.message_id`;
 const scope=publicPractice ? 'm.practice_profile_account_id IS NOT NULL' : 'm.practice_profile_account_id IS NULL';
 const counts=reportCounts((await ctx.pool.query(`SELECT ${reportCountSelect} ${base} WHERE ${scope}`)).rows[0]);
 const total=(await ctx.pool.query(`SELECT count(*)::int n ${base}
  WHERE ${scope} AND ($1::text='all' OR ${reportStatusSql}=$1)`,[status])).rows[0].n;
 const rows=(await ctx.pool.query(`SELECT r.id,r.message_id,r.reason,r.created_at,r.resolved_at,
  m.profile_identity_id,m.practice_profile_account_id,m.body,m.deleted_at,${reportStatusSql} status,
  ${publicPractice?publicName('pa'):"COALESCE(NULLIF(btrim(pa.nickname),''),'同学')"} profile_nickname,
  ${publicPractice ? `(pi.archived_at IS NULL AND pa.disabled_at IS NULL AND pa.binding_released_at IS NULL
   AND EXISTS (SELECT 1 FROM public_practice_preferences pref WHERE pref.account_id=pa.id AND pref.profile_enabled))`
   : `(pi.kind='student' AND pi.archived_at IS NULL AND pa.id IS NOT NULL
   AND pa.disabled_at IS NULL AND EXISTS (
    SELECT 1 FROM account_roles ar WHERE ar.account_id=pa.id AND ar.role='student'
   ))`} profile_available,
  aa.identity_id author_identity_id,
  ${publicPractice?publicName('aa'):"COALESCE(NULLIF(btrim(aa.nickname),''),'同学')"} author_nickname
  ${base}
  JOIN identities pi ON pi.id=m.profile_identity_id
  JOIN accounts aa ON aa.id=m.author_account_id
  LEFT JOIN accounts pa ON ${publicPractice?'pa.id=m.practice_profile_account_id':'pa.identity_id=m.profile_identity_id AND pa.binding_released_at IS NULL'}
  WHERE ${scope} AND ($1::text='all' OR ${reportStatusSql}=$1)
  ORDER BY CASE WHEN ${reportStatusSql}='pending' THEN 0 ELSE 1 END,
   r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3`,
  [status,pageSize,(page-1)*pageSize])).rows;
 return response({items:rows.map(r=>({id:r.id,messageId:r.message_id,
  profileIdentityId:r.profile_identity_id,profileNickname:r.profile_nickname,
  profileAvailable:r.profile_available,
  ...(publicPractice?{profileAccountId:r.practice_profile_account_id}:{}),
  authorIdentityId:r.author_identity_id,authorNickname:r.author_nickname,
  reason:r.reason,createdAt:r.created_at,body:r.body,deleted:!!r.deleted_at,
  status:r.status,resolvedAt:r.resolved_at})),
  total,page,pageSize,counts});
}

async function dismissReport(ctx, reportId, publicPractice = false) {
 if (!(publicPractice ? await isPlatformAdministrator(ctx.pool,ctx.user.id) : admin(ctx.user))) fail(403,'FORBIDDEN','需要管理员权限');
 await transaction(ctx.pool,async db=>{
  // Lock the message before the report, matching deletion's lock order.
  const message=(await db.query(`SELECT m.id,m.profile_identity_id,m.deleted_at
   FROM student_guestbook_reports r JOIN student_guestbook_messages m ON m.id=r.message_id
   WHERE r.id=$1 AND (m.practice_profile_account_id IS NOT NULL)=$2 FOR UPDATE OF m`,[reportId,publicPractice])).rows[0];
  if(!message) fail(404,'NOT_FOUND','举报不存在');
  const report=(await db.query(`SELECT id,resolution FROM student_guestbook_reports
   WHERE id=$1 FOR UPDATE`,[reportId])).rows[0];
  if(report.resolution==='dismiss') return;
  if(message.deleted_at || report.resolution) fail(409,'ALREADY_RESOLVED','举报已处理');
  await db.query(`UPDATE student_guestbook_reports
   SET resolution='dismiss',resolved_at=now(),resolved_by_account_id=$1
   WHERE id=$2`,[ctx.user.id,reportId]);
  await ctx.helpers.audit(db,ctx.user.id,'profile.message_report_dismiss',
   'student_guestbook_report',reportId,
   {messageId:message.id,profileIdentityId:message.profile_identity_id});
 });
 return response({ok:true,status:'dismissed'});
}

export async function handleCommunity(ctx) {
 const practice=ctx.route.match(/^\/practice\/profiles\/([^/]+)(?:\/(activity|messages)(?:\/([^/]+)(\/report)?)?)?$/);
 if (practice) return practiceProfileOperation(ctx,uuid(practice[1],'Account ID'),practice[2],
  practice[3] && uuid(practice[3],'Message ID'),practice[4]);
 if(ctx.route==='/platform/profile-message-reports' && ctx.method==='GET') return allReports(ctx,true);
 const practiceReport=ctx.route.match(/^\/platform\/profile-message-reports\/([^/]+)\/dismiss$/);
 if(practiceReport && ctx.method==='POST') return dismissReport(ctx,uuid(practiceReport[1],'Report ID'),true);
 if(ctx.route==='/account-notifications' && ctx.method==='GET') return listAccountNotifications(ctx,paging(ctx.url));
 if(ctx.route==='/account-notifications/read-all' && ctx.method==='POST') return markAccountNotificationsRead(ctx);
 const accountAction=ctx.route.match(/^\/account-notifications\/([^/]+)\/read$/);
 if(accountAction && ctx.method==='POST') return markAccountNotificationsRead(ctx,uuid(accountAction[1],'通知 ID'));
 const schoolInbox=ctx.route.match(/^\/schools\/([^/]+)(\/(?:student|staff)-notifications(?:\/.*)?)$/);
 if(schoolInbox) ctx={...ctx,route:schoolInbox[2],notificationSchoolId:schoolInbox[1]};
 if(ctx.route==='/staff-notifications' && ctx.method==='GET') return listStaffCourseNotifications(ctx,paging(ctx.url));
 if(ctx.route==='/staff-notifications/read-all' && ctx.method==='POST') return markStaffCourseNotificationsRead(ctx);
 const staffAction=ctx.route.match(/^\/staff-notifications\/([^/]+)\/read$/);
 if(staffAction && ctx.method==='POST') return markStaffCourseNotificationsRead(ctx,uuid(staffAction[1],'通知 ID'));
 if(ctx.route==='/student-notifications') {
  if(ctx.method==='GET') return listStudentNotifications(ctx,paging(ctx.url));
  return null;
 }
 if(ctx.route==='/student-notifications/read-all' && ctx.method==='POST') return markStudentNotificationsRead(ctx);
 const notificationAction=ctx.route.match(/^\/student-notifications\/([^/]+)\/read$/);
 if(notificationAction && ctx.method==='POST') return markStudentNotificationsRead(ctx,uuid(notificationAction[1],'通知 ID'));
 if(ctx.route==='/profile-message-reports' && ctx.method==='GET') return allReports(ctx);
 const reportAction=ctx.route.match(/^\/profile-message-reports\/([^/]+)\/dismiss$/);
 if(reportAction && ctx.method==='POST') return dismissReport(ctx,uuid(reportAction[1],'举报 ID'));
 const reportList=ctx.route.match(/^\/profiles\/([^/]+)\/message-reports$/);
 if(reportList && ctx.method==='GET') return reports(ctx,uuid(reportList[1],'学生 ID'));
 const message=ctx.route.match(/^\/profiles\/([^/]+)\/messages\/([^/]+)(\/report)?$/);
 if(message) {
  const identityId=uuid(message[1],'学生 ID'),messageId=uuid(message[2],'留言 ID');
  if(message[3] && ctx.method==='POST') return reportMessage(ctx,identityId,messageId);
  if(!message[3] && ctx.method==='DELETE') return deleteMessage(ctx,identityId,messageId);
  return null;
 }
 const section=ctx.route.match(/^\/profiles\/([^/]+)\/(activity|messages)$/);
 if(section) {
  const identityId=uuid(section[1],'学生 ID');
  if(section[2]==='activity' && ctx.method==='GET') return activity(ctx,identityId);
  if(section[2]==='messages' && ctx.method==='GET') return listMessages(ctx,identityId);
  if(section[2]==='messages' && ctx.method==='POST') return createMessage(ctx,identityId);
  return null;
 }
 const main=ctx.route.match(/^\/profiles\/([^/]+)$/);
 if(main && ctx.method==='GET') return profile(ctx,uuid(main[1],'学生 ID'));
 return null;
}
