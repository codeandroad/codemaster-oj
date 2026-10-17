import test from 'node:test';
import assert from 'node:assert/strict';
import {paper4Years,filterPaper4Catalog,paper4ExamLabel} from '../src/components/paper4/paper4-catalog.ts';
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
