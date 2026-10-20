import {transaction} from './db.mjs';
import {enumValue,fail,integer,uuid} from './security.mjs';
import {getLuqSettings} from './luq-ledger.mjs';

const one=result=>{if(!result.rowCount)fail(404,'NOT_FOUND','活动不存在');return result.rows[0];};
const types=['assignment','timed','paper4_activity'];
export const defaultLuqRule=()=>({amount:0,minimumAc:1,minimumScore:0,taskKind:'challenge',allowSolutionAssisted:false,version:0});
export function luqRuleShape(rule){return rule?{id:rule.id,amount:rule.amount,minimumAc:rule.minimum_ac,minimumScore:Number(rule.minimum_score),taskKind:rule.task_kind,allowSolutionAssisted:rule.allow_solution_assisted,version:rule.rule_version,createdAt:rule.created_at}:defaultLuqRule();}

// Lock the same activity row as publication/admission. A reward rule cannot
// race with publication or be silently changed after students can start.
export async function luqActivityAccess(db,user,activityType,activityId,{lock=false}={}){
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

export async function readLuqRule(db,activityType,activityId){
 return luqRuleShape((await db.query('SELECT * FROM luq_activity_rules WHERE activity_type=$1 AND activity_id=$2 ORDER BY rule_version DESC LIMIT 1',[activityType,activityId])).rows[0]);
}

export async function handleLuqRules(ctx){
 const {route,method,pool,user,body,url,helpers}=ctx;
 if(route!=='/luq/reward-rules'||!['GET','POST'].includes(method))return null;
 const activityType=method==='GET'?url.searchParams.get('activityType'):body.activityType;
 const activityId=method==='GET'?url.searchParams.get('activityId'):body.activityId;
 if(method==='GET'){
  const {canManage,frozen}=await luqActivityAccess(pool,user,activityType,activityId);
  const settings=await getLuqSettings(pool);
  return {status:200,body:{rule:await readLuqRule(pool,activityType,activityId),canManage,frozen,cap:settings.activityRewardCap}};
 }
 const result=await transaction(pool,async db=>{
  const {canManage,frozen}=await luqActivityAccess(db,user,activityType,activityId,{lock:true});
  if(!canManage)fail(403,'FORBIDDEN','只能配置本人负责的活动');
  if(frozen)fail(409,'LUQ_RULE_FROZEN','奖励规则已经冻结；请在活动发布或开始前设置');
  const settings=await getLuqSettings(db),previous=await readLuqRule(db,activityType,activityId);
  if(integer(body.expectedVersion,0,1000000,'规则版本')!==previous.version)fail(409,'LUQ_RULE_CONFLICT','规则已更新，请刷新后核对');
  const amount=integer(body.amount,0,settings.activityRewardCap,'额外 Luq');
  const minimumAc=integer(body.minimumAc,1,50,'达标 AC 题数');
  const minimumScore=Number(body.minimumScore);
  if(!Number.isFinite(minimumScore)||minimumScore<0||minimumScore>100)fail(400,'VALIDATION','达标成绩百分比须为 0–100');
  const taskKind=enumValue(body.taskKind??'challenge',['challenge','learning','correction'],'任务类型');
  if(typeof body.allowSolutionAssisted!=='boolean')fail(400,'VALIDATION','请明确答案辅助提交的奖励资格');
  if(taskKind==='challenge'&&body.allowSolutionAssisted)fail(400,'VALIDATION','挑战任务不奖励提交前已提供完整答案的作答');
  const rule=one(await db.query(`INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,task_kind,allow_solution_assisted,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[activityType,activityId,previous.version+1,amount,minimumAc,minimumScore,taskKind,body.allowSolutionAssisted,user.id]));
  await helpers.audit(db,user.id,'luq.rule_version','activity',activityId,{activityType,ruleId:rule.id,version:rule.rule_version,amount});
  return {rule:luqRuleShape(rule),canManage:true,frozen:false,cap:settings.activityRewardCap};
 });
 return {status:200,body:result};
}
