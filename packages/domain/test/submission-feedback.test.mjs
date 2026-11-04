import test from 'node:test';
import assert from 'node:assert/strict';
import { submissionCaseFeedback } from '../src/submission-feedback.mjs';

const version={mode:'function',comparator:'json',samples:[{input:'DISABLED',expected:'SECRET',enabled:false},{input:'[[1,2]]',expected:'[2,3]'}],reference_code:'PRIVATE_REFERENCE'};
const logs=[{position:1,status:'WA',cpuMs:3,memoryBytes:1025,stdout:'debug',stderr:'Error',returned:'[2,4]',testId:'PRIVATE_ID',secret:'PRIVATE_OTHER'}];
test('formal and correction logs expose measurements only, never hidden content',()=>{
 for(const kind of ['submit','correction','unknown'])assert.deepEqual(submissionCaseFeedback({kind},version,logs),[{position:1,status:'WA',timeMs:3,memoryKb:2}]);
 assert.deepEqual(submissionCaseFeedback({kind:'samples',results_visible:false},version,logs),[]);
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
