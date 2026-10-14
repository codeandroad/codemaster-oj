import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EducationController } from '../dist/modules/education.module.js';
import { DomainGuard } from '../dist/domain.guard.js';
import { DomainService } from '../dist/domain.service.js';
import { configureTrustedProxies } from '../dist/client-ip.js';

async function withApi(trustedProxyCidrs, verify) {
  const domain = {
    async prepare({ ip }) { return { ip }; },
    async execute(_area, context) { return { status: 200, body: { ip: context.ip } }; },
  };
  class TestModule {}
  Module({ controllers: [EducationController], providers: [{ provide: DomainService, useValue: domain }, DomainGuard] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  configureTrustedProxies(app.getHttpAdapter().getInstance(), trustedProxyCidrs);
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    await verify(async forwardedFor => {
      const response = await fetch(`${base}/api/v1/learning-paths`, {
        headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
      });
      assert.equal(response.status, 200);
      return (await response.json()).ip;
    });
  } finally {
    await app.close();
  }
}

test('direct HTTP clients cannot choose their limiter key using X-Forwarded-For', async () => {
  await withApi('', async ip => {
    assert.equal(await ip('198.51.100.10'), '127.0.0.1');
    assert.equal(await ip('203.0.113.20'), '127.0.0.1');
  });
  await withApi('192.0.2.0/24', async ip => {
    assert.equal(await ip('198.51.100.10'), '127.0.0.1');
  });
});

test('trusted gateway uses nearest untrusted valid client IP and rejects forged or invalid prefixes', async () => {
  await withApi('127.0.0.1/8', async ip => {
    assert.equal(await ip('203.0.113.99, 198.51.100.10'), '198.51.100.10');
    assert.equal(await ip('203.0.113.99, 172.20.0.2'), '172.20.0.2');
    assert.equal(await ip('not-an-ip'), '127.0.0.1');
  });
});

test('proxy trust configuration rejects broad or malformed values', () => {
  const app = { set() { throw new Error('invalid ranges should not be installed'); } };
  for (const input of ['true', '127.0.0.1/33', '::1/129', '0.0.0.0/0', '127.0.0.1/8,', '127.0.0.1//8']) {
    assert.throws(() => configureTrustedProxies(app, input), /Invalid TRUSTED_PROXY_CIDRS/);
  }
});
