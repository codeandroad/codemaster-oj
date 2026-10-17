// Runs authored references and a blank-answer control only in the existing
// isolated executor. The web/API process never evaluates package Python.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parsePaper4Import } from '../packages/domain/src/paper4-import.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const year=process.argv.find(arg=>arg.startsWith('--year='))?.slice(7);
const only=process.argv.find(arg=>arg.startsWith('--paper='))?.slice(8);
const years=year?[year]:(await readdir(join(root,'content/paper4-pastpapers'))).filter(name=>/^20\d\d$/.test(name)).sort();
const jobs=[];
for(const y of years)for(const name of (await readdir(join(root,'content/paper4-pastpapers',y))).filter(name=>/^9618_[sw]\d\d_4[123]\.json$/.test(name)).sort()){
 if(only&&!name.startsWith(only+'.'))continue;
 const path=join(root,'content/paper4-pastpapers',y,name),data=await readFile(path);
 const parsed=parsePaper4Import({filename:name,contentBase64:data.toString('base64')});
 jobs.push({key:name.slice(0,-5),sha256:createHash('sha256').update(data).digest('hex'),...parsed.createBody});
}
if(!jobs.length)throw new Error('No authored paper manifests found.');
const execute=String.raw`
import { GoJudge } from './judge.mjs';
import { runPaper4Snapshot } from './paper4-runner.mjs';
let input='';for await(const part of process.stdin)input+=part;
const jobs=JSON.parse(input),judge=new GoJudge();
for(const job of jobs){
 const questions=[];
 for(const question of job.questions){
  const cases=question.stages.filter(s=>s.judgeMode==='auto').flatMap(s=>(job.runnerCases[s.id]??[]).map(c=>({...c,stageId:s.id,public:true})));
  try{
   const reference=await runPaper4Snapshot({sourceCode:job.referenceSolutions[question.key],question,runnerCases:cases},judge);
   const blank=await runPaper4Snapshot({sourceCode:'pass\n',question,runnerCases:cases},judge);
   const wrongStages=question.stages.filter(s=>s.judgeMode==='auto'&&blank.privateResults.filter(c=>c.stageId===s.id).every(c=>c.status==='AC')).map(s=>s.id);
   const failures=reference.privateResults.filter(c=>c.status!=='AC');
   questions.push({key:question.key,cases:cases.length,passed:reference.status==='AC'&&reference.privateResults.length===cases.length&&!failures.length&&!wrongStages.length,referenceStatus:reference.status,failures,blankAcceptedStages:wrongStages});
  }catch(error){questions.push({key:question.key,passed:false,error:error.message});}
 }
 console.log(JSON.stringify({key:job.key,sha256:job.sha256,questions,passed:questions.every(q=>q.passed)}));
}
`;
const args=['compose','--project-name','campus-judge-paper4-preview','--env-file','deploy/.env.paper4.local','-f','deploy/compose.local.yaml','-f','deploy/compose.paper4-preview.yaml','exec','-T','worker','node','--input-type=module','-e',execute];
const child=spawn('docker',args,{cwd:root,stdio:['pipe','pipe','inherit']});
const exited=new Promise(resolve=>child.once('close',resolve));
child.stdin.end(JSON.stringify(jobs));
const report=[];let pending='';
for await(const chunk of child.stdout){pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;const item=JSON.parse(line);report.push(item);console.log(`${item.passed?'PASS':'FAIL'} ${item.key}: ${item.questions.map(q=>`${q.key} ${q.passed?'AC':'FAILED'} (${q.cases??0})`).join(', ')}`);}}
const code=await exited;
const output=join(root,'.campus-local/paper4-pastpapers-validation');await mkdir(output,{recursive:true});
for(const item of report)await writeFile(join(output,`${item.key}.json`),JSON.stringify({...item,validatedAt:new Date().toISOString()},null,2)+'\n');
if(code!==0||report.length!==jobs.length||report.some(item=>!item.passed))process.exitCode=1;
