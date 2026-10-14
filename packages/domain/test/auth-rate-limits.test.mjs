import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainServices, loadConfig } from '../src/application.mjs';

const config = loadConfig({ SESSION_SECRET: 'classroom-limiter-test-secret-32-bytes', APP_ORIGIN: 'http://school.test', COOKIE_SECURE: 'false' });
const pool = { async query() { return { rowCount: 0, rows: [] }; } };

test('shared classroom IP permits 180 login, claim or reset attempts per route in a minute', async () => {
  const services = await createDomainServices(pool, config);
  for (const [route, lastRoute] of [
    ['/auth/login', '/auth/login'],
    ['/auth/verify-identity', '/auth/register'],
    ['/auth/reset', '/auth/reset'],
  ]) {
    const context = { route, method: 'POST', body: {}, ip: '198.51.100.50' };
    for (let attempt = 0; attempt < 180; attempt++) {
      await assert.rejects(services.execute('auth', context), error => error.code === 'VALIDATION');
    }
    await assert.rejects(services.execute('auth', { ...context, route: lastRoute }),
      error => error.status === 429 && error.code === 'RATE_LIMIT');
  }
});

test('per-username limit remains 10/min even when requests use different client IPs', async () => {
  const services = await createDomainServices(pool, config);
  for (let attempt = 0; attempt < 10; attempt++) {
    await assert.rejects(services.execute('auth', { route: '/auth/login', method: 'POST',
      body: { username: 'same-student', password: 'Wrong-pass-2026' }, ip: `198.51.100.${attempt + 1}` }),
    error => error.code === 'LOGIN_FAILED');
  }
  await assert.rejects(services.execute('auth', { route: '/auth/login', method: 'POST',
    body: { username: 'same-student', password: 'Wrong-pass-2026' }, ip: '203.0.113.200' }),
  error => error.status === 429 && error.code === 'RATE_LIMIT');
});
