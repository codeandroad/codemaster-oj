import test from 'node:test';
import assert from 'node:assert/strict';
import { outputDifference, defaultResultCase, readableDiagnostic, codeLocationOffset } from '../src/components/student/result-feedback.ts';

test('result defaults to the first failure, not a passed or unexecuted case', () => {
 assert.equal(defaultResultCase([{status:'AC'},{status:'WA'},{status:'NotRun'}]),1);
 assert.equal(defaultResultCase([{status:'NotRun'},{status:'RE'}]),1);
 assert.equal(defaultResultCase([{status:'AC'},{status:'AC'}]),0);
 assert.equal(defaultResultCase([]),0);
});
test('a runtime verdict opens the exception case even if an earlier case had a wrong answer', () => {
 const cases = [{status:'AC'},{status:'WA'},{status:'RE'},{status:'NotRun'}];
 assert.equal(defaultResultCase(cases,'RE'),2);
 assert.equal(defaultResultCase(cases,'WA'),1);
});
test('diff preserves original values and highlights only changed characters', () => {
 const diff=outputDifference('[1,3]','[1,2]');
 assert.deepEqual(diff.actual,[{text:'[1,',changed:false},{text:'3',changed:true},{text:']',changed:false}]);
 assert.deepEqual(diff.expected,[{text:'[1,',changed:false},{text:'2',changed:true},{text:']',changed:false}]);
 for(const [a,b] of [['a b\n','a\tb'],['😀二','😀三'],['','x'],['x',''],['same','same'],['x'.repeat(10000)+'a','x'.repeat(10000)+'b']]){
  const result=outputDifference(a,b);
  assert.equal(result.actual.map(p=>p.text).join(''),a);
  assert.equal(result.expected.map(p=>p.text).join(''),b);
  assert.equal(result.actual.filter(p=>!p.changed).map(p=>p.text).join(''),result.expected.filter(p=>!p.changed).map(p=>p.text).join(''));
 }
});
test('Python diagnostics keep student frames and exact error type, omit harness frames', () => {
 const result=readableDiagnostic('Traceback (most recent call last):\n  File "/w/runner.py", line 42, in <module>\n    fn(*args)\n  File "main.py", line 3, in solve\n    return 1 / 0\nZeroDivisionError: division by zero');
 assert.deepEqual(result.location,{file:'main.py',line:3});
 assert.match(result.text,/ZeroDivisionError: division by zero/);
 assert.match(result.text,/return 1 \/ 0/);assert.doesNotMatch(result.text,/runner|fn\(\*args\)/);
 const syntax=readableDiagnostic('SyntaxError at line 5, column 8: expected ":"\nif True\n       ^');
 assert.deepEqual(syntax.location,{file:'main.py',line:5,column:8});
 assert.equal(readableDiagnostic('No location').location,undefined);
});
test('JavaScript generated function offsets and C++ source maps locate student code', () => {
 const js=readableDiagnostic('ReferenceError: missing is not defined\n    at solve (main.js:5:3)\n    at Object.<anonymous> (/w/runner.js:16:2)','javascript',true);
 assert.deepEqual(js.location,{file:'main.js',line:3,column:3});assert.match(js.text,/main\.js:3:3/);assert.doesNotMatch(js.text,/runner/);
 const syntax=readableDiagnostic('/w/main.js:4\nconst x = ;\nSyntaxError: Unexpected token at declaration','javascript',true);
 assert.equal(syntax.location.line,4);
 assert.deepEqual(readableDiagnostic('main.cpp:2:11: error: use of undeclared identifier','cpp',true).location,{file:'main.cpp',line:2,column:11});
 assert.equal(readableDiagnostic('\u001b[31mError\u001b[0m\u0000').text,'Error');
});
test('error navigation validates line/column and never requires changing source', () => {
 const code='def solve():\n    return 1 / 0\n';
 assert.equal(codeLocationOffset(code,2),13);assert.equal(codeLocationOffset(code,2,5),17);
 assert.equal(codeLocationOffset(code,2,999),code.length-1);
 for(const n of [0,-1,Infinity,NaN,1.5,4])assert.equal(codeLocationOffset(code,n),null);
 assert.equal(codeLocationOffset(code,1,0),null);
});
