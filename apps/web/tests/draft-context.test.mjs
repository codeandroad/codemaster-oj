import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, initialWorkspaceLanguage, workspaceDraftContext, workspaceEditorCode, readCurrentDraft, readCurrentDraftLanguage, saveDraft, saveDraftLanguage, readDraft, hasTimedDraft } from '../src/components/student/drafts.ts';

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

test('current problem drafts survive publication while accounts, contexts, languages and correction snapshots stay separate', () => {
  const storage=new Map(), previousWindow=globalThis.window, previousStorage=globalThis.sessionStorage;
  globalThis.window={};
  globalThis.sessionStorage={
    get length(){return storage.size;}, key:index=>[...storage.keys()][index]??null,
    getItem:key=>storage.get(key)??null, setItem:(key,value)=>storage.set(key,value),
  };
  try {
    const old='00000000-0000-4000-8000-000000000001', newer='00000000-0000-4000-8000-000000000002';
    const draft=(code,updatedAt)=>({code,receivedCode:'received',updatedAt});
    const first=draft('unsent Python','2026-11-11T01:00:00Z'),second=draft('unsent C++','2026-11-11T02:00:00Z');
    saveDraft(draftKey('user','problem',old,'assignment:one'),first);
    saveDraft(draftKey('user','problem',newer,'assignment:one','cpp'),second);
    saveDraftLanguage('user','problem',newer,'assignment:one','cpp');
    saveDraft(draftKey('other-user','problem',newer,'assignment:one'),draft('another account','2026-11-11T03:00:00Z'));
    saveDraft(draftKey('user','other-problem',newer,'assignment:one'),draft('another exercise','2026-11-11T03:00:00Z'));
    saveDraft(draftKey('user','problem',newer,'review:SUB1'),draft('correction only','2026-11-11T03:00:00Z'));
    assert.deepEqual(readCurrentDraft('user','problem','assignment:one','python'),first);
    assert.deepEqual(readCurrentDraft('user','problem','assignment:one','cpp'),second);
    assert.equal(readCurrentDraft('user','problem','assignment:two','python'),null);
    assert.equal(readCurrentDraft('user','problem','assignment:one','javascript'),null);
    assert.equal(readCurrentDraftLanguage('user','problem','assignment:one'),'cpp');
    const current=draft('kept after refresh','2026-11-11T04:00:00Z');
    saveDraft(draftKey('user','problem','current','assignment:one'),current);
    assert.deepEqual(readCurrentDraft('user','problem','assignment:one','python'),current);
    assert.deepEqual(readDraft(draftKey('user','problem',old,'assignment:one')),first,'original stored snapshot is not overwritten');
    saveDraft(draftKey('user','problem',old,'timed:one'),first);
    assert.equal(hasTimedDraft('user','one','problem',newer),true,'a problem update does not hide unsent work at timed-practice exit');
  } finally {
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previousStorage;
  }
});
