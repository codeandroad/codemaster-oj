import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readUnifiedAcslCourse} from '../lib/acsl-unified-course.mjs';
import {unifiedState} from '../lib/local-acsl-course-api.mjs';
import {extensionStage,extensionMetadata,appendCourseTopics} from '../lib/acsl-course-extension.mjs';

const prior=['number-systems','recursion','program-tracing'],next=[...prior,'expressions','bit-strings','lisp'];
const chapter=c=>({...structuredClone(c),id:randomUUID(),problems:[],paper4Links:[],acslLinks:c.acslLinks.map(r=>({...r,versionId:randomUUID()}))});
async function fixture(){
 const {document:previous}=await readUnifiedAcslCourse({unitIds:prior}),{document}=await readUnifiedAcslCourse({unitIds:next});
 const course={...structuredClone(previous),id:randomUUID(),canEdit:true,published:false,archived:false,chapters:previous.chapters.map(chapter)};
 const state=unifiedState(course,previous,'http://localhost:3004');return {previous,document,course,state};
}
test('append resumes after metadata or a lost chapter response, retaining old identities and pins',async()=>{
 const {previous,document,course,state}=await fixture();
 assert.equal(extensionStage(course,previous,document,state),'original');
 Object.assign(course,extensionMetadata(document));assert.equal(extensionStage(course,previous,document,state),'appending');
 course.chapters.push(chapter(document.chapters[course.chapters.length]));assert.equal(extensionStage(course,previous,document,state),'appending');
 const known=unifiedState(course,document,state.origin);
 while(course.chapters.length<document.chapters.length)course.chapters.push(chapter(document.chapters[course.chapters.length]));
 assert.equal(extensionStage(course,previous,document,state,known),'complete');
 assert.deepEqual(course.chapters.slice(0,state.chapterIds.length).map(c=>c.id),state.chapterIds);
 assert.deepEqual(Object.keys(extensionMetadata(document)),['title','description','estimatedMinutes','localizations','sections']);
});
test('teacher edits, publication, missing lessons, duplicates, changed pins and identity cannot be overwritten',async()=>{
 const {previous,document,course,state}=await fixture();
 const mutations=[c=>c.chapters[0].content+=' edited',c=>c.chapters[0].localizations.zh.content+=' 改',c=>c.published=true,c=>c.archived=true,c=>c.canEdit=false,
  c=>c.id=randomUUID(),c=>c.chapters[0].id=randomUUID(),c=>c.chapters.find(ch=>ch.acslLinks.length).acslLinks[0].versionId=randomUUID(),c=>c.chapters.pop(),
  c=>c.chapters.push(chapter(document.chapters[10])),c=>c.sections[0].title='Changed'];
 for(const mutate of mutations){const changed=structuredClone(course);mutate(changed);assert.throws(()=>extensionStage(changed,previous,document,state),undefined,mutate.toString());}
 const changed=structuredClone(document);changed.chapters[0].checkpointAnswer+=' changed';assert.throws(()=>extensionStage(course,previous,changed,state),/Previously authored/);
 Object.assign(course,extensionMetadata(document));course.chapters.push(chapter(document.chapters[10]));const known=unifiedState(course,document,state.origin);
 course.chapters[10].id=randomUUID();assert.throws(()=>extensionStage(course,previous,document,state,known),/IDs changed/);
});
test('only an authored prefix can be extended; topics cannot be skipped or reordered',async()=>{
 for(const unitIds of [['recursion'],['number-systems','program-tracing'],['number-systems','unknown']])await assert.rejects(readUnifiedAcslCourse({unitIds}),/curriculum prefix/);
});

test('an older API without revision guards is refused before any course write',async()=>{
 const {previous,document,course,state}=await fixture();const writes=[];
 const api={origin:state.origin,request:async(path,body)=>{if(body)writes.push({path,body});return structuredClone(course);}};
 await assert.rejects(appendCourseTopics({api,document,previousDocument:previous,state,receipt:{knownState:state},saveReceipt:async()=>{}}),/support draft revision guards/);
 assert.deepEqual(writes,[]);
});
