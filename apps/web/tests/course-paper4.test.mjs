import test from 'node:test';
import assert from 'node:assert/strict';
import {coursePaper4UnitCount,coursePaper4References,mergeCoursePaper4Links} from '../src/components/course-paper4.ts';
const paper={paperId:'p',versionId:'v1',questionKey:null,title:'Paper',available:true,questions:[{key:'Q1',title:'Queue'},{key:'Q2',title:'Classes'},{key:'Q3',title:'Files'}]};
const single=(key)=>({...paper,questionKey:key,questions:paper.questions.filter(item=>item.key===key)});
test('whole-paper, repeated chapter and single-question overlaps count unique pinned question units',()=>{
 assert.equal(coursePaper4UnitCount([paper,single('Q1'),paper]),3);
 assert.equal(coursePaper4UnitCount([single('Q1'),single('Q2')]),2);
 assert.equal(coursePaper4UnitCount([paper,{...paper,versionId:'v2'}]),6);
 assert.equal(coursePaper4UnitCount([{...paper,available:false}]),0);
});
test('adding a whole paper replaces overlapping single links in the same chapter without discarding other papers',()=>{
 const other={...single('Q1'),paperId:'other',versionId:'other-version'};
 const merged=mergeCoursePaper4Links([single('Q1'),single('Q2'),other],[paper]);
 assert.deepEqual(merged,[other,paper]);
 assert.deepEqual(mergeCoursePaper4Links([paper],[single('Q1')]),[paper]);
 assert.equal(mergeCoursePaper4Links([single('Q1')],[single('Q1')]).length,1);
});
test('saved references carry pinned identity, not UI titles, progress, answers or access claims',()=>{
 assert.deepEqual(coursePaper4References([{...single('Q2'),completed:true,secret:'not copied'}]),[{paperId:'p',versionId:'v1',questionKey:'Q2'}]);
});
