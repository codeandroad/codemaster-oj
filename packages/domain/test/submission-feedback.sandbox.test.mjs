import test from 'node:test';
import assert from 'node:assert/strict';
import { GoJudge } from '../judge.mjs';
import { submissionCaseFeedback } from '../src/submission-feedback.mjs';

const enabled=Boolean(process.env.GO_JUDGE_TEST_URL&&process.env.GO_JUDGE_TEST_TOKEN);
const judge=enabled?new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:'feedback-qa'}):null;
const version={mode:'function',function_name:'solve',comparator:'json',time_limit_ms:1000,memory_limit_mb:128};
const run=(code,{language='python',mode='function',tests=[{input:'[2]',expected:'4'}],kind='samples'}={})=>judge.judge({code,language,kind,version:{...version,mode,comparator:mode==='function'?'json':'tokens'},tests:tests.map(t=>({...t,weight:100/tests.length}))});

test('real sandbox: Python public case returns, debug prints and source traceback are separate', {skip:!enabled},async()=>{
 const result=await run('def solve(x):\n    print("debug", x)\n    return x + 1',{tests:[{input:'[1]',expected:'2'},{input:'[2]',expected:'4'}]});
 assert.equal(result.status,'WA');assert.deepEqual(result.privateResults.map(r=>r.status),['AC','WA']);
 assert.equal(result.privateResults[1].returned,'3');assert.match(result.privateResults[1].stdout,/debug 2/);
 const re=await run('def solve(x):\n    return x / 0');assert.equal(re.status,'RE');
 assert.match(re.privateResults[0].stderr,/ZeroDivisionError/);assert.match(re.privateResults[0].stderr,/File "main.py", line 2/);
 assert.equal(re.privateResults[0].returned,undefined);
 const signature=await run('def solve(a,b): return a+b');assert.equal(signature.status,'CE');assert.match(signature.privateResults[0].stderr,/TypeError.*missing.*b/);
 const syntax=await run('def solve(x)\n    return x');assert.equal(syntax.status,'CE');assert.match(syntax.publicMessage,/SyntaxError at line 1, column/);
});
test('real sandbox: stdio errors and input mutation report the cause without altering grading', {skip:!enabled},async()=>{
 const result=await run('x = int(input())\nprint(x / 0)',{mode:'stdio',tests:[{input:'2',expected:'4'}]});
 assert.equal(result.status,'RE');assert.match(result.privateResults[0].stderr,/main.py", line 2/);assert.match(result.privateResults[0].stderr,/ZeroDivisionError/);
 const mutation=await run('def solve(a):\n    a.append(3)\n    return a',{tests:[{input:'[[1,2]]',expected:'[1,2,3]'}]});
 assert.equal(mutation.status,'WA');assert.equal(mutation.privateResults[0].reason,'input_mutation');
 const custom=await run('def solve(a): return None',{kind:'custom'});assert.equal(custom.status,'Executed');assert.equal(custom.score,null);assert.equal(custom.privateResults[0].returned,'null');
});
test('real sandbox: JavaScript errors identify main.js; C++ source compile lines and exceptions are retained', {skip:!enabled,timeout:90000},async()=>{
 const js=await run('function solve(x) {\n  return missing + x;\n}',{language:'javascript'});
 assert.equal(js.status,'RE');assert.match(js.privateResults[0].stderr,/ReferenceError: missing/);assert.match(js.privateResults[0].stderr,/main.js:4:/); // new Function adds two lines; UI maps back to 2.
 const cpp=await run('json solve(json& args, json& kwargs) {\n  return missing;\n}',{language:'cpp'});
 assert.equal(cpp.status,'CE');assert.match(cpp.publicMessage,/main.cpp:2:/);
 const exception=await run('json solve(json& args, json& kwargs) { throw std::runtime_error("example error"); }',{language:'cpp'});
 assert.equal(exception.status,'RE');assert.match(exception.privateResults[0].stderr,/RuntimeError: example error/);
});
test('real sandbox: hidden exception text stays private in formal and correction projections', {skip:!enabled},async()=>{
 for(const kind of ['submit','correction']){
  const result=await run('def solve(x): raise ValueError(x)',{kind,tests:[{input:'["HIDDEN_INPUT_SENTINEL"]',expected:'null'}]});
  assert.equal(result.status,'RE');assert.match(result.privateResults[0].stderr,/HIDDEN_INPUT_SENTINEL/);
  assert.doesNotMatch(result.publicOutput+result.publicMessage,/HIDDEN_INPUT_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(submissionCaseFeedback({kind},version,result.privateResults)),/HIDDEN_INPUT_SENTINEL|stderr|input|returned|output/);
 }
});
