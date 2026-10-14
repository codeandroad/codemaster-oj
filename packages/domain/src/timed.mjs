import { transaction } from './db.mjs';
import { fail, field, uuid, integer } from './security.mjs';

const isAdmin = (user) => user.roles.includes('admin');
const isStaff = (user) => isAdmin(user) || user.roles.includes('teacher');
const row = (result, message = '计时训练不存在') => { if (!result.rowCount) fail(404, 'NOT_FOUND', message); return result.rows[0]; };
const staff = (user) => { if (!isStaff(user)) fail(403, 'FORBIDDEN', '需要教师权限'); };
const date = (value, name) => { const parsed = new Date(value); if (typeof value !== 'string' || !Number.isFinite(parsed.getTime())) fail(400, 'VALIDATION', `${name}无效`); return parsed; };
const now = async (db) => row(await db.query('SELECT clock_timestamp() AS time')).time;
const audit = (db, user, action, id, metadata = {}) => db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)', [user.id, action, 'timed_practice', id, metadata]);
const BONUS_FIELDS = [
  ['rewardPoints', 'reward_points', '固定奖励积分'],
  ['speedBonusPoints', 'speed_bonus_points', '用时奖励上限'],
  ['attemptBonusPoints', 'attempt_bonus_points', '尝试奖励上限']
];
function rewardCaps(entry, previous = {}) {
  return Object.fromEntries(BONUS_FIELDS.map(([api, column, label]) =>
    [api, integer(entry[api] ?? entry[column] ?? previous[api] ?? previous[column] ?? 0, 0, 20, label)]));
}
function rewardBudget(problems) {
  const budget = problems.reduce((total, problem) => total + problem.rewardPoints + problem.speedBonusPoints + problem.attemptBonusPoints, 0);
  if (budget > 100) fail(400, 'REWARD_BUDGET', '每场训练的额外奖励上限总和最多 100 分');
}
function rewardForSubmission(problem, practice, submission, startedAt, formalAttempts) {
  if (submission?.status !== 'AC' || !Number.isInteger(formalAttempts) || formalAttempts < 1 || !startedAt) {
    return { rewardPoints: 0, speedBonusPointsEarned: 0, attemptBonusPointsEarned: 0,
      totalRewardPoints: 0, elapsedSeconds: null, formalAttempts };
  }
  const elapsedSeconds = Math.max(0, Math.ceil((new Date(submission.created_at).getTime() - new Date(startedAt).getTime()) / 1000));
  const durationSeconds = practice.duration_minutes * 60;
  const rewardPoints = Number(problem.reward_points);
  const speedBonusPointsEarned = Math.floor(Number(problem.speed_bonus_points) * Math.max(0, (durationSeconds - elapsedSeconds) / durationSeconds));
  const attemptBonusPointsEarned = Math.floor(Number(problem.attempt_bonus_points) / formalAttempts);
  return { rewardPoints, speedBonusPointsEarned, attemptBonusPointsEarned,
    totalRewardPoints: rewardPoints + speedBonusPointsEarned + attemptBonusPointsEarned,
    elapsedSeconds, formalAttempts };
}

async function settleTimedRewards(db, practice, grades) {
  for (const grade of grades) for (const problem of grade.problems) {
    if (problem.status !== 'AC' || !problem.submissionId || problem.totalRewardPoints <= 0) continue;
    await db.query(`INSERT INTO point_ledger(identity_id,problem_id,submission_id,timed_practice_id,reason,points)
      VALUES($1,$2,$3,$4,'timed',$5) ON CONFLICT DO NOTHING`,
    [grade.identityId, problem.problemId, problem.submissionId.slice(3), practice.id, problem.totalRewardPoints]);
  }
}

function practiceStatus(practice, serverNow) {
  if (practice.state !== 'Published') return practice.state;
  if (practice.forced_ended_at || serverNow >= practice.ends_at) return 'Ended';
  if (serverNow >= practice.starts_at) return 'Running';
  return 'Published';
}
function attemptShape(attempt, serverNow) {
  if (!attempt) return null;
  return { id: attempt.id, status: attempt.state === 'Finished' || serverNow > attempt.deadline_at ? 'Finished' : 'Active',
    startedAt: attempt.started_at, deadlineAt: attempt.deadline_at, finishedAt: attempt.finished_at, serverNow };
}
async function classAccess(db, user, classId) {
  const cls = row(await db.query('SELECT * FROM classes WHERE id=$1 AND archived_at IS NULL', [uuid(classId, '班级 ID')]), '班级不存在');
  if (!isAdmin(user) && !(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2', [classId, user.id])).rowCount) fail(403, 'FORBIDDEN', '无权管理该班级的计时训练');
  return cls;
}
async function canManagePractice(db, user, practice) {
  return isAdmin(user) || user.roles.includes('teacher') && !!(await db.query('SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id WHERE tc.class_id=$1 AND tc.account_id=$2 AND c.archived_at IS NULL', [practice.class_id, user.id])).rowCount;
}
async function practiceAccess(db, user, id, { lock = false, share = false } = {}) {
  const practice = row(await db.query(`SELECT * FROM timed_practices WHERE id=$1${lock ? ' FOR UPDATE' : share ? ' FOR SHARE' : ''}`, [uuid(id, '计时训练 ID')]));
  const canManage = await canManagePractice(db, user, practice);
  const isParticipant = user.roles.includes('student') && !!(await db.query('SELECT 1 FROM timed_practice_participants WHERE practice_id=$1 AND identity_id=$2 AND NOT exempt', [id, user.identityId])).rowCount;
  if (!canManage && practice.state === 'Draft') fail(404, 'NOT_FOUND', '计时训练不存在');
  if (!canManage && !isParticipant) fail(403, 'FORBIDDEN', '未分配该计时训练');
  return { ...practice, canManage, isParticipant };
}

async function calculateGrades(db, practice) {
  const grades = await db.query(`SELECT part.identity_id,i.name,ap.problem_id,ap.points,
      ap.reward_points,ap.speed_bonus_points,ap.attempt_bonus_points,
      attempt.started_at,s.id submission_id,s.score,s.status,s.created_at,
      COALESCE(tries.formal_attempts,0)::int formal_attempts
    FROM timed_practice_participants part JOIN identities i ON i.id=part.identity_id
    JOIN timed_practice_problems ap ON ap.practice_id=part.practice_id
    LEFT JOIN timed_attempts attempt ON attempt.practice_id=part.practice_id AND attempt.identity_id=part.identity_id
    LEFT JOIN LATERAL (SELECT id,score,status,created_at FROM submissions
      WHERE timed_attempt_id=attempt.id AND problem_id=ap.problem_id AND kind='submit'
        AND created_at>=attempt.started_at
        AND created_at<=LEAST(attempt.deadline_at,COALESCE(attempt.finished_at,attempt.deadline_at))
      ORDER BY created_at DESC,id DESC LIMIT 1) s ON true
    LEFT JOIN LATERAL (SELECT count(*) formal_attempts FROM submissions sub
      WHERE sub.timed_attempt_id=attempt.id AND sub.problem_id=ap.problem_id AND sub.kind='submit'
        AND sub.created_at>=attempt.started_at AND sub.created_at<=s.created_at) tries ON true
    WHERE part.practice_id=$1 AND NOT part.exempt ORDER BY i.name,part.identity_id,ap.position`, [practice.id]);
  const byStudent = new Map();
  for (const grade of grades.rows) {
    let student = byStudent.get(grade.identity_id);
    if (!student) { student = { identityId: grade.identity_id, name: grade.name, score: 0, maxScore: 0, pending: false, problems: [] }; byStudent.set(grade.identity_id, student); }
    const pending = !!grade.submission_id && (['Waiting', 'Judging', 'System Error'].includes(grade.status) || grade.score === null);
    const score = pending ? null : grade.submission_id ? Number(grade.score) : 0;
    student.maxScore += Number(grade.points); student.pending ||= pending;
    if (score !== null) student.score += score * Number(grade.points) / 100;
    const reward = rewardForSubmission(grade, practice,
      grade.submission_id ? { status: grade.status, created_at: grade.created_at } : null,
      grade.started_at, grade.submission_id ? Number(grade.formal_attempts) : 0);
    student.problems.push({ problemId: grade.problem_id, submissionId: grade.submission_id ? `SUB${grade.submission_id}` : null,
      score, status: grade.status ?? 'NotSubmitted', ...reward });
  }
  return [...byStudent.values()].map((grade) => ({ ...grade, score: grade.pending ? null : Math.round(grade.score * 100) / 100 }));
}

async function results(db, practice) {
  if (!practice.results_published_at) return calculateGrades(db, practice);
  if (practice.current_result_revision_id) return row(await db.query('SELECT grades FROM timed_result_revisions WHERE id=$1', [practice.current_result_revision_id])).grades;
  return (await db.query('SELECT grade FROM timed_result_snapshots WHERE practice_id=$1 ORDER BY identity_id', [practice.id])).rows.map((entry) => entry.grade);
}

async function practiceResult(db, user, id) {
  const practice = await practiceAccess(db, user, id);
  const serverNow = await now(db);
  const problems = (await db.query(`SELECT ap.problem_id,ap.version_id,ap.points,v.title,
    ap.reward_points,ap.speed_bonus_points,ap.attempt_bonus_points,
    COALESCE(global_reward.points,10) first_ac_points
    FROM timed_practice_problems ap JOIN problem_versions v ON v.id=ap.version_id
    LEFT JOIN point_rewards global_reward ON global_reward.problem_id=ap.problem_id AND global_reward.assignment_id IS NULL
    WHERE ap.practice_id=$1 ORDER BY ap.position`, [id])).rows;
  const attempt = (await db.query('SELECT * FROM timed_attempts WHERE practice_id=$1 AND identity_id=$2', [id, user.identityId])).rows[0];
  const result = { id: practice.id, title: practice.title,description:practice.description,className:(await db.query('SELECT name FROM classes WHERE id=$1',[practice.class_id])).rows[0]?.name,createdAt:practice.created_at, classId: practice.class_id, startsAt: practice.starts_at, endsAt: practice.ends_at,
    durationMinutes: practice.duration_minutes, status: practiceStatus(practice, serverNow), showVerdict: practice.show_verdict,
    resultsPublished: !!practice.results_published_at, forcedEndedAt: practice.forced_ended_at, serverNow, preview: practice.canManage, attempt: practice.canManage ? null : attemptShape(attempt, serverNow),
    problems: problems.map((p) => ({ problemId: p.problem_id, versionId: p.version_id, title: p.title, points: Number(p.points),
      firstAcPoints: Number(p.first_ac_points), rewardPoints: Number(p.reward_points),
      speedBonusPoints: Number(p.speed_bonus_points), attemptBonusPoints: Number(p.attempt_bonus_points) })) };
  if (practice.current_result_revision_id) result.resultsRevision = row(await db.query('SELECT revision FROM timed_result_revisions WHERE id=$1', [practice.current_result_revision_id])).revision;
  if (practice.canManage) {
    result.participants = (await db.query('SELECT part.identity_id,part.exempt,i.name,i.number,a.id attempt_id,a.state,a.started_at,a.deadline_at,a.finished_at FROM timed_practice_participants part JOIN identities i ON i.id=part.identity_id LEFT JOIN timed_attempts a ON a.practice_id=part.practice_id AND a.identity_id=part.identity_id WHERE part.practice_id=$1 ORDER BY i.name,part.identity_id', [id])).rows.map((entry) => ({ identityId: entry.identity_id, name: entry.name, number: entry.number, exempt: entry.exempt, attempt: attemptShape(entry.attempt_id ? { ...entry, id: entry.attempt_id } : null, serverNow) }));
    result.grades = await results(db, practice);
  } else if (practice.results_published_at) {
    result.grade = (await results(db, practice)).find((grade) => grade.identityId === user.identityId) ?? null;
  }
  return result;
}

export async function prepareTimedSubmission(db, user, body, version) {
  if (!body.timedPracticeId) return null;
  if (body.assignmentId || body.originalSubmissionId || body.kind === 'correction') fail(400, 'VALIDATION', '计时训练不能与作业或订正上下文混用');
  const practice = await practiceAccess(db, user, body.timedPracticeId, { share: true });
  if (!practice.isParticipant) fail(403, 'FORBIDDEN', '教师预览不能建立学生计时提交');
  if (practice.state !== 'Published' || practice.forced_ended_at) fail(409, 'TRAINING_CLOSED', '计时训练已结束或结果已发布');
  const assigned = row(await db.query('SELECT * FROM timed_practice_problems WHERE practice_id=$1 AND problem_id=$2', [practice.id, uuid(body.problemId)]), '题目不属于该计时训练');
  if (body.versionId && body.versionId !== assigned.version_id) fail(409, 'VERSION_MISMATCH', '计时训练题目版本已固定，请使用活动页面的版本');
  const attempt = (await db.query('SELECT * FROM timed_attempts WHERE practice_id=$1 AND identity_id=$2 FOR UPDATE', [practice.id, user.identityId])).rows[0];
  if (!attempt) fail(409, 'NOT_STARTED', '请先在活动页面开始计时训练');
  const acceptedAt = await now(db);
  if (attempt.state !== 'Active' || attempt.finished_at || acceptedAt > attempt.deadline_at) fail(409, 'DEADLINE_PASSED', '个人计时已结束；截止后的代码不会成为正式提交');
  const pinned = assigned.version_id === version.id ? version : row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND published_at IS NOT NULL', [assigned.version_id]));
  return { version: pinned, timedAttemptId: attempt.id, acceptedAt };
}

export async function maskTimedSubmission(db, user, submission) {
  if (!submission.timed_attempt_id) return submission;
  const practice = row(await db.query('SELECT p.* FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=$1', [submission.timed_attempt_id]));
  if (practice.results_published_at || await canManagePractice(db, user, practice)) return { ...submission, timed_practice_id: practice.id };
  return { ...submission, timed_practice_id: practice.id, status: submission.status,
    score: null, passed: null, total: null, public_output: submission.kind === 'submit' ? null : submission.public_output,
    public_message: '判题状态实时显示；最终成绩将在教师发布结果后显示。' };
}

export function createTimedService(pool) {
  return {
    prepareSubmission: prepareTimedSubmission,
    maskSubmission: maskTimedSubmission,
    async handle({ route, method, user, body = {}, url, helpers = {} }) {
      if (!route.startsWith('/timed-practices')) return null;
      if (!user) fail(401, 'UNAUTHENTICATED', '请先登录');
      if (route === '/timed-practices' && method === 'GET') {
        const list = await pool.query(isAdmin(user) ? 'SELECT id FROM timed_practices ORDER BY created_at DESC LIMIT 200'
          : `SELECT p.id FROM timed_practices p WHERE ($3 AND EXISTS(SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id WHERE tc.class_id=p.class_id AND tc.account_id=$1 AND c.archived_at IS NULL))
            OR ($4 AND p.state<>'Draft' AND EXISTS(SELECT 1 FROM timed_practice_participants part WHERE part.practice_id=p.id AND part.identity_id=$2 AND NOT part.exempt)) ORDER BY p.created_at DESC LIMIT 200`,
        isAdmin(user) ? [] : [user.id, user.identityId, user.roles.includes('teacher'), user.roles.includes('student')]);
        const items = [];
        for (const practice of list.rows) items.push(await practiceResult(pool, user, practice.id));
        return { status: 200, body: { items } };
      }
      if (route === '/timed-practices' && method === 'POST') {
        staff(user);
        const title = field(body.title, '训练名称'), classId = uuid(body.classId, '班级 ID'), startsAt = date(body.startsAt, '开始时间'), endsAt = date(body.endsAt, '结束时间');
        const durationMinutes = integer(body.durationMinutes, 1, 240, '个人时长');
        if (endsAt <= startsAt) fail(400, 'VALIDATION', '训练结束时间须晚于开始时间');
        if (body.showVerdict !== undefined && typeof body.showVerdict !== 'boolean') fail(400, 'VALIDATION', '反馈设置无效');
        if (!Array.isArray(body.problems) || body.problems.length < 1 || body.problems.length > 50) fail(400, 'VALIDATION', '训练须包含 1–50 题');
        const created = await transaction(pool, async (db) => {
          await classAccess(db, user, classId);
          const participants = body.participants ?? (await db.query("SELECT cm.identity_id FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE cm.class_id=$1 AND i.archived_at IS NULL AND i.kind='student'", [classId])).rows.map((entry) => entry.identity_id);
          if (!Array.isArray(participants) || !participants.length || participants.length > 500) fail(400, 'VALIDATION', '请选择 1–500 名学生');
          const practice = row(await db.query('INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes,show_verdict,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [title, classId, user.id, startsAt, endsAt, durationMinutes, body.showVerdict ?? true,field(body.description??'','训练说明',{min:0,max:10000})]));
          const configuredRewards = [], seenProblems = new Set();
          for (let index = 0; index < body.problems.length; index++) {
            const entry = body.problems[index], problemId = uuid(entry.problemId), points = Number(entry.points);
            if (seenProblems.has(problemId)) fail(400, 'VALIDATION', '同题不能重复选择');
            seenProblems.add(problemId);
            if (!Number.isFinite(points) || points <= 0 || points > 1000) fail(400, 'VALIDATION', '题目分值须在 0–1000 之间');
            const reward = rewardCaps(entry);
            configuredRewards.push(reward);
            const current = row(await db.query('SELECT current_version_id FROM problems WHERE id=$1 AND archived_at IS NULL', [problemId]), '题目不存在');
            const versionId = entry.versionId ? uuid(entry.versionId) : current.current_version_id;
            const version = row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2 AND published_at IS NOT NULL', [versionId, problemId]), '只能选择已发布题目');
            if (helpers.versionAccess) await helpers.versionAccess(db, user, problemId, version.id);
            await db.query(`INSERT INTO timed_practice_problems(
              practice_id,problem_id,version_id,points,position,reward_points,speed_bonus_points,attempt_bonus_points)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [practice.id, problemId, version.id, points, index, reward.rewardPoints, reward.speedBonusPoints, reward.attemptBonusPoints]);
          }
          rewardBudget(configuredRewards);
          for (const identity of new Set(participants)) {
            if (!(await db.query("SELECT 1 FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE cm.class_id=$1 AND cm.identity_id=$2 AND i.kind='student' AND i.archived_at IS NULL", [classId, uuid(identity)])).rowCount) fail(400, 'VALIDATION', '训练成员须为本班有效学生');
            await db.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)', [practice.id, identity]);
          }
          await audit(db, user, 'timed.create', practice.id);
          return practice.id;
        });
        return { status: 201, body: await practiceResult(pool, user, created) };
      }
      const historyMatch = route.match(/^\/timed-practices\/([^/]+)\/result-revisions$/);
      if (historyMatch && method === 'GET') {
        const practice = await practiceAccess(pool, user, historyMatch[1]);
        if (!practice.canManage) fail(403, 'FORBIDDEN', '需要本班教师权限');
        const items = (await pool.query('SELECT r.id,r.revision,r.reason,r.created_at,r.grades,i.name author_name FROM timed_result_revisions r JOIN accounts a ON a.id=r.actor_account_id JOIN identities i ON i.id=a.identity_id WHERE r.practice_id=$1 ORDER BY r.revision DESC', [practice.id])).rows.map((revision) => ({ id: revision.id, revision: revision.revision, reason: revision.reason, createdAt: revision.created_at, authorName: revision.author_name, grades: revision.grades }));
        return { status: 200, body: { items } };
      }
      const match = route.match(/^\/timed-practices\/([^/]+)(?:\/(publish|start|finish|end|results|extend|exempt|archive))?$/);
      if (!match) return null;
      const id = uuid(match[1]), action = match[2];
      if(!action&&method==='PATCH'){
        staff(user);await transaction(pool,async db=>{const practice=await practiceAccess(db,user,id,{lock:true});if(!practice.canManage)fail(403,'FORBIDDEN','无权编辑此训练');if(practice.state!=='Draft')fail(409,'IMMUTABLE','已发布训练的题目与规则固定，请使用延期或豁免等独立操作');const classId=body.classId===undefined?practice.class_id:uuid(body.classId);await classAccess(db,user,classId);const title=body.title===undefined?practice.title:field(body.title,'训练名称'),startsAt=body.startsAt===undefined?practice.starts_at:date(body.startsAt,'开始时间'),endsAt=body.endsAt===undefined?practice.ends_at:date(body.endsAt,'结束时间'),duration=body.durationMinutes===undefined?practice.duration_minutes:integer(body.durationMinutes,1,240,'个人时长');if(endsAt<=startsAt)fail(400,'VALIDATION','结束时间须晚于开始时间');if(body.showVerdict!==undefined&&typeof body.showVerdict!=='boolean')fail(400,'VALIDATION','反馈设置无效');
         const problems=body.problems??(await db.query(`SELECT problem_id AS "problemId",version_id AS "versionId",points,
           reward_points AS "rewardPoints",speed_bonus_points AS "speedBonusPoints",attempt_bonus_points AS "attemptBonusPoints"
           FROM timed_practice_problems WHERE practice_id=$1 ORDER BY position`,[id])).rows;
         if(!Array.isArray(problems)||problems.length>50)fail(400,'VALIDATION','训练最多 50 题');
         const previousRewards=new Map((await db.query(`SELECT problem_id,reward_points,speed_bonus_points,attempt_bonus_points
           FROM timed_practice_problems WHERE practice_id=$1`,[id])).rows.map(p=>[p.problem_id,p]));
         const selected=[],seen=new Set();
         for(const e of problems){
           const problemId=uuid(e.problemId),points=Number(e.points);
           if(seen.has(problemId))fail(400,'VALIDATION','同题不能重复选择');
           seen.add(problemId);
           if(!Number.isFinite(points)||points<=0||points>1000)fail(400,'VALIDATION','题目分值无效');
           const current=row(await db.query('SELECT current_version_id FROM problems WHERE id=$1 AND archived_at IS NULL',[problemId]));
           const version=row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2 AND published_at IS NOT NULL',[e.versionId?uuid(e.versionId):current.current_version_id,problemId]));
           if(helpers.versionAccess)await helpers.versionAccess(db,user,problemId,version.id);
           selected.push({problemId,versionId:version.id,points,...rewardCaps(e,previousRewards.get(problemId))});
         }
         rewardBudget(selected);
         const participants=body.participants??(await db.query('SELECT identity_id FROM timed_practice_participants WHERE practice_id=$1 AND NOT exempt',[id])).rows.map(p=>p.identity_id);if(!Array.isArray(participants)||participants.length>500)fail(400,'VALIDATION','训练最多 500 名学生');for(const identityId of new Set(participants))if(!(await db.query("SELECT 1 FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE cm.class_id=$1 AND cm.identity_id=$2 AND i.kind='student' AND i.archived_at IS NULL",[classId,uuid(identityId)])).rowCount)fail(400,'VALIDATION','训练成员须为本班有效学生');
         await db.query('UPDATE timed_practices SET title=$1,class_id=$2,starts_at=$3,ends_at=$4,duration_minutes=$5,show_verdict=$6,description=$8 WHERE id=$7',[title,classId,startsAt,endsAt,duration,body.showVerdict??practice.show_verdict,id,body.description===undefined?practice.description:field(body.description,'训练说明',{min:0,max:10000})]);
         await db.query('DELETE FROM timed_practice_problems WHERE practice_id=$1',[id]);
         await db.query('DELETE FROM timed_practice_participants WHERE practice_id=$1',[id]);
         for(const[position,p]of selected.entries())await db.query(`INSERT INTO timed_practice_problems(
           practice_id,problem_id,version_id,points,position,reward_points,speed_bonus_points,attempt_bonus_points)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
           [id,p.problemId,p.versionId,p.points,position,p.rewardPoints,p.speedBonusPoints,p.attemptBonusPoints]);
         for(const identityId of new Set(participants))await db.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[id,identityId]);
         await audit(db,user,'timed.draft_edit',id);
        });return {status:200,body:await practiceResult(pool,user,id)};
      }
      if (!action && method === 'GET') return { status: 200, body: await practiceResult(pool, user, id) };
      if (method !== 'POST' || !action) return null;
      if (action === 'start') {
        const result = await transaction(pool, async (db) => {
          const practice = await practiceAccess(db, user, id, { share: true });
          if (!practice.isParticipant) fail(403, 'FORBIDDEN', '教师预览不建立学生真实尝试');
          await db.query('SELECT identity_id FROM timed_practice_participants WHERE practice_id=$1 AND identity_id=$2 FOR UPDATE', [id, user.identityId]);
          const serverNow = await now(db);
          const old = (await db.query('SELECT * FROM timed_attempts WHERE practice_id=$1 AND identity_id=$2', [id, user.identityId])).rows[0];
          if (old) return attemptShape(old, serverNow);
          if (practice.state !== 'Published' || practice.forced_ended_at || serverNow < practice.starts_at || serverNow >= practice.ends_at) fail(409, 'START_WINDOW', '当前不在允许开始的时间范围内');
          const deadlineAt = new Date(Math.min(serverNow.getTime() + practice.duration_minutes * 60000, practice.ends_at.getTime()));
          const attempt = row(await db.query('INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at) VALUES($1,$2,$3,$4,$5) RETURNING *', [id, user.identityId, user.id, serverNow, deadlineAt]));
          await audit(db, user, 'timed.start', id);
          return attemptShape(attempt, serverNow);
        });
        return { status: 200, body: result };
      }
      if (action === 'finish') {
        const result = await transaction(pool, async (db) => {
          const practice = await practiceAccess(db, user, id, { share: true });
          if (!practice.isParticipant) fail(403, 'FORBIDDEN', '教师预览没有学生尝试');
          const attempt = row(await db.query('SELECT * FROM timed_attempts WHERE practice_id=$1 AND identity_id=$2 FOR UPDATE', [id, user.identityId]), '尚未开始该训练');
          const serverNow = await now(db);
          const finished = row(await db.query("UPDATE timed_attempts SET state='Finished',finished_at=COALESCE(finished_at,$2) WHERE id=$1 RETURNING *", [attempt.id, serverNow]));
          await audit(db, user, 'timed.finish', id);
          return attemptShape(finished, serverNow);
        });
        return { status: 200, body: result };
      }
      staff(user);
      await transaction(pool, async (db) => {
        const practice = await practiceAccess(db, user, id, { lock: true });
        if (!practice.canManage) fail(403, 'FORBIDDEN', '无权管理该班级的计时训练');
        const serverNow = await now(db);
        if (action === 'publish') {
          if(!(await db.query('SELECT 1 FROM timed_practice_problems WHERE practice_id=$1',[id])).rowCount||!(await db.query('SELECT 1 FROM timed_practice_participants WHERE practice_id=$1 AND NOT exempt',[id])).rowCount)fail(409,'INCOMPLETE','发布训练前须选择题目和适用学生');
          if (practice.state === 'Published') return;
          if (practice.state !== 'Draft') fail(409, 'INVALID_STATE', '当前训练不能发布');
          rewardBudget((await db.query('SELECT reward_points,speed_bonus_points,attempt_bonus_points FROM timed_practice_problems WHERE practice_id=$1',[id])).rows.map((entry)=>rewardCaps(entry)));
          if (serverNow >= practice.ends_at) fail(409, 'INVALID_STATE', '结束窗口已过期，发布前请将结束时间设置为晚于当前时间');
          await db.query("UPDATE timed_practices SET state='Published' WHERE id=$1", [id]);
          await audit(db, user, 'timed.publish', id);
        } else if (action === 'end') {
          if (practice.forced_ended_at) return;
          if (practice.state !== 'Published') fail(409, 'INVALID_STATE', '当前训练不能提前结束');
          const reason = field(body.reason, '提前结束原因', { max: 1000 });
          await db.query('UPDATE timed_practices SET forced_ended_at=$2 WHERE id=$1', [id, serverNow]);
          await db.query("UPDATE timed_attempts SET state='Finished',finished_at=COALESCE(finished_at,$2) WHERE practice_id=$1 AND state='Active'", [id, serverNow]);
          await audit(db, user, 'timed.end', id, { reason, endedAt: serverNow });
        } else if (action === 'extend') {
          if (practice.state !== 'Published' || practice.results_published_at || practice.forced_ended_at) fail(409, 'INVALID_STATE', '已结束或发布成绩的训练不能延期');
          const identityId = uuid(body.identityId), deadlineAt = date(body.deadlineAt, '新截止时间'), reason = field(body.reason, '延期原因', { max: 1000 });
          const attempt = row(await db.query('SELECT a.* FROM timed_attempts a JOIN timed_practice_participants part ON part.practice_id=a.practice_id AND part.identity_id=a.identity_id WHERE a.practice_id=$1 AND a.identity_id=$2 AND NOT part.exempt FOR UPDATE OF a', [id, identityId]), '该学生尚未开始训练');
          if (deadlineAt <= attempt.deadline_at || deadlineAt <= serverNow || deadlineAt.getTime() > practice.ends_at.getTime() + 86400000) fail(400, 'VALIDATION', '新截止须晚于当前截止和现在，最多延至活动结束后 24 小时');
          await db.query("UPDATE timed_attempts SET deadline_at=$2,state='Active',finished_at=NULL WHERE id=$1", [attempt.id, deadlineAt]);
          await audit(db, user, 'timed.extend', id, { identityId, previousDeadline: attempt.deadline_at, deadlineAt, reason });
        } else if (action === 'exempt') {
          if (practice.results_published_at || practice.state === 'Archived') fail(409, 'INVALID_STATE', '已发布成绩的名单不能更改');
          if (typeof body.exempt !== 'boolean') fail(400, 'VALIDATION', '豁免设置无效');
          const identityId = uuid(body.identityId), reason = field(body.reason, '名单变更原因', { max: 1000 });
          row(await db.query('UPDATE timed_practice_participants SET exempt=$3 WHERE practice_id=$1 AND identity_id=$2 RETURNING identity_id', [id, identityId, body.exempt]), '该学生不在训练名单中');
          await audit(db, user, 'timed.exempt', id, { identityId, exempt: body.exempt, reason });
        } else if (action === 'results') {
          if (practice.results_published_at && !body.reason) return;
          if (!['Published', 'ResultsPublished'].includes(practice.state)) fail(409, 'INVALID_STATE', '当前训练不能发布或修订成绩');
          const reason = practice.results_published_at ? field(body.reason, '成绩修订原因', { max: 1000 }) : '首次发布成绩';
          const active = await db.query(`SELECT 1 FROM timed_practice_participants part LEFT JOIN timed_attempts a ON a.practice_id=part.practice_id AND a.identity_id=part.identity_id
            WHERE part.practice_id=$1 AND NOT part.exempt AND ((a.id IS NULL AND NOT $4 AND $2::timestamptz<$3::timestamptz) OR (a.state='Active' AND a.finished_at IS NULL AND a.deadline_at>$2)) LIMIT 1`, [id, serverNow, practice.ends_at, !!practice.forced_ended_at]);
          if (active.rowCount) fail(409, 'TRAINING_ACTIVE', '仍有学生可以开始或正在答题，不能发布成绩');
          // Workers may still finalize verdicts after the personal attempt has
          // ended. Hold every existing practice submission stable while grades,
          // first-AC candidates and reward entries are frozen in this transaction.
          await db.query(`SELECT sub.id FROM submissions sub
            JOIN timed_attempts attempt ON attempt.id=sub.timed_attempt_id
            WHERE attempt.practice_id=$1 ORDER BY sub.id FOR SHARE OF sub`, [id]);
          const unresolved = await db.query(`SELECT 1 FROM submissions sub
            JOIN timed_attempts attempt ON attempt.id=sub.timed_attempt_id
            JOIN timed_practice_participants participant ON participant.practice_id=attempt.practice_id
              AND participant.identity_id=attempt.identity_id AND NOT participant.exempt
            WHERE attempt.practice_id=$1 AND sub.kind='submit'
              AND sub.created_at>=attempt.started_at
              AND sub.created_at<=LEAST(attempt.deadline_at,COALESCE(attempt.finished_at,attempt.deadline_at))
              AND (sub.status IN ('Waiting','Judging','System Error') OR sub.score IS NULL)
            LIMIT 1`, [id]);
          if (unresolved.rowCount) fail(409, 'INCOMPLETE_RESULTS', '仍有正式提交待评测或出现系统错误，请处理后再发布');
          const grades = await calculateGrades(db, practice);
          if (grades.some((grade) => grade.pending)) fail(409, 'INCOMPLETE_RESULTS', '最后一次正式提交仍待评测或出现系统错误，请处理后再发布');
          if (practice.results_published_at) {
            const firstRelease = new Map((await db.query('SELECT identity_id,grade FROM timed_result_snapshots WHERE practice_id=$1', [id]))
              .rows.map((entry) => [entry.identity_id, entry.grade]));
            // Scores may be corrected later, but points were paid only at the
            // first release. Keep the visible reward breakdown pinned to it.
            for (const grade of grades) {
              const original = new Map((firstRelease.get(grade.identityId)?.problems ?? [])
                .map((problem) => [problem.problemId, problem]));
              for (const problem of grade.problems) {
                const paid = original.get(problem.problemId);
                for (const key of ['rewardPoints','speedBonusPointsEarned','attemptBonusPointsEarned','totalRewardPoints','elapsedSeconds','formalAttempts'])
                  problem[key] = paid?.[key] ?? (key === 'elapsedSeconds' ? null : 0);
              }
            }
          }
          if (!practice.results_published_at) {
            await db.query(`INSERT INTO timed_first_ac_candidates(submission_id,practice_id)
              SELECT sub.id,$1 FROM timed_attempts attempt
              JOIN timed_practice_participants participant ON participant.practice_id=attempt.practice_id
                AND participant.identity_id=attempt.identity_id AND NOT participant.exempt
              JOIN submissions sub ON sub.timed_attempt_id=attempt.id AND sub.identity_id=attempt.identity_id
              JOIN timed_practice_problems problem ON problem.practice_id=attempt.practice_id
                AND problem.problem_id=sub.problem_id AND problem.version_id=sub.version_id
              WHERE attempt.practice_id=$1 AND sub.kind='submit' AND sub.status='AC'
                AND sub.created_at>=attempt.started_at
                AND sub.created_at<=LEAST(attempt.deadline_at,COALESCE(attempt.finished_at,attempt.deadline_at))`, [id]);
            for (const grade of grades) await db.query('INSERT INTO timed_result_snapshots(practice_id,identity_id,grade) VALUES($1,$2,$3)', [id, grade.identityId, grade]);
          }
          const revisionNumber = Number((await db.query('SELECT COALESCE(max(revision),0)+1 AS next FROM timed_result_revisions WHERE practice_id=$1', [id])).rows[0].next);
          const revision = row(await db.query('INSERT INTO timed_result_revisions(practice_id,revision,grades,reason,actor_account_id) VALUES($1,$2,$3::jsonb,$4,$5) RETURNING id', [id, revisionNumber, JSON.stringify(grades), reason, user.id]));
          await db.query("UPDATE timed_practices SET state='ResultsPublished',results_published_at=COALESCE(results_published_at,$2),current_result_revision_id=$3 WHERE id=$1", [id, serverNow, revision.id]);
          if (!practice.results_published_at) await settleTimedRewards(db, practice, grades);
          await audit(db, user, practice.results_published_at ? 'timed.results_revise' : 'timed.results_publish', id, { participants: grades.length, revision: revisionNumber, reason });
        } else if (action === 'archive') {
          if (practice.state === 'Archived') return;
          if (!practice.results_published_at && practice.state !== 'Draft') fail(409, 'INVALID_STATE', '请先完成并发布训练成绩');
          await db.query("UPDATE timed_practices SET state='Archived',archived_at=$2 WHERE id=$1", [id, serverNow]);
          await audit(db, user, 'timed.archive', id);
        }
      });
      return { status: 200, body: await practiceResult(pool, user, id) };
    },
  };
}

export { practiceResult as getTimedPracticeResult };
