import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/production-api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { ApiError, clearProductionSession, productionApi, productionSessionExpiredEvent } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

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
