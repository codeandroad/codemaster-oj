import { platformCourseAudienceSql, platformCourseRules } from './platform-course-access.mjs';
import { platformPrerequisiteProgress, unavailablePrerequisite } from './platform-course-progress.mjs';
import { platformPoints } from './platform-points.mjs';

const denied=()=>({admission:'denied',admissionRules:[]});
const courseColumns='p.id,p.title,p.school_id,p.owner_scope,p.platform_audience_scope,p.required_language,p.language_credit_cutoffs';
const eligibleCourseSql=account=>`p.owner_scope='platform' AND p.published_at IS NOT NULL
 AND p.archived_at IS NULL AND p.withdrawn_at IS NULL
 AND (p.available_from IS NULL OR p.available_from<=clock_timestamp())
 AND (p.available_until IS NULL OR p.available_until>clock_timestamp())
 AND ${platformCourseAudienceSql('p',account)}`;

// One request owns this state and one transaction owns the account setting.
// Prefetch only admission metadata; lesson bundles, covers and translations
// are unnecessary for deciding whether the learner can open a course.
export async function resolvePlatformCourseAdmissions(db,courseIds,accountId) {
 const state={},output=new Map();
 if(!courseIds.length)return output;
 await identityContext(db,accountId,state);
 if(!state.user)return new Map(courseIds.map(id=>[id,denied()]));
 const principal=(await db.query("SELECT current_setting('campus.account_id',true) account")).rows[0].account??'';
 let failed=false;
 try {
  await db.query("SELECT set_config('campus.account_id',$1,true)",[accountId]);state.accountScoped=true;
  const courses=(await db.query(`SELECT ${courseColumns} FROM learning_paths p WHERE p.id=ANY($1::uuid[]) AND ${eligibleCourseSql('$2')}`,[courseIds,accountId])).rows;
  state.courses=new Map(courseIds.map(id=>[id,null]));for(const course of courses)state.courses.set(course.id,course);
  const ids=courses.map(course=>course.id);
  state.rules=new Map(ids.map(id=>[id,[]]));state.records=new Map(ids.map(id=>[id,[]]));
  if(ids.length){
   for(const row of (await db.query('SELECT * FROM platform_course_rules WHERE course_id=ANY($1::uuid[]) ORDER BY rule_key',[ids])).rows)state.rules.get(row.course_id).push(row);
   for(const row of (await db.query('SELECT * FROM platform_course_admissions WHERE course_id=ANY($1::uuid[]) AND account_id=$2',[ids,accountId])).rows)state.records.get(row.course_id).push(row);
  }
  for(const id of courseIds)output.set(id,await resolvePlatformCourseAdmission(db,id,accountId,{state}));
  return output;
 }catch(error){failed=true;throw error;}
 finally{try{await db.query("SELECT set_config('campus.account_id',$1,true)",[principal]);}catch(error){if(!failed)throw error;}}
}
async function identityContext(db,accountId,state) {
 if(state.user)return;
 state.user=(await db.query(`SELECT a.id,a.identity_id AS "identityId",i.name FROM accounts a JOIN identities i ON i.id=a.identity_id
  WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL`,[accountId])).rows[0];
 if(!state.user)return;
 state.schools=new Map((await db.query(`SELECT s.id,s.name FROM schools s WHERE EXISTS(
  SELECT 1 FROM school_memberships m WHERE m.school_id=s.id AND m.account_id=$1 AND m.revoked_at IS NULL)
  OR EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.school_id=s.id AND o.account_id=$1) ORDER BY s.id`,[accountId])).rows.map(row=>[row.id,row.name]));
 state.admissions=new Map();state.stack=new Set();state.progress=new Map();
}

export async function resolvePlatformCourseAdmission(db,courseId,accountId,{state={}}={}) {
 await identityContext(db,accountId,state);
 if(!state.user||state.stack.has(courseId))return denied();
 if(state.admissions.has(courseId))return state.admissions.get(courseId);
 const principal=state.accountScoped?null:(await db.query("SELECT current_setting('campus.account_id',true) account")).rows[0].account??'';
 let failed=false;
 try {
  if(!state.accountScoped)await db.query("SELECT set_config('campus.account_id',$1,true)",[accountId]);
  state.stack.add(courseId);
  const course=state.courses?.has(courseId)?state.courses.get(courseId):(await db.query(`SELECT ${courseColumns} FROM learning_paths p WHERE p.id=$1 AND ${eligibleCourseSql('$2')}`,[courseId,accountId])).rows[0];
  if(!course)return denied();
  const rules=(state.rules?.has(courseId)?state.rules.get(courseId).filter(rule=>rule.active):await platformCourseRules(db,courseId)).filter(rule=>(course.platform_audience_scope==='all')===(rule.target_kind==='all')
   &&(rule.target_kind==='all'||rule.target_kind==='independent'&&state.schools.size===0
    ||rule.target_kind==='school'&&state.schools.has(rule.school_id)||rule.target_kind==='account'&&rule.identity_id===state.user.identityId));
  if(!rules.length){
   const any=state.rules?.has(courseId)?state.rules.get(courseId).length:(await db.query('SELECT 1 FROM platform_course_rules WHERE course_id=$1 LIMIT 1',[courseId])).rowCount;
   return any?denied():{admission:'direct',admissionRules:[]};
  }
  const records=state.records?.get(courseId)??(await db.query('SELECT * FROM platform_course_admissions WHERE course_id=$1 AND account_id=$2',[courseId,accountId])).rows;
  // The shared request cache must not change metadata for courses that do not
  // evaluate points: their standalone entry has always reported zero here.
  const currentPoints = rules.some(rule => rule.minimum_points > 0)
   ? (state.points ??= await platformPoints(db, accountId)) : 0;
  const output=[];
  for(const rule of rules){
   const schoolId = rule.target_kind === 'school' ? rule.school_id : null;
   const points = { source: 'platform', current: currentPoints, required: rule.minimum_points };
   const prerequisites=[];
   for(const prerequisiteId of rule.prerequisite_course_ids){
    const access=await resolvePlatformCourseAdmission(db,prerequisiteId,accountId,{state});
    if(access.admission!=='direct'){
     const blocked=unavailablePrerequisite(prerequisiteId);
     if(access.admission!=='denied'){
      const meta=state.courses?.get(prerequisiteId)??(await db.query('SELECT title FROM learning_paths WHERE id=$1',[prerequisiteId])).rows[0];
      Object.assign(blocked,{title:meta.title,canOpen:true,requiresAdmission:true});
     }
     prerequisites.push(blocked);continue;
    }
    const key=`${prerequisiteId}:${schoolId??'public'}`;
    if(!state.progress.has(key)){
     const prerequisite=state.courses?.get(prerequisiteId)??(await db.query(`SELECT ${courseColumns} FROM learning_paths p WHERE p.id=$1 AND p.owner_scope='platform'`,[prerequisiteId])).rows[0];
     state.progress.set(key,await platformPrerequisiteProgress(db,prerequisite,state.user,{schoolId,schoolIds:[...state.schools.keys()]}));
    }
    prerequisites.push(state.progress.get(key));
   }
   const record=records.find(row=>row.rule_id===rule.id&&row.generation===rule.generation);
   const requirementMode = rule.requirement_mode;
   const conditions = prerequisites.map(item => item.completed);
   if (points.required > 0) conditions.push(points.current >= points.required);
   const requirementsMet = !conditions.length || (requirementMode === 'any'
    ? conditions.some(Boolean) : conditions.every(Boolean));
   const granted=requirementsMet&&(rule.admission_mode==='direct'||record?.status==='approved'&&record.origin===rule.admission_mode);
   output.push({ruleId:rule.id,generation:rule.generation,targetKind:rule.target_kind,
    ...(rule.target_kind==='account'?{accountName:state.user.name}:{}),
    ...(schoolId?{schoolId,schoolName:state.schools.get(schoolId)}:{}),admissionMode:rule.admission_mode,
    requirementMode,requirementsMet,granted,applicationStatus:record?.status??'none',...(record?{applicationId:record.id}:{}),points,prerequisites});
  }
  const ready=output.filter(rule=>rule.requirementsMet);
  const admission=output.some(rule=>rule.granted)?'direct':ready.some(rule=>rule.admissionMode==='application'&&rule.applicationStatus==='none')?'apply'
   :ready.some(rule=>rule.admissionMode==='invite'&&rule.applicationStatus!=='revoked')?'invite'
   :ready.some(rule=>rule.applicationStatus==='pending')?'pending':ready.some(rule=>['rejected','revoked'].includes(rule.applicationStatus))?'rejected':'requirements';
  const result={admission,admissionRules:output};state.admissions.set(courseId,result);return result;
 } catch(error){failed=true;throw error;}
 finally {
  state.stack?.delete(courseId);
  try{if(!state.accountScoped)await db.query("SELECT set_config('campus.account_id',$1,true)",[principal]);}catch(error){if(!failed)throw error;}
 }
}
