import test from 'node:test';
import assert from 'node:assert/strict';
import {paper4LearningContext,paper4ChapterHref,coursePaper4Href,paper4EntryKey,paper4InitialQuestion,coursePaper4Progress} from '../src/components/paper4/paper4-learning-navigation.ts';
import {createPaper4EntryLoader} from '../src/components/paper4/paper4-entry.ts';
const pathId='11111111-1111-4111-8111-111111111111',chapterId='22222222-2222-4222-8222-222222222222';
const paperId='33333333-3333-4333-8333-333333333333',versionId='44444444-4444-4444-8444-444444444444';
const context={learningPathId:pathId,chapterId};
const link={paperId,versionId,questionKey:null,title:'Circular queues',questions:[{key:'Q1',title:'Queue',completed:true},{key:'Q2',title:'Tree',completed:false,pending:true}]};

test('course practice links pin the exact version and carry only internal chapter context',()=>{
 const whole=new URL(coursePaper4Href(link,context),'https://school.example');
 assert.equal(whole.pathname,`/student/paper4/${paperId}`);assert.equal(whole.searchParams.get('versionId'),versionId);
 assert.equal(whole.searchParams.get('question'),null);assert.deepEqual(paper4LearningContext(whole.searchParams),context);
 const question=new URL(coursePaper4Href({...link,questionKey:'Q2'},context),'https://school.example');
 assert.equal(question.searchParams.get('question'),'Q2');assert.equal(question.searchParams.get('courseQuestion'),'Q2');
 assert.equal(whole.searchParams.get('courseQuestion'),null);
 const shortcut=new URL(coursePaper4Href(link,context,'Q1'),'https://school.example');assert.equal(shortcut.searchParams.get('question'),'Q1');assert.equal(shortcut.searchParams.get('courseQuestion'),null);
 assert.equal(paper4ChapterHref(context),`/student/learning-paths/${pathId}/chapters/${chapterId}`);
});

test('return navigation rejects incomplete or injected contexts and ignores arbitrary return URLs',()=>{
 for(const params of [new URLSearchParams(),new URLSearchParams({learningPathId:pathId}),new URLSearchParams({learningPathId:'//evil.example',chapterId}),new URLSearchParams({learningPathId:pathId,chapterId:'../settings'})])assert.equal(paper4LearningContext(params),null);
 const valid=new URLSearchParams({...context,returnTo:'https://evil.example'});
 assert.equal(paper4ChapterHref(paper4LearningContext(valid)),`/student/learning-paths/${pathId}/chapters/${chapterId}`);
});

test('different pinned versions never reuse an in-flight attempt request',async()=>{
 const open=createPaper4EntryLoader();let requests=0;
 const request={existing:async()=>{requests++;return{id:requests};},start:async()=>assert.fail('existing answer should be used'),missing:()=>false};
 const a=open(paper4EntryKey('student',paperId,versionId),request),b=open(paper4EntryKey('student',paperId,'new-version'),request);
 assert.notEqual(a,b);assert.equal(requests,2);await Promise.all([a,b]);
 assert.notEqual(paper4EntryKey('student',paperId),paper4EntryKey('student',paperId,versionId));
});

test('question deep links select the matching question, with a safe standalone fallback',()=>{
 assert.equal(paper4InitialQuestion(link.questions,'Q2').key,'Q2');
 assert.equal(paper4InitialQuestion(link.questions,'not-a-question').key,'Q1');
 assert.equal(paper4InitialQuestion(link.questions).key,'Q1');
 assert.equal(paper4InitialQuestion([], 'Q1'),undefined);
});

test('whole-paper and single-question completion use question AC progress and never infer it from rewards',()=>{
 assert.deepEqual(coursePaper4Progress(link),{total:2,completed:1,done:false,available:true,pending:1});
 assert.deepEqual(coursePaper4Progress({...link,questionKey:'Q1',questions:[link.questions[0]]}),{total:1,completed:1,done:true,available:true,pending:0});
 assert.equal(coursePaper4Progress({...link,completedQuestions:2,pendingQuestions:0}).done,true);
 assert.equal(coursePaper4Progress({...link,available:false}).available,false);
 assert.equal(coursePaper4Progress({...link,readyForCourse:false}).available,false);
 assert.equal(coursePaper4Progress({...link,completedQuestions:undefined,questions:[{key:'Q1',title:'Queue'}],rankAwards:[{questionKey:'Q1',points:10}],completed:true}).completed,0);
});
