import {fail,field,uuid} from './security.mjs';

export function normalizeCoursePaper4Links(value=[]){
 if(!Array.isArray(value)||value.length>100)fail(400,'VALIDATION','每章最多关联 100 项 Paper 4 练习');
 return value.map(link=>{
  if(!link||typeof link!=='object'||Array.isArray(link))fail(400,'VALIDATION','Paper 4 练习引用无效');
  const questionKey=link.questionKey===undefined||link.questionKey===null||link.questionKey===''?null:field(link.questionKey,'Paper 4 大题编号',{max:40});
  if(questionKey!==null&&!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(questionKey))fail(400,'VALIDATION','Paper 4 大题编号格式无效');
  return {paperId:uuid(link.paperId,'Paper 4 试卷 ID'),...(link.versionId!==undefined&&link.versionId!==null?{versionId:uuid(link.versionId,'Paper 4 版本 ID')}:{}),questionKey};
 });
}
const canJudge=(question,cases)=>question?.stages?.some(stage=>stage.judgeMode==='auto')&&question.stages.filter(stage=>stage.judgeMode==='auto').every(stage=>Array.isArray(cases?.[stage.id])&&cases[stage.id].length>0);
const unit=(versionId,questionKey)=>`${versionId}:${questionKey}`;
const sameLink=(a,b)=>a.paper_id===b.paperId&&a.version_id===b.versionId&&a.question_key===b.questionKey;
export async function setChapterPaper4Links(db,chapterId,value){
 const input=normalizeCoursePaper4Links(value),old=(await db.query('SELECT paper_id,version_id,question_key FROM chapter_paper4_links WHERE chapter_id=$1',[chapterId])).rows;
 const resolved=[],seen=new Set();
 for(const link of input){
  // An unchanged reference keeps its published version when the paper advances.
  const previous=old.find(row=>row.paper_id===link.paperId&&row.question_key===link.questionKey);
  const versionId=link.versionId??previous?.version_id??null;
  const row=(await db.query(`SELECT p.id,p.delivery_kind,p.status,p.archived_at,v.id version_id,v.published_at,v.definition,v.runner_cases
   FROM paper4_papers p JOIN paper4_versions v ON v.paper_id=p.id AND v.id=COALESCE($2::uuid,p.current_version_id)
   WHERE p.id=$1 FOR SHARE OF p,v`,[link.paperId,versionId])).rows[0];
  if(!row)fail(409,'UNAVAILABLE_PAPER4_LINK','Paper 4 试卷或已发布版本不存在');
  const pinned={...link,versionId:row.version_id},unchanged=old.some(item=>sameLink(item,pinned));
  const available=row.delivery_kind==='catalog'&&row.status==='published'&&!row.archived_at&&!!row.published_at;
  const selected=row.definition.questions.filter(question=>!link.questionKey||question.key===link.questionKey);
  const questionExists=selected.length>0;
  if(questionExists&&!selected.every(question=>canJudge(question,row.runner_cases))&&!unchanged)fail(409,'UNJUDGEABLE_PAPER4_LINK','课程练习需要自动判题阶段；纯人工或证据评分大题不能作为完成任务');
  if((!available||!questionExists)&&!unchanged)fail(409,'UNAVAILABLE_PAPER4_LINK','课程只能关联已公开的 Paper 4 自由练习及其中的大题');
  const key=unit(pinned.versionId,pinned.questionKey??'');if(seen.has(key))continue;seen.add(key);resolved.push(pinned);
 }
 await db.query('DELETE FROM chapter_paper4_links WHERE chapter_id=$1',[chapterId]);
 for(const [position,link] of resolved.entries())await db.query('INSERT INTO chapter_paper4_links(chapter_id,paper_id,version_id,question_key,position) VALUES($1,$2,$3,$4,$5)',[chapterId,link.paperId,link.versionId,link.questionKey,position]);
}
export async function assertCoursePaper4Ready(db,pathId){
 const rows=(await db.query(`SELECT l.question_key,p.delivery_kind,p.status,p.archived_at,v.published_at,v.definition,v.runner_cases
  FROM chapter_paper4_links l JOIN learning_chapters c ON c.id=l.chapter_id
  JOIN paper4_papers p ON p.id=l.paper_id JOIN paper4_versions v ON v.id=l.version_id AND v.paper_id=p.id
  WHERE c.path_id=$1 AND c.archived_at IS NULL FOR SHARE OF p,v`,[pathId])).rows;
 if(rows.some(row=>row.delivery_kind!=='catalog'||row.status!=='published'||row.archived_at||!row.published_at||!row.definition.questions.filter(q=>!row.question_key||q.key===row.question_key).length||!row.definition.questions.filter(q=>!row.question_key||q.key===row.question_key).every(q=>canJudge(q,row.runner_cases))))fail(409,'UNAVAILABLE_PAPER4_LINK','关联的 Paper 4 练习已不可用，请修复引用后发布课程');
}
export async function loadCoursePaper4(db,pathIds,identityIds=[]){
 const data={rows:[],completed:new Map(),pending:new Map(),unitsByPath:new Map(),unitsByChapter:new Map()};
 if(!pathIds.length)return data;
 data.rows=(await db.query(`SELECT l.*,c.path_id,v.title,v.version_number,v.definition->'questions' questions,
  v.runner_cases,p.short_title,(p.delivery_kind='catalog' AND p.status='published' AND p.archived_at IS NULL AND v.published_at IS NOT NULL) available
  FROM chapter_paper4_links l JOIN learning_chapters c ON c.id=l.chapter_id
  JOIN paper4_papers p ON p.id=l.paper_id JOIN paper4_versions v ON v.id=l.version_id AND v.paper_id=p.id
  WHERE c.path_id=ANY($1::uuid[]) AND c.archived_at IS NULL ORDER BY c.position,c.id,l.position,l.id`,[pathIds])).rows;
 for(const row of data.rows){
  const selected=(row.questions??[]).filter(q=>!row.question_key||q.key===row.question_key);
  row.selectedQuestions=(row.questions??[]).filter(q=>!row.question_key||q.key===row.question_key).map(q=>({key:q.key,title:q.title}));
  row.available=!!row.available&&row.selectedQuestions.length>0&&selected.every(q=>canJudge(q,row.runner_cases));
  if(!row.available)continue;
  if(!data.unitsByPath.has(row.path_id))data.unitsByPath.set(row.path_id,new Set());
  if(!data.unitsByChapter.has(row.chapter_id))data.unitsByChapter.set(row.chapter_id,new Set());
  for(const question of row.selectedQuestions){const key=unit(row.version_id,question.key);data.unitsByPath.get(row.path_id).add(key);data.unitsByChapter.get(row.chapter_id).add(key);}
 }
 const versions=[...new Set(data.rows.filter(row=>row.available).map(row=>row.version_id))];
 if(!versions.length||!identityIds.length)return data;
 // rank_ac_valid is frozen by the trusted worker-commit trigger after checking
 // every automatic case of a formal whole-question snapshot. It does not mean
 // that a point award exists; retries and newer versions still count here.
 const rows=(await db.query(`SELECT DISTINCT a.identity_id,COALESCE(p.source_version_id,a.version_id) version_id,s.question_key,
  (r.rank_ac_valid AND a.state='submitted' AND a.submitted_at IS NOT NULL AND (p.delivery_kind<>'activity' OR p.activity_kind<>'exam' OR a.released_at IS NOT NULL)) completed,
  (t.state IN ('queued','leased')) pending
  FROM paper4_attempts a JOIN paper4_papers p ON p.id=a.paper_id JOIN paper4_versions actual ON actual.id=a.version_id
  JOIN paper4_snapshots s ON s.attempt_id=a.id AND s.origin='formal' AND s.stage_key IS NULL
  JOIN paper4_run_tasks t ON t.snapshot_id=s.id LEFT JOIN paper4_runs r ON r.task_id=t.id AND r.snapshot_id=s.id
  LEFT JOIN paper4_versions source ON source.id=p.source_version_id AND source.paper_id=p.source_paper_id
  WHERE a.identity_id=ANY($1::uuid[]) AND COALESCE(p.source_version_id,a.version_id)=ANY($2::uuid[])
   AND (p.source_version_id IS NULL OR source.published_at IS NOT NULL AND actual.definition=source.definition
    AND actual.runner_cases=source.runner_cases AND actual.reference_solutions=source.reference_solutions)
   AND (r.rank_ac_valid OR t.state IN ('queued','leased'))`,[identityIds,versions])).rows;
 for(const row of rows){
  const key=unit(row.version_id,row.question_key);
  for(const name of ['completed','pending'])if(row[name]){if(!data[name].has(row.identity_id))data[name].set(row.identity_id,new Set());data[name].get(row.identity_id).add(key);}
 }
 return data;
}
export function paper4Progress(data,kind,id,identityId){
 const units=data[kind==='path'?'unitsByPath':'unitsByChapter'].get(id)??new Set(),completed=data.completed.get(identityId)??new Set();
 return {taskCount:units.size,completedTasks:[...units].filter(key=>completed.has(key)).length};
}
export function chapterPaper4Links(data,chapterId,identityId,{includeUnavailable=false}={}){
 const completed=data.completed.get(identityId)??new Set(),pending=data.pending.get(identityId)??new Set();
 return data.rows.filter(row=>row.chapter_id===chapterId&&(includeUnavailable||row.available)).map(row=>{
  const questions=row.selectedQuestions.map(q=>({...q,completed:completed.has(unit(row.version_id,q.key)),pending:!completed.has(unit(row.version_id,q.key))&&pending.has(unit(row.version_id,q.key))}));
  const completedQuestions=questions.filter(q=>q.completed).length;
  return {paperId:row.paper_id,versionId:row.version_id,questionKey:row.question_key,title:row.title,shortTitle:row.short_title||row.title,
   questionTitle:row.question_key?questions[0]?.title??row.question_key:null,versionNumber:row.version_number,questionCount:questions.length,completedQuestions,
   pendingQuestions:questions.filter(q=>q.pending).length,completed:row.available&&questions.length>0&&completedQuestions===questions.length,questions,available:row.available,readyForCourse:row.available};
 });
}
