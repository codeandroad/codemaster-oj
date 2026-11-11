import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcslAnswerSaveQueue } from '../src/components/acsl/answer-save-queue.ts';

function harness(initial = { selectedOptionIds: [], revision: 0 }) {
  const requests = [], states = [], saved = [];
  const queue = createAcslAnswerSaveQueue(initial, {
    send(selected, revision, signal) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ selected, revision, signal, resolve, reject });
      return promise;
    },
    onState: state => states.push(state),
    onSaved: answer => saved.push(answer),
  });
  const acknowledge = (index, requiresReview = false) => requests[index].resolve({
    selectedOptionIds: requests[index].selected, revision: requests[index].revision + 1, requiresReview,
  });
  return { queue, requests, states, saved, acknowledge };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('rapid multi-select edits stay visible and serialize against the latest acknowledged revision', async () => {
  const h = harness();
  const done = h.queue.select(['A']); await tick();
  h.queue.select(['A', 'B']); h.queue.select(['A', 'B', 'C']);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.queue.snapshot().selected, ['A', 'B', 'C']);
  h.acknowledge(0); await tick();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].selected, ['A', 'B', 'C']);
  assert.equal(h.requests[1].revision, 1);
  assert.deepEqual(h.queue.snapshot().selected, ['A', 'B', 'C'], 'the earlier response must not replace a later selection');
  assert.ok(h.states.every(state => state.pending), 'submitting remains blocked while any choice is unsaved');
  h.acknowledge(1); await done;
  assert.equal(h.queue.snapshot().pending, false);
  assert.deepEqual(h.queue.snapshot().draft, { selectedOptionIds: ['A', 'B', 'C'], revision: 2 });
});

test('reverting a choice during an in-flight write persists the reversal', async () => {
  const h = harness(); const done = h.queue.select(['A']); await tick();
  h.queue.select([]); assert.equal(h.queue.snapshot().pending, true);
  h.acknowledge(0); await tick();
  assert.deepEqual(h.requests[1].selected, []); assert.equal(h.requests[1].revision, 1);
  h.acknowledge(1); await done;
  assert.deepEqual(h.queue.snapshot().draft.selectedOptionIds, []);
});

test('single-choice bursts coalesce intermediate selections without dropping the final click', async () => {
  const h = harness(); const done = h.queue.select(['A']); await tick();
  h.queue.select(['B']); h.queue.select(['C']); h.queue.select(['D']);
  h.acknowledge(0); await tick();
  assert.deepEqual(h.requests.map(request => request.selected), [['A'], ['D']]);
  h.acknowledge(1); await done;
  assert.deepEqual(h.saved.at(-1).selectedOptionIds, ['D']);
});

test('a failed save retains local choices and retry preserves optimistic concurrency', async () => {
  const h = harness({ selectedOptionIds: ['A'], revision: 4 });
  const first = h.queue.select(['B']); await tick(); h.queue.select(['C']);
  h.requests[0].reject(new Error('Network unavailable')); await first;
  assert.deepEqual(h.queue.snapshot().selected, ['C']); assert.equal(h.queue.snapshot().pending, true);
  const retry = h.queue.retry(); await tick();
  assert.deepEqual(h.requests[1].selected, ['C']); assert.equal(h.requests[1].revision, 4);
  h.acknowledge(1); await retry;
  assert.equal(h.queue.snapshot().error, null); assert.equal(h.queue.snapshot().pending, false);
});

test('an uncertain response is retried even when the user returns to the last known saved choice', async () => {
  const h = harness({ selectedOptionIds: ['A'], revision: 7 });
  const first = h.queue.select(['B']); await tick();
  h.requests[0].reject(new Error('Response lost after admission')); await first;
  const next = h.queue.select(['A']); await tick();
  assert.equal(h.requests.length, 2, 'the server may have saved B despite the lost response');
  assert.equal(h.requests[1].revision, 7);
  h.requests[1].reject(Object.assign(new Error('Revision conflict'), { status: 409 })); await next;
  assert.equal(h.queue.snapshot().conflict, true); assert.equal(h.queue.snapshot().pending, true);
  await h.queue.retry(); await h.queue.select(['C']);
  assert.equal(h.requests.length, 2, 'a conflict requires an explicit server reload');
  assert.deepEqual(h.queue.snapshot().selected, ['A']);
});

test('confirming a revised question sends unchanged choices to acknowledge the revision', async () => {
  const h = harness({ selectedOptionIds: ['A'], revision: 3 });
  await h.queue.select(['A']); assert.equal(h.requests.length, 0);
  const done = h.queue.retry(); await tick();
  assert.deepEqual(h.requests[0].selected, ['A']); assert.equal(h.requests[0].revision, 3);
  h.acknowledge(0); await done;
  assert.equal(h.saved[0].requiresReview, false); assert.equal(h.queue.snapshot().pending, false);
});

test('unmount cancels pending work and ignores late acknowledgements across effect reactivation', async () => {
  const h = harness(); const old = h.queue.select(['A']); await tick();
  h.queue.dispose(); const count = h.states.length;
  assert.equal(h.requests[0].signal.aborted, true);
  h.acknowledge(0); await old;
  assert.equal(h.states.length, count); assert.equal(h.saved.length, 0);
  h.queue.activate(); const current = h.queue.select(['B']); await tick();
  assert.equal(h.requests[1].revision, 0); h.acknowledge(1); await current;
  assert.deepEqual(h.saved[0].selectedOptionIds, ['B']);
});
