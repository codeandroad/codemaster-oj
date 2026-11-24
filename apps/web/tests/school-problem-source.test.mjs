import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolEditorDefinition, schoolEditorProblem } from '../src/components/schools/school-problem-source.ts';

const definition = {
  title: 'Class exercise', statement: 'Output JSON', mode: 'stdio', comparator: 'json',
  starterCode: 'print([])', starterCodes: {javascript: 'console.log([])'}, referenceCode: 'print([1])',
  referenceLanguage: 'python', inputDescription: 'No input.', outputDescription: 'A JSON array.',
  timeLimitMs: 1000, memoryLimitMb: 128, samples: [{input:'', expected:'[1]'}],
  tests: [{input:'a', expected:'[1]', weight:30}, {input:'b', expected:'[2]', weight:70}],
  editorial: 'Teacher notes', hints: ['Check the array'], hintPolicy: 'never', source: 'Week 2',
};
const problem = {
  definition, id:'exercise', bankId:'class-bank', published:true, versionId:'teaching-version',
  publishedRevision:4, revision:5, hasDraftChanges:true, canManage:true, validation:{state:'completed', status:'AC'},
};

test('the full editor round-trips school definitions, including weighted tests and JSON standard output', () => {
  const draft = schoolEditorProblem(problem, false);
  assert.deepEqual(JSON.parse(JSON.stringify(schoolEditorDefinition(draft))), definition);
  assert.equal(draft.editRevision,5);
  assert.equal(draft.versionId,'teaching-version');
});

test('only editable school problems open and only an administrator can publish a validated change', () => {
  assert.throws(() => schoolEditorProblem({...problem,canManage:false},true));
  assert.equal(schoolEditorProblem(problem,false).canPublish,false);
  assert.equal(schoolEditorProblem(problem,true).canPublish,true);
  assert.equal(schoolEditorProblem({...problem,hasDraftChanges:false},true).canPublish,false);
  const pending = schoolEditorProblem({...problem,versionId:null,published:false,validation:{state:'queued'}},true);
  assert.equal(pending.versionId,undefined);
  assert.equal(pending.validationStatus,'Waiting');
  assert.equal(pending.canPublish,false);
});
