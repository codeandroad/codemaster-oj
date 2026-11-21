import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApiConnectionError,
  ApiError,
  apiConnectionMessage,
  apiMessage,
  clearProductionSession,
  isApiConnectionError,
  productionApi,
  productionSessionExpiredEvent,
} from '../src/lib/production-api.ts';

test('only an unauthenticated response for the current session requests sign-in', async (t) => {
  const window = new EventTarget();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    clearProductionSession();
  });

  const unauthorized = () => Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  let finishOldRequest;
  let finishOldAccountCheck;
  let mutationToken;
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    switch (path) {
      case '/api/v1/auth/me': return Response.json({ csrfToken: 'old-token' });
      case '/api/v1/auth/login': return options.body
        ? Response.json({ csrfToken: 'new-token' })
        : Response.json({ error: { code: 'LOGIN_FAILED' } }, { status: 401 });
      case '/api/v1/old-request': return new Promise(resolve => { finishOldRequest = resolve; });
      case '/api/v1/old-account-check': return new Promise(resolve => { finishOldAccountCheck = resolve; });
      case '/api/v1/new-mutation':
        mutationToken = options.headers['X-CSRF-Token'];
        return Response.json({ ok: true });
      default: return unauthorized();
    }
  });

  let expiredEvents = 0;
  window.addEventListener(productionSessionExpiredEvent, () => {
    expiredEvents++;
    clearProductionSession();
  });
  const expect401 = request => assert.rejects(request, error => error instanceof ApiError && error.status === 401);
  await productionApi('auth/me');
  const pending401 = expect401(productionApi('old-request'));
  const pendingAccountCheck = productionApi('old-account-check');

  await expect401(productionApi('auth/login', { method: 'POST' }));
  await expect401(productionApi('auth/logout', { method: 'POST' }));
  assert.equal(expiredEvents, 0);
  await expect401(productionApi('learning-paths/course'));
  assert.equal(expiredEvents, 1);

  await productionApi('auth/login', { method: 'POST', body: {} });
  finishOldRequest(unauthorized());
  finishOldAccountCheck(Response.json({ csrfToken: 'old-token' }));
  await Promise.all([pending401, pendingAccountCheck]);
  await productionApi('new-mutation', { method: 'POST' });
  assert.equal(expiredEvents, 1);
  assert.equal(mutationToken, 'new-token');
});

test('transport failures are distinct from aborts and explicit access denials', async (t) => {
  const networkFailure = new TypeError('Failed to fetch');
  const disconnected = () => new ReadableStream({ start(controller) { controller.error(networkFailure); } });
  const fetch = t.mock.method(globalThis, 'fetch', async (path, { signal }) => {
    if (signal?.aborted) throw signal.reason;
    if (path.endsWith('/denied')) return new Response(disconnected(), { status: 403 });
    if (path.endsWith('/partial')) return new Response(disconnected());
    throw networkFailure;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(productionApi('catalog', { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(productionApi('partial'), ApiConnectionError);
  await assert.rejects(productionApi('denied'), error => error instanceof ApiError && error.status === 403);
  await assert.rejects(productionApi('answers', { method: 'POST', body: {} }), ApiConnectionError);
  assert.equal(fetch.mock.calls.length, 4);
});

test('connection errors map to friendly message and request timeout aborts stalled fetches', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const connErr = new ApiConnectionError(new TypeError('Failed to fetch'));
  assert.equal(isApiConnectionError(connErr), true);
  assert.equal(apiMessage(connErr), apiConnectionMessage);
  assert.equal(isApiConnectionError(new ApiError(502, 'BAD_GATEWAY', 'Bad Gateway')), true);
  assert.equal(apiMessage(new ApiError(503, 'UNAVAILABLE', 'Unavailable')), apiConnectionMessage);
  assert.equal(isApiConnectionError(new ApiError(403, 'FORBIDDEN', 'Forbidden')), false);

  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => new Promise((_resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));

  const stalled = productionApi('learning-paths/demo', { timeoutMs: 15_000 });
  t.mock.timers.tick(15_000);
  await assert.rejects(stalled, ApiConnectionError);

  const caller = new AbortController();
  const cancelled = productionApi('learning-paths/demo', { signal: caller.signal, timeoutMs: 15_000 });
  caller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
});
