import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMutation, RateLimiter, safeEqual, tokenHash, sessionHash, username, bytes, sessionCookie } from '../src/security.mjs';
import { loadConfig } from '../src/app.mjs';
import { parseFunctionInput, parseJsonValue } from '../src/function-input.mjs';

test('CSRF credentials and exact origin are both required for authenticated writes',()=>{
 const session={csrf_token:'correct-token'};
 assert.throws(()=>checkMutation({headers:{origin:'https://school.test.evil','x-csrf-token':'correct-token'}},session,['https://school.test']),e=>e.code==='ORIGIN');
 assert.throws(()=>checkMutation({headers:{origin:'https://school.test'}},session,['https://school.test']),e=>e.code==='CSRF');
 checkMutation({headers:{origin:'https://school.test','x-csrf-token':'correct-token'}},session,['https://school.test']);
 assert.throws(()=>checkMutation({headers:{}},null,['https://school.test']),e=>e.code==='ORIGIN');
});
test('rate limit expires and prevents a burst',()=>{let time=0;const limit=new RateLimiter({max:2,windowMs:100,clock:()=>time});limit.check('a');limit.check('a');assert.throws(()=>limit.check('a'),e=>e.status===429);time=100;limit.check('a');});
test('tokens use hashes, cookie protects session, unicode code size is measured in bytes',()=>{
 assert.notEqual(tokenHash('a'),sessionHash('a','secret'));assert.equal(safeEqual('x','xx'),false);assert.equal(safeEqual('x','x'),true);
 assert.match(sessionCookie('token'),/HttpOnly; SameSite=Strict/);assert.match(sessionCookie('token'),/Secure/);
 assert.throws(()=>bytes('中文','代码',5),e=>e.status===413);assert.equal(username('Student.A'),'student.a');
});
test('production never silently starts with missing or insecure config',()=>{
 assert.throws(()=>loadConfig({}),/SESSION_SECRET/);
 assert.throws(()=>loadConfig({SESSION_SECRET:'x'.repeat(32),NODE_ENV:'production',APP_ORIGIN:'http://school.test',JUDGE_IMAGE:'pinned'}),/HTTPS/);
 assert.throws(()=>loadConfig({SESSION_SECRET:'x'.repeat(32),NODE_ENV:'production',APP_ORIGIN:'https://school.test',JUDGE_IMAGE:'pinned',COOKIE_SECURE:'false'}),/Secure/);
 assert.equal(loadConfig({SESSION_SECRET:'x'.repeat(32),APP_ORIGIN:'http://localhost:3000',COOKIE_SECURE:'false'}).secure,false);
});
test('function protocol rejects malformed keyword arguments, extra keys, nonfinite numbers and excess nesting',()=>{
 assert.deepEqual(parseFunctionInput('[1,true]'),[1,true]);assert.deepEqual(parseFunctionInput('{"args":[1],"kwargs":{"step":2}}'),{args:[1],kwargs:{step:2}});
 for(const input of ['invalid','{"args":[] ,"kwargs":null}','{"args":[] ,"kwargs":[]}','{"args":[],"extra":1}','{"kwargs":{}}','[1e400]'])assert.throws(()=>parseFunctionInput(input));
 assert.throws(()=>parseJsonValue('['.repeat(65)+'0'+']'.repeat(65)));
});
