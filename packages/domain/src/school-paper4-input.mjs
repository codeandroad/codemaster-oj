import { fail, field, bytes, integer } from './security.mjs';
import { paper4ExamInput, paper4ShortTitle, paper4ShortTitleInput } from './paper4-catalog.mjs';
const keyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const filePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,75}\.(?:txt|csv|dat)$/i;
function key(value, name) {
 if (typeof value !== 'string' || !keyPattern.test(value)) fail(400, 'VALIDATION', `${name}格式无效`);
 return value;
}
function optionalText(value, name, max=2000) {
 return value === undefined || value === null ? '' : field(value, name, {min:0,max});
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

export function schoolPaper4Input(body) {
 const definition=definitionInput(body.questions,body.exam??body);
 const runnerCases=casesInput(body.runnerCases,definition),referenceSolutions=referenceSolutionsInput(body.referenceSolutions,definition);
 return {title:field(body.title,'Title',{max:200}),shortTitle:paper4ShortTitleInput(body.shortTitle),description:optionalText(body.description,'Description',10000),definition,runnerCases,referenceSolutions};
}
export {validateStageCoverage};
export const schoolPaper4Title=content=>paper4ShortTitle({...content,...content.definition?.exam});
