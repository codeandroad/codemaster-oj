import test from 'node:test';
import assert from 'node:assert/strict';
import { activityCsvCell, activityDateInput, activityDateValue, moveActivityProblem, summarizeActivityReport } from '../src/components/schools/school-activities-model.ts';

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

test('report counts use the required roster, preserve credited solves and show empty problem totals', () => {
  const problems = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const grade = items => ({ items, solved: items.filter(row => row.solved).length, attempted: items.filter(row => row.solved || row.attempts).length });
  const done = grade(problems.map(p => ({ id: p.id, solved: true, attempts: 0 })));
  const partial = grade([{ id: 'a', solved: false, attempts: 2 }]);
  const rows = [{ grade: done }, { grade: partial }, { grade: grade([]) }, { exempt: true, grade: done }];
  assert.deepEqual(summarizeActivityReport(rows, problems), {
    required: 3, completed: 1, unstarted: 1, inProgress: 1,
    problems: [{ id: 'a', title: 'A', attempted: 2, solved: 1 }, { id: 'b', title: 'B', attempted: 1, solved: 1 }],
  });
  assert.equal(summarizeActivityReport([], problems).problems[0].solved, 0);
});
