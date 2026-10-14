import { transaction } from './db.mjs';
import { fail,field,uuid,enumValue,integer } from './security.mjs';
const staff=u=>{if(!u.roles.some(r=>['teacher','admin'].includes(r)))fail(403,'FORBIDDEN','需要教师权限');};
const row=r=>{if(!r.rowCount)fail(404,'NOT_FOUND','资源不存在');return r.rows[0];};
const rewardPoints=(value,fallback=0)=>value===undefined?fallback:integer(value,0,20,'作业每题额外积分');
function checkRewardBudget(problems){if(problems.reduce((sum,problem)=>sum+problem.rewardPoints,0)>100)fail(400,'REWARD_BUDGET','每份作业奖励总额最多 100 分');}
async function syncRewards(db,id,problems,accountId){
 await db.query('DELETE FROM point_rewards WHERE assignment_id=$1',[id]);
 for(const problem of problems)if(problem.rewardPoints>0)await db.query('INSERT INTO point_rewards(problem_id,assignment_id,points,updated_by) VALUES($1,$2,$3,$4)',[problem.problemId,id,problem.rewardPoints,accountId]);
}
async function input(ctx,db,body,old) {
 const title=body.title===undefined?old?.title:field(body.title,'作业标题');if(!title)fail(400,'VALIDATION','需要作业标题');
 const classId=body.classId===undefined?old?.class_id:uuid(body.classId,'班级 ID');if(!classId)fail(400,'VALIDATION','请选择班级');await ctx.helpers.classAccess(db,ctx.user,classId);
 const dueAt=body.dueAt===undefined?new Date(old?.due_at):new Date(body.dueAt);if(!Number.isFinite(dueAt.getTime()))fail(400,'VALIDATION','截止时间格式无效');
 const description=body.description===undefined?old?.description??'':field(body.description,'作业说明',{min:0,max:10000});
 const existingRewards=old?new Map((await db.query('SELECT problem_id,points FROM point_rewards WHERE assignment_id=$1',[old.id])).rows.map(reward=>[reward.problem_id,reward.points])):new Map();
 const problems=body.problems??(old?(await db.query('SELECT problem_id AS "problemId",points FROM assignment_problems WHERE assignment_id=$1 ORDER BY position',[old.id])).rows:[]);
 if(!Array.isArray(problems)||problems.length>50)fail(400,'VALIDATION','作业最多 50 题');const selected=[],seen=new Set();
 for(const p of problems){const problemId=uuid(p.problemId),points=Number(p.points);if(seen.has(problemId))fail(400,'VALIDATION','同一题目只能选择一次');seen.add(problemId);if(!Number.isFinite(points)||points<=0||points>1000||Math.abs(Math.round(points*100)-points*100)>0.00001)fail(400,'VALIDATION','分值须为 0–1000，最多两位小数');const {p:problem}=await ctx.helpers.versionAccess(db,ctx.user,problemId);if(!problem.current_version_id)fail(409,'UNPUBLISHED','只能选择已发布题目');const {v}=await ctx.helpers.versionAccess(db,ctx.user,problemId,problem.current_version_id);if(!v.published_at)fail(409,'UNPUBLISHED','只能选择已发布题目');selected.push({problemId,versionId:v.id,points,rewardPoints:rewardPoints(p.rewardPoints,existingRewards.get(problemId)??0)});}
 checkRewardBudget(selected);
 const participants=body.participants??(old?(await db.query('SELECT identity_id FROM assignment_participants WHERE assignment_id=$1 AND NOT exempt',[old.id])).rows.map(p=>p.identity_id):(await db.query("SELECT cm.identity_id FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE cm.class_id=$1 AND i.archived_at IS NULL AND i.kind='student'",[classId])).rows.map(p=>p.identity_id));
 if(!Array.isArray(participants)||participants.length>500)fail(400,'VALIDATION','作业最多 500 名学生');const studentIds=[...new Set(participants.map(id=>uuid(id)))];for(const id of studentIds)if(!(await db.query("SELECT 1 FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE class_id=$1 AND identity_id=$2 AND i.kind='student' AND i.archived_at IS NULL",[classId,id])).rowCount)fail(400,'VALIDATION','作业成员须为本班有效学生');const course=body.course===undefined?old?.course??'Python':field(body.course,'课程标签',{max:100});return {title,classId,dueAt,description,course,problems:selected,participants:studentIds};
}
async function apply(db,id,i,accountId){
 await db.query('UPDATE assignments SET title=$1,class_id=$2,due_at=$3,description=$4,course=$6 WHERE id=$5',[i.title,i.classId,i.dueAt,i.description,id,i.course]);await db.query('DELETE FROM assignment_problems WHERE assignment_id=$1',[id]);await db.query('DELETE FROM assignment_participants WHERE assignment_id=$1',[id]);for(const [position,p]of i.problems.entries())await db.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,$4,$5)',[id,p.problemId,p.versionId,p.points,position]);for(const identityId of i.participants)await db.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[id,identityId]);
 await syncRewards(db,id,i.problems,accountId);
}
function publishable(i){if(i.dueAt<=new Date())fail(400,'VALIDATION','截止时间须晚于现在');if(!i.problems.length||!i.participants.length)fail(409,'INCOMPLETE','发布作业前须选择题目和适用学生');}

// Published work remains editable without changing the version or score of an
// existing submission. Every edit takes the assignment row lock first; student
// submission admission takes FOR SHARE on the same row.
async function editPublished(ctx,db,id,old,body){
 const allowed=new Set(['title','description','course','classId','dueAt','problems','participants','reason','state','expectedRevision']);
 if(Object.keys(body).some(key=>!allowed.has(key)))fail(400,'VALIDATION','包含不支持的作业修改字段');
 if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail(400,'VALIDATION','需要有效的作业编辑版本，请刷新后重试');
 if(body.expectedRevision!==old.edit_revision)fail(409,'ASSIGNMENT_REVISION_CONFLICT','作业已被其他操作修改，请刷新后核对再保存');
 if(body.state!==undefined&&body.state!=='Published')fail(409,'PUBLISHED_ASSIGNMENT','已发布作业不能退回草稿');
 if(body.classId!==undefined&&uuid(body.classId,'班级 ID')!==old.class_id)fail(409,'PUBLISHED_ASSIGNMENT','已发布作业不能更换班级，请新建作业');
 const reason=body.reason===undefined?'':field(body.reason,'修改原因',{min:0,max:2000});
 const title=body.title===undefined?old.title:field(body.title,'作业标题');
 const description=body.description===undefined?old.description:field(body.description,'作业说明',{min:0,max:10000});
 const course=body.course===undefined?old.course:field(body.course,'课程标签',{max:100});
 const dueAt=body.dueAt===undefined?new Date(old.due_at):new Date(body.dueAt);
 if(!Number.isFinite(dueAt.getTime()))fail(400,'VALIDATION','截止时间格式无效');
 const oldDueAt=new Date(old.due_at),dueChanged=dueAt.getTime()!==oldDueAt.getTime();
 if(dueChanged&&(dueAt<=new Date()||dueAt<=oldDueAt))fail(400,'VALIDATION','已发布作业只能将截止时间延至更晚的未来时间');

 const original=(await db.query('SELECT ap.problem_id,ap.version_id,ap.points,ap.position,COALESCE(reward.points,0) reward_points FROM assignment_problems ap LEFT JOIN point_rewards reward ON reward.assignment_id=ap.assignment_id AND reward.problem_id=ap.problem_id WHERE ap.assignment_id=$1 ORDER BY ap.position',[id])).rows;
 const pinned=new Map(original.map(problem=>[problem.problem_id,problem]));
 let problems=original.map(problem=>({problemId:problem.problem_id,versionId:problem.version_id,points:Number(problem.points),rewardPoints:Number(problem.reward_points)}));
 if(body.problems!==undefined){
  if(!Array.isArray(body.problems)||!body.problems.length||body.problems.length>50)fail(400,'VALIDATION','已发布作业须包含 1–50 题');
  const seen=new Set();problems=[];
  for(const item of body.problems){
   const problemId=uuid(item?.problemId,'题目 ID'),points=Number(item.points);
   if(seen.has(problemId))fail(400,'VALIDATION','同一题目只能选择一次');seen.add(problemId);
   if(!Number.isFinite(points)||points<=0||points>1000||Math.abs(Math.round(points*100)-points*100)>0.00001)fail(400,'VALIDATION','分值须大于 0 且不超过 1000，最多两位小数');
   let versionId=pinned.get(problemId)?.version_id;
   if(!versionId||item.versionId!==undefined&&item.versionId!==versionId){
    const {p}=await ctx.helpers.versionAccess(db,ctx.user,problemId);
    if(!p.current_version_id)fail(409,'UNPUBLISHED','只能选择已发布题目');
    // A newer question version is never adopted implicitly. The teacher must
    // explicitly select the currently published version of the same problem.
    const requested=item.versionId===undefined?p.current_version_id:uuid(item.versionId,'版本 ID');
    if(requested!==p.current_version_id)fail(409,'VERSION_MISMATCH','只能明确选择该题当前已发布的最新版本');
    const {v}=await ctx.helpers.versionAccess(db,ctx.user,problemId,requested);
    if(!v.published_at)fail(409,'UNPUBLISHED','只能选择已发布题目');
    versionId=v.id;
   }
   problems.push({problemId,versionId,points,rewardPoints:rewardPoints(item.rewardPoints,Number(pinned.get(problemId)?.reward_points??0))});
  }
 }
 checkRewardBudget(problems);
 const problemChanged=problems.length!==original.length||problems.some((problem,index)=>problem.problemId!==original[index].problem_id||problem.versionId!==original[index].version_id||problem.points!==Number(original[index].points));
 const rewardChanged=problems.some(problem=>problem.rewardPoints!==Number(pinned.get(problem.problemId)?.reward_points??0))||original.some(problem=>Number(problem.reward_points)>0&&!problems.some(selected=>selected.problemId===problem.problem_id));
 const versionChanges=problems.filter(problem=>pinned.has(problem.problemId)&&problem.versionId!==pinned.get(problem.problemId).version_id).map(problem=>({problemId:problem.problemId,previousVersionId:pinned.get(problem.problemId).version_id,versionId:problem.versionId}));
 if((problemChanged||rewardChanged)&&(await db.query("SELECT 1 FROM submissions WHERE assignment_id=$1 AND kind IN ('submit','correction') LIMIT 1",[id])).rowCount)fail(409,'ASSIGNMENT_HAS_SUBMISSIONS','已有正式提交，不能修改题目、顺序、分值或额外积分；可修改基本信息与适用名单');
 if(versionChanges.length&&(await db.query('SELECT 1 FROM submissions WHERE assignment_id=$1 LIMIT 1',[id])).rowCount)fail(409,'ASSIGNMENT_HAS_ACTIVITY','已有运行或提交记录，不能更换作业题目版本；可修改标题、说明和截止时间');

 const existing=(await db.query('SELECT identity_id,exempt FROM assignment_participants WHERE assignment_id=$1',[id])).rows;
 const active=new Set(existing.filter(person=>!person.exempt).map(person=>person.identity_id));
 const exempt=new Set(existing.filter(person=>person.exempt).map(person=>person.identity_id));
 let participants=[...active];
 if(body.participants!==undefined){
  if(!Array.isArray(body.participants)||body.participants.length>500)fail(400,'VALIDATION','作业最多 500 名学生');
  participants=[...new Set(body.participants.map(identityId=>uuid(identityId,'学生身份 ID')))];
  for(const identityId of participants){
   if(exempt.has(identityId))fail(409,'EXEMPT_PARTICIPANT','恢复已豁免学生请在作业进度页操作并记录原因');
   if(!active.has(identityId)&&!(await db.query("SELECT 1 FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE cm.class_id=$1 AND cm.identity_id=$2 AND i.kind='student' AND i.archived_at IS NULL",[old.class_id,identityId])).rowCount)fail(400,'VALIDATION','作业成员须为本班有效学生');
  }
 }
 // An already-published assignment can have all its participants explicitly
 // exempted in the progress view; editing its wording must remain possible.
 if(!participants.length&&active.size)fail(409,'INCOMPLETE','已发布作业须至少保留一名适用学生；豁免请在进度页操作');
 const selected=new Set(participants),added=participants.filter(identityId=>!active.has(identityId)),removed=[...active].filter(identityId=>!selected.has(identityId));
 if(removed.length&&(await db.query('SELECT 1 FROM submissions WHERE assignment_id=$1 AND identity_id=ANY($2::uuid[]) LIMIT 1',[id,removed])).rowCount)fail(409,'PARTICIPANT_HAS_SUBMISSIONS','已有提交的学生不能直接移出作业，请在进度页使用带原因的豁免操作');
 if((added.length||removed.length)&&dueAt<=new Date())fail(409,'DEADLINE_PASSED','截止后变更名单须先延长截止时间');

 const fields=[];if(title!==old.title)fields.push('title');if(description!==old.description)fields.push('description');if(course!==old.course)fields.push('course');if(dueChanged)fields.push('dueAt');if(problemChanged)fields.push('problems');if(rewardChanged)fields.push('rewards');if(added.length||removed.length)fields.push('participants');
 if(!fields.length)return;
 await db.query('UPDATE assignments SET title=$1,description=$2,course=$3,due_at=$4,edit_revision=edit_revision+1 WHERE id=$5',[title,description,course,dueAt,id]);
 if(problemChanged){
  const selectedIds=problems.map(problem=>problem.problemId);
  await db.query('DELETE FROM assignment_problems WHERE assignment_id=$1 AND NOT (problem_id=ANY($2::uuid[]))',[id,selectedIds]);
  await db.query('DELETE FROM point_rewards WHERE assignment_id=$1 AND NOT (problem_id=ANY($2::uuid[]))',[id,selectedIds]);
  for(const [position,problem]of problems.entries()){
   if(pinned.has(problem.problemId))await db.query('UPDATE assignment_problems SET points=$1,position=$2,version_id=$3 WHERE assignment_id=$4 AND problem_id=$5',[problem.points,position,problem.versionId,id,problem.problemId]);
   else await db.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,$4,$5)',[id,problem.problemId,problem.versionId,problem.points,position]);
  }
 }
 if(problemChanged||rewardChanged)await syncRewards(db,id,problems,ctx.user.id);
 if(removed.length)await db.query('DELETE FROM assignment_participants WHERE assignment_id=$1 AND identity_id=ANY($2::uuid[])',[id,removed]);
 for(const identityId of added)await db.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[id,identityId]);
 await ctx.helpers.audit(db,ctx.user.id,'assignment.published_edit','assignment',id,{...(reason?{reason}:{}),fields,revision:versionChanges,previousDueAt:dueChanged?old.due_at:undefined,dueAt:dueChanged?dueAt.toISOString():undefined,added:added.length,participants:participants.length});
}
export async function handleAssignmentAuthoring(ctx){
 const {route,method,body,pool,user,helpers}=ctx;let match;
 if(route==='/assignments'&&method==='POST'){
  staff(user);const state=enumValue(body.state??'Published',['Draft','Published'],'作业状态');const id=await transaction(pool,async db=>{const i=await input(ctx,db,body);if(state==='Published')publishable(i);const a=row(await db.query("INSERT INTO assignments(title,class_id,owner_account_id,due_at,description,state) VALUES($1,$2,$3,$4,$5,'Draft') RETURNING id",[i.title,i.classId,user.id,i.dueAt,i.description]));await apply(db,a.id,i,user.id);if(state==='Published')await db.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[a.id]);await helpers.audit(db,user.id,state==='Draft'?'assignment.draft_create':'assignment.create','assignment',a.id);return a.id;});return {status:201,body:await helpers.assignmentResult(pool,user,id)};
 }
 match=route.match(/^\/assignments\/([^/]+)(?:\/(publish))?$/);
 if(!match||!(method==='PATCH'&&!match[2]||method==='POST'&&match[2]==='publish'))return null;
 staff(user);const id=uuid(match[1]);await transaction(pool,async db=>{row(await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[id]));const a=await helpers.assignmentAccess(db,user,id);if(!a.canManage)fail(403,'FORBIDDEN','无权编辑此作业');if(a.state==='Published'){if(match[2])fail(409,'PUBLISHED_ASSIGNMENT','作业已经发布');await editPublished(ctx,db,id,a,body);return;}if(body.expectedRevision!==undefined){if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail(400,'VALIDATION','作业编辑版本无效');if(body.expectedRevision!==a.edit_revision)fail(409,'ASSIGNMENT_REVISION_CONFLICT','作业已被其他操作修改，请刷新后核对再保存');}const i=await input(ctx,db,body,a);await apply(db,id,i,user.id);if(match[2]){publishable(i);await db.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[id]);}await db.query('UPDATE assignments SET edit_revision=edit_revision+1 WHERE id=$1',[id]);await helpers.audit(db,user.id,match[2]?'assignment.publish':'assignment.draft_edit','assignment',id);});return {status:200,body:await helpers.assignmentResult(pool,user,id)};
}
