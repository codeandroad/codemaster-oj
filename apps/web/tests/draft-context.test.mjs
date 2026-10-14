import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, workspaceDraftContext } from '../src/components/student/drafts.ts';

test('same problem and version use separate drafts for each route context', () => {
  const routes = [
    '/student/problems/problem-1',
    '/student/problems/problem-1?assignmentId=assignment-1',
    '/student/problems/problem-1?timedPracticeId=timed-1',
    '/student/problems/problem-1?learningPathId=course-1&chapterId=chapter-1',
    '/student/problems/problem-1?learningPathId=course-1&chapterId=chapter-2',
    '/student/problems/problem-1?originalSubmissionId=SUB1',
  ];
  const contexts = routes.map(route => {
    const params = new URL(route, 'https://judge.test').searchParams;
    return workspaceDraftContext({
      originalSubmissionId: params.get('originalSubmissionId'),
      assignmentId: params.get('assignmentId'),
      timedPracticeId: params.get('timedPracticeId'),
      learningPathId: params.get('learningPathId'),
      chapterId: params.get('chapterId'),
    });
  });
  assert.deepEqual(contexts, ['practice', 'assignment:assignment-1', 'timed:timed-1', 'learning:course-1:chapter-1', 'learning:course-1:chapter-2', 'review:SUB1']);
  assert.equal(new Set(contexts.map(context => draftKey('student-1', 'problem-1', 'version-1', context))).size, routes.length);
  assert.notEqual(draftKey('student-1', 'problem-1', 'version-1', contexts[1]), draftKey('student-2', 'problem-1', 'version-1', contexts[1]));
});
