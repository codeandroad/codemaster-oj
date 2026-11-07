import { createHash } from 'node:crypto';
import { transaction } from './db.mjs';
import { fail,field,bytes,uuid,integer,enumValue } from './security.mjs';
import { schoolRole,lockSchoolTeaching,auditSchool } from './schools.mjs';
import { schoolPaper4Input,schoolPaper4Title,validateStageCoverage } from './school-paper4-input.mjs';
import { parsePaper4BatchImport,exportPaper4Collection } from './paper4-collection.mjs';
import { configureSchoolActivityScholarshipRule,settleSchoolActivityRewards } from './school-scholarship.mjs';

const LEGACY='00000000-0000-4000-8000-000000000052';
const reply=body=>({status:200,body});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const managed=(p,user,role)=>role==='school_admin'||role==='teacher'&&p.owner_account_id===user.id;
const staff=role=>['teacher','school_admin'].includes(role);
function teaching(role){if(!staff(role))fail(403,'FORBIDDEN','Teaching access required.');}
function revision(p,value){if(integer(value,1,2147483647,'Revision')!==p.revision)fail(409,'CONFLICT','This item changed. Refresh before saving.');}
function ids(value,label='Selection',max=100){if(!Array.isArray(value)||!value.length||value.length>max)fail(400,'VALIDATION',`${label} requires 1–${max} items.`);const result=value.map(v=>uuid(v,label));if(new Set(result).size!==result.length)fail(400,'VALIDATION','Duplicate selection.');return result;}
function date(value,label){if(value===null||value===undefined||value==='')return null;const d=new Date(value);if(typeof value!=='string'||!Number.isFinite(d.getTime()))fail(400,'VALIDATION',`Invalid ${label}.`);return d;}
async function idem(db,s,user,operation,body,fn){
 const requestId=uuid(body.requestId,'Request ID'),digest=hash({operation,body});
 const existing=(await db.query('SELECT * FROM school_paper4_requests WHERE school_id=$1 AND account_id=$2 AND request_id=$3',[s,user.id,requestId])).rows[0];
 if(existing){if(existing.request_hash!==digest)fail(409,'REQUEST_CONFLICT','Request ID was used for another operation.');return existing.response;}
 const response=await fn();await db.query('INSERT INTO school_paper4_requests(school_id,account_id,request_id,operation,request_hash,response) VALUES($1,$2,$3,$4,$5,$6)',[s,user.id,requestId,operation,digest,JSON.stringify(response)]);return response;
}
async function paper(db,s,id,user,role,{manage=false}={}){
 const p=(await db.query('SELECT * FROM school_paper4_papers WHERE school_id=$1 AND id=$2',[s,id])).rows[0];
 if(!p||(manage?!managed(p,user,role):!managed(p,user,role)&&(!p.published||p.archived)))fail(404,'NOT_FOUND','Paper not found.');return p;
}
async function version(db,s,id){const v=(await db.query('SELECT * FROM school_paper4_versions WHERE school_id=$1 AND id=$2',[s,id])).rows[0];if(!v)fail(404,'NOT_FOUND','Paper version not found.');return v;}
async function frozen(db,p){return(await db.query('INSERT INTO school_paper4_versions(school_id,paper_id,draft_revision,content) VALUES($1,$2,$3,$4) ON CONFLICT(school_id,paper_id,draft_revision) DO NOTHING RETURNING *',[p.school_id,p.id,p.revision,JSON.stringify(p.draft)])).rows[0]??(await db.query('SELECT * FROM school_paper4_versions WHERE school_id=$1 AND paper_id=$2 AND draft_revision=$3',[p.school_id,p.id,p.revision])).rows[0];}
async function validation(db,s,v){if(!v)return null;const j=(await db.query("SELECT id,state,result->>'status' status FROM school_paper4_jobs WHERE school_id=$1 AND version_id=$2 AND kind='validation' ORDER BY created_at DESC,id DESC LIMIT 1",[s,v.id])).rows[0];return j??null;}
async function paperView(db,p,user,role,detail=false){
 const manage=managed(p,user,role),v=p.published_version_id?await version(db,p.school_id,p.published_version_id):null;
 const c=manage?p.draft:v?.content;if(!c)fail(404,'NOT_FOUND','Paper is unavailable.');
 const current=manage?(await db.query('SELECT * FROM school_paper4_versions WHERE school_id=$1 AND paper_id=$2 AND draft_revision=$3',[p.school_id,p.id,p.revision])).rows[0]:null;
 return {id:p.id,title:c.title,shortTitle:schoolPaper4Title(c),description:c.description,revision:p.revision,published:p.published,versionId:v?.id??null,archived:p.archived,
  questionCount:c.definition.questions.length,totalMarks:c.definition.totalMarks,exam:c.definition.exam,canManage:manage,validation:manage?await validation(db,p.school_id,current):null,
  ...(detail?{definition:c.definition,...(manage?{questions:c.definition.questions,runnerCases:c.runnerCases,referenceSolutions:c.referenceSolutions}:{})}:{})};
}
async function identity(db,s,user){const i=(await db.query("SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2 AND kind='student'",[s,user.id])).rows[0];if(!i)fail(403,'STUDENT_IDENTITY_REQUIRED','A linked school student identity is required.');return i.id;}
async function audience(db,s,user,role){
 teaching(role);
 const classes=(await db.query(`SELECT c.id,c.name FROM school_classes c WHERE c.school_id=$1 AND c.archived_at IS NULL AND ($3='school_admin' OR EXISTS(SELECT 1 FROM school_class_roster r JOIN school_identities i ON i.school_id=r.school_id AND i.id=r.identity_id WHERE r.school_id=c.school_id AND r.class_id=c.id AND i.kind='teacher' AND i.account_id=$2)) ORDER BY c.name,c.id`,[s,user.id,role])).rows;
 const students=(await db.query(`SELECT i.id,i.name,i.number,COALESCE(jsonb_agg(c.id ORDER BY c.name,c.id) FILTER(WHERE c.id IS NOT NULL),'[]') AS "classIds",COALESCE(jsonb_agg(c.name ORDER BY c.name,c.id) FILTER(WHERE c.id IS NOT NULL),'[]') AS "classNames"
  FROM school_identities i LEFT JOIN school_class_roster r ON r.school_id=i.school_id AND r.identity_id=i.id LEFT JOIN school_classes c ON c.school_id=r.school_id AND c.id=r.class_id AND c.archived_at IS NULL
  WHERE i.school_id=$1 AND i.kind='student' AND i.archived_at IS NULL GROUP BY i.id,i.name,i.number
  HAVING $2='school_admin' OR count(c.id)=0 OR bool_or(c.id=ANY($3::uuid[])) ORDER BY i.name,i.id`,[s,role,classes.map(c=>c.id)])).rows;
 return {classes,students};
}
async function activity(db,s,id,user,role){
 const a=(await db.query('SELECT a.*,v.content,p.owner_account_id paper_owner FROM school_paper4_activities a JOIN school_paper4_versions v ON v.school_id=a.school_id AND v.id=a.version_id JOIN school_paper4_papers p ON p.school_id=a.school_id AND p.id=a.paper_id WHERE a.school_id=$1 AND a.id=$2',[s,id])).rows[0];
 if(!a)fail(404,'NOT_FOUND','Activity not found.');
 if(role==='student'){const i=await identity(db,s,user);if(!(await db.query('SELECT 1 FROM school_paper4_participants WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3',[s,id,i])).rowCount)fail(404,'NOT_FOUND','Activity not found.');}
 else if(!managed(a,user,role))fail(404,'NOT_FOUND','Activity not found.');return a;
}
async function activityView(db,a,user,role,detail=false){
 const state=(await db.query('SELECT (SELECT count(*)::int FROM school_paper4_participants WHERE school_id=$1 AND activity_id=$2) AS count,EXISTS(SELECT 1 FROM school_paper4_attempts WHERE school_id=$1 AND activity_id=$2) AS started,clock_timestamp() AS now',[a.school_id,a.id])).rows[0];
 const rule=(await db.query("SELECT amount,minimum_ac AS \"minimumAc\",minimum_score AS \"minimumScore\",task_kind AS \"taskKind\",allow_solution_assisted AS \"allowSolutionAssisted\",revision FROM school_scholarship_activity_rules WHERE school_id=$1 AND activity_type='paper4_activity' AND activity_id=$2 ORDER BY revision DESC LIMIT 1",[a.school_id,a.id])).rows[0]??null;
 return {id:a.id,paperId:a.paper_id,versionId:a.version_id,title:a.content.title,shortTitle:schoolPaper4Title(a.content),kind:a.kind,startsAt:a.starts_at,endsAt:a.ends_at,resultsPublished:!!a.results_published_at,canManage:managed(a,user,role),canConfigureRule:managed(a,user,role)&&!a.results_published_at&&!!a.starts_at&&a.starts_at>state.now&&!state.started,participantCount:state.count,scholarshipRule:rule,...(detail&&staff(role)?{participants:(await db.query('SELECT i.id,i.name,i.number FROM school_paper4_participants p JOIN school_identities i ON i.school_id=p.school_id AND i.id=p.identity_id WHERE p.school_id=$1 AND p.activity_id=$2 ORDER BY i.name,i.id',[a.school_id,a.id])).rows}:{})};
}
async function assessmentRestricted(db,s,identityId,paperId,activityId){
 return (await db.query(`SELECT EXISTS(SELECT 1 FROM school_paper4_activities a JOIN school_paper4_participants p ON p.school_id=a.school_id AND p.activity_id=a.id WHERE a.school_id=$1 AND a.paper_id=$2 AND p.identity_id=$3 AND a.kind='exam' AND a.starts_at<=clock_timestamp() AND a.results_published_at IS NULL AND a.id IS DISTINCT FROM $4::uuid) blocked`,[s,paperId,identityId,activityId])).rows[0].blocked;
}
async function attempt(db,s,id,user,role,{write=false}={}){
 const a=(await db.query(`SELECT a.*,v.content,p.published,p.archived,p.owner_account_id paper_owner,si.name student_name,act.owner_account_id activity_owner,act.kind activity_kind,act.starts_at,act.ends_at,act.results_published_at activity_results
 FROM school_paper4_attempts a JOIN school_identities si ON si.school_id=a.school_id AND si.id=a.identity_id JOIN school_paper4_versions v ON v.school_id=a.school_id AND v.id=a.version_id JOIN school_paper4_papers p ON p.school_id=a.school_id AND p.id=a.paper_id
 LEFT JOIN school_paper4_activities act ON act.school_id=a.school_id AND act.id=a.activity_id WHERE a.school_id=$1 AND a.id=$2`,[s,id])).rows[0];
 if(!a)fail(404,'NOT_FOUND','Attempt not found.');
 if(role==='student'){if(a.identity_id!==await identity(db,s,user))fail(404,'NOT_FOUND','Attempt not found.');if(!a.activity_id&&(!a.published||a.archived))fail(404,'NOT_FOUND','Paper is unavailable.');a.assessment_restricted=await assessmentRestricted(db,s,a.identity_id,a.paper_id,a.activity_id);}
 else if(role!=='school_admin'&&(role!=='teacher'||(a.activity_id?a.activity_owner:a.paper_owner)!==user.id))fail(404,'NOT_FOUND','Attempt not found.');
 if(write){if(role!=='student')fail(403,'FORBIDDEN','Only the student may change an attempt.');if(a.state!=='draft')fail(409,'SUBMITTED','This attempt was already submitted.');await windowOpen(db,a);}
 return a;
}
async function windowOpen(db,a){if(a.assessment_restricted)fail(409,'ASSESSMENT_ACTIVE','Use the assigned exam until its results are published.');if(a.activity_results||a.results_published_at)fail(409,'RESULTS_FROZEN','This activity is already closed.');const now=(await db.query('SELECT clock_timestamp() AS now')).rows[0].now;if(a.starts_at&&now<a.starts_at)fail(409,'NOT_STARTED','This activity has not started.');if(a.ends_at&&now>=a.ends_at)fail(409,'DEADLINE_PASSED','The submission deadline has passed.');}
function resultsVisible(a,role){return staff(role)||!a.assessment_restricted&&(a.activity_kind!=='exam'||!!a.activity_results);}
function jobView(j,visible=true){return {id:j.id,kind:j.kind,state:j.state,createdAt:j.created_at,...(visible?{status:j.state==='failed'?'System Error':j.result?.status??null,publicOutput:j.kind==='run'?j.result?.questions?.map(q=>q.publicOutput??'').join('\n')??'':'',publicMessage:j.state==='failed'?'Execution service unavailable. Please try again.':j.result?.publicMessage??'',questions:j.result?.questions?.map(q=>({key:q.key,status:q.status,stages:q.stages?.map(s=>({stageKey:s.stageKey,status:s.status,marks:s.marks,maxMarks:s.maxMarks})),...(j.kind==='run'?{publicOutput:q.publicOutput??'',publicMessage:q.publicMessage??''}:{})}))??[]}:{status:null,publicOutput:'',publicMessage:'Results are not published.',questions:[]})};}
async function marksView(db,a,role){const j=(await db.query("SELECT * FROM school_paper4_jobs WHERE school_id=$1 AND attempt_id=$2 AND kind='submit'",[a.school_id,a.id])).rows[0];const manual=(await db.query('SELECT stage_key,marks,private_note FROM school_paper4_reviews WHERE school_id=$1 AND attempt_id=$2',[a.school_id,a.id])).rows;const stages=a.content.definition.questions.flatMap(q=>q.stages.map(s=>({...s,questionKey:q.key})));return stages.map(s=>{const r=manual.find(r=>r.stage_key===s.id),automatic=j?.result?.questions?.flatMap(q=>q.stages??[]).find(x=>x.stageKey===s.id);return {stageKey:s.id,questionKey:s.questionKey,title:s.title,maxMarks:s.maxMarks,judgeMode:s.judgeMode,marks:s.judgeMode==='auto'?automatic?.marks??null:r?.marks??null,...(staff(role)?{note:r?.private_note??''}:{})};});}
async function attemptView(db,a,user,role){
 const files=Object.fromEntries((await db.query('SELECT question_key,code,revision FROM school_paper4_files WHERE school_id=$1 AND attempt_id=$2',[a.school_id,a.id])).rows.map(f=>[f.question_key,{code:f.code,revision:f.revision}]));
 const visible=resultsVisible(a,role),marksPublished=staff(role)||!a.assessment_restricted&&(a.activity_results||a.results_published_at);
 const jobs=(await db.query('SELECT * FROM school_paper4_jobs WHERE school_id=$1 AND attempt_id=$2 ORDER BY created_at DESC,id DESC LIMIT 30',[a.school_id,a.id])).rows;
 return {id:a.id,paperId:a.paper_id,activityId:a.activity_id,versionId:a.version_id,state:a.state,canManage:staff(role),canEdit:role==='student'&&a.state==='draft'&&(!a.starts_at||new Date(a.starts_at).getTime()<=Date.now())&&(!a.ends_at||new Date(a.ends_at).getTime()>Date.now())&&!a.activity_results&&!a.assessment_restricted,revision:a.revision,submittedAt:a.submitted_at,startsAt:a.starts_at,endsAt:a.ends_at,activityKind:a.activity_kind,resultsVisible:visible,releasedAt:a.activity_results??a.results_published_at??null,...(staff(role)?{studentName:a.student_name}:{}),
  paper:{id:a.paper_id,title:a.content.title,shortTitle:schoolPaper4Title(a.content),description:a.content.description,exam:a.content.definition.exam},definition:a.content.definition,files,jobs:jobs.map(j=>jobView(j,j.kind==='run'&&!a.assessment_restricted||visible)),...(marksPublished?{marks:await marksView(db,a,role)}:{})};
}
async function queue(db,s,user,v,kind,payload,a=null){
 const pending=(await db.query("SELECT count(*)::int n FROM school_paper4_jobs WHERE account_id=$1 AND state IN ('queued','leased')",[user.id])).rows[0].n;
 if(pending>=(kind==='validation'?150:5))fail(429,'RATE_LIMIT','Too many pending Paper 4 requests.');
 return(await db.query('INSERT INTO school_paper4_jobs(school_id,version_id,attempt_id,account_id,identity_id,kind,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,state',[s,v.id,a?.id??null,user.id,a?.identity_id??null,kind,JSON.stringify(payload)])).rows[0];
}
function questionPayload(content,files,{questionKey,stageId,validation=false,publicOnly=false}={}){
 const questions=questionKey?content.definition.questions.filter(q=>q.key===questionKey):content.definition.questions;if(!questions.length)fail(404,'NOT_FOUND','Question not found.');
 return questions.map(question=>{if(stageId&&!question.stages.some(s=>s.id===stageId&&s.judgeMode==='auto'))fail(400,'VALIDATION','Choose an automatic stage.');
 const cases=question.stages.filter(s=>s.judgeMode==='auto'&&(!stageId||s.id===stageId)).flatMap(s=>(content.runnerCases[s.id]??[]).filter(c=>!publicOnly||c.public).map(c=>({...c,stageId:s.id})));
 if(!cases.length)fail(409,'NO_PUBLIC_CASES',publicOnly?'No public test is available for this selection. Submit to run the full assessment.':'Automatic test coverage is missing.');
 return {key:question.key,sourceCode:validation?content.referenceSolutions[question.key]:files[question.key]?.code??'',question,runnerCases:cases};});
}
async function publishResults(db,a){if(a.state!=='submitted')fail(409,'NOT_SUBMITTED','The attempt has not been submitted.');const j=(await db.query("SELECT state FROM school_paper4_jobs WHERE school_id=$1 AND attempt_id=$2 AND kind='submit'",[a.school_id,a.id])).rows[0];if(j?.state!=='completed')fail(409,'GRADING_PENDING','Wait for automatic judging before publishing results.');const marks=await marksView(db,a,'school_admin');if(marks.some(m=>m.marks===null))fail(409,'REVIEW_REQUIRED','Review all manual and evidence stages before publishing results.');}
export async function handleSchoolPaper4({pool,user,route,method,body={},url}){
 const match=route.match(/^\/schools\/([^/]+)\/paper4(?:\/(.*))?$/);if(!match)return null;
 const s=uuid(match[1]);if(s===LEGACY)fail(404,'NOT_FOUND','Use the existing school workspace.');const parts=(match[2]??'').split('/').filter(Boolean);
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,s,{shared:method==='GET'});const role=await schoolRole(db,s,user.id);await db.query("SELECT set_config('campus.school_id',$1,true)",[s]);
  const [resource,key,action,subkey]=parts;
  if(resource==='audience'&&method==='GET')return reply(await audience(db,s,user,role));
  if(resource==='papers'&&['import','import-preview'].includes(key)&&method==='POST'){
   teaching(role);const parsed=parsePaper4BatchImport({files:body.files});const inputs=parsed.items.map(i=>schoolPaper4Input(i.createBody));
   if(key==='import-preview')return reply({items:parsed.items.map(i=>i.preview),totalPapers:inputs.length});
   return reply(await idem(db,s,user,'import',body,async()=>{const items=[];for(const input of inputs){const p=(await db.query('INSERT INTO school_paper4_papers(school_id,owner_account_id,draft) VALUES($1,$2,$3) RETURNING *',[s,user.id,JSON.stringify(input)])).rows[0];items.push(await paperView(db,p,user,role));}await auditSchool(db,s,user.id,'paper4.import',uuid(body.requestId));return{items};}));
  }
  if(resource==='papers'&&key==='export'&&method==='POST'){
   teaching(role);const selected=[];for(const id of ids(body.paperIds)){const p=await paper(db,s,id,user,role,{manage:true});const c=p.draft;selected.push({id:p.id,version_number:p.revision,title:c.title,short_title:c.shortTitle,description:c.description,definition:c.definition,runner_cases:c.runnerCases,reference_solutions:c.referenceSolutions});}return reply(exportPaper4Collection(selected));
  }
  if(resource==='papers'&&['validate','publish'].includes(key)&&method==='POST'){
   teaching(role);if(key==='publish'&&role!=='school_admin')fail(403,'FORBIDDEN','School administrator review required.');
   if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail(400,'VALIDATION','Select 1–100 papers.');
   const papers=[];for(const item of body.items){const p=await paper(db,s,uuid(item.id),user,role,{manage:true});revision(p,item.expectedRevision);validateStageCoverage(p.draft.definition,p.draft.runnerCases,p.draft.referenceSolutions);if(p.archived)fail(409,'ARCHIVED','Restore the paper first.');papers.push(p);}if(new Set(papers.map(p=>p.id)).size!==papers.length)fail(400,'VALIDATION','Duplicate paper.');
   const run=async()=>{const items=[];for(const p of papers){const v=await frozen(db,p);if(key==='validate'){const old=await validation(db,s,v);const job=old&&['queued','leased'].includes(old.state)?old:await queue(db,s,user,v,'validation',{paperId:p.id,questions:questionPayload(v.content,{}, {validation:true})});items.push({paperId:p.id,...job});}
    else {const valid=await validation(db,s,v);if(valid?.state!=='completed'||valid.status!=='AC')fail(409,'VALIDATION_REQUIRED','Every reference solution must pass the current version before publication.');await db.query('UPDATE school_paper4_papers SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[s,p.id,v.id]);await auditSchool(db,s,user.id,'paper4.publish',p.id);items.push({id:p.id,published:true,versionId:v.id});}}return{items};};
   return reply(key==='validate'?await idem(db,s,user,'validate',body,run):await run());
  }
  if(resource==='papers'&&!key&&method==='GET'){
   const rows=(await db.query("SELECT * FROM school_paper4_papers WHERE school_id=$1 AND archived=$2 AND ($3='school_admin' OR $3='teacher' AND owner_account_id=$4 OR published AND NOT archived) ORDER BY created_at DESC,id",[s,url.searchParams.get('archived')==='true',role,user.id])).rows;
   return reply({items:await Promise.all(rows.map(p=>paperView(db,p,user,role)))});
  }
  if(resource==='papers'&&!key&&method==='POST'){
   teaching(role);const input=schoolPaper4Input(body);return reply(await idem(db,s,user,'create',body,async()=>{const p=(await db.query('INSERT INTO school_paper4_papers(school_id,owner_account_id,draft) VALUES($1,$2,$3) RETURNING *',[s,user.id,JSON.stringify(input)])).rows[0];return paperView(db,p,user,role,true);}));
  }
  if(resource==='papers'&&key){const p=await paper(db,s,uuid(key),user,role,{manage:method!=='GET'||action==='attempts'});
   if(!action&&method==='GET')return reply(await paperView(db,p,user,role,true));
   if(!action&&method==='PATCH'){revision(p,body.expectedRevision);if(body.archived!==undefined&&typeof body.archived!=='boolean')fail(400,'VALIDATION','Invalid archived flag.');const c=body.questions?schoolPaper4Input(body):p.draft;
    const updated=(await db.query('UPDATE school_paper4_papers SET draft=$3,revision=revision+1,archived=$4,published=CASE WHEN $4 THEN false ELSE published END,updated_at=now() WHERE school_id=$1 AND id=$2 RETURNING *',[s,p.id,JSON.stringify(c),body.archived??p.archived])).rows[0];return reply(await paperView(db,updated,user,role,true));}
   if(action==='unpublish'&&method==='POST'){if(role!=='school_admin')fail(403,'FORBIDDEN','School administrator required.');revision(p,body.expectedRevision);await db.query('UPDATE school_paper4_papers SET published=false WHERE school_id=$1 AND id=$2',[s,p.id]);return reply({ok:true});}
   if(action==='attempts'&&method==='GET'){const rows=(await db.query(`SELECT a.id,a.activity_id AS "activityId",a.state,a.created_at AS "createdAt",a.submitted_at AS "submittedAt",i.name AS "studentName",i.number AS "studentNumber" FROM school_paper4_attempts a JOIN school_identities i ON i.school_id=a.school_id AND i.id=a.identity_id LEFT JOIN school_paper4_activities act ON act.school_id=a.school_id AND act.id=a.activity_id WHERE a.school_id=$1 AND a.paper_id=$2 AND ($3='school_admin' OR a.activity_id IS NULL OR act.owner_account_id=$4) ORDER BY a.created_at DESC,a.id LIMIT 200`,[s,p.id,role,user.id])).rows;return reply({items:rows});}
  }
  if(resource==='activities'&&!key&&method==='POST'){
   teaching(role);const selected=ids(body.paperIds),students=ids(body.studentIdentityIds,'Students',1000),kind=enumValue(body.kind,['practice','exam'],'Activity type'),starts=date(body.startsAt,'start time'),ends=date(body.endsAt,'end time');
   const now=(await db.query('SELECT clock_timestamp() now')).rows[0].now;if(kind==='exam'&&(!starts||!ends)||starts&&ends&&ends<=starts||starts&&starts<=now||ends&&ends<=now)fail(400,'VALIDATION','Choose a future start and a later deadline. Exams require both.');
   const allowed=new Set((await audience(db,s,user,role)).students.map(i=>i.id));if(students.some(i=>!allowed.has(i)))fail(403,'FORBIDDEN','A student is outside your teaching scope.');
   const papers=[];for(const id of selected){const p=await paper(db,s,id,user,role,{manage:true});if(!p.published||p.archived)fail(409,'NOT_PUBLISHED','Publish every selected paper first.');papers.push(p);}
   return reply(await idem(db,s,user,'activities',body,async()=>{const items=[];for(const p of papers){const a=(await db.query('INSERT INTO school_paper4_activities(school_id,paper_id,version_id,owner_account_id,kind,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[s,p.id,p.published_version_id,user.id,kind,starts,ends])).rows[0];await configureSchoolActivityScholarshipRule(db,s,user,role,a.id,'paper4_activity',body.scholarshipRule??{amount:0},{initialize:true});for(const i of students)await db.query('INSERT INTO school_paper4_participants(school_id,activity_id,identity_id) VALUES($1,$2,$3)',[s,a.id,i]);items.push(await activityView(db,{...a,content:(await version(db,s,a.version_id)).content},user,role));}return{items};}));
  }
  if(resource==='activities'&&!key&&method==='GET'){
   const i=role==='student'?await identity(db,s,user):null;const rows=(await db.query(`SELECT a.*,v.content FROM school_paper4_activities a JOIN school_paper4_versions v ON v.school_id=a.school_id AND v.id=a.version_id WHERE a.school_id=$1 AND ($2='school_admin' OR $2='teacher' AND a.owner_account_id=$3 OR $2='student' AND EXISTS(SELECT 1 FROM school_paper4_participants p WHERE p.school_id=a.school_id AND p.activity_id=a.id AND p.identity_id=$4)) ORDER BY a.created_at DESC,a.id`,[s,role,user.id,i])).rows;return reply({items:await Promise.all(rows.map(a=>activityView(db,a,user,role)))});
  }
  if(resource==='activities'&&key){const a=await activity(db,s,uuid(key),user,role);if(!action&&method==='GET')return reply(await activityView(db,a,user,role,true));
   if(action==='results'&&subkey==='publish'&&method==='POST'){teaching(role);if(a.kind==='exam'&&new Date(a.ends_at)>(await db.query('SELECT clock_timestamp() now')).rows[0].now)fail(409,'EXAM_ACTIVE','Wait until the exam closes.');const rows=(await db.query("SELECT id FROM school_paper4_attempts WHERE school_id=$1 AND activity_id=$2 AND state='submitted'",[s,a.id])).rows;for(const row of rows)await publishResults(db,await attempt(db,s,row.id,user,role));await db.query('UPDATE school_paper4_activities SET results_published_at=COALESCE(results_published_at,clock_timestamp()) WHERE school_id=$1 AND id=$2',[s,a.id]);await settleSchoolActivityRewards(db,s,a.id,'paper4_activity');await auditSchool(db,s,user.id,'paper4.results.publish',a.id);return reply({ok:true});}
  }
  if(resource==='attempts'&&!key&&method==='POST'){
   if(role!=='student')fail(403,'FORBIDDEN','Student access required.');const i=await identity(db,s,user);const paperId=uuid(body.paperId),a=body.activityId?await activity(db,s,uuid(body.activityId),user,role):null;if(a&&a.paper_id!==paperId)fail(400,'VALIDATION','Activity and paper differ.');const p=a?{id:a.paper_id,published_version_id:a.version_id}:await paper(db,s,paperId,user,role);if(await assessmentRestricted(db,s,i,p.id,a?.id??null))fail(409,'ASSESSMENT_ACTIVE','Use the assigned exam until its results are published.');const v=await version(db,s,a?.version_id??p.published_version_id);
   return reply(await idem(db,s,user,'attempt',body,async()=>{const old=(await db.query(`SELECT id FROM school_paper4_attempts WHERE school_id=$1 AND identity_id=$2 AND paper_id=$3 AND version_id=$4 AND (activity_id=$5 OR $5::uuid IS NULL AND activity_id IS NULL AND state='draft')`,[s,i,p.id,v.id,a?.id??null])).rows[0];if(old)return old;if(a)await windowOpen(db,a);
    const created=(await db.query('INSERT INTO school_paper4_attempts(school_id,paper_id,version_id,activity_id,identity_id,account_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[s,p.id,v.id,a?.id??null,i,user.id])).rows[0];for(const q of v.content.definition.questions)await db.query('INSERT INTO school_paper4_files(school_id,attempt_id,question_key,code) VALUES($1,$2,$3,$4)',[s,created.id,q.key,q.starterCode]);return created;}));
  }
  if(resource==='attempts'&&key){const write=['PUT','POST'].includes(method)&&['files','run','submit'].includes(action);const a=await attempt(db,s,uuid(key),user,role,{write:write&&action!=='submit'});
   if(!action&&method==='GET')return reply(await attemptView(db,a,user,role));
   if(action==='files'&&subkey&&method==='PUT'){if(!a.content.definition.questions.some(q=>q.key===subkey))fail(404,'NOT_FOUND','Question not found.');const code=bytes(body.code,'Code');const f=(await db.query('UPDATE school_paper4_files SET code=$4,revision=revision+1,updated_at=now() WHERE school_id=$1 AND attempt_id=$2 AND question_key=$3 AND revision=$5 RETURNING code,revision',[s,a.id,subkey,code,integer(body.expectedRevision,1,2147483647,'Revision')])).rows[0];if(!f){const saved=(await db.query('SELECT code,revision FROM school_paper4_files WHERE school_id=$1 AND attempt_id=$2 AND question_key=$3',[s,a.id,subkey])).rows[0];if(saved?.code===code)return reply(saved);fail(409,'CONFLICT','The saved file changed. Refresh before saving.');}await db.query('UPDATE school_paper4_attempts SET revision=revision+1 WHERE school_id=$1 AND id=$2',[s,a.id]);return reply(f);}
   if(['run','submit'].includes(action)&&method==='POST'){
    if(role!=='student')fail(403,'FORBIDDEN','Student access required.');return reply(await idem(db,s,user,`${action}:${a.id}`,body,async()=>{if(a.state!=='draft')fail(409,'SUBMITTED','This attempt was already submitted.');await windowOpen(db,a);const files=Object.fromEntries((await db.query('SELECT question_key,code FROM school_paper4_files WHERE school_id=$1 AND attempt_id=$2',[s,a.id])).rows.map(f=>[f.question_key,f]));
     const payload={paperId:a.paper_id,questions:questionPayload(a.content,files,{questionKey:action==='run'?field(body.questionKey,'Question key',{max:40}):null,stageId:action==='run'?body.stageId:null,publicOnly:action==='run'})};
     const job=await queue(db,s,user,{id:a.version_id},action,payload,a);if(action==='submit')await db.query("UPDATE school_paper4_attempts SET state='submitted',submitted_at=clock_timestamp(),revision=revision+1 WHERE school_id=$1 AND id=$2",[s,a.id]);return job;}));
   }
   if(action==='marks'&&method==='PATCH'){teaching(role);if(a.state!=='submitted')fail(409,'NOT_SUBMITTED','Submit before marking.');if(a.activity_results||a.results_published_at)fail(409,'RESULTS_FROZEN','Published results are frozen.');if(!Array.isArray(body.marks)||!body.marks.length||body.marks.length>90)fail(400,'VALIDATION','Provide stage marks.');for(const m of body.marks){const stage=a.content.definition.questions.flatMap(q=>q.stages).find(st=>st.id===m.stageKey);if(!stage||stage.judgeMode==='auto')fail(400,'VALIDATION','Only manual and evidence marks may be reviewed.');await db.query('INSERT INTO school_paper4_reviews(school_id,attempt_id,stage_key,marks,private_note,reviewed_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,attempt_id,stage_key) DO UPDATE SET marks=EXCLUDED.marks,private_note=EXCLUDED.private_note,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()',[s,a.id,stage.id,integer(m.marks,0,stage.maxMarks,'Marks'),field(m.note??'','Private note',{min:0,max:4000}),user.id]);}return reply({marks:await marksView(db,a,role)});}
   if(action==='results'&&subkey==='publish'&&method==='POST'){teaching(role);if(a.activity_id)fail(409,'ACTIVITY_RESULTS','Publish results from the activity.');await publishResults(db,a);await db.query('UPDATE school_paper4_attempts SET results_published_at=COALESCE(results_published_at,clock_timestamp()) WHERE school_id=$1 AND id=$2',[s,a.id]);return reply({ok:true});}
  }
  if(resource==='jobs'&&key&&method==='GET'){const j=(await db.query('SELECT * FROM school_paper4_jobs WHERE school_id=$1 AND id=$2',[s,uuid(key)])).rows[0];if(!j)fail(404,'NOT_FOUND','Job not found.');if(j.kind==='validation'){const v=await version(db,s,j.version_id);await paper(db,s,v.paper_id,user,role,{manage:true});return reply(jobView(j));}const a=await attempt(db,s,j.attempt_id,user,role);return reply(jobView(j,j.kind==='run'&&!a.assessment_restricted||resultsVisible(a,role)));}
  fail(404,'NOT_FOUND','Paper 4 operation not found.');
 });
}
