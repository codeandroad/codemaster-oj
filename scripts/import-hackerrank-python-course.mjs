// Local-only, resumable draft import. No publication, school review, Luq grants,
// content publication, student submissions, or production operations.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLearningMarkdown } from '../apps/web/src/components/teacher/learning-document.ts';
import { validateLearningDocument } from '../packages/domain/src/learning-document.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=resolve(root,'content/hackerrank-python');
const privateDir=resolve(root,'.campus-local/hackerrank-python-course');
const origin=process.env.CAMPUS_LOCAL_ORIGIN??'http://127.0.0.1:3000';
const base=new URL(origin);
assert.ok(['127.0.0.1','localhost'].includes(base.hostname)&&base.protocol==='http:','Local HTTP only');
const markdown=await readFile(resolve(dir,'course.md'),'utf8');
const source=await readFile(resolve(dir,'problems.json'),'utf8');
const doc=validateLearningDocument(parseLearningMarkdown(markdown));
const problems=JSON.parse(source);
assert.equal(doc.chapters.length,17);assert.equal(problems.length,115);
const hash=createHash('sha256').update(markdown).update('\0').update(source).digest('hex');
const statePath=resolve(privateDir,'native-import-state.json');
let state;
try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
state??={schema:1,hash,courseId:null,groupId:null,batches:Array.from({length:5},()=>({key:randomUUID(),items:[]}))};
assert.equal(state.schema,1);assert.equal(state.hash,hash,'Source changed: review the recorded draft import before changing versions');
async function save(){await mkdir(privateDir,{recursive:true,mode:0o700});const temp=statePath+'.tmp';await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(temp,statePath);}
await save();
const credentials=JSON.parse(await readFile(resolve(root,'.campus-local/test-accounts.json'),'utf8')).accounts;
let cookie='',csrf='';
async function api(path,body,method=body===undefined?'GET':'POST'){
 const r=await fetch(origin+'/api/v1/'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await r.json();if(!r.ok)throw Error(`${method} ${path}: HTTP ${r.status} ${value.error?.code??''}`);
 if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;return value;
}
async function waitForValidation(items){
 const until=Date.now()+15*60_000;
 while(Date.now()<until){
  const details=[];
  for(const p of items)details.push(await api(`problems/${p.id}?versionId=${p.versionId}`));
  const pending=details.filter(p=>['Waiting','Judging'].includes(p.validationStatus));
  const failed=details.filter(p=>!['Waiting','Judging','AC'].includes(p.validationStatus));
  assert.equal(failed.length,0,'Reference validation failed: '+failed.map(p=>p.title+': '+p.validationStatus).join(', '));
  assert.ok(details.every(p=>!p.published),'Imported exercise unexpectedly published');
  if(!pending.length)return;
  await new Promise(r=>setTimeout(r,3000));
 }
 throw Error('Validation still pending; rerun this same importer to resume without duplicates');
}
await api('auth/login',{username:credentials.teacher.username,password:credentials.teacher.password});
try{
 if(!state.courseId){
  // Reuse the earlier 17-chapter index draft by exact content, never by title alone.
  for(const p of (await api('learning-paths')).items.filter(x=>x.title===doc.title&&!x.published)){
   const c=await api('learning-paths/'+p.id);
   if(c.chapters.length===17&&c.chapters.every((x,i)=>x.title===doc.chapters[i].title&&x.content===doc.chapters[i].content&&!x.problems.length)){state.courseId=p.id;break;}
  }
  if(!state.courseId)state.courseId=(await api('learning-paths/import',{format:'codemaster-learning-path',version:1,...doc})).id;
  await save();
 }
 const initial=await api('learning-paths/'+state.courseId);
 assert.ok(!initial.published&&initial.chapters.length===17&&initial.chapters.every((c,i)=>c.title===doc.chapters[i].title&&c.content===doc.chapters[i].content),'Course was edited/published: preserve it and review manually');
 for(const [i,batch] of state.batches.entries()){
  const expected=problems.slice(i*25,i*25+25);
  if(!batch.items.length){
   const receipt=await api('problems/import',{idempotencyKey:batch.key,filename:`hackerrank-python/part-${i+1}.json`,rows:expected.map(({chapterNumber,courseKey,sourceSlug,sourceId,...p})=>({...p,saveDraft:true}))});
   await writeFile(resolve(privateDir,`batch-${i+1}.json`),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
   assert.equal(receipt.summary.failed,0,'Inspect the private batch receipt; the idempotency key is retained');
   batch.items=receipt.items.map((x,j)=>({courseKey:expected[j].courseKey,chapterNumber:expected[j].chapterNumber,id:x.problem.id,versionId:x.problem.versionId}));await save();
  }
  assert.equal(batch.items.length,expected.length);
  await waitForValidation(batch.items);
  console.log(`Batch ${i+1}: ${batch.items.length} drafts validated in real sandbox`);
 }
 const items=state.batches.flatMap(b=>b.items);assert.equal(items.length,115);
 if(!state.groupId){
  const existing=(await api('problem-groups')).items.find(g=>g.name===doc.title&&items.every(p=>g.problemIds.includes(p.id)));
  state.groupId=existing?.id??(await api('problem-groups',{name:doc.title,problemIds:items.map(p=>p.id)})).id;await save();
 }
 const live=await api('learning-paths/'+state.courseId);
 for(const [i,c] of live.chapters.entries()){
  const ids=items.filter(p=>p.chapterNumber===i+1).map(p=>p.id);
  const current=c.problems.map(p=>p.problemId);
  assert.ok(current.length===0||JSON.stringify(current)===JSON.stringify(ids),'Chapter links were modified outside this import');
  if(!current.length)await api('chapters/'+c.id,{problemIds:ids},'PATCH');
 }
 const actual=await api('learning-paths/'+state.courseId);
 assert.equal(actual.published,false);
 for(const [i,c] of actual.chapters.entries()){
  assert.deepEqual(c.problems.map(p=>[p.problemId,p.versionId]),items.filter(p=>p.chapterNumber===i+1).map(p=>[p.id,p.versionId]));
  assert.ok(!c.checkpointAnswer);
 }
 // Student sessions must not retrieve draft bodies, reference programs or cases.
 const teacherSession={cookie,csrf};
 cookie='';csrf='';
 await api('auth/login',{username:credentials.student.username,password:credentials.student.password});
 try{
  for(const path of ['learning-paths/'+state.courseId,...items.map(p=>`problems/${p.id}?versionId=${p.versionId}`)]){
   const r=await fetch(origin+'/api/v1/'+path,{headers:{Cookie:cookie,Origin:origin}});const body=await r.text();
   assert.ok([403,404].includes(r.status),`Draft exposed at ${path}`);
   assert.ok(!body.includes('referenceCode')&&!body.includes('expected'),'Private material leaked');
  }
 }finally{await api('auth/logout',{});cookie=teacherSession.cookie;csrf=teacherSession.csrf;}
 const receipt={courseId:state.courseId,url:origin+'/teacher/courses/'+state.courseId,chapters:17,sourceLinks:115,localJudgeProblemsCreated:115,validatedReferences:115,linkedExercises:actual.chapters.reduce((s,c)=>s+c.problems.length,0),published:false,formatChoice:'original-corresponding-exercises',sourceHash:hash};
 await writeFile(resolve(privateDir,'native-import-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(receipt,null,2));
}finally{await api('auth/logout',{});}
