import { transaction } from './db.mjs';
import { HttpError, fail, field, bytes, uuid, integer } from './security.mjs';
import { parsePaper4Import } from './paper4-import.mjs';
import { parsePaper4BatchImport, exportPaper4Collection } from './paper4-collection.mjs';
import { paper4ExamInput, paper4ShortTitle, paper4ShortTitleInput } from './paper4-catalog.mjs';
import {audienceClasses,audienceStudents,defaultClassStudents,replaceAudienceClasses,activityClasses} from './activity-audience.mjs';

const staff = user => user.roles.includes('teacher') || user.roles.includes('admin');
const admin = user => user.roles.includes('admin');
const keyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const filePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,75}\.(?:txt|csv|dat)$/i;
const respond = (status, body) => ({ status, body });
const one = (result, message='资源不存在') => {
 if (!result.rowCount) fail(404, 'NOT_FOUND', message);
 return result.rows[0];
};
function key(value, name) {
 if (typeof value !== 'string' || !keyPattern.test(value)) fail(400, 'VALIDATION', `${name}格式无效`);
 return value;
}
function optionalText(value, name, max=2000) {
 return value === undefined || value === null ? '' : field(value, name, {min:0,max});
}
function time(value, name) {
 if (value === undefined || value === null || value === '') return null;
 const date = new Date(value);
 if (typeof value !== 'string' || !Number.isFinite(date.getTime())) fail(400, 'VALIDATION', `${name}无效`);
 return date;
}
function requestedPaperVersion(url,body){
 const query=url.searchParams.get('versionId');
 const queryId=query===null?null:uuid(query,'试卷版本 ID').toLowerCase();
 const bodyId=body?.versionId===undefined?null:uuid(body.versionId,'试卷版本 ID').toLowerCase();
 if(queryId&&bodyId&&queryId!==bodyId)fail(400,'VERSION_MISMATCH','请求中的试卷版本不一致');
 return bodyId??queryId;
}
function fileMap(value, name, {maxFiles=16,maxBytes=524288}={}) {
 if (value === undefined || value === null) return {};
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(400,'VALIDATION',`${name}必须是文件名到文本的映射`);
 const entries = Object.entries(value);
 if (entries.length > maxFiles) fail(400,'VALIDATION',`${name}文件数量过多`);
 let total = 0; const output = {};
 for (const [filename,content] of entries) {
  if (!filePattern.test(filename) || filename.includes('..')) fail(400,'VALIDATION',`${name}包含无效文件名`);
  const text = bytes(content,`${name} ${filename}`,65536); total += Buffer.byteLength(text);
  if (total > maxBytes) fail(413,'TOO_LARGE',`${name}文件总量过大`);
  output[filename]=text;
 }
 return output;
}
function definitionInput(value, exam={}) {
 if (!Array.isArray(value) || value.length<1 || value.length>3) fail(400,'VALIDATION','试卷须包含 1–3 道大题');
 const questionKeys = new Set(), stageIds = new Set(); let totalMarks=0;
 const questions=value.map((q,position)=>{
  if (!q || typeof q !== 'object' || Array.isArray(q)) fail(400,'VALIDATION','大题格式无效');
  const questionKey=key(q.key,`第 ${position+1} 题键`);
  if (questionKeys.has(questionKey)) fail(400,'VALIDATION','大题键不能重复');
  questionKeys.add(questionKey);
  if (!Array.isArray(q.stages) || !q.stages.length || q.stages.length>30) fail(400,'VALIDATION','每道大题须包含 1–30 个评分阶段');
  const stages=q.stages.map(s=>{
   if (!s || typeof s !== 'object' || Array.isArray(s)) fail(400,'VALIDATION','评分阶段格式无效');
   const id=key(s.id,'阶段 ID'); if(stageIds.has(id))fail(400,'VALIDATION','阶段 ID 不能重复');stageIds.add(id);
   const maxMarks=integer(s.maxMarks,1,75,'阶段满分');totalMarks += maxMarks;
   const judgeMode=s.judgeMode;
   if(judgeMode!=='auto'&&judgeMode!=='manual'&&judgeMode!=='evidence')
    fail(400,'VALIDATION','每个评分阶段须明确选择自动测试、人工复核或过程证据');
   return {id,title:field(s.title,'阶段标题',{max:120}),description:optionalText(s.description,'阶段说明',4000),maxMarks,judgeMode};
  });
  const initialFiles=fileMap(q.initialFiles,'初始文件');
  const outputFiles=q.outputFiles??[];
  if(!Array.isArray(outputFiles)||outputFiles.length>16||outputFiles.some(name=>typeof name!=='string'||!filePattern.test(name)||name.includes('..'))
   ||new Set(outputFiles).size!==outputFiles.length)fail(400,'VALIDATION','输出文件清单无效');
  if(new Set([...Object.keys(initialFiles),...outputFiles]).size>16)
   fail(400,'VALIDATION','初始文件和输出文件合计不得超过 16 个');
  return {key:questionKey,title:field(q.title,'大题标题',{max:160}),statement:field(q.statement,'大题说明',{min:0,max:100000}),
   starterCode:bytes(q.starterCode??'','起始代码'),initialFiles,outputFiles,stages};
 });
 if(totalMarks!==75) fail(400,'VALIDATION',`全卷评分点总分须为 75 分，当前为 ${totalMarks} 分`);
 return {language:'python',questions,totalMarks,exam:paper4ExamInput(exam)};
}
function casesInput(value,definition) {
 if (value === undefined || value === null) return {};
 if (!value || typeof value !== 'object' || Array.isArray(value))fail(400,'VALIDATION','测试用例格式无效');
 const stages=new Map(definition.questions.flatMap(q=>q.stages.map(s=>[s.id,{question:q,stage:s}]))),output={};let total=0;
 for(const [stageId,cases] of Object.entries(value)){
  const owner=stages.get(stageId);
  if(!owner||owner.stage.judgeMode!=='auto'||!Array.isArray(cases)||cases.length>12)
   fail(400,'VALIDATION','测试用例须属于自动评测阶段且每阶段最多 12 个');
  const ids=new Set();output[stageId]=cases.map((item,index)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))fail(400,'VALIDATION','测试用例格式无效');
   const id=key(item.id??`case${index+1}`,'用例 ID');if(ids.has(id))fail(400,'VALIDATION','用例 ID 不能重复');ids.add(id);
   if(item.public!==undefined&&typeof item.public!=='boolean')fail(400,'VALIDATION','公开状态无效');
   if(item.expectedStdout===undefined&&item.expectedFiles===undefined)fail(400,'VALIDATION','用例须给出预期输出或文件');
   const expectedStdout=item.expectedStdout===undefined?undefined:bytes(item.expectedStdout,'预期输出',65536);
   const inputFiles=fileMap(item.inputFiles,'用例输入文件',{maxBytes:131072});
   const expectedFiles=fileMap(item.expectedFiles,'用例预期文件',{maxBytes:131072});
   const question=owner.question;
   if(new Set([...Object.keys(question.initialFiles),...Object.keys(inputFiles),...question.outputFiles,...Object.keys(expectedFiles)]).size>16)
    fail(400,'VALIDATION','单个用例的初始文件、覆盖文件和输出文件合计不得超过 16 个');
   const result={id,stdin:bytes(item.stdin??'','标准输入',65536),inputFiles,
    expectedFiles,public:item.public===true};
   if(expectedStdout!==undefined)result.expectedStdout=expectedStdout;
   if(item.driverCode!==undefined)result.driverCode=bytes(item.driverCode,'测试驱动代码',16384);
   return result;
  });total+=cases.length;
 }
 if(total>50)fail(400,'VALIDATION','整卷测试用例数量过多');
 return output;
}
function referenceSolutionsInput(value,definition){
 if(value===undefined||value===null)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'VALIDATION','参考答案须为大题键到代码的映射');
 const known=new Set(definition.questions.map(q=>q.key));const solutions={};
 for(const [questionKey,source] of Object.entries(value)){
  if(!known.has(questionKey))fail(400,'VALIDATION','参考答案包含未知大题');
  solutions[questionKey]=bytes(source,`参考答案 ${questionKey}`);
 }
 return solutions;
}
function validateStageCoverage(definition,runnerCases,referenceSolutions){
 for(const question of definition.questions){
  const automatic=question.stages.filter(stage=>stage.judgeMode==='auto');
  if(!automatic.length)fail(409,'AUTO_COVERAGE_REQUIRED',`大题 ${question.key} 至少需要一个自动评测阶段`);
  if(!referenceSolutions[question.key]?.trim())fail(409,'REFERENCE_REQUIRED',`大题 ${question.key} 缺少参考答案`);
  for(const stage of automatic){
   if(!runnerCases[stage.id]?.length)fail(409,'STAGE_CASES_REQUIRED',`阶段 ${stage.id} 缺少测试用例`);
  }
 }
}
function canManage(user,paper){return admin(user)||paper.owner_account_id===user.id;}
function deliveryShape(p){return {deliveryKind:p.delivery_kind,activityKind:p.activity_kind??null,
 sourcePaperId:p.source_paper_id??null,sourceVersionId:p.source_version_id??null};}
function catalogOnly(p){if(p.delivery_kind!=='catalog')fail(409,'CATALOG_REQUIRED','请从自由练习题库选择试卷');}
function rejectCatalogSchedule(body){
 if(['classId','startsAt','endsAt'].some(name=>body[name]!==undefined&&body[name]!==null&&body[name]!=='')||
  ['classIds','participants'].some(name=>body[name]!==undefined&&(!Array.isArray(body[name])||body[name].length)))
  fail(400,'SEPARATE_ACTIVITY_REQUIRED','上架自由练习不设置班级或时间；请另行布置班级练习或模拟考试');
}

async function activityRecipient(db,paperId,identityId){
 if(!(await db.query('SELECT 1 FROM paper4_activity_participants WHERE paper_id=$1 AND identity_id=$2',[paperId,identityId])).rowCount)
  fail(403,'FORBIDDEN','您不在此活动的适用学生名单中');
}
async function saveActivityAudience(db,paperId,participants,classIds){
 await replaceAudienceClasses(db,paperId,classIds,'paper4');
 await db.query('DELETE FROM paper4_activity_participants WHERE paper_id=$1',[paperId]);
 for(const identityId of participants)await db.query('INSERT INTO paper4_activity_participants(paper_id,identity_id) VALUES($1,$2)',[paperId,identityId]);
}
async function audienceShape(db,p,user,result,{includeParticipants=true}={}){
 if(p.delivery_kind!=='activity')return {...result,classIds:[],classes:[],participantCount:0};
 const classes=await activityClasses(db,p.id,'paper4');
 const count=(await db.query('SELECT count(*)::int n FROM paper4_activity_participants WHERE paper_id=$1',[p.id])).rows[0].n;
 Object.assign(result,{classIds:classes.map(c=>c.id),classes,participantCount:count});
 if(includeParticipants&&canManage(user,p)){
  const rows=(await db.query(`SELECT i.id "identityId",i.name,i.number FROM paper4_activity_participants part
   JOIN identities i ON i.id=part.identity_id WHERE part.paper_id=$1 ORDER BY i.number,i.id`,[p.id])).rows;
  result.participants=rows.map(row=>row.identityId);result.participantDetails=rows;
 }
 return result;
}
async function studentAllowed(db,user,paper){
 if(!user.roles.includes('student'))fail(403,'FORBIDDEN','仅学生可开始练习');
 if(paper.status!=='published')fail(404,'NOT_FOUND','试卷尚未发布');
 if(paper.archived_at)fail(404,'NOT_FOUND','试卷已归档');
 if(paper.delivery_kind==='activity')await activityRecipient(db,paper.id,user.identityId);
 if(paper.starts_at&&paper.starts_at>new Date())fail(409,'NOT_STARTED','练习尚未开始');
}
async function getPaper(db,user,id,{includeDraft=false,view='current',versionId=null}={}){
 if(view!=='current'&&view!=='draft')fail(400,'VALIDATION','试卷版本视图无效');
 if(versionId!==null){versionId=uuid(versionId,'试卷版本 ID').toLowerCase();if(view==='draft')fail(400,'VERSION_MISMATCH','固定已发布版本不能同时选择草稿视图');}
 const paper=one(await db.query(`SELECT p.id,p.owner_account_id,p.current_version_id,p.draft_version_id,p.status paper_status,
  p.published_at paper_published_at,p.archived_at,p.created_at,p.updated_at,p.short_title,p.delivery_kind,p.activity_kind,p.source_paper_id,p.source_version_id,
  v.id version_id,v.version_number,v.draft_revision,v.title,v.description,v.class_id,v.starts_at,v.ends_at,
  v.published_at version_published_at,v.definition,v.runner_cases,v.reference_solutions,c.name class_name
  FROM paper4_papers p JOIN paper4_versions v ON v.id=CASE WHEN $3::uuid IS NOT NULL THEN $3::uuid WHEN $2::boolean THEN p.draft_version_id ELSE p.current_version_id END AND v.paper_id=p.id
  LEFT JOIN classes c ON c.id=v.class_id WHERE p.id=$1`,[uuid(id,'试卷 ID'),view==='draft',versionId]));
 paper.status=paper.paper_status;
 if(versionId!==null&&(!paper.version_published_at||paper.status!=='published'||paper.archived_at))fail(404,'NOT_FOUND','指定的已发布试卷版本不可用');
 if(!canManage(user,paper)){
  if(includeDraft||view==='draft')fail(403,'FORBIDDEN','无权管理此试卷');
  if(!(staff(user)&&paper.delivery_kind==='catalog'&&paper.status==='published'&&!paper.archived_at))
   await studentAllowed(db,user,paper);
 }
 if(versionId!==null&&paper.delivery_kind==='activity'&&versionId!==paper.current_version_id)
  fail(409,'ACTIVITY_VERSION_IMMUTABLE','已布置活动只能使用其固定版本');
 return paper;
}
function paperShape(p,user){
 const manage=canManage(user,p);
 return {id:p.id,title:p.title,shortTitle:paper4ShortTitle(p),description:p.description,...deliveryShape(p),...paper4ExamInput(p.definition?.exam),classId:p.class_id,className:p.class_name??null,
  status:p.version_published_at?'published':'draft',startsAt:p.starts_at,endsAt:p.ends_at,
  publishedAt:p.version_published_at,archivedAt:p.archived_at??null,versionId:p.version_id,versionNumber:p.version_number,
  hasDraft:manage&&!!p.draft_version_id,canAssign:staff(user)&&p.delivery_kind==='catalog'&&p.version_id===p.current_version_id&&!!p.version_published_at&&!p.archived_at,totalMarks:p.definition?.totalMarks??75,
  questions:p.definition?.questions??[],language:'python',firstAcPointsPerQuestion:10,canManage:manage,
  canExport:manage&&staff(user)&&(admin(user)||p.owner_account_id===user.id),
  ...(manage?{runnerCases:p.runner_cases??{},referenceSolutions:p.reference_solutions??{}}:{})};
}
async function referenceValidation(db,p){
 // A class activity is an exact frozen copy. Reuse the original validation
 // only while all judged content and references are byte-for-byte equivalent
 // as JSONB; later edited activity drafts must be validated independently.
 if(p.source_version_id){
  const source=(await db.query(`SELECT v.id version_id,v.draft_revision,v.definition,v.runner_cases,v.reference_solutions
   FROM paper4_versions v WHERE v.id=$1 AND v.paper_id=$2 AND v.published_at IS NOT NULL
    AND v.definition=$3::jsonb AND v.runner_cases=$4::jsonb AND v.reference_solutions=$5::jsonb`,
   [p.source_version_id,p.source_paper_id,JSON.stringify(p.definition),JSON.stringify(p.runner_cases),JSON.stringify(p.reference_solutions)])).rows[0];
  if(source)return referenceValidation(db,source);
 }

 const automatic=p.definition.questions.flatMap(q=>q.stages.filter(s=>s.judgeMode==='auto'));
 const answer=Object.fromEntries(automatic.map(s=>[s.id,{status:'unverified',taskId:null}]));
 if(!automatic.length)return answer;
 const rows=(await db.query(`SELECT DISTINCT ON (rs.stage_key) rs.stage_key,rs.runner_cases,t.id task_id,t.state,
   r.status run_status,r.private_results
  FROM paper4_reference_snapshots rs JOIN paper4_run_tasks t ON t.reference_snapshot_id=rs.id
  LEFT JOIN LATERAL (SELECT status,private_results FROM paper4_runs WHERE task_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
  WHERE rs.version_id=$1 AND rs.draft_revision=$2
  ORDER BY rs.stage_key,rs.created_at DESC,rs.id DESC`,[p.version_id,p.draft_revision])).rows;
 for(const row of rows){
  if(!answer[row.stage_key])continue;
  const expected=Array.isArray(row.runner_cases)?row.runner_cases.map(item=>item.id):[];
  const actual=Array.isArray(row.private_results)?row.private_results:[];
  const complete=expected.length>0&&actual.length===expected.length&&
   new Set(actual.map(item=>item.caseId)).size===expected.length&&
   actual.every(item=>item.stageId===row.stage_key&&item.status==='AC'&&expected.includes(item.caseId));
  const status=row.state==='failed'||row.run_status==='AC'&&!complete?'error':row.run_status??row.state;
  answer[row.stage_key]={status,taskId:row.task_id};
 }
 return answer;
}
async function validatePublishable(db,user,p){
 if(p.delivery_kind==='activity'){
  if(!(await db.query('SELECT 1 FROM paper4_activity_participants WHERE paper_id=$1 LIMIT 1',[p.id])).rowCount)
   fail(409,'PARTICIPANTS_REQUIRED','发布活动前请选择适用学生');
  if(p.activity_kind==='exam'&&(!p.starts_at||!p.ends_at))fail(400,'VALIDATION','模拟考试必须设置开始时间和截止时间');
 }
 else if(p.class_id||p.starts_at||p.ends_at)fail(400,'SEPARATE_ACTIVITY_REQUIRED','自由练习不能设置班级或时间');
 if(p.ends_at&&p.ends_at<=new Date())fail(409,'DEADLINE_PASSED','截止时间已过，请调整后发布');
 validateStageCoverage(p.definition,p.runner_cases,p.reference_solutions);
 const validation=await referenceValidation(db,p);
 const missing=Object.entries(validation).filter(([,result])=>result.status!=='AC').map(([stageId])=>stageId);
 if(missing.length)fail(409,'REFERENCE_NOT_VALIDATED',`参考答案尚未通过全部自动测试：${missing.join('、')}`);
}
async function publishDraft(db,user,p){
 // Scheduling does not change code, tests or the reference snapshot revision.
 await db.query('UPDATE paper4_versions SET class_id=$2,starts_at=$3,ends_at=$4,published_at=now() WHERE id=$1',
  [p.version_id,p.class_id,p.starts_at,p.ends_at]);
 await db.query(`UPDATE paper4_papers SET current_version_id=$2,draft_version_id=NULL,status='published',published_at=now(),
  title=$3,description=$4,class_id=$5,starts_at=$6,ends_at=$7,updated_at=now() WHERE id=$1`,
  [p.id,p.version_id,p.title,p.description,p.class_id,p.starts_at,p.ends_at]);
 await log(db,user,'paper4.publish','paper4_paper',p.id,{versionId:p.version_id});
}
async function paperResult(db,p,user){
 const result=await audienceShape(db,p,user,paperShape(p,user));
 if(canManage(user,p))result.referenceValidation=await referenceValidation(db,p);
 return result;
}
async function getAttempt(db,user,id,{forUpdate=false}={}){
 const attempt=one(await db.query(`SELECT a.*,p.owner_account_id,p.archived_at,p.short_title,p.delivery_kind,p.activity_kind,p.source_paper_id,p.source_version_id,v.class_id,v.title paper_title,
  v.starts_at,v.ends_at,v.version_number,i.name student_name,
  v.definition,v.runner_cases FROM paper4_attempts a JOIN paper4_papers p ON p.id=a.paper_id
  JOIN paper4_versions v ON v.id=a.version_id JOIN identities i ON i.id=a.identity_id
  WHERE a.id=$1 ${forUpdate?'FOR UPDATE OF a':''}`,[uuid(id,'答卷 ID')]));
 if(attempt.identity_id!==user.identityId&&!canManage(user,attempt))fail(403,'FORBIDDEN','无权查看此答卷');
 if(!canManage(user,attempt)&&attempt.delivery_kind==='activity')await activityRecipient(db,attempt.paper_id,user.identityId);
 return attempt;
}
async function attemptShape(db,user,attempt){
 const manage=canManage(user,attempt),own=attempt.identity_id===user.identityId;
 const files=(await db.query('SELECT question_key,content,revision,updated_at FROM paper4_attempt_files WHERE attempt_id=$1 ORDER BY question_key',[attempt.id])).rows;
 const snapshots=(await db.query('SELECT id,question_key,stage_key,source_code,revision,created_at FROM paper4_snapshots WHERE attempt_id=$1 ORDER BY created_at,id',[attempt.id])).rows;
 const gradeRows=(await db.query('SELECT stage_key,marks,note,updated_at FROM paper4_stage_marks WHERE attempt_id=$1 ORDER BY stage_key',[attempt.id])).rows;
 const rankAwards=(await db.query(`SELECT question_key,points,version_id,created_at
  FROM paper4_rank_ledger WHERE paper_id=$1 AND identity_id=$2 ORDER BY created_at,question_key`,
  [attempt.source_paper_id??attempt.paper_id,attempt.identity_id])).rows;
 const formalJudging=(await db.query(`SELECT count(*)::int total,
  count(*) FILTER(WHERE t.state IN ('queued','leased'))::int pending,
  count(*) FILTER(WHERE t.state='completed')::int completed,
  count(*) FILTER(WHERE t.state='failed')::int failed
  FROM paper4_snapshots s JOIN paper4_run_tasks t ON t.snapshot_id=s.id
  WHERE s.attempt_id=$1 AND s.origin='formal'`,[attempt.id])).rows[0];
 const visibleMarks=manage||!!attempt.released_at;
 const marks=visibleMarks?gradeRows.map(m=>({stageId:m.stage_key,marks:m.marks,note:m.note,updatedAt:m.updated_at})):[];
 const score=visibleMarks&&gradeRows.length?gradeRows.reduce((sum,m)=>sum+m.marks,0):null;
 const paperAudience=await audienceShape(db,{...attempt,id:attempt.paper_id},user,{},{includeParticipants:false});
 return {id:attempt.id,paperId:attempt.paper_id,versionId:attempt.version_id,attemptNumber:attempt.attempt_number,identityId:manage?attempt.identity_id:undefined,
  studentIdentityId:manage?attempt.identity_id:undefined,studentName:manage?attempt.student_name:undefined,
  status:attempt.state,startedAt:attempt.started_at,submittedAt:attempt.submitted_at,releasedAt:attempt.released_at,
  files:files.map(f=>({fileKey:f.question_key,content:f.content,revision:f.revision,updatedAt:f.updated_at})),
  snapshots:snapshots.map(s=>({id:s.id,fileKey:s.question_key,stageId:s.stage_key,sourceCode:s.source_code,revision:s.revision,createdAt:s.created_at})),
  marks,score,totalMarks:75,firstAcPointsPerQuestion:10,formalJudging,rankAwards:rankAwards.map(a=>({questionKey:a.question_key,points:a.points,
   versionId:a.version_id,createdAt:a.created_at})),paper:{id:attempt.paper_id,title:attempt.paper_title,shortTitle:paper4ShortTitle({...attempt,title:attempt.paper_title}),...deliveryShape(attempt),...paperAudience,...paper4ExamInput(attempt.definition?.exam),classId:attempt.class_id,
   status:'published',versionId:attempt.version_id,versionNumber:attempt.version_number,
   startsAt:attempt.starts_at,endsAt:attempt.ends_at,totalMarks:75,
   questions:attempt.definition.questions,language:'python'},canManage:manage,
  canEdit:own&&attempt.state==='active'&&!attempt.archived_at&&(!attempt.ends_at||attempt.ends_at>new Date())};
}
async function writableAttempt(db,user,id){
 // Take the paper lock before the attempt lock. Archive takes the exclusive
 // paper lock, so a save is either completed before archive or sees it after.
 const preliminary=await getAttempt(db,user,id);
 const paper=one(await db.query('SELECT archived_at FROM paper4_papers WHERE id=$1 FOR SHARE',[preliminary.paper_id]));
 const attempt=await getAttempt(db,user,id,{forUpdate:true});
 if(attempt.identity_id!==user.identityId||!user.roles.includes('student'))fail(403,'FORBIDDEN','只能修改自己的答卷');
 if(attempt.state!=='active')fail(409,'ATTEMPT_SUBMITTED','答卷已提交，不能继续修改');
 if(paper.archived_at)fail(409,'PAPER_ARCHIVED','试卷已归档，暂不能继续作答');
 if(attempt.delivery_kind==='activity')await activityRecipient(db,attempt.paper_id,user.identityId);
 if(attempt.starts_at&&attempt.starts_at>new Date())fail(409,'NOT_STARTED','练习尚未开始');
 if(attempt.ends_at&&attempt.ends_at<=new Date())fail(409,'DEADLINE_PASSED','练习已截止');
 return attempt;
}
function questionFor(attempt,fileKey){
 const question=attempt.definition.questions.find(q=>q.key===fileKey);
 if(!question)fail(404,'NOT_FOUND','题号不存在');return question;
}
async function snapshotDraft(db,attempt,questionKey,stageKey,{origin='practice'}={}){
 const draft=one(await db.query('SELECT content,revision FROM paper4_attempt_files WHERE attempt_id=$1 AND question_key=$2',[attempt.id,questionKey]));
 return one(await db.query('INSERT INTO paper4_snapshots(attempt_id,question_key,stage_key,source_code,revision,origin) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
  [attempt.id,questionKey,stageKey,draft.content,draft.revision,origin]));
}
async function queueFormalQuestionRuns(db,attempt){
 for(const question of attempt.definition.questions){
  const snapshot=await snapshotDraft(db,attempt,question.key,null,{origin:'formal'});
  await db.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1)',[snapshot.id]);
 }
}
// A deadline is enforced by the server even if no student keeps the page open.
// The first authorized read after expiry freezes every saved source exactly
// once; row locks serialize this against edits and concurrent readers.
async function closeExpiredAttempts(pool,{paperId=null,attemptId=null}={}){
 await transaction(pool,async db=>{
  const rows=(await db.query(`SELECT a.id,a.paper_id,v.definition,v.ends_at FROM paper4_attempts a
   JOIN paper4_papers p ON p.id=a.paper_id JOIN paper4_versions v ON v.id=a.version_id
   WHERE a.state='active' AND v.ends_at IS NOT NULL AND v.ends_at<=clock_timestamp()
    AND ($1::uuid IS NULL OR a.paper_id=$1) AND ($2::uuid IS NULL OR a.id=$2)
   ORDER BY a.id FOR UPDATE OF a`,[paperId,attemptId])).rows;
  for(const a of rows){
   await queueFormalQuestionRuns(db,a);
   await db.query("UPDATE paper4_attempts SET state='submitted',submitted_at=$2 WHERE id=$1 AND state='active'",[a.id,a.ends_at]);
   await db.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata)
    VALUES(NULL,'paper4.deadline_submit','paper4_attempt',$1,$2::jsonb)`,[a.id,JSON.stringify({paperId:a.paper_id,deadline:a.ends_at})]);
  }
 });
}
async function log(db,user,action,type,id,metadata={}){
 await db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)',
  [user.id,action,type,String(id),JSON.stringify(metadata)]);
}
function summary(p,user){return {id:p.id,title:p.title,shortTitle:paper4ShortTitle(p),description:p.description,...deliveryShape(p),...paper4ExamInput(p.definition?.exam),classId:p.class_id,className:p.class_name??null,status:p.status,
 archivedAt:p.archived_at??null,
 startsAt:p.starts_at,endsAt:p.ends_at,totalMarks:p.definition?.totalMarks??75,
 questionCount:p.definition?.questions?.length??0,versionId:p.current_version_id,versionNumber:p.version_number,
 hasDraft:canManage(user,p)&&!!p.draft_version_id,canManage:canManage(user,p),
 canAssign:staff(user)&&p.delivery_kind==='catalog'&&p.status==='published'&&!p.archived_at,
 canExport:canManage(user,p)&&staff(user)&&(admin(user)||p.owner_account_id===user.id)};}

function normalizeImportedPaper(draft){
 const title=field(draft.title,'试卷标题',{max:200}),description=optionalText(draft.description,'试卷说明',4000);
 const definition=definitionInput(draft.questions,draft),runnerCases=casesInput(draft.runnerCases,definition);
 const referenceSolutions=referenceSolutionsInput(draft.referenceSolutions,definition);
 return {title,shortTitle:paper4ShortTitle({title,definition,shortTitle:paper4ShortTitleInput(draft.shortTitle)}),description,definition,runnerCases,referenceSolutions};
}
async function insertImportedCatalogDraft(db,user,draft){
 const p=one(await db.query('INSERT INTO paper4_papers(owner_account_id,title,description,short_title) VALUES($1,$2,$3,$4) RETURNING id',
  [user.id,draft.title,draft.description,draft.shortTitle]));
 const v=one(await db.query(`INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,reference_solutions)
  VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) RETURNING id`,[p.id,draft.title,draft.description,
   JSON.stringify(draft.definition),JSON.stringify(draft.runnerCases),JSON.stringify(draft.referenceSolutions)]));
 await db.query('UPDATE paper4_papers SET current_version_id=$2,draft_version_id=$2 WHERE id=$1',[p.id,v.id]);
 await log(db,user,'paper4.import','paper4_paper',p.id);return p.id;
}
function selectedPaperIds(body){
 if(!Array.isArray(body.paperIds)||body.paperIds.length<1||body.paperIds.length>100)fail(400,'VALIDATION','每次请选择 1–100 套试卷');
 const ids=body.paperIds.map(id=>uuid(id,'试卷 ID').toLowerCase());
 if(new Set(ids).size!==ids.length)fail(400,'VALIDATION','试卷 ID 不能重复');return ids;
}
function activityInput(body){
 const activityKind=body.activityKind;
 if(!['practice','exam'].includes(activityKind))fail(400,'VALIDATION','请选择练习或模拟考试');
 const startsAt=time(body.startsAt,'开始时间'),endsAt=time(body.endsAt,'截止时间');
 if(startsAt&&endsAt&&endsAt<=startsAt)fail(400,'VALIDATION','截止时间须晚于开始时间');
 if(activityKind==='exam'&&(!startsAt||!endsAt))fail(400,'VALIDATION','模拟考试需要完整的开始和截止时间');
 if(endsAt&&endsAt<=new Date())fail(409,'DEADLINE_PASSED','截止时间已过，请调整后布置');
 return {activityKind,startsAt,endsAt};
}
async function selectedActivitySources(db,user,ids){
 // Lock in a stable order, just as publication and archive do. No audience,
 // activity or audit rows are written until the complete selection is valid.
 await db.query('SELECT id FROM paper4_papers WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids]);
 const sources=[];
 for(const id of ids){
  const source=await getPaper(db,user,id);catalogOnly(source);
  if(source.paper_status!=='published'||!source.version_published_at||source.archived_at)
   fail(409,'PUBLISHED_SOURCE_REQUIRED','请先上架试卷，再布置活动');
  await validatePublishable(db,user,source);sources.push(source);
 }
 return sources;
}
async function createActivity(db,user,source,{activityKind,startsAt,endsAt,classIds,participants,title=source.title}){
 const classId=classIds[0]??null;
 const p=one(await db.query(`INSERT INTO paper4_papers
  (owner_account_id,class_id,title,description,short_title,starts_at,ends_at,delivery_kind,activity_kind,source_paper_id,source_version_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,'activity',$8,$9,$10) RETURNING id`,
  [user.id,classId,title,source.description,paper4ShortTitle(source),startsAt,endsAt,activityKind,source.id,source.version_id]));
 const v=one(await db.query(`INSERT INTO paper4_versions
  (paper_id,title,description,class_id,starts_at,ends_at,definition,runner_cases,reference_solutions)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING id`,
  [p.id,title,source.description,classId,startsAt,endsAt,JSON.stringify(source.definition),JSON.stringify(source.runner_cases),JSON.stringify(source.reference_solutions)]));
 await db.query('UPDATE paper4_papers SET current_version_id=$2,draft_version_id=$2 WHERE id=$1',[p.id,v.id]);
 await saveActivityAudience(db,p.id,participants,classIds);
 await publishDraft(db,user,{...source,id:p.id,version_id:v.id,title,class_id:classId,starts_at:startsAt,ends_at:endsAt});
 await log(db,user,'paper4.activity_create','paper4_paper',p.id,{sourcePaperId:source.id,sourceVersionId:source.version_id,activityKind,classIds,participantCount:participants.length});
 return p.id;
}

export async function handlePaper4(ctx){
 const {route,method,body,user,pool,url}=ctx;
 if(!route.startsWith('/paper4/'))return null;
 let m;
 if(['/paper4/imports/batch-preview','/paper4/papers/batch-import'].includes(route)&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const parsed=parsePaper4BatchImport(body);
  const drafts=parsed.items.map(item=>{
   try{return normalizeImportedPaper(item.createBody);}catch(error){
    if(error instanceof HttpError)fail(error.status,error.code,`${item.sourceFilename}: ${error.message}`);throw error;
   }
  });
  if(route==='/paper4/imports/batch-preview')return respond(200,{totalPapers:parsed.totalPapers,
   items:parsed.items.map(item=>({sourceFilename:item.sourceFilename,preview:item.preview}))});
  const items=await transaction(pool,async db=>{
   const ids=[];for(const draft of drafts)ids.push(await insertImportedCatalogDraft(db,user,draft));
   await log(db,user,'paper4.batch_import','paper4_batch',ids[0],{paperIds:ids,count:ids.length});
   const results=[];for(const id of ids)results.push(await paperResult(db,await getPaper(db,user,id,{includeDraft:true}),user));return results;
  });
  return respond(201,{items,count:items.length});
 }
 if(route==='/paper4/papers/batch-export'&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');const ids=selectedPaperIds(body);
  const envelope=await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids]);
   const papers=[];
   for(const id of ids){
    const paper=await getPaper(db,user,id,{includeDraft:true});
    if(!admin(user)&&paper.owner_account_id!==user.id)fail(403,'FORBIDDEN','只有试卷创建者或管理员可以导出完整题包');
    papers.push(paper);
   }
   const result=exportPaper4Collection(papers);
   await log(db,user,'paper4.batch_export','paper4_batch',ids[0],{paperIds:ids,count:ids.length});return result;
  });return respond(200,envelope);
 }
 if(route==='/paper4/papers/batch-activities'&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const ids=selectedPaperIds(body),activity=activityInput(body);
  const items=await transaction(pool,async db=>{
   const sources=await selectedActivitySources(db,user,ids);
   const classIds=await audienceClasses(db,user,body,null,'paper4');
   const participants=await audienceStudents(db,body.participants,{allowEmpty:false});
   const activities=[];
   for(const source of sources)activities.push(await createActivity(db,user,source,{...activity,classIds,participants}));
   await log(db,user,'paper4.batch_activity_create','paper4_batch',activities[0],{paperIds:ids,activityIds:activities,count:activities.length,classIds,participantCount:participants.length});
   const results=[];for(const id of activities)results.push(await paperResult(db,await getPaper(db,user,id,{includeDraft:true}),user));return results;
  });return respond(201,{count:items.length,items});
 }
 if(route==='/paper4/imports/preview'&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const parsed=parsePaper4Import({filename:body.filename,contentBase64:body.contentBase64});
  const draft=parsed.createBody;
  const title=field(draft.title,'试卷标题',{max:200});
  const description=optionalText(draft.description,'试卷说明',4000);
  const classId=draft.classId===undefined||draft.classId===null||draft.classId===''?null:uuid(draft.classId,'班级 ID');
  const startsAt=time(draft.startsAt,'开始时间'),endsAt=time(draft.endsAt,'截止时间');
  if(startsAt&&endsAt&&endsAt<=startsAt)fail(400,'VALIDATION','截止时间须晚于开始时间');
  const definition=definitionInput(draft.questions,draft);
  const runnerCases=casesInput(draft.runnerCases,definition);
  const referenceSolutions=referenceSolutionsInput(draft.referenceSolutions,definition);
  return respond(200,{preview:parsed.preview,createBody:{title,shortTitle:paper4ShortTitleInput(draft.shortTitle),description,...definition.exam,classId,
   startsAt:startsAt?.toISOString()??null,endsAt:endsAt?.toISOString()??null,
   questions:definition.questions,runnerCases,referenceSolutions}});
 }
 if(route==='/paper4/papers'&&method==='GET'){
  const scope=url.searchParams.get('scope');
  if(scope!==null&&!['catalog','activities'].includes(scope))fail(400,'VALIDATION','试卷范围无效');
  const papers=(await pool.query(`SELECT p.*,c.name class_name,v.definition,v.version_number FROM paper4_papers p
   LEFT JOIN classes c ON c.id=p.class_id JOIN paper4_versions v ON v.id=p.current_version_id
   WHERE ($5::text IS NULL OR p.delivery_kind=CASE WHEN $5='activities' THEN 'activity' ELSE $5 END) AND (
    p.owner_account_id=$1
    OR $2::boolean OR p.status='published' AND p.archived_at IS NULL AND (
     p.delivery_kind='catalog' AND ($3::boolean OR $6::boolean) OR $3::boolean AND p.delivery_kind='activity' AND
     EXISTS(SELECT 1 FROM paper4_activity_participants part WHERE part.paper_id=p.id AND part.identity_id=$4)))
   ORDER BY p.created_at DESC,p.id DESC LIMIT 500`,[user.id,admin(user),user.roles.includes('student'),user.identityId,scope,staff(user)])).rows;
  return respond(200,{items:await Promise.all(papers.map(p=>audienceShape(pool,p,user,summary(p,user))))});
 }
 if(route==='/paper4/papers'&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const title=field(body.title,'试卷标题',{max:200}),description=optionalText(body.description,'试卷说明',4000);
  const startsAt=time(body.startsAt,'开始时间'),endsAt=time(body.endsAt,'截止时间');
  if(startsAt&&endsAt&&endsAt<=startsAt)fail(400,'VALIDATION','截止时间须晚于开始时间');
  // Explicit class/time creation remains a class activity for old clients;
  // omitting them creates an unrestricted catalogue draft.
  if(body.participants!==undefined&&!Array.isArray(body.participants))fail(400,'VALIDATION','适用学生须为身份 ID 数组');
  const deliveryKind=body.deliveryKind==='activity'||body.classId||body.classIds?.length||body.participants!==undefined||startsAt||endsAt?'activity':'catalog';
  const activityKind=deliveryKind==='activity'?(startsAt&&endsAt?'exam':'practice'):null;
  const definition=definitionInput(body.questions,body),runnerCases=casesInput(body.runnerCases,definition);
  const shortTitle=paper4ShortTitle({title,definition,shortTitle:paper4ShortTitleInput(body.shortTitle)});
  const referenceSolutions=referenceSolutionsInput(body.referenceSolutions,definition);
  const id=await transaction(pool,async db=>{
   const classIds=await audienceClasses(db,user,body,null,'paper4'),classId=classIds[0]??null;
   const participants=deliveryKind==='activity'?await audienceStudents(db,body.participants??await defaultClassStudents(db,classIds)):[];
   const p=one(await db.query('INSERT INTO paper4_papers(owner_account_id,class_id,title,description,short_title,starts_at,ends_at,delivery_kind,activity_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [user.id,classId,title,description,shortTitle,startsAt,endsAt,deliveryKind,activityKind]));
   const v=one(await db.query(`INSERT INTO paper4_versions
    (paper_id,title,description,class_id,starts_at,ends_at,definition,runner_cases,reference_solutions)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING id`,
    [p.id,title,description,classId,startsAt,endsAt,JSON.stringify(definition),JSON.stringify(runnerCases),JSON.stringify(referenceSolutions)]));
   await db.query('UPDATE paper4_papers SET current_version_id=$2,draft_version_id=$2 WHERE id=$1',[p.id,v.id]);
   if(deliveryKind==='activity')await saveActivityAudience(db,p.id,participants,classIds);
   await log(db,user,'paper4.create','paper4_paper',p.id);return p.id;
  });return respond(201,await paperResult(pool,await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/metadata$/);
 if(m&&method==='PATCH'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  if(!Object.hasOwn(body,'shortTitle')||Object.keys(body).some(name=>name!=='shortTitle'))fail(400,'VALIDATION','此入口仅设置试卷简称');
  const id=uuid(m[1],'试卷 ID'),shortTitle=paper4ShortTitleInput(body.shortTitle);
  await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   const p=await getPaper(db,user,id,{includeDraft:true});
   if(!canManage(user,p))fail(403,'FORBIDDEN','无权管理此试卷');
   if(p.archived_at)fail(409,'PAPER_ARCHIVED','请先恢复试卷再编辑简称');
   const label=shortTitle||paper4ShortTitle({...p,short_title:''});
   await db.query('UPDATE paper4_papers SET short_title=$2,updated_at=now() WHERE id=$1',[id,label]);
   await log(db,user,'paper4.metadata_update','paper4_paper',id,{shortTitle:label});
  });
  return respond(200,await paperResult(pool,await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)$/);
 if(m&&method==='GET'){
  const view=url.searchParams.get('view')??'current';
  return respond(200,await paperResult(pool,await getPaper(pool,user,m[1],{includeDraft:view==='draft',view,versionId:requestedPaperVersion(url)}),user));
 }
 if(m&&method==='PATCH'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const id=uuid(m[1],'试卷 ID');
  await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   const current=await getPaper(db,user,id,{includeDraft:true});
   if(current.source_paper_id)fail(409,'ACTIVITY_CONTENT_IMMUTABLE','班级活动使用固定试卷版本；请修改题库原卷后重新布置活动');
   if(current.archived_at)fail(409,'PAPER_ARCHIVED','请先恢复试卷再编辑');
   if(!current.draft_version_id)fail(409,'DRAFT_REQUIRED','请先从已发布版本创建新草稿');
   const p=await getPaper(db,user,id,{includeDraft:true,view:'draft'});
   if(p.delivery_kind==='catalog')rejectCatalogSchedule(body);
   const title=body.title===undefined?p.title:field(body.title,'试卷标题',{max:200});
   const description=body.description===undefined?p.description:optionalText(body.description,'试卷说明',4000);
   const classIds=p.delivery_kind==='activity'?await audienceClasses(db,user,body,p,'paper4'):[];
   const classId=body.classIds===undefined&&body.classId===undefined?p.class_id:classIds[0]??null;
   if(p.paper_status==='published'&&classId!==p.class_id)fail(409,'CLASS_IMMUTABLE','已发布试卷的修订不能更换班级，请新建试卷');
   if(p.paper_status==='published'&&body.classIds!==undefined){
    const currentClasses=(await activityClasses(db,id,'paper4')).map(c=>c.id).sort();
    if(JSON.stringify([...classIds].sort())!==JSON.stringify(currentClasses))fail(409,'ACTIVITY_AUDIENCE_IMMUTABLE','已发布活动的关联班级固定，请重新布置活动');
   }
   if(p.paper_status==='published'&&body.participants!==undefined)fail(409,'ACTIVITY_AUDIENCE_IMMUTABLE','已发布活动的学生名单固定，请重新布置活动');
   const participants=p.delivery_kind==='activity'&&body.participants!==undefined?await audienceStudents(db,body.participants):null;
   const startsAt=body.startsAt===undefined?p.starts_at:time(body.startsAt,'开始时间');
   const endsAt=body.endsAt===undefined?p.ends_at:time(body.endsAt,'截止时间');
   if(startsAt&&endsAt&&endsAt<=startsAt)fail(400,'VALIDATION','截止时间须晚于开始时间');
   const definition={...(body.questions===undefined?p.definition:definitionInput(body.questions)),exam:paper4ExamInput(body,p.definition?.exam)};
   if(body.shortTitle!==undefined)await db.query('UPDATE paper4_papers SET short_title=$2,updated_at=now() WHERE id=$1',
    [id,paper4ShortTitle({title,definition,shortTitle:paper4ShortTitleInput(body.shortTitle)})]);
   const runnerCases=casesInput(body.runnerCases===undefined?p.runner_cases:body.runnerCases,definition);
   const referenceSolutions=referenceSolutionsInput(body.referenceSolutions===undefined?p.reference_solutions:body.referenceSolutions,definition);
   await db.query(`UPDATE paper4_versions SET title=$2,description=$3,class_id=$4,starts_at=$5,ends_at=$6,
    definition=$7::jsonb,runner_cases=$8::jsonb,reference_solutions=$9::jsonb,draft_revision=draft_revision+1 WHERE id=$1`,
    [p.version_id,title,description,classId,startsAt,endsAt,JSON.stringify(definition),JSON.stringify(runnerCases),JSON.stringify(referenceSolutions)]);
   if(p.paper_status==='draft')await db.query('UPDATE paper4_papers SET title=$2,description=$3,class_id=$4,starts_at=$5,ends_at=$6,updated_at=now() WHERE id=$1',
    [id,title,description,classId,startsAt,endsAt]);
   if(p.delivery_kind==='activity'&&p.paper_status==='draft'){
    await replaceAudienceClasses(db,id,classIds,'paper4');
    if(participants!==null)await saveActivityAudience(db,id,participants,classIds);
   }
   await log(db,user,'paper4.update','paper4_paper',id);
  });return respond(200,await paperResult(pool,await getPaper(pool,user,id,{includeDraft:true,view:'draft'}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/(archive|restore)$/);
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const id=uuid(m[1],'试卷 ID'),archive=m[2]==='archive';
  await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   const p=await getPaper(db,user,id,{includeDraft:true});
   if(!canManage(user,p))fail(403,'FORBIDDEN','无权管理此试卷');
   if(Boolean(p.archived_at)===archive)return;
   await db.query('UPDATE paper4_papers SET archived_at=$2,updated_at=now() WHERE id=$1',
    [id,archive?new Date():null]);
   await log(db,user,archive?'paper4.archive':'paper4.restore','paper4_paper',id);
  });
  return respond(200,await paperResult(pool,await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/export$/);
 if(m&&method==='GET'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const view=url.searchParams.get('view')??'current';
  const p=await getPaper(pool,user,m[1],{includeDraft:true,view});
  if(!admin(user)&&p.owner_account_id!==user.id)fail(403,'FORBIDDEN','只有试卷创建者或管理员可以导出完整题包');
  const manifest={format:'codemaster-paper4',version:1,
   paper:{title:p.title,shortTitle:paper4ShortTitle(p),description:p.description,...paper4ExamInput(p.definition?.exam)},questions:p.definition.questions,
   runnerCases:p.runner_cases??{},referenceSolutions:p.reference_solutions??{}};
  return respond(200,{filename:`paper4-${p.id}-v${p.version_number}.json`,contentType:'application/json',
   contentBase64:Buffer.from(JSON.stringify(manifest,null,2)+'\n','utf8').toString('base64')});
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/draft$/);
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');const id=uuid(m[1],'试卷 ID');let created=false;
  await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   const p=await getPaper(db,user,id,{includeDraft:true});
   if(p.source_paper_id)fail(409,'ACTIVITY_CONTENT_IMMUTABLE','班级活动使用固定试卷版本；请修改题库原卷后重新布置活动');
   if(p.archived_at)fail(409,'PAPER_ARCHIVED','请先恢复试卷再建立修订版');
   if(p.draft_version_id)return;
   if(p.paper_status!=='published')fail(409,'DRAFT_EXISTS','试卷已经是草稿');
   const v=one(await db.query(`INSERT INTO paper4_versions
    (paper_id,version_number,title,description,class_id,starts_at,ends_at,definition,runner_cases,reference_solutions)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) RETURNING id`,
    [id,p.version_number+1,p.title,p.description,p.class_id,p.starts_at,p.ends_at,
     JSON.stringify(p.definition),JSON.stringify(p.runner_cases),JSON.stringify(p.reference_solutions)]));
   await db.query('UPDATE paper4_papers SET draft_version_id=$2,updated_at=now() WHERE id=$1',[id,v.id]);
   await log(db,user,'paper4.draft','paper4_paper',id,{versionId:v.id});created=true;
  });return respond(created?201:200,await paperResult(pool,await getPaper(pool,user,id,{includeDraft:true,view:'draft'}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/reference-runs$/);
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const id=uuid(m[1],'试卷 ID'),questionKey=key(body.questionKey,'大题键');
  const items=await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   const current=await getPaper(db,user,id,{includeDraft:true});
   if(current.archived_at)fail(409,'PAPER_ARCHIVED','请先恢复试卷再运行参考答案');
   if(!current.draft_version_id)fail(409,'DRAFT_REQUIRED','请先从已发布版本创建新草稿');
   const p=await getPaper(db,user,id,{includeDraft:true,view:'draft'});
   const q=p.definition.questions.find(question=>question.key===questionKey);
   if(!q)fail(404,'NOT_FOUND','大题不存在');
   const stages=q.stages.filter(stage=>stage.judgeMode==='auto');
   if(!stages.length)fail(409,'AUTO_COVERAGE_REQUIRED','此大题没有可运行的自动测试阶段');
   const sourceCode=p.reference_solutions?.[questionKey];
   if(!sourceCode?.trim())fail(409,'REFERENCE_REQUIRED','请先保存此大题的参考答案');
   for(const stage of stages)if(!p.runner_cases?.[stage.id]?.length)
    fail(409,'STAGE_CASES_REQUIRED',`阶段 ${stage.id} 缺少测试用例`);
   const waiting=one(await db.query(`SELECT count(*)::int count FROM paper4_run_tasks t
    JOIN paper4_reference_snapshots rs ON rs.id=t.reference_snapshot_id
    WHERE rs.version_id=$1 AND t.state IN ('queued','leased')`,[p.version_id]));
   if(waiting.count+stages.length>50)fail(429,'TOO_MANY_PENDING','请等待已有参考运行完成');
   const queued=[];
   for(const stage of stages){
    const snapshot=one(await db.query(`INSERT INTO paper4_reference_snapshots
     (version_id,question_key,stage_key,source_code,question,runner_cases,draft_revision)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id`,
     [p.version_id,questionKey,stage.id,sourceCode,JSON.stringify(q),JSON.stringify(p.runner_cases[stage.id]),p.draft_revision]));
    const task=one(await db.query(`INSERT INTO paper4_run_tasks(reference_snapshot_id)
     VALUES($1) RETURNING id,state,created_at`,[snapshot.id]));
    queued.push({id:task.id,stageId:stage.id,state:task.state,createdAt:task.created_at});
   }
   await log(db,user,'paper4.reference_run','paper4_paper',id,{questionKey,versionId:p.version_id,stageCount:stages.length});
   return queued;
  });return respond(201,{items});
 }
 if(route==='/paper4/papers/batch-publish'&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  if(!Array.isArray(body.paperIds)||body.paperIds.length<1||body.paperIds.length>100)
   fail(400,'VALIDATION','每次请选择 1–100 套试卷');
  const ids=body.paperIds.map(id=>uuid(id,'试卷 ID').toLowerCase());
  if(new Set(ids).size!==ids.length)fail(400,'VALIDATION','试卷 ID 不能重复');
  rejectCatalogSchedule(body);
  try{
   const items=await transaction(pool,async db=>{
    // Every writer locks the paper first. Sort locks to make overlapping batches safe.
    await db.query('SELECT id FROM paper4_papers WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
    const papers=[];
    // Authorize the entire selection before attaching any titles to validation errors.
    for(const id of ids)papers.push(await getPaper(db,user,id,{includeDraft:true}));
    const drafts=[];
    for(const current of papers){
     try{
      if(current.archived_at)fail(409,'PAPER_ARCHIVED','请先恢复试卷再发布');
      if(current.paper_status!=='draft'||current.paper_published_at||current.version_published_at||
       !current.draft_version_id||current.draft_version_id!==current.current_version_id)
       fail(409,'INITIAL_DRAFT_REQUIRED','批量发布仅支持尚未发布的试卷草稿');
      catalogOnly(current);
      const draft={...current,class_id:null,starts_at:null,ends_at:null};
      await validatePublishable(db,user,draft);
      drafts.push(draft);
     }catch(error){
      if(error instanceof HttpError){
       error.message=`${current.title}：${error.message}`;
       error.paper={paperId:current.id,paperTitle:current.title};
      }
      throw error;
     }
    }
    // No assignments or publication records change until all drafts have passed.
    for(const draft of drafts)await publishDraft(db,user,draft);
    const results=[];
    for(const id of ids)results.push(await paperResult(db,await getPaper(db,user,id,{includeDraft:true}),user));
    return results;
   });
   return respond(200,{items});
  }catch(error){
   if(error instanceof HttpError&&error.paper)
    return respond(error.status,{error:{code:error.code,message:error.message,...error.paper}});
   throw error;
  }
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/activities$/);
 if(m&&method==='GET'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const source=await getPaper(pool,user,m[1]);catalogOnly(source);
  const rows=(await pool.query(`SELECT p.*,c.name class_name,v.definition,v.version_number FROM paper4_papers p
   JOIN paper4_versions v ON v.id=p.current_version_id LEFT JOIN classes c ON c.id=p.class_id
   WHERE p.source_paper_id=$1 AND (p.owner_account_id=$2 OR $3::boolean)
   ORDER BY p.created_at DESC,p.id DESC`,[source.id,user.id,admin(user)])).rows;
  return respond(200,{items:await Promise.all(rows.map(p=>audienceShape(pool,p,user,summary(p,user))))});
 }
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const sourceId=uuid(m[1],'试卷 ID');
  const activity=activityInput(body);
  const activityId=await transaction(pool,async db=>{
   const [source]=await selectedActivitySources(db,user,[sourceId]);
   const classIds=await audienceClasses(db,user,body,null,'paper4');
   const participants=await audienceStudents(db,body.participants,{allowEmpty:false});
   const title=body.title===undefined?source.title:field(body.title,'活动标题',{max:200});
   return createActivity(db,user,source,{...activity,classIds,participants,title});
  });
  return respond(201,await paperResult(pool,await getPaper(pool,user,activityId,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/publish$/);
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');const id=uuid(m[1],'试卷 ID');
  await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   const current=await getPaper(db,user,id,{includeDraft:true});
   if(current.delivery_kind==='catalog')rejectCatalogSchedule(body);
   if(current.archived_at)fail(409,'PAPER_ARCHIVED','请先恢复试卷再发布');
   if(!current.draft_version_id){if(current.paper_status==='published')return;fail(409,'DRAFT_REQUIRED','没有可发布的草稿');}
   const p=await getPaper(db,user,id,{includeDraft:true,view:'draft'});
   await validatePublishable(db,user,p);
   await publishDraft(db,user,p);
  });return respond(200,await paperResult(pool,await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/attempt$/);
 if(m&&method==='GET'){
  const p=await getPaper(pool,user,m[1],{versionId:requestedPaperVersion(url)});await studentAllowed(pool,user,p);
  const a=(await pool.query('SELECT id FROM paper4_attempts WHERE paper_id=$1 AND version_id=$2 AND identity_id=$3 ORDER BY attempt_number DESC LIMIT 1',
   [p.id,p.version_id,user.identityId])).rows[0];
  if(!a)fail(404,'ATTEMPT_NOT_FOUND','尚未开始当前版本');
  await closeExpiredAttempts(pool,{attemptId:a.id});
  return respond(200,await attemptShape(pool,user,await getAttempt(pool,user,a.id)));
 }
 if(m&&method==='POST'){
  const id=uuid(m[1],'试卷 ID');let created=false;
  if(body.restart!==undefined&&typeof body.restart!=='boolean')fail(400,'VALIDATION','重新练习选项无效');
  const result=await transaction(pool,async db=>{
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR SHARE',[id]);
   const p=await getPaper(db,user,id,{versionId:requestedPaperVersion(url,body)});await studentAllowed(db,user,p);
   if(p.archived_at)fail(409,'PAPER_ARCHIVED','试卷已归档，不能新开答卷');
   // Serialize both initial starts and retries, including an absent first row.
   await db.query('SELECT id FROM identities WHERE id=$1 FOR UPDATE',[user.identityId]);
   const existing=(await db.query('SELECT * FROM paper4_attempts WHERE paper_id=$1 AND version_id=$2 AND identity_id=$3 ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE',
    [id,p.version_id,user.identityId])).rows[0];
   if(body.restart){
    if(p.delivery_kind!=='catalog')fail(409,'RESTART_NOT_ALLOWED','班级活动不能重新开始答卷');
    if(!existing||existing.state!=='submitted')fail(409,'ATTEMPT_NOT_FINISHED','请先提交当前练习，再开始新一轮');
   }else if(existing)return existing;
   if(p.starts_at&&p.starts_at>new Date())fail(409,'NOT_STARTED','练习尚未开始');
   if(p.ends_at&&p.ends_at<=new Date())fail(409,'DEADLINE_PASSED','练习已截止');
   const a=one(await db.query('INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,attempt_number) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [id,p.version_id,user.identityId,user.id,(existing?.attempt_number??0)+1]));
   for(const q of p.definition.questions)await db.query('INSERT INTO paper4_attempt_files(attempt_id,question_key,content) VALUES($1,$2,$3)',[a.id,q.key,q.starterCode]);
   await log(db,user,'paper4.attempt_start','paper4_attempt',a.id,{paperId:id});created=true;return a;
  });await closeExpiredAttempts(pool,{attemptId:result.id});const a=await getAttempt(pool,user,result.id);return respond(created?201:200,await attemptShape(pool,user,a));
 }
 if(route==='/paper4/attempts'&&method==='GET'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const paperId=uuid(url.searchParams.get('paperId'),'试卷 ID');
  const paper=await getPaper(pool,user,paperId,{includeDraft:true});
  if(!canManage(user,paper))fail(403,'FORBIDDEN','无权查看此试卷的答卷');
  await closeExpiredAttempts(pool,{paperId});
  const rows=(await pool.query(`SELECT a.id,a.identity_id,a.version_id,a.attempt_number,v.version_number,v.definition,a.state,a.started_at,a.submitted_at,a.released_at,i.name student_name,
   COALESCE(sum(sm.marks),0)::int score,count(sm.stage_key)::int marked_stages
   FROM paper4_attempts a JOIN identities i ON i.id=a.identity_id JOIN paper4_versions v ON v.id=a.version_id
   LEFT JOIN paper4_stage_marks sm ON sm.attempt_id=a.id
   WHERE a.paper_id=$1 GROUP BY a.id,i.name,v.id ORDER BY a.started_at DESC,a.id DESC`,[paper.id])).rows;
  return respond(200,{items:rows.map(a=>({id:a.id,paperId:paper.id,identityId:a.identity_id,
   studentIdentityId:a.identity_id,studentName:a.student_name,
   versionId:a.version_id,versionNumber:a.version_number,attemptNumber:a.attempt_number,
   status:a.state,startedAt:a.started_at,submittedAt:a.submitted_at,releasedAt:a.released_at,
   score:a.marked_stages?Number(a.score):null,markedStages:Number(a.marked_stages),
   totalStages:a.definition.questions.reduce((n,q)=>n+q.stages.length,0)}))});
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)$/);
 if(m&&method==='GET'){
  const attempt=await getAttempt(pool,user,m[1]);
  await closeExpiredAttempts(pool,{attemptId:attempt.id});
  return respond(200,await attemptShape(pool,user,await getAttempt(pool,user,attempt.id)));
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/files\/([^/]+)$/);
 if(m&&method==='PATCH'){
  const attemptId=uuid(m[1],'答卷 ID'),fileKey=key(m[2],'文件键');
  const content=bytes(body.content,'代码'),revision=integer(body.revision,0,1000000000,'版本号');
  const draft=await transaction(pool,async db=>{
   const a=await writableAttempt(db,user,attemptId);questionFor(a,fileKey);
   const updated=await db.query(`UPDATE paper4_attempt_files SET content=$4,revision=revision+1,updated_at=now()
    WHERE attempt_id=$1 AND question_key=$2 AND revision=$3 RETURNING question_key,content,revision,updated_at`,[attemptId,fileKey,revision,content]);
   if(!updated.rowCount)fail(409,'REVISION_CONFLICT','代码已在别处更新，请刷新后合并');
   return updated.rows[0];
  });return respond(200,{fileKey:draft.question_key,content:draft.content,revision:draft.revision,updatedAt:draft.updated_at});
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/checkpoints$/);
 if(m&&method==='POST'){
  const attemptId=uuid(m[1],'答卷 ID'),stageId=key(body.stageId,'阶段 ID');
  const snapshot=await transaction(pool,async db=>{
   const a=await writableAttempt(db,user,attemptId);
   const q=a.definition.questions.find(question=>question.stages.some(s=>s.id===stageId));
   if(!q)fail(404,'NOT_FOUND','评分阶段不存在');
   const snap=await snapshotDraft(db,a,q.key,stageId);
   await log(db,user,'paper4.checkpoint','paper4_snapshot',snap.id,{attemptId,stageId});return snap;
  });return respond(201,{id:snapshot.id,fileKey:snapshot.question_key,stageId:snapshot.stage_key,sourceCode:snapshot.source_code,
   revision:snapshot.revision,createdAt:snapshot.created_at});
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/runs$/);
 if(m&&method==='POST'){
  const attemptId=uuid(m[1],'答卷 ID'),fileKey=key(body.fileKey,'文件键');
  const stageId=body.stageId===undefined||body.stageId===null?null:key(body.stageId,'阶段 ID');
  const task=await transaction(pool,async db=>{
   const a=await writableAttempt(db,user,attemptId),q=questionFor(a,fileKey);
   const automatic=q.stages.filter(stage=>stage.judgeMode==='auto');
   if(stageId&&!automatic.some(stage=>stage.id===stageId))fail(409,'STAGE_NOT_AUTOMATIC','只能独立运行有测试的自动评测阶段');
   const legacy=q.stages.every(stage=>stage.judgeMode===undefined)&&Array.isArray(a.runner_cases?.[q.key]);
   if(!automatic.length&&!legacy)fail(409,'NO_AUTOMATIC_TESTS','此题没有可运行的自动测试阶段');
   const pending=one(await db.query(`SELECT count(*)::int count FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id
    WHERE s.attempt_id=$1 AND t.state IN ('queued','leased')`,[attemptId]));
   if(pending.count>=3)fail(429,'TOO_MANY_PENDING','请等待已有运行完成');
   const snap=await snapshotDraft(db,a,fileKey,stageId);
   const queued=one(await db.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id,state,created_at',[snap.id]));
   await log(db,user,'paper4.run','paper4_run_task',queued.id,{attemptId,fileKey,stageId});return queued;
  });return respond(201,{id:task.id,state:task.state,stageId,createdAt:task.created_at});
 }
 m=route.match(/^\/paper4\/runs\/([^/]+)$/);
 if(m&&method==='GET'){
  const task=one(await pool.query(`SELECT t.*,s.attempt_id,s.question_key,s.stage_key,
   rs.question_key ref_question_key,rs.stage_key ref_stage_key,rs.version_id ref_version_id,
   rs.question ref_question,rs.runner_cases ref_cases,
   a.identity_id,p.id paper_id,p.delivery_kind,p.owner_account_id,COALESCE(av.class_id,rv.class_id) class_id,
   COALESCE(av.definition,rv.definition) definition,COALESCE(av.runner_cases,rv.runner_cases) runner_cases
   FROM paper4_run_tasks t
   LEFT JOIN paper4_snapshots s ON s.id=t.snapshot_id
   LEFT JOIN paper4_attempts a ON a.id=s.attempt_id
   LEFT JOIN paper4_versions av ON av.id=a.version_id
   LEFT JOIN paper4_reference_snapshots rs ON rs.id=t.reference_snapshot_id
   LEFT JOIN paper4_versions rv ON rv.id=rs.version_id
   JOIN paper4_papers p ON p.id=COALESCE(a.paper_id,rv.paper_id) WHERE t.id=$1`,[uuid(m[1],'运行 ID')]));
  const reference=!!task.reference_snapshot_id;
  if(reference&&!canManage(user,task))fail(403,'FORBIDDEN','无权查看参考答案运行');
  if(!reference&&task.identity_id!==user.identityId&&!canManage(user,task))fail(403,'FORBIDDEN','无权查看此运行');
  if(!reference&&!canManage(user,task)&&task.delivery_kind==='activity')await activityRecipient(pool,task.paper_id,user.identityId);
  const run=(await pool.query('SELECT status,public_output,public_message,private_results,created_at FROM paper4_runs WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1',[task.id])).rows[0];
  const manage=canManage(user,task);
  const caseDefinition=result=>{
   const cases=reference?task.ref_cases:task.runner_cases?.[result.stageId??task.stage_key??task.question_key];
   return Array.isArray(cases)?cases.find(item=>item.id===result.caseId):null;
  };
  // A result with no matching published case is also private by default.
  const driverCase=result=>{
   const definition=caseDefinition(result);
   return !definition||typeof definition.driverCode==='string';
  };
  const unsafeFailure=result=>result.status!=='AC'&&(result.public!==true||driverCase(result));
  const unsafeStages=new Set((run?.private_results??[]).filter(unsafeFailure).map(result=>result.stageId));
  const publicResults=(run?.private_results??[]).filter(result=>result.public===true).map(result=>{
   const driver=driverCase(result);
   const exposeOutput=manage||!driver;
   return {stageId:result.stageId??null,caseId:result.caseId,
    status:!manage&&driver&&result.status!=='AC'?'NotPassed':result.status,
    stdout:exposeOutput?result.stdout??'':'',stderr:exposeOutput?result.stderr??'':'',
    generatedFiles:exposeOutput?result.generatedFiles??{}:{},
    checks:exposeOutput?result.checks??[]:[]};
  });
  const question=reference?task.ref_question:task.definition.questions.find(q=>q.key===task.question_key);
  const selectedStage=reference?task.ref_stage_key:task.stage_key;
  const automatic=question?.stages.filter(stage=>stage.judgeMode==='auto')??[];
  const selected=selectedStage?automatic.filter(stage=>stage.id===selectedStage):automatic;
  const manual=question?.stages.filter(stage=>stage.judgeMode==='manual').map(stage=>stage.id)??[];
  const evidence=question?.stages.filter(stage=>stage.judgeMode==='evidence').map(stage=>stage.id)??[];
  const rawStageResults=run?selected.map(stage=>{
   const cases=run.private_results.filter(item=>item.stageId===stage.id);
   const required=reference?task.ref_cases?.length??0:task.runner_cases?.[stage.id]?.length??0;
   const status=required>0&&cases.length===required&&cases.every(item=>item.status==='AC')?'AC':
    cases.find(item=>item.status!=='AC')?.status??(run.status==='AC'?'System Error':run.status);
   return {stageId:stage.id,status};
  }):[];
  let questionStatus='NeedsReview';
  if(run&&automatic.length&&selected.length===automatic.length){
   const failure=rawStageResults.find(stage=>stage.status!=='AC');
   // Manual and evidence stages are graded separately; they do not prevent
   // the final program from earning AC when all automatic stages pass.
   questionStatus=failure?failure.status:'AC';
  }
  const stageResults=manage?rawStageResults:rawStageResults.map(stage=>({stageId:stage.stageId,
   status:unsafeStages.has(stage.stageId)&&stage.status!=='AC'?'NotPassed':stage.status}));
  if(!manage&&questionStatus!=='AC'&&questionStatus!=='NeedsReview'&&unsafeStages.size)questionStatus='NotPassed';
  const publicOutput=manage?run?.public_output??'':publicResults[0]?.stdout??'';
  const publicMessage=manage?run?.public_message??'':run?.status==='CE'&&!unsafeStages.size?run.public_message:
   questionStatus==='AC'?'自动测试全部通过；课程评分仍需教师审核人工阶段。':
   unsafeStages.size?'自动测试未通过；测试驱动与隐藏用例的诊断仅供教师查看。':run?.public_message??'';
  const status=!manage&&unsafeStages.size&&run?.status!=='AC'?'NotPassed':run?.status;
  return respond(200,{id:task.id,state:task.state,stageId:selectedStage??null,reference,createdAt:task.created_at,
   result:run?{status,questionStatus,stageResults,pendingManualStageIds:manual,evidenceStageIds:evidence,
    publicOutput,publicMessage,publicResults,createdAt:run.created_at,
    ...(manage?{reviewResults:run.private_results}:{} )}:null});
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/submit$/);
 if(m&&method==='POST'){
  const id=uuid(m[1],'答卷 ID');
  await transaction(pool,async db=>{
   const a=await writableAttempt(db,user,id);
   await queueFormalQuestionRuns(db,a);
   await db.query("UPDATE paper4_attempts SET state='submitted',submitted_at=now() WHERE id=$1",[id]);
   await log(db,user,'paper4.submit','paper4_attempt',id);
  });return respond(200,await attemptShape(pool,user,await getAttempt(pool,user,id)));
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/marks$/);
 if(m&&method==='PATCH'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const id=uuid(m[1],'答卷 ID'),stageId=key(body.stageId,'阶段 ID'),note=optionalText(body.note,'评分说明',4000);
  await getAttempt(pool,user,id);await closeExpiredAttempts(pool,{attemptId:id});
  await transaction(pool,async db=>{
   const a=await getAttempt(db,user,id,{forUpdate:true});
   if(!canManage(user,a))fail(403,'FORBIDDEN','无权评分');
   if(a.state!=='submitted')fail(409,'NOT_SUBMITTED','学生尚未交卷');
   if(a.released_at)fail(409,'RESULT_RELEASED','已发布成绩不能修改');
   const stage=a.definition.questions.flatMap(q=>q.stages).find(s=>s.id===stageId);
   if(!stage)fail(404,'NOT_FOUND','评分阶段不存在');
   const marks=integer(body.marks,0,stage.maxMarks,'阶段得分');
   await db.query(`INSERT INTO paper4_stage_marks(attempt_id,stage_key,marks,note,reviewer_account_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(attempt_id,stage_key) DO UPDATE
    SET marks=EXCLUDED.marks,note=EXCLUDED.note,reviewer_account_id=EXCLUDED.reviewer_account_id,updated_at=now()`,
    [id,stageId,marks,note,user.id]);
   await log(db,user,'paper4.mark','paper4_attempt',id,{stageId,marks});
  });return respond(200,await attemptShape(pool,user,await getAttempt(pool,user,id)));
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/release$/);
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');const id=uuid(m[1],'答卷 ID');
  await getAttempt(pool,user,id);await closeExpiredAttempts(pool,{attemptId:id});
  await transaction(pool,async db=>{
   const a=await getAttempt(db,user,id,{forUpdate:true});
   if(!canManage(user,a))fail(403,'FORBIDDEN','无权发布成绩');
   if(a.state!=='submitted')fail(409,'NOT_SUBMITTED','学生尚未交卷');
   if(a.released_at)return;
   const required=a.definition.questions.flatMap(q=>q.stages.map(s=>s.id));
   const marked=new Set((await db.query('SELECT stage_key FROM paper4_stage_marks WHERE attempt_id=$1',[id])).rows.map(r=>r.stage_key));
   if(required.some(stageId=>!marked.has(stageId)))fail(409,'MARKS_INCOMPLETE','请先为每个评分阶段评分，包括 0 分');
   await db.query('UPDATE paper4_attempts SET released_at=now() WHERE id=$1',[id]);
   await log(db,user,'paper4.release','paper4_attempt',id);
  });return respond(200,await attemptShape(pool,user,await getAttempt(pool,user,id)));
 }
 return null;
}
