import {pythonPractice} from './python-practice.mjs';
import {validateLearningDocument} from './learning-document.mjs';
import { transaction } from './db.mjs';
import { fail, field, uuid, bytes, integer,enumValue } from './security.mjs';
import { getTimedPracticeResult } from './timed.mjs';
import { avatarForIdentity } from './avatars.mjs';

const staff = user => user.roles.includes('teacher') || user.roles.includes('admin');
const administrator = user => user.roles.includes('admin');
const result = (body, status = 200) => ({ status, body });
const requireStaff = user => { if (!staff(user)) fail(403, 'FORBIDDEN', '需要教师权限'); };
const exists = query => { if (!query.rowCount) fail(404, 'NOT_FOUND', '内容不存在'); return query.rows[0]; };

async function pathAccess(db, user, id, edit = false, lock = false, allowArchived = false) {
 const path = exists(await db.query(`SELECT * FROM learning_paths WHERE id=$1 AND (archived_at IS NULL OR $2) ${lock ? 'FOR UPDATE' : ''}`, [uuid(id),allowArchived]));
 const canEdit = staff(user) && (administrator(user) || path.owner_account_id === user.id);
 if(path.archived_at&&(!allowArchived||!canEdit))fail(404,'NOT_FOUND','内容不存在');
 if (edit && !canEdit) fail(403, 'FORBIDDEN', '只能维护本人负责的学习内容');
 if (!canEdit && !path.published_at) fail(404, 'NOT_FOUND', '内容不存在');
 return { ...path, canEdit };
}

function pathShape(p) {
 return { id: p.id, title: p.title,estimatedMinutes:p.estimated_minutes,updatedAt:p.updated_at,createdAt:p.created_at, description: p.description, category: p.category, published: !!p.published_at,archived:!!p.archived_at,
  difficulty:p.difficulty??'beginner',coverKey:p.cover_key??'general',taskCount:Number(p.task_count??0),completedTasks:Number(p.completed_tasks??0),chapterCount: Number(p.chapter_count ?? 0), completedChapters: Number(p.completed_chapters ?? 0), canEdit: p.canEdit ?? false };
}

async function taskStats(db,user,ids,draftIds=[]) {
 if(!ids.length)return new Map();
 const rows=(await db.query(`SELECT c.path_id,count(DISTINCT cp.version_id)::int task_count,
 count(DISTINCT cp.version_id) FILTER(WHERE EXISTS(SELECT 1 FROM submissions s WHERE s.identity_id=$2 AND s.version_id=cp.version_id AND s.kind IN ('submit','correction') AND s.status='AC' AND (s.timed_attempt_id IS NULL OR EXISTS(SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL))))::int completed_tasks
 FROM learning_chapters c JOIN chapter_problems cp ON cp.chapter_id=c.id JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id JOIN problem_versions v ON v.id=cp.version_id
 WHERE c.path_id=ANY($1::uuid[]) AND c.archived_at IS NULL AND p.archived_at IS NULL AND b.archived_at IS NULL AND b.visibility='school' AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL GROUP BY c.path_id`,[ids,user.identityId])).rows;
 const stats=new Map(rows.map(r=>[r.path_id,r]));
 if(draftIds.length){
  const drafts=(await db.query(`SELECT c.path_id,count(DISTINCT cp.version_id)::int task_count
   FROM learning_chapters c JOIN chapter_problems cp ON cp.chapter_id=c.id
   JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id
   JOIN problem_versions v ON v.id=cp.version_id AND v.problem_id=cp.problem_id
   WHERE c.path_id=ANY($1::uuid[]) AND c.archived_at IS NULL AND p.archived_at IS NULL
    AND b.archived_at IS NULL AND b.visibility='school' GROUP BY c.path_id`,[draftIds])).rows;
  for(const draft of drafts)stats.set(draft.path_id,{...draft,completed_tasks:0});
 }
 return stats;
}
async function pathResult(ctx, id, db = ctx.pool, allowArchived = false) {
 const p = await pathAccess(db, ctx.user, id, false, false, allowArchived);
 const chapters = (await db.query(`SELECT c.*, COALESCE(pr.completed,false) completed FROM learning_chapters c
  LEFT JOIN learning_progress pr ON pr.chapter_id=c.id AND pr.identity_id=$2 WHERE c.path_id=$1 AND c.archived_at IS NULL ORDER BY c.position,c.created_at,c.id`, [id, ctx.user.identityId])).rows;
 const links = chapters.length ? (await db.query(`SELECT cp.*,v.title,v.published_at,v.school_visible_at,v.rank_review_status,b.name bank_name,b.visibility bank_visibility,b.archived_at bank_archived_at,p.archived_at problem_archived_at
  FROM chapter_problems cp JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id
  JOIN problem_versions v ON v.id=cp.version_id AND v.problem_id=cp.problem_id
  WHERE cp.chapter_id=ANY($1::uuid[]) ORDER BY cp.position`, [chapters.map(c => c.id)])).rows : [];
 const visible = new Map();
 for (const link of links) {
  const publicForStudents=link.bank_visibility==='school'&&!link.bank_archived_at&&!link.problem_archived_at&&!!link.published_at&&!!link.school_visible_at;
  const readyForCourse=publicForStudents&&link.rank_review_status==='approved';
  if (!p.canEdit && !publicForStudents) continue;
  // A published lesson never grants student access to a private or nonpublic
  // version. Editors may inspect a draft link to repair it before publication.
  try { await ctx.helpers.versionAccess(db, ctx.user, link.problem_id, link.version_id); }
  catch (error) { if ([403,404].includes(error.status)) continue; throw error; }
  if (!visible.has(link.chapter_id)) visible.set(link.chapter_id, []);
  visible.get(link.chapter_id).push({ problemId: link.problem_id, title: link.title, versionId: link.version_id,
   bankName:link.bank_name,published:!!link.published_at,schoolVisibleAt:link.school_visible_at??null,rankReviewStatus:link.rank_review_status??'pending',readyForCourse });
 }
 const versions=[...new Set([...visible.values()].flat().map(l=>l.versionId))];
 const solved=new Set(versions.length?(await db.query("SELECT DISTINCT version_id FROM submissions WHERE identity_id=$1 AND version_id=ANY($2::uuid[]) AND kind IN ('submit','correction') AND status='AC' AND (timed_attempt_id IS NULL OR EXISTS(SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id WHERE ta.id=submissions.timed_attempt_id AND tp.results_published_at IS NOT NULL))",[ctx.user.identityId,versions])).rows.map(r=>r.version_id):[]);
 const bundle=Array.isArray(p.practice_bundle)?p.practice_bundle:[];
 const state=p.canEdit&&bundle.length?(await db.query('SELECT id,validation_status,published_at FROM problem_versions WHERE id=ANY($1::uuid[])',[bundle.map(x=>x.versionId)])).rows:[];
 const status=new Map(state.map(v=>[v.id,v]));
 const linkedAssignments=p.published_at&&ctx.user.roles.includes('student')?(await db.query(`SELECT a.id,a.title,a.due_at FROM assignments a WHERE a.course_path_id=$1 AND a.state='Published' AND a.archived_at IS NULL AND EXISTS(SELECT 1 FROM assignment_participants ap WHERE ap.assignment_id=a.id AND ap.identity_id=$2 AND NOT ap.exempt) ORDER BY a.due_at DESC,a.created_at DESC`,[id,ctx.user.identityId])).rows:[];
 return { ...pathShape({ ...p, task_count:versions.length,completed_tasks:solved.size,chapter_count: chapters.length, completed_chapters: chapters.filter(c => c.completed).length }),
  assignments:linkedAssignments.map(a=>({id:a.id,title:a.title,dueAt:a.due_at})),
  practiceBundle:p.canEdit?bundle.map(x=>({...x,validationStatus:status.get(x.versionId)?.validation_status??'Unknown',published:!!status.get(x.versionId)?.published_at})):undefined,
  chapters: chapters.map(c => ({ id: c.id, title: c.title, content: c.content, position: c.position, completed: c.completed,objective:c.objective,checkpoint:c.checkpoint,checkpointAnswer:c.checkpoint_answer, taskCount:(visible.get(c.id)??[]).length,completedTasks:(visible.get(c.id)??[]).filter(l=>solved.has(l.versionId)).length,problems: (visible.get(c.id) ?? []).map(l=>({...l,completed:solved.has(l.versionId)})) })) };
}

async function setLinks(ctx, db, path, chapterId, problemIds) {
 if (!Array.isArray(problemIds) || problemIds.length > 100) fail(400, 'VALIDATION', '练习题须为最多 100 项的 ID 数组');
 const ids = [...new Set(problemIds.map(id => uuid(id, '练习题 ID')))];
 const existing=new Map((await db.query('SELECT problem_id,version_id FROM chapter_problems WHERE chapter_id=$1',[chapterId])).rows.map(link=>[link.problem_id,link.version_id]));
 const links = [];
 for (const id of ids) {
  const selected=await ctx.helpers.versionAccess(db,ctx.user,id,existing.get(id));
  const {p}=selected;
  const lockedProblem=path.published_at?exists(await db.query('SELECT current_version_id,archived_at,bank_id FROM problems WHERE id=$1 FOR SHARE',[id])):p;
  if(lockedProblem.archived_at)fail(409,'ARCHIVED_LESSON_PROBLEM','已归档题目不能关联学习章节');
  const bank=(await db.query(`SELECT visibility,archived_at FROM problem_banks WHERE id=$1 ${path.published_at?'FOR SHARE':''}`,[lockedProblem.bank_id])).rows[0];
  if(!bank || bank.visibility!=='school' || bank.archived_at)fail(409,'PRIVATE_LESSON_PROBLEM','校内学习章节须关联校内题库中的题目');
  let resolved=selected;
  if(path.published_at&&!existing.has(id)){
   if(!lockedProblem.current_version_id)fail(409,'UNAPPROVED_LESSON_PROBLEM','已发布课程只能关联通过管理员校内公开审核的题目');
   resolved=await ctx.helpers.versionAccess(db,ctx.user,id,lockedProblem.current_version_id);
  }
  const {v,owner}=resolved;
  const checked=path.published_at?exists(await db.query('SELECT problem_id,published_at,school_visible_at,rank_review_status FROM problem_versions WHERE id=$1 FOR SHARE',[v.id])):v;
  const approved=checked.problem_id===id&&!!checked.published_at&&!!checked.school_visible_at&&checked.rank_review_status==='approved';
  if(path.published_at&&!approved)fail(409,'UNAPPROVED_LESSON_PROBLEM','已发布课程只能关联通过管理员校内公开审核的题目');
  if(!path.published_at&&!approved&&!owner)fail(403,'FORBIDDEN','未公开题目只能由有编辑权限的教师关联至课程草稿');
  links.push({ problemId: id, versionId: v.id });
 }
 await db.query('DELETE FROM chapter_problems WHERE chapter_id=$1', [chapterId]);
 for (const [position, link] of links.entries()) await db.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)', [chapterId,link.problemId,link.versionId,position]);
}

async function chapterAccess(ctx, db, id, edit = false) {
 const chapter = exists(await db.query('SELECT * FROM learning_chapters WHERE id=$1 AND archived_at IS NULL', [uuid(id)]));
 const path = await pathAccess(db, ctx.user, chapter.path_id, edit, edit);
 return { chapter, path };
}

async function teachingReport(ctx) {
 requireStaff(ctx.user);
 const classId = ctx.url.searchParams.get('classId');
 const assignmentId = ctx.url.searchParams.get('assignmentId');
 const timedPracticeId = ctx.url.searchParams.get('timedPracticeId');
 if (classId) uuid(classId); if (assignmentId) uuid(assignmentId); if(timedPracticeId)uuid(timedPracticeId);
 if(assignmentId&&timedPracticeId)fail(400,'VALIDATION','请分别选择作业或计时训练');
 const classes = (await ctx.pool.query(`SELECT c.id,c.name,(c.archived_at IS NOT NULL) archived FROM classes c WHERE ($1::boolean OR EXISTS
  (SELECT 1 FROM teacher_classes tc WHERE tc.class_id=c.id AND tc.account_id=$2)) ORDER BY c.archived_at IS NOT NULL,c.name,c.id`, [administrator(ctx.user),ctx.user.id])).rows;
 if (classId && !classes.some(c => c.id === classId)) fail(403, 'FORBIDDEN', '无权查看该班级报告');
 const activityClassId=!classId&&assignmentId?(await ctx.pool.query('SELECT class_id FROM assignments WHERE id=$1',[assignmentId])).rows[0]?.class_id:
  !classId&&timedPracticeId?(await ctx.pool.query('SELECT class_id FROM timed_practices WHERE id=$1',[timedPracticeId])).rows[0]?.class_id:null;
 if(activityClassId&&!classes.some(c=>c.id===activityClassId))fail(403,'FORBIDDEN','无权查看该活动报告');
 const classIds = classId ? [classId] : activityClassId?[activityClassId]:classes.filter(c=>!c.archived).map(c => c.id);
 const sinceRaw=ctx.url.searchParams.get('since'),untilRaw=ctx.url.searchParams.get('until');const since=sinceRaw?new Date(sinceRaw):null,until=untilRaw?new Date(untilRaw):null;if(since&&!Number.isFinite(since.getTime())||until&&!Number.isFinite(until.getTime())||since&&until&&until<since)fail(400,'VALIDATION','时间范围无效');
 const assignments = (await ctx.pool.query("SELECT id,title,class_id,due_at FROM assignments WHERE class_id=ANY($1::uuid[]) AND state='Published' AND ($2::timestamptz IS NULL OR created_at>=$2) AND ($3::timestamptz IS NULL OR created_at<=$3) ORDER BY created_at DESC,id", [classIds,since,until])).rows;
 if (assignmentId && !assignments.some(a => a.id === assignmentId)) fail(403, 'FORBIDDEN', '无权查看该作业报告');
 const timedPractices=(await ctx.pool.query("SELECT id,title,class_id,ends_at FROM timed_practices WHERE class_id=ANY($1::uuid[]) AND state<>'Draft' AND (state<>'Archived' OR results_published_at IS NOT NULL) AND ($2::timestamptz IS NULL OR created_at>=$2) AND ($3::timestamptz IS NULL OR created_at<=$3) ORDER BY created_at DESC,id",[classIds,since,until])).rows;
 if(timedPracticeId&&!timedPractices.some(p=>p.id===timedPracticeId))fail(403,'FORBIDDEN','无权查看该训练报告');
 const chosen = timedPracticeId?[]:assignmentId ? assignments.filter(a => a.id === assignmentId) : assignments;
 const chosenTimed=assignmentId?[]:timedPracticeId?timedPractices.filter(p=>p.id===timedPracticeId):timedPractices;
 const students = new Map(), problems = new Map();
 for (const activity of [...chosen.map(a=>({...a,type:'assignment'})),...chosenTimed.map(a=>({...a,type:'timed'}))]) {
  const a = activity.type==='timed'?await getTimedPracticeResult(ctx.pool,ctx.user,activity.id):await ctx.helpers.assignmentResult(ctx.pool, ctx.user, activity.id);
  const titles = new Map(a.problems.map(p => [p.problemId,p.title]));
  for (const grade of a.grades) {
   if (!students.has(grade.identityId)) students.set(grade.identityId, { identityId: grade.identityId, name: grade.name, assignments: [] });
   students.get(grade.identityId).assignments.push({ id: a.id, title: a.title, type:activity.type, score: grade.score, maxScore: grade.maxScore, pending: grade.pending, problems: grade.problems });
   for (const g of grade.problems) {
    if (!problems.has(g.problemId)) problems.set(g.problemId, { problemId:g.problemId,title:titles.get(g.problemId),attempted:0,denominator:0,valid:0,totalPercent:0,pending:0 });
    const p = problems.get(g.problemId); p.denominator++;
    if (g.submissionId || g.pending) p.attempted++;
    const unresolved=g.pending||(['Waiting','Judging','System Error'].includes(g.status)&&g.score===null);
    if (unresolved) p.pending++;
    else if (g.score !== null && g.submissionId) { p.valid++; p.totalPercent += g.score; }
   }
  }
 }
 const rows = [...students.values()].sort((a,b) => a.name.localeCompare(b.name,'zh-CN'));
 const submitted = rows.filter(s => s.assignments.some(a => a.problems.some(p => p.submissionId || p.pending)));
 const pending = rows.filter(s => s.assignments.some(a => a.pending));
 const graded = rows.filter(s => !s.assignments.some(a => a.pending) && s.assignments.some(a => a.problems.some(p => p.score !== null&&p.submissionId)));
 const totals = graded.map(s => ({ score:s.assignments.reduce((n,a)=>n+(a.score??0),0), max:s.assignments.reduce((n,a)=>n+a.maxScore,0) }));
 const round = value => Math.round(value*100)/100;
 const selectedIds = chosen.map(a => a.id);
 const selectedTimed=chosenTimed.map(p=>p.id);
 const recent = (await ctx.pool.query(`SELECT s.id,s.identity_id,s.kind,s.original_submission_id,s.problem_id,s.assignment_id,s.status,s.score,s.created_at,i.name student_name,ta.practice_id
  FROM submissions s JOIN identities i ON i.id=s.identity_id LEFT JOIN timed_attempts ta ON ta.id=s.timed_attempt_id
  WHERE (s.assignment_id=ANY($1::uuid[]) OR ta.practice_id=ANY($2::uuid[])) AND s.kind='submit' ORDER BY s.created_at DESC,s.id DESC LIMIT 100`, [selectedIds,selectedTimed])).rows;
 const diagnostics=(await ctx.pool.query(`SELECT s.identity_id,s.problem_id,count(*) FILTER(WHERE s.kind='submit' AND s.status IN ('WA','CE','RE','TLE','MLE','OLE'))::int failures,
  bool_or(EXISTS(SELECT 1 FROM review_entries r JOIN accounts ra ON ra.id=r.author_account_id WHERE r.submission_id=s.id AND ra.identity_id=s.identity_id AND r.created_at>COALESCE((SELECT max(feedback.created_at) FROM review_entries feedback JOIN account_roles fr ON fr.account_id=feedback.author_account_id WHERE feedback.submission_id=s.id AND fr.role IN ('teacher','admin')),'-infinity'::timestamptz))) waiting_feedback
  FROM submissions s LEFT JOIN submissions original ON original.id=s.original_submission_id LEFT JOIN timed_attempts ta ON ta.id=COALESCE(s.timed_attempt_id,original.timed_attempt_id)
  WHERE COALESCE(s.assignment_id,original.assignment_id)=ANY($1::uuid[]) OR ta.practice_id=ANY($2::uuid[]) GROUP BY s.identity_id,s.problem_id`,[selectedIds,selectedTimed])).rows;
 for(const student of rows){const ds=diagnostics.filter(d=>d.identity_id===student.identityId);student.notStarted=!student.assignments.some(a=>a.problems.some(p=>p.submissionId||p.pending));student.incomplete=student.assignments.some(a=>a.problems.some(p=>p.status!=='AC'));student.repeatedFailureProblemIds=ds.filter(d=>d.failures>=2).map(d=>d.problem_id);student.waitingFeedback=ds.some(d=>d.waiting_feedback);}
 const metrics={denominator:rows.length,notStarted:rows.filter(s=>s.notStarted).length,incomplete:rows.filter(s=>s.incomplete).length,repeatedFailures:rows.filter(s=>s.repeatedFailureProblemIds.length).length,waitingFeedback:rows.filter(s=>s.waitingFeedback).length};
 return {metrics,timeFilter:{since:since?.toISOString()??null,until:until?.toISOString()??null,basis:'activity-created-at'}, classes, assignments:assignments.map(a=>({id:a.id,title:a.title,classId:a.class_id,dueAt:a.due_at,type:'assignment'})),
  timedPractices:timedPractices.map(p=>({id:p.id,title:p.title,classId:p.class_id,dueAt:p.ends_at,type:'timed'})),
  summary:{participants:rows.length,submittedStudents:submitted.length,gradedStudents:graded.length,pendingStudents:pending.length,
   averageScore:totals.length?round(totals.reduce((n,t)=>n+t.score,0)/totals.length):null,
   averagePercent:totals.length?round(totals.reduce((n,t)=>n+100*t.score/t.max,0)/totals.length):null},
  students:rows, problems:[...problems.values()].map(({valid,totalPercent,...p})=>({...p,averagePercent:valid?round(totalPercent/valid):null,graded:valid})),
  submissions:recent.map(s=>({id:`SUB${s.id}`,identityId:s.identity_id,kind:s.kind,originalSubmissionId:s.original_submission_id?`SUB${s.original_submission_id}`:null,problemId:s.problem_id,studentName:s.student_name,status:s.status,score:s.score===null?null:Number(s.score),createdAt:s.created_at,assignmentId:s.assignment_id,timedPracticeId:s.practice_id})) };
}

function leaderboardNumber(value, name, min, max) {
 if (!/^[1-9]\d{0,4}$/.test(value)) fail(400, 'VALIDATION', `${name}无效`);
 return integer(Number(value), min, max, name);
}

function leaderboardFields(row) {
 return {
  solvedProblems: row?.show_solved_problems ?? true,
  attempts: row?.show_attempts ?? false,
  acRate: row?.show_ac_rate ?? true,
 };
}

async function leaderboardVisibility(pool) {
 const row = (await pool.query('SELECT show_solved_problems,show_attempts,show_ac_rate FROM leaderboard_settings WHERE id=true')).rows[0];
 return leaderboardFields(row);
}

const rankingPolicy = Object.freeze({
 scope:'approved_school_first_ac',
 bonusIncluded:false,
 retroactive:false,
 description:'排名积分只计题目经管理员审核并向全校开放后收到的首次有效 AC；作业与计时训练额外奖励只计入个人总积分。',
});

async function leaderboardContexts(pool, user) {
 const rows = (await pool.query(`SELECT c.id,c.name FROM classes c
  WHERE c.archived_at IS NULL ORDER BY c.name,c.id`)).rows;
 return {items:rows.map(row => ({id:row.id,name:row.name})),visibleFields:await leaderboardVisibility(pool),canManage:administrator(user)};
}

async function updateLeaderboardVisibility(ctx) {
 if (!administrator(ctx.user)) fail(403,'FORBIDDEN','只有管理员可以设置学生端积分榜字段');
 const fields = ctx.body?.visibleFields;
 const keys = ['solvedProblems','attempts','acRate'];
 if (!fields || typeof fields !== 'object' || Array.isArray(fields)
  || Object.keys(fields).length !== keys.length
  || keys.some(key => typeof fields[key] !== 'boolean'))
  fail(400,'VALIDATION','请选择要显示的积分榜字段');
 return transaction(ctx.pool, async db => {
  await db.query(`UPDATE leaderboard_settings SET
   show_solved_problems=$1,show_attempts=$2,show_ac_rate=$3,
   updated_by=$4,updated_at=now() WHERE id=true`,
   [fields.solvedProblems,fields.attempts,fields.acRate,ctx.user.id]);
  await ctx.helpers.audit(db,ctx.user.id,'leaderboard.fields_update','system','leaderboard',{visibleFields:fields});
  return {visibleFields:fields};
 });
}

async function pointsLeaderboard(ctx) {
 const period = enumValue(ctx.url.searchParams.get('period') ?? 'all', ['all', 'month', 'week'], '排行榜时间范围');
 const page = leaderboardNumber(ctx.url.searchParams.get('page') ?? '1', '页码', 1, 10000);
 const pageSize = leaderboardNumber(ctx.url.searchParams.get('pageSize') ?? '10', '每页人数', 1, 50);
 const classFilter = ctx.url.searchParams.get('classId');
 const requestedClassId = classFilter === null ? null : uuid(classFilter,'班级 ID').toLowerCase();
 const contexts = await leaderboardContexts(ctx.pool,ctx.user);
 if (requestedClassId !== null && !contexts.items.some(cls => cls.id === requestedClassId)) fail(404,'NOT_FOUND','班级不存在');
 const meId = ctx.user.roles.includes('student') ? ctx.user.identityId : null;
 const rows = (await ctx.pool.query(`
  WITH bounds AS (
   SELECT CASE $1::text
    WHEN 'week' THEN date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
    WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
    ELSE NULL::timestamptz END since_at
  ), earned AS (
   SELECT l.identity_id, sum(l.points)::int points,
    count(DISTINCT l.problem_id)::int solved_problems
   FROM school_rank_ledger l CROSS JOIN bounds b
   WHERE b.since_at IS NULL OR l.created_at>=b.since_at
   GROUP BY l.identity_id
  ), attempts AS (
   SELECT s.identity_id, count(*)::int attempts,
    count(*) FILTER (WHERE s.status IN ('AC','WA','CE','RE','TLE','MLE','OLE'))::int assessed,
    count(*) FILTER (WHERE s.status='AC')::int accepted
   FROM submissions s
   JOIN problem_versions v ON v.id=s.version_id AND v.problem_id=s.problem_id
   JOIN problems p ON p.id=s.problem_id
   JOIN problem_banks bank ON bank.id=p.bank_id
   CROSS JOIN bounds b
   WHERE s.kind='submit' AND (b.since_at IS NULL OR s.created_at>=b.since_at)
    AND v.published_at IS NOT NULL AND v.rank_approved_at IS NOT NULL
    AND s.created_at>=v.rank_approved_at
    AND (
     (v.rank_review_status='approved' AND v.school_visible_at IS NOT NULL
      AND s.created_at>=v.school_visible_at AND p.archived_at IS NULL
      AND bank.archived_at IS NULL AND bank.visibility='school')
     OR (v.rank_review_status='revoked' AND v.rank_reviewed_at IS NOT NULL
      AND s.created_at<v.rank_reviewed_at)
    )
    AND (s.timed_attempt_id IS NULL OR EXISTS (
     SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id
     WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL))
   GROUP BY s.identity_id
  ), eligible AS (
  SELECT i.id, a.id account_id, COALESCE(NULLIF(btrim(a.nickname),''),'同学') name,
   COALESCE(e.points,0)::int points, COALESCE(e.solved_problems,0)::int solved_problems,
   COALESCE(t.attempts,0)::int attempts,
   COALESCE(t.assessed,0)::int assessed, COALESCE(t.accepted,0)::int accepted
  FROM identities i
  LEFT JOIN earned e ON e.identity_id=i.id
  JOIN accounts a ON a.identity_id=i.id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
  LEFT JOIN attempts t ON t.identity_id=i.id
  WHERE i.kind='student' AND i.archived_at IS NULL
   AND ($5::uuid IS NULL OR EXISTS (
    SELECT 1 FROM class_members cm WHERE cm.identity_id=i.id AND cm.class_id=$5::uuid))
   AND EXISTS (SELECT 1 FROM account_roles ar WHERE ar.account_id=a.id AND ar.role='student')
  ), ranked AS (
   SELECT eligible.*,
    rank() OVER (ORDER BY points DESC)::int rank,
    row_number() OVER (ORDER BY points DESC,id)::int row_num
   FROM eligible
  ), totals AS (
   SELECT count(*)::int total FROM ranked
  ), selected AS (
   SELECT r.*, (r.row_num>(($2::int-1)*$3::int)
    AND r.row_num<=$2::int*$3::int) in_page
   FROM ranked r
   WHERE (r.row_num>(($2::int-1)*$3::int)
    AND r.row_num<=$2::int*$3::int) OR r.id=$4::uuid
  )
  SELECT s.id,s.name,
   a.avatar,s.points,s.solved_problems,s.attempts,s.assessed,s.accepted,s.rank,s.in_page,t.total
  FROM totals t LEFT JOIN selected s ON TRUE
  LEFT JOIN accounts a ON a.id=s.account_id
  ORDER BY s.in_page DESC NULLS LAST,s.points DESC,s.id`, [period,page,pageSize,meId,requestedClassId])).rows;
 const redact = !staff(ctx.user);
 const shape = ({id,name,avatar,points,solved_problems,attempts,assessed,accepted,rank}) => ({
  id,name,avatar:avatarForIdentity(avatar,id),points,rank,
  ...(!redact || contexts.visibleFields.solvedProblems ? {solvedProblems:solved_problems} : {}),
  ...(!redact || contexts.visibleFields.attempts ? {attempts} : {}),
  ...(!redact || contexts.visibleFields.acRate ? {acRate:assessed ? Math.round(accepted * 1000 / assessed) / 10 : null} : {}),
 });
 const own = meId ? rows.find(row => row.id === meId) : null;
 return {
  items: rows.filter(row => row.in_page).map(shape),
  total: rows[0]?.total ?? 0, page, pageSize,
  me: own ? shape(own) : null,
  classId:requestedClassId,visibleFields:contexts.visibleFields,rankingPolicy,
 };
}

export async function handleEducation(ctx) {
 const { pool, user, route, method, body, helpers } = ctx;
 if(route==='/points/me'&&method==='GET'){
  if(!user.roles.includes('student'))fail(403,'FORBIDDEN','积分仅适用于学生');
  const totals=(await pool.query(`SELECT
   (SELECT COALESCE(sum(points),0)::int FROM point_ledger WHERE identity_id=$1) points,
   (SELECT COALESCE(sum(points),0)::int FROM school_rank_ledger WHERE identity_id=$1) rank_points`,[user.identityId])).rows[0];
  return result({points:totals.points,rankPoints:totals.rank_points,rankingPolicy});
 }
 if(route==='/points/leaderboard/contexts'&&method==='GET')return result(await leaderboardContexts(pool,user));
 if(route==='/points/leaderboard/settings'&&method==='GET')return result({visibleFields:await leaderboardVisibility(pool)});
 if(route==='/points/leaderboard/settings'&&method==='PATCH')return result(await updateLeaderboardVisibility(ctx));
 if(route==='/points/leaderboard'&&method==='GET')return result(await pointsLeaderboard(ctx));
 if(route==='/points/rewards'&&method==='GET'){requireStaff(user);const items=(await pool.query('SELECT r.problem_id,r.assignment_id,r.points FROM point_rewards r JOIN problems p ON p.id=r.problem_id LEFT JOIN assignments a ON a.id=r.assignment_id WHERE ($1::boolean OR (r.assignment_id IS NULL AND p.owner_account_id=$2) OR a.owner_account_id=$2)',[administrator(user),user.id])).rows;return result({items:items.map(r=>({problemId:r.problem_id,assignmentId:r.assignment_id,points:r.points}))});}
 if(route==='/points/rewards'&&method==='POST'){
 requireStaff(user);const problemId=uuid(body.problemId),assignmentId=body.assignmentId?uuid(body.assignmentId):null;
 // Assignment rewards belong to the revisioned assignment editor. A second
 // write path could change rewards after submissions or bypass its row lock.
 if(assignmentId)fail(409,'ASSIGNMENT_REWARD_EDITOR','请在作业的题目列表中设置额外积分');
 if(!administrator(user))fail(403,'FORBIDDEN','教师只能配置作业任务奖励');
 const points=integer(body.points,0,30,'授予积分');
 await transaction(pool,async db=>{const access=await helpers.versionAccess(db,user,problemId);if(!access.owner)fail(403,'FORBIDDEN','只能设置可维护题目的积分');
 await db.query("INSERT INTO point_rewards(problem_id,assignment_id,points,updated_by) VALUES($1,NULL,$2,$3) ON CONFLICT(problem_id,COALESCE(assignment_id,'00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET points=EXCLUDED.points,updated_by=EXCLUDED.updated_by,updated_at=now()",[problemId,points,user.id]);await helpers.audit(db,user.id,'points.reward_set','problem',problemId,{points});});return result({ok:true});}
 const resourceMatch=route.match(/^\/learning-resources(?:\/([^/]+))?$/);
 if(resourceMatch){
  const shape=r=>({id:r.id,type:r.type,title:r.title,content:r.content,pathId:r.path_id,chapterId:r.chapter_id,scope:r.scope,createdAt:r.created_at,updatedAt:r.updated_at,canEdit:administrator(user)||r.owner_account_id===user.id});
  if(method==='GET'&&!resourceMatch[1]){const rows=(await pool.query("SELECT r.* FROM learning_resources r WHERE r.archived_at IS NULL AND ($1 OR r.owner_account_id=$2 OR r.scope='school' AND (r.path_id IS NULL OR EXISTS(SELECT 1 FROM learning_paths p WHERE p.id=r.path_id AND p.published_at IS NOT NULL AND p.archived_at IS NULL))) ORDER BY r.updated_at DESC",[administrator(user),user.id])).rows;return result({items:rows.map(shape)});}
  requireStaff(user);if(!['POST','PATCH','DELETE'].includes(method))return null;
  const output=await transaction(pool,async db=>{const old=resourceMatch[1]?exists(await db.query('SELECT * FROM learning_resources WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[uuid(resourceMatch[1])])):null;if(old&&!administrator(user)&&old.owner_account_id!==user.id)fail(403,'FORBIDDEN','只能编辑本人资料');if(method==='DELETE'){if(!old)fail(404,'NOT_FOUND','资料不存在');await db.query('UPDATE learning_resources SET archived_at=now() WHERE id=$1',[old.id]);await helpers.audit(db,user.id,'learning.resource_archive','learning_resource',old.id);return {ok:true};}
   const title=body.title===undefined?old?.title:field(body.title,'资料标题'),content=body.content===undefined?old?.content??'':bytes(body.content,'资料内容'),type=enumValue(body.type??old?.type??'note',['reading','video','reference','note','article','link'],'资料类型'),scope=enumValue(body.scope??old?.scope??'school',['school','private'],'资料范围'),pathId=body.pathId===undefined?old?.path_id??null:body.pathId?uuid(body.pathId):null,chapterId=body.chapterId===undefined?old?.chapter_id??null:body.chapterId?uuid(body.chapterId):null;if(!title)fail(400,'VALIDATION','需要资料标题');if(pathId)await pathAccess(db,user,pathId,true);if(chapterId){const {chapter}=await chapterAccess(ctx,db,chapterId,true);if(chapter.path_id!==pathId)fail(400,'VALIDATION','章节必须属于所选路径');}if(scope==='school'&&pathId){const path=await pathAccess(db,user,pathId,true);if(!path.published_at)fail(409,'INCOMPLETE','公开资料只能关联已发布路径');}
   const r=old?exists(await db.query('UPDATE learning_resources SET type=$1,title=$2,content=$3,path_id=$4,chapter_id=$5,scope=$6,updated_at=now() WHERE id=$7 RETURNING *',[type,title,content,pathId,chapterId,scope,old.id])):exists(await db.query('INSERT INTO learning_resources(owner_account_id,type,title,content,path_id,chapter_id,scope) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[user.id,type,title,content,pathId,chapterId,scope]));await helpers.audit(db,user.id,old?'learning.resource_edit':'learning.resource_create','learning_resource',r.id);return shape(r);});return result(output,method==='POST'?201:200);
 }

 if (route === '/reports' || route === '/reports/export') {
  if (method !== 'GET') return null;
  const report = await teachingReport(ctx);
  await helpers.audit(pool,user.id,'report.read','report',ctx.url.searchParams.toString() || 'all');
  if (route === '/reports') return result(report);
  const safe = value => typeof value === 'string' && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  const rows = report.students.flatMap(s=>s.assignments.map(a=>[s.identityId,s.name,a.title,a.pending?'待评测':a.score,a.maxScore,a.pending?'pending':'valid'].map(safe)));
  return result({ columns:['Identity ID','Student','Assignment','Score','Maximum','State'], rows });
 }
 if (route === '/learning-paths' && method === 'GET') {
  const archived=ctx.url.searchParams.get('archived')==='true';
  if(archived)requireStaff(user);
  const paths = (await pool.query(`SELECT p.*,(SELECT count(*) FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL) chapter_count,
   (SELECT count(*) FROM learning_progress pr JOIN learning_chapters c ON c.id=pr.chapter_id WHERE c.path_id=p.id AND c.archived_at IS NULL AND pr.identity_id=$2 AND pr.completed) completed_chapters
   FROM learning_paths p WHERE (p.archived_at IS NOT NULL)=$5 AND (NOT $5 AND p.published_at IS NOT NULL OR ($3::boolean AND (p.owner_account_id=$1 OR $4::boolean))) ORDER BY p.updated_at DESC,p.id`, [user.id,user.identityId,staff(user),administrator(user),archived])).rows;
  const stats=await taskStats(pool,user,paths.map(p=>p.id),paths.filter(p=>!p.published_at).map(p=>p.id));
  return result({ items:paths.map(p=>({...pathShape({...p,...stats.get(p.id),canEdit:staff(user)&&(administrator(user)||p.owner_account_id===user.id)}),archived:!!p.archived_at})) });
 }
 if (route === '/learning-paths/import' && method === 'POST') {
  requireStaff(user);const doc=validateLearningDocument(body);
  const path=await transaction(pool,async db=>{
   const p=exists(await db.query('INSERT INTO learning_paths(owner_account_id,title,description,category,estimated_minutes,difficulty,cover_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[user.id,doc.title,doc.description,doc.category,doc.estimatedMinutes,doc.difficulty,doc.coverKey]));
   for(let position=0;position<doc.chapters.length;position++){
    const c=doc.chapters[position];const chapter=exists(await db.query('INSERT INTO learning_chapters(path_id,title,content,position,objective,checkpoint,checkpoint_answer) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[p.id,c.title,c.content,position,c.objective,c.checkpoint,c.checkpointAnswer]));
    await setLinks(ctx,db,p,chapter.id,c.problemIds);
   }
   await helpers.audit(db,user.id,'learning.import','learning_path',p.id,{chapterCount:doc.chapters.length});return p;
  });return result(pathShape({...path,chapter_count:doc.chapters.length,canEdit:true}),201);
 }
 if (route === '/learning-paths' && method === 'POST') {
  requireStaff(user);
  const title=field(body.title,'学习路径标题'),description=field(body.description??'','描述',{min:0,max:4000}),category=field(body.category??'Python','分类',{max:100});
  const path = await transaction(pool,async db=>{
   const p=exists(await db.query('INSERT INTO learning_paths(owner_account_id,title,description,category,estimated_minutes,difficulty,cover_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[user.id,title,description,category,integer(body.estimatedMinutes??30,1,10080,'预计学习时长'),enumValue(body.difficulty??'beginner',['beginner','intermediate','advanced'],'难度'),enumValue(body.coverKey??'general',['python','algorithms','general'],'封面')]));
   await helpers.audit(db,user.id,'learning.create','learning_path',p.id); return p;
  });
  return result(pathShape({...path,canEdit:true}),201);
 }
 let courseMatch=route.match(/^\/learning-paths\/([^/]+)\/python-exercises(\/publish)?$/);
 if(courseMatch&&method==='POST'){
  requireStaff(user);const id=uuid(courseMatch[1]);
  await transaction(pool,async db=>{
   const path=await pathAccess(db,user,id,true,true);
   let bundle=Array.isArray(path.practice_bundle)?path.practice_bundle:[];
   if(courseMatch[2]){
    if(!bundle.length)fail(409,'INCOMPLETE','请先生成配套练习');
    const versions=(await db.query('SELECT id,problem_id,validation_status,published_at FROM problem_versions WHERE id=ANY($1::uuid[]) FOR UPDATE',[bundle.map(x=>x.versionId)])).rows;
    if(versions.length!==bundle.length||versions.some(v=>v.validation_status!=='AC'))fail(409,'NOT_VALIDATED','全部参考答案须经真实判题通过后才能发布配套练习');
    for(const v of versions){await db.query('UPDATE problem_versions SET published_at=COALESCE(published_at,now()) WHERE id=$1',[v.id]);await db.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[v.id,v.problem_id]);}
    const live=(await db.query('SELECT id FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL',[id])).rows;
    for(const item of bundle){if(!live.some(c=>c.id===item.chapterId))fail(409,'CONFLICT','配套章节已移除，请恢复章节或手动整理题库引用');if(!path.published_at){const old=(await db.query('SELECT problem_id FROM chapter_problems WHERE chapter_id=$1 ORDER BY position',[item.chapterId])).rows;await setLinks(ctx,db,path,item.chapterId,[...old.map(x=>x.problem_id),item.problemId]);}}
    await helpers.audit(db,user.id,'learning.practice_publish','learning_path',id,{count:bundle.length});
   }else if(bundle.length && body.document!==undefined){
    fail(409,'CONFLICT','此课程已有配套题目，请在题库编辑现有练习，避免重复导入');
   }else if(!bundle.length){
    const document=body.document;
    if(document!==undefined && (!document || document.format!=='codemaster-python-practice' || document.version!==1 || !Array.isArray(document.problems) || document.problems.length!==20 || Buffer.byteLength(JSON.stringify(document))>1048576))fail(400,'VALIDATION','配套题目包须为 codemaster-python-practice v1，包含 20 道题且不超过 1 MB');
    const exercises=document?.problems??pythonPractice;
    if(exercises.some((p,i)=>!p || p.chapterTitle!==pythonPractice[i].chapterTitle || p.mode!=='stdio' || p.referenceLanguage!=='python'))fail(400,'VALIDATION','题目包须按原始 Python 20 章顺序提供标准输入输出练习');
    const chapters=(await db.query('SELECT id,title FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL ORDER BY position,created_at,id',[id])).rows;
    if(chapters.length!==pythonPractice.length||chapters.some((c,i)=>c.title!==pythonPractice[i].chapterTitle))fail(409,'COURSE_MISMATCH','此套练习对应完整 Python 示例的 20 个原始章节，请先导入完整资料');
    const bank=exists(await db.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES($1,$2,'school') RETURNING *",[path.title+' · 配套练习',user.id]));
    for(let i=0;i<pythonPractice.length;i++){const exercise=exercises[i];const input=helpers.problemInput({...exercise,bankId:bank.id});const problem=exists(await db.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[user.id,bank.id]));const v=await helpers.insertVersion(db,user,problem.id,input);bundle.push({chapterId:chapters[i].id,problemId:problem.id,versionId:v.id,title:exercise.title,bankId:bank.id});}
    await db.query('UPDATE learning_paths SET practice_bundle=$1::jsonb,updated_at=now() WHERE id=$2',[JSON.stringify(bundle),id]);await helpers.audit(db,user.id,'learning.practice_create','learning_path',id,{count:bundle.length});
   }
  });return result(await pathResult(ctx,id));
 }
 courseMatch=route.match(/^\/learning-paths\/([^/]+)\/progress$/);
 if(courseMatch&&method==='GET'){
  requireStaff(user);const path=await pathAccess(pool,user,courseMatch[1],true);
  const counts=await taskStats(pool,user,[path.id],path.published_at?[]:[path.id]);
  const chapterCount=(await pool.query('SELECT count(*)::int n FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL',[path.id])).rows[0].n;
  const students=(await pool.query(`SELECT i.id,i.name,i.number,
   (SELECT count(*)::int FROM learning_progress pr JOIN learning_chapters c ON c.id=pr.chapter_id WHERE c.path_id=$1 AND c.archived_at IS NULL AND pr.identity_id=i.id AND pr.completed) completed_chapters,
   (SELECT count(DISTINCT cp.version_id)::int FROM chapter_problems cp JOIN learning_chapters c ON c.id=cp.chapter_id JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id JOIN problem_versions v ON v.id=cp.version_id WHERE c.path_id=$1 AND c.archived_at IS NULL AND p.archived_at IS NULL AND b.archived_at IS NULL AND b.visibility='school' AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL AND EXISTS(SELECT 1 FROM submissions s WHERE s.identity_id=i.id AND s.version_id=cp.version_id AND s.kind IN ('submit','correction') AND s.status='AC' AND (s.timed_attempt_id IS NULL OR EXISTS(SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL)))) completed_tasks
   FROM identities i WHERE i.kind='student' AND i.archived_at IS NULL AND ($2::boolean OR EXISTS(SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes cl ON cl.id=cm.class_id WHERE cm.identity_id=i.id AND tc.account_id=$3 AND cl.archived_at IS NULL)) ORDER BY i.number,i.id`,[path.id,administrator(user),user.id])).rows;
  return result({chapterCount,taskCount:counts.get(path.id)?.task_count??0,items:students.map(s=>({id:s.id,name:s.name,number:s.number,completedChapters:Number(s.completed_chapters),completedTasks:Number(s.completed_tasks)}))});
 }
 let match=route.match(/^\/learning-paths\/([^/]+)$/);
 if (match && method === 'GET') return result(await pathResult(ctx,match[1],pool,true));
 const restoreMatch=route.match(/^\/learning-paths\/([^/]+)\/restore$/);
 if(restoreMatch&&method==='POST'){
  requireStaff(user);const id=uuid(restoreMatch[1]);
  await transaction(pool,async db=>{
   const path=exists(await db.query('SELECT id,owner_account_id,archived_at,published_at FROM learning_paths WHERE id=$1 FOR UPDATE',[id]));
   if(!administrator(user)&&path.owner_account_id!==user.id)fail(403,'FORBIDDEN','只能恢复本人课程');
   if(!path.archived_at)return;
   if(path.published_at){
    const links=(await db.query(`SELECT cp.problem_id,v.problem_id version_problem_id,
      p.archived_at problem_archived_at,b.archived_at bank_archived_at,b.visibility bank_visibility,
      v.published_at,v.school_visible_at,v.rank_review_status
      FROM chapter_problems cp JOIN learning_chapters c ON c.id=cp.chapter_id
      JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id
      JOIN problem_versions v ON v.id=cp.version_id
      WHERE c.path_id=$1 AND c.archived_at IS NULL FOR SHARE OF p,b,v`,[id])).rows;
    if(links.some(link=>link.problem_id!==link.version_problem_id||link.problem_archived_at||link.bank_archived_at||link.bank_visibility!=='school'||!link.published_at||!link.school_visible_at||link.rank_review_status!=='approved'))
     fail(409,'UNAPPROVED_LESSON_PROBLEM','课程存在未通过审核的关联题目，无法恢复公开课程');
   }
   await db.query('UPDATE learning_paths SET archived_at=NULL,updated_at=clock_timestamp() WHERE id=$1',[id]);
   await helpers.audit(db,user.id,'learning.restore','learning_path',id);
  });return result(await pathResult(ctx,id));
 }
 if (match && method === 'PATCH') {
  requireStaff(user);
  const p=await transaction(pool,async db=>{
   const path=await pathAccess(db,user,match[1],true,true);
   const title=body.title===undefined?path.title:field(body.title,'标题');
   const description=body.description===undefined?path.description:field(body.description,'描述',{min:0,max:4000});
   const category=body.category===undefined?path.category:field(body.category,'分类',{max:100});
   if (body.archived!==undefined && typeof body.archived!=='boolean') fail(400,'VALIDATION','归档状态无效');
   if(body.archived===true){
    const active=(await db.query(`SELECT 1 FROM assignments WHERE course_path_id=$1 AND archived_at IS NULL
      AND state='Published' AND due_at>clock_timestamp() LIMIT 1`,[path.id])).rowCount;
    if(active)fail(409,'COURSE_HAS_ACTIVE_ASSIGNMENTS','课程仍关联进行中的作业，请先等待作业截止并归档，或保留课程');
   }
   const p=exists(await db.query('UPDATE learning_paths SET title=$1,description=$2,category=$3,archived_at=CASE WHEN $4 THEN now() ELSE archived_at END,updated_at=now(),estimated_minutes=$6,difficulty=$7,cover_key=$8 WHERE id=$5 RETURNING *',[title,description,category,body.archived===true,path.id,body.estimatedMinutes===undefined?path.estimated_minutes:integer(body.estimatedMinutes,1,10080,'预计学习时长'),enumValue(body.difficulty??path.difficulty,['beginner','intermediate','advanced'],'难度'),enumValue(body.coverKey??path.cover_key,['python','algorithms','general'],'封面')]));
   await helpers.audit(db,user.id,body.archived?'learning.archive':'learning.edit','learning_path',path.id);return p;
  });
  return result(pathShape({...p,canEdit:true}));
 }
 match=route.match(/^\/learning-paths\/([^/]+)\/publish$/);
 if (match && method === 'POST') {
  requireStaff(user);
  await transaction(pool,async db=>{
   const path=await pathAccess(db,user,match[1],true,true);
   const chapters=(await db.query('SELECT * FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL',[path.id])).rows;
   if (!chapters.length||chapters.some(c=>!c.content.trim())) fail(409,'INCOMPLETE','发布前需要至少一个有正文的章节');
   // Hold the bank, problem and version rows through publication so an
   // administrator cannot revoke public approval between check and commit.
   const linked=(await db.query(`SELECT cp.problem_id,p.archived_at problem_archived_at,b.visibility bank_visibility,b.archived_at bank_archived_at,
    v.problem_id version_problem_id,v.published_at,v.school_visible_at,v.rank_review_status
    FROM chapter_problems cp JOIN learning_chapters c ON c.id=cp.chapter_id
    JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id
    JOIN problem_versions v ON v.id=cp.version_id
    WHERE c.path_id=$1 AND c.archived_at IS NULL FOR SHARE OF p,b,v`,[path.id])).rows;
   if(linked.some(link=>link.problem_archived_at||link.bank_archived_at||link.bank_visibility!=='school'||link.version_problem_id!==link.problem_id||!link.published_at||!link.school_visible_at||link.rank_review_status!=='approved'))
    fail(409,'UNAPPROVED_LESSON_PROBLEM','章节练习须先发布并通过管理员校内公开审核，课程才能发布');
   await db.query('UPDATE learning_paths SET published_at=COALESCE(published_at,now()),updated_at=now() WHERE id=$1',[path.id]);
   await helpers.audit(db,user.id,'learning.publish','learning_path',path.id);
  });
  return result(await pathResult(ctx,match[1]));
 }
 match=route.match(/^\/learning-paths\/([^/]+)\/chapters$/);
 if (match && method === 'POST') {
  requireStaff(user);
  const title=field(body.title,'章节标题'),content=bytes(body.content??'','章节正文');
  const chapter=await transaction(pool,async db=>{
   const path=await pathAccess(db,user,match[1],true,true);
   if(path.published_at&&!content.trim())fail(409,'INCOMPLETE','已发布路径新增章节必须有正文');
   const c=exists(await db.query('INSERT INTO learning_chapters(path_id,title,content,position,objective,checkpoint,checkpoint_answer) VALUES($1,$2,$3,(SELECT COALESCE(max(position),-1)+1 FROM learning_chapters WHERE path_id=$1),$4,$5,$6) RETURNING *',[path.id,title,content,field(body.objective??'','学习目标',{min:0,max:4000}),field(body.checkpoint??'','检查点',{min:0,max:10000}),field(body.checkpointAnswer??'','检查点答案',{min:0,max:10000})]));
   await setLinks(ctx,db,path,c.id,body.problemIds??[]);
   await db.query('UPDATE learning_paths SET updated_at=now() WHERE id=$1',[path.id]);
   await helpers.audit(db,user.id,'learning.chapter_create','learning_chapter',c.id);return c;
  });
  return result({id:chapter.id,pathId:chapter.path_id,title:chapter.title,content:chapter.content,position:chapter.position,objective:chapter.objective,checkpoint:chapter.checkpoint,checkpointAnswer:chapter.checkpoint_answer,completed:false},201);
 }
 match=route.match(/^\/chapters\/([^/]+)$/);
 if (match && ['PATCH','DELETE'].includes(method)) {
  requireStaff(user);
  const c=await transaction(pool,async db=>{
   const {chapter,path}=await chapterAccess(ctx,db,match[1],true);
   if (method==='DELETE') {
    const remaining=(await db.query('SELECT count(*)::int n FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL AND id<>$2',[path.id,chapter.id])).rows[0].n;
    if (path.published_at&&!remaining) fail(409,'INCOMPLETE','已发布路径须保留至少一个章节；可以归档整个路径');
    await db.query('UPDATE learning_chapters SET archived_at=now(),updated_at=now() WHERE id=$1',[chapter.id]);
   } else {
    const title=body.title===undefined?chapter.title:field(body.title,'章节标题');
    const content=body.content===undefined?chapter.content:bytes(body.content,'章节正文');
    if (path.published_at&&!content.trim()) fail(409,'INCOMPLETE','已发布章节正文不能为空');
    const position=body.position===undefined?chapter.position:integer(body.position,0,10000,'章节顺序');
    if(position<chapter.position)await db.query('UPDATE learning_chapters SET position=position+1 WHERE path_id=$1 AND archived_at IS NULL AND id<>$2 AND position >= $3 AND position < $4',[path.id,chapter.id,position,chapter.position]);
    if(position>chapter.position)await db.query('UPDATE learning_chapters SET position=position-1 WHERE path_id=$1 AND archived_at IS NULL AND id<>$2 AND position > $3 AND position <= $4',[path.id,chapter.id,chapter.position,position]);
    await db.query('UPDATE learning_chapters SET title=$1,content=$2,position=$3,updated_at=now(),objective=$5,checkpoint=$6,checkpoint_answer=$7 WHERE id=$4',[title,content,position,chapter.id,body.objective===undefined?chapter.objective:field(body.objective,'学习目标',{min:0,max:4000}),body.checkpoint===undefined?chapter.checkpoint:field(body.checkpoint,'检查点',{min:0,max:10000}),body.checkpointAnswer===undefined?chapter.checkpoint_answer:field(body.checkpointAnswer,'检查点答案',{min:0,max:10000})]);
    if (body.problemIds!==undefined) await setLinks(ctx,db,path,chapter.id,body.problemIds);
   }
   await db.query('UPDATE learning_paths SET updated_at=now() WHERE id=$1',[path.id]);
   await helpers.audit(db,user.id,method==='DELETE'?'learning.chapter_archive':'learning.chapter_edit','learning_chapter',chapter.id);
   return chapter;
  });
  return result({ok:true,id:c.id,pathId:c.path_id});
 }
 match=route.match(/^\/chapters\/([^/]+)\/progress$/);
 if (match && method==='POST') {
  if (!user.roles.includes('student')) fail(403,'FORBIDDEN','学习进度属于学生账号');
  if (typeof body.completed!=='boolean') fail(400,'VALIDATION','完成状态须为布尔值');
  await transaction(pool,async db=>{
   const {chapter,path}=await chapterAccess(ctx,db,match[1]);
   if (!path.published_at) fail(409,'NOT_PUBLISHED','教师预览不会写入真实学习进度');
   await db.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,$3) ON CONFLICT(identity_id,chapter_id) DO UPDATE SET completed=EXCLUDED.completed,updated_at=now()',[user.identityId,chapter.id,body.completed]);
  });
  return result({id:match[1],completed:body.completed});
 }
 return null;
}
