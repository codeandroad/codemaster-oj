import test from 'node:test';
import assert from 'node:assert/strict';
import { equalSchoolTestWeights, schoolProblemDefaults, schoolProblemDraftIssue, schoolProblemMode } from '../src/components/schools/school-problem-draft.ts';

const valid = () => ({ ...structuredClone(schoolProblemDefaults), title: 'A problem', statement: 'Read and return.', referenceCode: 'print(1)\n' });
test('interface changes preserve teacher code and whitespace-sensitive case data', () => {
  const original = valid();
  original.starterCode = '# Teacher instructions\ndef original():\n    return 1\n';
  original.samples = [{ input: '  x\n\n', expected: '\n' }];
  original.tests = [{ input: '', expected: '', weight: 100 }];
  const changed = schoolProblemMode(original, 'function');
  assert.equal(changed.comparator, 'json');
  assert.equal(changed.starterCode, original.starterCode);
  assert.deepEqual(changed.samples, original.samples);
  assert.deepEqual(changed.tests, original.tests);
  assert.equal(changed.referenceCode, original.referenceCode);
  assert.equal(schoolProblemMode(changed, 'stdio').starterCode, original.starterCode);
  assert.equal(schoolProblemDraftIssue(original, 'en'), null);
});
test('empty defaults get a matching function template without replacing edited code', () => {
  const changed = schoolProblemMode(valid(), 'function');
  assert.equal(changed.starterCode, 'def solve(data):\n    pass\n');
  assert.equal(schoolProblemMode(changed, 'stdio').starterCode, schoolProblemDefaults.starterCode);
});
test('equal distribution retains input/output and meets exact judge weight units', () => {
  for (const count of [1, 3, 7, 99, 100]) {
    const tests = Array.from({ length: count }, (_, i) => ({ input: `${i}\n`, expected: 'x\n', weight: 1 }));
    const result = equalSchoolTestWeights(tests);
    assert.equal(result.reduce((sum, row) => sum + Math.round(row.weight * 10000), 0), 1_000_000);
    assert.ok(result.every(row => row.weight > 0));
    assert.deepEqual(result.map(({ input, expected }) => ({ input, expected })), tests.map(({ input, expected }) => ({ input, expected })));
    assert.ok(tests.every(row => row.weight === 1));
    assert.equal(schoolProblemDraftIssue({ ...valid(), tests: result }, 'en'), null);
  }
});
test('function cases validate arguments and JSON results; bad rows identify their section', () => {
  const draft = { ...valid(), mode: 'function', functionName: 'solve', comparator: 'json', samples: [{ input: '[[1,2]]', expected: '[2,1]' }], tests: [{ input: '{"args":[3],"kwargs":{"flag":true}}', expected: 'null', weight: 100 }] };
  assert.equal(schoolProblemDraftIssue(draft, 'en'), null);
  for (const input of ['1', '{"args":[] ,"extra":true}', 'not JSON']) {
    const error = schoolProblemDraftIssue({ ...draft, samples: [{ input, expected: '1' }] }, 'en');
    assert.equal(error.section, 'tests'); assert.match(error.message, /Sample 1/);
  }
  assert.equal(schoolProblemDraftIssue({ ...draft, functionName: 'a.b' }, 'en').section, 'interface');
  assert.equal(schoolProblemDraftIssue({ ...draft, tests: [{ ...draft.tests[0], expected: 'undefined' }] }, 'en').section, 'tests');
});
test('invalid counts, resource limits, weights and missing reference remain blocked before save', () => {
  for (const weights of [[0], [99], [NaN], [50.00001, 49.99999]]) {
    const draft = { ...valid(), tests: weights.map(weight => ({ input: '', expected: '', weight })) };
    assert.equal(schoolProblemDraftIssue(draft, 'en').section, 'tests');
  }
  for (const samples of [[], Array.from({ length: 21 }, () => ({ input: '', expected: '' }))]) {
    assert.equal(schoolProblemDraftIssue({ ...valid(), samples }, 'en').section, 'tests');
  }
  assert.equal(schoolProblemDraftIssue({ ...valid(), timeLimitMs: 99 }, 'en').section, 'interface');
  assert.equal(schoolProblemDraftIssue({ ...valid(), memoryLimitMb: 256.5 }, 'en').section, 'interface');
  assert.equal(schoolProblemDraftIssue({ ...valid(), referenceCode: '' }, 'en').section, 'reference');
  assert.equal(schoolProblemDraftIssue({ ...valid(), title: '' }, 'zh').message, '请输入题目名称。');
});
