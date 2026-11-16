import test from 'node:test';
import assert from 'node:assert/strict';
import {examBoardsFor,examDirectoryHref,examEntries,examSelection,searchExamEntries} from '../src/lib/exam-preparation-catalog.ts';

test('same abbreviation keeps American and Australian AMC separate in bilingual search',()=>{
 assert.deepEqual(searchExamEntries('AMC').map(entry=>entry.id),['amc-us','amc-au']);
 assert.deepEqual(searchExamEntries('AMC Australia').map(entry=>entry.id),['amc-au']);
 assert.deepEqual(searchExamEntries('AMC 美国').map(entry=>entry.id),['amc-us']);
 assert.ok(searchExamEntries('CIE 9618').some(entry=>entry.id==='cie-9618'));
 assert.ok(searchExamEntries('Further Mathematics').some(entry=>entry.id==='edexcel-further-mathematics'));
});

test('IGCSE bookmarks preserve supported boards and reject unrelated qualification boards',()=>{
 assert.deepEqual(examSelection(new URLSearchParams('category=academic&program=igcse&board=edexcel')),{category:'academic',program:'igcse',board:'edexcel'});
 assert.equal(examSelection(new URLSearchParams('program=igcse&board=aqa')).board,'cambridge');
 assert.deepEqual(examBoardsFor('igcse').map(board=>board.id),['cambridge','edexcel']);
 const url=new URL(examDirectoryHref('/schools?schoolId=school-a&schoolRole=teacher&section=exam-preparation',{category:'academic',program:'igcse',board:'edexcel'}),'https://school.test');
 assert.equal(url.searchParams.get('schoolRole'),'teacher');
 assert.equal(url.searchParams.get('program'),'igcse');
 assert.equal(url.searchParams.get('board'),'edexcel');
});

test('search distinguishes qualification levels and finds bilingual board aliases',()=>{
 assert.deepEqual(searchExamEntries('CIE IGCSE').map(entry=>entry.id),['cie-0580','cie-0606']);
 assert.equal(searchExamEntries('A Level 0580').length,0);
 assert.deepEqual(searchExamEntries('爱德思 IGCSE').map(entry=>entry.id),['edexcel-4ma1','edexcel-4pm1']);
 assert.equal(searchExamEntries('9701')[0].name[0],'化学 · 9701');
 for(const code of ['9709','9701','9708','9700','9618'])assert.equal(examEntries.find(entry=>entry.id===`cie-${code}`).program,'alevel');
 for(const entry of examEntries.filter(entry=>entry.program==='igcse'))assert.equal(entry.resources,undefined);
});

test('directory changes preserve school and role but remove stale exercise context',()=>{
 const href=examDirectoryHref('/schools?schoolId=school-a&schoolRole=teacher&section=exam-preparation&subject=computer-science-9618&component=paper1&attemptId=private',{category:'academic',program:'ap'});
 const url=new URL(href,'https://school.test');
 assert.equal(url.pathname,'/schools');
 assert.deepEqual(Object.fromEntries(url.searchParams),{schoolId:'school-a',schoolRole:'teacher',section:'exam-preparation',category:'academic',program:'ap'});
 assert.equal(new URL(examDirectoryHref('/student/exam-preparation',{category:'competitions'}),'https://school.test').pathname,'/student/exam-preparation');
});

test('unknown bookmarked directory options fall back to the available Cambridge curriculum',()=>{
 assert.deepEqual(examSelection(new URLSearchParams('category=unknown&program=other&board=invalid')),{category:'academic',program:'alevel',board:'cambridge'});
 assert.deepEqual(examSelection(new URLSearchParams('category=academic&program=ap')),{category:'academic',program:'ap',board:'cambridge'});
});
