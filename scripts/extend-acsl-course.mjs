// Append reviewed topics to an existing local unified draft. No existing
// chapter PATCH, publication, progress, formal-answer or reward write is used.
import assert from 'node:assert/strict';
import {readFile,open,unlink,rename,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readUnifiedAcslCourse} from './lib/acsl-unified-course.mjs';
import {checkAcslTutorials} from './check-acsl-tutorials.mjs';
import {localCourseOptions,localCourseApi,unifiedState} from './lib/local-acsl-course-api.mjs';
import {extensionStage,appendCourseTopics} from './lib/acsl-course-extension.mjs';
import {matchesTutorialDraft} from './import-acsl-tutorials.mjs';

async function save(filename,value){
 await writeFile(`${filename}.tmp`,JSON.stringify(value,null,2)+'\n',{mode:0o600});
 await rename(`${filename}.tmp`,filename);
}
export async function extendAcslCourse(argv=process.argv.slice(2)){
 const options=localCourseOptions(argv,{merging:true}),{document}=await readUnifiedAcslCourse();
 await checkAcslTutorials();
 if(!options.origin&&!options.authFile&&!options.apply){console.log(JSON.stringify({validated:true,topics:document.sections.length,lessons:document.chapters.length}));return;}
 const api=await localCourseApi(options);
 const state=JSON.parse(await readFile(api.journal,'utf8'));
 assert.equal(state.origin,api.origin);assert.ok(state.courseId&&state.chapterIds&&state.acslReferences,'A completed unified import/merge journal is required.');
 const hash=createHash('sha256').update(JSON.stringify(document)).digest('hex');
 let course=await api.request(`learning-paths/${state.courseId}`);
 if(state.hash===hash){assert.ok(matchesTutorialDraft(course,document,state),'Current draft differs from its import journal.');console.log(JSON.stringify({alreadyCurrent:true,courseId:course.id,lessons:course.chapters.length,published:false}));return;}
 const filename=`${api.journal}.extend-${hash}.json`;
 let receipt;try{receipt=JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 let previousDocument;
 if(receipt){
  assert.deepEqual(receipt.initialState,state,'Import journal changed during extension.');
  assert.equal(receipt.targetHash,hash);previousDocument=receipt.previousDocument;
 }else{
  ({document:previousDocument}=await readUnifiedAcslCourse({unitIds:course.sections.map(s=>s.key)}));
  assert.equal(createHash('sha256').update(JSON.stringify(previousDocument)).digest('hex'),state.hash,'Earlier authoring source changed; review before extending.');
  assert.ok(matchesTutorialDraft(course,previousDocument,state),'Existing course was edited, moved, archived or published. No content will be overwritten.');
  receipt={initialState:state,targetHash:hash,previousDocument,before:course,knownState:state};
 }
 const plan={courseId:course.id,fromLessons:previousDocument.chapters.length,toLessons:document.chapters.length,addedTopics:document.sections.slice(previousDocument.sections.length).map(s=>s.key),published:false};
 extensionStage(course,previousDocument,document,state,receipt.knownState);
 if(!options.apply){console.log(JSON.stringify({dryRun:true,...plan}));return;}
 const lock=await open(`${api.journal}.lock`,'wx',0o600);
 try{
  // Refresh after acquiring the shared import lock. A lost HTTP response is
  // reconciled by exact prefix content, IDs and pinned references on retry.
  assert.deepEqual(JSON.parse(await readFile(api.journal,'utf8')),state,'Another import updated the journal.');
  await save(filename,receipt);
  course=await appendCourseTopics({api,document,previousDocument,state,receipt,saveReceipt:value=>save(filename,value)});
  const finalState=unifiedState(course,document,api.origin);
  assert.ok(matchesTutorialDraft(course,document,finalState));
  await save(filename,{...receipt,knownState:finalState,complete:true});await save(api.journal,finalState);
  console.log(JSON.stringify({extended:true,...plan,preview:`${api.origin}/teacher/courses/${course.id}?preview=1`}));
 }finally{await lock.close();await unlink(`${api.journal}.lock`);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await extendAcslCourse();
