import {transaction} from './db.mjs';
import {enumValue,fail,integer,uuid} from './security.mjs';
import {getScholarshipSettings} from './scholarship-ledger.mjs';

const one=result=>{if(!result.rowCount)fail(404,'NOT_FOUND','活动不存在');return result.rows[0];};
const types=['assignment','timed','paper4_activity'];
export const defaultScholarshipRule=()=>({amount:0,minimumAc:1,minimumScore:0,requireAll:false,taskKind:'challenge',allowSolutionAssisted:false,version:0});
export function scholarshipRuleShape(rule){return rule?{id:rule.id,amount:rule.amount,minimumAc:rule.minimum_ac,minimumScore:Number(rule.minimum_score),requireAll:rule.require_all,taskKind:rule.task_kind,allowSolutionAssisted:rule.allow_solution_assisted,version:rule.rule_version,createdAt:rule.created_at}:defaultScholarshipRule();}

// Lock the same activity row as publication/admission. A reward rule cannot
// race with publication or be silently changed after students can start.
export async function scholarshipActivityAccess(db,user,activityType,activityId,{lock=false}={}){
 enumValue(activityType,types,'活动类型');uuid(activityId,'活动 ID');
 const table=activityType==='assignment'?'assignments':activityType==='timed'?'timed_practices':'paper4_papers';
 const activity=one(await db.query(`SELECT *,clock_timestamp() server_now FROM ${table} WHERE id=$1${lock?' FOR UPDATE':''}`,[activityId]));
 if(activityType==='paper4_activity'&&activity.delivery_kind!=='activity')fail(400,'VALIDATION','请选择布置的 Paper 4 活动');
 const canManage=user.roles.includes('admin')||(user.roles.includes('teacher')&&activity.owner_account_id===user.id);
 const published=activityType==='paper4_activity'?activity.status==='published':activity.state!=='Draft';
 if(!canManage){
  if(!user.roles.includes('student')||!published)fail(404,'NOT_FOUND','活动尚未开放');
  const participantTable=activityType==='assignment'?'assignment_participants':activityType==='timed'?'timed_practice_participants':'paper4_activity_participants';
  const fk=activityType==='assignment'?'assignment_id':activityType==='timed'?'practice_id':'paper_id';
  if(!(await db.query(`SELECT 1 FROM ${participantTable} WHERE ${fk}=$1 AND identity_id=$2${activityType==='paper4_activity'?'':' AND NOT exempt'}`,[activityId,user.identityId])).rowCount)fail(403,'FORBIDDEN','未分配此活动');
 }
 let frozen=Boolean(activity.archived_at)||published;
 if(activityType==='paper4_activity')frozen=Boolean(activity.archived_at)||!activity.starts_at||activity.starts_at<=activity.server_now||Boolean((await db.query('SELECT 1 FROM paper4_attempts WHERE paper_id=$1 LIMIT 1',[activityId])).rowCount);
 return {activity,canManage,frozen};
}

export async function readScholarshipRule(db,activityType,activityId){
 return scholarshipRuleShape((await db.query('SELECT * FROM luq_activity_rules WHERE activity_type=$1 AND activity_id=$2 ORDER BY rule_version DESC LIMIT 1',[activityType,activityId])).rows[0]);
}

export function checkScholarshipRuleVersion(rule,expectedVersion){
 if(integer(expectedVersion,0,1000000,'规则版本')!==rule.version)fail(409,'LUQ_RULE_CONFLICT','规则已更新，请刷新后核对');
}

// Callers must first authorize the write and lock the activity row in this transaction.
export async function saveScholarshipRule(db,{user,helpers},activityType,activityId,body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'VALIDATION','奖励规则格式无效');
 const settings=await getScholarshipSettings(db),previous=await readScholarshipRule(db,activityType,activityId);
 checkScholarshipRuleVersion(previous,body.expectedVersion);
 const amount=integer(body.amount,0,settings.activityRewardCap,'额外奖学金');
 const requireAll=body.requireAll??previous.requireAll;
 if(typeof requireAll!=='boolean'||(requireAll&&activityType!=='assignment'))fail(400,'VALIDATION','只有作业可以设置全部必做题通过奖励');
 const minimumAc=requireAll?1:integer(body.minimumAc,1,50,'达标 AC 题数');
 const minimumScore=requireAll?0:Number(body.minimumScore);
 if(!Number.isFinite(minimumScore)||minimumScore<0||minimumScore>100)fail(400,'VALIDATION','达标成绩百分比须为 0–100');
 const taskKind=enumValue(body.taskKind??'challenge',['challenge','learning','correction'],'任务类型');
 if(typeof body.allowSolutionAssisted!=='boolean')fail(400,'VALIDATION','请明确答案辅助提交的奖励资格');
 if(taskKind==='challenge'&&body.allowSolutionAssisted)fail(400,'VALIDATION','挑战任务不奖励提交前已提供完整答案的作答');
 const rule=one(await db.query(`INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,task_kind,allow_solution_assisted,created_by,require_all)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[activityType,activityId,previous.version+1,amount,minimumAc,minimumScore,taskKind,body.allowSolutionAssisted,user.id,requireAll]));
 await helpers.audit(db,user.id,'luq.rule_version','activity',activityId,{activityType,ruleId:rule.id,version:rule.rule_version,amount});
 return {rule:scholarshipRuleShape(rule),canManage:true,frozen:false,cap:settings.activityRewardCap};
}

export async function handleScholarshipRules(ctx){
 const {route,method,pool,user,body,url}=ctx;
 if(route!=='/scholarship/reward-rules'||!['GET','POST'].includes(method))return null;
 const activityType=method==='GET'?url.searchParams.get('activityType'):body.activityType;
 const activityId=method==='GET'?url.searchParams.get('activityId'):body.activityId;
 if(method==='GET'){
  if(activityType==='assignment'&&activityId===null){
   if(!user.roles.some(role=>role==='teacher'||role==='admin'))fail(403,'FORBIDDEN','需要教师权限');
   const {activityRewardCap:cap}=await getScholarshipSettings(pool);
   return {status:200,body:{rule:{...defaultScholarshipRule(),requireAll:true},canManage:true,frozen:false,cap}};
  }
  const {canManage,frozen}=await scholarshipActivityAccess(pool,user,activityType,activityId);
  const settings=await getScholarshipSettings(pool);
  return {status:200,body:{rule:await readScholarshipRule(pool,activityType,activityId),canManage,frozen,cap:settings.activityRewardCap}};
 }
 const result=await transaction(pool,async db=>{
  const {canManage,frozen}=await scholarshipActivityAccess(db,user,activityType,activityId,{lock:true});
  if(!canManage)fail(403,'FORBIDDEN','只能配置本人负责的活动');
  if(frozen)fail(409,'LUQ_RULE_FROZEN','奖励规则已经冻结；请在活动发布或开始前设置');
  return saveScholarshipRule(db,ctx,activityType,activityId,body);
 });
 return {status:200,body:result};
}
