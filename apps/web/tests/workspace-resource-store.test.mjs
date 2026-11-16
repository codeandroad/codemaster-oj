import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceResourceStore } from '../src/components/workspace-resource-store.ts';
import { ApiConnectionError } from '../src/lib/production-api.ts';

const catalog = 'schools/school-a/acsl';
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness() {
  const requests = [];
  const store = createWorkspaceResourceStore((path, signal) => {
    const pending = deferred();
    requests.push({ path, signal, ...pending });
    return pending.promise;
  }, error => error.message);
  return { store, requests };
}
async function start(h, path) {
  const done = h.store.load(path);
  await Promise.resolve();
  return { done, request: h.requests.at(-1) };
}
async function seed(h, path, data) {
  const { done, request } = await start(h, path);
  request.resolve(data); await done;
}

test('shell and ACSL page share schools and catalog requests', async () => {
  const h = harness();
  const a = h.store.load('schools'), b = h.store.load('schools');
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ items: [{ id: 'school-a', roles: ['student'] }] });
  await a;
  const c = h.store.load(catalog), d = h.store.load(catalog);
  assert.equal(c, d);
  await Promise.resolve();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ enabled: true, items: [] }); await c;
});

test('leaving a workspace keeps the confirmed entry visible while fresh progress loads', async () => {
  const h = harness();
  await seed(h, catalog, { enabled: true, items: [{ solved: false }] });
  const unsubscribe = h.store.subscribe(catalog, () => {});
  unsubscribe();
  const { done, request } = await start(h, catalog);
  assert.equal(h.store.snapshot(catalog).loading, false);
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  request.resolve({ enabled: true, items: [{ solved: true }] }); await done;
  assert.equal(h.store.snapshot(catalog).data.items[0].solved, true);
});

test('refresh after a save replaces a request started before the save', async () => {
  const h = harness(), path = 'problems?view=summary';
  await seed(h, path, { items: [{ tags: ['Published topic'] }] });
  const old = await start(h, path);
  const fresh = h.store.refresh(path);
  assert.equal(h.store.load(path), fresh);
  await Promise.resolve();
  assert.equal(old.request.signal.aborted, true);
  const data = { items: [{ tags: ['Published topic'], draftTags: ['Draft topic'] }] };
  h.requests.at(-1).resolve(data);
  await fresh;
  old.request.resolve({ items: [] });
  await old.done;
  assert.deepEqual(h.store.snapshot(path).data, data);
});

test('network failure preserves the catalog; reconnect retries it and respects explicit denial', async () => {
  const h = harness();
  await seed(h, catalog, { enabled: true, items: [] });
  const unsubscribe = h.store.subscribe(catalog, () => {});
  const pending = await start(h, catalog);
  pending.request.reject(new ApiConnectionError(new TypeError('Failed to fetch'))); await pending.done;
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  assert.equal(h.store.snapshot(catalog).connectionError, true);

  h.store.recoverObserved();
  const retry = await start(h, catalog);
  assert.notEqual(retry.request, pending.request);
  retry.request.reject(Object.assign(new Error('Forbidden'), { status: 403 })); await retry.done;
  assert.equal(h.store.snapshot(catalog).data, null);
  assert.equal(h.store.snapshot(catalog).error, 'Forbidden');
  assert.equal(h.store.snapshot(catalog).connectionError, false);
  h.store.recoverObserved();
  await Promise.resolve();
  assert.equal(h.requests.at(-1), retry.request);
  unsubscribe();
});

test('reconnect replaces a stalled observed request and ignores its late reply', async () => {
  const h = harness();
  const old = await start(h, catalog);
  const unsubscribe = h.store.subscribe(catalog, () => {});
  const unobserved = await start(h, 'schools/other/acsl');
  h.store.recoverObserved();
  const fresh = await start(h, catalog);
  assert.equal(old.request.signal.aborted, true);
  assert.equal(unobserved.request.signal.aborted, false);
  fresh.request.resolve({ enabled: true }); await fresh.done;
  old.request.reject(new ApiConnectionError(new TypeError('Failed to fetch'))); await old.done;
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  assert.equal(h.store.snapshot(catalog).error, '');
  unobserved.request.resolve({ enabled: false }); await unobserved.done;
  unsubscribe();
});

test('a load with no response times out and can be retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const old = await start(h, catalog);
  t.mock.timers.tick(15_000);
  assert.equal(old.request.signal.aborted, true);
  assert.equal(h.store.snapshot(catalog).loading, false);
  assert.equal(h.store.snapshot(catalog).connectionError, true);
  const fresh = await start(h, catalog);
  fresh.request.resolve({ enabled: true }); await fresh.done;
  old.request.resolve({ enabled: false }); await old.done;
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  assert.equal(h.store.snapshot(catalog).connectionError, false);
});

test('school, student and management catalogs remain separate', async () => {
  const h = harness();
  await seed(h, catalog, { enabled: true });
  await seed(h, catalog + '/manage', { enabled: false });
  await seed(h, 'schools/school-b/acsl', { enabled: false });
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  assert.equal(h.store.snapshot(catalog + '/manage').data.enabled, false);
  assert.equal(h.store.snapshot('schools/school-b/acsl').data.enabled, false);
});

test('membership refresh removes revoked school and teaching catalogs', async () => {
  const h = harness();
  await seed(h, catalog, { enabled: true });
  await seed(h, catalog + '/manage', { enabled: true });
  await seed(h, 'schools/school-b/acsl', { enabled: true });
  await seed(h, catalog + '?view=availability', { enabled: true });
  await seed(h, catalog + '/manage?view=availability', { enabled: true });
  await seed(h, 'schools/school-b/acsl?view=availability', { enabled: true });
  await seed(h, 'schools', { items: [{ id: 'school-a', roles: ['student'] }] });
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  assert.equal(h.store.snapshot(catalog + '/manage').data, null);
  assert.equal(h.store.snapshot('schools/school-b/acsl').data, null);
  assert.equal(h.store.snapshot(catalog + '?view=availability').data.enabled, true);
  assert.equal(h.store.snapshot(catalog + '/manage?view=availability').data, null);
  assert.equal(h.store.snapshot('schools/school-b/acsl?view=availability').data, null);
});

test('expired session clears all resources and rejects late responses', async () => {
  const h = harness();
  await seed(h, catalog, { enabled: true });
  const late = await start(h, catalog);
  const auth = await start(h, 'schools');
  auth.request.reject(Object.assign(new Error('Sign in again'), { status: 401 })); await auth.done;
  assert.equal(late.request.signal.aborted, true);
  late.request.resolve({ enabled: true }); await late.done;
  assert.equal(h.store.snapshot(catalog).data, null);
  assert.equal(h.store.snapshot('schools').data, null);
});

test('provider disposal aborts old work and a new account starts empty', async () => {
  const first = harness(), second = harness();
  await seed(first, catalog, { enabled: true });
  const late = await start(first, catalog);
  first.store.clear();
  assert.equal(late.request.signal.aborted, true);
  late.request.resolve({ enabled: true }); await late.done;
  assert.equal(first.store.snapshot(catalog).data, null);
  assert.equal(second.store.snapshot(catalog).data, null);
  assert.equal(second.requests.length, 0);
});
