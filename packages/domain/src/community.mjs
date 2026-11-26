import { accountHomepage, defaultMessageSchool } from './homepages.mjs';
import { schoolActivityJobVisibleSql } from './school-activities.mjs';
import { schoolCatalogActivityTitle } from './catalog-problem-publication.mjs';
import { schoolSolvedSubjects } from './school-leaderboard.mjs';
import { transaction } from './db.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import { avatarForIdentity, defaultAvatarPath } from './avatars.mjs';
import { activeAccount, schoolRole, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator, requirePlatformAdministrator } from './platform-governance.mjs';
import { publicPracticeFirstAc, setPublicPracticeHistoryAccount } from './public-practice-records.mjs';
import { POINTS_PER_SOLVED } from './public-practice-leaderboard.mjs';
import { validateCoverImage } from './course-access.mjs';
import { listAccountNotifications, markAccountNotificationsRead } from './account-notifications.mjs';
import { listStudentNotifications, markStudentNotificationsRead } from './student-notifications.mjs';
import { listStaffCourseNotifications, markStaffCourseNotificationsRead } from './staff-course-notifications.mjs';
import { schoolMemberProfileId, schoolMemberProfileName, schoolMemberProfileRows } from './school-member-profiles.mjs';

const response = (body, status = 200) => ({status, body});
const admin = user => user.roles.includes('admin');
const publicAlias = (account='a') => `'Learner-'||upper(left(md5('public-practice:'||${account}.id::text),8))`;
const publicName = (account='a') => `COALESCE(CASE WHEN ${account}.leaderboard_use_nickname THEN NULLIF(btrim(${account}.nickname),'') END,${publicAlias(account)})`;

function withGuestbookTransaction(ctx,work) {
 return ctx.inSchoolTransaction ? work(ctx.pool) : transaction(ctx.pool,work);
}

// There may be no preference row to lock. Serialize closing a guestbook with
// new posts to the same owner and scope, including replies.
function lockGuestbook(db, accountId, scope, exclusive) {
 const lock = exclusive ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
 return db.query(`SELECT ${lock}(hashtextextended('guestbook:' || $1::text || ':' || $2::text, 0))`, [accountId, scope]);
}

async function acceptsMessages(db, accountId, scope) {
 const {rowCount} = await db.query('SELECT 1 FROM closed_guestbooks WHERE account_id=$1 AND scope=$2', [accountId, scope]);
 return rowCount === 0;
}

async function guestbookSettings(ctx) {
 const accountId = ctx.user.id;
 return transaction(ctx.pool, async db => {
  await activeAccount(db, accountId);
  if (ctx.method === 'PATCH') {
   const scope = enumValue(ctx.body.scope, ['school','practice'], '留言范围');
   const open = ctx.body.open;
   if (typeof open !== 'boolean') fail(400,'VALIDATION','请选择是否接受新留言');
   await lockGuestbook(db, accountId, scope, true);
   if (open) await db.query('DELETE FROM closed_guestbooks WHERE account_id=$1 AND scope=$2', [accountId,scope]);
   else await db.query('INSERT INTO closed_guestbooks(account_id,scope) VALUES($1,$2) ON CONFLICT DO NOTHING', [accountId,scope]);
  }
  const {rows:[settings]} = await db.query(`SELECT
   NOT EXISTS(SELECT 1 FROM closed_guestbooks WHERE account_id=$1 AND scope='school') AS "schoolOpen",
   NOT EXISTS(SELECT 1 FROM closed_guestbooks WHERE account_id=$1 AND scope='practice') AS "practiceOpen",
   EXISTS(SELECT 1 FROM public_practice_preferences WHERE account_id=$1 AND profile_enabled) AS "profileEnabled"`, [accountId]);
  return response(settings);
 });
}

function paging(url) {
 const number = (key, fallback, max) => {
  const raw = url.searchParams.get(key) ?? String(fallback);
  if (!/^[1-9]\d{0,4}$/.test(raw)) fail(400, 'VALIDATION', `${key}无效`);
  return integer(Number(raw), 1, max, key);
 };
 return {page: number('page', 1, 10000), pageSize: number('pageSize', 10, 50)};
}

async function schoolProfile(db, identityId) {
 const {rows:[row]} = await db.query(`SELECT ${schoolMemberProfileId} id, profile_account.id account_id,
  membership.school_id, ${schoolMemberProfileName} nickname, profile_account.avatar, profile_account.bio,
  CASE WHEN ${schoolMemberProfileId}<>profile_account.id THEN 'student' ELSE membership.role END kind,
  ${schoolMemberProfileId}<>profile_account.id AS student_dossier
  ${schoolMemberProfileRows}
  AND (${schoolMemberProfileId}=$1 OR profile_account.id=$1)
  AND membership.school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid
  ORDER BY (${schoolMemberProfileId}=$1) DESC LIMIT 1`,[identityId]);
 return row;
}

async function visibleProfile(db, ctx, identityId) {
 if (!ctx.schoolId) fail(404,'NOT_FOUND','请从学校工作区打开成员主页');
 const target=await schoolProfile(db,identityId);
 if (!target) fail(404,'NOT_FOUND','该成员的校内主页不可访问');
 return target;
}

function authorShape(row, publicPractice) {
 if (publicPractice) return {nickname:row.author_nickname,avatar:defaultAvatarPath(row.author_alias)};
 return {id:row.author_identity_id,nickname:row.author_nickname,
  avatar:avatarForIdentity(row.author_avatar,row.author_avatar_identity_id??row.author_identity_id)};
}

function messageShape(row, user, own, moderator, publicPractice) {
 return {id:row.id,body:row.body,createdAt:row.created_at,
  author:authorShape(row,publicPractice),
  canDelete:row.author_account_id===user.id || own || moderator,
  threadId:row.thread_id??null, replyCount:row.reply_count??0,
  quote:row.quote_id ? {id:row.quote_id,body:row.quote_body??null,nickname:row.quote_nickname??null} : null,
  mentions:row.mentions??[], likeCount:row.like_count??0, liked:!!row.liked};
}

const activeAuthors = `JOIN accounts a ON a.id=m.author_account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
 JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL`;
const schoolMessageTarget = '(m.profile_identity_id=$1 OR m.school_profile_account_id=$1)';
const visibleMessageSql = `FROM student_guestbook_messages m ${activeAuthors}
 WHERE ($4::uuid IS NOT NULL OR m.profile_identity_id=($1::uuid[])[1] OR m.school_profile_account_id=($1::uuid[])[2])
 AND m.deleted_at IS NULL
  AND m.practice_profile_account_id IS NOT DISTINCT FROM $4::uuid
  AND ($3::boolean OR NOT EXISTS (SELECT 1 FROM student_guestbook_reports r
   WHERE r.message_id=m.id AND r.reporter_account_id=$2 AND r.resolution IS NULL))`;

const publicNickname = (practice, account='a') => practice
 ? publicName(account) : `COALESCE(NULLIF(btrim(${account}.nickname),''),'同学')`;

async function mentionCandidates(db, profile, practice, query, ids = null) {
 if (!practice) {
  const {rows}=await db.query(`SELECT profile_account.id account_id,${schoolMemberProfileId} id,
     ${publicNickname(false,'profile_account')} nickname
    ${schoolMemberProfileRows}
    AND membership.school_id=$4 AND ($1::uuid[] IS NULL OR ${schoolMemberProfileId}=ANY($1))
    AND ($2='' OR strpos(lower(${publicNickname(false,'profile_account')}),lower($2))>0)
    ORDER BY (profile_account.id=$3) DESC,nickname,profile_account.id LIMIT 8`,[ids,query,profile.account_id,profile.school_id]);
  return rows;
 }
 const nickname = publicNickname(practice);
 const {rows} = await db.query(`SELECT a.id AS account_id,a.id,${nickname} nickname
  FROM accounts a JOIN identities i ON i.id=a.identity_id
  JOIN public_practice_preferences p ON p.account_id=a.id AND p.profile_enabled
  WHERE a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
    AND ($1::uuid[] IS NULL OR a.id=ANY($1))
    AND (strpos(lower(${nickname}),lower($2))>0 OR $2='')
  ORDER BY (a.id=$3) DESC, nickname,a.id LIMIT 8`,[ids,query,profile.account_id]);
 return rows;
}

async function guestbookProfile(db, ctx, identityId, practiceAccountId) {
 if (practiceAccountId) {
  const target=await practiceProfileTarget(db,ctx.user,practiceAccountId,false);
  return {...target,account_id:practiceAccountId};
 }
 return visibleProfile(db,ctx,identityId);
}

async function listMentionCandidates(ctx, identityId, practiceAccountId) {
 const profile=await guestbookProfile(ctx.pool,ctx,identityId,practiceAccountId);
 const query=field(ctx.url.searchParams.get('q')??'','昵称',{min:0,max:50});
 const rows=await mentionCandidates(ctx.pool,profile,Boolean(practiceAccountId),query);
 return response({items:rows.map(({id,nickname})=>({id,nickname})),query});
}

async function visibleMessage(db, params, messageId, { root = false, lock = false } = {}) {
 const {rows:[row]}=await db.query(`SELECT m.id,m.thread_id,m.author_account_id,i.id author_identity_id
  ${visibleMessageSql} AND m.id=$5 ${root ? 'AND m.thread_id IS NULL' : ''} ${lock ? 'FOR SHARE OF m' : ''}`,
  [...params,messageId]);
 if (!row) fail(404,'NOT_FOUND','留言不存在');
 return row;
}

async function profileCover(db, accountId) {
 const {rows} = await db.query('SELECT image AS "coverImage" FROM account_profile_covers WHERE account_id=$1',[accountId]);
 return rows[0] ?? {};
}

async function updateProfileCover(ctx) {
 const image = validateCoverImage(ctx.body.coverImage);
 return transaction(ctx.pool,async db=>{
  const accountId = ctx.user.id;
  await activeAccount(db,accountId);
  if (image) {
   await db.query(`INSERT INTO account_profile_covers(account_id,image) VALUES($1,$2)
    ON CONFLICT(account_id) DO UPDATE SET image=EXCLUDED.image`,[accountId,image]);
  } else {
   await db.query('DELETE FROM account_profile_covers WHERE account_id=$1',[accountId]);
  }
  await ctx.helpers.audit(db,accountId,'account.profile_update','account',accountId,{field:'coverImage'});
  return response({ok:true});
 });
}

async function profile(ctx, person) {
 const identityId = person.id;
 const isSelf = !ctx.platformProfile && ctx.user.id===person.account_id;
 const heading = {...await profileCover(ctx.pool,person.account_id),id:identityId,kind:person.kind,
  nickname:person.nickname,avatar:avatarForIdentity(person.avatar,identityId),bio:person.bio,isSelf};
 if (!person.student_dossier) return response({profile:heading});
 const totals = (await ctx.pool.query(`SELECT
  ((SELECT COALESCE(sum(points),0) FROM school_rank_awards WHERE identity_id=$1)
   +(SELECT COALESCE(sum(points),0) FROM paper4_rank_ledger WHERE identity_id=$1)
   +(SELECT COALESCE(sum(points),0) FROM acsl_point_awards WHERE identity_id=$1))::int points,
  (SELECT count(*)::int FROM (${schoolSolvedSubjects}) solved WHERE school_id=$3 AND identity_id=$1) solved_problems,
  CASE WHEN $2::boolean OR COALESCE((SELECT (display_fields->>'scholarship')::boolean FROM school_scholarship_settings WHERE school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid),true)
   THEN COALESCE((SELECT balance FROM school_scholarship_accounts WHERE identity_id=$1),0)::int END scholarship`,
 [identityId,isSelf || ctx.user.roles.some(role=>role==='admin'||role==='teacher'),person.school_id])).rows[0];
 return response({profile:{...heading,points:totals.points,rankPoints:totals.points,solvedProblems:totals.solved_problems,
  ...(totals.scholarship===null?{}:{scholarship:totals.scholarship})}});
}

async function activity(ctx, person) {
 const identityId = person.id;
 const {page,pageSize} = paging(ctx.url);
 if (!person.student_dossier) return response({items:[],total:0,page,pageSize});
 // Record the first settlement before applying visibility. A later retry must
 // neither create a second solve nor disclose a hidden first result.
 const events = `WITH candidates AS (
  SELECT l.id::text id,l.problem_id,v.title,coalesce(rank.points,0) points,l.created_at,
   ($2 OR (b.visibility='school' AND b.archived_at IS NULL AND p.archived_at IS NULL
    AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL))
   AND (s.timed_attempt_id IS NULL OR EXISTS (
    SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id
    WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL)) visible
  FROM point_ledger l JOIN submissions s ON s.id=l.submission_id
  JOIN problems p ON p.id=l.problem_id JOIN problem_banks b ON b.id=p.bank_id
  JOIN problem_versions v ON v.id=s.version_id
  LEFT JOIN school_rank_ledger rank ON rank.submission_id=l.submission_id
  WHERE s.school_id=$3 AND l.identity_id=$1 AND l.reason='first_ac'
  UNION ALL
  SELECT j.id::text,j.problem_id,CASE
   WHEN $2 THEN v.definition->>'title'
   WHEN p.archived_at IS NULL AND NOT bank.archived THEN CASE
    WHEN bank.resource_kind='ordinary' AND p.published THEN published.definition->>'title'
    WHEN bank.resource_kind='publication' THEN ${schoolCatalogActivityTitle} END
   END,award.points,result.recorded_at,${schoolActivityJobVisibleSql('j')}
  FROM school_scholarship_receipts receipt
  JOIN school_scholarship_results result USING(school_id,source_kind,job_id,subject_key)
  JOIN school_rank_awards award USING(school_id,identity_id,subject_key)
  JOIN school_judge_jobs j ON (j.school_id,j.id)=(receipt.school_id,receipt.job_id)
  JOIN school_problem_versions v ON (v.school_id,v.problem_id,v.id)=(j.school_id,j.problem_id,j.version_id)
  JOIN school_problems p ON (p.school_id,p.id)=(j.school_id,j.problem_id)
  JOIN school_problem_banks bank ON (bank.school_id,bank.id)=(p.school_id,p.bank_id)
  LEFT JOIN school_problem_versions published ON (published.school_id,published.problem_id,published.id)=
    (p.school_id,p.id,p.published_version_id)
  WHERE receipt.school_id=$3 AND receipt.identity_id=$1 AND receipt.source_kind='problem'
   AND result.status='AC' AND j.kind='submit' AND j.access_context='school'
 ), first_ac AS (SELECT DISTINCT ON (problem_id) * FROM candidates ORDER BY problem_id,created_at,id)
 SELECT * FROM first_ac WHERE visible AND title IS NOT NULL`;
 const params = [identityId,ctx.user.identityId===identityId,person.school_id];
 const {rows:[pageData]} = await ctx.pool.query(`WITH visible AS MATERIALIZED (${events}),
  page AS (SELECT * FROM visible ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5)
  SELECT (SELECT count(*)::int FROM visible) total,
   coalesce(jsonb_agg(page ORDER BY created_at DESC,id DESC),'[]') items FROM page`,
  [...params,pageSize,(page-1)*pageSize]);
 const {total,items:rows}=pageData;
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

async function practiceProfileOperation(ctx, accountId, section, messageId, action) {
 const {user,method}=ctx, own=user.id===accountId;
 if (!section && method==='PATCH') {
  if (!own) fail(403,'FORBIDDEN','You can only manage your own practice profile.');
  const enabled=ctx.body.profileEnabled;
  if (typeof enabled!=='boolean') fail(400,'VALIDATION','Choose whether to share your practice profile.');
  return withGuestbookTransaction(ctx,async db=>{
   await activeAccount(db,user.id);
   await lockGuestbook(db,user.id,'practice',true);
   await db.query(`INSERT INTO public_practice_preferences(account_id,profile_enabled) VALUES($1,$2)
    ON CONFLICT(account_id) DO UPDATE SET profile_enabled=EXCLUDED.profile_enabled`,[user.id,enabled]);
   return response({profileEnabled:enabled});
  });
 }
 const target=await practiceProfileTarget(ctx.pool,user,accountId,method==='DELETE');
 if (section==='mentions' && method==='GET') return listMentionCandidates(ctx,target.identity_id,accountId);
 if (section==='messages') {
  if (!messageId && method==='GET') return listMessages(ctx,target.identity_id,accountId,{publicPractice:true});
  if (!messageId && method==='POST') {
   if (ctx.body.quoteId==null) {
    const schoolId=await defaultMessageSchool(ctx.pool,user.id,accountId);
    if (schoolId) return handleCommunity({...ctx,route:`/schools/${schoolId}/profiles/${accountId}/messages`});
   }
   return createMessage(ctx,target.identity_id,accountId);
  }
  if (action==='replies' && method==='GET') return listMessages(ctx,target.identity_id,accountId,{publicPractice:true,threadId:messageId});
  if (action==='like' && method==='POST') return reactToMessage(ctx,target.identity_id,messageId,accountId);
  if (messageId && !action && method==='DELETE') return deleteMessage(ctx,target.identity_id,messageId,accountId);
  return null;
 }
 if (method!=='GET') return null;
 if (section==='activity' && !own) fail(404,'NOT_FOUND','This activity is private.');
 if (!own) return response({profile:{...await profileCover(ctx.pool,accountId),nickname:target.nickname,avatar:defaultAvatarPath(target.alias),isSelf:false}});
 return withGuestbookTransaction(ctx,async db=>{
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
  return response({profile:{...await profileCover(db,accountId),...stats,solvedProblems:total,nickname:target.nickname,avatar:defaultAvatarPath(target.alias),
   isSelf:true,profileEnabled:target.enabled}});
 });
}

async function listMessages(ctx, identityId, ownerAccountId, {publicPractice=false, threadId=null} = {}) {
 const practiceAccountId=publicPractice ? ownerAccountId : null;
 const before=ctx.homepageBefore;
 const {page,pageSize} = paging(ctx.url);
 const own=ctx.user.id===ownerAccountId;
 const params=[[identityId,ownerAccountId],ctx.user.id,own,practiceAccountId];
 if (threadId) await visibleMessage(ctx.pool,params,threadId,{root:true});
 const {rows}=await ctx.pool.query(`WITH visible AS MATERIALIZED (
   SELECT m.id,m.body,m.created_at,m.author_account_id,m.thread_id,m.quote_id,
    ${publicPractice?'i.id':`(SELECT ${schoolMemberProfileId} ${schoolMemberProfileRows}
       AND membership.school_id=m.school_id AND profile_account.id=a.id)`} author_identity_id,
    a.avatar author_avatar,i.id author_avatar_identity_id,${publicAlias()} author_alias,
    ${publicPractice ? publicName() : "COALESCE(NULLIF(btrim(a.nickname),''),i.name)"} author_nickname
   ${visibleMessageSql}
   ${before ? 'AND m.school_id IS NOT DISTINCT FROM $8::uuid' : ''}
 ), page AS (
   SELECT * FROM visible WHERE thread_id IS NOT DISTINCT FROM $5::uuid
    AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM visible WHERE id=$5 AND thread_id IS NULL))
   ${before ? 'AND ($9::timestamptz IS NULL OR (created_at,id)<($9,$10::uuid))' : ''}
   ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7
 ), totals AS (
   SELECT count(*) FILTER (WHERE thread_id IS NOT DISTINCT FROM $5::uuid)::int total,
    count(*) FILTER (WHERE thread_id IS NOT NULL AND EXISTS(SELECT 1 FROM visible root WHERE root.id=visible.thread_id))::int reply_total
   FROM visible
 )
 SELECT totals.*,p.*,${before ? `to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_at,` : ''}q.body quote_body,q.author_nickname quote_nickname,
  (SELECT count(*)::int FROM visible r WHERE r.thread_id=p.id) reply_count,
  (SELECT count(*)::int FROM student_guestbook_likes l WHERE l.message_id=p.id) like_count,
  EXISTS(SELECT 1 FROM student_guestbook_likes l WHERE l.message_id=p.id AND l.account_id=$2) liked,
  (SELECT jsonb_agg(jsonb_build_object('id',${publicPractice ? 'tagged.id' : 'member.id'},
      'nickname',${publicNickname(publicPractice,'tagged')},'ranges',tag.text_ranges) ORDER BY tagged.id)
   FROM student_guestbook_mentions tag
   JOIN accounts tagged ON tagged.id=tag.account_id AND tagged.disabled_at IS NULL AND tagged.binding_released_at IS NULL
   JOIN identities tagged_identity ON tagged_identity.id=tagged.identity_id AND tagged_identity.archived_at IS NULL
   ${publicPractice ? 'JOIN public_practice_preferences pref ON pref.account_id=tagged.id AND pref.profile_enabled'
     : `JOIN LATERAL (SELECT ${schoolMemberProfileId} id ${schoolMemberProfileRows}
        AND membership.school_id=$8 AND profile_account.id=tagged.id) member ON true`}
   WHERE tag.message_id=p.id) mentions
 FROM totals LEFT JOIN page p ON true LEFT JOIN visible q ON q.id=p.quote_id
 ORDER BY p.created_at DESC,p.id DESC`,[...params,threadId,pageSize+(before?1:0),(page-1)*pageSize,
    ...(!publicPractice || before ? [ctx.schoolId??null] : []),...(before??[])]);
 const moderator=publicPractice ? await isPlatformAdministrator(ctx.pool,ctx.user.id) : admin(ctx.user);
 return response({items:rows.filter(row=>row.id).map(row=>({...messageShape(row,ctx.user,own,moderator,publicPractice),
   ...(before && {cursor:row.sort_at+'~'+row.id})})),
  acceptingMessages:await acceptsMessages(ctx.pool,ownerAccountId,publicPractice ? 'practice' : 'school'),
  total:rows[0].total,replyTotal:rows[0].reply_total,page,pageSize});
}

async function createMessage(ctx, identityId, practiceAccountId = null) {
 const publicPractice=practiceAccountId!==null;
 const quoteId=ctx.body.quoteId==null ? null : uuid(ctx.body.quoteId,'引用留言 ID');
 const mentionIds=ctx.body.mentionIds??[];
 const inlineMentions=ctx.body.mentions??[];
 if (!Array.isArray(mentionIds) || !Array.isArray(inlineMentions) || mentionIds.length+inlineMentions.length>5)
  fail(400,'VALIDATION','最多可提及 5 次');
 const body=field(ctx.body.body,quoteId?'回复':'留言',{min:1,max:quoteId?300:500});
 const ranges=inlineMentions.map(mention=>({
  id:uuid(mention?.id,'提及用户 ID').toLowerCase(),
  start:integer(mention?.start,0,body.length-1,'提及起点'),
  end:integer(mention?.end,1,body.length,'提及终点'),
 })).sort((left,right)=>left.start-right.start);
 const requestedMentions=[...new Set([...mentionIds.map(id=>uuid(id,'提及用户 ID').toLowerCase()),...ranges.map(range=>range.id)])];
 if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body))
  fail(400,'VALIDATION','留言包含无效字符');
 if (/(?:https?:\/\/|www\.)/iu.test(body))
  fail(400,'VALIDATION','留言不支持外部链接');
 if (!publicPractice && !ctx.schoolId) fail(404,'NOT_FOUND','请从学校工作区打开成员主页');
 const created=await withGuestbookTransaction(ctx,async db=>{
  if (publicPractice) await lockGuestbook(db,practiceAccountId,'practice',false);
  const profile=await guestbookProfile(db,ctx,identityId,practiceAccountId);
  const own=ctx.user.id===profile.account_id;
  if (!publicPractice) await lockGuestbook(db,profile.account_id,'school',false);
  if (!await acceptsMessages(db,profile.account_id,publicPractice ? 'practice' : 'school'))
   fail(403,'GUESTBOOK_CLOSED','此主页已关闭新留言和回复。');
  const params=[[profile.id??identityId,profile.account_id],ctx.user.id,own,practiceAccountId];
  const quote=quoteId ? await visibleMessage(db,params,quoteId,{lock:true}) : null;
  const threadId=quote ? quote.thread_id??quote.id : null;
  if (quote?.thread_id) await visibleMessage(db,params,threadId,{root:true,lock:true});
  const mentions=requestedMentions.length ? await mentionCandidates(db,profile,publicPractice,'',requestedMentions) : [];
  if (mentions.length!==requestedMentions.length) fail(400,'VALIDATION','部分提及用户已不可用');
  const names=new Map(mentions.map(tag=>[tag.id,tag.nickname]));
  for (const [index, range] of ranges.entries()) {
   if (range.start>=range.end || (index>0 && ranges[index-1].end>range.start)
     || body.slice(range.start,range.end)!==`@${names.get(range.id)}`)
    fail(400,'VALIDATION','提及内容已变更，请重新选择用户');
  }
  // The account-scoped transaction lock makes the database throttle work even
  // with multiple API processes. Count only successfully created messages.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,78314))',[ctx.user.id]);
  const recent=(await db.query(`SELECT
   count(*) FILTER (WHERE created_at>clock_timestamp()-interval '30 seconds')::int recent,
   count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 day')::int daily
   FROM student_guestbook_messages WHERE author_account_id=$1`,[ctx.user.id])).rows[0];
  if(recent.recent || recent.daily>=20) fail(429,'RATE_LIMIT','留言过于频繁，请稍后再试');
  const accountProfile=!publicPractice && !profile.student_dossier;
  const m=(await db.query(`INSERT INTO student_guestbook_messages(profile_identity_id,author_account_id,body,
    practice_profile_account_id,thread_id,quote_id,school_id,school_profile_account_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,body,created_at,author_account_id,thread_id,quote_id`,
   [accountProfile?null:profile.id??identityId,ctx.user.id,body,practiceAccountId,threadId,quoteId,ctx.schoolId??null,
    accountProfile?profile.account_id:null])).rows[0];
  const recipients=new Map(mentions.map(tag=>[tag.account_id,'mention']));
  if (quote) recipients.set(quote.author_account_id,'reply');
  if (!recipients.has(profile.account_id)) recipients.set(profile.account_id,quote?'reply':'message');
  recipients.delete(ctx.user.id);
  if (mentions.length) await db.query(`INSERT INTO student_guestbook_mentions(message_id,account_id,text_ranges)
   SELECT $1,tag.account_id,tag.ranges FROM jsonb_to_recordset($2::jsonb) tag(account_id uuid,ranges jsonb)`,
   [m.id,JSON.stringify(mentions.map(tag=>{
    const occurrences=ranges.filter(range=>range.id===tag.id).map(({start,end})=>({start,end}));
    return {account_id:tag.account_id,ranges:occurrences.length ? occurrences : null};
   }))]);
  if (recipients.size) await db.query(`INSERT INTO student_guestbook_notifications(recipient_identity_id,recipient_account_id,message_id,interaction)
   SELECT a.identity_id,a.id,$1,recipient.interaction
   FROM unnest($2::uuid[],$3::text[]) recipient(account_id,interaction)
   JOIN accounts a ON a.id=recipient.account_id`,[m.id,[...recipients.keys()],[...recipients.values()]]);
  await ctx.helpers.audit(db,ctx.user.id,'profile.message_create','student_guestbook_message',m.id,
   {profileIdentityId:identityId,threadId,quoteId});
  if (!publicPractice) return {...m,author_identity_id:ctx.user.identityId,
   author_nickname:ctx.user.nickname?.trim()||ctx.user.name,author_avatar:ctx.user.avatar||''};
  const {rows:[author]}=await db.query(`SELECT ${publicAlias()} author_alias,${publicName()} author_nickname
   FROM accounts a WHERE a.id=$1`,[ctx.user.id]);
  return {...m,...author};
 });
 return response(messageShape(created,ctx.user,false,false,publicPractice),201);
}

async function reactToMessage(ctx, identityId, messageId, practiceAccountId = null) {
 const {liked}=ctx.body;
 if (typeof liked!=='boolean') fail(400,'VALIDATION','点赞状态无效');
 return withGuestbookTransaction(ctx,async db=>{
  const profile=await guestbookProfile(db,ctx,identityId,practiceAccountId);
  const own=ctx.user.id===profile.account_id;
  const params=[[profile.id??identityId,profile.account_id],ctx.user.id,own,practiceAccountId];
  const message=await visibleMessage(db,params,messageId,{lock:true});
  if (message.thread_id) await visibleMessage(db,params,message.thread_id,{root:true,lock:true});
  if (liked) await db.query(`INSERT INTO student_guestbook_likes(message_id,account_id) VALUES($1,$2)
   ON CONFLICT DO NOTHING`,[messageId,ctx.user.id]);
  else await db.query('DELETE FROM student_guestbook_likes WHERE message_id=$1 AND account_id=$2',[messageId,ctx.user.id]);
  const {rows:[{count}]}=await db.query('SELECT count(*)::int count FROM student_guestbook_likes WHERE message_id=$1',[messageId]);
  return response({liked,likeCount:count});
 });
}

async function deleteMessage(ctx, identityId, messageId, practiceAccountId = null) {
 const publicPractice=practiceAccountId!==null;
 await withGuestbookTransaction(ctx,async db=>{
  // Administrators must be able to resolve historical reports even after
  // the target student account or identity was disabled, unbound or archived.
  // Students and class teachers still need the normal live-profile access.
  const target=publicPractice ? null : admin(ctx.user) ? await schoolProfile(db,identityId) : await visibleProfile(db,ctx,identityId);
  const owner=publicPractice ? practiceAccountId : target?.account_id;
  const m=(await db.query(`SELECT id,author_account_id,deleted_at FROM student_guestbook_messages
   WHERE id=$1 AND ($3::uuid IS NOT NULL OR profile_identity_id=($2::uuid[])[1] OR school_profile_account_id=($2::uuid[])[2])
    AND practice_profile_account_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,
    [messageId,[target?.id??identityId,owner??identityId],practiceAccountId])).rows[0];
  if(!m) fail(404,'NOT_FOUND','留言不存在');
  const moderator=publicPractice ? await isPlatformAdministrator(db,ctx.user.id) : admin(ctx.user);
  const own=ctx.user.id===owner;
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

async function reports(ctx, identityId) {
 if(!admin(ctx.user)) fail(403,'FORBIDDEN','需要管理员权限');
 const {page,pageSize}=paging(ctx.url);
 const status=reportFilter(ctx.url);
 const base=`FROM student_guestbook_reports r
  JOIN student_guestbook_messages m ON m.id=r.message_id
  WHERE ${schoolMessageTarget} AND m.practice_profile_account_id IS NULL`;
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
  COALESCE(m.profile_identity_id,m.school_profile_account_id) profile_identity_id,m.practice_profile_account_id,m.body,m.deleted_at,${reportStatusSql} status,
  ${publicPractice?publicName('pa'):"COALESCE(NULLIF(btrim(pa.nickname),''),'同学')"} profile_nickname,
  ${publicPractice ? `(pi.archived_at IS NULL AND pa.disabled_at IS NULL AND pa.binding_released_at IS NULL
   AND EXISTS (SELECT 1 FROM public_practice_preferences pref WHERE pref.account_id=pa.id AND pref.profile_enabled))`
   : `EXISTS (SELECT 1 ${schoolMemberProfileRows} AND membership.school_id=m.school_id
     AND (${schoolMemberProfileId}=m.profile_identity_id OR profile_account.id=m.school_profile_account_id))`} profile_available,
  aa.identity_id author_identity_id,
  ${publicPractice?publicName('aa'):"COALESCE(NULLIF(btrim(aa.nickname),''),'同学')"} author_nickname
  ${base}
  LEFT JOIN ${publicPractice?'identities':'school_identities'} pi ON pi.id=m.profile_identity_id
  JOIN accounts aa ON aa.id=m.author_account_id
  LEFT JOIN accounts pa ON ${publicPractice?'pa.id=m.practice_profile_account_id':'pa.id=COALESCE(m.school_profile_account_id,pi.account_id) AND pa.binding_released_at IS NULL'}
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
 await withGuestbookTransaction(ctx,async db=>{
  // Lock the message before the report, matching deletion's lock order.
  const message=(await db.query(`SELECT m.id,COALESCE(m.profile_identity_id,m.school_profile_account_id) profile_identity_id,m.deleted_at
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

async function listSchoolProfiles(ctx) {
 const {page,pageSize}=paging(ctx.url);
 const query=field(ctx.url.searchParams.get('q')??'','姓名或昵称',{min:0,max:100});
 const {rows}=await ctx.pool.query(`SELECT ${schoolMemberProfileId} id, ${schoolMemberProfileName} name,
   membership.role, profile_account.avatar
   ${schoolMemberProfileRows}
   AND membership.school_id=$1 AND ($2='' OR strpos(lower(${schoolMemberProfileName}),lower($2))>0)
   ORDER BY name,id LIMIT $3 OFFSET $4`,[ctx.schoolId,query,pageSize+1,(page-1)*pageSize]);
 return response({items:rows.slice(0,pageSize).map(row=>({...row,avatar:avatarForIdentity(row.avatar,row.id)})),
  hasMore:rows.length>pageSize});
}

export async function handleCommunity(ctx) {
 const homepage=ctx.method==='GET' && ctx.route.match(/^\/homepages\/([^/]+)(\/messages)?$/);
 if (homepage) return accountHomepage(ctx,uuid(homepage[1]),Boolean(homepage[2]),handleCommunity);
 if (ctx.route==='/account/profile-cover' && ctx.method==='PATCH') return updateProfileCover(ctx);
 if (ctx.route==='/account/guestbook-settings' && ['GET','PATCH'].includes(ctx.method)) return guestbookSettings(ctx);
 const scoped=ctx.route.match(/^(\/platform)?\/schools\/([^/]+)(\/(?:profiles(?:\/.*)?|profile-message-reports(?:\/.*)?))$/);
 if(scoped)return transaction(ctx.pool,async db=>{
  const platformProfile=Boolean(scoped[1]);
  const schoolId=uuid(scoped[2]);
  const route=scoped[3];
  if (platformProfile && (!route.startsWith('/profiles/') || route.endsWith('/message-reports'))) return null;
  if (platformProfile) await requirePlatformAdministrator(db,ctx.user.id);
  await lockSchoolTeaching(db,schoolId,{shared:true});
  const role=platformProfile ? null : await schoolRole(db,schoolId,ctx.user.id);
  await db.query("SELECT set_config('campus.school_id',$1,true)",[schoolId]);
  const person=platformProfile ? null : (await db.query(`SELECT ${schoolMemberProfileId} id
   ${schoolMemberProfileRows} AND membership.school_id=$1 AND profile_account.id=$2`,[schoolId,ctx.user.id])).rows[0];
  if (!platformProfile && !person) fail(404,'NOT_FOUND','学校工作区不存在或不可访问');
  return handleCommunity({...ctx,route,pool:db,schoolId,platformProfile,inSchoolTransaction:true,
   user:{...ctx.user,identityId:person?.id??null,roles:role ? [role==='school_admin'?'admin':role] : []}});
 });
 if (ctx.schoolId && ctx.route==='/profiles' && ctx.method==='GET') return listSchoolProfiles(ctx);
 const read=ctx.method==='GET' && ctx.route.match(/^\/profiles\/([^/]+)(?:\/(activity|messages(?:\/([^/]+)\/replies)?))?$/);
 if (read) {
  const [,rawIdentity,section,rawThread]=read;
  const identityId=uuid(rawIdentity,'主页 ID');
  const threadId=rawThread ? uuid(rawThread,'留言 ID') : null;
  const target=await visibleProfile(ctx.pool,ctx,identityId);
  if (ctx.resolveHomepageAccount && !section) return response({accountId:target.account_id});
  if (!section) return profile(ctx,target);
  if (section==='activity') return activity(ctx,target);
  return listMessages(ctx,target.id,target.account_id,{threadId});
 }
 const practice=ctx.route.match(/^\/practice\/profiles\/([^/]+)(?:\/(activity|messages|mentions)(?:\/([^/]+)(?:\/(replies|like))?)?)?$/);
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
 const message=ctx.route.match(/^\/profiles\/([^/]+)\/messages\/([^/]+)(?:\/(like))?$/);
 if(message) {
  const identityId=uuid(message[1],'主页 ID'),messageId=uuid(message[2],'留言 ID');
  if(message[3]==='like' && ctx.method==='POST') return reactToMessage(ctx,identityId,messageId);
  if(!message[3] && ctx.method==='DELETE') return deleteMessage(ctx,identityId,messageId);
  return null;
 }
 const section=ctx.route.match(/^\/profiles\/([^/]+)\/(messages|mentions)$/);
 if(section) {
  const identityId=uuid(section[1],'主页 ID');
  if(section[2]==='mentions' && ctx.method==='GET') return listMentionCandidates(ctx,identityId,null);
  if(section[2]==='messages' && ctx.method==='POST') return createMessage(ctx,identityId);
  return null;
 }
 return null;
}
