import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewNotebookState } from '../src/components/student/review-notebook-state.ts';

test('feedback on an accepted original never creates a correction obligation', () => {
  assert.equal(reviewNotebookState('AC', undefined, true), 'Feedback received');
  assert.equal(reviewNotebookState('AC', 'WA', true), 'Feedback received');
  assert.equal(reviewNotebookState('AC', undefined, false), 'Resolved');
  assert.equal(reviewNotebookState('WA', undefined, true), 'Needs review');
  assert.equal(reviewNotebookState('WA', 'WA', true), 'Retried');
  assert.equal(reviewNotebookState('WA', 'AC', true), 'Resolved');
});
