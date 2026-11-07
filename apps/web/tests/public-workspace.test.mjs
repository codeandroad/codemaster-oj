import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicWorkspaceProblem, publicPracticeHref, publicPracticeReturnHref, publicDraftStorage } from '../src/components/schools/public-workspace-model.ts';

const problem = {id:'p1',schoolId:'s1',versionId:'v1',title:'Example',published:true,definition:{mode:'stdio',statement:'Task',difficulty:'easy',objective:'Practice input',tags:['Introduction'],starterCode:'# starter',starterCodes:{python:'# starter',cpp:'// starter'},samples:[{input:'2',expected:'4'}],timeLimitMs:1000,memoryLimitMb:64,tests:[{input:'secret'}],referenceCode:'private',teacherNotes:'private'}};
const memory = () => { const data=new Map(); return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)}; };
test('workspace data only contains student-facing fields', () => {
  const value=publicWorkspaceProblem(problem);
  assert.equal(value.difficulty,'easy'); assert.equal(value.objective,'Practice input'); assert.deepEqual(value.tags,['Introduction']);
  assert.equal(value.statement,'Task'); assert.equal(value.starterCodes.cpp,'// starter');
  assert.deepEqual(value.samples,[{input:'2',expected:'4'}]);
  assert.ok(!JSON.stringify(value).includes('secret')); assert.ok(!JSON.stringify(value).includes('private'));
});
test('chapter navigation pins each target version and returns to the same chapter and search', () => {
  const search='publicCourseId=c1&publicChapterId=ch1&versionId=old&courseQ=Python&problemId=p1';
  const next=new URL(publicPracticeHref({problemId:'p2',versionId:'v2'},search),'https://example.test');
  assert.equal(next.pathname,'/practice/problems');assert.equal(next.searchParams.get('versionId'),'v2');
  assert.equal(next.searchParams.get('publicChapterId'),'ch1');assert.equal(next.searchParams.get('publicCourseId'),'c1');
  assert.equal(publicPracticeReturnHref(search),'/practice/courses/c1?chapterId=ch1&courseQ=Python');
});
test('catalog return keeps search/page and removes problem state', () => {
  assert.equal(publicPracticeReturnHref('problemId=p1&versionId=v1&publicProblemQuery=sum&publicProblemPage=2'),'/practice/problems?publicProblemQuery=sum&publicProblemPage=2');
  assert.equal(new URL(publicPracticeHref({problemId:'p2'},'versionId=stale'),'https://example.test').searchParams.has('versionId'),false);
});
test('old Python drafts survive migration without claiming they were submitted', () => {
  const storage=memory();const legacy='codemaster:school-practice:u1:s1:p1:v1';storage.setItem(legacy,'print(42)');
  const drafts=publicDraftStorage('u1',problem,storage);const value=drafts.readDraft('python');
  assert.equal(value.code,'print(42)'); assert.equal(value.receivedCode,'# starter');
  assert.equal(drafts.saveDraft('python',value),true); assert.equal(storage.getItem(legacy),'print(42)');
  assert.equal(drafts.readDraft('cpp'),null);
});
test('saved submission baseline and drafts remain isolated by user, version and language', () => {
  const storage=memory(),drafts=publicDraftStorage('u1',problem,storage);
  const draft={code:'print(42)',receivedCode:'print(42)',updatedAt:'2026-11-08T00:00:00Z'};
  drafts.saveDraft('python',draft); assert.deepEqual(drafts.readDraft('python'),draft);
  assert.equal(publicDraftStorage('u2',problem,storage).readDraft('python'),null);
  assert.equal(publicDraftStorage('u1',{...problem,versionId:'v2'},storage).readDraft('python'),null);
  assert.equal(drafts.readDraft('javascript'),null);
});
test('storage failures do not mark drafts saved', () => {
  const drafts=publicDraftStorage('u1',problem,{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}});
  assert.equal(drafts.readDraft('python'),null);
  assert.equal(drafts.saveDraft('python',{code:'x',receivedCode:'',updatedAt:''}),false);
});
