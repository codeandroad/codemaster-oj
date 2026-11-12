import { createHmac, randomInt } from 'node:crypto';
import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { platformCourseAdmission } from './platform-course-access.mjs';
import { courseEntry } from './public-course-entry.mjs';
import { platformCourseListings } from './platform-public-course.mjs';
import { requireCourseAcslSchool } from './course-acsl.mjs';
import { enumValue, fail, integer, safeEqual, uuid } from './security.mjs';

const reply=(body,status=200)=>({body,status});
const alphabet='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeHash=(secret,courseId,ruleId,generation,code)=>createHmac('sha256',secret)
 .update(`platform-course-invitation\0${courseId}\0${ruleId}\0${generation}\0${code}`).digest('hex');
async function principal(db,user,{platform=false}={}) {
 await activeAccount(db,user.id);
 if(platform&&!await isPlatformAdministrator(db,user.id))fail(403,'PLATFORM_ADMIN_REQUIRED','需要平台管理员权限');
 await db.query("SELECT set_config('campus.account_id',$1,true),set_config('campus.school_id',$2,true)",[user.id,LEGACY_SCHOOL_ID]);
}
async function course(db,id,{lock=false}={}) {
 const row=(await db.query(`SELECT * FROM learning_paths WHERE id=$1 AND owner_scope='platform' ${lock?'FOR UPDATE':''}`,[uuid(id)])).rows[0];
 if(!row)fail(404,'NOT_FOUND','平台课程不存在');return row;
}
async function currentRule(db,p,ruleId,generation) {
 const rule=(await db.query(`SELECT * FROM platform_course_rules WHERE course_id=$1 AND id=$2 AND active`,[p.id,uuid(ruleId,'准入规则 ID')])).rows[0];
 if(!rule||rule.generation!==generation)fail(409,'COURSE_POLICY_CHANGED','准入规则已更改，请重新载入');return rule;
}
async function learnerRule(db,p,user,body) {
 const access=await platformCourseAdmission(db,p.id,user.id);
 if(access.admission==='denied')fail(404,'NOT_FOUND','课程不存在或不在开放范围');
 const rule=await currentRule(db,p,body.ruleId,body.generation);
 const state=access.admissionRules.find(item=>item.ruleId===rule.id);
 if(!state)fail(404,'NOT_FOUND','课程不存在或不在开放范围');
 if(!state.requirementsMet)fail(403,'COURSE_REQUIREMENTS_NOT_MET','请先满足前置课程和积分要求');
 return {rule,state};
}
async function audit(db,user,action,detail) {
 await db.query('INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,$2,$3)',[user.id,`platform.course.${action}`,detail]);
}

// Commit rate accounting before evaluating a secret. A rejected redemption
// must not roll its failure counter back, including across API processes.
async function invitationAttempt(pool,user,courseId) {
 const allowed=await transaction(pool,async db=>{
  await principal(db,user);
  const buckets=[[`account:${user.id}`,20],[`account-course:${user.id}:${courseId}`,5],[`course:${courseId}`,300]].sort(([a],[b])=>a.localeCompare(b));
  let okay=true;
  for(const [key,limit] of buckets){
   const row=(await db.query(`INSERT INTO platform_course_invitation_attempts(bucket_key,attempts) VALUES($1,1)
    ON CONFLICT(bucket_key) DO UPDATE SET
     attempts=CASE WHEN platform_course_invitation_attempts.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE platform_course_invitation_attempts.attempts+1 END,
     window_started_at=CASE WHEN platform_course_invitation_attempts.window_started_at<=clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE platform_course_invitation_attempts.window_started_at END
    RETURNING attempts`,[key])).rows[0];
   okay&&=row.attempts<=limit;
  }
  return okay;
 });
 if(!allowed)fail(429,'COURSE_INVITATION_RATE_LIMIT','尝试次数过多，请在 15 分钟后重试');
}

export async function handlePlatformCourseAdmissions(ctx) {
 const {pool,user,route,method,body={},url,config}=ctx;
 const admin=route.match(/^\/platform\/courses\/([^/]+)\/(admissions(?:\/([^/]+)\/decision)?|rules\/([^/]+)\/invitation)$/);
 if(admin){
  if(method!=='GET'&&method!=='POST')return null;
  return transaction(pool,async db=>{
   await principal(db,user,{platform:true});
   const p=await course(db,admin[1],{lock:method==='POST'});
   if(admin[2]==='admissions'&&method==='GET'){
    const page=integer(Number(url.searchParams.get('page')??1),1,100000,'页码');
    const status=url.searchParams.get('status');if(status)enumValue(status,['pending','approved','rejected','revoked'],'申请状态');
    const rows=(await db.query(`SELECT g.id,g.rule_id AS "ruleId",g.generation,g.account_id AS "accountId",i.name,a.username,
      g.status,g.origin,g.created_at AS "createdAt",g.decided_at AS "decidedAt",r.target_kind AS "targetKind",s.name AS "schoolName",
      (r.active AND r.generation=g.generation) AS current
     FROM platform_course_admissions g JOIN platform_course_rules r ON r.id=g.rule_id
     JOIN accounts a ON a.id=g.account_id JOIN identities i ON i.id=a.identity_id LEFT JOIN schools s ON s.id=r.school_id
     WHERE g.course_id=$1 AND ($2::text IS NULL OR g.status=$2)
      AND ($2::text IS DISTINCT FROM 'pending' OR r.active AND r.generation=g.generation)
     ORDER BY (g.status='pending' AND r.active AND r.generation=g.generation) DESC,g.created_at,g.id LIMIT 51 OFFSET $3`,[p.id,status,(page-1)*50])).rows;
    return reply({items:rows.slice(0,50),page,hasMore:rows.length>50});
   }
   if(method!=='POST')return null;
   if(admin[3]){
    const row=(await db.query('SELECT * FROM platform_course_admissions WHERE id=$1 AND course_id=$2 FOR UPDATE',[uuid(admin[3]),p.id])).rows[0];
    if(!row)fail(404,'NOT_FOUND','申请不存在');
    const rule=await currentRule(db,p,row.rule_id,body.generation);
    if(row.generation!==rule.generation)fail(409,'COURSE_POLICY_CHANGED','准入规则已更改，请重新载入');
    const action=enumValue(body.action,['approve','reject','revoke'],'处理结果');
    const expected=enumValue(body.expectedStatus,['pending','approved','rejected','revoked'],'申请状态');
    if(expected!==row.status||action==='revoke'&&row.status!=='approved')fail(409,'COURSE_APPLICATION_CHANGED','申请状态已改变');
    if(action==='approve'){
     const access=await platformCourseAdmission(db,p.id,row.account_id);
     if(!access.admissionRules.find(item=>item.ruleId===rule.id)?.requirementsMet)fail(403,'COURSE_REQUIREMENTS_NOT_MET','申请人当前未满足准入条件');
    }
    const status={approve:'approved',reject:'rejected',revoke:'revoked'}[action];
    await db.query('UPDATE platform_course_admissions SET status=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$1',[row.id,status,user.id]);
    await audit(db,user,`admission.${action}`,{courseId:p.id,ruleId:rule.id,applicationId:row.id});return reply({status});
   }
   const rule=await currentRule(db,p,admin[4],body.generation);
   if(rule.admission_mode!=='invite')fail(409,'COURSE_POLICY_CHANGED','当前规则不使用邀请码');
   const action=enumValue(body.action,['rotate','revoke'],'邀请码操作');
   await db.query('UPDATE platform_course_invitations SET revoked_at=clock_timestamp() WHERE rule_id=$1 AND generation=$2 AND revoked_at IS NULL',[rule.id,rule.generation]);
   if(action==='revoke'){await audit(db,user,'invitation.revoked',{courseId:p.id,ruleId:rule.id});return reply({ruleId:rule.id,generation:rule.generation,active:false,expiresAt:null});}
   const days=integer(body.expiresInDays??7,1,30,'有效天数'),code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');
   const invitation=(await db.query(`INSERT INTO platform_course_invitations(course_id,rule_id,generation,code_hash,issued_by,expires_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6::integer*interval '1 day')) RETURNING expires_at`,
   [p.id,rule.id,rule.generation,codeHash(config.secret,p.id,rule.id,rule.generation,code),user.id,days])).rows[0];
   await audit(db,user,'invitation.rotated',{courseId:p.id,ruleId:rule.id,expiresAt:invitation.expires_at});
   return reply({ruleId:rule.id,generation:rule.generation,code,active:true,expiresAt:invitation.expires_at});
  });
 }
 const student=route.match(/^\/practice\/courses\/([^/]+)\/(applications|invitations\/redeem)$/);
 if(!student||method!=='POST')return null;
 const listing=await transaction(pool,async db=>{
  await principal(db,user);return (await platformCourseListings(db,uuid(student[1])))[0];
 });
 if(!listing)return student[2]==='applications'?null:reply({error:{code:'NOT_FOUND',message:'课程不存在'}},404);
 if(student[2]!=='applications')await invitationAttempt(pool,user,listing.course_id);
 return transaction(pool,async db=>{
  await principal(db,user);
  if(url.searchParams.has('schoolId'))await requireCourseAcslSchool(db,uuid(url.searchParams.get('schoolId')),user);
  const p=await course(db,listing.course_id,{lock:true}),{rule,state}=await learnerRule(db,p,user,body);
  let created=false;
  if(student[2]==='applications'){
   if(rule.admission_mode!=='application')fail(409,'COURSE_POLICY_CHANGED','当前规则不接受申请');
   if(['rejected','revoked'].includes(state.applicationStatus))fail(403,'COURSE_ADMISSION_REVOKED','请联系平台管理员处理已有申请');
   const result=await db.query(`INSERT INTO platform_course_admissions(course_id,rule_id,generation,account_id,origin)
    VALUES($1,$2,$3,$4,'application') ON CONFLICT(rule_id,generation,account_id) DO NOTHING`,[p.id,rule.id,rule.generation,user.id]);created=result.rowCount>0;
  }else{
   if(rule.admission_mode!=='invite')fail(409,'COURSE_POLICY_CHANGED','当前规则不使用邀请码');
   if(state.applicationStatus==='revoked')fail(403,'COURSE_ADMISSION_REVOKED','此准入已被平台撤销');
   const code=typeof body.code==='string'?body.code.trim().toUpperCase():'';
   const invitation=(await db.query(`SELECT code_hash FROM platform_course_invitations WHERE rule_id=$1 AND generation=$2
    AND revoked_at IS NULL AND expires_at>clock_timestamp()`,[rule.id,rule.generation])).rows[0];
   if(code.length!==6||[...code].some(c=>!alphabet.includes(c))||!invitation||!safeEqual(invitation.code_hash,codeHash(config.secret,p.id,rule.id,rule.generation,code)))
    fail(400,'INVALID_COURSE_INVITATION','邀请码无效或已失效');
   await db.query("SELECT set_config('campus.redeemed_course_rule_id',$1,true)",[rule.id]);
   await db.query(`INSERT INTO platform_course_admissions(course_id,rule_id,generation,account_id,origin,status,decided_at)
    VALUES($1,$2,$3,$4,'invite','approved',clock_timestamp()) ON CONFLICT(rule_id,generation,account_id) DO NOTHING`,[p.id,rule.id,rule.generation,user.id]);
  }
  const access=await platformCourseAdmission(db,p.id,user.id);
  const chapterCount=Number((await db.query('SELECT count(*) n FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL',[p.id])).rows[0].n);
  return reply(courseEntry(listing,{...p,revision:p.platform_revision,school_name:'平台管理员',chapter_count:chapterCount,admissionRules:access.admissionRules},access.admission),created?201:200);
 });
}
