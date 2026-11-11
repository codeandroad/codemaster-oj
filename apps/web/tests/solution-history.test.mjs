import test from 'node:test';
import assert from 'node:assert/strict';
import { appendHistoricalSolution } from '../src/components/scholarship/solution-history-model.ts';

test('import appends historical or pending material without changing existing bodies, order or IDs', () => {
 const current={body:'Current main',solutions:[{id:'main-id',title:'Main',body:'Current main'},{id:'other-id',title:'Other',body:'Current other'}]};
 const original=structuredClone(current);
 const result=appendHistoricalSolution(current,{id:'old-id',title:'Pending source',body:'Never published'},'Existing');
 assert.deepEqual(current,original);
 assert.deepEqual(result.draft,{body:'Current main',solutions:[...current.solutions,{title:'Pending source',body:'Never published'}]});
 assert.equal(result.draft.solutions[2].id,undefined,'a historical ID must never be submitted as an existing canonical article');
});

test('import initializes a blank form and preserves any explicitly edited empty approach', () => {
 assert.deepEqual(appendHistoricalSolution({body:''},{title:'Historic',body:'Explanation'},'Existing').draft,
  {body:'Explanation',solutions:[{title:'Historic',body:'Explanation'}]});
 const current={body:'',solutions:[{title:'Work in progress',body:''}]};
 const result=appendHistoricalSolution(current,{title:'Historic',body:'Explanation'},'Existing');
 assert.equal(result.draft.solutions[0].title,'Work in progress');assert.equal(result.draft.solutions.length,2);
});

test('duplicate and oversized imports reject atomically instead of truncating or replacing current solutions', () => {
 const article={title:'New',body:'New explanation'};
 const current={body:'body 0',solutions:Array.from({length:10},(_,i)=>({id:String(i),title:`Approach ${i}`,body:`body ${i}`}))};
 const original=structuredClone(current);
 assert.equal(appendHistoricalSolution(current,article,'Existing').error,'count');
 assert.deepEqual(current,original);
 assert.equal(appendHistoricalSolution({body:'same\r\nbody'},{title:'Other title',body:' same\nbody '},'Existing').error,'duplicate');
 const long={body:'a'.repeat(190000),solutions:[{title:'Main',body:'a'.repeat(190000)},{title:'Second',body:'b'.repeat(190000)}]};
 assert.equal(appendHistoricalSolution(long,{title:'Third',body:'c'.repeat(190000)},'Existing').error,'size');
 assert.equal(long.solutions.length,2);
});
