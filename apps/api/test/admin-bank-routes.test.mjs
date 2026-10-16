import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LibraryController } from '../dist/modules/library.module.js';
import { DomainService } from '../dist/domain.service.js';
import { DomainGuard } from '../dist/domain.guard.js';

test('Nest transports bank inventory, archive and delete operations to library domain',async()=>{
 const paths=[
  {method:'GET',path:'/admin/problem-banks'},
  {method:'GET',path:'/admin/problem-banks/11111111-1111-4111-8111-111111111111/problems?page=2'},
  {method:'PATCH',path:'/admin/problem-banks/11111111-1111-4111-8111-111111111111'},
  {method:'DELETE',path:'/problem-banks/11111111-1111-4111-8111-111111111111'},
  {method:'PATCH',path:'/admin/problems/11111111-1111-4111-8111-111111111111'},
  {method:'GET',path:'/admin/problems/11111111-1111-4111-8111-111111111111'},
 ];
 const received=[];
 const domain={prepare:async request=>({route:new URL(request.url,'http://api.local').pathname.replace('/api/v1',''),method:request.method,body:request.rawBody}),
  execute:async(area,context)=>{received.push({area,...context});return {status:200,body:{ok:true}};}};
 class TestModule {}
 Module({controllers:[LibraryController],providers:[{provide:DomainService,useValue:domain},DomainGuard]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});
 await app.listen(0,'127.0.0.1');
 try{
  for(const expected of paths){
   const response=await fetch(`${await app.getUrl()}/api/v1${expected.path}`,{method:expected.method,...(expected.method==='PATCH'?{headers:{'content-type':'application/json'},body:JSON.stringify({archived:true})}:{})});
   assert.equal(response.status,200,expected.path);
   assert.deepEqual(await response.json(),{ok:true});
   const actual=received.at(-1);
   assert.equal(actual.area,'library');
   assert.equal(actual.route,expected.path.split('?')[0]);
   assert.equal(actual.method,expected.method);
  }
 }finally{await app.close();}
});
