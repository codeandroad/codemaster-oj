import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {localCourseApi,platformJournalKey,unifiedJournalKey} from '../lib/local-acsl-course-api.mjs';

test('platform maintenance journal stays stable across operators without reusing the teacher journal',()=>{
 const origin='http://localhost:3004';
 assert.equal(platformJournalKey(origin),platformJournalKey(origin));
 assert.notEqual(platformJournalKey(origin),platformJournalKey('http://localhost:3005'));
 for(const name of ['school-admin','platform-admin'])assert.notEqual(platformJournalKey(origin),unifiedJournalKey(origin,name));
});

test('school credentials and old platform APIs fail before any maintenance journal or course write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'acsl-platform-api-')),authFile=join(directory,'auth.json'),previous=process.cwd(),fetch=globalThis.fetch;
 await writeFile(authFile,JSON.stringify({username:'test',password:randomBytes(24).toString('base64url')}),{mode:0o600});
 process.chdir(directory);
 try{
  for(const platformAdmin of [false,true]){
   const calls=[];
   globalThis.fetch=async(url,options)=>{
    const path=new URL(url).pathname;calls.push({path,method:options.method});
    if(path.endsWith('/auth/login'))return new Response(JSON.stringify({user:{platformAdmin,roles:['teacher','admin']},csrfToken:'qa'}),{headers:{'Set-Cookie':'qa=session; HttpOnly'}});
    if(path.endsWith('/platform/courses'))return new Response(JSON.stringify({items:[]}));
    return new Response(JSON.stringify({error:{code:'NOT_FOUND'}}),{status:404});
   };
   await assert.rejects(localCourseApi({origin:'http://localhost:3195',authFile}),platformAdmin?/acsl-links: HTTP 404/:/platform administrator/);
   assert.ok(!calls.some(c=>c.method!=='GET'&&!c.path.endsWith('/auth/login')));
   assert.equal(calls.length,platformAdmin?3:1);
   await assert.rejects(stat(join(directory,'.campus-local')),{code:'ENOENT'});
  }
 }finally{globalThis.fetch=fetch;process.chdir(previous);await rm(directory,{recursive:true,force:true});}
});
