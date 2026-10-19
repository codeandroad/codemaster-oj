import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Paper4Controller } from '../dist/modules/paper4.module.js';
import { DomainService } from '../dist/domain.service.js';
import { DomainGuard } from '../dist/domain.guard.js';

test('Paper 4 Nest routes preserve the method, body, and route for the domain authorization boundary', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const cases = [
    ['POST', '/paper4/imports/preview', { filename: 'paper4.json', contentBase64: 'e30=' }],
    ['POST', '/paper4/imports/batch-preview', {files:[{filename:'paper4.json',contentBase64:'e30='}]}],
    ['POST', '/paper4/papers/batch-import', {files:[{filename:'paper4.json',contentBase64:'e30='}]}],
    ['POST', '/paper4/papers/batch-export', {paperIds:[id]}],
    ['GET', '/paper4/papers?scope=catalog'],
    ['GET', '/paper4/papers?scope=activities'],
    ['POST', '/paper4/papers', { title: 'Practice' }],
    ['POST', '/paper4/papers/batch-publish', { paperIds: [id, '22222222-2222-4222-8222-222222222222'] }],
    ['POST', '/paper4/papers/batch-activities', {paperIds:[id],participants:[id],classIds:[],activityKind:'practice'}],
    ['PATCH', `/paper4/papers/${id}/metadata`, {shortTitle:'9618/41 mj 25'}],
    ['GET', `/paper4/papers/${id}`],
    ['GET', `/paper4/papers/${id}?versionId=${id}`],
    ['GET', `/paper4/papers/${id}?view=draft`],
    ['PATCH', `/paper4/papers/${id}`, { title: 'Revised practice' }],
    ['POST', `/paper4/papers/${id}/archive`, {}],
    ['POST', `/paper4/papers/${id}/restore`, {}],
    ['GET', `/paper4/papers/${id}/export?view=draft`],
    ['POST', `/paper4/papers/${id}/draft`, {}],
    ['POST', `/paper4/papers/${id}/reference-runs`, { questionKey: 'Q1' }],
    ['POST', `/paper4/papers/${id}/publish`, {}],
    ['GET', `/paper4/papers/${id}/activities`],
    ['POST', `/paper4/papers/${id}/activities`, {participants:[id],classIds:[],classId:null,activityKind:'practice'}],
    ['POST', `/paper4/papers/${id}/attempt`, {restart:true}],
    ['POST', `/paper4/papers/${id}/attempt`, {versionId:id}],
    ['POST', `/paper4/papers/${id}/attempt?versionId=${id}`, {restart:true,versionId:id}],
    ['GET', `/paper4/papers/${id}/attempt`],
    ['GET', `/paper4/papers/${id}/attempt?versionId=${id}`],
    ['GET', `/paper4/attempts?paperId=${id}`],
    ['GET', `/paper4/attempts/${id}`],
    ['GET', `/paper4/attempts/${id}/solutions/Q1`],
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
      assert.equal(actual.url.search,new URL(path,'http://localhost').search);
      if (body !== undefined) assert.deepEqual(actual.body, body);
    }
  } finally {
    await app.close();
  }
});


test('Paper 4 batch publication runs the mutation guard and preserves atomic validation errors',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const selected={paperIds:[id]};
  let prepared=0,executed=0;
  const error={code:'REFERENCE_NOT_VALIDATED',message:'Draft paper: reference validation required',paperId:id,paperTitle:'Draft paper'};
  const domain={
    prepare:async request=>{
      prepared++;
      assert.equal(request.url,'/api/v1/paper4/papers/batch-publish');
      assert.equal(request.method,'POST');
      assert.deepEqual(request.rawBody,selected);
      if(request.headers['x-csrf-token']!=='valid-test-token')throw new ForbiddenException('Mutation denied');
      return {route:'/paper4/papers/batch-publish',method:request.method,body:request.rawBody};
    },
    execute:async(area,context)=>{
      executed++;
      assert.equal(area,'paper4');assert.equal(context.route,'/paper4/papers/batch-publish');
      assert.deepEqual(context.body,selected);
      return {status:409,body:{error}};
    },
  };
  class TestModule {}
  Module({controllers:[Paper4Controller],providers:[{provide:DomainService,useValue:domain},DomainGuard]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false});
  await app.listen(0,'127.0.0.1');
  try{
    const url=`${await app.getUrl()}/api/v1/paper4/papers/batch-publish`;
    const denied=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(selected)});
    assert.equal(denied.status,403);assert.equal(prepared,1);assert.equal(executed,0);
    const checked=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':'valid-test-token'},body:JSON.stringify(selected)});
    assert.equal(checked.status,409);assert.deepEqual(await checked.json(),{error});
    assert.equal(prepared,2);assert.equal(executed,1);
  }finally{await app.close();}
});
