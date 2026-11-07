import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemSubmissionsUrl, submissionMeasurement, submissionOwnDetailHref } from '../src/components/student/problem-submissions-model.ts';

test('submission sorting and pagination preserve the actual requested problem version', () => {
  const url = new URL(problemSubmissionsUrl('problems/p/submissions?versionId=version%2B1', { page: 3, pageSize: 25, sort: 'memoryKb', order: 'asc' }), 'https://example.test/');
  assert.equal(url.pathname, '/problems/p/submissions');
  assert.deepEqual(Object.fromEntries(url.searchParams), { versionId: 'version+1', page: '3', pageSize: '25', sort: 'memoryKb', order: 'asc' });
});

test('school, public and Paper 4 requests use their original authority-scoped endpoint', () => {
  for (const endpoint of ['schools/s/problems/p/submissions', 'practice/problems/p/submissions', 'paper4/attempts/a/questions/q1/submissions']) {
    assert.equal(problemSubmissionsUrl(endpoint, { page: 1, pageSize: 10, sort: 'status', order: 'desc' }), `${endpoint}?page=1&pageSize=10&sort=status&order=desc`);
  }
  assert.equal(problemSubmissionsUrl('', { page: 1, pageSize: 25, sort: 'createdAt', order: 'desc' }), '');
});

test('private assignment and timed-practice version context survive paging and sorting', () => {
  for (const key of ['assignmentId', 'timedPracticeId']) {
    const url = new URL(problemSubmissionsUrl(`problems/p/submissions?versionId=pinned&${key}=activity-1`, { page: 2, pageSize: 50, sort: 'createdAt', order: 'desc' }), 'https://example.test/');
    assert.equal(url.searchParams.get(key), 'activity-1');
    assert.equal(url.searchParams.get('versionId'), 'pinned');
    assert.equal(url.searchParams.get('page'), '2');
  }
});

test('missing performance measurements are not presented as measured zero', () => {
  assert.equal(submissionMeasurement(null, 'ms', 'en'), '—');
  assert.equal(submissionMeasurement(undefined, 'KiB', 'en'), '—');
  assert.equal(submissionMeasurement(NaN, 'ms', 'en'), '—');
  assert.equal(submissionMeasurement(-1, 'ms', 'en'), '—');
  assert.equal(submissionMeasurement(0, 'ms', 'en'), '0 ms');
  assert.equal(submissionMeasurement(0, 'KiB', 'en'), '0 MiB');
  assert.equal(submissionMeasurement(1, 'KiB', 'en'), '<0.01 MiB');
  assert.equal(submissionMeasurement(6268, 'KiB', 'en'), '6.12 MiB');
});

test('metadata belonging to someone else never links to private submission details', () => {
  const row = { id: 's1', displayName: 'Student', createdAt: '2026-11-07T00:00:00Z', language: 'python', status: 'AC', runtimeMs: null, memoryKb: null, isOwn: false };
  assert.equal(submissionOwnDetailHref(row, true), null);
  assert.equal(submissionOwnDetailHref({ ...row, isOwn: true }, false), null);
  assert.equal(submissionOwnDetailHref({ ...row, isOwn: true }, true), '/student/submissions/s1');
});
