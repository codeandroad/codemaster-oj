import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceResourceStore } from '../src/components/workspace-resource-store.ts';

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

test('temporary network failure preserves confirmed availability; explicit denial clears it', async () => {
  const h = harness();
  await seed(h, catalog, { enabled: true, items: [] });
  let pending = await start(h, catalog);
  pending.request.reject(new Error('Network unavailable')); await pending.done;
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  pending = await start(h, catalog);
  pending.request.reject(Object.assign(new Error('Forbidden'), { status: 403 })); await pending.done;
  assert.equal(h.store.snapshot(catalog).data, null);
  assert.equal(h.store.snapshot(catalog).error, 'Forbidden');
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
  await seed(h, 'schools', { items: [{ id: 'school-a', roles: ['student'] }] });
  assert.equal(h.store.snapshot(catalog).data.enabled, true);
  assert.equal(h.store.snapshot(catalog + '/manage').data, null);
  assert.equal(h.store.snapshot('schools/school-b/acsl').data, null);
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
