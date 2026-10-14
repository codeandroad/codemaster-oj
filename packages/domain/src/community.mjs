import { transaction } from './db.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import { avatarForIdentity } from './avatars.mjs';

const response = (body, status = 200) => ({status, body});
const student = user => user.roles.includes('student');
const admin = user => user.roles.includes('admin');

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

function authorShape(row) {
 return {id:row.author_identity_id,nickname:row.author_nickname,
  avatar:avatarForIdentity(row.author_avatar,row.author_identity_id)};
}

function messageShape(row, user, targetIdentityId, moderator) {
 return {id:row.id,body:row.body,createdAt:row.created_at,
  author:authorShape(row),
  canDelete:row.author_account_id===user.id || targetIdentityId===user.identityId || moderator,
  reportedByMe:!!row.reported_by_me,
  canReport:student(user) && row.author_account_id!==user.id && !row.reported_by_me};
}

const visibleMessageSql = `FROM student_guestbook_messages m
 JOIN accounts a ON a.id=m.author_account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
 JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
 WHERE m.profile_identity_id=$1 AND m.deleted_at IS NULL
  AND ($3::uuid=m.profile_identity_id OR NOT EXISTS (SELECT 1 FROM student_guestbook_reports r
   WHERE r.message_id=m.id AND r.reporter_account_id=$2 AND r.resolution IS NULL))`;

async function profile(ctx, identityId) {
 const p = await visibleProfile(ctx.pool, ctx.user, identityId);
 const totals = (await ctx.pool.query(`SELECT
  COALESCE(sum(points),0)::int points,
  count(DISTINCT problem_id) FILTER (WHERE reason='first_ac')::int solved_problems
  FROM point_ledger WHERE identity_id=$1`, [identityId])).rows[0];
 const rankPoints=(await ctx.pool.query(`SELECT COALESCE(sum(points),0)::int points
  FROM school_rank_ledger WHERE identity_id=$1`,[identityId])).rows[0].points;
 return response({profile:{id:p.id,nickname:p.nickname,avatar:avatarForIdentity(p.avatar,p.id),bio:p.bio,
  points:totals.points,rankPoints,solvedProblems:totals.solved_problems,isSelf:ctx.user.identityId===p.id}});
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
 const rows = (await ctx.pool.query(`SELECT l.id,l.problem_id,v.title,l.points,l.created_at
  ${visibility} ORDER BY l.created_at DESC,l.id DESC LIMIT $3 OFFSET $4`,
  [...params,pageSize,(page-1)*pageSize])).rows;
 return response({items:rows.map(r=>({id:String(r.id),type:'first_ac',problemId:r.problem_id,
  problemTitle:r.title,points:r.points,createdAt:r.created_at})),total,page,pageSize});
}

async function listMessages(ctx, identityId) {
 await visibleProfile(ctx.pool, ctx.user, identityId);
 const {page,pageSize} = paging(ctx.url);
 const params=[identityId,ctx.user.id,ctx.user.identityId];
 const total=(await ctx.pool.query(`SELECT count(*)::int total ${visibleMessageSql}`,params)).rows[0].total;
 const rows=(await ctx.pool.query(`SELECT m.id,m.body,m.created_at,m.author_account_id,
  EXISTS (SELECT 1 FROM student_guestbook_reports r
   WHERE r.message_id=m.id AND r.reporter_account_id=$2) reported_by_me,
  i.id author_identity_id,COALESCE(NULLIF(btrim(a.nickname),''),'同学') author_nickname,
  a.avatar author_avatar ${visibleMessageSql}
  ORDER BY m.created_at DESC,m.id DESC LIMIT $4 OFFSET $5`,
  [...params,pageSize,(page-1)*pageSize])).rows;
 const moderator=admin(ctx.user);
 return response({items:rows.map(r=>messageShape(r,ctx.user,identityId,moderator)),total,page,pageSize});
}

async function createMessage(ctx, identityId) {
 if (!student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以留言');
 if (ctx.user.identityId===identityId) fail(400,'VALIDATION','不能给自己的主页留言');
 const body=field(ctx.body.body,'留言',{min:1,max:500});
 if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body))
  fail(400,'VALIDATION','留言包含无效字符');
 if (/(?:https?:\/\/|www\.)/iu.test(body))
  fail(400,'VALIDATION','留言不支持外部链接');
 const created=await transaction(ctx.pool,async db=>{
  await visibleProfile(db,ctx.user,identityId);
  // The account-scoped transaction lock makes the database throttle work even
  // with multiple API processes. Count only successfully created messages.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,78314))',[ctx.user.id]);
  const recent=(await db.query(`SELECT
   count(*) FILTER (WHERE created_at>clock_timestamp()-interval '30 seconds')::int recent,
   count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 day')::int daily
   FROM student_guestbook_messages WHERE author_account_id=$1`,[ctx.user.id])).rows[0];
  if(recent.recent || recent.daily>=20) fail(429,'RATE_LIMIT','留言过于频繁，请稍后再试');
  const m=(await db.query(`INSERT INTO student_guestbook_messages(profile_identity_id,author_account_id,body)
   VALUES($1,$2,$3) RETURNING id,body,created_at,author_account_id`,
   [identityId,ctx.user.id,body])).rows[0];
  await db.query(`INSERT INTO student_guestbook_notifications(recipient_identity_id,message_id)
   VALUES($1,$2)`,[identityId,m.id]);
  await ctx.helpers.audit(db,ctx.user.id,'profile.message_create','student_guestbook_message',m.id,
   {profileIdentityId:identityId});
  return m;
 });
 return response(messageShape({...created,author_identity_id:ctx.user.identityId,
  author_nickname:ctx.user.nickname?.trim()||'同学',author_avatar:ctx.user.avatar||''},
  ctx.user,identityId,false),201);
}

async function deleteMessage(ctx, identityId, messageId) {
 await transaction(ctx.pool,async db=>{
  // Administrators must be able to resolve historical reports even after
  // the target student account or identity was disabled, unbound or archived.
  // Students and class teachers still need the normal live-profile access.
  if(!admin(ctx.user)) await visibleProfile(db,ctx.user,identityId);
  const m=(await db.query(`SELECT id,author_account_id,deleted_at FROM student_guestbook_messages
   WHERE id=$1 AND profile_identity_id=$2 FOR UPDATE`,[messageId,identityId])).rows[0];
  if(!m) fail(404,'NOT_FOUND','留言不存在');
  const moderator=admin(ctx.user);
  if(m.author_account_id!==ctx.user.id && identityId!==ctx.user.identityId && !moderator)
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

async function reportMessage(ctx, identityId, messageId) {
 if (!student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以举报留言');
 const reason=enumValue(ctx.body.reason,['spam','abuse','privacy','other'],'举报原因');
 await transaction(ctx.pool,async db=>{
  await visibleProfile(db,ctx.user,identityId);
  const m=(await db.query(`SELECT id,author_account_id,deleted_at FROM student_guestbook_messages
   WHERE id=$1 AND profile_identity_id=$2 FOR UPDATE`,[messageId,identityId])).rows[0];
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
  JOIN student_guestbook_messages m ON m.id=r.message_id WHERE m.profile_identity_id=$1`;
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

async function allReports(ctx) {
 if(!admin(ctx.user)) fail(403,'FORBIDDEN','需要管理员权限');
 const {page,pageSize}=paging(ctx.url);
 const status=reportFilter(ctx.url);
 const base=`FROM student_guestbook_reports r
  JOIN student_guestbook_messages m ON m.id=r.message_id`;
 const counts=reportCounts((await ctx.pool.query(`SELECT ${reportCountSelect} ${base}`)).rows[0]);
 const total=(await ctx.pool.query(`SELECT count(*)::int n ${base}
  WHERE $1::text='all' OR ${reportStatusSql}=$1`,[status])).rows[0].n;
 const rows=(await ctx.pool.query(`SELECT r.id,r.message_id,r.reason,r.created_at,r.resolved_at,
  m.profile_identity_id,m.body,m.deleted_at,${reportStatusSql} status,
  COALESCE(NULLIF(btrim(pa.nickname),''),'同学') profile_nickname,
  (pi.kind='student' AND pi.archived_at IS NULL AND pa.id IS NOT NULL
   AND pa.disabled_at IS NULL AND EXISTS (
    SELECT 1 FROM account_roles ar WHERE ar.account_id=pa.id AND ar.role='student'
   )) profile_available,
  aa.identity_id author_identity_id,
  COALESCE(NULLIF(btrim(aa.nickname),''),'同学') author_nickname
  ${base}
  JOIN identities pi ON pi.id=m.profile_identity_id
  JOIN accounts aa ON aa.id=m.author_account_id
  LEFT JOIN accounts pa ON pa.identity_id=m.profile_identity_id AND pa.binding_released_at IS NULL
  WHERE $1::text='all' OR ${reportStatusSql}=$1
  ORDER BY CASE WHEN ${reportStatusSql}='pending' THEN 0 ELSE 1 END,
   r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3`,
  [status,pageSize,(page-1)*pageSize])).rows;
 return response({items:rows.map(r=>({id:r.id,messageId:r.message_id,
  profileIdentityId:r.profile_identity_id,profileNickname:r.profile_nickname,
  profileAvailable:r.profile_available,
  authorIdentityId:r.author_identity_id,authorNickname:r.author_nickname,
  reason:r.reason,createdAt:r.created_at,body:r.body,deleted:!!r.deleted_at,
  status:r.status,resolvedAt:r.resolved_at})),
  total,page,pageSize,counts});
}

async function dismissReport(ctx, reportId) {
 if(!admin(ctx.user)) fail(403,'FORBIDDEN','需要管理员权限');
 await transaction(ctx.pool,async db=>{
  // Lock the message before the report, matching deletion's lock order.
  const message=(await db.query(`SELECT m.id,m.profile_identity_id,m.deleted_at
   FROM student_guestbook_reports r JOIN student_guestbook_messages m ON m.id=r.message_id
   WHERE r.id=$1 FOR UPDATE OF m`,[reportId])).rows[0];
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

const visibleNotificationSql=`FROM student_guestbook_notifications n
 JOIN student_guestbook_messages m ON m.id=n.message_id AND m.deleted_at IS NULL
 JOIN accounts a ON a.id=m.author_account_id
  AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
 JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL
 WHERE n.recipient_identity_id=$1`;

async function notifications(ctx) {
 if(!student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以查看通知');
 const {page,pageSize}=paging(ctx.url);
 const total=(await ctx.pool.query(`SELECT count(*)::int total,
  count(*) FILTER (WHERE n.read_at IS NULL)::int unread ${visibleNotificationSql}`,
  [ctx.user.identityId])).rows[0];
 const rows=(await ctx.pool.query(`SELECT n.id,n.message_id,n.recipient_identity_id,n.created_at,n.read_at,m.body,
  COALESCE(NULLIF(btrim(a.nickname),''),'同学') author_nickname
  ${visibleNotificationSql}
  ORDER BY n.created_at DESC,n.id DESC LIMIT $2 OFFSET $3`,
  [ctx.user.identityId,pageSize,(page-1)*pageSize])).rows;
 return response({items:rows.map(r=>({id:r.id,messageId:r.message_id,body:r.body,
  profileIdentityId:r.recipient_identity_id,
  authorNickname:r.author_nickname,createdAt:r.created_at,readAt:r.read_at})),
  total:total.total,unreadCount:total.unread,page,pageSize});
}

async function readNotification(ctx, notificationId) {
 if(!student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以处理通知');
 const row=(await ctx.pool.query(`UPDATE student_guestbook_notifications
  SET read_at=COALESCE(read_at,clock_timestamp())
  WHERE id=$1 AND recipient_identity_id=$2
  RETURNING read_at`,[notificationId,ctx.user.identityId])).rows[0];
 if(!row) fail(404,'NOT_FOUND','通知不存在');
 return response({ok:true,readAt:row.read_at});
}

async function readAllNotifications(ctx) {
 if(!student(ctx.user)) fail(403,'FORBIDDEN','只有学生可以处理通知');
 await ctx.pool.query(`UPDATE student_guestbook_notifications n
  SET read_at=clock_timestamp()
  FROM student_guestbook_messages m
  WHERE n.message_id=m.id AND n.recipient_identity_id=$1
   AND n.read_at IS NULL AND m.deleted_at IS NULL`,[ctx.user.identityId]);
 return response({ok:true});
}

export async function handleCommunity(ctx) {
 if(ctx.route==='/student-notifications') {
  if(ctx.method==='GET') return notifications(ctx);
  return null;
 }
 if(ctx.route==='/student-notifications/read-all' && ctx.method==='POST') return readAllNotifications(ctx);
 const notificationAction=ctx.route.match(/^\/student-notifications\/([^/]+)\/read$/);
 if(notificationAction && ctx.method==='POST') return readNotification(ctx,uuid(notificationAction[1],'通知 ID'));
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
