import {fail,uuid,field,enumValue} from './security.mjs';
import {problemPermissions} from './library.mjs';
import {luqActivityAccess} from './luq-rules.mjs';

const one=result=>{if(!result.rowCount)fail(404,'NOT_FOUND','题目或活动不存在');return result.rows[0];};
export const isLuqStaff=user=>user.roles.includes('admin')||user.roles.includes('teacher');
export const assistanceKind=value=>enumValue(value,['FULL_TRANSLATION','FULL_SOLUTION'],'辅助类型');
export function assistanceLanguage(kind,value){
 if(kind==='FULL_SOLUTION'){if(value&&value!=='')fail(400,'VALIDATION','完整题解不使用目标语言参数');return '';}
 return enumValue(value??'zh-CN',['zh-CN'],'目标语言');
}
export async function lockLuqAssistance(db,identityId){
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-assistance:'||$1::text,0))",[identityId]);
}
export async function hasProvidedSolution(db,identityId,subjectKey){
 return (await db.query(`SELECT EXISTS(SELECT 1 FROM luq_assistance_deliveries
  WHERE identity_id=$1 AND subject_key=$2 AND kind='FULL_SOLUTION') used`,[identityId,subjectKey])).rows[0].used;
}

// Read only public statement/version identifiers here; never reference code or judge data.
export async function resolveAssistanceTarget(db,user,input,{manage=false,helpers={}}={}){
 if(!manage&&!user.roles.includes('student'))fail(403,'FORBIDDEN','仅学生可使用助学内容');
 if(manage&&!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
 if(input.problemId){
  if(input.paper4AttemptId||input.paperId)fail(400,'VALIDATION','只能指定一种题目');
  const problemId=uuid(input.problemId),versionId=uuid(input.versionId);
  let p,v,permissions;
  if(helpers.versionAccess){({p,v,permissions}=await helpers.versionAccess(db,user,problemId,versionId));}
  else{
   p=one(await db.query('SELECT * FROM problems WHERE id=$1',[problemId]));
   v=one(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2',[versionId,problemId]));
   permissions=await problemPermissions(db,user,p,v);
   if(!permissions.canRead)fail(404,'NOT_FOUND','题目不存在');
  }
  if(manage&&!permissions.canEdit)fail(403,'FORBIDDEN','无权管理此题辅助内容');
  const target={subjectKey:`problem:${p.id}`,versionId:v.id,problemId:p.id,title:v.title,baseType:'problem',baseId:p.id,contextType:'free',contextId:null};
  if(!manage&&input.assignmentId){
   if(input.timedAttemptId)fail(400,'VALIDATION','不能混用活动上下文');
   const a=one(await db.query(`SELECT a.* FROM assignments a JOIN assignment_problems ap ON ap.assignment_id=a.id
    JOIN assignment_participants part ON part.assignment_id=a.id AND part.identity_id=$2 AND NOT part.exempt
    WHERE a.id=$1 AND a.state='Published' AND ap.problem_id=$3 AND ap.version_id=$4`,[uuid(input.assignmentId),user.identityId,p.id,v.id]));
   target.contextType='assignment';target.contextId=a.id;
  }
  if(!manage&&input.timedAttemptId){
   const a=one(await db.query(`SELECT t.id,tp.id practice_id FROM timed_attempts t JOIN timed_practices tp ON tp.id=t.practice_id
    JOIN timed_practice_problems p ON p.practice_id=tp.id JOIN timed_practice_participants part
    ON part.practice_id=tp.id AND part.identity_id=t.identity_id AND NOT part.exempt
    WHERE t.id=$1 AND t.identity_id=$2 AND p.problem_id=$3 AND p.version_id=$4 AND tp.state<>'Draft'`,[uuid(input.timedAttemptId),user.identityId,p.id,v.id]));
   target.contextType='timed';target.contextId=a.practice_id;
  }
  return target;
 }
 let p;
 if(manage){
  const paperId=uuid(input.paperId),versionId=uuid(input.versionId);
  p=one(await db.query(`SELECT p.*,v.id version_id,v.definition,v.published_at version_published_at,v.starts_at,v.ends_at,
   sv.definition source_definition FROM paper4_papers p JOIN paper4_versions v ON v.paper_id=p.id
   LEFT JOIN paper4_versions sv ON sv.id=p.source_version_id WHERE p.id=$1 AND v.id=$2`,[paperId,versionId]));
  if(!user.roles.includes('admin')&&p.owner_account_id!==user.id)fail(403,'FORBIDDEN','无权管理此试卷辅助内容');
 }else{
  p=one(await db.query(`SELECT p.*,v.id version_id,v.definition,v.published_at version_published_at,v.starts_at,v.ends_at,
   a.id attempt_id,a.released_at,sv.definition source_definition FROM paper4_attempts a
   JOIN paper4_papers p ON p.id=a.paper_id JOIN paper4_versions v ON v.id=a.version_id
   LEFT JOIN paper4_versions sv ON sv.id=p.source_version_id WHERE a.id=$1 AND a.identity_id=$2`,[uuid(input.paper4AttemptId),user.identityId]));
  if(p.status!=='published'||!p.version_published_at||p.archived_at)fail(404,'NOT_FOUND','试卷不可用');
  if(p.starts_at&&new Date(p.starts_at)>new Date())fail(403,'NOT_STARTED','活动尚未开始');
  if(p.delivery_kind==='activity'&&!(await db.query('SELECT 1 FROM paper4_activity_participants WHERE paper_id=$1 AND identity_id=$2',[p.id,user.identityId])).rowCount)fail(403,'FORBIDDEN','未分配此活动');
 }
 const questionKey=field(input.questionKey,'大题键',{max:40});
 const question=p.definition.questions.find(q=>q.key===questionKey);
 if(!question)fail(404,'NOT_FOUND','大题不存在');
 // An immutable activity copy may reuse the exact source content. Edited copies require their own reviewed content.
 const sameSource=p.source_version_id&&JSON.stringify(p.definition)===JSON.stringify(p.source_definition);
 if(manage&&sameSource&&!user.roles.includes('admin')){
  const source=one(await db.query('SELECT owner_account_id FROM paper4_papers WHERE id=$1',[p.source_paper_id]));
  if(source.owner_account_id!==user.id)fail(403,'FORBIDDEN','共享的原卷辅助内容须由原卷教师或管理员维护');
 }
 return {subjectKey:`paper4:${p.source_paper_id??p.id}:${questionKey}`,versionId:sameSource?p.source_version_id:p.version_id,
  paperId:p.id,questionKey,title:question.title,baseType:'paper4',baseId:p.source_paper_id??p.id,
  contextType:p.delivery_kind==='activity'?'paper4_activity':'free',contextId:p.delivery_kind==='activity'?p.id:null};
}

export async function assistancePolicyTarget(db,user,targetType,targetId,{write=false}={}){
 if(!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
 enumValue(targetType,['problem','paper4','assignment','timed','paper4_activity'],'规则目标');
 uuid(targetId);
 let row;
 if(targetType==='problem'){
  row=one(await db.query(`SELECT * FROM problems WHERE id=$1${write?' FOR UPDATE':''}`,[targetId]));
  const version=one(await db.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC LIMIT 1',[targetId]));
  if(!(await problemPermissions(db,user,row,version)).canEdit)fail(403,'FORBIDDEN','无权管理此题');
  return row;
 }
 if(['assignment','timed','paper4_activity'].includes(targetType)){
  const access=await luqActivityAccess(db,user,targetType,targetId,{lock:write});
  if(!access.canManage)fail(403,'FORBIDDEN','只能管理本人负责的活动');
  if(write&&access.frozen)fail(409,'RULE_FROZEN','活动辅助规则已冻结，请在发布或开始前设置');
  return access.activity;
 }
 row=one(await db.query(`SELECT * FROM paper4_papers WHERE id=$1${write?' FOR UPDATE':''}`,[targetId]));
 if(!user.roles.includes('admin')&&row.owner_account_id!==user.id)fail(403,'FORBIDDEN','只能管理本人负责的试卷');
 if(row.delivery_kind!=='catalog')fail(400,'VALIDATION','请选择自由练习试卷');
 return row;
}

async function latestPolicy(db,type,id,kind){
 return (await db.query(`SELECT mode,opens_at,price,rule_version FROM luq_assistance_policies
  WHERE target_type=$1 AND target_id=$2 AND kind=$3 ORDER BY rule_version DESC LIMIT 1`,[type,id,kind])).rows[0];
}
export function policyAvailability(policy,now=new Date()){
 if(policy?.mode==='disabled')return {mode:'disabled',reason:'此处未开放此辅助内容'};
 if(policy?.opens_at&&new Date(policy.opens_at)>now)return {mode:'disabled',reason:'尚未到辅助内容开放时间',opensAt:policy.opens_at};
 return {mode:policy?.mode??'paid',price:policy?.price??null};
}

// Query all assigned restrictions for this stable subject, not only the caller-supplied context.
// An old version, library link or course link must not become an assessment back door.
export async function resolveAssistancePolicy(db,user,target,kind){
 const base=policyAvailability(await latestPolicy(db,target.baseType,target.baseId,kind));
 if(base.mode==='disabled')return base;
 let result=base;
 const relevant=[];
 if(target.problemId){
  const assignments=(await db.query(`SELECT a.id FROM assignments a JOIN assignment_problems ap ON ap.assignment_id=a.id
   JOIN assignment_participants part ON part.assignment_id=a.id AND part.identity_id=$1 AND NOT part.exempt
   WHERE ap.problem_id=$2 AND a.state='Published' AND a.archived_at IS NULL AND a.due_at>=clock_timestamp()`,[user.identityId,target.problemId])).rows;
  relevant.push(...assignments.map(a=>({type:'assignment',id:a.id,defaultMode:'paid'})));
  const timed=(await db.query(`SELECT tp.id FROM timed_practices tp JOIN timed_practice_problems p ON p.practice_id=tp.id
   JOIN timed_practice_participants part ON part.practice_id=tp.id AND part.identity_id=$1 AND NOT part.exempt
   WHERE p.problem_id=$2 AND tp.state<>'Draft' AND tp.results_published_at IS NULL AND tp.archived_at IS NULL
    AND tp.starts_at<=clock_timestamp()`,[user.identityId,target.problemId])).rows;
  relevant.push(...timed.map(a=>({type:'timed',id:a.id,defaultMode:'disabled'})));
 }else{
  const papers=(await db.query(`SELECT p.id,p.activity_kind,a.released_at FROM paper4_papers p
   JOIN paper4_versions v ON v.id=p.current_version_id JOIN paper4_activity_participants part ON part.paper_id=p.id AND part.identity_id=$1
   LEFT JOIN LATERAL (SELECT released_at FROM paper4_attempts pa WHERE pa.paper_id=p.id AND pa.identity_id=$1 ORDER BY attempt_number DESC LIMIT 1) a ON true
   WHERE COALESCE(p.source_paper_id,p.id)=$2 AND p.delivery_kind='activity' AND p.status='published' AND p.archived_at IS NULL
    AND (v.starts_at IS NULL OR v.starts_at<=clock_timestamp()) AND (
     p.activity_kind='exam' AND a.released_at IS NULL OR p.activity_kind<>'exam' AND (v.ends_at IS NULL OR v.ends_at>=clock_timestamp()))`,[user.identityId,target.baseId])).rows;
  relevant.push(...papers.map(a=>({type:'paper4_activity',id:a.id,defaultMode:a.activity_kind==='exam'?'disabled':'paid'})));
 }
 const selected=target.contextId?await latestPolicy(db,target.contextType,target.contextId,kind):null;
 if(selected){result={...policyAvailability(selected),price:base.price};if(result.mode==='disabled')return result;}
 for(const item of relevant){
  const policy=await latestPolicy(db,item.type,item.id,kind);
  if(!policy&&item.defaultMode==='paid')continue;
  const available=policyAvailability(policy??{mode:item.defaultMode});
  if(available.mode==='disabled')return {...available,reason:'当前已分配的活动限制了此辅助内容'};
  // A free policy grants a contextual view only. A different active paid rule remains restrictive.
  if(available.mode==='paid'&&(item.type!==target.contextType||item.id!==target.contextId))result={mode:'paid',price:base.price};
 }
 return result;
}
