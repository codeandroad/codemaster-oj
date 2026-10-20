import test from 'node:test';
import assert from 'node:assert/strict';
import {paper4Years,filterPaper4Catalog,paper4ExamLabel,paper4PracticeHref} from '../src/components/paper4/paper4-catalog.ts';
import {problemNavigation} from '../src/components/student/problem-navigation.ts';
const rows=[{id:'old',examYear:2021,examSession:'summer',examVariant:41},{id:'new43',examYear:2025,examSession:'summer',examVariant:43},{id:'custom'}, {id:'new41',examYear:2025,examSession:'summer',examVariant:41},{id:'autumn',examYear:2025,examSession:'autumn',examVariant:42}];
test('year/session catalog filters preserve papers and sort variants predictably',()=>{
 const original=JSON.stringify(rows);
 assert.deepEqual(paper4Years(rows),[2025,2021]);
 assert.deepEqual(filterPaper4Catalog(rows,'2025','summer').map(p=>p.id),['new41','new43']);
 assert.deepEqual(filterPaper4Catalog(rows,'unclassified','').map(p=>p.id),['custom']);
 assert.equal(filterPaper4Catalog(rows,'','').length,rows.length);
 assert.equal(JSON.stringify(rows),original);
});
test('classification labels use actual metadata rather than guessing from an editable title',()=>{
 assert.equal(paper4ExamLabel(rows[0],'zh'),'2021 · 夏季 · 卷41');
 assert.equal(paper4ExamLabel(rows[4],'en'),'2025 · October/November · Paper 42');
 assert.equal(paper4ExamLabel({title:'An arbitrary 2026 title'},'en'),'');
});

test('workspace previous/next uses the outer Paper 4 catalog order and current paper',()=>{
 const items=filterPaper4Catalog(rows,'','').map(paper=>({problemId:paper.id}));
 assert.deepEqual(items.map(p=>p.problemId),['autumn','new41','new43','old','custom']);
 const middle=problemNavigation(items,'new41');
 assert.equal(middle.previous.problemId,'autumn');
 assert.equal(middle.next.problemId,'new43');
 assert.equal(problemNavigation(items,'autumn').previous,null);
 assert.equal(problemNavigation(items,'custom').next,null);
 const missing=problemNavigation(items,'pinned-course-paper');
 assert.equal(missing.previous,null);
 assert.equal(missing.next,null);
});

test('Paper 4 catalog and activity destinations stay in Paper 4 and carry no stale question/version context',()=>{
 assert.equal(paper4PracticeHref('paper-41','catalog'),'/student/paper4/paper-41');
 assert.equal(paper4PracticeHref('activity-41','activities'),'/student/paper4/activity-41?scope=activities');
 assert.equal(paper4PracticeHref('paper/41','catalog'),'/student/paper4/paper%2F41');
});
