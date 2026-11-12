import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { enumValue, fail, integer, uuid } from './security.mjs';
import { transaction } from './db.mjs';

const legacyAudienceSql=(alias,account)=>`(${alias}.platform_access_scope='all'
 OR ${alias}.platform_access_scope='students' AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=${account} AND a.identity_id=ANY(${alias}.platform_student_ids))
 OR ${alias}.platform_access_scope='schools' AND (EXISTS(SELECT 1 FROM school_memberships m WHERE m.account_id=${account} AND m.revoked_at IS NULL AND m.school_id=ANY(${alias}.platform_school_ids))
 OR EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=${account} AND o.school_id=ANY(${alias}.platform_school_ids))))`;

// Candidate audience only. Every content reader must also evaluate admission.
export function platformCourseAudienceSql(alias,account) {
 return `(EXISTS(SELECT 1 FROM platform_course_rules r WHERE r.course_id=${alias}.id AND r.active
  AND ((${alias}.platform_audience_scope='all' AND r.target_kind='all') OR (${alias}.platform_audience_scope='custom' AND r.target_kind<>'all'))
  AND (r.target_kind='all' OR r.target_kind='account' AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=${account} AND a.identity_id=r.identity_id)
   OR r.target_kind='independent' AND NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.account_id=${account} AND m.revoked_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=${account})
   OR r.target_kind='school' AND (EXISTS(SELECT 1 FROM school_memberships m WHERE m.account_id=${account} AND m.school_id=r.school_id AND m.revoked_at IS NULL)
    OR EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=${account} AND o.school_id=r.school_id))))
  OR NOT EXISTS(SELECT 1 FROM platform_course_rules r WHERE r.course_id=${alias}.id) AND ${legacyAudienceSql(alias,account)})`;
}
export async function platformCourseAdmission(db,id,accountId,options) {
 const { resolvePlatformCourseAdmission }=await import('./platform-course-eligibility.mjs');
 return typeof db.release==='function'?resolvePlatformCourseAdmission(db,id,accountId,options)
  :transaction(db,client=>resolvePlatformCourseAdmission(client,id,accountId,options));
}
export async function platformCourseEligible(db,id,accountId,options) {
 return (await platformCourseAdmission(db,id,accountId,options)).admission==='direct';
}
const ids=(value,maximum,label)=>{
 if(!Array.isArray(value)||value.length>maximum)fail(400,'VALIDATION',`${label}数量无效`);
 return [...new Set(value.map(id=>uuid(id,label).toLowerCase()))].sort();
};
const direct=()=>({admissionMode:'direct',prerequisiteCourseIds:[],minimumPoints:0});
const config=rule=>({admissionMode:rule.admission_mode??rule.admissionMode,prerequisiteCourseIds:rule.prerequisite_course_ids??rule.prerequisiteCourseIds,minimumPoints:rule.minimum_points??rule.minimumPoints});
export async function platformCourseRules(db,courseId) {
 return (await db.query('SELECT * FROM platform_course_rules WHERE course_id=$1 AND active ORDER BY rule_key',[courseId])).rows;
}
export async function platformAudiencePolicy(db,course) {
 const rows=await platformCourseRules(db,course.id);
 if(!rows.length)return course.platform_access_scope==='all'?{scope:'all',allRule:direct(),independentRule:null,schoolRules:[],accountRules:[]}
  :{scope:'custom',allRule:null,independentRule:null,schoolRules:course.platform_school_ids.map(schoolId=>({schoolId,...direct()})),accountRules:course.platform_student_ids.map(identityId=>({identityId,...direct()}))};
 const invitations=(await db.query(`SELECT rule_id,generation,expires_at,expires_at>clock_timestamp() AS active FROM platform_course_invitations
  WHERE course_id=$1 AND revoked_at IS NULL`,[course.id])).rows;
 const shape=row=>{const invite=invitations.find(item=>item.rule_id===row.id&&item.generation===row.generation);return {ruleId:row.id,generation:row.generation,...config(row),invitation:{active:Boolean(invite?.active),expiresAt:invite?.expires_at??null}};};
 const all=rows.find(r=>r.target_kind==='all'),independent=rows.find(r=>r.target_kind==='independent');
 return {scope:course.platform_audience_scope,allRule:all?shape(all):null,independentRule:independent?shape(independent):null,
  schoolRules:rows.filter(r=>r.target_kind==='school').map(r=>({schoolId:r.school_id,...shape(r)})),
  accountRules:rows.filter(r=>r.target_kind==='account').map(r=>({identityId:r.identity_id,...shape(r)}))};
}
function normalizeRule(value,target,oldRules) {
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_AUDIENCE_POLICY','准入规则无效');
 const key=target.kind==='school'?`school:${target.id}`:target.kind==='account'?`account:${target.id}`:target.kind;
 const previous=oldRules.find(rule=>rule.rule_key===key);
 if(value.ruleId!==undefined&&value.ruleId!==previous?.id||value.generation!==undefined&&value.generation!==previous?.generation)
  fail(409,'COURSE_POLICY_CHANGED','准入规则已更改，请重新载入');
 return {key,kind:target.kind,targetId:target.id??null,
  admissionMode:enumValue(value.admissionMode??'direct',['direct','application','invite'],'准入方式'),
  prerequisiteCourseIds:ids(value.prerequisiteCourseIds??[],20,'前置课程 ID'),minimumPoints:integer(value.minimumPoints??0,0,1000000000,'积分门槛')};
}
export async function platformCourseAudience(db,body,old={}) {
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('platform-course-dependencies',0))");
 const courseId=old.id??body.requestId;
 const oldRules=old.id?(await db.query('SELECT * FROM platform_course_rules WHERE course_id=$1',[old.id])).rows:[];
 let value=body.audiencePolicy;
 if(value===undefined){
  const sameLegacy=old.id&&(body.audienceScope===undefined||body.audienceScope===old.platform_access_scope||body.audienceScope==='custom')
   &&(body.schoolIds===undefined||isDeepStrictEqual(ids(body.schoolIds,500,'学校 ID'),[...old.platform_school_ids].sort()))
   &&(body.studentIds===undefined||isDeepStrictEqual(ids(body.studentIds,5000,'学生 ID'),[...old.platform_student_ids].sort()));
  if(sameLegacy)value=await platformAudiencePolicy(db,old);
  else{
   if(oldRules.some(r=>r.active&&(r.admission_mode!=='direct'||r.minimum_points>0||r.prerequisite_course_ids.length)))
    fail(409,'AUDIENCE_POLICY_REQUIRED','请使用完整准入规则编辑器，不能用旧范围字段覆盖准入条件');
   const scope=enumValue(body.audienceScope??old.platform_access_scope??'all',['all','schools','students'],'公开范围');
   value={scope:scope==='all'?'all':'custom',allRule:scope==='all'?direct():null,independentRule:null,
    schoolRules:scope==='schools'?ids(body.schoolIds??old.platform_school_ids??[],500,'学校 ID').map(schoolId=>({schoolId,...direct()})):[],
    accountRules:scope==='students'?ids(body.studentIds??old.platform_student_ids??[],5000,'学生 ID').map(identityId=>({identityId,...direct()})):[]};
  }
 }
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_AUDIENCE_POLICY','公开范围规则无效');
 const scope=enumValue(value.scope,['all','custom'],'公开范围'),rules=[];
 if(scope==='all')rules.push(normalizeRule(value.allRule??direct(),{kind:'all'},oldRules));
 else{
  if(value.independentRule)rules.push(normalizeRule(value.independentRule,{kind:'independent'},oldRules));
  for(const [name,kind,idField,max] of [['schoolRules','school','schoolId',500],['accountRules','account','identityId',5000]]){
   const selected=value[name]??[];
   if(!Array.isArray(selected)||selected.length>max)fail(400,'INVALID_AUDIENCE_POLICY','目标人群数量无效');
   for(const rule of selected)rules.push(normalizeRule(rule,{kind,id:uuid(rule?.[idField],idField).toLowerCase()},oldRules));
  }
  if(!rules.length)fail(400,'COURSE_AUDIENCE_REQUIRED','请选择至少一种目标人群');
 }
 if(new Set(rules.map(r=>r.key)).size!==rules.length)fail(400,'INVALID_AUDIENCE_POLICY','目标人群不能重复');
 const schoolIds=rules.filter(r=>r.kind==='school').map(r=>r.targetId).sort(),studentIds=rules.filter(r=>r.kind==='account').map(r=>r.targetId).sort();
 if(schoolIds.length&&(await db.query('SELECT id FROM schools WHERE id=ANY($1::uuid[])',[schoolIds])).rowCount!==schoolIds.length)fail(400,'VALIDATION','所选学校不存在');
 if(studentIds.length&&(await db.query(`SELECT i.id FROM identities i WHERE i.id=ANY($1::uuid[]) AND i.kind IN ('student','personal') AND i.archived_at IS NULL
  AND EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL)`,[studentIds])).rowCount!==studentIds.length)
  fail(400,'VALIDATION','所选账号无效');
 const prerequisites=[...new Set(rules.flatMap(r=>r.prerequisiteCourseIds))];
 if(prerequisites.includes(courseId))fail(400,'COURSE_PREREQUISITE_CYCLE','课程不能以自身为前置');
 if(prerequisites.length&&(await db.query(`SELECT id FROM learning_paths WHERE id=ANY($1::uuid[]) AND owner_scope='platform'
  AND published_at IS NOT NULL AND archived_at IS NULL AND withdrawn_at IS NULL`,[prerequisites])).rowCount!==prerequisites.length)
  fail(400,'INVALID_COURSE_PREREQUISITE','前置课程必须是有效的已发布平台课程');
 const graph=new Map();
 for(const row of (await db.query('SELECT course_id,prerequisite_course_ids FROM platform_course_rules WHERE active')).rows)
  if(row.course_id!==courseId)graph.set(row.course_id,[...(graph.get(row.course_id)??[]),...row.prerequisite_course_ids]);
 const visiting=new Set(),visited=new Set();
 const visit=id=>{if(id===courseId||visiting.has(id))fail(400,'COURSE_PREREQUISITE_CYCLE','前置课程不能形成循环');if(visited.has(id))return;visiting.add(id);for(const next of graph.get(id)??[])visit(next);visiting.delete(id);visited.add(id);};
 for(const id of prerequisites)visit(id);
 const legacyScope=scope==='all'?'all':rules.every(r=>r.kind==='school')?'schools':rules.every(r=>r.kind==='account')?'students':'all';
 return {scope:legacyScope,schoolIds:legacyScope==='schools'?schoolIds:[],studentIds:legacyScope==='students'?studentIds:[],policyScope:scope,rules};
}
export async function savePlatformCourseAudience(db,courseId,audience) {
 await db.query('UPDATE learning_paths SET platform_audience_scope=$2 WHERE id=$1',[courseId,audience.policyScope]);
 const previous=(await db.query('SELECT * FROM platform_course_rules WHERE course_id=$1',[courseId])).rows;
 for(const rule of audience.rules){
  const before=previous.find(row=>row.rule_key===rule.key),changed=!before?.active||!isDeepStrictEqual(config(before),config(rule));
  if(before){if(changed)await db.query(`UPDATE platform_course_rules SET active=true,admission_mode=$2,prerequisite_course_ids=$3,
   minimum_points=$4,generation=$5,updated_at=clock_timestamp() WHERE id=$1`,[before.id,rule.admissionMode,rule.prerequisiteCourseIds,rule.minimumPoints,randomUUID()]);}
  else await db.query(`INSERT INTO platform_course_rules(course_id,rule_key,target_kind,school_id,identity_id,admission_mode,prerequisite_course_ids,minimum_points)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[courseId,rule.key,rule.kind,rule.kind==='school'?rule.targetId:null,rule.kind==='account'?rule.targetId:null,rule.admissionMode,rule.prerequisiteCourseIds,rule.minimumPoints]);
 }
 await db.query('UPDATE platform_course_rules SET active=false,updated_at=clock_timestamp() WHERE course_id=$1 AND active AND NOT(rule_key=ANY($2::text[]))',[courseId,audience.rules.map(r=>r.key)]);
}
