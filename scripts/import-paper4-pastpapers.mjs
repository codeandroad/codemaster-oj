// Adds verified past-paper packages as unassigned, unpublished drafts in the
// local port-3002 preview. No seeding, password resets or remote deployment.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const state=JSON.parse(await readFile(join(root,'.campus-local/test-accounts.json'),'utf8'));
const origin=state.base,parsedOrigin=new URL(origin);
if(!['127.0.0.1','localhost'].includes(parsedOrigin.hostname)||parsedOrigin.port!=='3002')throw new Error('Past-paper import is limited to the isolated local port3002 preview.');
const teacher=state.accounts?.teacher;if(!teacher?.username||!teacher.password)throw new Error('Existing local teacher credentials are required; this script never creates or resets accounts.');
const year=process.argv.find(arg=>arg.startsWith('--year='))?.slice(7);
const only=process.argv.find(arg=>arg.startsWith('--paper='))?.slice(8);
const folder=join(root,'.campus-local/paper4-pastpapers-validation');
const reportPath=join(root,'.campus-local/paper4-pastpapers-import.json');
let previous={};try{previous=JSON.parse(await readFile(reportPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const reports={...previous};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const content=paper=>Object.fromEntries(['title','description','examYear','examSession','examVariant','classId','startsAt','endsAt','questions','runnerCases','referenceSolutions'].map(key=>[key,paper[key]??null]));
let cookie='',csrf='';
async function request(path,method='GET',body){
 const response=await fetch(`${origin}/api/v1/${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(result.csrfToken)csrf=result.csrfToken;
 if(!response.ok)throw new Error(`${method} ${path}: HTTP${response.status} ${result.error?.code??''} ${result.error?.message??''}`);
 return result;
}
await request('auth/login','POST',{username:teacher.username,password:teacher.password});
const existing=(await request('paper4/papers')).items;
const years=year?[year]:(await readdir(join(root,'content/paper4-pastpapers'))).filter(name=>/^20\d\d$/.test(name)).sort();
const jobs=[];
for(const y of years)for(const filename of (await readdir(join(root,'content/paper4-pastpapers',y))).filter(name=>/^9618_[sw]\d\d_4[123]\.json$/.test(name)).sort()){
 const key=filename.slice(0,-5);if(only&&key!==only)continue;
 const bytes=await readFile(join(root,'content/paper4-pastpapers',y,filename));
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const checked=JSON.parse(await readFile(join(folder,`${key}.json`),'utf8'));
 if(!checked.passed||checked.sha256!==sha256)throw new Error(`${key} has no current passing isolated validation. Run validate-paper4-pastpapers first.`);
 const preview=await request('paper4/imports/preview','POST',{filename,contentBase64:bytes.toString('base64')});
 const body={...preview.createBody,classId:null,startsAt:null,endsAt:null};
 const found=reports[key]?.id?existing.find(item=>item.id===reports[key].id):existing.find(item=>item.canManage&&item.examYear===body.examYear&&item.examSession===body.examSession&&item.examVariant===body.examVariant);
 let paper;
 if(found){
  paper=await request(`paper4/papers/${found.id}`);
  if(paper.status!=='draft'||paper.archivedAt)throw new Error(`${key}: existing paper is published/archived; no changes were made.`);
  if(reports[key]?.serverDigest&&digest(content(paper))!==reports[key].serverDigest)throw new Error(`${key}: teacher edits detected; no overwrite was made.`);
  if(reports[key]?.sha256!==sha256){
   if(!reports[key]?.serverDigest)throw new Error(`${key}: existing untracked draft requires manual review.`);
   paper=await request(`paper4/papers/${paper.id}`,'PATCH',body);
  }
 }else paper=await request('paper4/papers','POST',body);
 reports[key]={id:paper.id,year:Number(y),sha256,serverDigest:digest(content(paper)),url:`${origin}/teacher/paper4/${paper.id}`,title:paper.title,status:paper.status,validated:false};
 await mkdir(join(root,'.campus-local'),{recursive:true});await writeFile(reportPath,JSON.stringify(reports,null,2)+'\n');
 const tasks=[];
 for(const question of paper.questions){
  if(question.stages.filter(stage=>stage.judgeMode==='auto').every(stage=>paper.referenceValidation?.[stage.id]?.status==='AC'))continue;
  tasks.push(...(await request(`paper4/papers/${paper.id}/reference-runs`,'POST',{questionKey:question.key})).items);
 }
 jobs.push({key,paperId:paper.id,tasks});
 console.log(`DRAFT ${key}: ${paper.questions.length} questions, ${preview.preview.caseCount} cases, ${tasks.length} stage checks queued`);
}
const pending=jobs.flatMap(job=>job.tasks.map(task=>({...task,key:job.key}))),failures=[];
const deadline=Date.now()+10*60*1000;
while(pending.length&&Date.now()<deadline){
 for(let index=pending.length-1;index>=0;index--){
  const task=pending[index],result=await request(`paper4/runs/${task.id}`);
  if(!['completed','failed'].includes(result.state))continue;
  pending.splice(index,1);
  if(result.state!=='completed'||result.result?.status!=='AC')failures.push({key:task.key,stageId:task.stageId,state:result.state,result:result.result});
 }
 if(pending.length)await new Promise(resolve=>setTimeout(resolve,500));
}
for(const job of jobs){
 const paper=await request(`paper4/papers/${job.paperId}`);
 const valid=paper.questions.flatMap(q=>q.stages).filter(s=>s.judgeMode==='auto').every(s=>paper.referenceValidation?.[s.id]?.status==='AC');
 reports[job.key]={...reports[job.key],validated:valid,status:paper.status,verifiedAt:new Date().toISOString()};
 console.log(`${valid?'VERIFIED':'NEEDS_REVIEW'} ${job.key}: ${reports[job.key].url}`);
}
await writeFile(reportPath,JSON.stringify(reports,null,2)+'\n');
if(pending.length||failures.length||jobs.some(job=>!reports[job.key].validated)){
 await writeFile(join(root,'.campus-local/paper4-pastpapers-worker-failures.json'),JSON.stringify({pending,failures},null,2)+'\n');process.exitCode=1;
}
