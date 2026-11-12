import test from 'node:test';
import assert from 'node:assert/strict';
import {courseSections,chapterSectionKey,assertChapterSections} from '../src/course-sections.mjs';
import {validateLearningDocument} from '../src/learning-document.mjs';
const sections=[{key:'number-systems',title:'Number systems',groupKey:'c1',groupTitle:'Contest 1',localizations:{en:{title:'Number systems',groupTitle:'Contest 1'},zh:{title:'数制',groupTitle:'第一轮'}}},{key:'recursion',title:'Recursion',groupKey:'c1',groupTitle:'Contest 1'}];
const doc={format:'codemaster-learning-path',version:1,title:'ACSL',description:'Tutorial',category:'ACSL',estimatedMinutes:60,chapters:[{title:'Digits',content:'Original lesson',problemIds:[]}]};
test('section structure preserves bounded bilingual labels and supports ungrouped legacy chapters',()=>{
 assert.deepEqual(courseSections(sections),sections);assert.deepEqual(courseSections(),[]);
 assert.equal(chapterSectionKey(null,sections),null);assert.equal(chapterSectionKey(undefined),null);
 assert.equal(chapterSectionKey('recursion',sections),'recursion');
 assertChapterSections(sections,[{sectionKey:'recursion'},{section_key:'number-systems'},{}]);
 const legacy=validateLearningDocument(doc);assert.equal(legacy.sections,undefined);assert.equal(legacy.chapters[0].sectionKey,undefined);
 const grouped=validateLearningDocument({...doc,sections,chapters:[{...doc.chapters[0],sectionKey:'number-systems'}]});assert.deepEqual(grouped.sections,sections);assert.equal(grouped.chapters[0].sectionKey,'number-systems');
});
test('invalid and dangling grouping metadata cannot be imported or remove a used section',()=>{
 for(const value of [null,{},Array.from({length:101},()=>sections[0]),[sections[0],sections[0]],[{key:'../bad',title:'Bad'}],[{key:'Title',title:'Bad'}],[{key:'x',title:''}],[{key:'x',title:'x'.repeat(201)}],[{key:'x',title:'X',groupKey:'c1'}],[{key:'x',title:'X',groupTitle:'C1'}],[{...sections[0],localizations:{fr:{title:'X'}}}],[{key:'x',title:'X',localizations:{en:{title:'X',groupTitle:'C1'}}}],[sections[0],{...sections[1],groupTitle:'Different'}]])assert.throws(()=>courseSections(value),undefined,JSON.stringify(value));
 assert.throws(()=>chapterSectionKey('missing',sections));
 assert.throws(()=>assertChapterSections([], [{sectionKey:'recursion'}]));
 assert.throws(()=>validateLearningDocument({...doc,sections,chapters:[{...doc.chapters[0],sectionKey:'missing'}]}));
 assert.throws(()=>validateLearningDocument({...doc,chapters:[{...doc.chapters[0],sectionKey:'number-systems'}]}));
 assert.throws(()=>courseSections([sections[0],{...sections[1],localizations:{zh:{title:'递归',groupTitle:'另一个分组'}}}]));
});
test('course labels never become access, publication, grading or formal answer metadata',()=>{
 const actual=courseSections([{...sections[0],published:true,schoolId:'foreign',correctOptionIds:['A'],points:1000}]);assert.deepEqual(actual,[sections[0]]);
 const grouped=validateLearningDocument({...doc,sections:actual,chapters:[{...doc.chapters[0],sectionKey:'number-systems',completed:true,id:'foreign'}]});
 assert.equal(grouped.chapters[0].completed,undefined);assert.equal(grouped.chapters[0].id,undefined);
});
