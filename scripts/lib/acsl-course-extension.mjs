import assert from 'node:assert/strict';
import {matchesTutorialDraft} from '../import-acsl-tutorials.mjs';
import {unifiedState} from './local-acsl-course-api.mjs';

// An interrupted append may leave a valid prefix. Existing chapters and pins
// are immutable here; this is not a general replacement/import operation.
export function extensionStage(course,previousDocument,document,state,knownState=state){
 assert.equal(course.ownerScope,'platform','The ACSL source must be owned by the platform.');
 assert.equal(course.id,state.courseId,'Course identity changed.');
 assert.ok(document.chapters.length>previousDocument.chapters.length,'An extension must add lessons.');
 assert.deepEqual(document.chapters.slice(0,previousDocument.chapters.length),previousDocument.chapters,'Previously authored lessons changed; automatic append is refused.');
 assert.deepEqual(document.sections.slice(0,previousDocument.sections.length),previousDocument.sections,'Previously authored topics changed.');
 const count=course.chapters.length;
 assert.ok(count>=previousDocument.chapters.length&&count<=document.chapters.length,'Unexpected lesson count.');
 const current=unifiedState(course,document,state.origin);
 assert.deepEqual(current.chapterIds.slice(0,knownState.chapterIds.length),knownState.chapterIds,'Existing lesson IDs changed.');
 assert.deepEqual(current.acslReferences.slice(0,knownState.acslReferences.length),knownState.acslReferences,'Existing pinned practice references changed.');
 if(count===previousDocument.chapters.length&&matchesTutorialDraft(course,previousDocument,state))return 'original';
 assert.ok(matchesTutorialDraft(course,{...document,chapters:document.chapters.slice(0,count)}),'Course content, permissions or publication changed; append will not overwrite it.');
 return count===document.chapters.length?'complete':'appending';
}

export const extensionMetadata=document=>Object.fromEntries(['title','description','estimatedMinutes','localizations','sections'].map(field=>[field,document[field]]));
function guarded(course,body){
 assert.ok(Number.isInteger(course.revision)&&course.revision>0&&typeof course.sourceVersion==='string'&&course.sourceVersion,'The API must support platform revision guards before appending.');
 return {...body,expectedRevision:course.revision,sourceVersion:course.sourceVersion};
}

export async function appendCourseTopics({api,document,previousDocument,state,receipt,saveReceipt}){
 let course=await api.request(`platform/courses/${state.courseId}`);
 if(extensionStage(course,previousDocument,document,state,receipt.knownState)!=='complete'){
  // A single CAS-protected transaction keeps the original chapters and fixed
  // references intact. If its response is lost, retry reconciles the full result.
  const chapters=[...course.chapters.map(chapter=>Object.fromEntries(['id','title','content','objective','checkpoint','checkpointAnswer','sectionKey','localizations','acslLinks'].map(field=>[field,chapter[field]]))),...document.chapters.slice(course.chapters.length)];
  await api.request(`platform/courses/${course.id}`,guarded(course,{...extensionMetadata(document),chapters}),'PATCH');
  course=await api.request(`platform/courses/${course.id}`);
  extensionStage(course,previousDocument,document,state,receipt.knownState);
  receipt.knownState=unifiedState(course,document,api.origin);await saveReceipt(receipt);
 }
 return course;
}
