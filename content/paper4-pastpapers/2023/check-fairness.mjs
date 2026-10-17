// Additional fairness probes: trusted source transformations are sent only to the isolated judge.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const papers=['9618_s23_41','9618_s23_42','9618_w23_41','9618_w23_42','9618_s24_41','9618_s24_42','9618_w24_41','9618_w24_42'];
const replace=(source,from,to)=>{if(!source.includes(from))throw Error('Probe substitution missing: '+from);return source.replaceAll(from,to);};
const jobs=[];
for(const key of papers){
 const year='20'+key.slice(6,8),bytes=await readFile(join(root,'content/paper4-pastpapers',year,key+'.json'));
 const p=JSON.parse(bytes),sha256=createHash('sha256').update(bytes).digest('hex');
 const fixed={...p.referenceSolutions};
 if(key==='9618_s23_41'){
  fixed.Q1=replace(fixed.Q1,'print(*DataArray)',"print(*[DataArray[i] for i in range(25)])");
  fixed.Q1=replace(fixed.Q1,'for value in DataArray:',"for index in range(25):\n        value=DataArray[index]");
 }
 if(key==='9618_s23_42'){
  fixed.Q1=replace(fixed.Q1,'range(len(Animals))','range(10)');
  fixed.Q1=replace(fixed.Q1,'range(len(Animals)-X-1)','range(10-X-1)');
  fixed.Q3=replace(fixed.Q3,'range(0,len(lines),2)','range(0,16,2)');
 }
 if(key==='9618_w23_41')fixed.Q2=replace(fixed.Q2,'for line in f:Enqueue(line.strip())','for _ in range(23):Enqueue(f.readline().strip())');
 if(key==='9618_w23_42')fixed.Q1=replace(fixed.Q1,'for line in f:PushData(line.strip())','for _ in range(100):PushData(f.readline().strip())');
 if(key==='9618_s24_41')fixed.Q2=replace(fixed.Q2,'for line in f:\n','for _ in range(9):\n                line=f.readline()\n');
 if(key==='9618_s24_42')fixed.Q3=replace(fixed.Q3,'range(1,NumberElements)','range(1,7)');
 if(key==='9618_w24_41'){
  fixed.Q1=replace(fixed.Q1,"' '.join(Data)","' '.join(Data[i] for i in range(45))");
  fixed.Q1=replace(fixed.Q1,'range(len(Data)-1)','range(44)');
  fixed.Q1=replace(fixed.Q1,'range(len(Data)-x-1)','range(44-x)');
 }
 if(key==='9618_w24_42'){
  fixed.Q3=replace(fixed.Q3,"for player,level,score in HighScores:print(player,'reached level',level,'with a score of',score)","for i in range(7):\n        player,level,score=HighScores[i]\n        print(player,'reached level',level,'with a score of',score)");
  fixed.Q3=replace(fixed.Q3,'range(len(HighScores)-1)','range(6)');
  fixed.Q3=replace(fixed.Q3,'range(len(HighScores)-x-1)','range(6-x)');
 }
 for(const question of p.questions){
  let code=fixed[question.key];
  if(code.includes('input(')){
   code="import builtins\ndef _printed_prompt(prompt=''):\n    print(prompt)\n    return builtins.input()\n"+code.replaceAll('input(','_printed_prompt(');
  }
  const cases=question.stages.filter(s=>s.judgeMode==='auto').flatMap(s=>(p.runnerCases[s.id]??[]).map(c=>({...c,stageId:s.id,public:true})));
  jobs.push({key,sha256,question,sourceCode:code,cases});
 }
}
const execute=String.raw`import {GoJudge} from './judge.mjs';import {runPaper4Snapshot} from './paper4-runner.mjs';let input='';for await(const part of process.stdin)input+=part;const jobs=JSON.parse(input),judge=new GoJudge();for(const job of jobs){try{const result=await runPaper4Snapshot({sourceCode:job.sourceCode,question:job.question,runnerCases:job.cases},judge);console.log(JSON.stringify({key:job.key,sha256:job.sha256,question:job.question.key,status:result.status,cases:job.cases.length,failures:result.privateResults.filter(x=>x.status!=='AC')}));}catch(e){console.log(JSON.stringify({key:job.key,sha256:job.sha256,question:job.question.key,error:e.message}));}}`;
const args=['compose','--project-name','campus-judge-paper4-preview','--env-file','deploy/.env.paper4.local','-f','deploy/compose.local.yaml','-f','deploy/compose.paper4-preview.yaml','exec','-T','worker','node','--input-type=module','-e',execute];
const child=spawn('docker',args,{cwd:root,stdio:['pipe','pipe','inherit']});
const exited=new Promise(resolve=>child.once('close',resolve));child.stdin.end(JSON.stringify(jobs));
let text='';for await(const chunk of child.stdout)text+=chunk;
const exitCode=await exited;
const reports=text.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
for(const item of reports)console.log(`${item.status??'ERROR'} ${item.key} ${item.question}: ${item.cases??0} cases ${item.failures?.length??1} failures`);
const passed=exitCode===0&&reports.length===jobs.length&&reports.every(r=>r.status==='AC'&&!r.failures.length);
const directory=join(root,'.campus-local/paper4-pastpapers-validation');await mkdir(directory,{recursive:true});
await writeFile(join(directory,'fairness-style-probes-2023-2024.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed,questions:reports},null,2)+'\n');
if(!passed)process.exitCode=1;
