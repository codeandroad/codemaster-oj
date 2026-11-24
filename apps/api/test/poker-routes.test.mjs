import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PokerController } from '../dist/modules/poker.module.js';
import { DomainService } from '../dist/domain.service.js';
import { DomainGuard } from '../dist/domain.guard.js';

test('Poker Nest routes preserve method, body, query, and route for the poker domain boundary', async () => {
  const id = '00000000-0000-4000-8000-000000000901';
  const cases = [
    ['GET', '/practice/poker/status'],
    ['GET', '/practice/poker/history'],
    ['GET', `/practice/poker/tables/${id}?since=3`],
    ['POST', '/practice/poker/wallet/withdraw', {}],
    ['POST', `/practice/poker/tables/${id}/join`, { seatIndex: 0, buyInCents: 400 }],
    ['POST', `/practice/poker/tables/${id}/rebuy`, { amountCents: 200 }],
    ['POST', `/practice/poker/tables/${id}/leave`, { immediate: false }],
    ['POST', `/practice/poker/tables/${id}/action`, { handId: id, action: 'call' }],
    ['POST', `/practice/poker/tables/${id}/bots`, { action: 'add', count: 1 }],
    ['GET', '/platform/poker'],
    ['PATCH', '/platform/poker/settings', { enabled: true, defaultSmallBlindCents: 10, defaultBigBlindCents: 20 }],
    ['POST', '/platform/poker/tables', { name: 'Table 2', smallBlindCents: 25, bigBlindCents: 50, maxSeats: 6, enabled: true }],
    ['PATCH', `/platform/poker/tables/${id}`, { name: 'Table 1', enabled: true }],
  ];

  const observed = [];
  const domain = {
    prepare: async (request) => ({
      url: new URL(request.url, 'http://localhost'),
      route: new URL(request.url, 'http://localhost').pathname.replace('/api/v1', ''),
      method: request.method,
      body: request.rawBody,
    }),
    execute: async (area, context) => {
      observed.push({ area, ...context });
      return { status: 200, body: { routed: true } };
    },
  };

  class TestModule {}
  Module({
    controllers: [PokerController],
    providers: [{ provide: DomainService, useValue: domain }, DomainGuard],
  })(TestModule);

  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    for (const [method, path, body] of cases) {
      const response = await fetch(`${await app.getUrl()}/api/v1${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.deepEqual(await response.json(), { routed: true });
      const actual = observed.at(-1);
      assert.equal(actual.area, 'poker');
      assert.equal(actual.method, method);
      assert.equal(actual.route, path.split('?')[0]);
      assert.equal(actual.url.search, new URL(path, 'http://localhost').search);
      if (body !== undefined) assert.deepEqual(actual.body, body);
    }
  } finally {
    await app.close();
  }
});
