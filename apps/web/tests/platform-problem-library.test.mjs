import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesPlatformProblem,mergePlatformLibrary,platformDraftPublicationTarget,platformProblemFilters,problemValidation} from '../src/components/schools/platform-problem-model.ts';
import {mergePlatformProblems} from '../src/components/teacher/platform-problem-source.ts';
const filters=(changes={})=>({...platformProblemFilters(new URLSearchParams()),...changes});
const source={id:'p',title:'Latest source',ownerScope:'platform',bankId:'platform-category',sourceBankId:'school-bank',bankName:'Python',validationStatus:'AC',tags:['arrays'],courses:[{id:'course',title:'Python course'}]};
const publication={id:'p',title:'Older public title',schoolId:'original-school',schoolName:'Source School',platformPublished:true};
test('library merges a source/publication identity once and filters category, source, course and validation',()=>{
 const rows=mergePlatformLibrary([source],[publication]);assert.equal(rows.length,1);assert.equal(rows[0].title,'Latest source');
 for(const patch of [{source:'platform'},{bank:'platform-category'},{course:'course'},{validation:'passed'},{visibility:'public'},{query:'arrays'},{query:'CodeMaster'}])assert.equal(matchesPlatformProblem(rows[0],filters(patch)),true);
 assert.equal(matchesPlatformProblem(rows[0],filters({source:'original-school'})),false);
 assert.equal(matchesPlatformProblem(rows[0],filters({bank:'unclassified'})),false);
});
test('deleted sources are excluded from active lists even with an old public projection',()=>{
 const [row]=mergePlatformLibrary([{...source,archivedAt:'2026-11-13'}],[publication]);
 assert.equal(matchesPlatformProblem(row,filters()),false);assert.equal(matchesPlatformProblem(row,filters({deleted:true})),true);
});
test('school publications remain available without platform bulk selection metadata',()=>{
 const [row]=mergePlatformLibrary([],[publication]);assert.equal(row.source,undefined);
 assert.equal(matchesPlatformProblem(row,filters({source:'original-school'})),true);
 assert.equal(matchesPlatformProblem(row,filters({bank:'unclassified'})),false);assert.equal(problemValidation(row),'unknown');
});
test('platform categories never replace original school bank membership when sources are merged',()=>{
 assert.equal(mergePlatformProblems([{id:'p',bankId:'original'}],[source])[0].bankId,'original');
 assert.equal(mergePlatformProblems([],[source])[0].bankId,'school-bank');
});
test('platform batch publication uses the pending, validated draft revision',()=>{
 const revision={...source,canEdit:true,versionId:'version',editRevision:3,draftTitle:'New title',draftReviewStatus:'pending',draftValidationStatus:'AC'};
 const [row]=mergePlatformLibrary([revision],[publication]);
 assert.deepEqual(platformDraftPublicationTarget(row),{problemId:'p',title:'New title',expectedVersionId:'version',expectedRevision:3});
 assert.equal(matchesPlatformProblem(row,filters({pendingDrafts:true,query:'new title'})),true);
 for (const invalid of [{draftValidationStatus:'Waiting'},{draftReviewStatus:null},{archivedAt:'2026-11-14'},{canEdit:false}]) {
  const [ineligible]=mergePlatformLibrary([{...revision,...invalid}],[publication]);
  assert.equal(platformDraftPublicationTarget(ineligible),null);
 }
 const [waiting] = mergePlatformLibrary([{...revision,draftValidationStatus:'Waiting'}],[publication]);
 assert.equal(problemValidation(waiting),'running');
 assert.equal(matchesPlatformProblem(waiting,filters({pendingDrafts:true,validation:'passed'})),false);
});
