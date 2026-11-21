import { handleWorkspaceCatalog } from './workspace-catalog.mjs';
import { handleWrittenPapers } from './written-papers.mjs';
import { handleOwnPoints } from './platform-points.mjs';
import { problemProgress } from './problem-progress.mjs';
import { canEditPlatformContent } from './platform-content-access.mjs';
import { handleAcsl } from './acsl.mjs';
import { recordPublicPracticeStaffExposure } from './public-scholarship.mjs';
import { handlePublicPresence } from './public-presence.mjs';
import { handleSchoolScholarship } from './school-scholarship.mjs';
import { handleSchoolLeaderboard } from './school-leaderboard.mjs';
import { handleSchoolPaper4 } from './school-paper4.mjs';
import { schoolActivitiesOperation } from './school-activities.mjs';
import { DEFAULT_SCHOOL_EXPRESSION, handleDefaultWorkspace } from './default-workspace.mjs';
import { handleSchoolSettings } from './school-settings.mjs';
import { schoolPracticeOperation } from './school-practice.mjs';
import { handlePublicLearning } from './public-learning.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { parseFunctionInput, parseJsonValue } from './function-input.mjs';
import { handleCommunity } from './community.mjs';
import { handlePlatformGovernance } from './platform-governance.mjs';
import { requireWorkspaceRoute, schoolBookmark } from './workspace-access.mjs';
import { handleSchools } from './schools.mjs';
import { handleSchoolTeaching } from './school-teaching.mjs';
import { handleSchoolCourses } from './school-courses.mjs';
import { handleSchoolIdentityImports } from './school-identity-imports.mjs';
import { activationSchools, activationSchoolSlug, handleSchoolActivation, registerSchoolIdentity, schoolClaimPreview, verifySchoolIdentity } from './school-activation.mjs';
import { publicProblemMetadata } from './problem-public-statements.mjs';
import { legacyProblemStatement } from './problem-statement-display.mjs';
import { handleSystem, assertJudgeAdmission, getSettings } from './system.mjs';
import { draftValidation } from './problem-editor-drafts.mjs';
import { LANGUAGES, languageLimitsFor, starterCodesFor } from './languages.mjs';
import { avatarForIdentity, isPresetAvatar } from './avatars.mjs';
import { normalizeNickname, nicknameTooLong } from './nickname-policy.mjs';
import { fail, field, username, password, uuid, enumValue, genderValue, integer, bytes, hashPassword, verifyPassword, randomToken, tokenHash, sessionHash, safeEqual, parseCookie, sessionCookie, checkMutation, RateLimiter } from './security.mjs';

const BASE='/api/v1';
const row=(result,message='资源不存在')=>{if(!result.rowCount) fail(404,'NOT_FOUND',message);return result.rows[0];};
const userShape=r=>({id:r.id,identityId:r.identity_id,name:r.name,number:r.number,gender:r.gender??null,username:r.username,email:r.email||null,nickname:r.nickname,showNicknameOnLeaderboard:!!r.leaderboard_use_nickname,bio:r.bio,avatar:avatarForIdentity(r.avatar,r.identity_id),roles:r.roles,platformAdmin:!!r.platform_admin,defaultSchoolId:r.default_school_id??null,teachingSchoolId:r.teaching_school_id??null,activatedAt:r.created_at});
const problemShape=(r,{includeDisabledSamples=false}={})=>({...publicProblemMetadata(r.metadata),id:r.problem_id,title:r.title,mode:r.mode,statement:legacyProblemStatement(r),statementLanguage:r.statement_language,publicStatementPending:r.public_statement_pending,functionName:r.function_name,starterCode:r.starter_code,starterCodes:starterCodesFor(r),supportedLanguages:LANGUAGES,languageLimits:languageLimitsFor(r),referenceLanguage:r.reference_language||'python',samples:(r.samples||[]).filter(sample=>includeDisabledSamples||sample.enabled!==false),timeLimitMs:r.time_limit_ms,memoryLimitMb:r.memory_limit_mb,comparator:r.comparator,tags:r.tags||[],source:r.source||'',versionId:r.id,publishedVersionId:r.published_version_id||(r.published_at?r.id:null),publishedTitle:r.published_title||(r.published_at?r.title:null),published:!!r.published_at,schoolVisibleAt:r.school_visible_at??null,rankReviewStatus:r.rank_review_status??'pending',rankApprovedAt:r.rank_approved_at??null,bankVisibility:r.bank_visibility,validationStatus:r.validation_status,validationMessage:r.validation_message||null,formalTestCount:r.formal_test_count===undefined?undefined:Number(r.formal_test_count),canPublish:r.validation_status==='AC'&&!r.published_at});
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
 // A classroom may share one NAT address. Keep a generous aggregate ceiling
 // while the independent 10/min username and identity limits block guessing.
 const authLimiter=new RateLimiter({max:10,windowMs:60000}), ipLimiter=new RateLimiter({max:180,windowMs:60000});
 const dummyHash=await hashPassword(randomToken());
 async function audit(db,actor,action,type,id,metadata={}) { await db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[actor,action,type,String(id),metadata]); }
 async function findUser(db,accountId) {
  const r=await db.query(`SELECT a.id,a.identity_id,(SELECT m.school_id FROM school_memberships m WHERE m.account_id=a.id AND m.revoked_at IS NULL ORDER BY (m.school_id=a.default_school_id) DESC NULLS LAST,m.joined_at,m.school_id LIMIT 1) teaching_school_id,a.username,a.email,a.nickname,a.leaderboard_use_nickname,a.bio,a.avatar,a.created_at,i.name,i.number,i.gender,${DEFAULT_SCHOOL_EXPRESSION} default_school_id,EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.account_id=a.id AND pa.revoked_at IS NULL) platform_admin,ARRAY[]::text[] roles FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL`,[accountId]);return r.rowCount?userShape(r.rows[0]):null;
 }
 async function session(db,accountId) {
  const token=randomToken(),csrfToken=randomToken();
  await db.query("INSERT INTO sessions(token_hash,account_id,csrf_token,expires_at) VALUES($1,$2,$3,'infinity')",[sessionHash(token,config.secret),accountId,csrfToken]);
  return {body:{user:await findUser(db,accountId),csrfToken},cookie:sessionCookie(token,config)};
 }
 async function problemResult(db,user,problemId,versionId,options={}) {
  const p=row(await db.query("SELECT * FROM problems WHERE id=$1 AND owner_scope='platform' AND archived_at IS NULL",[uuid(problemId)]));
  if(!await canEditPlatformContent(db,user.id,'problem',p.id))fail(404,'NOT_FOUND','题目不存在');
  const v=row(await db.query(`SELECT * FROM problem_versions WHERE problem_id=$1 AND ($2::uuid IS NULL OR id=$2)
   ORDER BY created_at DESC,id DESC LIMIT 1`,[p.id,versionId?uuid(versionId):null]));
  const editing=options.editing===true;
  const draft=editing?v.edit_draft:null;
  const validation=draft?await draftValidation(db,v):null;
  const presented=draft?{...v,...draft,published_at:null,school_visible_at:null,rank_review_status:v.draft_review_status,
   rank_approved_at:null,validation_status:validation.status,validation_message:validation.message}:v;
  const result=problemShape(presented,{includeDisabledSamples:editing});result.publishedVersionId=p.current_version_id;result.publishedTitle=v.published_at?v.title:result.publishedTitle;result.ownerScope=p.owner_scope;result.bankId=p.bank_id;result.bankVisibility=(await db.query('SELECT visibility FROM problem_banks WHERE id=$1',[p.bank_id])).rows[0]?.visibility;result.canEdit=true;result.canPublish=editing&&result.canPublish&&(!draft||v.draft_review_status!=='pending');
  result.publishedRevision=v.published_revision;
  if(editing){result.editRevision=v.edit_revision;result.draftReviewStatus=v.draft_review_status;result.draftReviewReason=v.draft_review_reason;result.canPublish&&=v.draft_review_status!=='pending';}
  result.canManageTutorial=true;
  result.firstAcPoints=(await db.query('SELECT COALESCE((SELECT points FROM point_rewards WHERE problem_id=$1 AND assignment_id IS NULL),10) first_ac_points',[problemId])).rows[0].first_ac_points;
  if(editing){await recordPublicPracticeStaffExposure(db,user.id,p.id);Object.assign(result,presented.metadata||{});result.referenceCode=presented.reference_code;result.tests=(draft?.tests??(await db.query('SELECT input,expected,weight,name,enabled FROM test_cases WHERE version_id=$1 ORDER BY position',[v.id])).rows).map(({input,expected,weight,name,enabled})=>({input,expected,weight:Number(weight),name,enabled}));result.formalTestCount=result.tests.filter(t=>t.enabled).length;}else {
   // Student assistance is explicitly published and served only by the scholarship
   // provide endpoint. Legacy editorials/hints may include full answers and
   // must not leak through detail requests, SSR or background prefetches.
   result.editorial='';result.hints=[];
  }result.solved=(await problemProgress(db,user,[p.id])).get(p.id)?.solved??false;return result;
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
  const bankId=uuid(body.bankId,'题库 ID');if(body.tags!==undefined&&(!Array.isArray(body.tags)||body.tags.length>30))fail(400,'VALIDATION','标签最多 30 个');const tags=[...new Set((body.tags||[]).map(tag=>field(tag,'标签',{max:80})))],source=field(body.source??'','题目来源',{min:0,max:2000});if(incomplete&&!savingDraft)fail(400,'VALIDATION','完整题目须包含题面、参考解答、公开样例和启用的正式测试');const metadata={};for(const key of ['objective','inputDescription','outputDescription','difficulty','returnType','editorial'])if(body[key]!==undefined)metadata[key]=field(body[key],key,{min:0,max:key==='editorial'?50000:4000});for(const key of ['parameters','hints'])if(body[key]!==undefined){if(!Array.isArray(body[key])||body[key].length>30)fail(400,'VALIDATION',`${key}须为最多 30 项的数组`);metadata[key]=body[key].map(value=>typeof value==='string'?field(value,key,{min:0,max:4000}):{name:field(value.name??'',key,{min:0,max:200}),type:field(value.type??'',key,{min:0,max:200}),description:field(value.description??'',key,{min:0,max:4000})});}metadata.hintPolicy=enumValue(body.hintPolicy??'afterAC',['always','afterAC','never'],'提示策略');return {mode,title,statement,functionName,referenceCode,referenceLanguage,starterCode,starterCodes,timeLimitMs,memoryLimitMb,comparator,samples,tests,bankId,tags,source,metadata,incomplete};
 }
 async function insertVersion(db,user,problemId,input) {
  const settings=input.incomplete?await getSettings(db):await assertJudgeAdmission(db);if(!input.incomplete&&(input.timeLimitMs>settings.runtime.maxProblemCpuMs||input.memoryLimitMb>settings.runtime.maxProblemMemoryMb))fail(400,'RESOURCE_LIMIT','题目资源上限超过当前运行环境设置');
  const v=row(await db.query('INSERT INTO problem_versions(problem_id,title,mode,statement,function_name,starter_code,starter_codes,samples,time_limit_ms,memory_limit_mb,comparator,reference_code,reference_language,tags,source,metadata,validation_status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',[problemId,input.title,input.mode,input.statement,input.functionName,input.starterCode,JSON.stringify(input.starterCodes),JSON.stringify(input.samples),input.timeLimitMs,input.memoryLimitMb,input.comparator,input.referenceCode,input.referenceLanguage,JSON.stringify(input.tags),input.source,JSON.stringify(input.metadata),input.incomplete?'Incomplete':'Waiting']));
  for(let i=0;i<input.tests.length;i++){const t=input.tests[i];await db.query('INSERT INTO test_cases(version_id,position,input,expected,weight,name,enabled) VALUES($1,$2,$3,$4,$5,$6,$7)',[v.id,i,t.input,t.expected,t.weight,t.name,t.enabled]);}
  if(!input.incomplete)await db.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')",[v.id]);await audit(db,user.id,'problem.version_create','problem_version',v.id);return v;
 }
 async function authOperation(context) {
  const preference=await handleDefaultWorkspace(context);if(preference)return preference;
  const {route,method,body,url,user,sess,ip}=context;
  let m;
   if(route==='/auth/activation-schools'&&method==='GET'){ipLimiter.check(`activation-schools:${ip}`);return respond(200,await activationSchools(pool));}
   if(route==='/auth/me'&&method==='GET'){
    if(!user)fail(401,'UNAUTHENTICATED','请先登录');
    // Upgrade a legacy session only while its original credential is valid.
    if(sess.expires_at!==Infinity){
     const upgraded=await pool.query("UPDATE sessions SET expires_at='infinity' WHERE token_hash=$1 AND expires_at>statement_timestamp()",[sess.token_hash]);
     if(!upgraded.rowCount)fail(401,'UNAUTHENTICATED','请先登录');
    }
    return respond(200,{user,csrfToken:sess.csrf_token},context.renewedCookie);
   }
   if(route==='/auth/login'&&method==='POST') {
    ipLimiter.check(`login:${ip}`);const login=username(body.username),secret=password(body.password);authLimiter.check(`login:${login}`);
    // Verify the secret before disclosing a disabled account. Released bindings
    // and archived identities stay indistinguishable from unknown usernames.
    const a=(await pool.query('SELECT a.* FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.username=$1 AND a.binding_released_at IS NULL AND i.archived_at IS NULL',[login])).rows[0];
    const valid=await verifyPassword(a?.password_hash||dummyHash,secret);if(!a||!valid)fail(401,'LOGIN_FAILED','用户名或密码不正确');
    const result=await transaction(pool,async db=>{const locked=(await db.query('SELECT * FROM accounts WHERE id=$1 AND binding_released_at IS NULL FOR UPDATE',[a.id])).rows[0];if(!locked||!safeEqual(locked.password_hash,a.password_hash))fail(401,'LOGIN_FAILED','用户名或密码不正确');if(locked.disabled_at)fail(403,'ACCOUNT_DISABLED','账号已禁用');if(!await findUser(db,a.id))fail(401,'LOGIN_FAILED','用户名或密码不正确');if(sess)await db.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);await db.query('UPDATE accounts SET last_login_at=now() WHERE id=$1',[a.id]);await audit(db,a.id,'auth.login','account',a.id);return session(db,a.id);});return respond(200,result.body,result.cookie);
   }
   if(route==='/auth/verify-identity'&&method==='POST') {
    ipLimiter.check(`claim:${ip}`);const kind=enumValue(body.kind,['student','teacher'],'身份类型'),number=field(body.number,'编号'),name=field(body.name,'姓名'),code=field(body.activationCode,'激活码',{max:100}),schoolSlug=activationSchoolSlug(body);authLimiter.check(`claim:${schoolSlug}:${kind}:${number}`);
    const preview=await transaction(pool,async db=>schoolClaimPreview(db,await verifySchoolIdentity(db,{schoolSlug,kind,number,name,code})));
    return respond(200,preview);
   }
   if(route==='/auth/register-personal'&&method==='POST') {
    ipLimiter.check(`personal-register:${ip}`);
    const login=username(body.username),name=field(body.displayName,'显示名称',{max:100});
    authLimiter.check(`personal-register:${login}`);
    if(body.role!==undefined||body.roles!==undefined||body.kind!==undefined||body.schoolId!==undefined)fail(400,'VALIDATION','个人注册不授予学校身份或管理员权限');
    const email=body.email==null||(typeof body.email==='string'&&!body.email.trim())?null:field(body.email,'邮箱',{max:254});
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'VALIDATION','邮箱格式无效');
    const hash=await hashPassword(body.password);
    const result=await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`register:${login}`]);
     if((await db.query('SELECT 1 FROM accounts WHERE username=$1',[login])).rowCount)fail(409,'USERNAME_IN_USE','用户名已被使用');
     const identityId=randomUUID();
     await db.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$3)",[identityId,identityId,name]);
     const a=row(await db.query('INSERT INTO accounts(identity_id,username,password_hash,email,last_login_at) VALUES($1,$2,$3,$4,now()) RETURNING id',[identityId,login,hash,email]));
     if(sess)await db.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);
     await audit(db,a.id,'auth.personal_register','account',a.id);
     return session(db,a.id);
    });return respond(201,result.body,result.cookie);
   }
   if(route==='/auth/register'&&method==='POST') {
    ipLimiter.check(`claim:${ip}`);const kind=enumValue(body.kind,['student','teacher','admin'],'身份类型'),number=field(body.number,'编号'),name=field(body.name,'姓名'),code=field(body.activationCode,'激活码',{max:100}),login=username(body.username),schoolSlug=activationSchoolSlug(body);authLimiter.check(`claim:${schoolSlug}:${kind}:${number}`);const hash=await hashPassword(body.password);
    const email=body.email==null||(typeof body.email==='string'&&!body.email.trim())?null:field(body.email,'邮箱',{max:254});if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'VALIDATION','邮箱格式无效');
    const result=await transaction(pool,async db=>{
     const claim=await verifySchoolIdentity(db,{schoolSlug,kind,number,name,code});
     const account=await registerSchoolIdentity(db,claim,{login,hash,email});if(sess)await db.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);return session(db,account.id);
    });return respond(201,result.body,result.cookie);
   }
   if(route==='/auth/reset'&&method==='POST') {
    ipLimiter.check(`reset:${ip}`);const login=username(body.username);
    // Reset codes use base64url. Ignore spacing and invisible marks introduced by copying rich text.
    const code=field(body.resetCode,'重置凭据',{max:100}).replace(/[\s\u200b-\u200f\u2060]/gu,'');
    authLimiter.check(`reset:${login}`);const hash=await hashPassword(body.password);
    await transaction(pool,async db=>{const a=(await db.query('SELECT * FROM accounts WHERE username=$1 AND disabled_at IS NULL AND binding_released_at IS NULL FOR UPDATE',[login])).rows[0];const t=a?(await db.query('SELECT * FROM reset_tokens WHERE account_id=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[a.id])).rows[0]:null;if(!a||!t||!safeEqual(tokenHash(code),t.token_hash))fail(400,'RESET_FAILED','重置凭据无效或已过期');await db.query('UPDATE accounts SET password_hash=$1 WHERE id=$2',[hash,a.id]);await db.query('UPDATE reset_tokens SET consumed_at=now() WHERE account_id=$1',[a.id]);await db.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);await audit(db,a.id,'auth.password_reset','account',a.id);});return respond(200,{ok:true},sessionCookie('',{...config,maxAge:0}));
   }
   if(route==='/auth/logout'&&method==='POST'){await pool.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);return respond(200,{ok:true},sessionCookie('',{...config,maxAge:0}));}
   if(route==='/auth/profile'&&method==='PATCH') {
    if(body.email===undefined&&body.newPassword===undefined&&body.nickname===undefined&&body.bio===undefined&&body.avatar===undefined&&body.gender===undefined&&body.showNicknameOnLeaderboard===undefined)fail(400,'VALIDATION','请提供要修改的个人资料');
    if(body.showNicknameOnLeaderboard!==undefined&&typeof body.showNicknameOnLeaderboard!=='boolean')fail(400,'VALIDATION','排行榜昵称显示设置无效');
    const nickname=body.nickname===undefined?undefined:normalizeNickname(field(body.nickname,'昵称',{min:0,max:160})),bio=body.bio===undefined?undefined:field(body.bio,'个人介绍',{min:0,max:500}),avatar=body.avatar===undefined?undefined:field(body.avatar,'头像',{min:0,max:100000}),gender=body.gender===undefined?undefined:genderValue(body.gender);
    if(nickname!==undefined&&nicknameTooLong(nickname))fail(400,'NICKNAME_TOO_LONG','昵称最多10个中文字符或20个英文字符（中英文可混合）');
    if(avatar && !isPresetAvatar(avatar) && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))fail(400,'VALIDATION','头像仅支持预置头像或 PNG、JPEG、WebP 图片');
    const email=body.email===undefined?undefined:body.email===null||body.email===''?null:field(body.email,'邮箱',{max:254});if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'VALIDATION','邮箱格式无效');
    let currentPassword,newHash;if(body.newPassword!==undefined){authLimiter.check(`password:${user.id}`);currentPassword=password(body.currentPassword);newHash=await hashPassword(body.newPassword);}
    const result=await transaction(pool,async db=>{const a=row(await db.query('SELECT * FROM accounts WHERE id=$1 AND disabled_at IS NULL AND binding_released_at IS NULL FOR UPDATE',[user.id]));const useNickname=body.showNicknameOnLeaderboard??a.leaderboard_use_nickname;const effectiveNickname=nickname??a.nickname;if(body.showNicknameOnLeaderboard===true&&!effectiveNickname?.trim())fail(400,'VALIDATION','请先填写昵称，再开启排行榜昵称显示');if(body.showNicknameOnLeaderboard!==undefined||nickname!==undefined)await db.query('UPDATE accounts SET leaderboard_use_nickname=$1 WHERE id=$2',[!!useNickname&&!!effectiveNickname?.trim(),user.id]);if(newHash&&!await verifyPassword(a.password_hash,currentPassword))fail(400,'PASSWORD_INCORRECT','当前密码不正确');if(nickname!==undefined)await db.query('UPDATE accounts SET nickname=$1 WHERE id=$2',[nickname,user.id]);if(bio!==undefined)await db.query('UPDATE accounts SET bio=$1 WHERE id=$2',[bio,user.id]);if(avatar!==undefined)await db.query('UPDATE accounts SET avatar=$1 WHERE id=$2',[avatar,user.id]);if(email!==undefined)await db.query('UPDATE accounts SET email=$1 WHERE id=$2',[email,user.id]);if(gender!==undefined)await db.query('UPDATE identities SET gender=$1 WHERE id=$2',[gender,user.identityId]);if(newHash){await db.query('UPDATE accounts SET password_hash=$1 WHERE id=$2',[newHash,user.id]);await db.query('DELETE FROM sessions WHERE account_id=$1',[user.id]);}if(newHash||body.showNicknameOnLeaderboard!==undefined||nickname!==undefined||bio!==undefined||avatar!==undefined||email!==undefined)await audit(db,user.id,newHash?'auth.password_change':email!==undefined?'account.email_change':'account.profile_update','account',user.id);if(gender!==undefined)await audit(db,user.id,'identity.gender_update','identity',user.identityId);return newHash?session(db,user.id):{body:{user:await findUser(db,user.id),csrfToken:sess.csrf_token}};});return respond(200,result.body,result.cookie);
   }
  return null;
 }

 async function schoolsOperation(context) {
  return await handleWorkspaceCatalog(context) ?? await handleSchoolSettings(context) ?? await handleSchools(context) ?? await handleSchoolActivation(context) ?? await handleSchoolTeaching(context) ?? await handleSchoolIdentityImports(context) ?? await handleSchoolCourses(context);
 }

 const operations={
  writtenPapers:handleWrittenPapers,acsl:handleAcsl,publicPresence:handlePublicPresence,
  schoolScholarship:handleSchoolScholarship,schoolLeaderboard:handleSchoolLeaderboard,schoolPaper4:handleSchoolPaper4,
  schoolActivities:schoolActivitiesOperation,schoolPractice:schoolPracticeOperation,publicLearning:handlePublicLearning,
  auth:authOperation,community:handleCommunity,education:handleOwnPoints,system:handleSystem,schools:schoolsOperation,
  platform:async ctx=>await handleWorkspaceCatalog(ctx)??await handlePublicLearning(ctx)??await schoolPracticeOperation(ctx)??await handlePlatformGovernance(ctx),
 };
 const helpers={problemShape,audit,problemResult,problemInput,insertVersion};
 async function prepareRequest({url:rawUrl,method,headers={},body={},ip='unknown'}) {
  const url=new URL(rawUrl,'http://api.local'),path=url.pathname.replace(/\/$/,'');
  if(!path.startsWith(`${BASE}/`))fail(404,'NOT_FOUND','接口不存在');
  // Keep old clients on the same handlers and authorization path.
  const route=path.slice(BASE.length).replace(/^\/(practice\/)?luq(?=\/|$)/,'/$1scholarship');
  const rawToken=parseCookie(headers.cookie).campus_session;
  const sess=rawToken?(await pool.query('SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.account_id JOIN identities i ON i.id=a.identity_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL',[sessionHash(rawToken,config.secret)])).rows[0]:null;
  const user=sess?await findUser(pool,sess.account_id):null;
  if(!['GET','HEAD','OPTIONS'].includes(method))checkMutation({headers},sess,config.origins);
  if(!user&&!['/auth/login','/auth/register','/auth/register-personal','/auth/reset','/auth/verify-identity','/site-info'].includes(route)&&!(route==='/auth/activation-schools'&&method==='GET'))fail(401,'UNAUTHENTICATED','请先登录');
  const bookmark=await schoolBookmark(pool,user,route,method,url);
  await requireWorkspaceRoute(user,bookmark??route,method);
  const renewedCookie=route==='/auth/me'&&method==='GET'&&user?sessionCookie(rawToken,config):undefined;
  return {pool,user,sess,route:bookmark??route,bookmark,method,body,url,ip,config,helpers,renewedCookie};
 }
 return {
  prepareRequest,
  async execute(area,context) {
   const operation=operations[context.bookmark?resourceArea(context.route):area];if(!operation)fail(404,'NOT_FOUND','接口不存在');
   const result=await operation(context);if(!result)fail(404,'NOT_FOUND','接口不存在');return result;
  },
  async health(){await pool.query('SELECT 1');return {ok:true,database:true};},
 };
}
function respond(status,body,cookie){return {status,body,...(cookie?{cookie}:{})};}
export function resourceArea(route) {
 if(/^\/schools\/[^/]+\/(?:profiles|profile-message-reports)(?:\/|$)/.test(route))return 'community';
 if(/^\/schools\/[^/]+\/written-papers(?:\/|$)/.test(route))return 'writtenPapers';
 if(/^\/schools\/[^/]+\/acsl(?:\/|$)/.test(route))return 'acsl';
 if(/^\/admin\/problems\/[^/]+\/publication-request$/.test(route))return 'schoolPractice';
 if(/^\/schools\/[^/]+\/scholarship(?:\/|$)/.test(route))return 'schoolScholarship';
 if(/^\/schools\/[^/]+\/leaderboard$/.test(route))return 'schoolLeaderboard';
 if(/^\/schools\/[^/]+\/(?:student|staff)-notifications(?:\/|$)/.test(route))return 'community';
 if(/^\/schools\/[^/]+\/paper4(?:\/|$)/.test(route))return 'schoolPaper4';
 if(/^\/schools\/[^/]+\/activities(?:\/|$)/.test(route))return 'schoolActivities';
 if(/^\/schools\/[^/]+\/course-admissions(?:\/|$)/.test(route))return 'publicLearning';
 if(/^\/practice\/presence(?:\/|$)/.test(route))return 'publicPresence';
 if(/^\/(practice\/profiles|platform\/profile-message-reports)(?:\/|$)/.test(route))return 'community';
 if(/^\/practice(?:\/|$)/.test(route))return /^\/practice\/(catalog|courses)(?:\/|$)/.test(route)?'publicLearning':'schoolPractice';
 if(/^\/schools\/[^/]+\/(problem-banks|problems|judge-jobs|judge-status|submissions)(?:\/|$)/.test(route))return 'schoolPractice';
 if(/^\/platform\/(system-settings|audit-events|judge-status|judge-maintenance|judge-tasks)(?:\/|$)/.test(route))return 'system';
 if(/^\/platform(?:\/|$)/.test(route))return 'platform';
 if(/^\/(schools|school-invitations)(?:\/|$)/.test(route))return 'schools';
 if(/^\/presence(?:\/|$)/.test(route))return 'presence';
 if(/^\/scholarship(?:\/|$)/.test(route))return 'scholarship';
 if(/^\/paper4(?:\/|$)/.test(route))return 'paper4';
 if(route.startsWith('/auth/'))return 'auth';
 if(/^\/(accounts|people|teachers)(?:\/|$)/.test(route))return 'people';
 if(/^\/classes(?:\/|$)/.test(route))return 'classes';
 if(/^\/(problems|problem-banks|problem-groups|problem-favorites)(?:\/|$)/.test(route)
  || /^\/admin\/(problem-banks|problems)(?:\/|$)/.test(route))return 'library';
 if(/^\/assignments(?:\/|$)/.test(route))return 'assignments';
 if(/^\/(submissions|review-notebook)(?:\/|$)/.test(route))return 'submissions';
 if(/^\/(teaching|learning-paths|learning-resources|chapters|reports|timed-practices|points)(?:\/|$)/.test(route))return 'education';
 if(/^\/(profiles|profile-message-reports|student-notifications|staff-notifications|account-notifications)(?:\/|$)/.test(route))return 'community';
 if(/^\/(site-info|system-settings|audit-events|judge-status|judge-maintenance|judge-tasks)(?:\/|$)/.test(route))return 'system';
 return null;
}
