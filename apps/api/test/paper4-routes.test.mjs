import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Paper4Controller } from '../dist/modules/paper4.module.js';
import { DomainService } from '../dist/domain.service.js';
import { DomainGuard } from '../dist/domain.guard.js';

test('Paper 4 Nest routes preserve the method, body, and route for the domain authorization boundary', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const cases = [
    ['GET', '/paper4/papers'],
    ['POST', '/paper4/papers', { title: 'Practice' }],
    ['GET', `/paper4/papers/${id}`],
    ['PATCH', `/paper4/papers/${id}`, { title: 'Revised practice' }],
    ['POST', `/paper4/papers/${id}/publish`, {}],
    ['POST', `/paper4/papers/${id}/attempt`, {}],
    ['GET', `/paper4/papers/${id}/attempt`],
    ['GET', `/paper4/attempts?paperId=${id}`],
    ['GET', `/paper4/attempts/${id}`],
    ['PATCH', `/paper4/attempts/${id}/files/main.py`, { content: 'print(1)', revision: 0 }],
    ['POST', `/paper4/attempts/${id}/checkpoints`, { stageId: 'q1a' }],
    ['POST', `/paper4/attempts/${id}/runs`, { fileKey: 'main.py' }],
    ['GET', `/paper4/runs/${id}`],
    ['POST', `/paper4/attempts/${id}/submit`, {}],
    ['PATCH', `/paper4/attempts/${id}/marks`, { stageId: 'q1a', marks: 2 }],
    ['POST', `/paper4/attempts/${id}/release`, {}],
  ];
  const observed = [];
  const domain = {
    prepare: async (request) => ({
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
  Module({ controllers: [Paper4Controller], providers: [
    { provide: DomainService, useValue: domain }, DomainGuard,
  ] })(TestModule);
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
      assert.equal(actual.area, 'paper4');
      assert.equal(actual.method, method);
      assert.equal(actual.route, path.split('?')[0]);
      if (body !== undefined) assert.deepEqual(actual.body, body);
    }
  } finally {
    await app.close();
  }
});
