import { publicRunSharing, sharingStudent } from './public-run-sharing.mjs';
import { studentJudgingHistory } from './school-student-judging-history.mjs';
import { lockPlatformContent } from './platform-content-access.mjs';
import { schoolBankDirectory } from './school-bank-directory.mjs';
import { ownSchoolReceipt, receiptActivityJoin, receiptVisible } from './school-submission-history.mjs';
import { problemProgress } from './problem-progress.mjs';
import { assertLiveProblemVersion, assertPublishedRevision } from './live-problem-version.mjs';
import { problemCatalogCourseRequest } from './problem-catalog-courses.mjs';
import { platformCourseProblem } from './platform-course-problems.mjs';
import { handlePlatformProblemAudiences, matchingProblemAudienceSql } from './platform-problem-audiences.mjs';
import {publicScholarshipOperation,recordPublicPracticeStaffExposure} from './public-scholarship.mjs';
import { schoolActivityJobVisibleSql, schoolActivityProblemAccess, schoolJobFeedback } from './school-activities.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { activeAccount, auditSchool, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { HttpError, bytes, canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';
import { validateTask } from '../judge.mjs';
import { schoolProblemSubmissions } from './problem-submissions.mjs';
import { publicProblemMetadata } from './problem-public-statements.mjs';
import { handlePublicPracticeRecords, setPublicPracticeHistoryAccount } from './public-practice-records.mjs';
import { publicPracticeLeaderboard } from './public-practice-leaderboard.mjs';
import { customTutorial, saveTutorial, tutorialContext, tutorialSettings } from './problem-tutorials.mjs';
import { loadSchoolCourse, schoolCourseProblemLanguage, schoolProblemCatalogCourses } from './school-courses.mjs';
import { publicCourseProblemLanguage, publicProblemCatalogCourses } from './public-learning.mjs';
import { assertRequiredLanguage } from './course-language-policy.mjs';
import { LANGUAGES, starterCodesFor } from './languages.mjs';
import {
 decideCatalogPublicProblem, handleCatalogPublicProblemRequest,
 listCatalogPublicProblemReviews, previewCatalogPublicProblem, prepareCatalogPublicProblem, publishedCatalogRows,
 platformProblemCatalogRows, preparePlatformCourseProblem, lockCatalogProblemSchools,
} from './catalog-problem-publication.mjs';

const reply=(body,status=200)=>({status,body});
const canManage=(p,u,role)=>!p.platform_owned&&(role==='school_admin'||role==='teacher'&&p.owner_account_id===u.id);
const practiceContext=role=>role==='student'?'school':'staff_practice';
const canManageTutorial=(p,u,role)=>!p.archived&&(canManage(p,u,role)||role==='teacher'&&p.published&&!!p.published_version_id);
const scope=(db,id)=>db.query("SELECT set_config('campus.school_id',$1,true)",[id]);
const revision=(body,row)=>{if(integer(body.expectedRevision,1,2147483646,'Revision')!==row.revision)fail(409,'REVISION_CONFLICT','This item has changed. Refresh before saving.');};

async function schoolCourseTutorial(db,problem,user,role,url) {
 const {courseId,chapterId}=tutorialContext(url);
 const link={problemId:problem.id,versionId:problem.published_version_id};
 const {rows}=await db.query(`SELECT c.id FROM school_courses c
  JOIN school_course_publications p ON p.school_id=c.school_id AND p.course_id=c.id AND p.revision=c.published_revision
  WHERE c.school_id=$1 AND c.published AND c.archived_at IS NULL AND p.chapters @> $2::jsonb
  ORDER BY (c.id=$3) DESC NULLS LAST,c.id`,[problem.school_id,JSON.stringify([{problems:[{problemId:link.problemId}]}]),courseId]);
 for(const {id} of rows){
  let view;
  try { ({view}=await loadSchoolCourse(db,problem.school_id,id,user,role,{publishedOnly:true})); }
  catch(error){ if(error.code==='NOT_FOUND')continue; throw error; }
  const eligible=view.chapters.filter(chapter=>chapter.body.trim()&&chapter.problems?.some(item=>item.problemId===link.problemId&&item.versionId===link.versionId));
  const chapter=(id===courseId&&eligible.find(chapter=>chapter.id===chapterId))||eligible[0];
  if(chapter)return {source:'course',courseTitle:view.title,title:chapter.title,body:chapter.body};
 }
 return null;
}

export function normalizeSchoolProblem(body,previous={}){
 const mode=enumValue(body.mode??'stdio',['stdio','function'],'Mode');
 const referenceLanguage=enumValue(body.referenceLanguage??'python',LANGUAGES,'Reference language');
 const definition={reference_language:referenceLanguage,title:field(body.title,'Title',{max:200}),statement:field(body.statement,'Statement',{max:100000,trim:false}),mode,
  function_name:mode==='function'?field(body.functionName??'solve','Function name',{max:80}):null,
  comparator:mode==='function'?'json':enumValue(body.comparator??'tokens',['tokens','exact','json'],'Comparator'),
  time_limit_ms:integer(body.timeLimitMs??1000,100,5000,'Time limit'),memory_limit_mb:integer(body.memoryLimitMb??128,32,256,'Memory limit'),
  reference_code:bytes(body.referenceCode,'Reference code'),starter_code:bytes(body.starterCode??(mode==='function'?'def solve(data):\n    pass\n':'# Read input and print the result.\n'),'Starter code'),samples:[],tests:[]};
 definition.metadata={...previous.metadata,...publicProblemMetadata(body)};
 // Teacher-only material is stored with the draft, outside the student metadata allowlist.
 const editorial=body.editorial??previous.editorial;
 if(editorial!=null)definition.metadata.editorial=field(editorial,'Teacher solution notes',{min:0,max:100000,trim:false});
 if(body.hints!==undefined){
  if(!Array.isArray(body.hints)||body.hints.length>30)fail(400,'VALIDATION','Expected at most 30 hints.');
  definition.metadata.hints=body.hints.map(h=>typeof h==='string'?field(h,'Hint',{min:0,max:4000}):{
   name:field(h?.name??'','Hint name',{min:0,max:200}),type:field(h?.type??'','Hint type',{min:0,max:200}),
   description:field(h?.description??'','Hint description',{min:0,max:4000})});
 }
 if(body.hintPolicy!==undefined)definition.metadata.hintPolicy=enumValue(body.hintPolicy,['always','afterAC','never'],'Hint policy');
 if(body.source!==undefined||previous.source!==undefined)definition.source=field(body.source??previous.source,'Source',{min:0,max:4000});
 if (Array.isArray(body.tags)) definition.tags=body.tags.map(tag=>field(tag,'标签',{max:100}));
 if (body.starterCodes) definition.starter_codes=Object.fromEntries(LANGUAGES.filter(lang=>typeof body.starterCodes[lang]==='string').map(lang=>[lang,bytes(lang==='python'?definition.starter_code:body.starterCodes[lang],'Starter code')]));
 for(const key of ['samples','tests']){
  if(!Array.isArray(body[key])||body[key].length<1||body[key].length>(key==='samples'?20:100))fail(400,'VALIDATION',`${key} must contain 1–${key==='samples'?20:100} cases.`);
  definition[key]=body[key].map((t,i)=>({id:randomUUID(),position:i+1,input:bytes(t?.input,`${key} input`,262144),expected:bytes(t?.expected,`${key} expected`,262144),...(key==='tests'?{weight:Number(t.weight)}:{enabled:true})}));
 }
 if(Buffer.byteLength(JSON.stringify(definition))>2000000)fail(413,'TOO_LARGE','Problem package exceeds 2 MB.');
 try{validateTask({kind:'validation',version:definition,language:referenceLanguage,code:definition.reference_code,tests:definition.tests});validateTask({kind:'samples',version:definition,language:'python',code:definition.reference_code,tests:definition.samples});}
 catch{fail(400,'INVALID_CASES','Check function name, JSON cases and positive formal test weights totaling 100.');}
 return definition;
}
const publicDefinition=v=>({title:v.title,statement:v.statement,mode:v.mode,functionName:v.function_name,comparator:v.comparator,
 ...publicProblemMetadata(v.metadata),tags:Array.isArray(v.tags)?v.tags.filter(tag=>typeof tag==='string'):[],
 timeLimitMs:v.time_limit_ms,memoryLimitMb:v.memory_limit_mb,starterCode:v.starter_code,
 starterCodes:starterCodesFor(v),
 samples:v.samples.map(t=>({input:t.input,expected:t.expected}))});
const draftDefinition=v=>({...publicDefinition(v),
 ...(v.source!=null&&{source:v.source}),...((v.editorial??v.metadata?.editorial)!=null&&{editorial:v.editorial??v.metadata.editorial}),
 ...(v.metadata?.hints!=null&&{hints:v.metadata.hints}),...(v.metadata?.hintPolicy!=null&&{hintPolicy:v.metadata.hintPolicy}),
 referenceLanguage:v.reference_language??'python',referenceCode:v.reference_code,tests:v.tests.map(t=>({input:t.input,expected:t.expected,weight:t.weight}))});
async function loadProblem(db,schoolId,id,user,role,{publicOnly=false}={}){
 const p=(await db.query(`SELECT p.*,b.name AS bank_name,b.archived,EXISTS(SELECT 1 FROM problems original WHERE original.id=p.id AND original.owner_scope='platform') platform_owned FROM school_problems p JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id WHERE b.resource_kind=\'ordinary\' AND p.school_id=$1 AND p.id=$2`,[schoolId,id])).rows[0];
 if(!p||(!publicOnly&&!canManage(p,user,role)&&(!p.published||p.archived))||publicOnly&&(!p.published||p.archived))fail(404,'NOT_FOUND','Problem is unavailable.');
 return p;
}
async function shapeProblem(db,p,user,role,{detail=false,publicOnly=false,accessContext='school',catalogQuery=''}={}){
 if(accessContext==='school')accessContext=practiceContext(role);
 const manage=!publicOnly&&canManage(p,user,role);
 const version=p.published_version_id?(await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND id=$2',[p.school_id,p.published_version_id])).rows[0]:null;
 if(manage&&detail)await recordPublicPracticeStaffExposure(db,user.id,p.id);
 const def=manage?p.draft:version?.definition;
 if(!def)fail(404,'NOT_FOUND','Problem is unavailable.');
 const metadata=manage?def.metadata:p.public_metadata??def.metadata,rawTags=manage?def.tags:p.public_tags??def.tags;
 const tags=Array.isArray(rawTags)?rawTags.filter(tag=>typeof tag==='string'&&tag.trim()):[];
 if(catalogQuery && !`${p.id} ${def.title} ${p.bank_name} ${tags.join(' ')}`.toLowerCase().includes(catalogQuery)) return null;
 const validation=manage?(await db.query(`SELECT j.id,j.state,j.result->>'status' AS status FROM school_judge_jobs j WHERE j.school_id=$1 AND j.problem_id=$2 AND j.validation_revision=$3 AND j.kind='validation' ORDER BY j.created_at DESC LIMIT 1`,[p.school_id,p.id,p.revision])).rows[0]:null;
 const progress=(await problemProgress(db,user,[p.id],{includeStaff:accessContext==='staff_practice'})).get(p.id);
 const publication = !publicOnly && role === 'school_admin' && version && p.published && !p.archived
  ? await publicProblemStatus(db, p, version.id) : undefined;
 return {attempts:progress?.formalCount??0,solved:progress?.solved===true,status:progress?.status??'Not started',
  tags,difficulty:typeof metadata?.difficulty==='string'?metadata.difficulty:null,
  hasDraftChanges:manage&&!!version&&version.draft_revision!==p.revision,id:p.id,schoolId:p.school_id,bankId:p.bank_id,bankName:p.bank_name,title:def.title,revision:manage?p.revision:version?.draft_revision??null,publishedRevision:version?.draft_revision??null,published:p.published,versionId:version?.id??null,canManage:manage,canManageTutorial:!publicOnly&&canManageTutorial(p,user,role),validation:validation??null,...publication,...(detail?{staffPractice:accessContext==='staff_practice',definition:manage?draftDefinition(def):publicDefinition({...def,statement:p.public_statement??def.statement,metadata:p.public_metadata??def.metadata,tags:p.public_tags??def.tags})}:{})};
}
async function publicProblemStatus(db, problem, versionId) {
 const { rows: [state] } = await db.query(`
  SELECT EXISTS(SELECT 1 FROM school_problem_publications WHERE school_id=$1 AND problem_id=$2
    AND withdrawn_at IS NULL) AS "platformPublished",
   (SELECT status FROM school_problem_publication_requests WHERE school_id=$1 AND problem_id=$2 AND version_id=$3) AS "publicRequestStatus"
 `, [problem.school_id, problem.id, versionId]);
 return state;
}
async function enqueue(db,{schoolId,p,version,user,role,kind,body,accessContext}){
 const requestId=uuid(body.requestId,'Request ID'),language=enumValue(body.language??'python',LANGUAGES,'Language');
 const course = body.courseId == null && body.chapterId == null ? null : {
  courseId:uuid(body.courseId,'Course ID').toLowerCase(),
  chapterId:uuid(body.chapterId,'Chapter ID').toLowerCase(),
 };
 if(body.coursePreview!=null&&typeof body.coursePreview!=='boolean')fail(400,'VALIDATION','Invalid course preview mode.');
 const preview=body.coursePreview===true;
 if(preview&&(!course||accessContext!=='staff_practice'))fail(403,'FORBIDDEN','Course preview requires course management access.');
 const code=kind==='validation'?version.definition.reference_code:bytes(body.code,'Code');
 const customInput=kind==='custom'?bytes(body.input??'','Input',262144):null;
 const validationRevision=kind==='validation'?p.revision:null;
 const classroom=accessContext==='public' && body.classroomSchoolId!=null ? uuid(body.classroomSchoolId).toLowerCase() : null;
 const pupil=classroom ? await sharingStudent(db,classroom,user.id) : null;
 const requestHash=canonicalHash({problemId:p.id,versionId:version.id,kind,language,code,customInput,accessContext,...course,...(classroom && {classroom}),...(preview&&{coursePreview:true}),...(validationRevision!=null&&{validationRevision})});
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-submit:'||$1,0))",[user.id]);
 const old=(await db.query('SELECT * FROM school_judge_jobs WHERE account_id=$1 AND request_id=$2',[user.id,requestId])).rows[0];
 if(old){if(old.request_hash!==requestHash)fail(409,'REQUEST_CONFLICT','Request ID was used for another operation.');return {id:old.id,state:old.state};}
 if(kind!=='validation')assertPublishedRevision(body.publishedRevision,version.draft_revision);
 if(course){
  if(kind==='validation')fail(400,'VALIDATION','Reference validation cannot use a course context.');
  if(body.versionId!=null&&uuid(body.versionId).toLowerCase()!==version.id)
   fail(409,'REVISION_CONFLICT','This problem version has changed. Refresh the course before submitting.');
  const resolveLanguage=accessContext==='public'?publicCourseProblemLanguage:schoolCourseProblemLanguage;
  const requiredLanguage=await resolveLanguage(db,user,{...course,schoolId,problemId:p.id,versionId:version.id,role,preview});
  assertRequiredLanguage(language,requiredLanguage);
 }
 const counts=(await db.query(`SELECT count(*) FILTER(WHERE state IN ('queued','leased'))::integer AS pending,count(*) FILTER(WHERE created_at>now()-interval '5 minutes')::integer AS recent FROM school_judge_jobs WHERE account_id=$1`,[user.id])).rows[0];
 if(counts.pending>=5||counts.recent>=60)fail(429,'RATE_LIMIT','Too many judge requests. Please wait.');
 const definition=version.definition,tests=kind==='custom'?[{position:1,input:customInput}]:kind==='samples'?definition.samples:definition.tests;
 const payload={kind,version:{...definition,reference_code:undefined,tests:undefined},code,language,tests};
 try{validateTask(payload);}catch{fail(400,'INVALID_CASES','Invalid code, language or input.');}
 const identityId=accessContext==='school'?(await db.query('SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2',[schoolId,user.id])).rows[0]?.id:null;
 const job=(await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,request_id,request_hash,kind,access_context,payload,validation_revision,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()) RETURNING id,state`,[schoolId,p.id,version.id,user.id,identityId??null,requestId,requestHash,kind,accessContext,JSON.stringify(payload),validationRevision])).rows[0];
 if(classroom){
  await setPublicPracticeHistoryAccount(db,user.id);
  await db.query(`INSERT INTO school_public_run_shares(school_id,identity_id,account_id,source_school_id,job_id,visibility)
   VALUES($1,$2,$3,$4,$5,'classroom')`,[classroom,pupil,user.id,schoolId,job.id]);
 }
 return job;
}
async function projectJob(db,job){
 const feedback=await schoolJobFeedback(db,job);
 if(!feedback.resultsVisible)return {id:job.id,problemId:job.problem_id,versionId:job.version_id,problemTitle:job.payload.version.title,code:job.payload.code,language:job.payload.language,kind:job.kind,state:job.state,createdAt:job.created_at,status:'Submitted',score:null,passed:0,total:0,runtimeMs:null,memoryKb:null,message:'Results will be available after publication.',...feedback};
 const r=job.result;
 // Aggregate resource measurements over the full saved run.
 const measurements=job.state==='completed'&&r?.status!=='System Error'&&Array.isArray(r?.privateResults)?r.privateResults:[];
 const runtimeMs=measurements.length&&measurements.every(item=>Number.isFinite(item?.cpuMs)&&item.cpuMs>=0)
  ?measurements.reduce((total,item)=>total+item.cpuMs,0):null;
 const memoryKb=measurements.length&&measurements.every(item=>Number.isFinite(item?.memoryBytes)&&item.memoryBytes>=0)
  ?Math.ceil(Math.max(...measurements.map(item=>item.memoryBytes))/1024):null;
 return {id:job.id,problemId:job.problem_id,versionId:job.version_id,problemTitle:job.payload.version.title,code:job.payload.code,language:job.payload.language,kind:job.kind,state:job.state,createdAt:job.created_at,
  status:r?.status??(job.state==='failed'?'System Error':job.state==='leased'?'Judging':'Waiting'),score:r?.score??null,passed:r?.passed??0,total:r?.total??0,
  runtimeMs,memoryKb,
  message:r?.publicMessage??'',...feedback};
}
async function loadScopedPublicProblem(db,user,id,courseContext,requireCourseContext){
 await lockCatalogProblemSchools(db,[id],{shared:true});
 const grant=await db.query(`SELECT 1 FROM platform_problem_audiences audience
  WHERE audience.problem_id=$1 AND ${matchingProblemAudienceSql('$2')} LIMIT 1`,[id,user.id]);
 if(grant.rowCount){
  const directed=await preparePlatformCourseProblem(db,id);
  if(directed)return directed;
 }
 if(!requireCourseContext||courseContext.courseId){
  const scoped=await platformCourseProblem(db,user,id,courseContext);
  if(scoped)return scoped;
 }
 fail(404,'NOT_FOUND','Problem is unavailable.');
}

async function hasCatalogSource(db,schoolId,problemId) {
 const {rowCount}=await db.query("SELECT 1 FROM problems p JOIN problem_banks b ON b.id=p.bank_id WHERE p.id=$1 AND b.catalog_scope_id=$2 AND p.owner_scope='platform'",[problemId,schoolId]);
 return rowCount>0;
}

const publicExerciseAvailable = `NOT EXISTS(SELECT 1 FROM school_activity_problems link
 JOIN school_activities activity ON (activity.school_id,activity.id)=(link.school_id,link.activity_id)
 WHERE (link.school_id,link.problem_id)=(p.school_id,p.id) AND activity.kind='timed')`;

async function publicLoaded(db,user,id,courseContext={},requireCourseContext=false){
 if(courseContext.courseId&&(await db.query(`SELECT 1 FROM learning_paths p LEFT JOIN public_course_listings l ON l.course_id=p.id
 WHERE p.owner_scope='platform' AND (p.id=$1 OR l.id=$1)`,[uuid(courseContext.courseId)])).rowCount){
  const scoped=await platformCourseProblem(db,user,id,courseContext);
  if(scoped)return scoped;
 }
 await activeAccount(db,user.id);
 const publication=(await db.query('SELECT school_id FROM school_problem_publications WHERE problem_id=$1 AND withdrawn_at IS NULL',[uuid(id)])).rows[0];
 if(!publication)return loadScopedPublicProblem(db,user,id,courseContext,requireCourseContext);
 const schoolId=publication.school_id;
 await lockSchoolTeaching(db,schoolId,{shared:true});
 const current=await db.query('SELECT 1 FROM school_problem_publications WHERE problem_id=$1 AND school_id=$2 AND withdrawn_at IS NULL',[id,schoolId]);
 if(await hasCatalogSource(db,schoolId,id)){
  if(current.rowCount){
   await scope(db,schoolId);
   const problem=await prepareCatalogPublicProblem(db,id);
   if(problem)return problem;
  }
  return loadScopedPublicProblem(db,user,id,courseContext,requireCourseContext);
 }
 if(!current.rowCount)fail(404,'NOT_FOUND','Problem is unavailable.');
 await scope(db,schoolId);
 await schoolActivityProblemAccess(db,{schoolId,problemId:id,user});
 if(!(await db.query(`SELECT 1 FROM school_problems p WHERE p.school_id=$1 AND p.id=$2 AND ${publicExerciseAvailable}`,[schoolId,id])).rowCount)fail(404,'NOT_FOUND','Problem is unavailable.');
 return loadProblem(db,schoolId,id,user,null,{publicOnly:true});
}

export async function readablePlatformHistory(db,user,problemId) {
 try {
  const problem=await publicLoaded(db,user,problemId);
  await schoolActivityProblemAccess(db,{schoolId:problem.school_id,problemId,user});
  return problem.school_id;
 } catch(error) {
  if(error instanceof HttpError && [403,404].includes(error.status))return null;
  throw error;
 }
}

const rowsBySchool=rows=>{
 const schools=new Map();
 for(const row of rows){const id=row.school_id??row.schoolId;if(!schools.has(id))schools.set(id,[]);schools.get(id).push(row);}
 return [...schools].sort(([a],[b])=>a.localeCompare(b));
};
async function publicCatalogRows(db,publications,lockedSchools) {
 const output=new Map();
 for(const [schoolId,rows] of rowsBySchool(publications)){
  if(!lockedSchools.has(schoolId)){await lockSchoolTeaching(db,schoolId,{shared:true});lockedSchools.add(schoolId);}
  await scope(db,schoolId);
  const ids=rows.map(row=>row.problem_id);
  // Recheck publication after acquiring the same withdrawal lock as detail
  // requests. School scopes stay sequential on this transaction's connection.
  const sources=await publishedCatalogRows(db,schoolId,ids);
  const current=(await db.query(`SELECT p.id,p.school_id AS "schoolId",p.bank_id AS "bankId",b.name AS "bankName",
    v.definition->>'title' title,v.definition->'tags' tags,v.definition->>'mode' mode,
    CASE WHEN jsonb_typeof(v.definition->'metadata'->'difficulty')='string' THEN v.definition->'metadata'->>'difficulty' END difficulty,
    p.revision,p.published,v.id AS "versionId",v.draft_revision<>p.revision AS "hasDraftChanges"
    FROM school_problem_publications publication
    JOIN school_problems p ON p.school_id=publication.school_id AND p.id=publication.problem_id
    JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
    JOIN school_problem_versions v ON v.school_id=p.school_id AND v.problem_id=p.id AND v.id=p.published_version_id
    WHERE publication.school_id=$1 AND publication.problem_id=ANY($2::uuid[]) AND publication.withdrawn_at IS NULL
     AND p.published AND NOT b.archived AND b.resource_kind='ordinary' AND ${publicExerciseAvailable}`,[schoolId,ids])).rows;
  for(const row of [...current,...sources])output.set(row.id,{...row,
   tags:Array.isArray(row.tags)?row.tags.filter(tag=>typeof tag==='string'&&tag.trim()):[],
   mode:row.mode==='function'?'function':'stdio'});
 }
 return output;
}

export async function listPublicProblems(pool,user,url){
 const { courseId, includeCourses } = problemCatalogCourseRequest(url);
 const courseOnly=url?.searchParams.get('fromCourse')==='1';
 const filters={
  topic:field(url?.searchParams?.get('topic')??'','Topic',{min:0,max:200}),
  status:enumValue(url?.searchParams?.get('status')??'',['','Not started','AC','WA','CE','RE','TLE','MLE','OLE','Waiting','Judging','Executed','System Error'],'Status'),
  mode:enumValue(url?.searchParams?.get('mode')??'',['','stdio','function'],'Mode'),
  savedOnly:url?.searchParams?.get('savedOnly')==='1',
 };
 const query=(url?.searchParams?.get('q')??'').slice(0,100).trim();
 const rawPage=url?.searchParams?.get('page');
 const page=rawPage==null?null:integer(Number(rawPage),1,100000,'Page');
 return transaction(pool,async db=>{
  await activeAccount(db,user.id);
  const sourceSchools=await lockCatalogProblemSchools(db,null,{shared:true});
  const courseFilter=await publicProblemCatalogCourses(db,user,courseId,{platformOnly:!includeCourses&&!courseOnly});
  return readPracticeCatalog(db,user,courseFilter,sourceSchools,{courseId,includeCourses,courseOnly,filters,query,page});
 });
}

async function readPracticeCatalog(db,user,courseFilter,sourceSchools,{
 courseId,includeCourses=false,courseOnly=false,filters={},query='',page=null,limit=page==null?500:50,
}) {
  const catalogQuery=query.toLowerCase();
  let skip=page==null?0:(page-1)*limit;
  const versions=courseId?courseFilter.versions:null;
  const problemIds=versions?[...versions.keys()]:courseOnly?[...courseFilter.byProblem.keys()]:null;
  const linkedPlatformIds=[...courseFilter.byProblem].filter(([,contexts])=>[...contexts.values()].some(context=>context.platform)).map(([id])=>id);
  const favorites=filters.savedOnly?new Set((await db.query('SELECT problem_id FROM problem_favorites WHERE identity_id=$1',[user.identityId])).rows.map(row=>row.problem_id)):null;
  const items=[],lockedSchools=new Set(sourceSchools),topics=new Set(),progress=new Map();
  const loadProgress=async rows=>{
   for(const [schoolId,schoolRows] of rowsBySchool(rows)){
    await scope(db,schoolId);
    for(const [id,state] of await problemProgress(db,user,schoolRows.map(row=>row.id)))progress.set(id,state);
   }
  };
  const directedIds=courseOnly?[]:(await db.query(`SELECT DISTINCT audience.problem_id FROM platform_problem_audiences audience
   WHERE ${matchingProblemAudienceSql('$1')}`,[user.id])).rows.map(row=>row.problem_id);
  const directed=new Set(directedIds), scopedIds=new Set([...linkedPlatformIds,...directedIds]);
  let cursor=null;
  while(true){
   // Filter after rechecking the current published version and its scope.
   // Seek across publication batches so search also reaches older releases.
   const {rows}=await db.query(`WITH candidates AS (
    SELECT problem_id,school_id,approved_at FROM school_problem_publications
    WHERE withdrawn_at IS NULL AND ($3::uuid[] IS NULL OR problem_id=ANY($3))
    UNION ALL
    SELECT scoped.problem_id,b.catalog_scope_id AS school_id,'-infinity'::timestamptz FROM unnest($4::uuid[]) AS scoped(problem_id)
    JOIN problems source ON source.id=scoped.problem_id AND source.owner_scope='platform'
    JOIN problem_banks b ON b.id=source.bank_id
    WHERE ($3::uuid[] IS NULL OR scoped.problem_id=ANY($3)) AND NOT EXISTS (
     SELECT 1 FROM school_problem_publications publication WHERE publication.problem_id=scoped.problem_id AND publication.withdrawn_at IS NULL
    )
   )
   SELECT problem_id,school_id,approved_at::text AS approved_at FROM candidates
   WHERE $1::timestamptz IS NULL OR approved_at<$1 OR (approved_at=$1 AND problem_id>$2::uuid)
   ORDER BY candidates.approved_at DESC,problem_id LIMIT 100`,
   [cursor?.approved_at??null,cursor?.problem_id??null,problemIds,[...scopedIds]]);
   const current=await publicCatalogRows(db,rows,lockedSchools);
   const supplemental=rows.filter(row=>!current.has(row.problem_id)&&scopedIds.has(row.problem_id));
   for(const [schoolId,missing] of rowsBySchool(supplemental)){
    await scope(db,schoolId);
    for(const item of await platformProblemCatalogRows(db,missing.map(row=>row.problem_id))){
     const tags=Array.isArray(item.tags)?item.tags.filter(tag=>typeof tag==='string'&&tag.trim()):[];
     current.set(item.id,{...item,tags,courseRequired:!directed.has(item.id)});
    }
   }
   const candidates=[];
   for(const row of rows){
     const item=current.get(row.problem_id);
     if(!item||versions&&!versions.get(item.id)?.has(item.versionId))continue;
     const contexts=[...(courseFilter.byProblem.get(item.id)?.values()??[])].filter(context=>context.versionId===item.versionId);
     const course=courseId?contexts.find(context=>context.id===courseId):contexts[0];
     if((courseOnly||item.courseRequired)&&!course)continue;
     // Topic choices describe the entire accessible course/catalogue, even
     // when another filter or the current page contains no matching problems.
     for(const tag of item.tags)topics.add(tag);
     if(items.length>limit)continue;
     if(catalogQuery&&!`${item.id} ${item.title} ${item.bankName} ${item.tags.join(' ')} ${contexts.map(context=>context.title).join(' ')}`.toLowerCase().includes(catalogQuery))continue;
     if(filters.topic&&!item.tags.includes(filters.topic)||filters.mode&&item.mode!==filters.mode||favorites&&!favorites.has(item.id))continue;
     candidates.push({...item,courses:contexts.map(({id,title,localizations})=>({id,title,localizations})),
      ...((courseOnly||courseId||item.courseRequired)&&course&&{courseContext:{courseId:course.id,chapterId:course.chapterId}})});
   }
   // Only status filters need progress before pagination. The default route
   // still aggregates achievements for the displayed page alone.
   if(filters.status)await loadProgress(candidates);
   for(const item of candidates){
     if(filters.status&&(progress.get(item.id)?.status??'Not started')!==filters.status)continue;
     if(skip>0) skip--;
     else items.push(item);
     if(items.length>limit) break;
   }
   if(rows.length<100) break;
   cursor=rows.at(-1);
  }
  const visible=items.slice(0,limit);
  if(!filters.status)await loadProgress(visible);
  return {
   items:visible.map(item=>({attempts:progress.get(item.id)?.formalCount??0,solved:progress.get(item.id)?.solved===true,
    status:progress.get(item.id)?.status??'Not started',tags:item.tags,mode:item.mode,difficulty:item.difficulty,
    hasDraftChanges:item.hasDraftChanges,id:item.id,schoolId:item.schoolId,bankId:item.bankId,bankName:item.bankName,
    title:item.title,revision:item.revision,published:item.published,versionId:item.versionId,
    ...(item.courses.length&&{courses:item.courses}),...(item.courseContext&&{courseContext:item.courseContext}),
    canManage:false,canManageTutorial:false,validation:null})),
   topics:[...topics].sort((a,b)=>a.localeCompare(b)),filters,
   ...(includeCourses && { courseId, courses: courseFilter.courses }),
   ...(courseOnly && { fromCourse:true }),
   ...(page != null && { page, query, hasMore: items.length > limit }),
  };
}

async function decideProblemPublication(db, user, {schoolId, problemId, versionId: expectedVersion}, decision) {
 await scope(db,schoolId);
 if (await hasCatalogSource(db,schoolId,problemId)) {
  await decideCatalogPublicProblem(db,{schoolId,problemId,versionId:expectedVersion,decision,actorId:user.id});
  return;
 }
 const p=await loadProblem(db,schoolId,problemId,user,null,{publicOnly:true});
 const versionId = p.published_version_id;
 if ((decision !== 'withdraw' || expectedVersion) && uuid(expectedVersion)!==versionId)
  fail(409,'REVISION_CONFLICT','Review the current published version.');
 if (decision === 'withdraw') {
  await db.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE school_id=$1 AND problem_id=$2',[schoolId,problemId]);
 } else {
  const request = await db.query(`
   UPDATE school_problem_publication_requests SET status=$4,decided_by=$5,decided_at=clock_timestamp()
   WHERE school_id=$1 AND problem_id=$2 AND version_id=$3 AND status='pending'
  `, [schoolId,problemId,versionId,decision==='approve'?'approved':'rejected',user.id]);
  if (decision === 'reject' && !request.rowCount) fail(409,'NO_PENDING_REQUEST','No request is pending for this version.');
  if(decision==='approve'&&!(await db.query(`SELECT 1 FROM school_problems p WHERE p.school_id=$1 AND p.id=$2 AND ${publicExerciseAvailable}`,[schoolId,problemId])).rowCount)
   fail(409,'INELIGIBLE_FOR_PUBLIC_PRACTICE','Timed assessment problems cannot enter public practice.');
  if (decision === 'approve') await db.query(`
   INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by) VALUES($1,$2,$3,$4)
   ON CONFLICT(problem_id) DO UPDATE SET version_id=EXCLUDED.version_id,approved_by=EXCLUDED.approved_by,
     approved_at=clock_timestamp(),withdrawn_at=NULL
  `,[schoolId,problemId,versionId,user.id]);
 }
 await db.query('INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail) VALUES($1,$2,$3,$4)',[user.id,'problem.'+decision,schoolId,JSON.stringify({problemId,versionId})]);
}

async function importSchoolProblems(db, schoolId, user, role, body) {
 if (!['teacher','school_admin'].includes(role)) fail(403,'FORBIDDEN','需要本校教师权限');
 const key=uuid(body.idempotencyKey), bankId=body.bankId?uuid(body.bankId):null;
 const bankName=bankId?null:field(body.bankName,'题库名称',{max:120});
 if (!Array.isArray(body.problems) || !body.problems.length || body.problems.length>100 || Buffer.byteLength(JSON.stringify(body.problems))>2*1024*1024)
  fail(400,'VALIDATION','每批可导入 1–100 道题目，合计不超过 2 MB');
 const hash=canonicalHash({bankId,bankName,problems:body.problems});
 const old=(await db.query("SELECT actor_account_id,result FROM school_import_history WHERE school_id=$1 AND kind='problem_bank' AND id=$2",[schoolId,key])).rows[0];
 if (old) {
  if(old.actor_account_id!==user.id || old.result.requestHash!==hash) fail(409,'REQUEST_CONFLICT','导入请求已用于其他内容');
  return reply({importedCount:old.result.importedCount});
 }
 if (bankId) {
  const bank=(await db.query("SELECT * FROM school_problem_banks WHERE school_id=$1 AND id=$2 AND resource_kind='ordinary' AND NOT archived",[schoolId,bankId])).rows[0];
  if(!bank || !canManage(bank,user,role)) fail(404,'NOT_FOUND','目标题库不可用');
 }
 const definitions=body.problems.map((row,index)=>{
  if (!row || typeof row!=='object' || Array.isArray(row)) fail(400,'VALIDATION',`第 ${index+1} 行题目格式无效`);
  return normalizeSchoolProblem(row);
 });
 const destination=bankId??(await db.query('INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,$3,$4) RETURNING id',[schoolId,user.id,bankName,randomUUID()])).rows[0].id;
 for (const definition of definitions) await db.query('INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5)',
  [schoolId,destination,user.id,JSON.stringify(definition),randomUUID()]);
 const result={importedCount:definitions.length};
 await db.query("SELECT set_config('campus.account_id',$1,true)",[user.id]);
 await db.query(`INSERT INTO school_import_history(school_id,id,kind,actor_account_id,created_at,result,bank_id,filename)
  VALUES($1,$2,'problem_bank',$3,now(),$4,$5,$6)`,[schoolId,key,user.id,JSON.stringify({...result,requestHash:hash}),destination,field(body.filename??'','文件名',{min:0,max:1000})]);
 await auditSchool(db,schoolId,user.id,'school.problem.import',key);
 return reply(result,201);
}

export async function schoolPracticeOperation({pool,user,route,url,method,body={}}){
 route??=url.pathname.replace(/^\/api\/v1/,'');
 const shared=route.match(/^\/practice\/run-sharing(?:\/([^/]+)\/([^/]+))?$/);
 if(shared && (method==='GET' || method==='POST' && !shared[1]))
  return publicRunSharing({pool,user,url,method,body,detail:shared[1]?shared.slice(1):null});
 const history=route.match(/^\/schools\/([^/]+)\/submissions\/students\/([^/]+)(?:\/([^/]+))?$/);
 if(history && method==='GET')return studentJudgingHistory({pool,user,school:history[1],identity:history[2],record:history[3]?.replace(/%3a/i,':'),url});
 const isSubmission=method==='POST'&&/^\/practice\/problems\/[^/]+\/submissions$/.test(route);
 const courseContext=isSubmission?{courseId:body.courseId,chapterId:body.chapterId,versionId:body.versionId}
  :{courseId:body.courseId??url?.searchParams.get('courseId'),chapterId:body.chapterId??url?.searchParams.get('chapterId'),versionId:body.versionId??url?.searchParams.get('versionId')};
 const loadPublic=(db,user,id)=>publicLoaded(db,user,id,courseContext,isSubmission);
 const audience=await handlePlatformProblemAudiences({pool,user,route,url,method,body});
 if(audience)return audience;
 const scholarship=await publicScholarshipOperation({pool,user,route,url,method,body},loadPublic);
 if(scholarship)return scholarship;
 if(route==='/practice/leaderboard'&&method==='GET')return publicPracticeLeaderboard({pool,user,url});
 const personalRecords = await handlePublicPracticeRecords({pool,user,route,url,method,body}, projectJob);
 if (personalRecords) return personalRecords;
 const catalogRequest = await handleCatalogPublicProblemRequest({pool,user,route,url,method,body});
 if (catalogRequest) return catalogRequest;
 if(route==='/practice/problems'&&method==='GET')return reply(await listPublicProblems(pool,user,url));
 const pub=route.match(/^\/practice\/problems\/([^/]+)(?:\/submissions(?:\/([^/]+))?)?$/);
 if(pub)return transaction(pool,async db=>{
  const p=await loadPublic(db,user,pub[1]);
  const expectedVersion=method==='POST'?body.versionId:url?.searchParams.get('versionId');
  if(expectedVersion!=null){
   const requested=uuid(expectedVersion).toLowerCase();
   if(requested!==p.published_version_id&&p.catalog_source&&!(await db.query(
    'SELECT 1 FROM problem_versions WHERE id=$1 AND problem_id=$2 AND published_at IS NOT NULL',[requested,p.id])).rowCount)
    fail(404,'NOT_FOUND','This version is not available.');
   if(requested!==p.published_version_id&&!p.catalog_source&&!(await db.query(`SELECT 1
    FROM school_problem_versions requested JOIN school_problem_versions current ON current.school_id=requested.school_id
     AND current.problem_id=requested.problem_id AND current.id=$4
    WHERE requested.school_id=$1 AND requested.problem_id=$2 AND requested.id=$3
     AND requested.draft_revision<=current.draft_revision`,[p.school_id,p.id,requested,p.published_version_id])).rowCount)
    fail(404,'NOT_FOUND','This version is not available.');
   if(method==='POST')assertLiveProblemVersion(requested,p.published_version_id);
  }
  await schoolActivityProblemAccess(db,{schoolId:p.school_id,problemId:p.id,user});
  if(method==='GET'&&!route.includes('/submissions'))return reply(await shapeProblem(db,p,user,null,{detail:true,publicOnly:true,accessContext:'public'}));
  if(method==='GET'&&route.endsWith('/submissions'))return reply(await schoolProblemSubmissions(db,p,user,url,'public',{
   workspaceSchoolId:url.searchParams.get('workspaceSchoolId'),
  }));
  if(method==='GET'&&pub[2]){const job=(await db.query("SELECT * FROM school_judge_jobs WHERE school_id=$1 AND id=$2 AND account_id=$3 AND problem_id=$4 AND access_context='public'",[p.school_id,uuid(pub[2]),user.id,p.id])).rows[0];if(!job)fail(404,'NOT_FOUND','Submission not found.');return reply(await projectJob(db,job));}
  if(method==='POST'&&route.endsWith('/submissions')){const version=(await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND id=$2',[p.school_id,p.published_version_id])).rows[0];return reply(await enqueue(db,{schoolId:p.school_id,p,version,user,kind:enumValue(body.kind,['samples','custom','submit'],'Run type'),body,accessContext:'public'}),202);}
  return null;
 });
 if(route==='/platform/problem-publications'||/^\/platform\/problem-publications\/[^/]+(?:\/(withdraw|reject))?$/.test(route))return transaction(pool,async db=>{
  await activeAccount(db,user.id);if(!await isPlatformAdministrator(db,user.id))fail(403,'FORBIDDEN','Platform administrator required.');
  if(method==='POST') await lockPlatformContent(db);
  if(method==='GET'&&route!=='/platform/problem-publications'){
   const schoolId=uuid(url.searchParams.get('schoolId')),problemId=uuid(route.split('/')[3]);await scope(db,schoolId);
   if (await hasCatalogSource(db,schoolId,problemId)) return reply(await previewCatalogPublicProblem(db,problemId));
   const p=await loadProblem(db,schoolId,problemId,user,null,{publicOnly:true});
   return reply({...await shapeProblem(db,p,user,null,{detail:true,publicOnly:true,accessContext:'public'}),...await publicProblemStatus(db,p,p.published_version_id)});
  }
  if(method==='GET'){
   const items=[];
   const {rows:schools}=await db.query("SELECT storage.id,coalesce(s.name,'CodeMaster') name FROM practice_storage_scopes storage LEFT JOIN schools s ON s.id=storage.school_id ORDER BY name,storage.id");
   for(const school of schools){
    await scope(db,school.id);
    const {rows:problems}=await db.query(`SELECT p.*,b.name AS bank_name FROM school_problems p
     JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
     WHERE b.resource_kind='ordinary' AND p.school_id=$1 AND p.published AND NOT b.archived`,[school.id]);
    for(const p of problems){
     const item=await shapeProblem(db,p,user,null,{publicOnly:true,accessContext:'public'});
     items.push({...item,schoolName:school.name,...await publicProblemStatus(db,p,p.published_version_id)});
    }
    items.push(...await listCatalogPublicProblemReviews(db,school.id));
   }
   return reply({items});
  }
  if(method==='POST'&&route==='/platform/problem-publications/batch'){
   const decision = enumValue(body.decision,['approve','reject','withdraw'],'Review decision');
   if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)
    fail(400,'VALIDATION','Select 1–100 problems to review.');
   const items = body.items.map(item=>({
    schoolId:uuid(item?.schoolId,'School ID').toLowerCase(),
    problemId:uuid(item?.problemId,'Problem ID').toLowerCase(),
    versionId:uuid(item?.versionId,'Version ID').toLowerCase(),
   }));
   if(new Set(items.map(item=>item.problemId)).size!==items.length)
    fail(400,'VALIDATION','Select each problem only once.');
   // Match the single-review school lock order and hold all locks through commit.
   for(const schoolId of [...new Set(items.map(item=>item.schoolId))].sort()) await lockSchoolTeaching(db,schoolId);
   for(const item of items) {
    try { await decideProblemPublication(db,user,item,decision); }
    catch(error) {
     if(error instanceof HttpError) fail(error.status,error.code,`${item.problemId.slice(0,8)}: ${error.message}`);
     throw error;
    }
   }
   return reply({reviewedCount:items.length});
  }
  if(method==='POST'){
   const schoolId=uuid(body.schoolId),problemId=uuid(body.problemId??route.split('/')[3]);await lockSchoolTeaching(db,schoolId);
   const decision = route.endsWith('/withdraw') ? 'withdraw' : route.endsWith('/reject') ? 'reject' : 'approve';
   await decideProblemPublication(db,user,{schoolId,problemId,versionId:body.versionId},decision);
   return reply({ok:true});
  }return null;
 });
 const m=route.match(/^\/schools\/([^/]+)\/(problem-banks|problems|judge-status|judge-jobs|submissions|review-notebook)(?:\/([^/]+)(?:\/(validate|publish|unpublish|archive|restore|submissions|public-request|tutorial|note))?)?$/);
 if(!m)return null;const schoolId=uuid(m[1]);
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,schoolId,{shared:method==='GET'});const role=await schoolRole(db,schoolId,user.id);await scope(db,schoolId);
  if (m[2]==='problems' && m[3]==='import' && !m[4] && method==='POST') return importSchoolProblems(db,schoolId,user,role,body);
  if(m[2]==='judge-jobs'&&m[3]&&(method==='GET'&&!m[4]||method==='PATCH'&&m[4]==='note')){
   await db.query("SELECT set_config('campus.account_id',$1,true)",[user.id]);
   const historical=/^SUB[1-9][0-9]{0,17}$/.test(m[3]),id=historical?m[3].slice(3):uuid(m[3]);
   const column=historical?'submission_id':'job_id';
   let record;
   if(historical)record=await ownSchoolReceipt(db,schoolId,user.id,id);
   else{
    const job=(await db.query("SELECT * FROM school_judge_jobs WHERE school_id=$1 AND id=$2 AND account_id=$3 AND access_context NOT IN ('assignment_preview','acsl')",[schoolId,id,user.id])).rows[0];
    if(!job)fail(404,'NOT_FOUND','Submission not found.');
    record=await projectJob(db,job);
    if(job.activity_id && job.kind==='submit' && record.resultsVisible) record.reviews=(await db.query(
     'SELECT note,created_at AS "createdAt" FROM school_assignment_feedback WHERE school_id=$1 AND job_id=$2 ORDER BY created_at,id',[schoolId,job.id])).rows;
   }
   if(method==='PATCH'){
    if(!record.resultsVisible||record.state!=='completed')fail(409,'UNAVAILABLE','成绩公布后可订正');
    const note=field(body.note??'','订正笔记',{min:0,max:10000});
    await db.query(`INSERT INTO school_submission_notes(school_id,account_id,${column},note) VALUES($1,$2,$3,$4)
     ON CONFLICT(school_id,account_id,${column}) DO UPDATE SET note=EXCLUDED.note,updated_at=clock_timestamp()`,[schoolId,user.id,id,note]);
    return reply({note});
   }
   const saved=record.resultsVisible?(await db.query(`SELECT note,updated_at AS "noteUpdatedAt" FROM school_submission_notes WHERE school_id=$1 AND account_id=$2 AND ${column}=$3`,[schoolId,user.id,id])).rows[0]:null;
   return reply({...record,...saved});
  }
  const id=m[3]?uuid(m[3]):null;
  if(m[2]==='review-notebook'&&method==='GET'&&id){
   await db.query("SELECT set_config('campus.account_id',$1,true)",[user.id]);
   const record=(await db.query(`SELECT 'SUB'||s.id AS "submissionId" FROM review_entries r JOIN submissions s ON s.id=r.submission_id
    ${receiptActivityJoin} WHERE r.id=$3 AND s.school_id=$1 AND s.account_id=$2 AND ${receiptVisible}`,[schoolId,user.id,id])).rows[0];
   if(!record)fail(404,'NOT_FOUND','Review entry not found.');
   return reply(record);
  }
  if(m[2]==='submissions'&&method==='GET'&&!id){
   await db.query("SELECT set_config('campus.account_id',$1,true)",[user.id]);
   const page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page');
   const notebook=url.searchParams.get('view')==='review';
   const verdict=url.searchParams.get('status'),context=url.searchParams.get('context'),review=url.searchParams.get('reviewState');
   const rows=(await db.query(`WITH records AS (
    SELECT j.id::text,j.problem_id,j.payload->'version'->>'title' AS title,j.payload->>'language' AS language,j.state,j.created_at,
     coalesce(j.result->>'status',CASE j.state WHEN 'failed' THEN 'System Error' WHEN 'leased' THEN 'Judging' ELSE 'Waiting' END) status,
     j.result->>'score' score,coalesce(a.kind,'practice') context,greatest(n.updated_at,f.created_at) note_at,f.note AS feedback,NULL::text correction,
     (j.result->>'status' IN ('WA','CE','RE','TLE','MLE','OLE') OR n.note<>'' OR f.note IS NOT NULL) in_notebook
    FROM school_judge_jobs j LEFT JOIN school_activities a ON (a.school_id,a.id)=(j.school_id,j.activity_id)
    LEFT JOIN school_submission_notes n ON (n.school_id,n.job_id,n.account_id)=(j.school_id,j.id,j.account_id)
    LEFT JOIN LATERAL (SELECT note,created_at FROM school_assignment_feedback WHERE $4 AND school_id=j.school_id AND job_id=j.id ORDER BY created_at DESC,id DESC LIMIT 1) f ON true
    WHERE ${schoolActivityJobVisibleSql('j')} AND j.school_id=$1 AND j.account_id=$2 AND j.access_context IN ('school','staff_practice') AND j.kind='submit'
    UNION ALL SELECT 'SUB'||s.id,s.problem_id,v.title,s.language,
     CASE s.status WHEN 'Waiting' THEN 'queued' WHEN 'Judging' THEN 'leased' ELSE 'completed' END,s.created_at,
     CASE WHEN ${receiptVisible} THEN s.status ELSE 'Submitted' END,CASE WHEN ${receiptVisible} THEN s.score::text END,
     CASE WHEN s.kind='correction' THEN 'correction' WHEN s.assignment_id IS NOT NULL THEN 'assignment' WHEN ta.id IS NOT NULL THEN 'timed' ELSE 'practice' END,
     greatest(note.updated_at,feedback.created_at,correction.created_at),
     CASE WHEN ${receiptVisible} THEN feedback.note END,CASE WHEN ${receiptVisible} THEN correction.status END,
     ${receiptVisible} AND s.kind='submit' AND (s.status IN ('WA','CE','RE','TLE','MLE','OLE') OR note.note<>'' OR EXISTS(SELECT 1 FROM review_entries r WHERE r.submission_id=s.id))
     FROM submissions s JOIN problem_versions v ON v.id=s.version_id ${receiptActivityJoin}
     LEFT JOIN school_submission_notes note ON (note.school_id,note.submission_id,note.account_id)=(s.school_id,s.id,s.account_id)
     LEFT JOIN LATERAL (SELECT r.note,r.created_at FROM review_entries r WHERE $4 AND r.submission_id=s.id AND r.author_account_id<>s.account_id
       ORDER BY r.created_at DESC,r.id DESC LIMIT 1) feedback ON true
     LEFT JOIN LATERAL (SELECT c.status,c.created_at FROM submissions c WHERE $4 AND c.original_submission_id=s.id AND c.kind='correction'
       AND (c.school_id,c.account_id)=(s.school_id,s.account_id) AND c.timed_attempt_id IS NULL ORDER BY c.created_at DESC,c.id DESC LIMIT 1) correction ON true
     WHERE s.school_id=$1 AND s.account_id=$2 AND s.kind IN ('submit','correction')
   ) SELECT * FROM records WHERE (NOT $4 OR in_notebook)
    AND ($5::text IS NULL OR status=$5) AND ($6::text IS NULL OR context=$6)
    AND ($7::text IS NULL OR CASE WHEN status='AC' AND feedback IS NOT NULL THEN 'feedback'
      WHEN status='AC' OR correction='AC' THEN 'resolved' WHEN correction IS NOT NULL THEN 'retried' ELSE 'needs-review' END=$7)
    ORDER BY CASE WHEN $4 THEN greatest(note_at,created_at) ELSE created_at END DESC,id LIMIT 26 OFFSET $3`,
    [schoolId,user.id,(page-1)*25,notebook,verdict,context,review])).rows;
   return reply({page,hasMore:rows.length>25,items:rows.slice(0,25).map(j=>({id:j.id,problemId:j.problem_id,problemTitle:j.title,
    language:j.language,state:j.state,createdAt:j.created_at,status:j.status,score:j.score===null?null:Number(j.score),context:j.context,
    ...(notebook?{feedback:j.feedback,correctionStatus:j.correction,noteUpdatedAt:j.note_at}:{})}))});
  }
  if(m[2]==='judge-status'&&method==='GET'){
   if(role!=='school_admin')fail(403,'FORBIDDEN','School administrator required.');
   const counts=(await db.query("SELECT count(*) FILTER(WHERE state='queued')::integer AS queued,count(*) FILTER(WHERE state='leased')::integer AS running,count(*) FILTER(WHERE state='failed')::integer AS failed,count(*) FILTER(WHERE state='completed')::integer AS completed FROM school_judge_jobs WHERE school_id=$1",[schoolId])).rows[0];
   const ready=(await db.query("SELECT EXISTS(SELECT 1 FROM judge_nodes WHERE executor_ready AND heartbeat_at>now()-interval '45 seconds') AS ready")).rows[0].ready;return reply({...counts,ready});
  }
  if(m[2]==='problem-banks'){
   if(method==='GET'){return reply({items:(await db.query(`SELECT id,name,revision,archived,owner_account_id=$2 OR $3='school_admin' AS "canManage" FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND ($3='school_admin' OR owner_account_id=$2 OR NOT archived AND EXISTS(SELECT 1 FROM school_problems p WHERE p.school_id=$1 AND p.bank_id=school_problem_banks.id AND p.published)) ORDER BY name,id`,[schoolId,user.id,role])).rows});}
   if(!['teacher','school_admin'].includes(role))fail(403,'FORBIDDEN','Teaching role required.');
   if(method==='POST'&&!id){const name=field(body.name,'Bank name',{max:120}),requestId=uuid(body.requestId);const old=(await db.query('SELECT * FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND owner_account_id=$2 AND request_id=$3',[schoolId,user.id,requestId])).rows[0];if(old){if(old.name!==name)fail(409,'REQUEST_CONFLICT','Request ID already used.');return reply(old);}const bank=(await db.query('INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,$3,$4) RETURNING id,name,revision,archived',[schoolId,user.id,name,requestId])).rows[0];await auditSchool(db,schoolId,user.id,'school.bank.create',bank.id);return reply(bank,201);}
   if(method==='PATCH'&&id){const bank=(await db.query('SELECT * FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND id=$2 FOR UPDATE',[schoolId,id])).rows[0];if(!bank||!canManage(bank,user,role))fail(404,'NOT_FOUND','Bank unavailable.');revision(body,bank);const name=field(body.name??bank.name,'Bank name',{max:120});const archived=body.archived??bank.archived;if(typeof archived!=='boolean')fail(400,'VALIDATION','Invalid archive flag.');await db.query('UPDATE school_problem_banks SET name=$3,archived=$4,revision=revision+1 WHERE school_id=$1 AND id=$2',[schoolId,id,name,archived]);await auditSchool(db,schoolId,user.id,'school.bank.update',id);return reply({id,name,archived,revision:bank.revision+1});}return null;
  }
  if(m[2]!=='problems')return null;
  if(method==='GET'&&!id){
   if (role !== 'student' && url.searchParams.get('view') === 'management') return reply(await schoolBankDirectory(db,schoolId,user.id,role));
   const bankId = url.searchParams.get('bankId');
   if (bankId) uuid(bankId);
   const { courseId, includeCourses } = problemCatalogCourseRequest(url);
   const courseFilter = role === 'student' && includeCourses
    ? await schoolProblemCatalogCourses(db, schoolId, user, role, courseId) : null;
   const includePlatform = role === 'student' && (!bankId || includeCourses);
   const sourceSchools = includePlatform ? await lockCatalogProblemSchools(db,null,{shared:true}) : [];
   const platform = includePlatform
    ? await publicProblemCatalogCourses(db,user,courseId,{schoolId}) : null;
   // Course admission checks can switch the connection to the course's source school.
   if (platform) await scope(db,schoolId);
   const links = courseId && courseFilter
    ? [...courseFilter.versions, ...platform.versions].flatMap(([problemId, versions]) =>
        [...versions].map(versionId => ({ problemId, versionId }))) : null;
   const { rows } = await db.query(`SELECT p.*,b.name AS bank_name,b.archived,
      EXISTS(SELECT 1 FROM problems original WHERE original.id=p.id AND original.owner_scope='platform') platform_owned
    FROM school_problems p JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
    WHERE b.resource_kind='ordinary' AND p.school_id=$1 AND ($4::uuid IS NULL OR p.bank_id=$4)
      AND ($3='school_admin' OR p.owner_account_id=$2 AND $3='teacher' OR p.published AND NOT b.archived)
      AND ($5::jsonb IS NULL OR EXISTS (
       SELECT 1 FROM jsonb_to_recordset($5::jsonb) link("problemId" uuid,"versionId" uuid)
       WHERE link."problemId"=p.id AND link."versionId"=p.published_version_id
      ))
    ORDER BY p.created_at,p.id LIMIT 500`, [schoolId, user.id, role, bankId, links && JSON.stringify(links)]);
   const items = [];
   for (const p of rows) {
    const item = await shapeProblem(db,p,user,role);
    const selected = platform?.byProblem.get(item.id)?.get(courseId);
    if (selected && selected.versionId === item.versionId) {
     item.courseContext = {courseId,chapterId:selected.chapterId};
    }
    items.push(item);
   }
   if (platform?.byProblem.size && !bankId && (!courseId || platform.versions.size)) {
    const linked = await readPracticeCatalog(db,user,platform,sourceSchools,{courseId,courseOnly:true,limit:Infinity});
    const localIds = new Set(items.map(item => item.id));
    items.push(...linked.items.filter(item => !localIds.has(item.id)));
   }
   const courses = courseFilter && [...new Map([...courseFilter.courses,...platform.courses].map(course=>[course.id,course])).values()];
   return reply({ ...(courses && {courseId,courses}), items });
  }
  if(method==='POST'&&!id){if(!['teacher','school_admin'].includes(role))fail(403,'FORBIDDEN','Teaching role required.');const bankId=uuid(body.bankId),bank=(await db.query('SELECT * FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND id=$2',[schoolId,bankId])).rows[0];if(!bank||bank.archived||!canManage(bank,user,role))fail(404,'NOT_FOUND','Bank unavailable.');const requestId=uuid(body.requestId),old=(await db.query('SELECT * FROM school_problems WHERE school_id=$1 AND owner_account_id=$2 AND request_id=$3',[schoolId,user.id,requestId])).rows[0];const definition=normalizeSchoolProblem(body);if(old){if(old.bank_id!==bankId||canonicalHash(draftDefinition(old.draft))!==canonicalHash(draftDefinition(definition)))fail(409,'REQUEST_CONFLICT','Request ID already used.');return reply(await shapeProblem(db,await loadProblem(db,schoolId,old.id,user,role),user,role,{detail:true}));}const p=(await db.query('INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[schoolId,bankId,user.id,JSON.stringify(definition),requestId])).rows[0];await auditSchool(db,schoolId,user.id,'school.problem.create',p.id);return reply(await shapeProblem(db,await loadProblem(db,schoolId,p.id,user,role),user,role,{detail:true}),201);}
  if(!id)return null;const p=await loadProblem(db,schoolId,id,user,role);
  if(m[4]==='tutorial'&&['GET','PATCH'].includes(method)){
   if(method==='PATCH'||url.searchParams.get('manage')==='true'){
    if(!canManageTutorial(p,user,role))fail(403,'FORBIDDEN','You cannot edit this problem’s tutorial.');
    return reply(method==='GET'?tutorialSettings(p):await saveTutorial(db,p,body,
     metadata=>auditSchool(db,schoolId,user.id,'school.problem.tutorial_update',p.id,metadata)));
   }
   await schoolActivityProblemAccess(db,{schoolId,problemId:p.id,user});
   const requested=url.searchParams.get('versionId');
   if(!p.published||p.archived||requested&&uuid(requested)!==p.published_version_id)return reply({tutorial:null});
   return reply({tutorial:p.tutorial_mode==='course'?await schoolCourseTutorial(db,p,user,role,url):customTutorial(p)});
  }
  if (method === 'POST' && m[4] === 'public-request') {
   if (role !== 'school_admin') fail(403,'FORBIDDEN','School administrator required.');
   if (!p.published || p.archived || uuid(body.versionId) !== p.published_version_id)
    fail(409,'REVISION_CONFLICT','Submit the current published version for review.');
   const state = await publicProblemStatus(db,p,p.published_version_id);
   if (state.platformPublished) return reply(state);
   const requested = await db.query(`
    INSERT INTO school_problem_publication_requests(school_id,problem_id,version_id,requested_by)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(school_id,problem_id,version_id) DO UPDATE SET status='pending',
      requested_by=EXCLUDED.requested_by,requested_at=clock_timestamp(),decided_by=NULL,decided_at=NULL
    WHERE school_problem_publication_requests.status<>'pending'
   `,[schoolId,id,p.published_version_id,user.id]);
   if (requested.rowCount) await auditSchool(db,schoolId,user.id,'school.problem.public_request',id,{versionId:p.published_version_id});
   return reply({platformPublished:false,publicRequestStatus:'pending'});
  }
  if(method==='GET'||m[4]==='submissions')await schoolActivityProblemAccess(db,{schoolId,problemId:p.id,user});
  if(method==='GET'&&m[4]==='submissions'){
   const includePlatform=role==='student' && url.searchParams.get('includePlatform')==='1'
    && (await db.query('SELECT 1 FROM school_problem_publications WHERE school_id=$1 AND problem_id=$2 AND withdrawn_at IS NULL',[schoolId,p.id])).rowCount>0;
   return reply(await schoolProblemSubmissions(db,p,user,url,practiceContext(role),{includePlatform}));
  }
  if(method==='GET'){const practice=url.searchParams.get('view')==='practice';if(practice&&(!p.published||p.archived))fail(404,'NOT_FOUND','Problem unavailable.');return reply(await shapeProblem(db,p,user,role,{detail:true,publicOnly:practice}));}
  if(m[4]==='submissions'&&method==='POST'){
   if(body.versionId!=null)assertLiveProblemVersion(uuid(body.versionId).toLowerCase(),p.published_version_id);
   if(!p.published||p.archived)fail(409,'NOT_PUBLISHED','Publish the problem before student practice.');
   const version=(await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND id=$2',[schoolId,p.published_version_id])).rows[0];return reply(await enqueue(db,{schoolId,p,version,user,role,kind:enumValue(body.kind,['samples','custom','submit'],'Run type'),body,accessContext:practiceContext(role)}),202);
  }
  if(!canManage(p,user,role))fail(403,'FORBIDDEN','You cannot manage this problem.');revision(body,p);
  if (method==='POST' && ['archive','restore'].includes(m[4])) {
   if (role!=='school_admin') fail(403,'FORBIDDEN','需要本校管理员权限');
   const archive=m[4]==='archive';
   if (archive===Boolean(p.archived_at)) return reply({id,archived:archive});
   if (p.archived) fail(409,'BANK_ARCHIVED','请先恢复题库');
   if (archive) {
    const {rows:[refs]}=await db.query(`SELECT
     EXISTS(SELECT 1 FROM school_activity_problems l JOIN school_activities a ON (a.school_id,a.id)=(l.school_id,l.activity_id)
      WHERE l.school_id=$1 AND l.problem_id=$2 AND a.kind='timed' AND a.state<>'Archived')
     OR EXISTS(SELECT 1 FROM school_courses c JOIN school_course_publications v
      ON (v.school_id,v.course_id,v.revision)=(c.school_id,c.id,c.published_revision)
      WHERE c.school_id=$1 AND c.published AND c.archived_at IS NULL AND v.chapters @> $3::jsonb)
     OR EXISTS(SELECT 1 FROM school_problem_publications WHERE school_id=$1 AND problem_id=$2 AND withdrawn_at IS NULL) AS blocked`,
     [schoolId,id,JSON.stringify([{problems:[{problemId:id}]}])]);
    if(refs.blocked) fail(409,'PROBLEM_IN_USE','请先处理引用此题的已发布课程、有效限时训练或平台公开版本');
   }
   await db.query(`UPDATE school_problems SET published=false,archived_at=CASE WHEN $3 THEN now() END,
    revision=revision+1 WHERE school_id=$1 AND id=$2`,[schoolId,id,archive]);
   await auditSchool(db,schoolId,user.id,'school.problem.'+m[4],id);
   return reply({id,archived:archive});
  }
  if(p.archived_at)fail(409,'PROBLEM_ARCHIVED','请先恢复已归档题目');
  if(method==='PATCH'&&!m[4]){const definition=normalizeSchoolProblem(body,p.draft);await db.query('UPDATE school_problems SET draft=$3,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[schoolId,id,JSON.stringify(definition)]);await auditSchool(db,schoolId,user.id,'school.problem.update',id);return reply(await shapeProblem(db,await loadProblem(db,schoolId,id,user,role),user,role,{detail:true}));}
  if(method==='POST'&&m[4]==='validate'){
   const previous=(await db.query('SELECT id FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 ORDER BY (id=$3) DESC NULLS LAST,draft_revision DESC LIMIT 1',[schoolId,id,p.published_version_id])).rows[0];
   const version=previous??(await db.query('INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,$3,$4) RETURNING id',[schoolId,id,p.revision,JSON.stringify(p.draft)])).rows[0];
   return reply(await enqueue(db,{schoolId,p,version:{...version,definition:p.draft},user,kind:'validation',body:{...body,language:p.draft.reference_language??'python'},accessContext:'school'}),202);
  }
  if(method==='POST'&&m[4]==='publish'){
   if(role!=='school_admin')fail(403,'FORBIDDEN','School administrator review is required.');
   const version=(await db.query(`SELECT j.version_id id FROM school_judge_jobs j WHERE j.school_id=$1 AND j.problem_id=$2 AND j.validation_revision=$3
    AND j.kind='validation' AND j.state='completed' AND j.result->>'status'='AC'
    AND ($4::uuid IS NULL OR j.version_id=$4) ORDER BY j.created_at DESC LIMIT 1`,[schoolId,id,p.revision,p.published_version_id])).rows[0];
   if(!version)fail(409,'VALIDATION_REQUIRED','The current reference must pass every formal and sample test before publication.');
   await db.query('UPDATE school_problem_versions SET definition=$3,draft_revision=$4 WHERE school_id=$1 AND id=$2',[schoolId,version.id,JSON.stringify(p.draft),p.revision]);
   await db.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[schoolId,id,version.id]);await auditSchool(db,schoolId,user.id,'school.problem.publish',id);
  }else if(method==='POST'&&m[4]==='unpublish'){await db.query('UPDATE school_problems SET published=false WHERE school_id=$1 AND id=$2',[schoolId,id]);await auditSchool(db,schoolId,user.id,'school.problem.unpublish',id);}else return null;
  return reply(await shapeProblem(db,await loadProblem(db,schoolId,id,user,role),user,role,{detail:true}));
 });
}
