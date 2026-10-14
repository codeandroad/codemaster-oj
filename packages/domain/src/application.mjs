import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { parseFunctionInput, parseJsonValue } from './function-input.mjs';
import { handleLibrary, bankAccess, problemPermissions, restoreIdentityBindings, canReviewActivitySubmission, SCHOOL_BANK } from './library.mjs';
import { handleEducation } from './education.mjs';
import { handleCommunity } from './community.mjs';
import { createTimedService } from './timed.mjs';
import { handleMemberImport } from './member-import.mjs';
import { handleSystem, assertJudgeAdmission, getSettings } from './system.mjs';
import { handlePeopleAlignment, handleFavorites, bindPendingTeacherClasses } from './alignment.mjs';
import { handleAssignmentAuthoring } from './assignment-authoring.mjs';
import { submissionHistory,problemOwnProgress,emptyOwnProgress } from './submission-history.mjs';
import { LANGUAGES, languageLimitsFor, starterCodesFor } from './languages.mjs';
import { HttpError, fail, field, username, password, uuid, submissionId, enumValue, genderValue, integer, bytes, hashPassword, verifyPassword, randomToken, tokenHash, sessionHash, safeEqual, parseCookie, sessionCookie, checkMutation, RateLimiter, canonicalHash } from './security.mjs';

const BASE='/api/v1';
const rolesInclude=(user,role)=>user.roles.includes(role);
const isStaff=user=>rolesInclude(user,'teacher')||rolesInclude(user,'admin');
const admin=user=>{if(!rolesInclude(user,'admin')) fail(403,'FORBIDDEN','需要管理员权限');};
const staff=user=>{if(!isStaff(user)) fail(403,'FORBIDDEN','需要教师权限');};
const row=(result,message='资源不存在')=>{if(!result.rowCount) fail(404,'NOT_FOUND',message);return result.rows[0];};
const identityIds=(value,name,max=500)=>{if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)fail(400,'VALIDATION',`${name}须为最多 ${max} 项的 ID 数组`);return [...new Set(value.map(id=>uuid(id,name)))];};
const userShape=r=>({id:r.id,identityId:r.identity_id,name:r.name,number:r.number,gender:r.gender??null,username:r.username,email:r.email||null,nickname:r.nickname,bio:r.bio,avatar:r.avatar,roles:r.roles,activatedAt:r.created_at});
const personShape=r=>({id:r.id,kind:r.kind,number:r.number,name:r.name,gender:r.gender??null,classes:r.classes||[],activated:!!r.activated});
const problemShape=(r,{includeDisabledSamples=false}={})=>({...Object.fromEntries(Object.entries(r.metadata||{}).filter(([key])=>!['editorial','hints'].includes(key))),id:r.problem_id,title:r.title,mode:r.mode,statement:r.statement,functionName:r.function_name,starterCode:r.starter_code,starterCodes:starterCodesFor(r),supportedLanguages:LANGUAGES,languageLimits:languageLimitsFor(r),referenceLanguage:r.reference_language||'python',samples:(r.samples||[]).filter(sample=>includeDisabledSamples||sample.enabled!==false),timeLimitMs:r.time_limit_ms,memoryLimitMb:r.memory_limit_mb,comparator:r.comparator,tags:r.tags||[],source:r.source||'',versionId:r.id,publishedVersionId:r.published_version_id||(r.published_at?r.id:null),publishedTitle:r.published_title||(r.published_at?r.title:null),published:!!r.published_at,schoolVisibleAt:r.school_visible_at??null,rankReviewStatus:r.rank_review_status??'pending',rankApprovedAt:r.rank_approved_at??null,bankVisibility:r.bank_visibility,validationStatus:r.validation_status,validationMessage:r.validation_message||null,formalTestCount:r.formal_test_count===undefined?undefined:Number(r.formal_test_count),canPublish:r.validation_status==='AC'&&!r.published_at});
const submissionShape=r=>({id:`SUB${r.id}`,identityId:r.identity_id,problemId:r.problem_id,problemTitle:r.problem_title,versionId:r.version_id,kind:r.kind,language:r.language||'python',status:r.status,score:r.score===null?null:Number(r.score),passed:r.passed,total:r.total,createdAt:r.created_at,code:r.code,publicOutput:r.public_output||null,message:r.public_message||null,assignmentId:r.assignment_id||null,timedPracticeId:r.timed_practice_id||null,timedAttemptId:r.timed_attempt_id||null,originalSubmissionId:r.original_submission_id?`SUB${r.original_submission_id}`:null,studentName:r.student_name});
const reviewEntryShape=r=>({id:r.id,note:r.note,createdAt:r.created_at,submissionId:`SUB${r.submission_id}`,problemTitle:r.problem_title,problemId:r.problem_id,versionId:r.version_id,timedPracticeId:r.timed_practice_id||null,timedAttemptId:r.timed_attempt_id||null,originalSubmissionId:r.original_submission_id?`SUB${r.original_submission_id}`:null,status:r.status,authorName:r.author_name,authorIdentityId:r.author_identity_id});
const reviewEntryQuery='SELECT r.id,r.note,r.created_at,s.id submission_id,s.problem_id,s.version_id,s.original_submission_id,s.status,s.identity_id,s.timed_attempt_id,v.title problem_title,i.id author_identity_id,i.name author_name FROM review_entries r JOIN submissions s ON s.id=r.submission_id JOIN problem_versions v ON v.id=s.version_id JOIN accounts a ON a.id=r.author_account_id JOIN identities i ON i.id=a.identity_id';

export function loadConfig(env=process.env) {
 const production=env.NODE_ENV==='production';
 const secret=env.SESSION_SECRET;
 if(!secret||Buffer.byteLength(secret)<32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
 const origins=(env.APP_ORIGINS||env.APP_ORIGIN||(!production?'http://localhost:3000,http://localhost:8080,http://127.0.0.1:3000': '')).split(',').filter(Boolean);
 if(!origins.length||origins.some(o=>{try { const u=new URL(o);return u.origin!==o||(production&&u.protocol!=='https:'); }catch{return true;}})) throw new Error('APP_ORIGINS must list exact trusted origins; production requires HTTPS.');
 if(production&&env.COOKIE_SECURE==='false') throw new Error('Production cookies must be Secure.');
 if(production&&!env.JUDGE_IMAGE) throw new Error('JUDGE_IMAGE must pin an approved sandbox runtime.');
 return {secret,origins,secure:production||env.COOKIE_SECURE!=='false',bodyLimit:2097152,codeLimit:262144};
}

export async function createDomainServices(pool,config) {
 const authLimiter=new RateLimiter({max:10,windowMs:60000}), ipLimiter=new RateLimiter({max:60,windowMs:60000}), submitLimiter=new RateLimiter({max:20,windowMs:60000});
 const dummyHash=await hashPassword(randomToken());
 const timed=createTimedService(pool);
 async function audit(db,actor,action,type,id,metadata={}) { await db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[actor,action,type,String(id),metadata]); }
 async function findUser(db,accountId) {
  const r=await db.query("SELECT a.id,a.identity_id,a.username,a.email,a.nickname,a.bio,a.avatar,a.created_at,i.name,i.number,i.gender,ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) roles FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL",[accountId]);return r.rowCount?userShape(r.rows[0]):null;
 }
 async function session(db,accountId) {
  const token=randomToken(),csrfToken=randomToken();
  await db.query("INSERT INTO sessions(token_hash,account_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[sessionHash(token,config.secret),accountId,csrfToken]);
  return {body:{user:await findUser(db,accountId),csrfToken},cookie:sessionCookie(token,config)};
 }
 async function classAccess(db,user,id) {
  uuid(id,'班级 ID');
  const result=await db.query('SELECT * FROM classes WHERE id=$1 AND archived_at IS NULL',[id]);const cls=row(result);
  if(rolesInclude(user,'admin')) return cls;
  if(!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[id,user.id])).rowCount) fail(403,'FORBIDDEN','无权管理该班级');return cls;
 }
 async function studentRosterAccess(db,user,identityId) {
  const identity=row(await db.query("SELECT id FROM identities WHERE id=$1 AND kind='student' AND archived_at IS NULL",[uuid(identityId)]));
  if(!rolesInclude(user,'admin')&&!(await db.query('SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=$1 AND tc.account_id=$2 AND c.archived_at IS NULL',[identityId,user.id])).rowCount)fail(403,'FORBIDDEN','只能添加已在本人负责班级中的学生，新生请由管理员建班授权');
  return identity;
 }
 async function versionAccess(db,user,problemId,versionId) {
  uuid(problemId,'题目 ID');if(versionId) uuid(versionId,'版本 ID');
  const p=row(await db.query('SELECT * FROM problems WHERE id=$1',[problemId]));
  if(p.archived_at){
   // Archiving removes a problem from the library, but an already-selected
   // version remains available through its exact assignment deep link.
   if(!versionId)fail(404,'NOT_FOUND','题目不存在');
   const selected=await db.query(`SELECT 1 FROM assignment_problems ap
    JOIN assignments a ON a.id=ap.assignment_id
    LEFT JOIN classes c ON c.id=a.class_id
    WHERE ap.problem_id=$1 AND ap.version_id=$2 AND (
     $3::boolean
     OR $4::boolean AND c.archived_at IS NULL AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=a.class_id AND tc.account_id=$6)
     OR $5::boolean AND a.state='Published' AND EXISTS(SELECT 1 FROM assignment_participants part WHERE part.assignment_id=a.id AND part.identity_id=$7 AND NOT part.exempt)
    ) LIMIT 1`,[problemId,versionId,rolesInclude(user,'admin'),rolesInclude(user,'teacher'),rolesInclude(user,'student'),user.id,user.identityId]);
   if(!selected.rowCount)fail(404,'NOT_FOUND','题目不存在');
  }
  const own=isStaff(user)&&(p.owner_account_id===user.id||rolesInclude(user,'admin'));let bankRead=false;
  if(isStaff(user)){try{bankRead=(await bankAccess(db,user,p.bank_id)).canRead;}catch(error){if(!['FORBIDDEN','NOT_FOUND'].includes(error.code))throw error;}}
  if(!versionId&&!own&&!bankRead){
   // A pending replacement must not displace the latest approved public
   // version. Assigned students can still reach an exact pending version.
   const candidates=(await db.query(`SELECT * FROM problem_versions WHERE problem_id=$1 AND published_at IS NOT NULL
    ORDER BY (school_visible_at IS NOT NULL) DESC,published_at DESC,created_at DESC,id DESC`,[problemId])).rows;
   for(const candidate of candidates){const permissions=await problemPermissions(db,user,p,candidate);if(permissions.canRead)return {p,v:candidate,owner:permissions.canEdit,permissions};}
   fail(404,'NOT_FOUND','题目不存在');
  }
  const r=versionId?await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2',[versionId,problemId]):await db.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[problemId]);
  const v=row(r);
  const permissions=await problemPermissions(db,user,p,v);if(!permissions.canRead)fail(404,'NOT_FOUND','题目不存在');return {p,v,owner:permissions.canEdit,permissions};
 }
 async function problemResult(db,user,problemId,versionId) {
  const {p,v,owner,permissions}=await versionAccess(db,user,problemId,versionId);const result=problemShape(v,{includeDisabledSamples:owner});result.publishedVersionId=owner?p.current_version_id:v.id;result.publishedTitle=owner?result.publishedTitle:v.title;result.bankId=p.bank_id;result.bankVisibility=(await db.query('SELECT visibility FROM problem_banks WHERE id=$1',[p.bank_id])).rows[0]?.visibility;result.canEdit=owner;result.canPublish=owner&&result.canPublish;
  result.firstAcPoints=(await db.query('SELECT COALESCE((SELECT points FROM point_rewards WHERE problem_id=$1 AND assignment_id IS NULL),10) first_ac_points',[problemId])).rows[0].first_ac_points;
  if(owner){Object.assign(result,v.metadata||{});result.referenceCode=v.reference_code;result.tests=(await db.query('SELECT input,expected,weight,name,enabled FROM test_cases WHERE version_id=$1 ORDER BY position',[v.id])).rows.map(t=>({...t,weight:Number(t.weight)}));result.formalTestCount=result.tests.filter(t=>t.enabled).length;}else {const metadata=v.metadata||{},hasAC=!!(await db.query("SELECT 1 FROM submissions WHERE identity_id=$1 AND version_id=$2 AND kind IN ('submit','correction') AND status='AC' AND timed_attempt_id IS NULL LIMIT 1",[user.identityId,v.id])).rowCount;const allow=permissions.canRunFree&&(metadata.hintPolicy==='always'||metadata.hintPolicy!=='never'&&hasAC);if(allow){result.editorial=metadata.editorial||'';result.hints=metadata.hints||[];}else {result.editorial='';result.hints=[];}}return result;
 }
 async function submissionAccess(db,user,id) {
  const s=row(await db.query('SELECT s.*,v.title problem_title,i.name student_name FROM submissions s JOIN problem_versions v ON v.id=s.version_id JOIN identities i ON i.id=s.identity_id WHERE s.id=$1',[submissionId(id)]));
  if(s.identity_id!==user.identityId&&!rolesInclude(user,'admin')) {
   if(!rolesInclude(user,'teacher')||!(await db.query('SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id WHERE tc.account_id=$2 AND c.archived_at IS NULL AND (EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.identity_id=$1) OR EXISTS(SELECT 1 FROM assignments a WHERE a.id=$3 AND a.class_id=c.id) OR EXISTS(SELECT 1 FROM timed_attempts attempt JOIN timed_practices practice ON practice.id=attempt.practice_id WHERE attempt.id=$4 AND practice.class_id=c.id))',[s.identity_id,user.id,s.assignment_id,s.timed_attempt_id])).rowCount) fail(403,'FORBIDDEN','无权访问该提交');
  }
  if(rolesInclude(user,'admin')&&s.identity_id!==user.identityId) await audit(db,user.id,'submission.admin_read','submission',s.id);
  return s;
 }
 async function assignmentAccess(db,user,id) {
  const a=row(await db.query('SELECT * FROM assignments WHERE id=$1',[uuid(id,'作业 ID')]));
  const isParticipant=rolesInclude(user,'student')&&!!(await db.query('SELECT 1 FROM assignment_participants WHERE assignment_id=$1 AND identity_id=$2 AND NOT exempt',[id,user.identityId])).rowCount;
  const canManage=rolesInclude(user,'admin')||(rolesInclude(user,'teacher')&&!!(await db.query('SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id WHERE tc.class_id=$1 AND tc.account_id=$2 AND c.archived_at IS NULL',[a.class_id,user.id])).rowCount);
  if(a.state==='Draft'&&!canManage)fail(404,'NOT_FOUND','作业尚未发布');if(!isParticipant&&!canManage)fail(403,'FORBIDDEN','未分配该作业或无权管理');if(a.state==='Draft'&&!canManage)fail(404,'NOT_FOUND','作业尚未发布');return {...a,isParticipant:isParticipant&&a.state==='Published',canManage};
 }
 async function assignmentResult(db,user,id) {
  const a=await assignmentAccess(db,user,id);
  const ps=(await db.query('SELECT ap.problem_id,ap.version_id,ap.points,v.title,COALESCE(global_reward.points,10) first_ac_points,COALESCE(assignment_reward.points,0) reward_points FROM assignment_problems ap JOIN problem_versions v ON v.id=ap.version_id LEFT JOIN point_rewards global_reward ON global_reward.problem_id=ap.problem_id AND global_reward.assignment_id IS NULL LEFT JOIN point_rewards assignment_reward ON assignment_reward.problem_id=ap.problem_id AND assignment_reward.assignment_id=ap.assignment_id WHERE ap.assignment_id=$1 ORDER BY ap.position',[id])).rows;
  const result={id:a.id,title:a.title,classId:a.class_id,className:(await db.query('SELECT name FROM classes WHERE id=$1',[a.class_id])).rows[0]?.name,state:a.state,description:a.description,course:a.course,published:a.state==='Published',publishedAt:a.published_at,createdAt:a.created_at,dueAt:a.due_at,editRevision:a.edit_revision,problems:ps.map(p=>({problemId:p.problem_id,versionId:p.version_id,title:p.title,points:Number(p.points),firstAcPoints:Number(p.first_ac_points),rewardPoints:Number(p.reward_points)}))};
  {
   const protectedParticipantIds=a.canManage?(await db.query('SELECT DISTINCT identity_id FROM submissions WHERE assignment_id=$1',[id])).rows.map(person=>person.identity_id):[];
   if(a.canManage)result.protectedParticipantIds=protectedParticipantIds;
   if(a.canManage)result.hasSubmissions=!!(await db.query("SELECT 1 FROM submissions WHERE assignment_id=$1 AND kind='submit' LIMIT 1",[id])).rowCount;
   if(a.canManage)result.hasActivity=protectedParticipantIds.length>0;
   if(a.canManage)result.participants=(await db.query('SELECT identity_id FROM assignment_participants WHERE assignment_id=$1 AND NOT exempt',[id])).rows.map(p=>p.identity_id);
   if(a.canManage)result.participantDetails=(await db.query('SELECT part.identity_id,i.name,part.exempt FROM assignment_participants part JOIN identities i ON i.id=part.identity_id WHERE assignment_id=$1 ORDER BY i.name',[id])).rows.map(p=>({identityId:p.identity_id,name:p.name,exempt:p.exempt,hasActivity:protectedParticipantIds.includes(p.identity_id)}));
   const grades=(await db.query(`SELECT i.id identity_id,i.name,ap.problem_id,ap.points,s.id submission_id,s.score,COALESCE(s.status,pending.status) status,(pending.status IS NOT NULL) unresolved,pending.status pending_status FROM assignment_participants part JOIN identities i ON i.id=part.identity_id JOIN assignment_problems ap ON ap.assignment_id=part.assignment_id LEFT JOIN LATERAL (SELECT id,score,status FROM submissions WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id AND problem_id=ap.problem_id AND kind='submit' AND created_at<= $2 AND score IS NOT NULL AND status NOT IN ('Waiting','Judging','System Error') ORDER BY score DESC,created_at,id LIMIT 1) s ON true LEFT JOIN LATERAL (SELECT status FROM submissions WHERE assignment_id=part.assignment_id AND identity_id=part.identity_id AND problem_id=ap.problem_id AND kind='submit' AND created_at<=$2 AND status IN ('Waiting','Judging','System Error') ORDER BY created_at DESC LIMIT 1) pending ON true WHERE part.assignment_id=$1 AND NOT part.exempt AND ($3::uuid IS NULL OR part.identity_id=$3) ORDER BY i.name,ap.position`,[id,a.due_at,a.canManage?null:user.identityId])).rows;
   const byStudent=new Map();for(const g of grades){let s=byStudent.get(g.identity_id);if(!s){s={identityId:g.identity_id,name:g.name,score:0,maxScore:0,pending:false,hasScore:false,problems:[]};byStudent.set(g.identity_id,s);}const points=Number(g.points),score=g.score===null?null:Number(g.score);s.score+=score===null?0:score*points/100;s.maxScore+=points;s.pending ||= g.unresolved;s.hasScore ||= score!==null;s.problems.push({problemId:g.problem_id,submissionId:g.submission_id?`SUB${g.submission_id}`:null,score,status:g.status||'NotSubmitted',pending:g.unresolved,pendingStatus:g.pending_status});}result.grades=[...byStudent.values()].map(({hasScore,...g})=>({...g,score:g.pending&&!hasScore?null:Math.round(g.score*100)/100}));const graded=result.grades.filter(g=>!g.pending&&g.problems.some(p=>p.submissionId&&p.score!==null));result.applicableCount=a.canManage?result.participantDetails.filter(p=>!p.exempt).length:1;result.exemptCount=a.canManage?result.participantDetails.filter(p=>p.exempt).length:0;result.averagePercent=graded.length?Math.round(graded.reduce((total,g)=>total+(g.maxScore?100*g.score/g.maxScore:0),0)/graded.length*100)/100:null;result.submittedStudents=result.grades.filter(g=>g.problems.some(p=>p.submissionId||p.pending)).length;result.completedStudents=result.grades.filter(g=>g.problems.length&&g.problems.every(p=>p.status==='AC')).length;
  }return result;
 }
 function problemInput(body) {
  const savingDraft=body.saveDraft===true||body.state==='Draft';const mode=enumValue(body.mode,['stdio','function'],'题目类型'),title=field(body.title,'题名',{max:200}),statement=field(body.statement??'','题面',{min:savingDraft?0:1,max:262144});
  const functionName=mode==='function'?field(body.functionName,'函数名',{max:80}):null;
  if(functionName&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)) fail(400,'VALIDATION','函数名无效');
  const referenceCode=bytes(body.referenceCode??'','参考代码');if(!savingDraft&&!referenceCode.trim())fail(400,'VALIDATION','需要参考代码');
  const referenceLanguage=enumValue(body.referenceLanguage??'python',LANGUAGES,'参考解答语言');
  const starterCode=bytes(body.starterCode??'','初始代码'),timeLimitMs=integer(body.timeLimitMs??2000,100,5000,'时限'),memoryLimitMb=integer(body.memoryLimitMb??256,32,256,'内存');
  if(body.starterCodes!==undefined&&(!body.starterCodes||typeof body.starterCodes!=='object'||Array.isArray(body.starterCodes)||Object.keys(body.starterCodes).some(key=>!LANGUAGES.includes(key))))fail(400,'VALIDATION','初始代码语言无效');
  const starterCodes={};for(const language of LANGUAGES)if(body.starterCodes?.[language]!==undefined)starterCodes[language]=bytes(body.starterCodes[language],`${language} 初始代码`);
  const comparator=mode==='function'?'json':enumValue(body.comparator??'tokens',['tokens','exact'],'比较器');
  let incompleteFunction=false;const parseTest=(t,sample)=>{if(!t||typeof t!=='object')fail(400,'VALIDATION','测试格式无效');const input=bytes(t.input,'测试输入'),expected=bytes(t.expected,'期望输出'),name=field(t.name??'','测试名称',{min:0,max:200}),enabled=t.enabled===undefined?true:typeof t.enabled==='boolean'?t.enabled:fail(400,'VALIDATION','测试启用状态无效');if(mode==='function'&&enabled){try{parseFunctionInput(input);parseJsonValue(expected);}catch{if(savingDraft)incompleteFunction=true;else fail(400,'VALIDATION','函数测试必须使用 JSON 参数数组（或 args 对象）和 JSON 返回值');}}return sample?{input,expected,name,enabled}:{input,expected,weight:Number(t.weight??1),name,enabled};};
  body={...body,samples:body.samples??[],tests:body.tests??[]};if(!Array.isArray(body.samples)||body.samples.length<(savingDraft?0:1)||body.samples.length>20)fail(400,'VALIDATION','公开样例须为 1–20 项的数组');
  if(!Array.isArray(body.tests)||body.tests.length<(savingDraft?0:1)||body.tests.length>100)fail(400,'VALIDATION','正式测试须为 1–100 项');
  const samples=body.samples.map(t=>parseTest(t,true)),tests=body.tests.map(t=>parseTest(t,false)),enabledTests=tests.filter(t=>t.enabled),incomplete=incompleteFunction||!statement.trim()||!referenceCode.trim()||!samples.some(sample=>sample.enabled)||!enabledTests.length;
  if(tests.some(t=>!Number.isFinite(t.weight)||t.weight<=0||t.weight>100||Math.abs(t.weight*10000-Math.round(t.weight*10000))>0.00001)||enabledTests.length&&Math.abs(enabledTests.reduce((n,t)=>n+t.weight,0)-100)>0.00001)fail(400,'VALIDATION','正式测试权重总和必须为 100，最多四位小数');
  const bankId=uuid(body.bankId||SCHOOL_BANK,'题库 ID');if(body.tags!==undefined&&(!Array.isArray(body.tags)||body.tags.length>30))fail(400,'VALIDATION','标签最多 30 个');const tags=[...new Set((body.tags||[]).map(tag=>field(tag,'标签',{max:80})))],source=field(body.source??'','题目来源',{min:0,max:2000});if(incomplete&&!savingDraft)fail(400,'VALIDATION','完整题目须包含题面、参考解答、公开样例和启用的正式测试');const metadata={};for(const key of ['objective','inputDescription','outputDescription','difficulty','returnType','editorial'])if(body[key]!==undefined)metadata[key]=field(body[key],key,{min:0,max:key==='editorial'?50000:4000});for(const key of ['parameters','hints'])if(body[key]!==undefined){if(!Array.isArray(body[key])||body[key].length>30)fail(400,'VALIDATION',`${key}须为最多 30 项的数组`);metadata[key]=body[key].map(value=>typeof value==='string'?field(value,key,{min:0,max:4000}):{name:field(value.name??'',key,{min:0,max:200}),type:field(value.type??'',key,{min:0,max:200}),description:field(value.description??'',key,{min:0,max:4000})});}metadata.hintPolicy=enumValue(body.hintPolicy??'afterAC',['always','afterAC','never'],'提示策略');return {mode,title,statement,functionName,referenceCode,referenceLanguage,starterCode,starterCodes,timeLimitMs,memoryLimitMb,comparator,samples,tests,bankId,tags,source,metadata,incomplete};
 }
 async function insertVersion(db,user,problemId,input) {
  const settings=input.incomplete?await getSettings(db):await assertJudgeAdmission(db);if(!input.incomplete&&(input.timeLimitMs>settings.runtime.maxProblemCpuMs||input.memoryLimitMb>settings.runtime.maxProblemMemoryMb))fail(400,'RESOURCE_LIMIT','题目资源上限超过当前运行环境设置');
  const v=row(await db.query('INSERT INTO problem_versions(problem_id,title,mode,statement,function_name,starter_code,starter_codes,samples,time_limit_ms,memory_limit_mb,comparator,reference_code,reference_language,tags,source,metadata,validation_status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',[problemId,input.title,input.mode,input.statement,input.functionName,input.starterCode,JSON.stringify(input.starterCodes),JSON.stringify(input.samples),input.timeLimitMs,input.memoryLimitMb,input.comparator,input.referenceCode,input.referenceLanguage,JSON.stringify(input.tags),input.source,JSON.stringify(input.metadata),input.incomplete?'Incomplete':'Waiting']));
  for(let i=0;i<input.tests.length;i++){const t=input.tests[i];await db.query('INSERT INTO test_cases(version_id,position,input,expected,weight,name,enabled) VALUES($1,$2,$3,$4,$5,$6,$7)',[v.id,i,t.input,t.expected,t.weight,t.name,t.enabled]);}
  if(!input.incomplete)await db.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')",[v.id]);await audit(db,user.id,'problem.version_create','problem_version',v.id);return v;
 }
 async function issueActivation(db,user,identityId) {
  const person=row(await db.query('SELECT * FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[identityId]));
  if((await db.query('SELECT 1 FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL',[identityId])).rowCount)fail(409,'ACTIVATED','该身份已认领');
  const activationCode=randomToken();await db.query("INSERT INTO activation_tokens(identity_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days') ON CONFLICT(identity_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL",[identityId,tokenHash(activationCode)]);await audit(db,user.id,'identity.activation_issue','identity',identityId);return {person:personShape(person),activationCode};
 }

 async function authOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
   if(route==='/auth/me'&&method==='GET'){if(!user)fail(401,'UNAUTHENTICATED','请先登录');return respond(200,{user,csrfToken:sess.csrf_token});}
   if(route==='/auth/login'&&method==='POST') {
    ipLimiter.check(`login:${ip}`);const login=username(body.username),secret=password(body.password);authLimiter.check(`login:${login}`);
    const a=(await pool.query('SELECT a.* FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.username=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL',[login])).rows[0];
    const valid=await verifyPassword(a?.password_hash||dummyHash,secret);if(!a||!valid)fail(401,'LOGIN_FAILED','用户名或密码不正确');
    const result=await transaction(pool,async db=>{const locked=(await db.query('SELECT * FROM accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[a.id])).rows[0];if(!locked||!safeEqual(locked.password_hash,a.password_hash)||!await findUser(db,a.id))fail(401,'LOGIN_FAILED','用户名或密码不正确');if(sess)await db.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);await db.query('UPDATE accounts SET last_login_at=now() WHERE id=$1',[a.id]);await audit(db,a.id,'auth.login','account',a.id);return session(db,a.id);});return respond(200,result.body,result.cookie);
   }
   if(route==='/auth/verify-identity'&&method==='POST') {
    ipLimiter.check(`claim:${ip}`);const kind=enumValue(body.kind,['student','teacher'],'身份类型'),number=field(body.number,'编号'),name=field(body.name,'姓名'),code=field(body.activationCode,'激活码',{max:100});authLimiter.check(`claim:${kind}:${number}`);
    const i=(await pool.query('SELECT * FROM identities WHERE kind=$1 AND number=$2 AND archived_at IS NULL',[kind,number])).rows[0];const t=i?(await pool.query('SELECT * FROM activation_tokens WHERE identity_id=$1 AND consumed_at IS NULL AND expires_at>now()',[i.id])).rows[0]:null;
    if(!i||i.name!==name||!t||!safeEqual(tokenHash(code),t.token_hash)||(await pool.query('SELECT 1 FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL',[i?.id])).rowCount)fail(400,'CLAIM_FAILED','身份信息或激活码无效，请联系管理员');
    const classes=(await pool.query('SELECT c.name FROM classes c WHERE archived_at IS NULL AND (EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.identity_id=$1) OR EXISTS(SELECT 1 FROM identity_teacher_classes tc WHERE tc.class_id=c.id AND tc.identity_id=$1))',[i.id])).rows;return respond(200,{person:{kind:i.kind,number:i.number,name:i.name,gender:i.gender??null,classes}});
   }
   if(route==='/auth/register'&&method==='POST') {
    ipLimiter.check(`claim:${ip}`);const kind=enumValue(body.kind,['student','teacher','admin'],'身份类型'),number=field(body.number,'编号'),name=field(body.name,'姓名'),code=field(body.activationCode,'激活码',{max:100}),login=username(body.username);authLimiter.check(`claim:${kind}:${number}`);const hash=await hashPassword(body.password);
    const email=body.email===undefined||body.email===''?null:field(body.email,'邮箱',{max:254});if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'VALIDATION','邮箱格式无效');
    const result=await transaction(pool,async db=>{
     const i=(await db.query('SELECT * FROM identities WHERE kind=$1 AND number=$2 AND archived_at IS NULL FOR UPDATE',[kind,number])).rows[0];
     const t=i?(await db.query('SELECT * FROM activation_tokens WHERE identity_id=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[i.id])).rows[0]:null;
     if(!i||i.name!==name||!t||!safeEqual(tokenHash(code),t.token_hash)||(await db.query('SELECT 1 FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL',[i?.id])).rowCount)fail(400,'CLAIM_FAILED','身份信息或激活码无效，请联系管理员');
     const a=row(await db.query('INSERT INTO accounts(identity_id,username,password_hash,email,last_login_at) VALUES($1,$2,$3,$4,now()) RETURNING id',[i.id,login,hash,email]));
     await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[a.id,kind]);if(kind==='teacher')await bindPendingTeacherClasses(db,i.id,a.id);const previous=await restoreIdentityBindings(db,i.id,a.id);if(previous)await audit(db,a.id,'identity.rebind','identity',i.id,{previousAccountId:previous});await db.query('UPDATE activation_tokens SET consumed_at=now() WHERE identity_id=$1',[i.id]);await audit(db,a.id,'identity.claim','identity',i.id);return session(db,a.id);
    });return respond(201,result.body,result.cookie);
   }
   if(route==='/auth/reset'&&method==='POST') {
    ipLimiter.check(`reset:${ip}`);const login=username(body.username),code=field(body.resetCode,'重置凭据',{max:100});authLimiter.check(`reset:${login}`);const hash=await hashPassword(body.password);
    await transaction(pool,async db=>{const a=(await db.query('SELECT * FROM accounts WHERE username=$1 AND disabled_at IS NULL AND binding_released_at IS NULL FOR UPDATE',[login])).rows[0];const t=a?(await db.query('SELECT * FROM reset_tokens WHERE account_id=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[a.id])).rows[0]:null;if(!a||!t||!safeEqual(tokenHash(code),t.token_hash))fail(400,'RESET_FAILED','重置凭据无效或已过期');await db.query('UPDATE accounts SET password_hash=$1 WHERE id=$2',[hash,a.id]);await db.query('UPDATE reset_tokens SET consumed_at=now() WHERE account_id=$1',[a.id]);await db.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);await audit(db,a.id,'auth.password_reset','account',a.id);});return respond(200,{ok:true},sessionCookie('',{...config,maxAge:0}));
   }
   if(route==='/auth/logout'&&method==='POST'){await pool.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);return respond(200,{ok:true},sessionCookie('',{...config,maxAge:0}));}
   if(route==='/auth/profile'&&method==='PATCH') {
    if(body.email===undefined&&body.newPassword===undefined&&body.nickname===undefined&&body.bio===undefined&&body.avatar===undefined&&body.gender===undefined)fail(400,'VALIDATION','请提供要修改的个人资料');
    const nickname=body.nickname===undefined?undefined:field(body.nickname,'昵称',{min:0,max:40}),bio=body.bio===undefined?undefined:field(body.bio,'个人介绍',{min:0,max:500}),avatar=body.avatar===undefined?undefined:field(body.avatar,'头像',{min:0,max:100000}),gender=body.gender===undefined?undefined:genderValue(body.gender);
    if(avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))fail(400,'VALIDATION','头像仅支持 PNG、JPEG、WebP 图片');
    const email=body.email===undefined?undefined:body.email===null||body.email===''?null:field(body.email,'邮箱',{max:254});if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'VALIDATION','邮箱格式无效');
    let currentPassword,newHash;if(body.newPassword!==undefined){authLimiter.check(`password:${user.id}`);currentPassword=password(body.currentPassword);newHash=await hashPassword(body.newPassword);}
    const result=await transaction(pool,async db=>{const a=row(await db.query('SELECT * FROM accounts WHERE id=$1 AND disabled_at IS NULL AND binding_released_at IS NULL FOR UPDATE',[user.id]));if(newHash&&!await verifyPassword(a.password_hash,currentPassword))fail(400,'PASSWORD_INCORRECT','当前密码不正确');if(nickname!==undefined)await db.query('UPDATE accounts SET nickname=$1 WHERE id=$2',[nickname,user.id]);if(bio!==undefined)await db.query('UPDATE accounts SET bio=$1 WHERE id=$2',[bio,user.id]);if(avatar!==undefined)await db.query('UPDATE accounts SET avatar=$1 WHERE id=$2',[avatar,user.id]);if(email!==undefined)await db.query('UPDATE accounts SET email=$1 WHERE id=$2',[email,user.id]);if(gender!==undefined)await db.query('UPDATE identities SET gender=$1 WHERE id=$2',[gender,user.identityId]);if(newHash){await db.query('UPDATE accounts SET password_hash=$1 WHERE id=$2',[newHash,user.id]);await db.query('DELETE FROM sessions WHERE account_id=$1',[user.id]);}if(newHash||nickname!==undefined||bio!==undefined||avatar!==undefined||email!==undefined)await audit(db,user.id,newHash?'auth.password_change':email!==undefined?'account.email_change':'account.profile_update','account',user.id);if(gender!==undefined)await audit(db,user.id,'identity.gender_update','identity',user.identityId);return newHash?session(db,user.id):{body:{user:await findUser(db,user.id),csrfToken:sess.csrf_token}};});return respond(200,result.body,result.cookie);
   }
  return null;
 }

 async function peopleOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handlePeopleAlignment,handleLibrary]) { const result=await handler(context); if(result)return result; }
   if(route==='/accounts'&&method==='GET') {
    admin(user);const items=(await pool.query("SELECT a.id,a.username,a.identity_id,i.name,i.number,i.kind,a.disabled_at,ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) roles FROM accounts a JOIN identities i ON i.id=a.identity_id ORDER BY a.created_at DESC LIMIT 5000")).rows.map(a=>({id:a.id,identityId:a.identity_id,name:a.name,number:a.number,kind:a.kind,username:a.username,disabled:!!a.disabled_at,roles:a.roles}));return respond(200,{items});
   }
   const accountMatch=route.match(/^\/accounts\/([^/]+)$/);
   if(accountMatch&&method==='PATCH') {
    admin(user);const id=uuid(accountMatch[1]);
    if(body.disabled!==undefined&&typeof body.disabled!=='boolean')fail(400,'VALIDATION','停用状态无效');
    if(body.roles!==undefined&&(!Array.isArray(body.roles)||!body.roles.length||body.roles.some(r=>!['student','teacher','admin'].includes(r))))fail(400,'VALIDATION','角色列表无效');
    await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(798944)');const a=row(await db.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[id]));
     if(a.binding_released_at)fail(409,'RELEASED_ACCOUNT','历史解绑账号不能重新启用或修改角色，请管理当前绑定账号');
     const hadAdmin=!!(await db.query("SELECT 1 FROM account_roles WHERE account_id=$1 AND role='admin'",[id])).rowCount;
     if(hadAdmin&&!a.disabled_at&&(body.disabled===true||body.roles&&!body.roles.includes('admin'))){const n=(await db.query("SELECT count(*)::int n FROM account_roles r JOIN accounts a ON a.id=r.account_id JOIN identities i ON i.id=a.identity_id WHERE r.role='admin' AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL")).rows[0].n;if(n<=1)fail(409,'LAST_ADMIN','不能停用或移除最后一个有效管理员');}
     if(body.disabled!==undefined)await db.query('UPDATE accounts SET disabled_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1',[id,body.disabled]);
     if(body.roles){await db.query('DELETE FROM account_roles WHERE account_id=$1',[id]);for(const role of new Set(body.roles))await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[id,role]);}
     await db.query('DELETE FROM sessions WHERE account_id=$1',[id]);await audit(db,user.id,'account.update','account',id,{disabled:body.disabled,roles:body.roles});
    });return respond(200,{ok:true});
   }
   if(route==='/people'&&method==='GET'){
    staff(user);const rows=(await pool.query("SELECT i.*,EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL) activated,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)) FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=i.id AND c.archived_at IS NULL),'[]'::jsonb) classes FROM identities i WHERE i.archived_at IS NULL AND ($1 OR i.id=$2 OR EXISTS(SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id WHERE cm.identity_id=i.id AND tc.account_id=$3)) ORDER BY i.kind,i.number LIMIT 5000",[rolesInclude(user,'admin'),user.identityId,user.id])).rows;return respond(200,{items:rows.map(personShape)});
   }
   if(route==='/people'&&method==='POST'){
    admin(user);const kind=enumValue(body.kind,['student','teacher','admin'],'身份类型'),number=field(body.number,'编号'),name=field(body.name,'姓名'),classIds=identityIds(body.classIds,'班级',50);const result=await transaction(pool,async db=>{const i=row(await db.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING *',[kind,number,name]));for(const classId of classIds){await classAccess(db,user,uuid(classId));await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,i.id]);}await audit(db,user.id,'identity.create','identity',i.id);return issueActivation(db,user,i.id);});return respond(201,result);
   }
   if(route==='/people/import'&&method==='POST') {
    admin(user);if(!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>5000)fail(400,'VALIDATION','身份导入须包含 1–5000 行');
    const result=await transaction(pool,async db=>{
     const items=[];let created=0,skipped=0,failed=0;
     for(let line=0;line<body.rows.length;line++){
      await db.query('SAVEPOINT import_row');
      try {
       const entry=body.rows[line],kind=enumValue(entry?.kind,['student','teacher'],'身份类型'),number=field(entry.number,'编号'),name=field(entry.name,'姓名');
       const r=await db.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) ON CONFLICT(kind,number) DO NOTHING RETURNING *',[kind,number,name]);
       if(r.rowCount){const issued=await issueActivation(db,user,r.rows[0].id);items.push({line:line+1,status:'created',...issued});created++;}
       else {const old=row(await db.query('SELECT i.*,EXISTS(SELECT 1 FROM accounts WHERE identity_id=i.id AND binding_released_at IS NULL) activated FROM identities i WHERE kind=$1 AND number=$2',[kind,number]));if(old.name!==name||old.archived_at)fail(409,'IMPORT_CONFLICT','编号已存在且姓名不同或身份已归档，须人工核对');items.push({line:line+1,status:'skipped',person:personShape(old),message:'身份已存在，保留原账号与激活状态'});skipped++;}
       await db.query('RELEASE SAVEPOINT import_row');
      } catch(error) {await db.query('ROLLBACK TO SAVEPOINT import_row');await db.query('RELEASE SAVEPOINT import_row');items.push({line:line+1,status:'failed',message:error instanceof HttpError?error.message:'该行数据无效'});failed++;}
     }
     const summary={created,skipped,failed,total:items.length};await audit(db,user.id,'identity.import','identity','batch',summary);return {items,summary};
    });return respond(200,result);
   }
   const personMatch=route.match(/^\/people\/([^/]+)$/);
   if(personMatch&&method==='PATCH') {
    admin(user);const id=uuid(personMatch[1]);const person=await transaction(pool,async db=>{const i=row(await db.query('SELECT * FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id]));const name=body.name===undefined?i.name:field(body.name,'姓名'),number=body.number===undefined?i.number:field(body.number,'编号');const updated=row(await db.query('UPDATE identities SET name=$1,number=$2 WHERE id=$3 RETURNING *',[name,number,id]));await audit(db,user.id,'identity.update','identity',id);return personShape(updated);});return respond(200,person);
   }
   const unbindMatch=route.match(/^\/people\/([^/]+)\/unbind$/);
   if(unbindMatch&&method==='POST') {
    admin(user);const identityId=uuid(unbindMatch[1]);const output=await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(798944)');row(await db.query('SELECT id FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[identityId]));const a=row(await db.query('SELECT * FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL FOR UPDATE',[identityId]));
     const hadAdmin=!!(await db.query("SELECT 1 FROM account_roles WHERE account_id=$1 AND role='admin'",[a.id])).rowCount;
     if(hadAdmin&&!a.disabled_at){const count=(await db.query("SELECT count(*)::int n FROM account_roles r JOIN accounts a ON a.id=r.account_id JOIN identities i ON i.id=a.identity_id WHERE r.role='admin' AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL")).rows[0].n;if(count<=1)fail(409,'LAST_ADMIN','不能解绑最后一个有效管理员');}
     await db.query('UPDATE accounts SET disabled_at=now(),binding_released_at=now() WHERE id=$1',[a.id]);await db.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);await db.query('DELETE FROM reset_tokens WHERE account_id=$1',[a.id]);await audit(db,user.id,'identity.unbind','identity',identityId,{previousAccountId:a.id});return issueActivation(db,user,identityId);
    });return respond(200,output);
   }
   m=route.match(/^\/people\/([^/]+)\/activation$/);
   if(m&&method==='POST'){admin(user);return respond(200,await transaction(pool,db=>issueActivation(db,user,uuid(m[1]))));}
   m=route.match(/^\/people\/([^/]+)\/reset$/);
   if(m&&method==='POST'){admin(user);const result=await transaction(pool,async db=>{const a=row(await db.query('SELECT * FROM accounts WHERE identity_id=$1 AND disabled_at IS NULL AND binding_released_at IS NULL FOR UPDATE',[uuid(m[1])]));const resetCode=randomToken();await db.query("INSERT INTO reset_tokens(account_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes') ON CONFLICT(account_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL",[a.id,tokenHash(resetCode)]);await audit(db,user.id,'account.reset_issue','account',a.id);return {username:a.username,resetCode};});return respond(200,result);}
  return null;
 }

 async function classesOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handleMemberImport]) { const result=await handler(context); if(result)return result; }
   if(route==='/classes'&&method==='GET'){
    const rows=(await pool.query(`SELECT c.*,($1 OR $2 AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=c.id AND tc.account_id=$3)) can_manage FROM classes c WHERE c.archived_at IS NULL AND ($1 OR $2 AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=c.id AND tc.account_id=$3) OR EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.identity_id=$4)) ORDER BY c.created_at DESC`,[rolesInclude(user,'admin'),rolesInclude(user,'teacher'),user.id,user.identityId])).rows;
    const items=[];for(const c of rows){const members=(await pool.query('SELECT i.id,i.name,i.number,i.kind,i.gender,a.username,(a.id IS NOT NULL) activated FROM class_members cm JOIN identities i ON i.id=cm.identity_id LEFT JOIN accounts a ON a.identity_id=i.id AND a.binding_released_at IS NULL WHERE cm.class_id=$1 AND i.archived_at IS NULL ORDER BY i.number',[c.id])).rows;const visible=c.can_manage?members:members.filter(i=>i.id===user.identityId);const teachers=(await pool.query('SELECT a.identity_id FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id WHERE tc.class_id=$1',[c.id])).rows;items.push({id:c.id,name:c.name,type:c.type,description:c.description,members:visible,studentIds:visible.filter(i=>i.kind==='student').map(i=>i.id),teacherIds:teachers.map(t=>t.identity_id),memberCount:members.length});}return respond(200,{items});
   }
   if(route==='/classes'&&method==='POST'){
    staff(user);const name=field(body.name,'班级名称'),description=field(body.description??'','班级说明',{min:0,max:4000}),type=enumValue(body.type||'training',['administrative','training'],'班级类型'),studentIds=identityIds(body.studentIds,'学生'),teacherIds=identityIds(body.teacherIds,'教师',50);const c=await transaction(pool,async db=>{const c=row(await db.query('INSERT INTO classes(name,type,owner_account_id,description) VALUES($1,$2,$3,$4) RETURNING *',[name,type,user.id,description]));await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[c.id,user.id]);for(const id of studentIds){const i=await studentRosterAccess(db,user,id);await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[c.id,i.id]);}for(const id of teacherIds){if(!rolesInclude(user,'admin')&&id!==user.identityId)fail(403,'FORBIDDEN','教师只能为自己创建班级');const a=row(await db.query("SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.identity_id=$1 AND r.role IN ('teacher','admin') AND a.disabled_at IS NULL AND a.binding_released_at IS NULL",[uuid(id)]));await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[c.id,a.id]);}await audit(db,user.id,'class.create','class',c.id);return c;});return respond(201,{id:c.id,name:c.name,type:c.type,description:c.description,members:[],studentIds,teacherIds:teacherIds.length?teacherIds:[user.identityId],memberCount:studentIds.length});
   }
   const classMatch=route.match(/^\/classes\/([^/]+)$/);
   if(classMatch&&method==='PATCH') {
    staff(user);const id=uuid(classMatch[1]),studentIds=body.studentIds===undefined?null:identityIds(body.studentIds,'学生'),teacherIds=body.teacherIds===undefined?null:identityIds(body.teacherIds,'教师',50);if(teacherIds&&!rolesInclude(user,'admin'))fail(403,'FORBIDDEN','教师任课授权须由管理员配置');
    const output=await transaction(pool,async db=>{const cls=await classAccess(db,user,id);await db.query('SELECT id FROM classes WHERE id=$1 FOR UPDATE',[id]);const name=body.name===undefined?cls.name:field(body.name,'班级名称'),type=body.type===undefined?cls.type:enumValue(body.type,['administrative','training'],'班级类型');const description=body.description===undefined?cls.description:field(body.description,'班级说明',{min:0,max:4000});await db.query('UPDATE classes SET name=$1,type=$2,description=$4 WHERE id=$3',[name,type,id,description]);if(studentIds){for(const identity of studentIds)await studentRosterAccess(db,user,identity);await db.query('DELETE FROM class_members WHERE class_id=$1',[id]);for(const identity of studentIds)await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[id,identity]);}if(teacherIds){const accountIds=[];for(const identity of teacherIds){const a=row(await db.query("SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.identity_id=$1 AND a.binding_released_at IS NULL AND a.disabled_at IS NULL AND r.role IN ('teacher','admin')",[identity]));accountIds.push(a.id);}await db.query('DELETE FROM teacher_classes WHERE class_id=$1',[id]);for(const account of accountIds)await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[id,account]);}await audit(db,user.id,'class.update','class',id,{studentCount:studentIds?.length,teacherCount:teacherIds?.length});return {id,name,type,description,studentIds:studentIds||(await db.query('SELECT identity_id FROM class_members WHERE class_id=$1',[id])).rows.map(m=>m.identity_id),teacherIds:teacherIds||(await db.query('SELECT a.identity_id FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id WHERE tc.class_id=$1',[id])).rows.map(m=>m.identity_id)};});return respond(200,output);
   }
   m=route.match(/^\/classes\/([^/]+)\/members$/);
   if(m&&method==='POST'){
    staff(user);const ids=body.identityIds??(body.identityId?[body.identityId]:null);if(!Array.isArray(ids)||!ids.length||ids.length>500)fail(400,'VALIDATION','请选择 1–500 名成员');await transaction(pool,async db=>{await classAccess(db,user,m[1]);for(const id of ids){const i=await studentRosterAccess(db,user,id);await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[m[1],i.id]);}await audit(db,user.id,'class.members_add','class',m[1],{count:ids.length});});return respond(200,{ok:true});
   }
  return null;
 }

 async function libraryOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handleFavorites,handleLibrary]) { const result=await handler(context); if(result)return result; }
   if(route==='/problems'&&method==='GET'){
    const rows=(await pool.query(`SELECT v.*,
     (SELECT count(*) FROM test_cases tc WHERE tc.version_id=v.id AND tc.enabled) formal_test_count,
     p.bank_id,bank.visibility bank_visibility,
     CASE WHEN $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
      THEN p.current_version_id ELSE v.id END published_version_id,
     CASE WHEN $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
      THEN pv.title ELSE v.title END published_title,
     ($2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission='edit')) can_edit
    FROM problems p JOIN problem_banks bank ON bank.id=p.bank_id
    LEFT JOIN bank_permissions bp ON bp.bank_id=bank.id AND bp.account_id=$1
    JOIN LATERAL (
     SELECT * FROM problem_versions v WHERE v.problem_id=p.id AND (
      $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
      OR v.published_at IS NOT NULL AND bank.visibility='school' AND v.school_visible_at IS NOT NULL
      OR $5 AND v.published_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM assignment_problems ap JOIN assignments assignment
        ON assignment.id=ap.assignment_id AND assignment.state='Published'
       JOIN assignment_participants part ON part.assignment_id=ap.assignment_id
       WHERE ap.version_id=v.id AND part.identity_id=$4 AND NOT part.exempt)
      OR $5 AND v.published_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM timed_practice_problems tp JOIN timed_practices practice ON practice.id=tp.practice_id
       JOIN timed_practice_participants part ON part.practice_id=tp.practice_id
       LEFT JOIN timed_attempts attempt ON attempt.practice_id=tp.practice_id AND attempt.identity_id=part.identity_id
       WHERE tp.version_id=v.id AND part.identity_id=$4 AND NOT part.exempt
        AND (practice.results_published_at IS NOT NULL OR attempt.id IS NOT NULL))
     ) ORDER BY
      CASE WHEN $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
        THEN 0 WHEN bank.visibility='school' AND v.school_visible_at IS NOT NULL THEN 1 ELSE 2 END,
      CASE WHEN $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
       THEN v.created_at ELSE v.published_at END DESC NULLS LAST,v.created_at DESC,v.id DESC LIMIT 1
    ) v ON true
    LEFT JOIN problem_versions pv ON pv.id=p.current_version_id AND pv.published_at IS NOT NULL
    WHERE p.archived_at IS NULL AND bank.archived_at IS NULL
     AND ($6::uuid IS NULL OR bank.id=$6)
    ORDER BY p.created_at DESC LIMIT 500`,[user.id,rolesInclude(user,'admin'),rolesInclude(user,'teacher'),user.identityId,rolesInclude(user,'student'),url.searchParams.get('bankId')?uuid(url.searchParams.get('bankId')):null])).rows;
    const problemIds=rows.map(r=>r.problem_id),ownProgress=await problemOwnProgress(pool,user,problemIds);
    const configured=(await pool.query('SELECT problem_id,points FROM point_rewards WHERE assignment_id IS NULL AND problem_id=ANY($1::uuid[])',[problemIds])).rows;
    const firstAcPoints=new Map(configured.map(reward=>[reward.problem_id,reward.points]));
    return respond(200,{items:rows.map(r=>({...problemShape(r,{includeDisabledSamples:!!r.can_edit}),bankId:r.bank_id,canEdit:!!r.can_edit,canPublish:!!r.can_edit&&r.validation_status==='AC'&&!r.published_at,firstAcPoints:firstAcPoints.get(r.problem_id)??10,ownProgress:ownProgress.get(r.problem_id)||emptyOwnProgress()}))});
   }
   if(route==='/problems'&&method==='POST'){
    staff(user);const input=problemInput(body);const v=await transaction(pool,async db=>{const access=await bankAccess(db,user,input.bankId);if(!access.canContribute)fail(403,'FORBIDDEN','无权向该题库添加题目');const p=row(await db.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[user.id,input.bankId]));return insertVersion(db,user,p.id,input);});return respond(201,await problemResult(pool,user,v.problem_id,v.id));
   }
   m=route.match(/^\/problems\/([^/]+)$/);
   if(m&&method==='GET')return respond(200,await problemResult(pool,user,m[1],url.searchParams.get('versionId')));
   m=route.match(/^\/problems\/([^/]+)\/versions$/);
   if(m&&method==='POST'){
    staff(user);const input=problemInput(body);const v=await transaction(pool,async db=>{const {owner,p}=await versionAccess(db,user,m[1]);if(!owner)fail(403,'FORBIDDEN','无权修改该题');if(body.bankId&&input.bankId!==p.bank_id)fail(409,'BANK_IMMUTABLE','题目版本仍属于原题库；跨题库请新建副本并保留来源');return insertVersion(db,user,m[1],input);});return respond(201,await problemResult(pool,user,v.problem_id,v.id));
   }
   m=route.match(/^\/problems\/([^/]+)\/(publish|validate)$/);
   if(m&&method==='POST'){
    staff(user);const result=await transaction(pool,async db=>{const {v,owner}=await versionAccess(db,user,m[1],uuid(body.versionId,'版本 ID'));if(!owner)fail(403,'FORBIDDEN','无权发布该题');await db.query('SELECT id FROM problem_versions WHERE id=$1 FOR UPDATE',[v.id]);const fresh=row(await db.query('SELECT * FROM problem_versions WHERE id=$1',[v.id]));if(m[2]==='publish'){if(fresh.validation_status!=='AC')fail(409,'NOT_VALIDATED','参考解答须通过全部正式测试后才能发布');if(!fresh.published_at)await db.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[v.id]);await db.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[v.id,m[1]]);await audit(db,user.id,'problem.publish','problem_version',v.id);return problemResult(db,user,m[1],v.id);}if(fresh.published_at)fail(409,'IMMUTABLE','已发布版本不能重新验证，请创建新版本');if(fresh.validation_status==='Incomplete')fail(409,'INCOMPLETE','请补齐题面、参考解答、样例与正式测试并保存新版本后验证');if(!['Waiting','Judging'].includes(fresh.validation_status)){await assertJudgeAdmission(db);await db.query("UPDATE problem_versions SET validation_status='Waiting',validation_message=NULL WHERE id=$1",[v.id]);await db.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')",[v.id]);}return {versionId:v.id,validationStatus:'Waiting'};});return respond(200,result);
   }
  return null;
 }

 async function assignmentsOperation(context) {
  const authored=await handleAssignmentAuthoring(context);if(authored)return authored;
  const {route,method,body,url,user,sess,ip}=context;
  let m;
   if(route==='/assignments'&&method==='GET'){
    const rows=(await pool.query(`SELECT a.* FROM assignments a WHERE $1 OR $2 AND EXISTS(SELECT 1 FROM teacher_classes tc JOIN classes c ON c.id=tc.class_id WHERE tc.class_id=a.class_id AND tc.account_id=$3 AND c.archived_at IS NULL) OR $4 AND a.state='Published' AND EXISTS(SELECT 1 FROM assignment_participants p WHERE p.assignment_id=a.id AND p.identity_id=$5 AND NOT p.exempt) ORDER BY a.created_at DESC LIMIT 200`,[rolesInclude(user,'admin'),rolesInclude(user,'teacher'),user.id,rolesInclude(user,'student'),user.identityId])).rows;const items=[];for(const a of rows)items.push(await assignmentResult(pool,user,a.id));return respond(200,{items,serverNow:row(await pool.query('SELECT clock_timestamp() AS server_now')).server_now});
   }
   if(route==='/assignments'&&method==='POST'){
    staff(user);const title=field(body.title,'作业标题'),classId=uuid(body.classId,'班级 ID'),dueAt=new Date(body.dueAt);if(!Number.isFinite(dueAt.getTime())||dueAt<=new Date())fail(400,'VALIDATION','截止时间须晚于现在');if(!Array.isArray(body.problems)||body.problems.length<1||body.problems.length>50)fail(400,'VALIDATION','作业须包含 1–50 题');
    const a=await transaction(pool,async db=>{await classAccess(db,user,classId);const participants=body.participants??(await db.query('SELECT identity_id FROM class_members WHERE class_id=$1',[classId])).rows.map(p=>p.identity_id);if(!Array.isArray(participants)||!participants.length||participants.length>500)fail(400,'VALIDATION','请选择 1–500 名学生');const a=row(await db.query('INSERT INTO assignments(title,class_id,owner_account_id,due_at) VALUES($1,$2,$3,$4) RETURNING id',[title,classId,user.id,dueAt]));for(let i=0;i<body.problems.length;i++){const p=body.problems[i],points=Number(p.points);if(!Number.isFinite(points)||points<=0||points>1000)fail(400,'VALIDATION','题目分值须为 0–1000');const problem=row(await db.query('SELECT p.*,v.published_at FROM problems p JOIN problem_versions v ON v.id=p.current_version_id WHERE p.id=$1 AND p.archived_at IS NULL',[uuid(p.problemId)]));if(!problem.published_at)fail(409,'UNPUBLISHED','作业只能选择已发布题目');await versionAccess(db,user,problem.id,problem.current_version_id);await db.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,$4,$5)',[a.id,problem.id,problem.current_version_id,points,i]);}for(const id of new Set(participants)){if(!(await db.query('SELECT 1 FROM class_members cm JOIN identities i ON i.id=cm.identity_id WHERE class_id=$1 AND identity_id=$2 AND i.archived_at IS NULL AND i.kind=$3',[classId,uuid(id),'student'])).rowCount)fail(400,'VALIDATION','作业成员须为本班有效学生');await db.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[a.id,id]);}await audit(db,user.id,'assignment.create','assignment',a.id);return a;});return respond(201,await assignmentResult(pool,user,a.id));
   }
   m=route.match(/^\/assignments\/([^/]+)$/);
   if(m&&method==='GET')return respond(200,await assignmentResult(pool,user,m[1]));
   m=route.match(/^\/assignments\/([^/]+)\/participants\/([^/]+)$/);
   if(m&&method==='PATCH') {
    staff(user);if(typeof body.exempt!=='boolean')fail(400,'VALIDATION','豁免状态无效');const assignmentId=uuid(m[1]),identityId=uuid(m[2]),reason=field(body.reason,'豁免原因',{max:2000});
    await transaction(pool,async db=>{await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[assignmentId]);const a=await assignmentAccess(db,user,assignmentId);if(!a.canManage)fail(403,'FORBIDDEN','无权管理该作业');if(!(await db.query('SELECT clock_timestamp()<=$1 allowed',[a.due_at])).rows[0].allowed)fail(409,'DEADLINE_PASSED','截止后变更名单须先明确延期并审计');row(await db.query('UPDATE assignment_participants SET exempt=$1 WHERE assignment_id=$2 AND identity_id=$3 RETURNING identity_id',[body.exempt,assignmentId,identityId]));await db.query('UPDATE assignments SET edit_revision=edit_revision+1 WHERE id=$1',[assignmentId]);await audit(db,user.id,'assignment.participant_exempt','assignment',assignmentId,{identityId,exempt:body.exempt,reason});});return respond(200,await assignmentResult(pool,user,assignmentId));
   }
   m=route.match(/^\/assignments\/([^/]+)\/extend$/);
   if(m&&method==='POST') {
    staff(user);const assignmentId=uuid(m[1]),reason=field(body.reason,'延期原因',{max:2000}),dueAt=new Date(body.dueAt);if(!Number.isFinite(dueAt.getTime())||dueAt<=new Date())fail(400,'VALIDATION','新截止时间须晚于现在');
    await transaction(pool,async db=>{await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[assignmentId]);const a=await assignmentAccess(db,user,assignmentId);if(!a.canManage)fail(403,'FORBIDDEN','无权管理该作业');if(dueAt<=new Date(a.due_at))fail(400,'VALIDATION','延期须晚于原截止时间');await db.query('UPDATE assignments SET due_at=$1,edit_revision=edit_revision+1 WHERE id=$2',[dueAt,assignmentId]);await audit(db,user.id,'assignment.extend','assignment',assignmentId,{previousDueAt:a.due_at,dueAt:dueAt.toISOString(),reason});});return respond(200,await assignmentResult(pool,user,assignmentId));
   }
  return null;
 }

 async function submissionsOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handleLibrary]) { const result=await handler(context); if(result)return result; }
   if(route==='/submissions'&&method==='GET'){
    const history=await submissionHistory(context);
    if(rolesInclude(user,'admin'))await audit(pool,user.id,'submissions.admin_list','submission','list');return respond(200,{items:await Promise.all(history.rows.map(async r=>submissionShape(await timed.maskSubmission(pool,user,r)))),nextCursor:history.nextCursor});
   }
   if(route==='/submissions'&&method==='POST'){
    const kind=enumValue(body.kind,['submit','samples','custom','correction'],'提交类型'),language=enumValue(body.language??'python',LANGUAGES,'代码语言'),problemId=uuid(body.problemId),code=bytes(body.code,'代码',config.codeLimit),key=field(body.idempotencyKey,'请求去重键',{min:8,max:100}),assignmentId=body.assignmentId?uuid(body.assignmentId):null,timedPracticeId=body.timedPracticeId?uuid(body.timedPracticeId):null,requestedVersion=body.versionId?uuid(body.versionId,'版本 ID'):null,originalId=body.originalSubmissionId?submissionId(body.originalSubmissionId):null,customInput=kind==='custom'?bytes(body.customInput??'','自定义输入'):null;
    if(timedPracticeId&&(assignmentId||kind==='correction'))fail(400,'VALIDATION','计时训练不能混合作业或订正上下文');if(!code.trim())fail(400,'VALIDATION','请先输入代码');if(kind==='correction'&&!originalId)fail(400,'VALIDATION','订正需要原提交编号');if(kind!=='correction'&&originalId)fail(400,'VALIDATION','该提交类型不能设置原提交');
    const requestHash=canonicalHash({kind,language,problemId,code,assignmentId,timedPracticeId,requestedVersion,originalId,customInput});
    // Requests accepted before migration 013 omitted language from the hash.
    // Their stored rows default to Python; preserve retry semantics without
    // allowing a reused key to silently switch to another language.
    const legacyPythonHash=language==='python'?canonicalHash({kind,problemId,code,assignmentId,timedPracticeId,requestedVersion,originalId,customInput}):null;
    const result=await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${user.id}:${key}`]);
     const old=(await db.query('SELECT s.*,v.title problem_title FROM submissions s JOIN problem_versions v ON v.id=s.version_id WHERE account_id=$1 AND idempotency_key=$2',[user.id,key])).rows[0];if(old){if(old.request_hash!==requestHash&&!(old.language==='python'&&old.request_hash===legacyPythonHash))fail(409,'IDEMPOTENCY_CONFLICT','相同请求键对应的内容不同');return old;}
     submitLimiter.check(user.id);
     await assertJudgeAdmission(db);
     if((await db.query("SELECT count(*)::int count FROM submissions WHERE identity_id=$1 AND status IN ('Waiting','Judging')",[user.identityId])).rows[0].count>=5)fail(429,'TOO_MANY_PENDING','最多同时等待 5 个运行，请等待已有结果');
     let resolvedVersion=requestedVersion,assignment=null;
     if(assignmentId){
      // Serialize against teacher edits before reading the pinned version or
      // checking its visibility. A concurrent version switch must yield one
      // coherent assignment snapshot, never permission for an obsolete pin.
      await db.query('SELECT id FROM assignments WHERE id=$1 FOR SHARE',[assignmentId]);
      assignment=await assignmentAccess(db,user,assignmentId);
      if(!assignment.isParticipant)fail(403,'FORBIDDEN','只能作为被分配的学生提交作业，教师请使用练习预览');
      const pinned=row(await db.query('SELECT version_id FROM assignment_problems WHERE assignment_id=$1 AND problem_id=$2',[assignmentId,problemId]));
      if(requestedVersion&&requestedVersion!==pinned.version_id)fail(409,'VERSION_MISMATCH','提交版本与作业固定版本不同，请刷新作业');
      resolvedVersion=pinned.version_id;
     }
     if(!resolvedVersion&&timedPracticeId)resolvedVersion=row(await db.query('SELECT version_id FROM timed_practice_problems WHERE practice_id=$1 AND problem_id=$2',[timedPracticeId,problemId])).version_id;
     if(!resolvedVersion&&originalId)resolvedVersion=(await submissionAccess(db,user,originalId)).version_id;
     const {p,v:accessibleVersion,permissions}=await versionAccess(db,user,problemId,resolvedVersion);
     // A student may still see an older approved version while a replacement
     // awaits review. Submit exactly the version that access checked.
     const submissionVersion=resolvedVersion||(permissions.canEdit||!accessibleVersion.published_at?p.current_version_id:accessibleVersion.id);
     let v=row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND published_at IS NOT NULL',[submissionVersion]),'学生运行需要已发布题目');
     let acceptedAt=row(await db.query('SELECT clock_timestamp() AS accepted_at')).accepted_at;
     if(assignment&&kind==='submit'){
      const time=row(await db.query('SELECT clock_timestamp() AS accepted_at,clock_timestamp() <= $1 AS allowed',[assignment.due_at]));
      acceptedAt=time.accepted_at;
      if(!time.allowed)fail(409,'DEADLINE_PASSED','作业已截止，可以在练习中继续或提交订正');
     }
     if(originalId){const original=await submissionAccess(db,user,originalId);if(original.timed_attempt_id&&!(await db.query('SELECT 1 FROM timed_attempts attempt JOIN timed_practices practice ON practice.id=attempt.practice_id WHERE attempt.id=$1 AND practice.results_published_at IS NOT NULL',[original.timed_attempt_id])).rowCount)fail(409,'RESULTS_NOT_RELEASED','计时训练成绩发布后才能提交订正');if(original.identity_id!==user.identityId||original.problem_id!==problemId||!['submit','correction'].includes(original.kind))fail(400,'VALIDATION','只能订正自己的同题正式提交');if(assignmentId&&original.assignment_id!==assignmentId)fail(409,'ASSIGNMENT_CONTEXT_MISMATCH','作业订正须引用本作业的原提交');if(assignmentId&&original.version_id!==resolvedVersion)fail(409,'VERSION_MISMATCH','作业订正须使用当前固定的题目版本');if(requestedVersion&&requestedVersion!==original.version_id)fail(409,'VERSION_MISMATCH','订正版本与原提交不同');v=row(await db.query('SELECT * FROM problem_versions WHERE id=$1',[original.version_id]));}
     if(!timedPracticeId&&!permissions.canRunFree)fail(403,'TIMED_CONTEXT_REQUIRED','该题目仅授权用于当前计时训练，请从训练工作区提交');const timedContext=await timed.prepareSubmission(db,user,body,v);if(timedContext){v=timedContext.version;acceptedAt=timedContext.acceptedAt;}if(kind==='samples'&&!(v.samples||[]).some(sample=>sample.enabled!==false))fail(409,'NO_PUBLIC_SAMPLES','此版本没有启用的公开样例，请联系教师补齐后运行');if(kind==='custom'&&v.mode==='function'){try{parseFunctionInput(customInput);}catch{fail(400,'VALIDATION','函数自测输入须为 JSON 参数数组或合法的 args/kwargs 对象');}}
     const s=row(await db.query('INSERT INTO submissions(account_id,identity_id,problem_id,version_id,assignment_id,kind,original_submission_id,code,language,custom_input,idempotency_key,request_hash,created_at,timed_attempt_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[user.id,user.identityId,problemId,v.id,assignmentId,kind,originalId,code,language,customInput,key,requestHash,acceptedAt,timedContext?.timedAttemptId||null]));await db.query("INSERT INTO judge_tasks(submission_id,version_id,purpose) VALUES($1,$2,'submission')",[s.id,v.id]);if(kind==='correction')await db.query('INSERT INTO review_entries(submission_id,author_account_id,note) VALUES($1,$2,$3)',[s.id,user.id,'已提交订正']);return {...s,problem_title:v.title};
    });return respond(201,submissionShape(await timed.maskSubmission(pool,user,result)));
   }
   m=route.match(/^\/submissions\/([^/]+)$/);
   if(m&&method==='GET'){const sub=await submissionAccess(pool,user,m[1]);const reviews=(await pool.query('SELECT r.id,r.note,r.created_at,i.id author_identity_id,i.name author_name FROM review_entries r JOIN accounts a ON a.id=r.author_account_id JOIN identities i ON i.id=a.identity_id WHERE submission_id=$1 ORDER BY r.created_at',[sub.id])).rows.map(r=>({id:r.id,note:r.note,createdAt:r.created_at,authorName:r.author_name,authorIdentityId:r.author_identity_id}));let pendingRejudge=null;if(sub.pending_judge_run_id){pendingRejudge={runId:sub.pending_judge_run_id};if(await canReviewActivitySubmission(pool,user,sub)){const candidate=(await pool.query('SELECT r.status,r.score,r.passed,r.total,r.created_at,t.reason FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id WHERE r.id=$1',[sub.pending_judge_run_id])).rows[0];if(candidate)pendingRejudge={...pendingRejudge,status:candidate.status,score:candidate.score===null?null:Number(candidate.score),passed:candidate.passed,total:candidate.total,createdAt:candidate.created_at,reason:candidate.reason};}}const masked=await timed.maskSubmission(pool,user,sub);let testResults=[];if(masked.score!==null&&masked.status!== 'Submitted'){const run=(await pool.query('SELECT r.private_results FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id WHERE r.submission_id=$1 AND r.id IS DISTINCT FROM $2::uuid AND r.status=$3 AND r.score IS NOT DISTINCT FROM $4::numeric AND (NOT t.rejudge OR EXISTS(SELECT 1 FROM audit_events e WHERE e.action=\'submission.rejudge_confirm\' AND e.resource_id=$1::text AND e.metadata->>\'runId\'=r.id::text)) ORDER BY r.created_at DESC LIMIT 1',[sub.id,sub.pending_judge_run_id||null,sub.status,sub.score])).rows[0];testResults=(run?.private_results||[]).map((r,index)=>({position:Number.isInteger(r.position)?r.position:index+1,status:typeof r.status==='string'?r.status:'NotRun',...(Number.isFinite(r.cpuMs)?{timeMs:r.cpuMs}:{}),...(Number.isFinite(r.memoryBytes)?{memoryKb:Math.ceil(r.memoryBytes/1024)}:{})}));}return respond(200,{...submissionShape(masked),reviews,pendingRejudge,testResults});}
   m=route.match(/^\/review-notebook\/([^/]+)$/);
   if(m&&method==='GET'){
    const entry=row(await pool.query(`${reviewEntryQuery} WHERE r.id=$1`,[uuid(m[1],'笔记 ID')]));
    const selected=await submissionAccess(pool,user,entry.submission_id);
    const root=row(await pool.query(`WITH RECURSIVE ancestors(id,original_submission_id) AS(
     SELECT id,original_submission_id FROM submissions WHERE id=$1
     UNION SELECT s.id,s.original_submission_id FROM submissions s JOIN ancestors a ON s.id=a.original_submission_id WHERE s.identity_id=$2 AND s.problem_id=$3
    ) SELECT id FROM ancestors WHERE original_submission_id IS NULL`,[selected.id,selected.identity_id,selected.problem_id]));
    const family=(await pool.query(`WITH RECURSIVE family(id) AS(
     SELECT id FROM submissions WHERE id=$1
     UNION SELECT s.id FROM submissions s JOIN family f ON s.original_submission_id=f.id WHERE s.identity_id=$2 AND s.problem_id=$3
    ) SELECT s.id,s.kind,s.created_at FROM family f JOIN submissions s ON s.id=f.id ORDER BY s.created_at DESC,s.id DESC`,[root.id,selected.identity_id,selected.problem_id])).rows;
    const allowed=[];
    for(const sub of family){try{await submissionAccess(pool,user,sub.id);allowed.push(sub);}catch(error){if(![403,404].includes(error.status))throw error;}}
    const notes=(await pool.query(`${reviewEntryQuery} WHERE s.id=ANY($1::bigint[]) ORDER BY r.created_at DESC,r.id DESC`,[allowed.map(sub=>sub.id)])).rows;
    const relatedNotes=await Promise.all(notes.map(async note=>reviewEntryShape(await timed.maskSubmission(pool,user,note))));
    const latest=allowed.find(sub=>sub.kind==='correction');
    return respond(200,{...reviewEntryShape(await timed.maskSubmission(pool,user,entry)),relatedNotes,originalSubmissionId:`SUB${root.id}`,latestCorrectionId:latest?`SUB${latest.id}`:null,latestCorrectionCreatedAt:latest?.created_at||null});
   }
   if(route==='/review-notebook'&&method==='GET'){
    const rows=(await pool.query(`${reviewEntryQuery} WHERE s.identity_id=$1 ORDER BY r.created_at DESC LIMIT 200`,[user.identityId])).rows;const safeRows=await Promise.all(rows.map(r=>timed.maskSubmission(pool,user,r)));return respond(200,{items:safeRows.map(reviewEntryShape)});
   }
   if(route==='/review-notebook'&&method==='POST'){
    const note=field(body.note,'订正笔记',{max:10000});const s=await submissionAccess(pool,user,body.submissionId);const r=row(await pool.query('INSERT INTO review_entries(submission_id,author_account_id,note) VALUES($1,$2,$3) RETURNING *',[s.id,user.id,note]));return respond(201,{id:r.id,note:r.note,createdAt:r.created_at,submissionId:`SUB${s.id}`,problemTitle:s.problem_title,authorName:user.name,authorIdentityId:user.identityId});
   }
  return null;
 }

 async function educationOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handleEducation, timed.handle]) { const result=await handler(context); if(result)return result; }
  return null;
 }

 async function systemOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handleSystem]) { const result=await handler(context); if(result)return result; }
   if(route==='/judge-status'&&method==='GET') {
    admin(user);const counts=row(await pool.query("SELECT count(*) FILTER(WHERE state='queued')::int queued,count(*) FILTER(WHERE state='leased')::int leased,count(*) FILTER(WHERE state='failed')::int failed,count(*) FILTER(WHERE state='completed')::int completed,min(created_at) FILTER(WHERE state='queued') oldest_queued_at,clock_timestamp() server_now FROM judge_tasks"));const run=(await pool.query('SELECT created_at last_run_at,environment_version FROM judge_runs ORDER BY created_at DESC LIMIT 1')).rows[0];return respond(200,{queued:counts.queued,leased:counts.leased,failed:counts.failed,completed:counts.completed,oldestQueuedAt:counts.oldest_queued_at,lastRunAt:run?.last_run_at||null,environmentVersion:run?.environment_version||null,serverNow:counts.server_now});
   }
  return null;
 }

 const operations={auth:authOperation,people:peopleOperation,classes:classesOperation,library:libraryOperation,assignments:assignmentsOperation,submissions:submissionsOperation,education:educationOperation,community:handleCommunity,system:systemOperation};
 const helpers={audit,classAccess,versionAccess,submissionAccess,assignmentAccess,assignmentResult,problemResult,problemInput,insertVersion,issueActivation,personShape,maskSubmission:timed.maskSubmission};
 async function prepareRequest({url:rawUrl,method,headers={},body={},ip='unknown'}) {
  const url=new URL(rawUrl,'http://api.local'),path=url.pathname.replace(/\/$/,'');
  if(!path.startsWith(`${BASE}/`))fail(404,'NOT_FOUND','接口不存在');
  const route=path.slice(BASE.length);
  const rawToken=parseCookie(headers.cookie).campus_session;
  const sess=rawToken?(await pool.query('SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL',[sessionHash(rawToken,config.secret)])).rows[0]:null;
  const user=sess?await findUser(pool,sess.account_id):null;
  if(!['GET','HEAD','OPTIONS'].includes(method))checkMutation({headers},sess,config.origins);
  if(!user&&!['/auth/login','/auth/register','/auth/reset','/auth/verify-identity','/site-info'].includes(route))fail(401,'UNAUTHENTICATED','请先登录');
  return {pool,user,sess,route,method,body,url,ip,config,helpers};
 }
 return {
  prepareRequest,
  async execute(area,context) {
   const operation=operations[area];if(!operation)fail(404,'NOT_FOUND','接口不存在');
   const result=await operation(context);if(!result)fail(404,'NOT_FOUND','接口不存在');return result;
  },
  async health(){await pool.query('SELECT 1');return {ok:true,database:true};},
 };
}
function respond(status,body,cookie){return {status,body,...(cookie?{cookie}:{})};}
export function resourceArea(route) {
 if(route.startsWith('/auth/'))return 'auth';
 if(/^\/(accounts|people|teachers)(?:\/|$)/.test(route))return 'people';
 if(/^\/classes(?:\/|$)/.test(route))return 'classes';
 if(/^\/(problems|problem-banks|problem-groups|problem-favorites)(?:\/|$)/.test(route))return 'library';
 if(/^\/assignments(?:\/|$)/.test(route))return 'assignments';
 if(/^\/(submissions|review-notebook)(?:\/|$)/.test(route))return 'submissions';
 if(/^\/(learning-paths|learning-resources|chapters|reports|timed-practices|points)(?:\/|$)/.test(route))return 'education';
 if(/^\/(profiles|profile-message-reports)(?:\/|$)/.test(route))return 'community';
 if(/^\/(site-info|system-settings|audit-events|judge-status|judge-maintenance|judge-tasks)(?:\/|$)/.test(route))return 'system';
 return null;
}
