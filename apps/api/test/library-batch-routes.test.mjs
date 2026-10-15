import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LibraryController } from '../dist/modules/library.module.js';
import { DomainService } from '../dist/domain.service.js';
import { DomainGuard } from '../dist/domain.guard.js';

for(const operation of [
  {path:'/problems/publish-batch',countKey:'publishedCount'},
  {path:'/problems/rank-review/approve-batch',countKey:'approvedCount'},
])test(`Nest routes ${operation.path} to the library domain with exact selected versions`, async () => {
  const id='11111111-1111-4111-8111-111111111111';
  const selected={items:[{problemId:id,versionId:id}]};
  const domain={
    prepare:async request=>({route:request.url.replace('/api/v1',''),method:request.method,body:request.rawBody}),
    execute:async(area,context)=>{
      assert.equal(area,'library');
      assert.equal(context.route,operation.path);
      assert.equal(context.method,'POST');
      assert.deepEqual(context.body,selected);
      return {status:200,body:{[operation.countKey]:1,items:selected.items}};
    },
  };
  class TestModule {}
  Module({controllers:[LibraryController],providers:[{provide:DomainService,useValue:domain},DomainGuard]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false});
  await app.listen(0,'127.0.0.1');
  try {
    const response=await fetch(`${await app.getUrl()}/api/v1${operation.path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(selected)});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{[operation.countKey]:1,items:selected.items});
  } finally {await app.close();}
});
