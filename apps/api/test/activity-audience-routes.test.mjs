import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ForbiddenException,Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {ClassesController} from '../dist/modules/classes.module.js';
import {EducationController} from '../dist/modules/education.module.js';
import {DomainService} from '../dist/domain.service.js';
import {DomainGuard} from '../dist/domain.guard.js';

test('audience and member-only class hubs use guarded Nest routes and preserve query filters',async()=>{
 const id='11111111-1111-4111-8111-111111111111';let executions=0;
 const domain={prepare:async request=>{if(request.headers['x-test-session']!=='authorized')throw new ForbiddenException('Session required');return {method:request.method,url:request.url,route:new URL(request.url,'http://test').pathname.replace('/api/v1','')};},execute:async(area,context)=>{executions++;assert.equal(context.method,'GET');return {status:200,body:{area,route:context.route,url:context.url}};}};
 class TestModule{}Module({controllers:[ClassesController,EducationController],providers:[{provide:DomainService,useValue:domain},DomainGuard]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
 try{const base=await app.getUrl();for(const [path,area] of [[`/teaching/audience?classIds=${id}&unassigned=true&search=Lin`,'education'],[`/classes/${id}`,'classes']]){
  const denied=await fetch(base+'/api/v1'+path);assert.equal(denied.status,403);assert.equal(executions,0);
  const response=await fetch(base+'/api/v1'+path,{headers:{'x-test-session':'authorized'}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{area,route:path.split('?')[0],url:'/api/v1'+path});executions=0;
 }}finally{await app.close();}
});
