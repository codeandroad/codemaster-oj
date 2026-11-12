// Only the platform administrator maintains the unified ACSL source. Reuse
// its existing course/chapter IDs; never replace an edited or published source.
import assert from 'node:assert/strict';
import {readFile,open,unlink,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readUnifiedAcslCourse} from './lib/acsl-unified-course.mjs';
import {localCourseOptions,localCourseApi,unifiedState,saveUnifiedState} from './lib/local-acsl-course-api.mjs';
import {matchesTutorialDraft} from './import-acsl-tutorials.mjs';
import {checkAcslTutorials} from './check-acsl-tutorials.mjs';
const legacySchoolId='00000000-0000-4000-8000-000000000052';
const migratedCourseId='ff018311-56ec-4aa2-ba66-04e7925c18a8';
function assertSource(course,document,state){
 assert.equal(course.ownerScope,'platform','The ACSL source must be owned by the platform.');
 assert.ok(matchesTutorialDraft(course,document,state),'Existing platform course was edited, archived or published; it will not be overwritten.');
}
export async function importUnifiedAcslCourse(argv=process.argv.slice(2)){
 const options=localCourseOptions(argv),{document,units}=await readUnifiedAcslCourse();await checkAcslTutorials();
 if(!options.apply){console.log(JSON.stringify({validated:true,course:document.title,topics:units.length,lessons:document.chapters.length,practiceLinks:document.chapters.reduce((n,c)=>n+c.acslLinks.length,0)}));return;}
 const api=await localCourseApi(options),lock=await open(`${api.journal}.lock`,'wx',0o600);
 try{
  let state;try{state=JSON.parse(await readFile(api.journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const hash=createHash('sha256').update(JSON.stringify(document)).digest('hex');
  if(state){assert.equal(state.hash,hash,'Authored content changed; review an explicit update rather than overwriting existing lessons.');assert.equal(state.origin,api.origin);}
  let course;
  if(state?.courseId){course=await api.request(`platform/courses/${state.courseId}`);assertSource(course,document,state);}
  else{
   const list=(await api.request('platform/courses')).items;
   assert.ok(!list.some(c=>units.some(unit=>c.title===unit.document.title)),'Historical split courses require a reviewed migration preserving their IDs and progress.');
   // A renamed migrated source is still the source. Never create a same-role
   // replacement merely because its platform administrator changed the title.
   const candidates=list.filter(c=>c.id===migratedCourseId||c.title===document.title);
   assert.ok(candidates.length<=1,'Ambiguous unified course drafts; review before importing.');
   if(candidates.length){course=await api.request(`platform/courses/${candidates[0].id}`);assertSource(course,document);}
   else{
    assert.ok(!state?.started||state.requestId,'An earlier import was interrupted; review the platform catalogue before retrying.');
    const requestId=state?.requestId??randomUUID();
    await writeFile(api.journal,JSON.stringify({hash,origin:api.origin,started:true,requestId})+'\n',{mode:0o600});
    const created=await api.request('platform/courses',{...document,requestId,audienceScope:'schools',schoolIds:[legacySchoolId],studentIds:[]});
    await writeFile(api.journal,JSON.stringify({hash,origin:api.origin,courseId:created.id})+'\n',{mode:0o600});
    course=await api.request(`platform/courses/${created.id}`);assertSource(course,document);
   }
  }
  await saveUnifiedState(api.journal,unifiedState(course,document,api.origin));
  console.log(JSON.stringify({courseId:course.id,ownerScope:course.ownerScope,topics:course.sections.length,lessons:course.chapters.length,published:course.published,editor:`${api.origin}/platform?section=courses&courseId=${course.id}`}));
 }finally{await lock.close();await unlink(`${api.journal}.lock`);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await importUnifiedAcslCourse();
