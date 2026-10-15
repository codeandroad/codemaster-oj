import { transaction } from './db.mjs';
import { fail, field, bytes, uuid, integer } from './security.mjs';

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
function definitionInput(value) {
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
   return {id,title:field(s.title,'阶段标题',{max:120}),description:optionalText(s.description,'阶段说明',4000),maxMarks};
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
 return {language:'python',questions,totalMarks};
}
function casesInput(value,definition) {
 if (value === undefined || value === null) return {};
 if (!value || typeof value !== 'object' || Array.isArray(value))fail(400,'VALIDATION','测试用例格式无效');
 const known=new Set(definition.questions.map(q=>q.key)),output={};let total=0;
 for(const [questionKey,cases] of Object.entries(value)){
  if(!known.has(questionKey)||!Array.isArray(cases)||cases.length>12)fail(400,'VALIDATION','测试用例题号或数量无效');
  const ids=new Set();output[questionKey]=cases.map((item,index)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))fail(400,'VALIDATION','测试用例格式无效');
   const id=key(item.id??`case${index+1}`,'用例 ID');if(ids.has(id))fail(400,'VALIDATION','用例 ID 不能重复');ids.add(id);
   if(item.public!==undefined&&typeof item.public!=='boolean')fail(400,'VALIDATION','公开状态无效');
   if(item.expectedStdout===undefined&&item.expectedFiles===undefined)fail(400,'VALIDATION','用例须给出预期输出或文件');
   const expectedStdout=item.expectedStdout===undefined?undefined:bytes(item.expectedStdout,'预期输出',65536);
   const inputFiles=fileMap(item.inputFiles,'用例输入文件',{maxBytes:131072});
   const expectedFiles=fileMap(item.expectedFiles,'用例预期文件',{maxBytes:131072});
   const question=definition.questions.find(q=>q.key===questionKey);
   if(new Set([...Object.keys(question.initialFiles),...Object.keys(inputFiles),...question.outputFiles,...Object.keys(expectedFiles)]).size>16)
    fail(400,'VALIDATION','单个用例的初始文件、覆盖文件和输出文件合计不得超过 16 个');
   const result={id,stdin:bytes(item.stdin??'','标准输入',65536),inputFiles,
    expectedFiles,public:item.public===true};
   if(expectedStdout!==undefined)result.expectedStdout=expectedStdout;
   return result;
  });total+=cases.length;
 }
 if(total>50)fail(400,'VALIDATION','整卷测试用例数量过多');
 return output;
}
function canManage(user,paper){return admin(user)||paper.owner_account_id===user.id;}
async function ensureCurrentTeacher(db,user,paper){
 if(admin(user)||paper.owner_account_id!==user.id||!paper.class_id)return;
 if(!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[paper.class_id,user.id])).rowCount)
  fail(403,'FORBIDDEN','已无权访问该班级的试卷与答卷');
}
async function classAllowed(db,user,classId){
 if(!classId){if(!admin(user))fail(403,'FORBIDDEN','只有管理员可以发布面向全校的公开练习');return;}
 const cls=one(await db.query('SELECT id FROM classes WHERE id=$1 AND archived_at IS NULL',[uuid(classId,'班级 ID')]),'班级不存在');
 if(!admin(user)&&!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[cls.id,user.id])).rowCount)
  fail(403,'FORBIDDEN','只能为本人负责的班级创建试卷');
}
async function studentAllowed(db,user,paper){
 if(!user.roles.includes('student'))fail(403,'FORBIDDEN','仅学生可开始练习');
 if(paper.status!=='published')fail(404,'NOT_FOUND','试卷尚未发布');
 if(paper.class_id&&!(await db.query('SELECT 1 FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.class_id=$1 AND cm.identity_id=$2 AND c.archived_at IS NULL',[paper.class_id,user.identityId])).rowCount)
  fail(403,'FORBIDDEN','您不在此试卷的班级名单内');
 if(paper.starts_at&&paper.starts_at>new Date())fail(409,'NOT_STARTED','练习尚未开始');
}
async function getPaper(db,user,id,{includeDraft=false}={}){
 const paper=one(await db.query('SELECT p.*,c.name class_name,v.definition,v.runner_cases,v.id version_id FROM paper4_papers p LEFT JOIN classes c ON c.id=p.class_id JOIN paper4_versions v ON v.id=p.current_version_id WHERE p.id=$1',[uuid(id,'试卷 ID')]));
 await ensureCurrentTeacher(db,user,paper);
 if(!canManage(user,paper)){
  if(includeDraft)fail(403,'FORBIDDEN','无权管理此试卷');
  await studentAllowed(db,user,paper);
 }
 return paper;
}
function paperShape(p,user){
 const manage=canManage(user,p);
 return {id:p.id,title:p.title,description:p.description,classId:p.class_id,className:p.class_name??null,status:p.status,
  startsAt:p.starts_at,endsAt:p.ends_at,publishedAt:p.published_at,totalMarks:p.definition?.totalMarks??75,
  questions:p.definition?.questions??[],language:'python',canManage:manage,...(manage?{runnerCases:p.runner_cases??{}}:{})};
}
async function getAttempt(db,user,id,{forUpdate=false}={}){
 const attempt=one(await db.query(`SELECT a.*,p.owner_account_id,p.class_id,p.title paper_title,p.status paper_status,
  p.starts_at,p.ends_at,i.name student_name,
  v.definition FROM paper4_attempts a JOIN paper4_papers p ON p.id=a.paper_id
  JOIN paper4_versions v ON v.id=a.version_id JOIN identities i ON i.id=a.identity_id
  WHERE a.id=$1 ${forUpdate?'FOR UPDATE OF a':''}`,[uuid(id,'答卷 ID')]));
 await ensureCurrentTeacher(db,user,attempt);
 if(attempt.identity_id!==user.identityId&&!canManage(user,attempt))fail(403,'FORBIDDEN','无权查看此答卷');
 return attempt;
}
async function attemptShape(db,user,attempt){
 const manage=canManage(user,attempt),own=attempt.identity_id===user.identityId;
 const files=(await db.query('SELECT question_key,content,revision,updated_at FROM paper4_attempt_files WHERE attempt_id=$1 ORDER BY question_key',[attempt.id])).rows;
 const snapshots=(await db.query('SELECT id,question_key,stage_key,source_code,revision,created_at FROM paper4_snapshots WHERE attempt_id=$1 ORDER BY created_at,id',[attempt.id])).rows;
 const gradeRows=(await db.query('SELECT stage_key,marks,note,updated_at FROM paper4_stage_marks WHERE attempt_id=$1 ORDER BY stage_key',[attempt.id])).rows;
 const visibleMarks=manage||!!attempt.released_at;
 const marks=visibleMarks?gradeRows.map(m=>({stageId:m.stage_key,marks:m.marks,note:m.note,updatedAt:m.updated_at})):[];
 const score=visibleMarks&&gradeRows.length?gradeRows.reduce((sum,m)=>sum+m.marks,0):null;
 return {id:attempt.id,paperId:attempt.paper_id,versionId:attempt.version_id,identityId:manage?attempt.identity_id:undefined,
  studentIdentityId:manage?attempt.identity_id:undefined,studentName:manage?attempt.student_name:undefined,
  status:attempt.state,startedAt:attempt.started_at,submittedAt:attempt.submitted_at,releasedAt:attempt.released_at,
  files:files.map(f=>({fileKey:f.question_key,content:f.content,revision:f.revision,updatedAt:f.updated_at})),
  snapshots:snapshots.map(s=>({id:s.id,fileKey:s.question_key,stageId:s.stage_key,sourceCode:s.source_code,revision:s.revision,createdAt:s.created_at})),
  marks,score,totalMarks:75,paper:{id:attempt.paper_id,title:attempt.paper_title,classId:attempt.class_id,
   status:attempt.paper_status,startsAt:attempt.starts_at,endsAt:attempt.ends_at,totalMarks:75,
   questions:attempt.definition.questions,language:'python'},canManage:manage,
  canEdit:own&&attempt.state==='active'&&(!attempt.ends_at||attempt.ends_at>new Date())};
}
async function writableAttempt(db,user,id){
 const attempt=await getAttempt(db,user,id,{forUpdate:true});
 if(attempt.identity_id!==user.identityId||!user.roles.includes('student'))fail(403,'FORBIDDEN','只能修改自己的答卷');
 if(attempt.state!=='active')fail(409,'ATTEMPT_SUBMITTED','答卷已提交，不能继续修改');
 if(attempt.class_id&&!(await db.query('SELECT 1 FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.class_id=$1 AND cm.identity_id=$2 AND c.archived_at IS NULL',[attempt.class_id,user.identityId])).rowCount)
  fail(403,'FORBIDDEN','您已不在此试卷的班级名单内');
 if(attempt.starts_at&&attempt.starts_at>new Date())fail(409,'NOT_STARTED','练习尚未开始');
 if(attempt.ends_at&&attempt.ends_at<=new Date())fail(409,'DEADLINE_PASSED','练习已截止');
 return attempt;
}
function questionFor(attempt,fileKey){
 const question=attempt.definition.questions.find(q=>q.key===fileKey);
 if(!question)fail(404,'NOT_FOUND','题号不存在');return question;
}
async function snapshotDraft(db,attempt,questionKey,stageKey){
 const draft=one(await db.query('SELECT content,revision FROM paper4_attempt_files WHERE attempt_id=$1 AND question_key=$2',[attempt.id,questionKey]));
 return one(await db.query('INSERT INTO paper4_snapshots(attempt_id,question_key,stage_key,source_code,revision) VALUES($1,$2,$3,$4,$5) RETURNING *',
  [attempt.id,questionKey,stageKey,draft.content,draft.revision]));
}
// A deadline is enforced by the server even if no student keeps the page open.
// The first authorized read after expiry freezes every saved source exactly
// once; row locks serialize this against edits and concurrent readers.
async function closeExpiredAttempts(pool,{paperId=null,attemptId=null}={}){
 await transaction(pool,async db=>{
  const rows=(await db.query(`SELECT a.id,a.paper_id,v.definition,p.ends_at FROM paper4_attempts a
   JOIN paper4_papers p ON p.id=a.paper_id JOIN paper4_versions v ON v.id=a.version_id
   WHERE a.state='active' AND p.ends_at IS NOT NULL AND p.ends_at<=clock_timestamp()
    AND ($1::uuid IS NULL OR a.paper_id=$1) AND ($2::uuid IS NULL OR a.id=$2)
   ORDER BY a.id FOR UPDATE OF a`,[paperId,attemptId])).rows;
  for(const a of rows){
   for(const q of a.definition.questions)await snapshotDraft(db,a,q.key,null);
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
function summary(p,user){return {id:p.id,title:p.title,description:p.description,classId:p.class_id,className:p.class_name??null,status:p.status,
 startsAt:p.starts_at,endsAt:p.ends_at,totalMarks:p.definition?.totalMarks??75,
 questionCount:p.definition?.questions?.length??0,canManage:canManage(user,p)};}

export async function handlePaper4(ctx){
 const {route,method,body,user,pool,url}=ctx;
 if(!route.startsWith('/paper4/'))return null;
 let m;
 if(route==='/paper4/papers'&&method==='GET'){
  const papers=(await pool.query(`SELECT p.*,c.name class_name,v.definition FROM paper4_papers p
   LEFT JOIN classes c ON c.id=p.class_id JOIN paper4_versions v ON v.id=p.current_version_id
   WHERE (p.owner_account_id=$1 AND (p.class_id IS NULL OR EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=p.class_id AND tc.account_id=$1)))
    OR $2::boolean OR p.status='published' AND $3::boolean AND
    (p.class_id IS NULL OR EXISTS(SELECT 1 FROM class_members cm JOIN classes cls ON cls.id=cm.class_id
      WHERE cm.class_id=p.class_id AND cm.identity_id=$4 AND cls.archived_at IS NULL))
   ORDER BY p.created_at DESC,p.id DESC LIMIT 200`,[user.id,admin(user),user.roles.includes('student'),user.identityId])).rows;
  return respond(200,{items:papers.map(p=>summary(p,user))});
 }
 if(route==='/paper4/papers'&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const title=field(body.title,'试卷标题',{max:200}),description=optionalText(body.description,'试卷说明',4000);
  const classId=body.classId===undefined||body.classId===null||body.classId===''?null:uuid(body.classId,'班级 ID');
  const startsAt=time(body.startsAt,'开始时间'),endsAt=time(body.endsAt,'截止时间');
  if(startsAt&&endsAt&&endsAt<=startsAt)fail(400,'VALIDATION','截止时间须晚于开始时间');
  const definition=definitionInput(body.questions),runnerCases=casesInput(body.runnerCases,definition);
  const id=await transaction(pool,async db=>{
   await classAllowed(db,user,classId);
   const p=one(await db.query('INSERT INTO paper4_papers(owner_account_id,class_id,title,description,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
    [user.id,classId,title,description,startsAt,endsAt]));
   const v=one(await db.query('INSERT INTO paper4_versions(paper_id,definition,runner_cases) VALUES($1,$2::jsonb,$3::jsonb) RETURNING id',
    [p.id,JSON.stringify(definition),JSON.stringify(runnerCases)]));
   await db.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);
   await log(db,user,'paper4.create','paper4_paper',p.id);return p.id;
  });return respond(201,paperShape(await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)$/);
 if(m&&method==='GET')return respond(200,paperShape(await getPaper(pool,user,m[1]),user));
 if(m&&method==='PATCH'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const id=uuid(m[1],'试卷 ID');
  await transaction(pool,async db=>{
   const p=await getPaper(db,user,id,{includeDraft:true});
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   if(p.status!=='draft')fail(409,'PUBLISHED','已发布试卷不可直接修改，请保留原版本');
   const title=body.title===undefined?p.title:field(body.title,'试卷标题',{max:200});
   const description=body.description===undefined?p.description:optionalText(body.description,'试卷说明',4000);
   const classId=body.classId===undefined?p.class_id:body.classId===null||body.classId===''?null:uuid(body.classId,'班级 ID');
   await classAllowed(db,user,classId);
   const startsAt=body.startsAt===undefined?p.starts_at:time(body.startsAt,'开始时间');
   const endsAt=body.endsAt===undefined?p.ends_at:time(body.endsAt,'截止时间');
   if(startsAt&&endsAt&&endsAt<=startsAt)fail(400,'VALIDATION','截止时间须晚于开始时间');
   const definition=body.questions===undefined?p.definition:definitionInput(body.questions);
   const runnerCases=body.runnerCases===undefined?p.runner_cases:casesInput(body.runnerCases,definition);
   if(body.questions!==undefined&&body.runnerCases===undefined)casesInput(runnerCases,definition);
   await db.query('UPDATE paper4_versions SET definition=$2::jsonb,runner_cases=$3::jsonb WHERE id=$1',
    [p.version_id,JSON.stringify(definition),JSON.stringify(runnerCases)]);
   await db.query('UPDATE paper4_papers SET title=$2,description=$3,class_id=$4,starts_at=$5,ends_at=$6,updated_at=now() WHERE id=$1',
    [id,title,description,classId,startsAt,endsAt]);
   await log(db,user,'paper4.update','paper4_paper',id);
  });return respond(200,paperShape(await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/publish$/);
 if(m&&method==='POST'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');const id=uuid(m[1],'试卷 ID');
  await transaction(pool,async db=>{
   const p=await getPaper(db,user,id,{includeDraft:true});
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR UPDATE',[id]);
   if(p.status==='published')return;
   await classAllowed(db,user,p.class_id);
   if(p.ends_at&&p.ends_at<=new Date())fail(409,'DEADLINE_PASSED','截止时间已过，请调整后发布');
   await db.query('UPDATE paper4_versions SET published_at=now() WHERE id=$1',[p.version_id]);
   await db.query("UPDATE paper4_papers SET status='published',published_at=now(),updated_at=now() WHERE id=$1",[id]);
   await log(db,user,'paper4.publish','paper4_paper',id);
  });return respond(200,paperShape(await getPaper(pool,user,id,{includeDraft:true}),user));
 }
 m=route.match(/^\/paper4\/papers\/([^/]+)\/attempt$/);
 if(m&&method==='GET'){
  const p=await getPaper(pool,user,m[1]);await studentAllowed(pool,user,p);
  const a=one(await pool.query('SELECT * FROM paper4_attempts WHERE paper_id=$1 AND identity_id=$2',[p.id,user.identityId]),'尚未开始此试卷');
  await closeExpiredAttempts(pool,{attemptId:a.id});
  return respond(200,await attemptShape(pool,user,await getAttempt(pool,user,a.id)));
 }
 if(m&&method==='POST'){
  const id=uuid(m[1],'试卷 ID');let created=false;
  const result=await transaction(pool,async db=>{
   const p=await getPaper(db,user,id);await studentAllowed(db,user,p);
   await db.query('SELECT id FROM paper4_papers WHERE id=$1 FOR SHARE',[id]);
   const existing=(await db.query('SELECT * FROM paper4_attempts WHERE paper_id=$1 AND identity_id=$2 FOR UPDATE',[id,user.identityId])).rows[0];
   if(existing)return existing;
   if(p.starts_at&&p.starts_at>new Date())fail(409,'NOT_STARTED','练习尚未开始');
   if(p.ends_at&&p.ends_at<=new Date())fail(409,'DEADLINE_PASSED','练习已截止');
   const a=one(await db.query('INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id) VALUES($1,$2,$3,$4) RETURNING *',
    [id,p.version_id,user.identityId,user.id]));
   for(const q of p.definition.questions)await db.query('INSERT INTO paper4_attempt_files(attempt_id,question_key,content) VALUES($1,$2,$3)',[a.id,q.key,q.starterCode]);
   await log(db,user,'paper4.attempt_start','paper4_attempt',a.id,{paperId:id});created=true;return a;
  });await closeExpiredAttempts(pool,{attemptId:result.id});const a=await getAttempt(pool,user,result.id);return respond(created?201:200,await attemptShape(pool,user,a));
 }
 if(route==='/paper4/attempts'&&method==='GET'){
  if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
  const paperId=uuid(url.searchParams.get('paperId'),'试卷 ID');
  const paper=await getPaper(pool,user,paperId,{includeDraft:true});
  await closeExpiredAttempts(pool,{paperId});
  const rows=(await pool.query(`SELECT a.id,a.identity_id,a.state,a.started_at,a.submitted_at,a.released_at,i.name student_name,
   COALESCE(sum(sm.marks),0)::int score,count(sm.stage_key)::int marked_stages
   FROM paper4_attempts a JOIN identities i ON i.id=a.identity_id LEFT JOIN paper4_stage_marks sm ON sm.attempt_id=a.id
   WHERE a.paper_id=$1 GROUP BY a.id,i.name ORDER BY a.started_at DESC,a.id DESC`,[paper.id])).rows;
  return respond(200,{items:rows.map(a=>({id:a.id,paperId:paper.id,identityId:a.identity_id,
   studentIdentityId:a.identity_id,studentName:a.student_name,
   status:a.state,startedAt:a.started_at,submittedAt:a.submitted_at,releasedAt:a.released_at,
   score:a.marked_stages?Number(a.score):null,markedStages:Number(a.marked_stages),totalStages:paper.definition.questions.reduce((n,q)=>n+q.stages.length,0)}))});
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
  const task=await transaction(pool,async db=>{
   const a=await writableAttempt(db,user,attemptId);questionFor(a,fileKey);
   const pending=one(await db.query(`SELECT count(*)::int count FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id
    WHERE s.attempt_id=$1 AND t.state IN ('queued','leased')`,[attemptId]));
   if(pending.count>=3)fail(429,'TOO_MANY_PENDING','请等待已有运行完成');
   const snap=await snapshotDraft(db,a,fileKey,null);
   const queued=one(await db.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id,state,created_at',[snap.id]));
   await log(db,user,'paper4.run','paper4_run_task',queued.id,{attemptId,fileKey});return queued;
  });return respond(201,{id:task.id,state:task.state,createdAt:task.created_at});
 }
 m=route.match(/^\/paper4\/runs\/([^/]+)$/);
 if(m&&method==='GET'){
  const task=one(await pool.query(`SELECT t.*,s.attempt_id,a.identity_id,p.owner_account_id,p.class_id FROM paper4_run_tasks t
   JOIN paper4_snapshots s ON s.id=t.snapshot_id JOIN paper4_attempts a ON a.id=s.attempt_id
   JOIN paper4_papers p ON p.id=a.paper_id WHERE t.id=$1`,[uuid(m[1],'运行 ID')]));
  await ensureCurrentTeacher(pool,user,task);
  if(task.identity_id!==user.identityId&&!canManage(user,task))fail(403,'FORBIDDEN','无权查看此运行');
  const run=(await pool.query('SELECT status,public_output,public_message,private_results,created_at FROM paper4_runs WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1',[task.id])).rows[0];
  const publicResults=(run?.private_results??[]).filter(r=>r.public===true).map(r=>({caseId:r.caseId,status:r.status,
   stdout:r.stdout??'',stderr:r.stderr??'',generatedFiles:r.generatedFiles??{},checks:r.checks??[]}));
  return respond(200,{id:task.id,state:task.state,createdAt:task.created_at,
   result:run?{status:run.status,publicOutput:run.public_output,publicMessage:run.public_message,
    publicResults,createdAt:run.created_at}:null});
 }
 m=route.match(/^\/paper4\/attempts\/([^/]+)\/submit$/);
 if(m&&method==='POST'){
  const id=uuid(m[1],'答卷 ID');
  await transaction(pool,async db=>{
   const a=await writableAttempt(db,user,id);
   for(const q of a.definition.questions)await snapshotDraft(db,a,q.key,null);
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
