import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionCaseFeedback } from '../src/submission-feedback.mjs';

const version={mode:'function',comparator:'json',samples:[{input:'DISABLED',expected:'SECRET',enabled:false},{input:'[[1,2]]',expected:'[2,3]'}],reference_code:'PRIVATE_REFERENCE'};
const logs=[{position:1,status:'WA',cpuMs:3,memoryBytes:1025,stdout:'debug',stderr:'Error',returned:'[2,4]',testId:'PRIVATE_ID',secret:'PRIVATE_OTHER'}];
test('unresolved formal and correction logs omit output and protect unresolved or timed runtime errors',()=>{
 for(const kind of ['submit','correction','unknown'])assert.deepEqual(submissionCaseFeedback({kind},version,logs),[{position:1,status:'WA',timeMs:3,memoryKb:2}]);
 const runtime=[{...logs[0],status:'RE'}];
 for(const submission of [
  {kind:'submit'},
  {kind:'submit',context_resolved:true,timed_attempt_id:'timed-attempt'},
  {kind:'correction',context_resolved:true},
  {kind:'correction',context_resolved:true,original_submission_id:'1',access_timed_attempt_id:'original-timed-attempt'},
  {kind:'correction',context_resolved:false,original_submission_id:'1'},
  {kind:'unknown',context_resolved:true},
 ])assert.deepEqual(submissionCaseFeedback(submission,version,runtime),[{position:1,status:'RE',timeMs:3,memoryKb:2}]);
 assert.deepEqual(submissionCaseFeedback({kind:'samples',results_visible:false},version,logs),[]);
});
test('a resolved ordinary wrong answer exposes only the first failed formal case',()=>{
 const formalTests=[{id:'PRIVATE_ID',input:'[[3,5]]',expected:'[4,6]'}, {id:'SECOND_ID',input:'SECOND_INPUT',expected:'SECOND_EXPECTED'}];
 const results=[{...logs[0],input:'SPOOFED_INPUT',expected:'SPOOFED_EXPECTED'},{...logs[0],position:2,testId:'SECOND_ID',returned:'SECOND_OUTPUT'}];
 const context={kind:'submit',status:'WA',context_resolved:true};
 const projected=submissionCaseFeedback(context,version,results,{formalTests});
 assert.equal(projected[0].visibility,'public');
 assert.equal(projected[0].mode,'function');
 assert.equal(projected[0].comparator,'json');
 assert.deepEqual([projected[0].input,projected[0].output,projected[0].expected],['[[3,5]]','[2,4]','[4,6]']);
 assert.deepEqual(projected[1],{position:2,status:'WA',timeMs:3,memoryKb:2});
 assert.doesNotMatch(JSON.stringify(projected),/SPOOFED|SECOND_|PRIVATE_|debug|Error/);
 for(const restricted of [{timed_attempt_id:'timed'}, {access_timed_attempt_id:'timed'}, {context_resolved:false}, {status:'RE'}, {kind:'correction'}]){
  const hidden=submissionCaseFeedback({...context,...restricted},version,results,{formalTests});
  assert.deepEqual(hidden.map(result=>result.input),[undefined,undefined]);
 }
 assert.deepEqual(submissionCaseFeedback({...context,results_visible:false},version,results,{formalTests}),[]);
});
test('ordinary formal and correction runtime errors expose only retained stderr and its truncation',()=>{
 const results=[logs[0],{...logs[0],position:2,status:'RE',stderr:'ValueError: bad argument'},{...logs[0],position:3,status:'RE',stderr:'x'.repeat(9000)},{position:4,status:'RE'}];
 for(const kind of ['submit','correction']){
  assert.deepEqual(submissionCaseFeedback({kind,context_resolved:true,original_submission_id:kind==='correction'?'1':null},version,results),[
   {position:1,status:'WA',timeMs:3,memoryKb:2},
   {position:2,status:'RE',timeMs:3,memoryKb:2,mode:'function',runtimeError:'ValueError: bad argument'},
   {position:3,status:'RE',timeMs:3,memoryKb:2,mode:'function',runtimeError:'x'.repeat(8192),truncated:true},
   {position:4,status:'RE'},
  ]);
 }
});
test('public samples use the pinned version and enabled sample order with separate return/debug output',()=>{
 const [row]=submissionCaseFeedback({kind:'samples'},version,logs);
 assert.equal(row.input,'[[1,2]]');assert.equal(row.expected,'[2,3]');assert.equal(row.output,'[2,4]');assert.equal(row.stdout,'debug');assert.equal(row.stderr,'Error');
 assert.doesNotMatch(JSON.stringify(row),/PRIVATE|DISABLED|SECRET/);
});
test('custom runs have input and output even without a score and never invent an expected answer',()=>{
 const [row]=submissionCaseFeedback({kind:'custom',score:null,custom_input:'[5]'},version,[{...logs[0],status:'Executed',returned:'null'}]);
 assert.equal(row.input,'[5]');assert.equal(row.output,'null');assert.equal(row.expected,undefined);
});
test('aborted or failed function runs do not masquerade as a null return; logs are bounded',()=>{
 for(const status of ['RE','NotRun','CE'])assert.equal(submissionCaseFeedback({kind:'samples'},version,[{...logs[0],status,returned:'null'}])[0].output,null);
 assert.equal(submissionCaseFeedback({kind:'samples'},version,[{...logs[0],reason:'input_mutation'}])[0].reason,'input_mutation');
 const [row]=submissionCaseFeedback({kind:'samples'},version,[{...logs[0],stderr:'x'.repeat(9000),stderrTruncated:true}]);
 assert.equal(row.stderr.length,8192);assert.equal(row.truncated,true);
 assert.equal(submissionCaseFeedback({kind:'samples'},version,[{...logs[0],position:4}])[0].visibility,undefined);
 assert.equal(submissionCaseFeedback({kind:'samples'},null,logs)[0].visibility,undefined);
});
