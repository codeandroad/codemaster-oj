import test from 'node:test';
import assert from 'node:assert/strict';
import { courseProblemOrder, savedProblemOrder } from '../src/components/teacher/assignment-problem-order.ts';

test('course display order follows chapter links, keeps other items stable, and does not mutate saved custom order', () => {
 const saved=[{problemId:'outside',position:0,versionId:'pinned'},{problemId:'c2p1',position:1},{problemId:'c1p2',position:2},{problemId:'c1p1',position:3},{problemId:'other',position:4}];
 const displayed=courseProblemOrder(saved,['c1p1','c1p2','c2p1','c1p1'],p=>p.problemId);
 assert.deepEqual(displayed.map(p=>p.problemId),['c1p1','c1p2','c2p1','outside','other']);
 assert.deepEqual(savedProblemOrder(displayed),saved);
 assert.equal(displayed.find(p=>p.problemId==='outside').versionId,'pinned');
 assert.deepEqual(courseProblemOrder(saved,[],p=>p.problemId),saved);
});

test('picker filtering and shift selection can use the same course ordering as added problems', () => {
 const problems=[{id:'b'},{id:'c'},{id:'a'},{id:'other'}];
 const ordered=courseProblemOrder(problems,['a','b','c'],p=>p.id);
 const picked=new Set(['c','a','b']);
 assert.deepEqual(ordered.filter(p=>picked.has(p.id)).map(p=>p.id),['a','b','c']);
 assert.deepEqual(savedProblemOrder([{id:'a'},{id:'b'}]),[{id:'a'},{id:'b'}]);
});
