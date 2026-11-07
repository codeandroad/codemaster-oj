import test from 'node:test';
import assert from 'node:assert/strict';
import { activityCsvCell, activityDateInput, activityDateValue, moveActivityProblem } from '../src/components/schools/school-activities-model.ts';

test('activity schedule uses explicit Shanghai time across browser timezones', () => {
  assert.equal(activityDateInput('2026-11-10T01:30:00Z'), '2026-11-10T09:30');
  assert.equal(activityDateValue('2026-11-10T09:30'), '2026-11-10T01:30:00.000Z');
  assert.equal(activityDateInput(null), '');
  assert.equal(activityDateValue(''), null);
});
test('saved question order moves without losing fixed version or mutating draft', () => {
  const rows = [{ problemId: 'one', versionId: 'v1' }, { problemId: 'two', versionId: 'v2' }];
  assert.deepEqual(moveActivityProblem(rows, 1, -1), [rows[1], rows[0]]);
  assert.deepEqual(moveActivityProblem(rows, 0, -1), rows);
  assert.deepEqual(moveActivityProblem(rows, 1, 1), rows);
  assert.equal(rows[0].problemId, 'one');
});
test('report CSV preserves quotes/newlines and prevents student names becoming formulas', () => {
  assert.equal(activityCsvCell('A, "B"\nC'), '"A, ""B""\nC"');
  for (const name of ['=SUM(1,2)', '+123', '@name', '-1+1', '  =2', '\t=2']) {
    assert.ok(activityCsvCell(name).startsWith('"\''), name);
  }
  assert.equal(activityCsvCell(100), '"100"');
});
