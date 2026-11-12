// Unified course import for a fresh local teacher environment. Existing split
// drafts must be consolidated, never replaced with newly-created lesson IDs.
import assert from 'node:assert/strict';
import {readFile,open,unlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readUnifiedAcslCourse} from './lib/acsl-unified-course.mjs';
import {localCourseOptions,localCourseApi,unifiedState,saveUnifiedState} from './lib/local-acsl-course-api.mjs';
import {matchesTutorialDraft} from './import-acsl-tutorials.mjs';
import {checkAcslTutorials} from './check-acsl-tutorials.mjs';
export async function importUnifiedAcslCourse(argv=process.argv.slice(2)){
 const options=localCourseOptions(argv),{document,units}=await readUnifiedAcslCourse();await checkAcslTutorials();
 if(!options.apply){console.log(JSON.stringify({validated:true,course:document.title,topics:units.length,lessons:document.chapters.length,practiceLinks:document.chapters.reduce((n,c)=>n+c.acslLinks.length,0)}));return;}
 const api=await localCourseApi(options),lock=await open(`${api.journal}.lock`,'wx',0o600);
 try{
  let state;try{state=JSON.parse(await readFile(api.journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const hash=createHash('sha256').update(JSON.stringify(document)).digest('hex');
  if(state){assert.equal(state.hash,hash,'Authored content changed; review an explicit update rather than overwriting existing lessons.');assert.equal(state.origin,api.origin);}
  let course;
  if(state?.courseId){course=await api.request(`learning-paths/${state.courseId}`);assert.ok(matchesTutorialDraft(course,document,state),'Existing unified course was edited or published; it will not be overwritten.');}
  else{
   const list=(await api.request('learning-paths')).items;
   const active=list.filter(c=>!c.archived&&c.canEdit);
   assert.ok(!active.some(c=>units.some(unit=>c.title===unit.document.title)),'Split topic courses already exist. Use merge-acsl-tutorials.mjs to preserve their lesson IDs and progress.');
   const candidates=active.filter(c=>c.title===document.title);
   assert.ok(candidates.length<=1,'Ambiguous unified course drafts; review before importing.');
   if(candidates.length){course=await api.request(`learning-paths/${candidates[0].id}`);assert.ok(matchesTutorialDraft(course,document),'Same-title course differs from the authoring source.');}
   else{
    assert.ok(!state?.started,'An earlier import was interrupted; review the teacher catalogue before retrying.');
    await writeFile(api.journal,JSON.stringify({hash,origin:api.origin,started:true})+'\n',{mode:0o600});
    const created=await api.request('learning-paths/import',document);
    await writeFile(api.journal,JSON.stringify({hash,origin:api.origin,courseId:created.id})+'\n',{mode:0o600});
    course=await api.request(`learning-paths/${created.id}`);assert.ok(matchesTutorialDraft(course,document));
   }
  }
  await saveUnifiedState(api.journal,unifiedState(course,document,api.origin));
  console.log(JSON.stringify({courseId:course.id,topics:course.sections.length,lessons:course.chapters.length,published:course.published,preview:`${api.origin}/teacher/courses/${course.id}?preview=1`}));
 }finally{await lock.close();await unlink(`${api.journal}.lock`);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await importUnifiedAcslCourse();
