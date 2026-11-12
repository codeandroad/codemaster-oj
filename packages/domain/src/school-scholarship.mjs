import { transaction } from './db.mjs';
import { auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { lockScholarshipAssistance } from './scholarship-access.mjs';
import { schoolActivityJobVisibleSql } from './school-activities.mjs';
import { canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';
import { approvedAssistanceContent, editableAssistanceContent, originalProblemSolution, pendingSolution, readAssistanceDraft } from './problem-solution-bundles.mjs';

const reply=(body,status=200)=>({status,body});
const kindOf=b=>enumValue(b.kind,['FULL_TRANSLATION','FULL_SOLUTION'],'Content type');
const languageOf=k=>k==='FULL_TRANSLATION'?'zh-CN':'';
const manage=(p,u,r)=>r==='school_admin'||r==='teacher'&&p.owner_account_id===u.id;
const requireAdmin=r=>{if(r!=='school_admin')fail(403,'FORBIDDEN','School administrator required.');};
const scope=(db,s)=>db.query("SELECT set_config('campus.school_id',$1,true)",[s]);
export async function schoolScholarshipSettings(db,s){
 await db.query(`INSERT INTO school_scholarship_settings(school_id,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap)
  SELECT $1,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap FROM luq_settings WHERE singleton ON CONFLICT DO NOTHING`,[s]);
 const c=(await db.query('SELECT * FROM school_scholarship_settings WHERE school_id=$1',[s])).rows[0];
 return {initialGrant:c.initial_grant,firstAcReward:c.first_ac_reward,translationPrice:c.translation_price,solutionPrice:c.solution_price,activityRewardCap:c.activity_reward_cap,firstAcPoints:c.first_ac_points,revision:c.revision,displayFields:c.display_fields};
}
async function studentIdentity(db,s,user){const i=(await db.query("SELECT id,name FROM school_identities WHERE school_id=$1 AND account_id=$2 AND kind='student'",[s,user.id])).rows[0];if(!i)fail(403,'STUDENT_IDENTITY_REQUIRED','A linked school student identity is required.');return i;}
async function walletLock(db,s,i){await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-scholarship:'||$1||':'||$2,0))",[s,i]);}
async function balance(db,s,i){return (await db.query('SELECT balance FROM school_scholarship_accounts WHERE school_id=$1 AND identity_id=$2',[s,i])).rows[0]?.balance??0;}
export async function schoolScholarshipWallet(db, schoolId, user, { lock = false } = {}) {
 const identity = await studentIdentity(db, schoolId, user);
 if (lock) await walletLock(db, schoolId, identity.id);
 return { identityId: identity.id, balance: await balance(db, schoolId, identity.id) };
}
export async function postSchoolScholarshipEntry(db,{schoolId,identityId,delta,kind,sourceKey,actor=null,reason,metadata={},refundOf=null,requestHash=null}){
 try{return(await db.query('SELECT * FROM school_scholarship_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[schoolId,identityId,delta,kind,sourceKey,actor,reason,JSON.stringify(metadata),refundOf,requestHash])).rows[0];}
 catch(e){const text=String(e.message);if(text.includes('SCHOLARSHIP_INSUFFICIENT'))fail(409,'INSUFFICIENT_BALANCE','Insufficient scholarship balance.');if(text.includes('SCHOLARSHIP_REQUEST_CONFLICT'))fail(409,'REQUEST_CONFLICT','This request has already been used.');if(text.includes('SCHOLARSHIP_CREDIT_USED'))fail(409,'TRANSLATION_CREDIT_USED','This translation payment was used toward a solution and cannot be refunded independently.');throw e;}
}
async function target(db,s,u,role,b,{management=false}={}){
 const type=b.type==='paper4'?'paper4':'problem';let p,v,subject,activityId=null,activityType='activity';
 if(type==='problem'){
  const id=uuid(b.problemId),versionId=uuid(b.versionId);
  p=(await db.query('SELECT p.*,b.archived FROM school_problems p JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id WHERE p.school_id=$1 AND p.id=$2',[s,id])).rows[0];
  v=(await db.query('SELECT id,definition FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 AND id=$3',[s,id,versionId])).rows[0];subject=`problem:${id}`;
  if(b.activityId){activityId=uuid(b.activityId);const a=(await db.query(`SELECT a.* FROM school_activities a JOIN school_activity_problems ap ON ap.school_id=a.school_id AND ap.activity_id=a.id WHERE a.school_id=$1 AND a.id=$2 AND ap.problem_id=$3 AND ap.version_id=$4`,[s,activityId,id,versionId])).rows[0];
   if(!a||!management&&(a.state==='Draft'||a.starts_at&&+new Date(a.starts_at)>Date.now()||!(await db.query(`SELECT 1 FROM school_activity_participants ap JOIN school_identities i ON i.school_id=ap.school_id AND i.id=ap.identity_id WHERE ap.school_id=$1 AND ap.activity_id=$2 AND i.account_id=$3`,[s,activityId,u.id])).rowCount))fail(404,'NOT_FOUND','Activity content is unavailable.');
  }
  if(!p||!v||management&&!manage(p,u,role)||!management&&!activityId&&(!p.published||p.archived||p.published_version_id!==v.id))fail(404,'NOT_FOUND','Problem content is unavailable.');
 }else{
  const id=uuid(b.paperId),versionId=uuid(b.versionId);p=(await db.query('SELECT * FROM school_paper4_papers WHERE school_id=$1 AND id=$2',[s,id])).rows[0];v=(await db.query('SELECT id,content FROM school_paper4_versions WHERE school_id=$1 AND paper_id=$2 AND id=$3',[s,id,versionId])).rows[0];
  const questionKey=field(b.questionKey,'Question key',{max:80});subject=`paper4:${id}:${questionKey}`;
  if(!p||!v||!(v.content.definition?.questions??[]).some(q=>q.key===questionKey)||management&&!manage(p,u,role))fail(404,'NOT_FOUND','Paper question is unavailable.');
  if(b.attemptId){const a=(await db.query("SELECT a.* FROM school_paper4_attempts a JOIN school_identities i ON i.school_id=a.school_id AND i.id=a.identity_id WHERE a.school_id=$1 AND a.id=$2 AND a.paper_id=$3 AND a.version_id=$4 AND i.account_id=$5 AND i.kind='student'",[s,uuid(b.attemptId),id,versionId,u.id])).rows[0];if(!a)fail(404,'NOT_FOUND','Attempt is unavailable.');activityId=a.activity_id;}
  if(!management&&!activityId&&(!p.published||p.archived||p.published_version_id!==v.id))fail(404,'NOT_FOUND','Paper content is unavailable.');activityType='paper4_activity';
 }
 return {type,p,v,subject,activityId,activityType};
}
// A public mirror must honor the source school's restrictions too. No school
// content or financial data is exposed: only activity policy restrictions are returned.
export async function publicSchoolAssistanceRestriction(db,s,u,problemId,kind){
 if(s===LEGACY_SCHOOL_ID)return null;
 const assigned=(await db.query(`SELECT a.id,a.kind,a.results_published_at FROM school_activities a
  JOIN school_activity_problems ap ON ap.school_id=a.school_id AND ap.activity_id=a.id
  JOIN school_activity_participants pp ON pp.school_id=a.school_id AND pp.activity_id=a.id
  JOIN school_identities i ON i.school_id=pp.school_id AND i.id=pp.identity_id
  WHERE a.school_id=$1 AND ap.problem_id=$2 AND i.account_id=$3 AND a.state<>'Draft'
   AND (a.starts_at IS NULL OR a.starts_at<=clock_timestamp())
   AND (a.ends_at IS NULL OR a.ends_at>=clock_timestamp() OR a.kind='timed' AND a.results_published_at IS NULL)`,[s,problemId,u.id])).rows;
 if(assigned.some(a=>a.kind==='timed'&&!a.results_published_at))return {mode:'disabled',reason:'Assistance is unavailable until this assessment releases its results.'};
 const {rows:[rules]}=await db.query(`SELECT
   coalesce(bool_or(mode='disabled' OR opens_at>clock_timestamp()),false) blocked
  FROM school_scholarship_policies WHERE school_id=$1 AND kind=$2
   AND (target_type='subject' AND target_key=$3 OR target_type='activity' AND target_key=ANY($4::text[]))`,[s,kind,'problem:'+problemId,assigned.map(a=>a.id)]);
 if(rules.blocked)return {mode:'disabled',reason:'This assistance is not open under the current school activity rules.'};
 return null;
}
async function currentAssistance(db,s,u,role,b){
 const k=kindOf(b),language=languageOf(k),t=await target(db,s,u,role,b),i=await studentIdentity(db,s,u),cfg=await schoolScholarshipSettings(db,s);
 const exam= t.type==='problem'?(await db.query(`SELECT 1 FROM school_activities a JOIN school_activity_problems ap ON ap.school_id=a.school_id AND ap.activity_id=a.id JOIN school_activity_participants pp ON pp.school_id=a.school_id AND pp.activity_id=a.id
  WHERE a.school_id=$1 AND ap.problem_id=$2 AND pp.identity_id=$3 AND a.kind='timed' AND a.state<>'Draft' AND a.starts_at<=clock_timestamp() AND a.results_published_at IS NULL LIMIT 1`,[s,t.p.id,i.id])).rowCount:
  (await db.query(`SELECT 1 FROM school_paper4_activities a JOIN school_paper4_participants pp ON pp.school_id=a.school_id AND pp.activity_id=a.id WHERE a.school_id=$1 AND a.paper_id=$2 AND pp.identity_id=$3 AND a.kind='exam' AND a.starts_at<=clock_timestamp() AND a.results_published_at IS NULL LIMIT 1`,[s,t.p.id,i.id])).rowCount;
 const restrictions=t.type==='problem'?(await db.query(`SELECT a.id FROM school_activities a JOIN school_activity_problems ap ON ap.school_id=a.school_id AND ap.activity_id=a.id JOIN school_activity_participants pp ON pp.school_id=a.school_id AND pp.activity_id=a.id WHERE a.school_id=$1 AND ap.problem_id=$2 AND pp.identity_id=$3 AND a.state='Published' AND (a.starts_at IS NULL OR a.starts_at<=clock_timestamp()) AND (a.ends_at IS NULL OR a.ends_at>=clock_timestamp() OR a.kind='timed' AND a.results_published_at IS NULL)`,[s,t.p.id,i.id])).rows:(await db.query(`SELECT a.id FROM school_paper4_activities a JOIN school_paper4_participants pp ON pp.school_id=a.school_id AND pp.activity_id=a.id WHERE a.school_id=$1 AND a.paper_id=$2 AND pp.identity_id=$3 AND (a.starts_at IS NULL OR a.starts_at<=clock_timestamp()) AND (a.ends_at IS NULL OR a.ends_at>=clock_timestamp() OR a.kind='exam' AND a.results_published_at IS NULL)`,[s,t.p.id,i.id])).rows;
 const restrictedIds=restrictions.map(a=>a.id);
 const policies=(await db.query(`SELECT * FROM school_scholarship_policies WHERE school_id=$1 AND kind=$2 AND (target_type='subject' AND target_key=$3 OR target_type=$4 AND (target_key=$5 OR target_key=ANY($6::text[]))) ORDER BY CASE target_type WHEN 'subject' THEN 0 ELSE 1 END`,[s,k,t.subject,t.activityType,t.activityId??'',restrictedIds])).rows;
 let mode='paid',price=k==='FULL_TRANSLATION'?cfg.translationPrice:cfg.solutionPrice,reason='';
 for(const p of policies){if(p.mode==='disabled'||p.opens_at&&+new Date(p.opens_at)>Date.now()){mode='disabled';reason='This assistance is not open yet.';break;}if(p.target_type==='subject'||p.target_key===t.activityId){mode=p.mode;if(p.price!==null)price=p.price;}}
 if(exam){mode='disabled';reason='Assistance is unavailable until this assessment releases its results.';}
 if(mode==='paid'&&price===0)mode='free';
 const content=(await db.query(`SELECT id,revision FROM school_scholarship_contents WHERE school_id=$1 AND subject_key=$2 AND version_id=$3 AND kind=$4 AND language=$5 AND status='published' FOR SHARE`,[s,t.subject,t.v.id,k,language])).rows[0];
 const freeAfterAc=!!content&&k==='FULL_SOLUTION'&&mode==='paid'&&t.type==='problem'
  &&(await db.query(`SELECT EXISTS(SELECT 1 FROM school_judge_jobs j
   WHERE j.school_id=$1 AND j.identity_id=$2 AND j.problem_id=$3
    AND j.access_context='school' AND j.kind='submit' AND j.state='completed' AND j.result->>'status'='AC'
    AND ${schoolActivityJobVisibleSql('j')}) accepted`,[s,i.id,t.p.id])).rows[0].accepted;
 if(freeAfterAc)mode='free';
 const entitlement=(await db.query('SELECT * FROM school_scholarship_entitlements WHERE school_id=$1 AND identity_id=$2 AND subject_key=$3 AND kind=$4 AND language=$5',[s,i.id,t.subject,k,language])).rows[0];
 let translationCredit=0,creditLedger=null;
 if(k==='FULL_SOLUTION'&&mode==='paid'&&!entitlement){const paid=(await db.query(`SELECT l.id,-l.delta AS amount FROM school_scholarship_entitlements e JOIN school_scholarship_ledger l ON l.school_id=e.school_id AND l.id=e.ledger_id WHERE e.school_id=$1 AND e.identity_id=$2 AND e.subject_key=$3 AND e.kind='FULL_TRANSLATION' AND e.language='zh-CN' AND NOT EXISTS(SELECT 1 FROM school_scholarship_ledger r WHERE r.school_id=l.school_id AND r.refund_of=l.id)`,[s,i.id,t.subject])).rows[0];if(paid){translationCredit=Math.min(price,paid.amount);creditLedger=paid.id;}}
 const basePrice=price;price=entitlement||mode!=='paid'?0:Math.max(0,price-translationCredit);const currentBalance=await balance(db,s,i.id),available=!!content&&mode!=='disabled';
 const affectsFirstAcScholarship=k==='FULL_SOLUTION';
 return {t,i,k,language,content,entitlement,creditLedger,quote:{available,mode,unlocked:!!entitlement,price,basePrice,translationCredit,balance:currentBalance,balanceAfter:currentBalance-price,contentId:content?.id,contentRevision:content?.revision,requiresConfirmation:available&&mode==='paid'&&!entitlement,affectsFirstAcScholarship,affectsFirstAcLuq:affectsFirstAcScholarship,reason:reason||(!content?'No reviewed content has been published for this version.':'')}};
}
async function idempotent(db,s,u,requestId,input,work){
 const id=uuid(requestId),hash=canonicalHash(input);await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-scholarship-request:'||$1||':'||$2||':'||$3,0))",[s,u.id,id]);
 const old=(await db.query('SELECT * FROM school_scholarship_requests WHERE school_id=$1 AND actor_account_id=$2 AND request_id=$3',[s,u.id,id])).rows[0];if(old){if(old.request_hash!==hash)fail(409,'REQUEST_CONFLICT','This request has already been used.');return old.response;}
 const response=await work(hash);await db.query('INSERT INTO school_scholarship_requests(school_id,actor_account_id,request_id,request_hash,response) VALUES($1,$2,$3,$4,$5)',[s,u.id,id,hash,JSON.stringify(response)]);return response;
}
export { idempotent as schoolScholarshipRequest };
async function activity(db,s,id,type,u,role,{editing=false}={}){
 const table=type==='paper4_activity'?'school_paper4_activities':'school_activities';const a=(await db.query(`SELECT * FROM ${table} WHERE school_id=$1 AND id=$2 FOR UPDATE`,[s,uuid(id)])).rows[0];if(!a)fail(404,'NOT_FOUND','Activity is unavailable.');
 if(editing&&!manage(a,u,role))fail(403,'FORBIDDEN','Only the responsible teacher or school administrator may edit this rule.');
 if(editing&&(type==='activity'?a.state!=='Draft':a.results_published_at||!a.starts_at||+new Date(a.starts_at)<=Date.now()||(await db.query('SELECT 1 FROM school_paper4_attempts WHERE school_id=$1 AND activity_id=$2 LIMIT 1',[s,id])).rowCount))fail(409,'RULE_FROZEN','Activity rules are frozen.');
 if(!editing&&!manage(a,u,role)){const table=type==='paper4_activity'?'school_paper4_participants':'school_activity_participants';if(!(await db.query(`SELECT 1 FROM ${table} p JOIN school_identities i ON i.school_id=p.school_id AND i.id=p.identity_id WHERE p.school_id=$1 AND p.activity_id=$2 AND i.account_id=$3`,[s,id,u.id])).rowCount)fail(404,'NOT_FOUND','Activity is unavailable.');}
 return a;
}
export async function configureSchoolActivityScholarshipRule(db,schoolId,user,role,activityId,type,body,{initialize=false}={}){
 const s=schoolId,id=uuid(activityId);type=enumValue(type,['activity','paper4_activity'],'Activity type');
 const a=await activity(db,s,id,type,user,role,{editing:!initialize});if(!manage(a,user,role))fail(403,'FORBIDDEN','Only the responsible teacher or school administrator may edit this rule.');
 const old=(await db.query('SELECT * FROM school_scholarship_activity_rules WHERE school_id=$1 AND activity_type=$2 AND activity_id=$3 ORDER BY revision DESC LIMIT 1',[s,type,id])).rows[0];
 if(initialize&&old)fail(409,'RULE_FROZEN','Initial activity rules are already stored.');
 if(integer(body.expectedRevision??0,0,2147483646,'Revision')!==(old?.revision??0))fail(409,'REVISION_CONFLICT','Rule changed. Refresh first.');
 const requireAll=body.requireAll??old?.require_all??false;
 if(typeof requireAll!=='boolean'||(requireAll&&(type!=='activity'||a.kind!=='assignment')))fail(400,'VALIDATION','Only assignments can reward passing all required problems.');
 const cfg=await schoolScholarshipSettings(db,s),amount=integer(body.amount??0,0,cfg.activityRewardCap,'Activity reward'),minAc=requireAll?1:integer(body.minimumAc??1,1,100,'Accepted problems'),minScore=requireAll?0:integer(body.minimumScore??0,0,100,'Score percentage'),taskKind=enumValue(body.taskKind??'challenge',['challenge','learning','correction'],'Task kind'),allow=body.allowSolutionAssisted===true;
 if(taskKind==='challenge'&&allow)fail(400,'VALIDATION','Challenge rewards exclude solution-assisted submissions.');
 const r=(await db.query('INSERT INTO school_scholarship_activity_rules(school_id,activity_type,activity_id,revision,amount,minimum_ac,minimum_score,task_kind,allow_solution_assisted,require_all) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[s,type,id,(old?.revision??0)+1,amount,minAc,minScore,taskKind,allow,requireAll])).rows[0];
 if(body.assistance!==undefined){
  if(!body.assistance||typeof body.assistance!=='object')fail(400,'VALIDATION','Invalid assistance policy.');
  for(const [key,kind] of [['translation','FULL_TRANSLATION'],['solution','FULL_SOLUTION']]){
   const policy=body.assistance[key];if(!policy||typeof policy!=='object')fail(400,'VALIDATION','Both assistance policies are required.');
   const mode=enumValue(policy.mode,['disabled','paid','free'],'Mode'),opensAt=policy.opensAt?new Date(policy.opensAt):null;
   if(opensAt&&!Number.isFinite(+opensAt))fail(400,'VALIDATION','Invalid opening time.');
   await db.query(`INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode,opens_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,target_type,target_key,kind) DO UPDATE SET mode=EXCLUDED.mode,opens_at=EXCLUDED.opens_at,revision=school_scholarship_policies.revision+1`,[s,type,id,kind,mode,opensAt]);
  }
 }
 await auditSchool(db,s,user.id,'scholarship.activity-rule',id);return {amount:r.amount,minimumAc:r.minimum_ac,minimumScore:r.minimum_score,requireAll:r.require_all,taskKind:r.task_kind,allowSolutionAssisted:r.allow_solution_assisted,revision:r.revision};
}
export async function settleSchoolActivityRewards(db,schoolId,activityId,type='activity'){await db.query('SELECT school_scholarship_settle_activity($1,$2,$3)',[schoolId,type,activityId]);}
export async function handleSchoolScholarship({pool,user,route,method,body={},url}){
 const match=route.match(/^\/schools\/([^/]+)\/scholarship(?:\/(.*))?$/);if(!match)return null;const s=uuid(match[1]),path=match[2]??'';if(s===LEGACY_SCHOOL_ID)fail(404,'NOT_FOUND','Use the existing school scholarship service.');
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,s,{shared:method==='GET'});const role=await schoolRole(db,s,user.id);await scope(db,s);
  const cfg=await schoolScholarshipSettings(db,s);
  if(path==='settings'&&method==='GET')return reply(cfg);
  if(path==='settings'&&method==='PATCH'){
   requireAdmin(role);if(integer(body.expectedRevision,1,2147483646,'Revision')!==cfg.revision)fail(409,'REVISION_CONFLICT','Settings changed. Refresh first.');
   const c={initialGrant:integer(body.initialGrant,0,100000,'Initial allowance'),firstAcReward:integer(body.firstAcReward,0,100,'First AC'),translationPrice:integer(body.translationPrice,0,1000,'Translation price'),solutionPrice:integer(body.solutionPrice,0,1000,'Solution price'),activityRewardCap:integer(body.activityRewardCap,0,1000,'Activity cap'),firstAcPoints:integer(body.firstAcPoints,0,1000,'Rank points')};
   const fields={};for(const key of ['solved','attempts','acRate','scholarship'])fields[key]=body.displayFields?.[key]!==false;
   await db.query('UPDATE school_scholarship_settings SET initial_grant=$2,first_ac_reward=$3,translation_price=$4,solution_price=$5,activity_reward_cap=$6,first_ac_points=$7,display_fields=$8,revision=revision+1 WHERE school_id=$1',[s,c.initialGrant,c.firstAcReward,c.translationPrice,c.solutionPrice,c.activityRewardCap,c.firstAcPoints,JSON.stringify(fields)]);await auditSchool(db,s,user.id,'scholarship.settings',s);return reply(await schoolScholarshipSettings(db,s));
  }
  if(path==='wallet'&&method==='GET'){const i=await studentIdentity(db,s,user);return reply({balance:await balance(db,s,i.id),...cfg});}
  if(path==='ledger'&&method==='GET'){
   const i=role==='school_admin'?(url.searchParams.get('identityId')?uuid(url.searchParams.get('identityId')):null):(await studentIdentity(db,s,user)).id,page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page');
   const rows=(await db.query(`SELECT l.*,i.name,EXISTS(SELECT 1 FROM school_scholarship_ledger r WHERE r.school_id=l.school_id AND r.refund_of=l.id) AS refunded,EXISTS(SELECT 1 FROM school_scholarship_entitlements e WHERE e.school_id=l.school_id AND e.credit_ledger_id=l.id) AS credited FROM school_scholarship_ledger l JOIN school_identities i ON i.school_id=l.school_id AND i.id=l.identity_id WHERE l.school_id=$1 AND ($2::uuid IS NULL OR l.identity_id=$2) ORDER BY l.created_at DESC,l.id DESC LIMIT 51 OFFSET $3`,[s,i,(page-1)*50])).rows;
   return reply({items:rows.slice(0,50).map(r=>({id:r.id,identityId:r.identity_id,name:role==='school_admin'?r.name:undefined,delta:r.delta,balanceAfter:r.balance_after,kind:r.kind,reason:r.reason,createdAt:r.created_at,refunded:r.refunded,credited:r.credited,refundOf:r.refund_of})),page,hasMore:rows.length>50,...(role==='school_admin'?{reviewCases:(await db.query('SELECT id,source_key AS source,reason,created_at AS "createdAt" FROM school_scholarship_review_cases WHERE school_id=$1 ORDER BY created_at DESC LIMIT 50',[s])).rows}:{})});
  }
  if(path==='recipients'&&method==='GET'){requireAdmin(role);return reply({items:(await db.query("SELECT i.id,i.name,i.number,coalesce(a.balance,0) AS balance FROM school_identities i LEFT JOIN school_scholarship_accounts a ON a.school_id=i.school_id AND a.identity_id=i.id WHERE i.school_id=$1 AND i.kind='student' AND i.archived_at IS NULL ORDER BY i.name,i.id",[s])).rows,classes:(await db.query('SELECT id,name FROM school_classes WHERE school_id=$1 AND archived_at IS NULL ORDER BY name,id',[s])).rows});}
  if(path==='grant'&&method==='POST'){
   requireAdmin(role);const identities=Array.isArray(body.identityIds)?[...new Set(body.identityIds.map(x=>uuid(x)))].sort():[],classes=Array.isArray(body.classIds)?[...new Set(body.classIds.map(x=>uuid(x)))].sort():[];
   if(!identities.length&&!classes.length||identities.length+classes.length>1000)fail(400,'VALIDATION','Select up to 1,000 students or classes.');
   const amount=integer(body.amount,-100000,100000,'Amount'),reason=field(body.reason,'Reason',{max:2000}),kind=enumValue(body.kind??'admin_grant',['admin_grant','admin_adjustment'],'Operation');if(!amount||kind==='admin_grant'&&amount<0)fail(400,'VALIDATION','Enter a valid non-zero amount.');
   return reply(await idempotent(db,s,user,body.requestId,{identities,classes,amount,reason,kind},async hash=>{
    if((await db.query("SELECT id FROM school_identities WHERE school_id=$1 AND id=ANY($2::uuid[]) AND kind='student' AND archived_at IS NULL",[s,identities])).rowCount!==identities.length||(await db.query('SELECT id FROM school_classes WHERE school_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL',[s,classes])).rowCount!==classes.length)fail(404,'NOT_FOUND','A selected recipient is unavailable.');
    const ids=(await db.query("SELECT DISTINCT i.id FROM school_identities i LEFT JOIN school_class_roster r ON r.school_id=i.school_id AND r.identity_id=i.id WHERE i.school_id=$1 AND i.kind='student' AND i.archived_at IS NULL AND (i.id=ANY($2::uuid[]) OR r.class_id=ANY($3::uuid[])) ORDER BY i.id",[s,identities,classes])).rows.map(r=>r.id);if(!ids.length||ids.length>5000)fail(400,'VALIDATION','Select between 1 and 5,000 students.');
    for(const id of ids)await postSchoolScholarshipEntry(db,{schoolId:s,identityId:id,delta:amount,kind,sourceKey:`admin:${user.id}:${body.requestId}:${id}`,actor:user.id,reason,requestHash:hash});await auditSchool(db,s,user.id,'scholarship.grant',s);return {count:ids.length,amount};
   }));
  }
  if(path==='refund'&&method==='POST'){requireAdmin(role);const ledgerId=uuid(body.ledgerId),reason=field(body.reason,'Reason',{max:2000});return reply(await idempotent(db,s,user,body.requestId,{ledgerId,reason},async()=>{const l=(await db.query("SELECT * FROM school_scholarship_ledger WHERE school_id=$1 AND id=$2 AND kind='purchase'",[s,ledgerId])).rows[0];if(!l)fail(404,'NOT_FOUND','Purchase not found.');const refunded=await postSchoolScholarshipEntry(db,{schoolId:s,identityId:l.identity_id,delta:-l.delta,kind:'refund',sourceKey:`refund:${ledgerId}`,actor:user.id,reason,refundOf:ledgerId});return {id:refunded.id,balance:refunded.balance_after};}));}
  if(path.startsWith('assistance/')&&method==='POST'){
   const i=await studentIdentity(db,s,user);await lockScholarshipAssistance(db,user.identityId);await walletLock(db,s,i.id);const st=await currentAssistance(db,s,user,role,body);if(path==='assistance/quote')return reply(st.quote);
   if(!st.quote.available)fail(403,'ASSISTANCE_UNAVAILABLE',st.quote.reason);
   if(path==='assistance/unlock')return reply(await idempotent(db,s,user,body.requestId??body.requestKey,{subject:st.t.subject,kind:st.k,language:st.language},async()=>{
    if(st.entitlement||st.quote.mode==='free')return {balance:st.quote.balance,unlocked:!!st.entitlement};
    if(body.confirmedContentId!==st.content.id||body.confirmedRevision!==st.content.revision||body.confirmedPrice!==st.quote.price)fail(409,'QUOTE_CHANGED','Content or price changed. Review the new quote.');
    let entry=null;if(st.quote.price>0)entry=await postSchoolScholarshipEntry(db,{schoolId:s,identityId:i.id,delta:-st.quote.price,kind:'purchase',sourceKey:`purchase:${i.id}:${st.t.subject}:${st.k}:${st.language}`,actor:user.id,reason:st.k==='FULL_TRANSLATION'?'Unlock Chinese translation':'Unlock solution',metadata:{subjectKey:st.t.subject,versionId:st.t.v.id,translationCredit:st.quote.translationCredit}});
    await db.query('INSERT INTO school_scholarship_entitlements(school_id,identity_id,subject_key,kind,language,ledger_id,credit_ledger_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[s,i.id,st.t.subject,st.k,st.language,entry?.id??null,st.quote.translationCredit?st.creditLedger:null]);return {balance:await balance(db,s,i.id),unlocked:true};
   }));
   if(path==='assistance/provide'){
    if(st.quote.mode!=='free'&&!st.entitlement)fail(403,'PAYMENT_REQUIRED','Unlock this content first.');
    const content=(await db.query("SELECT id,body,solution_details FROM school_scholarship_contents WHERE school_id=$1 AND id=$2 AND status='published' FOR SHARE",[s,st.content.id])).rows[0];if(!content)fail(409,'CONTENT_CHANGED','Content has changed.');
    const delivery=(await db.query('INSERT INTO school_scholarship_deliveries(school_id,identity_id,subject_key,version_id,kind,content_id,context_type,context_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,provided_at',[s,i.id,st.t.subject,st.t.v.id,st.k,st.content.id,st.t.activityId?st.t.activityType:'practice',st.t.activityId])).rows[0];return reply({...approvedAssistanceContent(content),kind:st.k,language:st.language,contentId:st.content.id,providedAt:delivery.provided_at});
   }
  }
  if(path==='targets'&&method==='GET'){
   if(!['teacher','school_admin'].includes(role))fail(403,'FORBIDDEN','Teaching permission required.');const items=[];
   const problems=(await db.query(`SELECT p.id,p.published_version_id AS version_id,v.definition->>'title' AS title FROM school_problems p JOIN school_problem_versions v ON v.school_id=p.school_id AND v.id=p.published_version_id WHERE p.school_id=$1 AND ($2='school_admin' OR p.owner_account_id=$3) ORDER BY p.created_at DESC,p.id`,[s,role,user.id])).rows;
   for(const p of problems)items.push({type:'problem',problemId:p.id,versionId:p.version_id,title:p.title,subjectKey:`problem:${p.id}`});
   const papers=(await db.query(`SELECT p.id,p.published_version_id AS version_id,v.content FROM school_paper4_papers p JOIN school_paper4_versions v ON v.school_id=p.school_id AND v.id=p.published_version_id WHERE p.school_id=$1 AND ($2='school_admin' OR p.owner_account_id=$3) ORDER BY p.created_at DESC,p.id`,[s,role,user.id])).rows;
   for(const p of papers)for(const q of p.content.definition?.questions??[])items.push({type:'paper4',paperId:p.id,questionKey:q.key,versionId:p.version_id,title:`${p.content.shortTitle||p.content.title} · ${q.title}`,subjectKey:`paper4:${p.id}:${q.key}`});
   const contents=(await db.query('SELECT id,subject_key,version_id,kind,status,revision,pending_solution IS NOT NULL has_pending FROM school_scholarship_contents WHERE school_id=$1',[s])).rows;const policies=(await db.query("SELECT * FROM school_scholarship_policies WHERE school_id=$1 AND target_type='subject'",[s])).rows;
   return reply({items:items.map(i=>({...i,contents:contents.filter(c=>c.subject_key===i.subjectKey&&c.version_id===i.versionId).map(c=>({id:c.id,kind:c.kind,status:c.status,revision:c.revision,...(c.has_pending?{hasPendingSolutions:true}:{})})),policies:policies.filter(p=>p.target_key===i.subjectKey).map(p=>({kind:p.kind,mode:p.mode,price:p.price,opensAt:p.opens_at}))}))});
  }
  if(path==='content'&&['GET','POST'].includes(method)){
   const b=method==='GET'?Object.fromEntries(url.searchParams):body,t=await target(db,s,user,role,b,{management:true}),k=kindOf(b),language=languageOf(k);
   const old=(await db.query('SELECT * FROM school_scholarship_contents WHERE school_id=$1 AND subject_key=$2 AND version_id=$3 AND kind=$4 AND language=$5 FOR UPDATE',[s,t.subject,t.v.id,k,language])).rows[0];
   if(method==='GET'){
    const definition=t.v.definition;
    const originalSolution=t.type==='problem'&&k==='FULL_SOLUTION'?originalProblemSolution({editorial:definition.editorial??definition.metadata?.editorial,referenceCode:definition.reference_code,referenceLanguage:definition.reference_language}):undefined;
    let inheritedSolution;
    if(!old&&t.type==='problem'&&k==='FULL_SOLUTION'){
     const previous=(await db.query(`SELECT c.id,c.body,c.solution_details,c.version_id FROM school_problem_versions v
      JOIN school_scholarship_contents c ON c.school_id=v.school_id AND c.version_id=v.id AND c.subject_key=$3 AND c.kind='FULL_SOLUTION' AND c.language='' AND c.status='published' AND c.published_at IS NOT NULL
      WHERE v.school_id=$1 AND v.problem_id=$2 AND v.id<>$4
       AND v.created_at<=(SELECT created_at FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 AND id=$4)
      ORDER BY v.created_at DESC,v.id DESC LIMIT 1`,[s,t.p.id,t.subject,t.v.id])).rows[0];
     if(previous)inheritedSolution={versionId:previous.version_id,...approvedAssistanceContent(previous)};
    }
    return reply({...(old?{id:old.id,...editableAssistanceContent(old),status:old.status,revision:old.revision}:{body:'',status:'missing',revision:0}),...(originalSolution?{originalSolution}:{}),...(inheritedSolution?{inheritedSolution}:{})});
   }
   if(integer(body.expectedRevision??0,0,2147483646,'Revision')!==(old?.revision??0))fail(409,'REVISION_CONFLICT','Content changed. Refresh first.');
   const draft=readAssistanceDraft(body,{subjectKey:t.subject,kind:k,previous:old});
   const staged=old?.status==='published'&&body.solutions!==undefined;
   const {rows:[saved]}=staged?await db.query(`UPDATE school_scholarship_contents SET pending_solution=$3,
    revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2 RETURNING *`,[s,old.id,pendingSolution(old,draft)]):
    await db.query(`INSERT INTO school_scholarship_contents(school_id,subject_key,version_id,kind,language,body,author_account_id,solution_details)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,subject_key,version_id,kind,language) DO UPDATE SET
      body=EXCLUDED.body,solution_details=EXCLUDED.solution_details,status='draft',revision=school_scholarship_contents.revision+1,
      reviewer_account_id=NULL,published_at=NULL,updated_at=clock_timestamp() RETURNING *`,[s,t.subject,t.v.id,k,language,draft.body,user.id,draft.details]);
   await auditSchool(db,s,user.id,'scholarship.content.draft',saved.id);
   return reply({id:saved.id,revision:saved.revision,status:saved.status,...(saved.pending_solution?{hasPendingSolutions:true}:{})});
  }
  if(path==='contents/review'&&method==='POST'){
   requireAdmin(role);if(body.confirmReviewed!==true||!Array.isArray(body.items)||!body.items.length||body.items.length>500)fail(400,'REVIEW_REQUIRED','Confirm review of up to 500 selected contents.');const publish=body.publish!==false;
   for(const item of body.items){
    const id=uuid(item.id),rev=integer(item.revision,1,2147483646,'Revision');
    const r=(await db.query('SELECT * FROM school_scholarship_contents WHERE school_id=$1 AND id=$2 FOR UPDATE',[s,id])).rows[0];
    if(!r||r.revision!==rev)fail(409,'REVISION_CONFLICT','A selected content changed. Refresh first.');
    if(!editableAssistanceContent(r).body.trim())fail(400,'CONTENT_REQUIRED','Content is missing.');
    await db.query(`UPDATE school_scholarship_contents SET status=$3,reviewer_account_id=$4,
     published_at=CASE WHEN $3='published' THEN clock_timestamp() ELSE NULL END,revision=revision+1,
     body=COALESCE(pending_solution->>'body',body),solution_details=COALESCE(pending_solution->'details',solution_details),pending_solution=NULL
     WHERE school_id=$1 AND id=$2`,[s,id,publish?'published':'withdrawn',user.id]);
    await auditSchool(db,s,user.id,publish?'scholarship.content.publish':'scholarship.content.withdraw',id);
   }
   return reply({count:body.items.length});
  }
  if(path==='policies'&&method==='POST'){
   if(!Array.isArray(body.targets)||!body.targets.length||body.targets.length>500)fail(400,'VALIDATION','Select up to 500 targets.');const k=kindOf(body),mode=enumValue(body.mode??'paid',['disabled','paid','free'],'Mode'),price=body.price===null||body.price===undefined?null:integer(body.price,0,1000,'Price'),opensAt=body.opensAt?new Date(body.opensAt):null;if(opensAt&&!Number.isFinite(+opensAt))fail(400,'VALIDATION','Invalid opening time.');
   for(const b of body.targets){let type='subject',key;if(b.activityId&&!b.problemId&&!b.paperId){type=b.type==='paper4'?'paper4_activity':'activity';await activity(db,s,b.activityId,type,user,role,{editing:true});key=b.activityId;}else key=(await target(db,s,user,role,b,{management:true})).subject;
    await db.query(`INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode,price,opens_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(school_id,target_type,target_key,kind) DO UPDATE SET mode=EXCLUDED.mode,price=EXCLUDED.price,opens_at=EXCLUDED.opens_at,revision=school_scholarship_policies.revision+1`,[s,type,key,k,mode,price,opensAt]);}
   await auditSchool(db,s,user.id,'scholarship.policies',s);return reply({count:body.targets.length});
  }
  if(path==='activity-rule'&&['GET','POST'].includes(method)){
   const b=method==='GET'?Object.fromEntries(url.searchParams):body,type=b.type==='paper4_activity'?'paper4_activity':'activity',id=uuid(b.activityId);const targetActivity=await activity(db,s,id,type,user,role,{editing:method==='POST'});
   const old=(await db.query('SELECT * FROM school_scholarship_activity_rules WHERE school_id=$1 AND activity_type=$2 AND activity_id=$3 ORDER BY revision DESC LIMIT 1',[s,type,id])).rows[0];
   const shape=r=>({amount:r?.amount??0,minimumAc:r?.minimum_ac??1,minimumScore:r?.minimum_score??0,requireAll:r?.require_all??false,taskKind:r?.task_kind??'challenge',allowSolutionAssisted:r?.allow_solution_assisted??false,revision:r?.revision??0});
   if(method==='GET'){
    const policies=(await db.query('SELECT kind,mode,opens_at FROM school_scholarship_policies WHERE school_id=$1 AND target_type=$2 AND target_key=$3',[s,type,id])).rows;
    const policy=k=>{const p=policies.find(p=>p.kind===k);return {mode:p?.mode??'paid',opensAt:p?.opens_at??null};};
    return reply({...shape(old),completionAvailable:type==='activity'&&targetActivity.kind==='assignment',assistance:{translation:policy('FULL_TRANSLATION'),solution:policy('FULL_SOLUTION')}});
   }
   return reply(await configureSchoolActivityScholarshipRule(db,s,user,role,id,type,b));
  }
  if(path==='usage'&&method==='GET'){
   if(!['teacher','school_admin'].includes(role))fail(403,'FORBIDDEN','Teaching permission required.');const b=Object.fromEntries(url.searchParams),t=await target(db,s,user,role,b,{management:true});return reply({items:(await db.query(`SELECT d.id,i.name,d.kind,d.provided_at AS "providedAt",d.context_type AS "contextType" FROM school_scholarship_deliveries d JOIN school_identities i ON i.school_id=d.school_id AND i.id=d.identity_id WHERE d.school_id=$1 AND d.subject_key=$2 ORDER BY d.provided_at DESC LIMIT 200`,[s,t.subject])).rows});
  }
  return null;
 });
}
