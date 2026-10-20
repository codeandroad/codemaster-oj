import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaper4SaveState, paper4SaveReducer, paper4SaveSummary } from '../src/components/paper4/paper4-save-state.ts';

const initialFiles = () => ({ Q1: 'queue = []', Q2: 'stack = []', Q3: 'class Node: pass' });
const reduce = (state, ...actions) => actions.reduce(paper4SaveReducer, state);

test('unchanged sibling questions cannot report Saved before the edited question is acknowledged', () => {
  const files = initialFiles();
  const codes = { ...files, Q1: 'queue = [1]' };
  let state = createPaper4SaveState(files);
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
  state = paper4SaveReducer(state, { type: 'start', key: 'Q1' });
  // saveAll may visit clean questions while Q1 is still on the network.
  state = reduce(state, { type: 'settle', key: 'Q2' }, { type: 'settle', key: 'Q3' });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
  const pendingState = state;
  state = paper4SaveReducer(state, { type: 'acknowledge', key: 'Q1', content: codes.Q1 });
  assert.notEqual(state, pendingState, 'an acknowledged save must notify React even if the status label is unchanged');
  assert.equal(pendingState.saved.Q1, files.Q1, 'acknowledgement must not mutate an earlier React state');
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
  state = paper4SaveReducer(state, { type: 'settle', key: 'Q1' });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: false, status: 'saved' });
});

test('concurrent saves remain guarded until both questions finish, in either completion order', () => {
  for (const order of [['Q1', 'Q2'], ['Q2', 'Q1']]) {
    const files = initialFiles();
    const codes = { ...files, Q1: 'queue = [1]', Q2: 'stack = [2]' };
    let state = reduce(createPaper4SaveState(files), { type: 'start', key: 'Q1' }, { type: 'start', key: 'Q2' });
    const [first, last] = order;
    state = reduce(state, { type: 'acknowledge', key: first, content: codes[first] }, { type: 'settle', key: first });
    assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
    assert.deepEqual(state.pending, [last]);
    state = reduce(state, { type: 'acknowledge', key: last, content: codes[last] }, { type: 'settle', key: last });
    assert.deepEqual(paper4SaveSummary(codes, state), { dirty: false, status: 'saved' });
    assert.equal(state.saved.Q3, files.Q3);
  }
});

test('another question succeeding does not hide a failed save, and retry clears only its own error', () => {
  const files = initialFiles();
  const codes = { ...files, Q1: 'queue = [1]', Q2: 'stack = [2]', Q3: 'class Node: value = 3' };
  let state = reduce(createPaper4SaveState(files),
    { type: 'start', key: 'Q1' }, { type: 'start', key: 'Q2' }, { type: 'start', key: 'Q3' },
    { type: 'fail', key: 'Q1', message: 'Q1 unavailable' }, { type: 'settle', key: 'Q1' },
    { type: 'fail', key: 'Q3', message: 'Q3 conflict' }, { type: 'settle', key: 'Q3' },
    { type: 'acknowledge', key: 'Q2', content: codes.Q2 }, { type: 'settle', key: 'Q2' });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'error' });
  assert.equal(state.saved.Q1, files.Q1, 'failure must not acknowledge unsaved content');
  state = paper4SaveReducer(state, { type: 'start', key: 'Q1' });
  assert.equal(state.errors.Q1, undefined);
  assert.equal(state.errors.Q3, 'Q3 conflict');
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'error' });
  state = reduce(state, { type: 'acknowledge', key: 'Q1', content: codes.Q1 }, { type: 'settle', key: 'Q1' }, { type: 'start', key: 'Q3' });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
  state = reduce(state, { type: 'acknowledge', key: 'Q3', content: codes.Q3 }, { type: 'settle', key: 'Q3' });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: false, status: 'saved' });
});

test('acknowledging an older edit does not claim that newer editor content has been saved', () => {
  const files = initialFiles();
  const sent = 'queue = [1]';
  const codes = { ...files, Q1: 'queue = [1, 2]' };
  let state = reduce(createPaper4SaveState(files), { type: 'start', key: 'Q1' }, { type: 'acknowledge', key: 'Q1', content: sent });
  assert.equal(state.saved.Q1, sent);
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
  state = paper4SaveReducer(state, { type: 'acknowledge', key: 'Q1', content: codes.Q1 });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: true, status: 'saving' });
  state = paper4SaveReducer(state, { type: 'settle', key: 'Q1' });
  assert.deepEqual(paper4SaveSummary(codes, state), { dirty: false, status: 'saved' });
});

test('typing then reverting, or formatting without changes, is clean when no save is in flight', () => {
  const files = initialFiles();
  const state = createPaper4SaveState(files);
  assert.deepEqual(paper4SaveSummary({ ...files, Q1: 'queue = [1]' }, state), { dirty: true, status: 'saving' });
  assert.deepEqual(paper4SaveSummary({ ...files }, state), { dirty: false, status: 'saved' });
  assert.deepEqual(paper4SaveSummary({ ...files, Q1: files.Q1 }, state), { dirty: false, status: 'saved' });
});

test('reverting during an in-flight save stays guarded until the server has also received the reversion', () => {
  const files = initialFiles();
  let state = reduce(createPaper4SaveState(files), { type: 'start', key: 'Q1' }, { type: 'start', key: 'Q1' });
  assert.deepEqual(state.pending, ['Q1'], 'coalesced saves must not duplicate a pending question');
  assert.deepEqual(paper4SaveSummary(files, state), { dirty: true, status: 'saving' });
  state = paper4SaveReducer(state, { type: 'acknowledge', key: 'Q1', content: 'queue = [1]' });
  assert.deepEqual(paper4SaveSummary(files, state), { dirty: true, status: 'saving' });
  state = reduce(state, { type: 'acknowledge', key: 'Q1', content: files.Q1 }, { type: 'settle', key: 'Q1' });
  assert.deepEqual(paper4SaveSummary(files, state), { dirty: false, status: 'saved' });
});

test('a lost response keeps navigation guarded after undo until a retry confirms the server content', () => {
  const files = initialFiles();
  let state = reduce(createPaper4SaveState(files), { type: 'start', key: 'Q1' }, { type: 'fail', key: 'Q1', message: 'Response lost' }, { type: 'settle', key: 'Q1' });
  assert.deepEqual(paper4SaveSummary(files, state), { dirty: true, status: 'error' });
  state = paper4SaveReducer(state, { type: 'start', key: 'Q1' });
  assert.deepEqual(paper4SaveSummary(files, state), { dirty: true, status: 'saving' });
  state = reduce(state, { type: 'acknowledge', key: 'Q1', content: files.Q1 }, { type: 'settle', key: 'Q1' });
  assert.deepEqual(paper4SaveSummary(files, state), { dirty: false, status: 'saved' });
});
