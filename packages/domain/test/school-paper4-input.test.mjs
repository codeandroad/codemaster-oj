import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolPaper4Input,validateStageCoverage } from '../src/school-paper4-input.mjs';

const input=()=>({title:'Paper',questions:[{key:'Q1',title:'Queue',statement:'Write a queue.',stages:[{id:'auto1',title:'Automatic',judgeMode:'auto',maxMarks:75}]}],runnerCases:{auto1:[{expectedStdout:'1',driverCode:'print(1)',public:false}]},referenceSolutions:{Q1:'pass'}});
test('new school Paper 4 accepts the original package model and separates private material',()=>{const c=schoolPaper4Input(input());validateStageCoverage(c.definition,c.runnerCases,c.referenceSolutions);assert.equal(c.definition.totalMarks,75);assert.equal(c.referenceSolutions.Q1,'pass');assert.equal(c.definition.runnerCases,undefined);assert.equal(c.definition.referenceSolutions,undefined);assert.equal(c.definition.questions[0].stages[0].driverCode,undefined);});
test('new school Paper 4 validates stages, filenames, total marks and reference coverage',()=>{
 for(const body of [ {...input(),questions:[]}, {...input(),questions:[{...input().questions[0],initialFiles:{'../secret.txt':'x'}}]}, {...input(),questions:[{...input().questions[0],stages:[{id:'x',title:'X',judgeMode:'auto',maxMarks:74}]}]}, {...input(),runnerCases:{unknown:[{expectedStdout:'x'}]}} ])assert.throws(()=>schoolPaper4Input(body),e=>e.status===400);
 const c=schoolPaper4Input({...input(),referenceSolutions:{}});assert.throws(()=>validateStageCoverage(c.definition,c.runnerCases,c.referenceSolutions),e=>e.code==='REFERENCE_REQUIRED');
});
