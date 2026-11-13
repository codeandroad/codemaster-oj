import { problemCatalogCourseRequest } from './problem-catalog-courses.mjs';
import { platformCourseProblem } from './platform-course-problems.mjs';
import {publicScholarshipOperation,recordPublicPracticeStaffExposure} from './public-scholarship.mjs';
import { schoolActivityJobVisibleSql, schoolActivityProblemAccess, schoolJobFeedback } from './school-activities.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { activeAccount, auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { bytes, canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';
import { validateTask } from '../judge.mjs';
import { schoolProblemSubmissions } from './problem-submissions.mjs';
import { publicProblemMetadata } from './problem-public-statements.mjs';
import { handlePublicPracticeRecords } from './public-practice-records.mjs';
import { publicPracticeLeaderboard } from './public-practice-leaderboard.mjs';
import { customTutorial, saveTutorial, tutorialContext, tutorialSettings } from './problem-tutorials.mjs';
import { loadSchoolCourse, schoolCourseProblemLanguage, schoolProblemCatalogCourses } from './school-courses.mjs';
import { publicCourseProblemLanguage, publicProblemCatalogCourses } from './public-learning.mjs';
import { assertRequiredLanguage } from './course-language-policy.mjs';
import { LANGUAGES, starterCodesFor } from './languages.mjs';
import {
 decideLegacyPublicProblem, handleLegacyPublicProblemRequest, legacyPublicProblemPresentation,
 listLegacyPublicProblemReviews, previewLegacyPublicProblem,
} from './legacy-public-problems.mjs';

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
  ORDER BY (c.id=$3) DESC NULLS LAST,c.id`,[problem.school_id,JSON.stringify([{problems:[link]}]),courseId]);
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

export function normalizeSchoolProblem(body){
 const mode=enumValue(body.mode??'stdio',['stdio','function'],'Mode');
 const definition={title:field(body.title,'Title',{max:200}),statement:field(body.statement,'Statement',{max:100000,trim:false}),mode,
  function_name:mode==='function'?field(body.functionName??'solve','Function name',{max:80}):null,
  comparator:mode==='function'?'json':enumValue(body.comparator??'tokens',['tokens','exact','json'],'Comparator'),
  time_limit_ms:integer(body.timeLimitMs??1000,100,5000,'Time limit'),memory_limit_mb:integer(body.memoryLimitMb??128,32,256,'Memory limit'),
  reference_code:bytes(body.referenceCode,'Reference code'),starter_code:bytes(body.starterCode??(mode==='function'?'def solve(data):\n    pass\n':'# Read input and print the result.\n'),'Starter code'),samples:[],tests:[]};
 for(const key of ['samples','tests']){
  if(!Array.isArray(body[key])||body[key].length<1||body[key].length>(key==='samples'?20:100))fail(400,'VALIDATION',`${key} must contain 1–${key==='samples'?20:100} cases.`);
  definition[key]=body[key].map((t,i)=>({id:randomUUID(),position:i+1,input:bytes(t?.input,`${key} input`,262144),expected:bytes(t?.expected,`${key} expected`,262144),...(key==='tests'?{weight:Number(t.weight)}:{enabled:true})}));
 }
 if(Buffer.byteLength(JSON.stringify(definition))>2000000)fail(413,'TOO_LARGE','Problem package exceeds 2 MB.');
 try{validateTask({kind:'validation',version:definition,language:'python',code:definition.reference_code,tests:definition.tests});validateTask({kind:'samples',version:definition,language:'python',code:definition.reference_code,tests:definition.samples});}
 catch{fail(400,'INVALID_CASES','Check function name, JSON cases and positive formal test weights totaling 100.');}
 return definition;
}
const publicDefinition=v=>({title:v.title,statement:v.statement,mode:v.mode,functionName:v.function_name,comparator:v.comparator,
 ...publicProblemMetadata(v.metadata),tags:Array.isArray(v.tags)?v.tags.filter(tag=>typeof tag==='string'):[],
 timeLimitMs:v.time_limit_ms,memoryLimitMb:v.memory_limit_mb,starterCode:v.starter_code,
 starterCodes:starterCodesFor(v),
 samples:v.samples.map(t=>({input:t.input,expected:t.expected}))});
const draftDefinition=v=>({...publicDefinition(v),referenceCode:v.reference_code,tests:v.tests.map(t=>({input:t.input,expected:t.expected,weight:t.weight}))});
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
 if(catalogQuery && !`${p.id} ${def.title} ${p.bank_name}`.toLowerCase().includes(catalogQuery)) return null;
 const validation=manage?(await db.query(`SELECT j.id,j.state,j.result->>'status' AS status FROM school_judge_jobs j JOIN school_problem_versions v ON v.school_id=j.school_id AND v.id=j.version_id WHERE j.school_id=$1 AND j.problem_id=$2 AND v.draft_revision=$3 AND j.kind='validation' ORDER BY j.created_at DESC LIMIT 1`,[p.school_id,p.id,p.revision])).rows[0]:null;
 const progressIdentity=accessContext==='school'?(await db.query('SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2',[p.school_id,user.id])).rows[0]?.id??null:null;
 const progress=(await db.query(`SELECT count(*)::integer AS attempts,bool_or(state='completed' AND result->>'status'='AC') AS solved FROM school_judge_jobs j
  WHERE ${schoolActivityJobVisibleSql('j')} AND school_id=$1 AND problem_id=$2 AND kind='submit' AND version_id=$4
   AND (access_context=$5 OR $5='staff_practice' AND access_context='school' AND activity_id IS NULL)
   AND CASE WHEN $5 IN ('public','staff_practice') THEN account_id=$3 WHEN $6::uuid IS NOT NULL THEN identity_id=$6 ELSE identity_id IS NULL AND account_id=$3 END`,
 [p.school_id,p.id,user.id,version?.id??null,accessContext,progressIdentity])).rows[0];
 const publication = !publicOnly && role === 'school_admin' && version && p.published && !p.archived
  ? await publicProblemStatus(db, p, version.id) : undefined;
 return {attempts:progress.attempts,solved:progress.solved===true,hasDraftChanges:!!version&&version.draft_revision!==p.revision,id:p.id,schoolId:p.school_id,bankId:p.bank_id,bankName:p.bank_name,title:def.title,revision:p.revision,published:p.published,versionId:version?.id??null,canManage:manage,canManageTutorial:!publicOnly&&canManageTutorial(p,user,role),validation:validation??null,...publication,...(detail?{staffPractice:accessContext==='staff_practice',definition:manage?draftDefinition(def):publicDefinition({...def,statement:p.public_statement??def.statement,metadata:p.public_metadata??def.metadata,tags:p.public_tags??def.tags})}:{})};
}
async function publicProblemStatus(db, problem, versionId) {
 const { rows: [state] } = await db.query(`
  SELECT EXISTS(SELECT 1 FROM school_problem_publications WHERE school_id=$1 AND problem_id=$2 AND version_id=$3
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
 const requestHash=canonicalHash({problemId:p.id,versionId:version.id,kind,language,code,customInput,accessContext,...course,...(preview&&{coursePreview:true})});
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-submit:'||$1,0))",[user.id]);
 const old=(await db.query('SELECT * FROM school_judge_jobs WHERE account_id=$1 AND request_id=$2',[user.id,requestId])).rows[0];
 if(old){if(old.request_hash!==requestHash)fail(409,'REQUEST_CONFLICT','Request ID was used for another operation.');return {id:old.id,state:old.state};}
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
 const job=(await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,request_id,request_hash,kind,access_context,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()) RETURNING id,state`,[schoolId,p.id,version.id,user.id,identityId??null,requestId,requestHash,kind,accessContext,JSON.stringify(payload)])).rows[0];
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
async function publicLoaded(db,user,id,courseContext={}){
 if(courseContext.courseId&&(await db.query(`SELECT 1 FROM learning_paths p LEFT JOIN public_course_listings l ON l.course_id=p.id
 WHERE p.owner_scope='platform' AND (p.id=$1 OR l.id=$1)`,[uuid(courseContext.courseId)])).rowCount){const scoped=await platformCourseProblem(db,user,id,courseContext);if(scoped)return scoped;}
 await activeAccount(db,user.id);
 let publication=(await db.query('SELECT * FROM school_problem_publications WHERE problem_id=$1 AND withdrawn_at IS NULL',[uuid(id)])).rows[0];
 if(!publication){const scoped=await platformCourseProblem(db,user,id,courseContext);if(scoped)return scoped;fail(404,'NOT_FOUND','Problem is unavailable.');}
 await lockSchoolTeaching(db,publication.school_id,{shared:true});
 publication=(await db.query('SELECT * FROM school_problem_publications WHERE problem_id=$1 AND withdrawn_at IS NULL',[uuid(id)])).rows[0];
 if(!publication)fail(404,'NOT_FOUND','Problem is unavailable.');
 await scope(db,publication.school_id);
 const p=await loadProblem(db,publication.school_id,id,user,null,{publicOnly:true});
 if(p.published_version_id!==publication.version_id)fail(404,'NOT_FOUND','The current version is awaiting platform review.');
 if (publication.school_id === LEGACY_SCHOOL_ID) {
  const presentation = await legacyPublicProblemPresentation(db,id,publication.version_id);
  if (!presentation) fail(404,'NOT_FOUND','Problem is unavailable.');
  p.public_statement = presentation.statement;
  p.public_metadata = presentation.metadata;
  p.public_tags = presentation.tags;
 }
 return p;
}
export async function listPublicProblems(pool,user,url){
 const { courseId, includeCourses } = problemCatalogCourseRequest(url);
 const query=(url?.searchParams?.get('q')??'').slice(0,100).trim();
 const catalogQuery=query.toLowerCase();
 const rawPage=url?.searchParams?.get('page');
 const page=rawPage==null?null:integer(Number(rawPage),1,100000,'Page');
 const pageSize=50;
 const limit=page==null?500:pageSize;
 let skip=page==null?0:(page-1)*pageSize;
 return transaction(pool,async db=>{
  await activeAccount(db,user.id);
  const courseFilter = includeCourses ? await publicProblemCatalogCourses(db, user, courseId) : null;
  const versions = courseId ? courseFilter.versions : null;
  const problemIds = versions ? [...versions.keys()] : null;
  const items=[];
  let cursor=null;
  while(items.length<=limit){
   // Filter after rechecking the current published version and its scope.
   // Seek across publication batches so search also reaches older releases.
   const {rows}=await db.query(`SELECT problem_id,version_id,approved_at::text AS approved_at
    FROM school_problem_publications WHERE withdrawn_at IS NULL AND (
      $1::timestamptz IS NULL OR approved_at<$1 OR (approved_at=$1 AND problem_id>$2::uuid)
    ) AND ($3::uuid[] IS NULL OR problem_id=ANY($3))
    ORDER BY approved_at DESC,problem_id LIMIT 100`,[cursor?.approved_at??null,cursor?.problem_id??null, problemIds]);
   for(const row of rows){
    if (versions && !versions.get(row.problem_id)?.has(row.version_id)) continue;
    try{
     const p=await publicLoaded(db,user,row.problem_id);
     if (versions && !versions.get(row.problem_id)?.has(p.published_version_id)) continue;
     const item=await shapeProblem(db,p,user,null,{publicOnly:true,accessContext:'public',catalogQuery});
     if(!item) continue;
     if(skip>0) skip--;
     else items.push(item);
     if(items.length>limit) break;
    }catch(error){if(error.status!==404) throw error;}
   }
   if(rows.length<100) break;
   cursor=rows.at(-1);
  }
  return {
   items: items.slice(0, limit),
   ...(courseFilter && { courseId, courses: courseFilter.courses }),
   ...(page != null && { page, query, hasMore: items.length > limit }),
  };
 });
}

export async function schoolPracticeOperation({pool,user,route,url,method,body={}}){
 route??=url.pathname.replace(/^\/api\/v1/,'');
 const courseContext={courseId:body.courseId??url?.searchParams.get('courseId'),chapterId:body.chapterId??url?.searchParams.get('chapterId'),versionId:body.versionId??url?.searchParams.get('versionId')};
 const loadPublic=(db,user,id)=>publicLoaded(db,user,id,courseContext);
 const scholarship=await publicScholarshipOperation({pool,user,route,url,method,body},loadPublic);
 if(scholarship)return scholarship;
 if(route==='/practice/leaderboard'&&method==='GET')return publicPracticeLeaderboard({pool,user,url});
 const personalRecords = await handlePublicPracticeRecords({pool,user,route,url,method,body}, projectJob);
 if (personalRecords) return personalRecords;
 const legacyRequest = await handleLegacyPublicProblemRequest({pool,user,route,url,method,body});
 if (legacyRequest) return legacyRequest;
 if(route==='/practice/problems'&&method==='GET')return reply(await listPublicProblems(pool,user,url));
 const pub=route.match(/^\/practice\/problems\/([^/]+)(?:\/submissions(?:\/([^/]+))?)?$/);
 if(pub)return transaction(pool,async db=>{
  const p=await loadPublic(db,user,pub[1]);
  const expectedVersion = method === 'POST' ? body.versionId : url?.searchParams.get('versionId');
  if (expectedVersion != null && uuid(expectedVersion).toLowerCase() !== p.published_version_id) {
   fail(404, 'NOT_FOUND', 'This version is no longer available in public practice.');
  }
  await schoolActivityProblemAccess(db,{schoolId:p.school_id,problemId:p.id,user});
  if(method==='GET'&&!route.includes('/submissions'))return reply(await shapeProblem(db,p,user,null,{detail:true,publicOnly:true,accessContext:'public'}));
  if(method==='GET'&&route.endsWith('/submissions'))return reply(await schoolProblemSubmissions(db,p,user,url,'public'));
  if(method==='GET'&&pub[2]){const job=(await db.query("SELECT * FROM school_judge_jobs WHERE school_id=$1 AND id=$2 AND account_id=$3 AND problem_id=$4 AND access_context='public'",[p.school_id,uuid(pub[2]),user.id,p.id])).rows[0];if(!job)fail(404,'NOT_FOUND','Submission not found.');return reply(await projectJob(db,job));}
  if(method==='POST'&&route.endsWith('/submissions')){const version=(await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND id=$2',[p.school_id,p.published_version_id])).rows[0];return reply(await enqueue(db,{schoolId:p.school_id,p,version,user,kind:enumValue(body.kind,['samples','custom','submit'],'Run type'),body,accessContext:'public'}),202);}
  return null;
 });
 if(route==='/platform/problem-publications'||/^\/platform\/problem-publications\/[^/]+(?:\/(withdraw|reject))?$/.test(route))return transaction(pool,async db=>{
  await activeAccount(db,user.id);if(!await isPlatformAdministrator(db,user.id))fail(403,'FORBIDDEN','Platform administrator required.');
  if(method==='GET'&&route!=='/platform/problem-publications'){
   const schoolId=uuid(url.searchParams.get('schoolId')),problemId=uuid(route.split('/')[3]);await scope(db,schoolId);
   if (schoolId === LEGACY_SCHOOL_ID) return reply(await previewLegacyPublicProblem(db,problemId));
   const p=await loadProblem(db,schoolId,problemId,user,null,{publicOnly:true});
   return reply({...await shapeProblem(db,p,user,null,{detail:true,publicOnly:true,accessContext:'public'}),...await publicProblemStatus(db,p,p.published_version_id)});
  }
  if(method==='GET'){
   const items=[];for(const s of(await db.query('SELECT id,name FROM schools WHERE id<>$1 ORDER BY name',[LEGACY_SCHOOL_ID])).rows){await scope(db,s.id);for(const p of(await db.query(`SELECT p.*,b.name AS bank_name FROM school_problems p JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id WHERE b.resource_kind=\'ordinary\' AND p.school_id=$1 AND p.published AND NOT b.archived`,[s.id])).rows){const item=await shapeProblem(db,p,user,null,{publicOnly:true,accessContext:'public'});items.push({...item,schoolName:s.name,...await publicProblemStatus(db,p,p.published_version_id)});}}
   items.push(...await listLegacyPublicProblemReviews(db));
   return reply({items});
  }
  if(method==='POST'){
   const schoolId=uuid(body.schoolId),problemId=uuid(body.problemId??route.split('/')[3]);await lockSchoolTeaching(db,schoolId);await scope(db,schoolId);
   const decision = route.endsWith('/withdraw') ? 'withdraw' : route.endsWith('/reject') ? 'reject' : 'approve';
   if (schoolId === LEGACY_SCHOOL_ID) {
    await decideLegacyPublicProblem(db,{problemId,versionId:body.versionId,decision,actorId:user.id});
    return reply({ok:true});
   }
   const p=await loadProblem(db,schoolId,problemId,user,null,{publicOnly:true});
   const versionId = p.published_version_id;
   if ((decision !== 'withdraw' || body.versionId) && uuid(body.versionId)!==versionId)
    fail(409,'REVISION_CONFLICT','Review the current published version.');
   if (decision === 'withdraw') {
    await db.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE school_id=$1 AND problem_id=$2',[schoolId,problemId]);
   } else {
    const request = await db.query(`
     UPDATE school_problem_publication_requests SET status=$4,decided_by=$5,decided_at=clock_timestamp()
     WHERE school_id=$1 AND problem_id=$2 AND version_id=$3 AND status='pending'
    `, [schoolId,problemId,versionId,decision==='approve'?'approved':'rejected',user.id]);
    if (decision === 'reject' && !request.rowCount) fail(409,'NO_PENDING_REQUEST','No request is pending for this version.');
    if (decision === 'approve') await db.query(`
     INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by) VALUES($1,$2,$3,$4)
     ON CONFLICT(problem_id) DO UPDATE SET version_id=EXCLUDED.version_id,approved_by=EXCLUDED.approved_by,
       approved_at=clock_timestamp(),withdrawn_at=NULL
    `,[schoolId,problemId,versionId,user.id]);
   }
   await db.query('INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail) VALUES($1,$2,$3,$4)',[user.id,'problem.'+decision,schoolId,JSON.stringify({problemId,versionId})]);return reply({ok:true});
  }return null;
 });
 const m=route.match(/^\/schools\/([^/]+)\/(problem-banks|problems|judge-status|judge-jobs|submissions)(?:\/([^/]+)(?:\/(validate|publish|unpublish|submissions|public-request|tutorial))?)?$/);
 if(!m)return null;const schoolId=uuid(m[1]);if(schoolId===LEGACY_SCHOOL_ID)fail(404,'NOT_FOUND','Use the existing school workspace.');
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,schoolId,{shared:method==='GET'});const role=await schoolRole(db,schoolId,user.id);await scope(db,schoolId);const id=m[3]?uuid(m[3]):null;
  if(m[2]==='submissions'&&method==='GET'&&!id){
   const page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page');
   const rows=(await db.query(`SELECT id,problem_id,payload->'version'->>'title' AS title,payload->>'language' AS language,state,created_at,result->>'status' AS status,result->>'score' AS score
    FROM school_judge_jobs j WHERE ${schoolActivityJobVisibleSql('j')} AND school_id=$1 AND account_id=$2 AND access_context IN ('school','staff_practice') AND kind='submit'
    ORDER BY created_at DESC,id LIMIT 26 OFFSET $3`,[schoolId,user.id,(page-1)*25])).rows;
   return reply({page,hasMore:rows.length>25,items:rows.slice(0,25).map(j=>({id:j.id,problemId:j.problem_id,problemTitle:j.title,language:j.language,state:j.state,createdAt:j.created_at,status:j.status??(j.state==='failed'?'System Error':j.state==='leased'?'Judging':'Waiting'),score:j.score===null?null:Number(j.score)}))});
  }
  if(m[2]==='judge-status'&&method==='GET'){
   if(role!=='school_admin')fail(403,'FORBIDDEN','School administrator required.');
   const counts=(await db.query("SELECT count(*) FILTER(WHERE state='queued')::integer AS queued,count(*) FILTER(WHERE state='leased')::integer AS running,count(*) FILTER(WHERE state='failed')::integer AS failed,count(*) FILTER(WHERE state='completed')::integer AS completed FROM school_judge_jobs WHERE school_id=$1",[schoolId])).rows[0];
   const ready=(await db.query("SELECT EXISTS(SELECT 1 FROM judge_nodes WHERE executor_ready AND heartbeat_at>now()-interval '45 seconds') AS ready")).rows[0].ready;return reply({...counts,ready});
  }
  if(m[2]==='judge-jobs'&&method==='GET'&&id){const job=(await db.query("SELECT * FROM school_judge_jobs WHERE school_id=$1 AND id=$2 AND account_id=$3 AND access_context NOT IN ('assignment_preview','acsl')",[schoolId,id,user.id])).rows[0];if(!job)fail(404,'NOT_FOUND','Submission not found.');return reply(await projectJob(db,job));}
  if(m[2]==='problem-banks'){
   if(method==='GET'){return reply({items:(await db.query(`SELECT id,name,revision,archived,owner_account_id=$2 OR $3='school_admin' AS "canManage" FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND ($3='school_admin' OR owner_account_id=$2 OR NOT archived AND EXISTS(SELECT 1 FROM school_problems p WHERE p.school_id=$1 AND p.bank_id=school_problem_banks.id AND p.published)) ORDER BY name,id`,[schoolId,user.id,role])).rows});}
   if(!['teacher','school_admin'].includes(role))fail(403,'FORBIDDEN','Teaching role required.');
   if(method==='POST'&&!id){const name=field(body.name,'Bank name',{max:120}),requestId=uuid(body.requestId);const old=(await db.query('SELECT * FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND owner_account_id=$2 AND request_id=$3',[schoolId,user.id,requestId])).rows[0];if(old){if(old.name!==name)fail(409,'REQUEST_CONFLICT','Request ID already used.');return reply(old);}const bank=(await db.query('INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,$3,$4) RETURNING id,name,revision,archived',[schoolId,user.id,name,requestId])).rows[0];await auditSchool(db,schoolId,user.id,'school.bank.create',bank.id);return reply(bank,201);}
   if(method==='PATCH'&&id){const bank=(await db.query('SELECT * FROM school_problem_banks WHERE resource_kind=\'ordinary\' AND school_id=$1 AND id=$2 FOR UPDATE',[schoolId,id])).rows[0];if(!bank||!canManage(bank,user,role))fail(404,'NOT_FOUND','Bank unavailable.');revision(body,bank);const name=field(body.name??bank.name,'Bank name',{max:120});const archived=body.archived??bank.archived;if(typeof archived!=='boolean')fail(400,'VALIDATION','Invalid archive flag.');await db.query('UPDATE school_problem_banks SET name=$3,archived=$4,revision=revision+1 WHERE school_id=$1 AND id=$2',[schoolId,id,name,archived]);await auditSchool(db,schoolId,user.id,'school.bank.update',id);return reply({id,name,archived,revision:bank.revision+1});}return null;
  }
  if(m[2]!=='problems')return null;
  if(method==='GET'&&!id){
   const bankId = url.searchParams.get('bankId');
   if (bankId) uuid(bankId);
   const { courseId, includeCourses } = problemCatalogCourseRequest(url);
   const courseFilter = role === 'student' && includeCourses
    ? await schoolProblemCatalogCourses(db, schoolId, user, role, courseId) : null;
   const links = courseId && courseFilter
    ? [...courseFilter.versions].flatMap(([problemId, versions]) => [...versions].map(versionId => ({ problemId, versionId }))) : null;
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
   for (const p of rows) items.push(await shapeProblem(db, p, user, role));
   return reply({ ...(courseFilter && { courseId, courses: courseFilter.courses }), items });
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
  if(method==='GET'&&m[4]==='submissions')return reply(await schoolProblemSubmissions(db,p,user,url,practiceContext(role)));
  if(method==='GET'){const practice=url.searchParams.get('view')==='practice';if(practice&&(!p.published||p.archived))fail(404,'NOT_FOUND','Problem unavailable.');return reply(await shapeProblem(db,p,user,role,{detail:true,publicOnly:practice}));}
  if(m[4]==='submissions'&&method==='POST'){
   if(!p.published||p.archived)fail(409,'NOT_PUBLISHED','Publish the problem before student practice.');
   const version=(await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND id=$2',[schoolId,p.published_version_id])).rows[0];return reply(await enqueue(db,{schoolId,p,version,user,role,kind:enumValue(body.kind,['samples','custom','submit'],'Run type'),body,accessContext:practiceContext(role)}),202);
  }
  if(!canManage(p,user,role))fail(403,'FORBIDDEN','You cannot manage this problem.');revision(body,p);
  if(method==='PATCH'&&!m[4]){const definition=normalizeSchoolProblem(body);await db.query('UPDATE school_problems SET draft=$3,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[schoolId,id,JSON.stringify(definition)]);await auditSchool(db,schoolId,user.id,'school.problem.update',id);return reply(await shapeProblem(db,await loadProblem(db,schoolId,id,user,role),user,role,{detail:true}));}
  if(method==='POST'&&m[4]==='validate'){
   await db.query('INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition) VALUES($1,$2,$3,$4) ON CONFLICT(school_id,problem_id,draft_revision) DO NOTHING',[schoolId,id,p.revision,JSON.stringify(p.draft)]);
   const version=(await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 AND draft_revision=$3',[schoolId,id,p.revision])).rows[0];
   return reply(await enqueue(db,{schoolId,p,version,user,kind:'validation',body:{...body,language:'python'},accessContext:'school'}),202);
  }
  if(method==='POST'&&m[4]==='publish'){
   if(role!=='school_admin')fail(403,'FORBIDDEN','School administrator review is required.');
   const version=(await db.query(`SELECT v.* FROM school_problem_versions v WHERE v.school_id=$1 AND v.problem_id=$2 AND v.draft_revision=$3 AND EXISTS(SELECT 1 FROM school_judge_jobs j WHERE j.school_id=v.school_id AND j.version_id=v.id AND j.kind='validation' AND j.state='completed' AND j.result->>'status'='AC')`,[schoolId,id,p.revision])).rows[0];
   if(!version)fail(409,'VALIDATION_REQUIRED','The current reference must pass every formal and sample test before publication.');
   await db.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[schoolId,id,version.id]);await auditSchool(db,schoolId,user.id,'school.problem.publish',id);
  }else if(method==='POST'&&m[4]==='unpublish'){await db.query('UPDATE school_problems SET published=false WHERE school_id=$1 AND id=$2',[schoolId,id]);await auditSchool(db,schoolId,user.id,'school.problem.unpublish',id);}else return null;
  return reply(await shapeProblem(db,await loadProblem(db,schoolId,id,user,role),user,role,{detail:true}));
 });
}
