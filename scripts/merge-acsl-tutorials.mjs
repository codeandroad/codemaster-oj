// Preview by default. --apply executes exactly the authenticated server plan;
// the transaction preserves chapters, reading progress and pinned references.
import assert from 'node:assert/strict';
import {open,readFile,unlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readUnifiedAcslCourse} from './lib/acsl-unified-course.mjs';
import {localCourseOptions,localCourseApi,unifiedState,saveUnifiedState} from './lib/local-acsl-course-api.mjs';
import {matchesTutorialDraft} from './import-acsl-tutorials.mjs';
export async function mergeAcslTutorials(argv=process.argv.slice(2)){
 const options=localCourseOptions(argv,{merging:true}),{document,units}=await readUnifiedAcslCourse(),api=await localCourseApi(options);
 const lock=await open(`${api.journal}.lock`,'wx',0o600);
 try{
  let existing;try{existing=JSON.parse(await readFile(api.journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing?.courseId){const course=await api.request(`learning-paths/${existing.courseId}`);assert.ok(matchesTutorialDraft(course,document,existing),'Unified course changed; review it without remerging.');console.log(JSON.stringify({merged:false,alreadyUnified:true,courseId:course.id}));return;}
  const list=(await api.request('learning-paths')).items,courses=[];
  const recoveryFile=`${api.journal}.merge-plan.json`;
  let recovery;try{recovery=JSON.parse(await readFile(recoveryFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(recovery){
   assert.equal(recovery.origin,api.origin);assert.deepEqual(recovery.course,metadata(document));
   assert.ok(options.apply,'An earlier merge plan exists; inspect the saved private plan, then retry with --apply.');
   const receipt=await api.request(`learning-paths/${recovery.targetId}/merge`,{courses:recovery.courses,course:recovery.course,dryRun:false,expectedPlanHash:recovery.planHash});
   const final=await api.request(`learning-paths/${receipt.targetCourseId}`);assert.ok(matchesTutorialDraft(final,document));
   await saveUnifiedState(api.journal,unifiedState(final,document,api.origin));console.log(JSON.stringify({merged:true,recovered:true,courseId:final.id}));return;
  }
  for(const unit of units){
   const candidates=list.filter(c=>c.canEdit&&!c.archived&&!c.published&&c.title===unit.document.title);
   assert.equal(candidates.length,1,`${unit.id}: expected exactly one authored draft; review missing, duplicate or renamed courses.`);
   const course=await api.request(`learning-paths/${candidates[0].id}`);
   assert.ok(matchesTutorialDraft(course,unit.document),`${unit.id}: teacher content differs from authored source; it will not be replaced.`);
   courses.push({courseId:course.id,sectionKey:unit.id});
  }
  const targetId=courses[0].courseId,body={courses,course:metadata(document)},preview=await api.request(`learning-paths/${targetId}/merge`,{...body,dryRun:true});
  assert.equal(preview.chapterCount,document.chapters.length);console.log(JSON.stringify({dryRun:true,...preview}));
  if(!options.apply)return;
  await writeFile(recoveryFile,JSON.stringify({origin:api.origin,targetId,...body,planHash:preview.planHash},null,2)+'\n',{mode:0o600});
  const receipt=await api.request(`learning-paths/${targetId}/merge`,{...body,dryRun:false,expectedPlanHash:preview.planHash});
  const final=await api.request(`learning-paths/${targetId}`);assert.ok(matchesTutorialDraft(final,document));assert.deepEqual(final.chapters.map(c=>c.id),receipt.chapterIds);
  await saveUnifiedState(api.journal,unifiedState(final,document,api.origin));
  console.log(JSON.stringify({merged:true,courseId:final.id,topics:final.sections.length,lessons:final.chapters.length,published:final.published,preview:`${api.origin}/teacher/courses/${final.id}?preview=1`}));
 }finally{await lock.close();await unlink(`${api.journal}.lock`);}
}
const metadata=document=>Object.fromEntries(['title','description','category','estimatedMinutes','localizations','sections'].map(key=>[key,document[key]]));
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await mergeAcslTutorials();
