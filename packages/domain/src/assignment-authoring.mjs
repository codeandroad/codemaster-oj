import { transaction } from './db.mjs';
import { fail,field,uuid,enumValue } from './security.mjs';
const staff=u=>{if(!u.roles.some(r=>['teacher','admin'].includes(r)))fail(403,'FORBIDDEN','需要教师权限');};
const row=r=>{if(!r.rowCount)fail(404,'NOT_FOUND','资源不存在');return r.rows[0];};
async function input(ctx,db,body,old) {
 const title=body.title===undefined?old?.title:field(body.title,'作业标题');if(!title)fail(400,'VALIDATION','需要作业标题');
 const classId=body.classId===undefined?old?.class_id:uuid(body.classId,'班级 ID');if(!classId)fail(400,'VALIDATION','请选择班级');await ctx.helpers.classAccess(db,ctx.user,classId);
 const dueAt=body.dueAt===undefined?new Date(old?.due_at):new Date(body.dueAt);if(!Number.isFinite(dueAt.getTime()))fail(400,'VALIDATION','截止时间格式无效');
 const description=body.description===undefined?old?.description??'':field(body.description,'作业说明',{min:0,max:10000});
 const problems=body.problems??(old?(await db.query('SELECT problem_id AS "problemId",points FROM assignment_problems WHERE assignment_id=$1 ORDER BY position',[old.id])).rows:[]);
 if(!Array.isArray(problems)||problems.length>50)fail(400,'VALIDATION','作业最多 50 题');const selected=[],seen=new Set();
 for(const p of problems){const problemId=uuid(p.problemId),points=Number(p.points);if(seen.has(problemId))fail(400,'VALIDATION','同一题目只能选择一次');seen.add(problemId);if(!Number.isFinite(points)||points<=0||points>1000||Math.abs(Math.round(points*100)-points*100)>0.00001)fail(400,'VALIDATION','分值须为 0–1000，最多两位小数');const {p:problem}=await ctx.helpers.versionAccess(db,ctx.user,problemId);if(!problem.current_version_id)fail(409,'UNPUBLISHED','只能选择已发布题目');const {v}=await ctx.helpers.versionAccess(db,ctx.user,problemId,problem.current_version_id);if(!v.published_at)fail(409,'UNPUBLISHED','只能选择已发布题目');selected.push({problemId,versionId:v.id,points});}
 const participants=body.participants??(old?(await db.query('SELECT identity_id FROM assignment_participants WHERE assignment_id=$1 AND NOT exempt',[old.id])).rows.map(p=>p.identity_id):(await db.query("SELECT cm.identity_id FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE cm.class_id=$1 AND i.archived_at IS NULL AND i.kind='student'",[classId])).rows.map(p=>p.identity_id));
 if(!Array.isArray(participants)||participants.length>500)fail(400,'VALIDATION','作业最多 500 名学生');const studentIds=[...new Set(participants.map(id=>uuid(id)))];for(const id of studentIds)if(!(await db.query("SELECT 1 FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE class_id=$1 AND identity_id=$2 AND i.kind='student' AND i.archived_at IS NULL",[classId,id])).rowCount)fail(400,'VALIDATION','作业成员须为本班有效学生');const course=body.course===undefined?old?.course??'Python':field(body.course,'课程标签',{max:100});return {title,classId,dueAt,description,course,problems:selected,participants:studentIds};
}
async function apply(db,id,i){
 await db.query('UPDATE assignments SET title=$1,class_id=$2,due_at=$3,description=$4,course=$6 WHERE id=$5',[i.title,i.classId,i.dueAt,i.description,id,i.course]);await db.query('DELETE FROM assignment_problems WHERE assignment_id=$1',[id]);await db.query('DELETE FROM assignment_participants WHERE assignment_id=$1',[id]);for(const [position,p]of i.problems.entries())await db.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,$4,$5)',[id,p.problemId,p.versionId,p.points,position]);for(const identityId of i.participants)await db.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[id,identityId]);
}
function publishable(i){if(i.dueAt<=new Date())fail(400,'VALIDATION','截止时间须晚于现在');if(!i.problems.length||!i.participants.length)fail(409,'INCOMPLETE','发布作业前须选择题目和适用学生');}
export async function handleAssignmentAuthoring(ctx){
 const {route,method,body,pool,user,helpers}=ctx;let match;
 if(route==='/assignments'&&method==='POST'){
  staff(user);const state=enumValue(body.state??'Published',['Draft','Published'],'作业状态');const id=await transaction(pool,async db=>{const i=await input(ctx,db,body);if(state==='Published')publishable(i);const a=row(await db.query("INSERT INTO assignments(title,class_id,owner_account_id,due_at,description,state) VALUES($1,$2,$3,$4,$5,'Draft') RETURNING id",[i.title,i.classId,user.id,i.dueAt,i.description]));await apply(db,a.id,i);if(state==='Published')await db.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[a.id]);await helpers.audit(db,user.id,state==='Draft'?'assignment.draft_create':'assignment.create','assignment',a.id);return a.id;});return {status:201,body:await helpers.assignmentResult(pool,user,id)};
 }
 match=route.match(/^\/assignments\/([^/]+)(?:\/(publish))?$/);
 if(!match||!(method==='PATCH'&&!match[2]||method==='POST'&&match[2]==='publish'))return null;
 staff(user);const id=uuid(match[1]);await transaction(pool,async db=>{row(await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[id]));const a=await helpers.assignmentAccess(db,user,id);if(!a.canManage)fail(403,'FORBIDDEN','无权编辑此作业');if(a.state!=='Draft')fail(409,'IMMUTABLE_ASSIGNMENT','已发布作业的题目与分值固定，请另建草稿；名单豁免与延期使用专门操作');const i=await input(ctx,db,body,a);await apply(db,id,i);if(match[2]){publishable(i);await db.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[id]);}await helpers.audit(db,user.id,match[2]?'assignment.publish':'assignment.draft_edit','assignment',id);});return {status:200,body:await helpers.assignmentResult(pool,user,id)};
}
