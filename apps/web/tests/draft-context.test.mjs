import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, initialWorkspaceLanguage, workspaceDraftContext, workspaceEditorCode } from '../src/components/student/drafts.ts';

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

test('reopening restores the latest formal code and language over a clean cached draft', () => {
  const latest = { language: 'cpp', code: 'latest' };
  const cached = { code: 'old', receivedCode: 'old' };
  assert.equal(initialWorkspaceLanguage('python', latest, 'python', () => cached), 'cpp');
  assert.deepEqual(workspaceEditorCode('cpp', cached, latest, 'starter'), { code: 'latest', receivedCode: 'latest' });
  assert.deepEqual(workspaceEditorCode('cpp', null, latest, 'starter'), { code: 'latest', receivedCode: 'latest' });
});

test('reopening preserves unsent edits and falls back to the selected language or original submission', () => {
  const latest = { language: 'cpp', code: 'latest' };
  const unsent = { code: '', receivedCode: 'old' };
  assert.equal(initialWorkspaceLanguage(null, latest, 'python', language => language === 'javascript' ? unsent : null), 'javascript');
  assert.deepEqual(workspaceEditorCode('cpp', unsent, latest, 'starter'), { code: '', receivedCode: 'latest' });
  assert.deepEqual(workspaceEditorCode('javascript', unsent, latest, 'starter'), unsent);
  assert.equal(initialWorkspaceLanguage('javascript', null, 'python', () => null), 'javascript');
  assert.equal(initialWorkspaceLanguage(null, null, 'cpp', () => null), 'cpp');
  assert.deepEqual(workspaceEditorCode('python', null, null, 'starter'), { code: 'starter', receivedCode: 'starter' });
});
