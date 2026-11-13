import { legacyProblemCatalogCourses, problemCatalogCourseRequest } from './problem-catalog-courses.mjs';
import { canEditPlatformContent } from './platform-content-access.mjs';
import { handleAcsl } from './acsl.mjs';
import { recordPublicPracticeStaffExposure } from './public-scholarship.mjs';
import {handlePublicPresence} from './public-presence.mjs';
import { handleSchoolScholarship } from './school-scholarship.mjs';
import { handleSchoolLeaderboard } from './school-leaderboard.mjs';
import { handleSchoolPaper4 } from './school-paper4.mjs';
import { schoolActivitiesOperation } from './school-activities.mjs';
import { DEFAULT_SCHOOL_EXPRESSION, handleDefaultWorkspace } from './default-workspace.mjs';
import { handleSchoolSettings } from './school-settings.mjs';
import { schoolPracticeOperation } from './school-practice.mjs';
import { handlePublicLearning } from './public-learning.mjs';
import { randomUUID } from 'node:crypto';
import {courseMetadataForUser, resolveLegacyCourseProblem} from './course-access.mjs';
import {assertRequiredLanguage} from './course-language-policy.mjs';
import { transaction } from './db.mjs';
import { parseFunctionInput, parseJsonValue } from './function-input.mjs';
import { handleLibrary, bankAccess, problemPermissions, restoreIdentityBindings, canReviewActivitySubmission, SCHOOL_BANK } from './library.mjs';
import { canManageLegacyTutorial, schoolPublishedTutorialProblemSql } from './problem-tutorials.mjs';
import { handleEducation } from './education.mjs';
import { handleCommunity } from './community.mjs';
import { notifyStudent } from './student-notifications.mjs';
import { handlePresence } from './presence.mjs';
import { handlePlatformGovernance } from './platform-governance.mjs';
import { protectPlatformAccount } from './platform-account-protection.mjs';
import { requireLegacyWorkspaceAccess } from './legacy-workspace-access.mjs';
import { handleSchools } from './schools.mjs';
import { handleSchoolTeaching } from './school-teaching.mjs';
import { handleSchoolCourses } from './school-courses.mjs';
import { handleSchoolIdentityImports } from './school-identity-imports.mjs';
import { activationSchools, activationSchoolSlug, handleSchoolActivation, registerSchoolIdentity, schoolClaimPreview, verifySchoolIdentity } from './school-activation.mjs';
import { createTimedService } from './timed.mjs';
import { handleMemberImport } from './member-import.mjs';
import { handlePaper4 } from './paper4.mjs';
import { handleScholarship } from './scholarship.mjs';
import {publicProblemMetadata,studentPublicStatementRows} from './problem-public-statements.mjs';
import {legacyProblemStatement} from './problem-statement-display.mjs';
import { handleSystem, assertJudgeAdmission, getSettings } from './system.mjs';
import { handlePeopleAlignment, handleFavorites, bindPendingTeacherClasses } from './alignment.mjs';
import { assignmentRequiredLanguage, handleAssignmentAuthoring } from './assignment-authoring.mjs';
import { handleLegacyAssignmentPreview } from './legacy-assignment-preview.mjs';
import { loadSubmissionResult } from './submission-feedback.mjs';
import { assignmentGradeRows } from './assignment-grades.mjs';
import { learnerAssignmentCompletion, learnerSubmissionAssignmentCompletions } from './assignment-completion.mjs';
import {activityClasses,handleTeachingAudience,handleClassHub} from './activity-audience.mjs';
import { submissionHistory,problemOwnProgress,emptyOwnProgress } from './submission-history.mjs';
import { legacyProblemSubmissions, legacyProblemSolved } from './problem-submissions.mjs';
import { liveProblemVersionIdSql, resolveLiveProblemVersion, assertLiveProblemVersion } from './live-problem-version.mjs';
import { LANGUAGES, languageLimitsFor, starterCodesFor } from './languages.mjs';
import { avatarForIdentity, isPresetAvatar } from './avatars.mjs';
import { normalizeNickname, nicknameTooLong } from './nickname-policy.mjs';
import { HttpError, fail, field, username, password, uuid, submissionId, enumValue, genderValue, integer, bytes, hashPassword, verifyPassword, randomToken, tokenHash, sessionHash, safeEqual, parseCookie, sessionCookie, checkMutation, RateLimiter, canonicalHash } from './security.mjs';

const BASE='/api/v1';
const rolesInclude=(user,role)=>user.roles.includes(role);
const isStaff=user=>rolesInclude(user,'teacher')||rolesInclude(user,'admin');
const admin=user=>{if(!rolesInclude(user,'admin')) fail(403,'FORBIDDEN','需要管理员权限');};
const staff=user=>{if(!isStaff(user)) fail(403,'FORBIDDEN','需要教师权限');};
const row=(result,message='资源不存在')=>{if(!result.rowCount) fail(404,'NOT_FOUND',message);return result.rows[0];};
const identityIds=(value,name,max=500)=>{if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)fail(400,'VALIDATION',`${name}须为最多 ${max} 项的 ID 数组`);return [...new Set(value.map(id=>uuid(id,name)))];};
const userShape=r=>({id:r.id,identityId:r.identity_id,name:r.name,number:r.number,gender:r.gender??null,username:r.username,email:r.email||null,nickname:r.nickname,showNicknameOnLeaderboard:!!r.leaderboard_use_nickname,bio:r.bio,avatar:avatarForIdentity(r.avatar,r.identity_id),roles:r.roles,platformAdmin:!!r.platform_admin,defaultSchoolId:r.default_school_id??null,activatedAt:r.created_at});
const personShape=r=>({id:r.id,kind:r.kind,number:r.number,name:r.name,gender:r.gender??null,classes:r.classes||[],activated:!!r.activated});
const problemShape=(r,{includeDisabledSamples=false}={})=>({...publicProblemMetadata(r.metadata),id:r.problem_id,title:r.title,mode:r.mode,statement:legacyProblemStatement(r),statementLanguage:r.statement_language,publicStatementPending:r.public_statement_pending,functionName:r.function_name,starterCode:r.starter_code,starterCodes:starterCodesFor(r),supportedLanguages:LANGUAGES,languageLimits:languageLimitsFor(r),referenceLanguage:r.reference_language||'python',samples:(r.samples||[]).filter(sample=>includeDisabledSamples||sample.enabled!==false),timeLimitMs:r.time_limit_ms,memoryLimitMb:r.memory_limit_mb,comparator:r.comparator,tags:r.tags||[],source:r.source||'',versionId:r.id,publishedVersionId:r.published_version_id||(r.published_at?r.id:null),publishedTitle:r.published_title||(r.published_at?r.title:null),published:!!r.published_at,schoolVisibleAt:r.school_visible_at??null,rankReviewStatus:r.rank_review_status??'pending',rankApprovedAt:r.rank_approved_at??null,bankVisibility:r.bank_visibility,validationStatus:r.validation_status,validationMessage:r.validation_message||null,formalTestCount:r.formal_test_count===undefined?undefined:Number(r.formal_test_count),canPublish:r.validation_status==='AC'&&!r.published_at});
const submissionShape=r=>({id:`SUB${r.id}`,identityId:r.identity_id,problemId:r.problem_id,problemTitle:r.problem_title,versionId:r.version_id,kind:r.kind,language:r.language||'python',requiredLanguage:r.required_language??null,status:r.status,score:r.score===null?null:Number(r.score),passed:r.passed,total:r.total,createdAt:r.created_at,code:r.code,publicOutput:r.public_output||null,message:r.public_message||null,assignmentId:r.assignment_id||null,timedPracticeId:r.timed_practice_id||null,timedAttemptId:r.timed_attempt_id||null,resultsVisible:r.results_visible!==false,originalSubmissionId:r.original_submission_id?`SUB${r.original_submission_id}`:null,studentName:r.student_name});
const reviewNoteShape = r => ({
 id:r.id,note:r.note,createdAt:r.created_at,authorName:r.author_name,
 authorIdentityId:r.author_identity_id,teacherFeedback:r.teacher_feedback,
});
const reviewEntryShape = r => ({
 ...reviewNoteShape(r),submissionId:`SUB${r.submission_id}`,problemTitle:r.problem_title,
 problemId:r.problem_id,versionId:r.version_id,timedPracticeId:r.timed_practice_id||null,
 timedAttemptId:r.timed_attempt_id||null,
 originalSubmissionId:r.original_submission_id?`SUB${r.original_submission_id}`:null,
 status:r.status,originalStatus:r.original_status,
});
const reviewEntryQuery = `SELECT r.id,r.note,r.created_at,s.id submission_id,s.problem_id,s.version_id,
 s.original_submission_id,s.status,COALESCE(original.status,s.status) original_status,
 s.identity_id,s.timed_attempt_id,practice.id timed_practice_id,practice.results_published_at,
 v.title problem_title,i.id author_identity_id,i.name author_name,
 (a.id<>s.account_id AND i.id<>s.identity_id) teacher_feedback
 FROM review_entries r JOIN submissions s ON s.id=r.submission_id
 JOIN problem_versions v ON v.id=s.version_id JOIN accounts a ON a.id=r.author_account_id
 JOIN identities i ON i.id=a.identity_id LEFT JOIN submissions original ON original.id=s.original_submission_id
 LEFT JOIN LATERAL submission_activity_context(s.original_submission_id) context ON true
 LEFT JOIN timed_attempts attempt ON attempt.id=COALESCE(s.timed_attempt_id,context.timed_attempt_id)
 LEFT JOIN timed_practices practice ON practice.id=attempt.practice_id`;
function reviewEntryVisible(user, entry) {
 // The submission owner sees their own notes immediately and staff feedback after timed results.
 return entry.identity_id!==user.identityId || !entry.teacher_feedback
  || !entry.timed_practice_id || Boolean(entry.results_published_at);
}

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
 const authLimiter=new RateLimiter({max:10,windowMs:60000}), ipLimiter=new RateLimiter({max:180,windowMs:60000}), submitLimiter=new RateLimiter({max:20,windowMs:60000});
 const dummyHash=await hashPassword(randomToken());
 const timed=createTimedService(pool);
 async function audit(db,actor,action,type,id,metadata={}) { await db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[actor,action,type,String(id),metadata]); }
 async function findUser(db,accountId) {
  const r=await db.query(`SELECT a.id,a.identity_id,a.username,a.email,a.nickname,a.leaderboard_use_nickname,a.bio,a.avatar,a.created_at,i.name,i.number,i.gender,${DEFAULT_SCHOOL_EXPRESSION} default_school_id,EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.account_id=a.id AND pa.revoked_at IS NULL) platform_admin,ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) roles FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL`,[accountId]);return r.rowCount?userShape(r.rows[0]):null;
 }
 async function session(db,accountId) {
  const token=randomToken(),csrfToken=randomToken();
  await db.query("INSERT INTO sessions(token_hash,account_id,csrf_token,expires_at) VALUES($1,$2,$3,'infinity')",[sessionHash(token,config.secret),accountId,csrfToken]);
  return {body:{user:await findUser(db,accountId),csrfToken},cookie:sessionCookie(token,config)};
 }
 async function classAccess(db,user,id) {
  uuid(id,'班级 ID');
  const result=await db.query('SELECT * FROM classes WHERE id=$1 AND archived_at IS NULL',[id]);const cls=row(result);
  if(rolesInclude(user,'admin')) return cls;
  if(!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[id,user.id])).rowCount) fail(403,'FORBIDDEN','无权管理该班级');return cls;
 }
 async function studentRosterAccess(db,user,identityId) {
  const identity=row(await db.query("SELECT id FROM identities i WHERE id=$1 AND kind='student' AND archived_at IS NULL AND EXISTS(SELECT 1 FROM legacy_school_identity_ownership o WHERE o.identity_id=i.id)",[uuid(identityId)]));
  if(!rolesInclude(user,'admin')&&!(await db.query('SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=$1 AND tc.account_id=$2 AND c.archived_at IS NULL',[identityId,user.id])).rowCount)fail(403,'FORBIDDEN','只能添加已在本人负责班级中的学生，新生请由管理员建班授权');
  return identity;
 }
 async function versionAccess(db,user,problemId,versionId,{ownSubmissionSnapshot=false}={}) {
  uuid(problemId,'题目 ID');if(versionId) uuid(versionId,'版本 ID');
  const p=row(await db.query('SELECT * FROM problems WHERE id=$1',[problemId]));
  // Archived entries are hidden from navigation; explicit audit snapshots
  // still go through the activity, ownership and submission permissions below.
  if(p.archived_at&&!versionId)fail(404,'NOT_FOUND','题目不存在');
  if(p.archived_at&&ownSubmissionSnapshot){
   const v=row(await db.query(`SELECT v.* FROM problem_versions v WHERE v.id=$1 AND v.problem_id=$2 AND v.published_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM submissions s WHERE s.identity_id=$3 AND s.problem_id=v.problem_id AND s.version_id=v.id)`,[versionId,problemId,user.identityId]));
   return {p,v,owner:false,permissions:{canRead:true,canEdit:false,canRunFree:false}};
  }
  const own=p.owner_scope==='platform'?await canEditPlatformContent(db,user.id,'problem',p.id):isStaff(user)&&(p.owner_account_id===user.id||rolesInclude(user,'admin'));let bankRead=false;
  if(isStaff(user)&&p.owner_scope!=='platform'){try{bankRead=(await bankAccess(db,user,p.bank_id)).canRead;}catch(error){if(!['FORBIDDEN','NOT_FOUND'].includes(error.code))throw error;}}
  if(!versionId&&!own&&!bankRead){
   const v=await resolveLiveProblemVersion(db,problemId,{lock:false});
   const permissions=await problemPermissions(db,user,p,v);
   if(permissions.canRead)return {p,v,owner:permissions.canEdit,permissions};
   fail(404,'NOT_FOUND','题目不存在');
  }
  const r=versionId?await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2',[versionId,problemId]):await db.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[problemId]);
  const v=row(r);
  const permissions=await problemPermissions(db,user,p,v);if(!permissions.canRead)fail(404,'NOT_FOUND','题目不存在');return {p,v,owner:permissions.canEdit,permissions};
 }
 async function problemResult(db,user,problemId,versionId,options={}) {
  const {p,v,owner,permissions}=await versionAccess(db,user,problemId,versionId,options);
  const presented=owner||isStaff(user)?v:(await studentPublicStatementRows(db,[v]))[0];
  const result=problemShape(presented,{includeDisabledSamples:owner});result.publishedVersionId=owner?p.current_version_id:v.id;result.publishedTitle=owner?result.publishedTitle:v.title;result.ownerScope=p.owner_scope;result.bankId=p.bank_id;result.bankVisibility=(await db.query('SELECT visibility FROM problem_banks WHERE id=$1',[p.bank_id])).rows[0]?.visibility;result.canEdit=owner;result.canPublish=owner&&result.canPublish;
  result.canManageTutorial=await canManageLegacyTutorial(db,user,p,owner);
  result.firstAcPoints=(await db.query('SELECT COALESCE((SELECT points FROM point_rewards WHERE problem_id=$1 AND assignment_id IS NULL),10) first_ac_points',[problemId])).rows[0].first_ac_points;
  if(owner){await recordPublicPracticeStaffExposure(db,user.id,p.id);Object.assign(result,v.metadata||{});result.referenceCode=v.reference_code;result.tests=(await db.query('SELECT input,expected,weight,name,enabled FROM test_cases WHERE version_id=$1 ORDER BY position',[v.id])).rows.map(t=>({...t,weight:Number(t.weight)}));result.formalTestCount=result.tests.filter(t=>t.enabled).length;}else {
   // Student assistance is explicitly published and served only by the scholarship
   // provide endpoint. Legacy editorials/hints may include full answers and
   // must not leak through detail requests, SSR or background prefetches.
   result.editorial='';result.hints=[];
  }result.solved=await legacyProblemSolved(db,user,problemId,v.id);return result;
 }
 async function submissionAccess(db,user,id) {
  const s=row(await db.query('SELECT s.*,COALESCE(s.assignment_id,original.assignment_id) access_assignment_id,COALESCE(s.timed_attempt_id,original.timed_attempt_id) access_timed_attempt_id,(s.original_submission_id IS NULL OR original.resolved) context_resolved,v.title problem_title,v.mode problem_mode,i.name student_name FROM submissions s LEFT JOIN LATERAL submission_activity_context(s.original_submission_id) original ON true JOIN problem_versions v ON v.id=s.version_id JOIN identities i ON i.id=s.identity_id WHERE s.id=$1',[submissionId(id)]));
  if(s.identity_id!==user.identityId&&!rolesInclude(user,'admin')) {
   let allowed=false;
   if(rolesInclude(user,'teacher')){
    if(s.access_assignment_id)allowed=!!(await db.query('SELECT 1 FROM assignments WHERE id=$1 AND owner_account_id=$2',[s.access_assignment_id,user.id])).rowCount;
    else if(s.access_timed_attempt_id)allowed=!!(await db.query('SELECT 1 FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=$1 AND p.owner_account_id=$2',[s.access_timed_attempt_id,user.id])).rowCount;
    else if(s.context_resolved)allowed=!!(await db.query('SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=$1 AND tc.account_id=$2 AND c.archived_at IS NULL',[s.identity_id,user.id])).rowCount;
   }
   if(!allowed)fail(403,'FORBIDDEN','无权访问该提交');
  }
  if(rolesInclude(user,'admin')&&s.identity_id!==user.identityId)await audit(db,user.id,'submission.admin_read','submission',s.id);
  return s;
 }
 async function assignmentAccess(db,user,id) {
  const a=row(await db.query('SELECT * FROM assignments WHERE id=$1',[uuid(id,'作业 ID')]));
  const isParticipant=rolesInclude(user,'student')&&!!(await db.query('SELECT 1 FROM assignment_participants WHERE assignment_id=$1 AND identity_id=$2 AND NOT exempt',[id,user.identityId])).rowCount;
  // Former class teachers retain historical access after a class is archived.
  // Every mutation of an archived assignment is rejected separately below.
  const canManage=rolesInclude(user,'admin')||(rolesInclude(user,'teacher')&&a.owner_account_id===user.id);
  if(a.state==='Draft'&&!canManage)fail(404,'NOT_FOUND','作业尚未发布');if(!isParticipant&&!canManage)fail(403,'FORBIDDEN','未分配该作业或无权管理');if(a.state==='Draft'&&!canManage)fail(404,'NOT_FOUND','作业尚未发布');return {...a,isParticipant:isParticipant&&a.state==='Published',canManage};
 }
 async function assignmentProblemRows(db,a) {
  return (await db.query(`SELECT ap.problem_id,v.id version_id,ap.points,ap.position,v.title,v.metadata->'difficulty' difficulty,
   COALESCE(global_reward.points,10) first_ac_points,COALESCE(assignment_reward.points,0) reward_points
   FROM assignment_problems ap JOIN problems p ON p.id=ap.problem_id
   JOIN problem_versions v ON v.id=COALESCE(${liveProblemVersionIdSql('p')},ap.version_id)
   LEFT JOIN point_rewards global_reward ON global_reward.problem_id=ap.problem_id AND global_reward.assignment_id IS NULL
   LEFT JOIN point_rewards assignment_reward ON assignment_reward.problem_id=ap.problem_id AND assignment_reward.assignment_id=ap.assignment_id
   LEFT JOIN LATERAL (SELECT chapter.position chapter_position,chapter.created_at chapter_created_at,chapter.id chapter_id,cp.position problem_position
    FROM chapter_problems cp JOIN learning_chapters chapter ON chapter.id=cp.chapter_id
    WHERE cp.problem_id=ap.problem_id AND chapter.path_id=$2 AND chapter.archived_at IS NULL
    ORDER BY chapter.position,chapter.created_at,chapter.id,cp.position LIMIT 1) course_order ON $3='course'
   WHERE ap.assignment_id=$1 ORDER BY course_order.chapter_position NULLS LAST,course_order.chapter_created_at NULLS LAST,course_order.chapter_id NULLS LAST,course_order.problem_position NULLS LAST,ap.position,ap.problem_id`,[a.id,a.course_path_id,a.problem_order])).rows;
 }
 async function assignmentResult(db,user,id,{includeCompletion=false}={}) {
  const a=await assignmentAccess(db,user,id);
  const ps=await assignmentProblemRows(db,a);
  const linkedCourse=await courseMetadataForUser(db,user,a.course_path_id);
  const visibleCourse=Boolean(linkedCourse?.published_at&&!linkedCourse.archived_at);
  const requiredLanguage=await assignmentRequiredLanguage(db,a);
  const linkedClasses=await activityClasses(db,id);
  const problems=ps.map(p=>({
   problemId:p.problem_id,versionId:p.version_id,position:p.position,title:p.title,
   points:Number(p.points),firstAcPoints:Number(p.first_ac_points),rewardPoints:Number(p.reward_points),
   ...(a.canManage&&typeof p.difficulty==='string'?{difficulty:p.difficulty}:{}),
  }));
  const result={id:a.id,title:a.title,canManage:a.canManage,classIds:linkedClasses.map(c=>c.id),classes:linkedClasses,classId:a.class_id,className:(await db.query('SELECT name FROM classes WHERE id=$1',[a.class_id])).rows[0]?.name,state:a.state,archived:!!a.archived_at,description:a.description,course:a.course,coursePathId:linkedCourse?.id??null,courseTitle:linkedCourse?.title??null,courseAvailable:visibleCourse,requiredLanguage,problemOrder:a.problem_order,published:a.state==='Published',publishedAt:a.published_at,createdAt:a.created_at,dueAt:a.due_at,editRevision:a.edit_revision,problems};
  {
   const protectedParticipantIds=a.canManage?(await db.query('SELECT DISTINCT identity_id FROM submissions WHERE assignment_id=$1',[id])).rows.map(person=>person.identity_id):[];
   if(a.canManage)result.protectedParticipantIds=protectedParticipantIds;
   if(a.canManage)result.hasSubmissions=!!(await db.query("SELECT 1 FROM submissions WHERE assignment_id=$1 AND kind='submit' LIMIT 1",[id])).rowCount;
   if(a.canManage)result.hasActivity=protectedParticipantIds.length>0;
   if(a.canManage)result.participants=(await db.query('SELECT identity_id FROM assignment_participants WHERE assignment_id=$1 AND NOT exempt',[id])).rows.map(p=>p.identity_id);
   if(a.canManage)result.participantDetails=(await db.query('SELECT part.identity_id,i.name,part.exempt FROM assignment_participants part JOIN identities i ON i.id=part.identity_id WHERE assignment_id=$1 ORDER BY i.name',[id])).rows.map(p=>({identityId:p.identity_id,name:p.name,exempt:p.exempt,hasActivity:protectedParticipantIds.includes(p.identity_id)}));
   const grades=await assignmentGradeRows(db,a,a.canManage?null:user.identityId);
   const byStudent=new Map();for(const g of grades){let s=byStudent.get(g.identity_id);if(!s){s={identityId:g.identity_id,name:g.name,score:0,maxScore:0,pending:false,hasScore:false,problems:[]};byStudent.set(g.identity_id,s);}const points=Number(g.points),score=g.score===null?null:Number(g.score);s.score+=score===null?0:score*points/100;s.maxScore+=points;s.pending ||= g.unresolved;s.hasScore ||= score!==null;s.problems.push({problemId:g.problem_id,submissionId:g.submission_id?`SUB${g.submission_id}`:null,score,status:g.status||'NotSubmitted',pending:g.unresolved,pendingStatus:g.pending_status,completionSource:g.credited_ac?'other_entry':null,creditedAt:g.credited_at??null,hasAssignmentSubmission:g.has_assignment_submission,assignmentAttempts:Number(g.assignment_attempts)});}result.grades=[...byStudent.values()].map(({hasScore,...g})=>({...g,score:g.pending&&!hasScore?null:Math.round(g.score*100)/100}));const graded=result.grades.filter(g=>!g.pending&&g.problems.some(p=>(p.submissionId||p.completionSource==='other_entry')&&p.score!==null));result.applicableCount=a.canManage?result.participantDetails.filter(p=>!p.exempt).length:1;result.exemptCount=a.canManage?result.participantDetails.filter(p=>p.exempt).length:0;result.averagePercent=graded.length?Math.round(graded.reduce((total,g)=>total+(g.maxScore?100*g.score/g.maxScore:0),0)/graded.length*100)/100:null;result.submittedStudents=result.grades.filter(g=>g.problems.some(p=>p.hasAssignmentSubmission)).length;result.completedStudents=result.grades.filter(g=>g.problems.length&&g.problems.every(p=>p.status==='AC')).length;
  }
  if (includeCompletion && a.isParticipant && !a.canManage) {
   result.completion = result.completedStudents === 1 ? await learnerAssignmentCompletion(db,id,user.identityId) : null;
  }
  return result;
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
  await protectPlatformAccount(db,user,{identityId});
  if((await db.query('SELECT 1 FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL',[identityId])).rowCount)fail(409,'ACTIVATED','该身份已认领');
  const activationCode=randomToken();await db.query("INSERT INTO activation_tokens(identity_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days') ON CONFLICT(identity_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL",[identityId,tokenHash(activationCode)]);await audit(db,user.id,'identity.activation_issue','identity',identityId);return {person:personShape(person),activationCode};
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
     if(!claim.legacy){const account=await registerSchoolIdentity(db,claim,{login,hash,email});if(sess)await db.query('DELETE FROM sessions WHERE token_hash=$1',[sess.token_hash]);return session(db,account.id);}
     const i=claim.identity;
     const a=row(await db.query('INSERT INTO accounts(identity_id,username,password_hash,email,last_login_at) VALUES($1,$2,$3,$4,now()) RETURNING id',[i.id,login,hash,email]));
     await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[a.id,kind]);if(kind==='teacher')await bindPendingTeacherClasses(db,i.id,a.id);const previous=await restoreIdentityBindings(db,i.id,a.id);if(previous)await audit(db,a.id,'identity.rebind','identity',i.id,{previousAccountId:previous});await db.query('UPDATE activation_tokens SET consumed_at=now() WHERE identity_id=$1',[i.id]);await audit(db,a.id,'identity.claim','identity',i.id);return session(db,a.id);
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

 async function peopleOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handlePeopleAlignment,handleLibrary]) { const result=await handler(context); if(result)return result; }
   if(route==='/accounts'&&method==='GET') {
    admin(user);const items=(await pool.query("SELECT a.id,a.username,a.identity_id,i.name,i.number,i.kind,a.disabled_at,ARRAY(SELECT role FROM account_roles WHERE account_id=a.id ORDER BY role) roles FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=a.id) ORDER BY a.created_at DESC LIMIT 5000")).rows.map(a=>({id:a.id,identityId:a.identity_id,name:a.name,number:a.number,kind:a.kind,username:a.username,disabled:!!a.disabled_at,roles:a.roles}));return respond(200,{items});
   }
   const accountMatch=route.match(/^\/accounts\/([^/]+)$/);
   if(accountMatch&&method==='PATCH') {
    admin(user);const id=uuid(accountMatch[1]);
    if(body.disabled!==undefined&&typeof body.disabled!=='boolean')fail(400,'VALIDATION','停用状态无效');
    if(body.roles!==undefined&&(!Array.isArray(body.roles)||!body.roles.length||body.roles.some(r=>!['student','teacher','admin'].includes(r))))fail(400,'VALIDATION','角色列表无效');
    await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(798944)');const a=row(await db.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE',[id]));
     await protectPlatformAccount(db,user,{accountId:id});
     if(a.binding_released_at)fail(409,'RELEASED_ACCOUNT','历史解绑账号不能重新启用或修改角色，请管理当前绑定账号');
     const hadAdmin=!!(await db.query("SELECT 1 FROM account_roles WHERE account_id=$1 AND role='admin'",[id])).rowCount;
     if(hadAdmin&&!a.disabled_at&&(body.disabled===true||body.roles&&!body.roles.includes('admin'))){const n=(await db.query("SELECT count(*)::int n FROM account_roles r JOIN accounts a ON a.id=r.account_id JOIN identities i ON i.id=a.identity_id WHERE r.role='admin' AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL")).rows[0].n;if(n<=1)fail(409,'LAST_ADMIN','不能停用或移除最后一个有效管理员');}
     if(body.disabled!==undefined)await db.query('UPDATE accounts SET disabled_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1',[id,body.disabled]);
     if(body.roles){await db.query('DELETE FROM account_roles WHERE account_id=$1',[id]);for(const role of new Set(body.roles))await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[id,role]);}
     await db.query('DELETE FROM sessions WHERE account_id=$1',[id]);await audit(db,user.id,'account.update','account',id,{disabled:body.disabled,roles:body.roles});
    });return respond(200,{ok:true});
   }
   if(route==='/people'&&method==='GET'){
    staff(user);const rows=(await pool.query("SELECT i.*,EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL) activated,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)) FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=i.id AND c.archived_at IS NULL),'[]'::jsonb) classes FROM identities i WHERE EXISTS(SELECT 1 FROM legacy_school_identity_ownership o WHERE o.identity_id=i.id) AND i.archived_at IS NULL AND ($1 OR i.id=$2 OR EXISTS(SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id WHERE cm.identity_id=i.id AND tc.account_id=$3)) ORDER BY i.kind,i.number LIMIT 5000",[rolesInclude(user,'admin'),user.identityId,user.id])).rows;return respond(200,{items:rows.map(personShape)});
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
    admin(user);const id=uuid(personMatch[1]);const person=await transaction(pool,async db=>{const i=row(await db.query('SELECT * FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[id]));await protectPlatformAccount(db,user,{identityId:id});const name=body.name===undefined?i.name:field(body.name,'姓名'),number=body.number===undefined?i.number:field(body.number,'编号');const updated=row(await db.query('UPDATE identities SET name=$1,number=$2 WHERE id=$3 RETURNING *',[name,number,id]));await audit(db,user.id,'identity.update','identity',id);return personShape(updated);});return respond(200,person);
   }
   const unbindMatch=route.match(/^\/people\/([^/]+)\/unbind$/);
   if(unbindMatch&&method==='POST') {
    admin(user);const identityId=uuid(unbindMatch[1]);const output=await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(798944)');row(await db.query('SELECT id FROM identities WHERE id=$1 AND archived_at IS NULL FOR UPDATE',[identityId]));const a=row(await db.query('SELECT * FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL FOR UPDATE',[identityId]));
     await protectPlatformAccount(db,user,{accountId:a.id});
     const hadAdmin=!!(await db.query("SELECT 1 FROM account_roles WHERE account_id=$1 AND role='admin'",[a.id])).rowCount;
     if(hadAdmin&&!a.disabled_at){const count=(await db.query("SELECT count(*)::int n FROM account_roles r JOIN accounts a ON a.id=r.account_id JOIN identities i ON i.id=a.identity_id WHERE r.role='admin' AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL")).rows[0].n;if(count<=1)fail(409,'LAST_ADMIN','不能解绑最后一个有效管理员');}
     await db.query('UPDATE accounts SET disabled_at=now(),binding_released_at=now() WHERE id=$1',[a.id]);await db.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);await db.query('DELETE FROM reset_tokens WHERE account_id=$1',[a.id]);await audit(db,user.id,'identity.unbind','identity',identityId,{previousAccountId:a.id});return issueActivation(db,user,identityId);
    });return respond(200,output);
   }
   m=route.match(/^\/people\/([^/]+)\/activation$/);
   if(m&&method==='POST'){admin(user);return respond(200,await transaction(pool,db=>issueActivation(db,user,uuid(m[1]))));}
   m=route.match(/^\/people\/([^/]+)\/reset$/);
   if(m&&method==='POST'){admin(user);const result=await transaction(pool,async db=>{const a=row(await db.query('SELECT * FROM accounts WHERE identity_id=$1 AND disabled_at IS NULL AND binding_released_at IS NULL FOR UPDATE',[uuid(m[1])]));await protectPlatformAccount(db,user,{accountId:a.id});const resetCode=randomToken();await db.query("INSERT INTO reset_tokens(account_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes') ON CONFLICT(account_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL",[a.id,tokenHash(resetCode)]);await audit(db,user.id,'account.reset_issue','account',a.id);return {username:a.username,resetCode};});return respond(200,result);}
  return null;
 }

 async function classesOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  const hub=await handleClassHub(context);if(hub)return hub;
  for (const handler of [handleMemberImport]) { const result=await handler(context); if(result)return result; }
   if(route==='/classes'&&method==='GET'){
    const archived=url.searchParams.get('archived')==='true';if(archived)staff(user);
    const rows=(await pool.query(`SELECT c.*,($1 OR $2 AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=c.id AND tc.account_id=$3)) can_manage FROM classes c WHERE (c.archived_at IS NOT NULL)=$5 AND ($1 OR $2 AND EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=c.id AND tc.account_id=$3) OR NOT $5 AND EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.identity_id=$4)) ORDER BY c.created_at DESC`,[rolesInclude(user,'admin'),rolesInclude(user,'teacher'),user.id,user.identityId,archived])).rows;
    const items=[];for(const c of rows){const members=(await pool.query('SELECT i.id,i.name,i.number,i.kind,i.gender,a.username,(a.id IS NOT NULL) activated FROM class_members cm JOIN identities i ON i.id=cm.identity_id LEFT JOIN accounts a ON a.identity_id=i.id AND a.binding_released_at IS NULL WHERE cm.class_id=$1 AND i.archived_at IS NULL ORDER BY i.number',[c.id])).rows;const visible=c.can_manage?members:members.filter(i=>i.id===user.identityId);const teachers=(await pool.query('SELECT a.identity_id FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id WHERE tc.class_id=$1',[c.id])).rows;items.push({id:c.id,name:c.name,type:c.type,description:c.description,archived:!!c.archived_at,members:visible,studentIds:visible.filter(i=>i.kind==='student').map(i=>i.id),teacherIds:teachers.map(t=>t.identity_id),memberCount:members.length});}return respond(200,{items});
   }
   if(route==='/classes'&&method==='POST'){
    staff(user);const name=field(body.name,'班级名称'),description=field(body.description??'','班级说明',{min:0,max:4000}),type=enumValue(body.type||'training',['administrative','training'],'班级类型'),studentIds=identityIds(body.studentIds,'学生'),teacherIds=identityIds(body.teacherIds,'教师',50);const c=await transaction(pool,async db=>{const c=row(await db.query('INSERT INTO classes(name,type,owner_account_id,description) VALUES($1,$2,$3,$4) RETURNING *',[name,type,user.id,description]));await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[c.id,user.id]);for(const id of studentIds){const i=await studentRosterAccess(db,user,id);await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[c.id,i.id]);}for(const id of teacherIds){if(!rolesInclude(user,'admin')&&id!==user.identityId)fail(403,'FORBIDDEN','教师只能为自己创建班级');const a=row(await db.query("SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.identity_id=$1 AND r.role IN ('teacher','admin') AND a.disabled_at IS NULL AND a.binding_released_at IS NULL",[uuid(id)]));await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[c.id,a.id]);}await audit(db,user.id,'class.create','class',c.id);return c;});return respond(201,{id:c.id,name:c.name,type:c.type,description:c.description,members:[],studentIds,teacherIds:teacherIds.length?teacherIds:[user.identityId],memberCount:studentIds.length});
   }
   const classMatch=route.match(/^\/classes\/([^/]+)$/);
   m=route.match(/^\/classes\/([^/]+)\/(archive|restore)$/);
   if(m&&method==='POST'){
    staff(user);const id=uuid(m[1],'班级 ID'),action=m[2];
    await transaction(pool,async db=>{
     const cls=row(await db.query('SELECT id,archived_at FROM classes WHERE id=$1 FOR UPDATE',[id]));
     if(!rolesInclude(user,'admin')&&!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[id,user.id])).rowCount)fail(403,'FORBIDDEN','无权归档该班级');
     if(action==='archive'){
      if(cls.archived_at)return;
      const pending=(await db.query('SELECT EXISTS(SELECT 1 FROM assignments WHERE class_id=$1 AND archived_at IS NULL) OR EXISTS(SELECT 1 FROM timed_practices WHERE class_id=$1 AND archived_at IS NULL) active',[id])).rows[0].active;
      if(pending)fail(409,'CLASS_HAS_ACTIVITIES','请先归档该班级的作业和限时训练，再归档班级');
      await db.query('UPDATE classes SET archived_at=clock_timestamp() WHERE id=$1',[id]);
     }else{
      if(!cls.archived_at)return;
      await db.query('UPDATE classes SET archived_at=NULL WHERE id=$1',[id]);
     }
     await audit(db,user.id,`class.${action}`,'class',id);
    });return respond(200,{ok:true});
   }
   if(classMatch&&method==='PATCH') {
    staff(user);const id=uuid(classMatch[1]),studentIds=body.studentIds===undefined?null:identityIds(body.studentIds,'学生'),teacherIds=body.teacherIds===undefined?null:identityIds(body.teacherIds,'教师',50);if(teacherIds&&!rolesInclude(user,'admin'))fail(403,'FORBIDDEN','教师任课授权须由管理员配置');
    const output=await transaction(pool,async db=>{await db.query('SELECT pg_advisory_xact_lock(798944)');const cls=await classAccess(db,user,id);await db.query('SELECT id FROM classes WHERE id=$1 FOR UPDATE',[id]);const name=body.name===undefined?cls.name:field(body.name,'班级名称'),type=body.type===undefined?cls.type:enumValue(body.type,['administrative','training'],'班级类型');const description=body.description===undefined?cls.description:field(body.description,'班级说明',{min:0,max:4000});await db.query('UPDATE classes SET name=$1,type=$2,description=$4 WHERE id=$3',[name,type,id,description]);if(studentIds){for(const identity of studentIds)await studentRosterAccess(db,user,identity);await db.query('DELETE FROM class_members m USING identities i WHERE m.identity_id=i.id AND m.class_id=$1 AND i.archived_at IS NULL',[id]);for(const identity of studentIds)await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[id,identity]);}if(teacherIds){const accountIds=[];for(const identity of teacherIds){const a=row(await db.query("SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.identity_id=$1 AND a.binding_released_at IS NULL AND a.disabled_at IS NULL AND r.role IN ('teacher','admin')",[identity]));accountIds.push(a.id);}await db.query('DELETE FROM teacher_classes WHERE class_id=$1',[id]);for(const account of accountIds)await db.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[id,account]);}await audit(db,user.id,'class.update','class',id,{studentCount:studentIds?.length,teacherCount:teacherIds?.length});return {id,name,type,description,studentIds:studentIds||(await db.query('SELECT m.identity_id FROM class_members m JOIN identities i ON i.id=m.identity_id WHERE m.class_id=$1 AND i.archived_at IS NULL',[id])).rows.map(m=>m.identity_id),teacherIds:teacherIds||(await db.query('SELECT a.identity_id FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id WHERE tc.class_id=$1',[id])).rows.map(m=>m.identity_id)};});return respond(200,output);
   }
   m=route.match(/^\/classes\/([^/]+)\/members$/);
   if(m&&method==='POST'){
    staff(user);const ids=body.identityIds??(body.identityId?[body.identityId]:null);if(!Array.isArray(ids)||!ids.length||ids.length>500)fail(400,'VALIDATION','请选择 1–500 名成员');await transaction(pool,async db=>{await classAccess(db,user,m[1]);for(const id of ids){const i=await studentRosterAccess(db,user,id);await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[m[1],i.id]);}await audit(db,user.id,'class.members_add','class',m[1],{count:ids.length});});return respond(200,{ok:true});
   }
  return null;
 }

 async function libraryOperation(context) {
  if(!['GET','HEAD'].includes(context.method)){
   const problemMatch=context.route.match(/^\/(?:admin\/)?problems\/([0-9a-f-]{36})(?:\/|$)/i);
   const ids=problemMatch?[problemMatch[1]]:(context.body.items??[]).map?.(item=>item.problemId)??[];
   if(ids.length&&(await pool.query("SELECT 1 FROM problems WHERE id=ANY($1::uuid[]) AND owner_scope='platform'",[ids])).rowCount)
    fail(403,'PLATFORM_SOURCE_REQUIRED','平台题目请使用课程或题库中的平台编辑器维护');
   const bankMatch=context.route.match(/^\/(?:admin\/)?problem-banks\/([0-9a-f-]{36})(?:\/|$)/i);
   if(bankMatch&&(await pool.query("SELECT 1 FROM problems WHERE bank_id=$1 AND owner_scope='platform'",[bankMatch[1]])).rowCount)
    fail(403,'PLATFORM_SOURCE_REQUIRED','此来源题库包含平台题目，不能通过校内入口修改题库权限或归档');
  }

  const {route,method,body,url,user,sess,ip}=context;
  let m;
  const historyMatch=route.match(/^\/problems\/([^/]+)\/submissions$/);
  if(historyMatch&&method==='GET')return respond(200,await transaction(pool,db=>legacyProblemSubmissions(db,user,historyMatch[1],url,{versionAccess,assignmentAccess})));
  for (const handler of [handleFavorites,handleLibrary]) { const result=await handler(context); if(result)return result; }
   if(route==='/problems'&&method==='GET'){
    const assignmentPicker=url.searchParams.get('purpose')==='assignment';
    if(assignmentPicker)staff(user);
    const selectedProblem=assignmentPicker&&url.searchParams.get('problemId');
    const { courseId, includeCourses } = problemCatalogCourseRequest(url);
    const courseFilter = !assignmentPicker && includeCourses
     ? await transaction(pool, db => legacyProblemCatalogCourses(db, user, courseId)) : null;
    const rows=(await pool.query(`SELECT v.*,
     (SELECT count(*) FROM test_cases tc WHERE tc.version_id=v.id AND tc.enabled) formal_test_count,
     p.bank_id,p.owner_scope,bank.visibility bank_visibility,
     CASE WHEN NOT $7 AND ($2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit')))
      THEN p.current_version_id ELSE v.id END published_version_id,
     CASE WHEN NOT $7 AND ($2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit')))
      THEN pv.title ELSE v.title END published_title,
     CASE WHEN NOT $7 AND ($2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit')))
      THEN pv.metadata->'difficulty' ELSE v.metadata->'difficulty' END published_difficulty,
     (p.owner_scope='school' AND ($2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission='edit'))) can_edit,
     ($3 AND (${schoolPublishedTutorialProblemSql})) shared_tutorial
    FROM problems p JOIN problem_banks bank ON bank.id=p.bank_id
    LEFT JOIN bank_permissions bp ON bp.bank_id=bank.id AND bp.account_id=$1
    JOIN LATERAL (
     SELECT * FROM problem_versions v WHERE v.problem_id=p.id
     AND (p.owner_scope='school' OR v.id=${liveProblemVersionIdSql('p')})
     AND (NOT $7::boolean OR v.id=${liveProblemVersionIdSql('p')})
     AND ($2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
       OR v.id=${liveProblemVersionIdSql('p')}) AND (
      $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
      OR v.published_at IS NOT NULL AND bank.visibility='school' AND v.school_visible_at IS NOT NULL
      OR $5 AND v.published_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM assignment_problems ap JOIN assignments assignment
        ON assignment.id=ap.assignment_id AND assignment.state='Published'
       JOIN assignment_participants part ON part.assignment_id=ap.assignment_id
       WHERE ap.problem_id=p.id AND part.identity_id=$4 AND NOT part.exempt)
      OR $5 AND v.published_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM timed_practice_problems tp JOIN timed_practices practice ON practice.id=tp.practice_id
       JOIN timed_practice_participants part ON part.practice_id=tp.practice_id
       LEFT JOIN timed_attempts attempt ON attempt.practice_id=tp.practice_id AND attempt.identity_id=part.identity_id
       WHERE tp.problem_id=p.id AND part.identity_id=$4 AND NOT part.exempt
        AND (practice.state IN ('Published','ResultsPublished') OR practice.state='Archived' AND practice.results_published_at IS NOT NULL)
        AND (practice.results_published_at IS NOT NULL OR attempt.id IS NOT NULL))
     ) ORDER BY
      CASE WHEN $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
        THEN 0 WHEN bank.visibility='school' AND v.school_visible_at IS NOT NULL THEN 1 ELSE 2 END,
      CASE WHEN $2 OR $3 AND (p.owner_account_id=$1 OR bank.owner_account_id=$1 OR bp.permission IN ('read','edit'))
       THEN v.created_at ELSE v.published_at END DESC NULLS LAST,v.created_at DESC,v.id DESC LIMIT 1
    ) v ON true
    LEFT JOIN problem_versions pv ON pv.id=p.current_version_id AND pv.published_at IS NOT NULL
    WHERE p.archived_at IS NULL AND bank.archived_at IS NULL
     AND ($6::uuid IS NULL OR bank.id=$6) AND ($8::uuid IS NULL OR p.id=$8)
     AND ($9::uuid[] IS NULL OR p.id=ANY($9) AND bank.visibility='school'
       AND v.school_visible_at IS NOT NULL AND v.rank_review_status='approved')
    ORDER BY p.created_at DESC LIMIT 500`,[user.id,rolesInclude(user,'admin'),rolesInclude(user,'teacher'),user.identityId,rolesInclude(user,'student'),url.searchParams.get('bankId')?uuid(url.searchParams.get('bankId')):null,assignmentPicker,selectedProblem?uuid(selectedProblem):null,courseFilter?.problemIds??null])).rows;
    const problemIds=rows.map(r=>r.problem_id),ownProgress=await problemOwnProgress(pool,user,problemIds);
    const configured=(await pool.query('SELECT problem_id,points FROM point_rewards WHERE assignment_id IS NULL AND problem_id=ANY($1::uuid[])',[problemIds])).rows;
    const firstAcPoints=new Map(configured.map(reward=>[reward.problem_id,reward.points]));
    const staffView=isStaff(user);
    const presented=staffView?rows:await studentPublicStatementRows(pool,rows);
    return respond(200,{...(courseFilter && { courseId, courses: courseFilter.courses }),items:presented.map(r=>({
     ...problemShape(r,{includeDisabledSamples:!!r.can_edit}),
     ...(staffView?{publishedDifficulty:typeof r.published_difficulty==='string'?r.published_difficulty:null}:{}),
     bankId:r.bank_id,ownerScope:r.owner_scope,canEdit:!!r.can_edit,canPublish:!!r.can_edit&&r.validation_status==='AC'&&!r.published_at,
     canManageTutorial:!!(r.can_edit||r.shared_tutorial),
     firstAcPoints:firstAcPoints.get(r.problem_id)??10,ownProgress:ownProgress.get(r.problem_id)||emptyOwnProgress(),
    }))});
   }
   if(route==='/problems'&&method==='POST'){
    staff(user);const input=problemInput(body);const v=await transaction(pool,async db=>{const access=await bankAccess(db,user,input.bankId);if(!access.canContribute)fail(403,'FORBIDDEN','无权向该题库添加题目');const p=row(await db.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[user.id,input.bankId]));return insertVersion(db,user,p.id,input);});return respond(201,await problemResult(pool,user,v.problem_id,v.id));
   }
   if(route==='/problems/publish-batch'&&method==='POST'){
    staff(user);
    if(!Array.isArray(body.items)||body.items.length<1||body.items.length>100)fail(400,'VALIDATION','请选择 1–100 道题目批量发布');
    const items=body.items.map(item=>({problemId:uuid(item?.problemId,'题目 ID').toLowerCase(),versionId:uuid(item?.versionId,'版本 ID').toLowerCase()}));
    if(new Set(items.map(item=>item.problemId)).size!==items.length||new Set(items.map(item=>item.versionId)).size!==items.length)fail(400,'VALIDATION','同一题目或版本不能重复选择');
    // Lock parent problems before versions, matching the administrator review
    // route; sort by problem ID to keep concurrent batches ordered.
    const published=await transaction(pool,async db=>{
     const checked=[];
     for(const item of [...items].sort((a,b)=>a.problemId.localeCompare(b.problemId))){
      const p=row(await db.query('SELECT * FROM problems WHERE id=$1 FOR UPDATE',[item.problemId]));
      const version=row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2 FOR UPDATE',[item.versionId,item.problemId]));
      if(p.archived_at)fail(409,'ARCHIVED','已归档题目不能发布');
      const {owner}=await versionAccess(db,user,item.problemId,item.versionId);
      if(!owner)fail(403,'FORBIDDEN','无权发布所选题目');
      if(version.published_at)fail(409,'ALREADY_PUBLISHED',`「${version.title}」已发布，不能再次提交发布；如需修改，请创建新版本`);
      const latest=row(await db.query('SELECT id FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[item.problemId]));
      if(latest.id!==item.versionId)fail(409,'VERSION_CHANGED',`「${version.title}」已有更新版本，请刷新列表后重新选择`);
      if(version.validation_status!=='AC')fail(409,'NOT_VALIDATED',`「${version.title}」的参考解答尚未通过全部正式测试`);
      checked.push({problemId:p.id,versionId:version.id,title:version.title});
     }
     for(const item of checked){
      await db.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[item.versionId]);
      await db.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[item.versionId,item.problemId]);
      await audit(db,user.id,'problem.publish','problem_version',item.versionId,{batch:true,problemId:item.problemId});
     }
     return checked;
    });
    return respond(200,{publishedCount:published.length,items:published.map(({problemId,versionId,title})=>({problemId,versionId,title,alreadyPublished:false}))});
   }
   m=route.match(/^\/problems\/([^/]+)$/);
   if(m&&method==='GET'){
    const originalId=url.searchParams.get('originalSubmissionId');
    let selected=url.searchParams.get('versionId');
    if(originalId){
     const original=await submissionAccess(pool,user,originalId);
     if(original.identity_id!==user.identityId||original.problem_id!==m[1])fail(404,'NOT_FOUND','原提交不存在');
     selected=original.version_id;
    }else if(url.searchParams.get('current')==='1'||!isStaff(user)){
     if(selected)await versionAccess(pool,user,m[1],selected);
     selected=(await resolveLiveProblemVersion(pool,m[1],{lock:false,allowArchived:true})).id;
    }
    return respond(200,await problemResult(pool,user,m[1],selected,{ownSubmissionSnapshot:!!originalId}));
   }
   m=route.match(/^\/problems\/([^/]+)\/versions$/);
   if(m&&method==='POST'){
    staff(user);const input=problemInput(body);const v=await transaction(pool,async db=>{const {owner,p}=await versionAccess(db,user,m[1]);if(!owner)fail(403,'FORBIDDEN','无权修改该题');if(body.bankId&&input.bankId!==p.bank_id)fail(409,'BANK_IMMUTABLE','题目版本仍属于原题库；跨题库请新建副本并保留来源');return insertVersion(db,user,m[1],input);});return respond(201,await problemResult(pool,user,v.problem_id,v.id));
   }
   m=route.match(/^\/problems\/([^/]+)\/(publish|validate)$/);
   if(m&&method==='POST'){
    staff(user);const problemId=uuid(m[1],'题目 ID'),versionId=uuid(body.versionId,'版本 ID');
    const result=await transaction(pool,async db=>{
     const p=row(await db.query('SELECT * FROM problems WHERE id=$1 FOR UPDATE',[problemId]));
     const fresh=row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND problem_id=$2 FOR UPDATE',[versionId,problemId]));
     if(p.archived_at)fail(409,'ARCHIVED','已归档题目不能发布或验证');
     const {owner}=await versionAccess(db,user,problemId,versionId);
     if(!owner)fail(403,'FORBIDDEN','无权发布该题');
     if(m[2]==='publish'){
      if(fresh.published_at)fail(409,'ALREADY_PUBLISHED','此题目版本已发布，不能再次提交发布；如需修改，请创建新版本');
      const latest=row(await db.query('SELECT id FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[problemId]));
      if(latest.id!==versionId)fail(409,'VERSION_CHANGED','题目已有更新版本，请刷新后发布最新版本');
      if(fresh.validation_status!=='AC')fail(409,'NOT_VALIDATED','参考解答须通过全部正式测试后才能发布');
      await db.query('UPDATE problem_versions SET published_at=now() WHERE id=$1',[versionId]);
      await db.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[versionId,problemId]);
      await audit(db,user.id,'problem.publish','problem_version',versionId);
      return problemResult(db,user,problemId,versionId);
     }
     if(fresh.published_at)fail(409,'IMMUTABLE','已发布版本不能重新验证，请创建新版本');
     if(fresh.validation_status==='Incomplete')fail(409,'INCOMPLETE','请补齐题面、参考解答、样例与正式测试并保存新版本后验证');
     if(!['Waiting','Judging'].includes(fresh.validation_status)){
      await assertJudgeAdmission(db);
      await db.query("UPDATE problem_versions SET validation_status='Waiting',validation_message=NULL WHERE id=$1",[versionId]);
      await db.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')",[versionId]);
     }
     return {versionId,validationStatus:'Waiting'};
    });return respond(200,result);
   }
  return null;
 }

 async function assignmentsOperation(context) {
  const preview=await handleLegacyAssignmentPreview(context,{submitLimiter,assignmentProblemRows,
   projectProblem:async (db,version)=>problemShape((await studentPublicStatementRows(db,[version]))[0])});
  if(preview)return preview;
  const authored=await handleAssignmentAuthoring(context);if(authored)return authored;
  const {route,method,body,url,user,sess,ip}=context;
  let m;
   if(route==='/assignments'&&method==='GET'){
    const archived=url.searchParams.get('archived')==='true';
    const rows=(await pool.query(`SELECT a.* FROM assignments a WHERE (a.archived_at IS NOT NULL)=$6 AND ($1 OR $2 AND a.owner_account_id=$3 OR $4 AND a.state='Published' AND EXISTS(SELECT 1 FROM assignment_participants p WHERE p.assignment_id=a.id AND p.identity_id=$5 AND NOT p.exempt)) ORDER BY a.created_at DESC LIMIT 200`,[rolesInclude(user,'admin'),rolesInclude(user,'teacher'),user.id,rolesInclude(user,'student'),user.identityId,archived])).rows;const items=[];for(const a of rows)items.push(await assignmentResult(pool,user,a.id));return respond(200,{items,serverNow:row(await pool.query('SELECT clock_timestamp() AS server_now')).server_now});
   }
   m=route.match(/^\/assignments\/([^/]+)$/);
   if(m&&method==='GET')return respond(200,await assignmentResult(pool,user,m[1],{includeCompletion:true}));
   m=route.match(/^\/assignments\/([^/]+)\/(archive|restore)$/);
   if(m&&method==='POST'){
    staff(user);const id=uuid(m[1],'作业 ID'),action=m[2];
    await transaction(pool,async db=>{
     await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[id]);
     const assignment=await assignmentAccess(db,user,id);
     if(!assignment.canManage)fail(403,'FORBIDDEN','无权管理该作业');
     if(action==='archive'){
      if(assignment.archived_at)return;
      if(assignment.state==='Published'&&assignment.due_at>new Date())fail(409,'ASSIGNMENT_IN_PROGRESS','作业尚未截止，请在截止后归档，以免影响学生提交');
      if((await db.query("SELECT 1 FROM submissions WHERE assignment_id=$1 AND status IN ('Waiting','Judging') LIMIT 1",[id])).rowCount)fail(409,'PENDING_JUDGMENT','仍有待判题提交，请等待判题完成');
      await db.query('UPDATE assignments SET archived_at=clock_timestamp() WHERE id=$1',[id]);
     }else{
      if(!assignment.archived_at)return;
      if(assignment.class_id&&!(await db.query('SELECT 1 FROM classes WHERE id=$1 AND archived_at IS NULL',[assignment.class_id])).rowCount)fail(409,'CLASS_ARCHIVED','请先恢复班级，再恢复作业');
      if(assignment.state==='Published'){
       const linked=(await db.query(`SELECT ap.problem_id,p.archived_at problem_archived_at,
        b.archived_at bank_archived_at,v.problem_id version_problem_id,v.published_at
        FROM assignment_problems ap JOIN problems p ON p.id=ap.problem_id
        JOIN problem_banks b ON b.id=p.bank_id JOIN problem_versions v ON v.id=ap.version_id
        WHERE ap.assignment_id=$1 FOR SHARE OF p,b,v`,[id])).rows;
       if(linked.some(x=>x.problem_archived_at||x.bank_archived_at||x.version_problem_id!==x.problem_id||!x.published_at))
        fail(409,'UNAVAILABLE_PROBLEM','作业包含已归档或未发布的题目版本，不能恢复为可编辑状态');
      }
      await db.query('UPDATE assignments SET archived_at=NULL WHERE id=$1',[id]);
     }
     await audit(db,user.id,`assignment.${action}`,'assignment',id);
    });return respond(200,await assignmentResult(pool,user,id));
   }
   m=route.match(/^\/assignments\/([^/]+)\/participants\/([^/]+)$/);
   if(m&&method==='PATCH') {
    staff(user);if(typeof body.exempt!=='boolean')fail(400,'VALIDATION','豁免状态无效');const assignmentId=uuid(m[1]),identityId=uuid(m[2]),reason=field(body.reason,'豁免原因',{max:2000});
    await transaction(pool,async db=>{await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[assignmentId]);const a=await assignmentAccess(db,user,assignmentId);if(!a.canManage)fail(403,'FORBIDDEN','无权管理该作业');if(a.archived_at)fail(409,'ARCHIVED','已归档作业不能修改，请先恢复');if(!(await db.query('SELECT clock_timestamp()<=$1 allowed',[a.due_at])).rows[0].allowed)fail(409,'DEADLINE_PASSED','截止后变更名单须先明确延期并审计');row(await db.query('UPDATE assignment_participants SET exempt=$1 WHERE assignment_id=$2 AND identity_id=$3 RETURNING identity_id',[body.exempt,assignmentId,identityId]));await db.query('UPDATE assignments SET edit_revision=edit_revision+1 WHERE id=$1',[assignmentId]);await audit(db,user.id,'assignment.participant_exempt','assignment',assignmentId,{identityId,exempt:body.exempt,reason});});return respond(200,await assignmentResult(pool,user,assignmentId));
   }
   m=route.match(/^\/assignments\/([^/]+)\/extend$/);
   if(m&&method==='POST') {
    staff(user);const assignmentId=uuid(m[1]),reason=field(body.reason,'延期原因',{max:2000}),dueAt=new Date(body.dueAt);if(!Number.isFinite(dueAt.getTime())||dueAt<=new Date())fail(400,'VALIDATION','新截止时间须晚于现在');
    await transaction(pool,async db=>{await db.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[assignmentId]);const a=await assignmentAccess(db,user,assignmentId);if(!a.canManage)fail(403,'FORBIDDEN','无权管理该作业');if(a.archived_at)fail(409,'ARCHIVED','已归档作业不能修改，请先恢复');if(dueAt<=new Date(a.due_at))fail(400,'VALIDATION','延期须晚于原截止时间');await db.query('UPDATE assignments SET due_at=$1,edit_revision=edit_revision+1 WHERE id=$2',[dueAt,assignmentId]);await audit(db,user.id,'assignment.extend','assignment',assignmentId,{previousDueAt:a.due_at,dueAt:dueAt.toISOString(),reason});});return respond(200,await assignmentResult(pool,user,assignmentId));
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
    const kind=enumValue(body.kind,['submit','samples','custom','correction'],'提交类型');
    const language=enumValue(body.language??'python',LANGUAGES,'代码语言');
    const problemId=uuid(body.problemId),code=bytes(body.code,'代码',config.codeLimit),key=field(body.idempotencyKey,'请求去重键',{min:8,max:100});
    const assignmentId=body.assignmentId?uuid(body.assignmentId):null,timedPracticeId=body.timedPracticeId?uuid(body.timedPracticeId):null;
    const requestedVersion=body.versionId?uuid(body.versionId,'版本 ID'):null,originalId=body.originalSubmissionId?submissionId(body.originalSubmissionId):null;
    const customInput=kind==='custom'?bytes(body.customInput??'','自定义输入'):null;
    const courseContext=body.courseId!=null||body.chapterId!=null
     ?{courseId:uuid(body.courseId,'课程 ID').toLowerCase(),chapterId:uuid(body.chapterId,'章节 ID').toLowerCase()}:null;
    if(courseContext&&(assignmentId||timedPracticeId||originalId))fail(400,'VALIDATION','课程练习不能混合作业、计时训练或订正');
    if(timedPracticeId&&(assignmentId||originalId||kind==='correction'))fail(400,'VALIDATION','计时训练不能混合作业或订正上下文');
    if(!code.trim())fail(400,'VALIDATION','请先输入代码');
    if(kind==='correction'&&!originalId)fail(400,'VALIDATION','订正需要原提交编号');
    if(kind==='submit'&&originalId)fail(400,'VALIDATION','正式提交不能设置原提交');
    const target={problemId,code,assignmentId,timedPracticeId,requestedVersion,originalId,customInput};
    const requestHash=canonicalHash({kind,language,...target,...(courseContext??{})});
    // Requests accepted before migration 013 omitted language from the hash.
    // Their stored rows default to Python; preserve retry semantics without
    // allowing a reused key to silently switch to another language.
    const legacyPythonHash=language==='python'&&!courseContext?canonicalHash({kind,...target}):null;
    const result=await transaction(pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${user.id}:${key}`]);
     const old=(await db.query('SELECT s.*,v.title problem_title FROM submissions s JOIN problem_versions v ON v.id=s.version_id WHERE account_id=$1 AND idempotency_key=$2',[user.id,key])).rows[0];if(old){if(old.request_hash!==requestHash&&!(old.language==='python'&&old.request_hash===legacyPythonHash))fail(409,'IDEMPOTENCY_CONFLICT','相同请求键对应的内容不同');return old;}
     submitLimiter.check(user.id);
     let assignment=null;
     if(assignmentId){
      // Activity membership remains authoritative; its historical pin no
      // longer selects the current teaching definition.
      await db.query('SELECT id FROM assignments WHERE id=$1 FOR SHARE',[assignmentId]);
      assignment=await assignmentAccess(db,user,assignmentId);
      if(!assignment.isParticipant)fail(403,'FORBIDDEN','只能作为被分配的学生提交作业，教师请使用练习预览');
      if(assignment.archived_at)fail(409,'ASSIGNMENT_ARCHIVED','作业已归档，不能在此作业中继续运行或提交；可从题库独立练习');
      row(await db.query('SELECT problem_id FROM assignment_problems WHERE assignment_id=$1 AND problem_id=$2',[assignmentId,problemId]));
     }
     // Corrections retain the original judge snapshot. Every new run captures
     // the one current definition under the same parent lock as publication.
     const original=originalId?await submissionAccess(db,user,originalId):null;
     if(original){
      if(original.identity_id!==user.identityId||original.problem_id!==problemId||!['submit','correction'].includes(original.kind))fail(400,'VALIDATION','只能订正自己的同题正式提交');
      if(original.access_timed_attempt_id&&!(await db.query('SELECT 1 FROM timed_attempts attempt JOIN timed_practices practice ON practice.id=attempt.practice_id WHERE attempt.id=$1 AND practice.results_published_at IS NOT NULL',[original.access_timed_attempt_id])).rowCount)fail(409,'RESULTS_NOT_RELEASED','计时训练成绩发布后才能订正或运行样例');
      if(assignmentId&&original.access_assignment_id!==assignmentId)fail(409,'ASSIGNMENT_CONTEXT_MISMATCH','作业订正须引用本作业的原提交');
      if(requestedVersion&&requestedVersion!==original.version_id)fail(409,'VERSION_MISMATCH','订正版本与原提交不同');
     }
     const course=courseContext?await resolveLegacyCourseProblem(db,user,{...courseContext,problemId}):null;
     let v=original?row(await db.query('SELECT * FROM problem_versions WHERE id=$1 AND published_at IS NOT NULL',[original.version_id]))
      :course?.version??await resolveLiveProblemVersion(db,problemId);
     const {permissions}=await versionAccess(db,user,problemId,v.id);
     if(!timedPracticeId&&!permissions.canRunFree)fail(403,'TIMED_CONTEXT_REQUIRED','该题目仅授权用于当前计时训练，请从训练工作区提交');
     const requiredLanguage=course?.requiredLanguage??assignment?.required_language??original?.required_language??null;
     assertRequiredLanguage(language,requiredLanguage);
     if(!original)assertLiveProblemVersion(requestedVersion,v.id);
     await assertJudgeAdmission(db);
     if((await db.query("SELECT count(*)::int count FROM submissions WHERE identity_id=$1 AND status IN ('Waiting','Judging')",[user.identityId])).rows[0].count>=5)fail(429,'TOO_MANY_PENDING','最多同时等待 5 个运行，请等待已有结果');
     // The homework deadline limits official grades and activity rewards,
     // not admission to the judge. Persist the server's receipt time as usual.
     let acceptedAt=row(await db.query('SELECT clock_timestamp()::text AS accepted_at')).accepted_at;
     const timedContext=await timed.prepareSubmission(db,user,body,v);if(timedContext){v=timedContext.version;acceptedAt=timedContext.acceptedAt;}if(kind==='samples'&&!(v.samples||[]).some(sample=>sample.enabled!==false))fail(409,'NO_PUBLIC_SAMPLES','此版本没有启用的公开样例，请联系教师补齐后运行');if(kind==='custom'&&v.mode==='function'){try{parseFunctionInput(customInput);}catch{fail(400,'VALIDATION','函数自测输入须为 JSON 参数数组或合法的 args/kwargs 对象');}}
     if(kind==='submit'){
      // A new request key cannot create a second attempt for identical code
      // while it is in flight or already accepted in this grading context.
      const scope=[user.identityId,v.problem_id,v.id,assignment?.id??null,timedContext?.timedAttemptId??null,language];
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`submission-code:${canonicalHash([...scope,code])}`]);
      const duplicate=(await db.query(`SELECT status FROM submissions
        WHERE identity_id=$1 AND problem_id=$2 AND version_id=$3
          AND assignment_id IS NOT DISTINCT FROM $4::uuid AND timed_attempt_id IS NOT DISTINCT FROM $5::uuid
          AND language=$6 AND kind='submit' AND code=$7 AND status IN ('Waiting','Judging','AC')
        ORDER BY (status='AC') DESC LIMIT 1`,[...scope,code])).rows[0];
      if(duplicate?.status==='AC')fail(409,'SUBMISSION_ALREADY_ACCEPTED','相同代码已通过，不会重复计入提交次数。修改代码后可再次提交。');
      if(duplicate)fail(409,'SUBMISSION_ALREADY_PENDING','相同代码已提交，请等待当前判题结果。');
     }
     const s=row(await db.query('INSERT INTO submissions(account_id,identity_id,problem_id,version_id,assignment_id,kind,original_submission_id,code,language,custom_input,idempotency_key,request_hash,created_at,timed_attempt_id,required_language) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',[user.id,user.identityId,problemId,v.id,assignmentId,kind,originalId,code,language,customInput,key,requestHash,acceptedAt,timedContext?.timedAttemptId||null,requiredLanguage]));await db.query("INSERT INTO judge_tasks(submission_id,version_id,purpose) VALUES($1,$2,'submission')",[s.id,v.id]);if(kind==='correction')await db.query('INSERT INTO review_entries(submission_id,author_account_id,note) VALUES($1,$2,$3)',[s.id,user.id,'已提交订正']);return {...s,problem_title:v.title};
    });return respond(201,submissionShape(await timed.maskSubmission(pool,user,result)));
   }
   m=route.match(/^\/submissions\/([^/]+)\/assignment-completions$/);
   if(m&&method==='GET')return respond(200,{items:await learnerSubmissionAssignmentCompletions(pool,user,m[1])});
   m=route.match(/^\/submissions\/([^/]+)$/);
   if(m&&method==='GET'){const sub=await submissionAccess(pool,user,m[1]);const reviews=(await pool.query(`${reviewEntryQuery} WHERE s.id=$1 ORDER BY r.created_at,r.id`,[sub.id])).rows.filter(r=>reviewEntryVisible(user,r)).map(reviewNoteShape);let pendingRejudge=null;if(sub.pending_judge_run_id){pendingRejudge={runId:sub.pending_judge_run_id};if(await canReviewActivitySubmission(pool,user,sub,{readOnly:true})){const candidate=(await pool.query('SELECT r.status,r.score,r.passed,r.total,r.created_at,t.reason FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id WHERE r.id=$1',[sub.pending_judge_run_id])).rows[0];if(candidate)pendingRejudge={...pendingRejudge,status:candidate.status,score:candidate.score===null?null:Number(candidate.score),passed:candidate.passed,total:candidate.total,createdAt:candidate.created_at,reason:candidate.reason};}}const masked=await timed.maskSubmission(pool,user,sub);const result=await loadSubmissionResult(pool,sub,masked,{revealFormalFailure:sub.identity_id===user.identityId});return respond(200,{...submissionShape(masked),reviews,pendingRejudge,...result});}
   m=route.match(/^\/review-notebook\/([^/]+)$/);
   if(m&&method==='GET'){
    const entry=row(await pool.query(`${reviewEntryQuery} WHERE r.id=$1`,[uuid(m[1],'笔记 ID')]));
    const selected=await submissionAccess(pool,user,entry.submission_id);
    if(!reviewEntryVisible(user,entry))fail(404,'NOT_FOUND','反馈尚未公开');
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
    const relatedNotes=notes.filter(note=>reviewEntryVisible(user,note)).map(reviewEntryShape);
    const latest=allowed.find(sub=>sub.kind==='correction');
    return respond(200,{...reviewEntryShape(entry),relatedNotes,originalSubmissionId:`SUB${root.id}`,latestCorrectionId:latest?`SUB${latest.id}`:null,latestCorrectionCreatedAt:latest?.created_at||null});
   }
   if(route==='/review-notebook'&&method==='GET'){
    const rows=(await pool.query(`${reviewEntryQuery} WHERE s.identity_id=$1
     AND (a.id=s.account_id OR i.id=s.identity_id OR practice.id IS NULL OR practice.results_published_at IS NOT NULL)
     ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,[user.identityId])).rows;
    return respond(200,{items:rows.map(reviewEntryShape)});
   }
   if(route==='/review-notebook'&&method==='POST'){
    const note=field(body.note,'订正笔记',{max:10000});
    const result=await transaction(pool,async db=>{
     const submission=await submissionAccess(db,user,body.submissionId);
     const teacherFeedback=submission.identity_id!==user.identityId&&submission.account_id!==user.id;
     const practice=teacherFeedback&&submission.access_timed_attempt_id
      ? row(await db.query(`SELECT p.id,p.results_published_at FROM timed_attempts a
        JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=$1 FOR SHARE OF p`,
       [submission.access_timed_attempt_id]))
      : null;
     const entry=row(await db.query(`INSERT INTO review_entries(submission_id,author_account_id,note)
       VALUES($1,$2,$3) RETURNING id,note,created_at`,[submission.id,user.id,note]));
     if(teacherFeedback)await notifyStudent(db,{
      identityId:submission.identity_id,kind:'teacher_feedback',sourceKey:entry.id,
      data:{reviewId:entry.id,problemTitle:submission.problem_title,timedPracticeId:practice?.id??null},
     });
     return {
      id:entry.id,note:entry.note,createdAt:entry.created_at,submissionId:`SUB${submission.id}`,
      problemTitle:submission.problem_title,authorName:user.name,authorIdentityId:user.identityId,teacherFeedback,
      feedbackPending:Boolean(practice&&!practice.results_published_at),
     };
    });
    return respond(201,result);
   }
  return null;
 }

 async function educationOperation(context) {
  const {route,method,body,url,user,sess,ip}=context;
  let m;
  for (const handler of [handleTeachingAudience, handleEducation, timed.handle]) { const result=await handler(context); if(result)return result; }
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

 async function schoolsOperation(context) {
  return await handleSchoolSettings(context) ?? await handleSchools(context) ?? await handleSchoolActivation(context) ?? await handleSchoolTeaching(context) ?? await handleSchoolIdentityImports(context) ?? await handleSchoolCourses(context);
 }

 const operations={acsl:handleAcsl,publicPresence:handlePublicPresence,schoolScholarship:handleSchoolScholarship,schoolLeaderboard:handleSchoolLeaderboard,schoolPaper4:handleSchoolPaper4,schoolActivities:schoolActivitiesOperation,schoolPractice:schoolPracticeOperation,publicLearning:handlePublicLearning,auth:authOperation,people:peopleOperation,classes:classesOperation,library:libraryOperation,assignments:assignmentsOperation,submissions:submissionsOperation,education:educationOperation,community:handleCommunity,presence:handlePresence,platform:async ctx=>await handlePublicLearning(ctx)??await schoolPracticeOperation(ctx)??await handlePlatformGovernance(ctx),schools:schoolsOperation,system:systemOperation,paper4:handlePaper4,scholarship:handleScholarship};
 const helpers={problemShape,audit,classAccess,versionAccess,submissionAccess,assignmentAccess,assignmentResult,problemResult,problemInput,insertVersion,issueActivation,personShape,maskSubmission:timed.maskSubmission};
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
  await requireLegacyWorkspaceAccess(pool,user,route,method);
  const renewedCookie=route==='/auth/me'&&method==='GET'&&user?sessionCookie(rawToken,config):undefined;
  return {pool,user,sess,route,method,body,url,ip,config,helpers,renewedCookie};
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
