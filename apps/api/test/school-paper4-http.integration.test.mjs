import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {provisionSchool} from '../../../packages/domain/src/schools.mjs';

test('Nest school Paper 4 transport validates session, CSRF, school scope and private draft access',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema='school_p4_http_'+randomBytes(5).toString('hex');const u=new URL(process.env.TEST_DATABASE_URL);assert.match(u.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);u.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(u.href);let app;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password),users={};
  for(const name of ['teacher','student','outside']){const i=randomUUID();await pool.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'personal',$2,$2)",[i,name]);users[name]=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[i,name,passwordHash])).rows[0];}
  const school=await provisionSchool(pool,{slug:'paper4-http-school',name:'School',adminUsername:'teacher'});await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[school.id,users.student.id]);
  u.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);app=await createApiApplication({databaseUrl:u.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:'http://p4.test',COOKIE_SECURE:'false'})});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const req=async(path,{auth,method='GET',body,csrf=true}={})=>{const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:'http://p4.test',...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.token}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json(),cache:r.headers.get('cache-control'),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const auth={};for(const name of Object.keys(users)){const r=await req('/auth/login',{method:'POST',body:{username:name,password}});assert.equal(r.status,200,JSON.stringify(r.data));auth[name]={cookie:r.cookie,token:r.data.csrfToken};}
  const prefix=`/schools/${school.id}/paper4`;
  assert.equal((await req(prefix+'/papers')).status,401);assert.equal((await req(prefix+'/papers',{auth:auth.outside})).status,404);assert.equal((await req(prefix+'/papers',{auth:auth.student})).status,200);
  const body={requestId:randomUUID(),title:'Private',questions:[{key:'Q1',title:'One',statement:'Public statement',stages:[{id:'a',title:'Auto',judgeMode:'auto',maxMarks:75}]}],runnerCases:{a:[{expectedStdout:'SECRET_TEST'}]},referenceSolutions:{Q1:'SECRET_REFERENCE'}};
  assert.equal((await req(prefix+'/papers',{auth:auth.teacher,method:'POST',body,csrf:false})).status,403);assert.equal((await req(prefix+'/papers',{auth:auth.student,method:'POST',body})).status,403);
  const created=await req(prefix+'/papers',{auth:auth.teacher,method:'POST',body});assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.cache,'no-store');
  const repeat=await req(prefix+'/papers',{auth:auth.teacher,method:'POST',body});assert.equal(repeat.data.id,created.data.id);
  assert.equal((await req(prefix+'/papers/'+created.data.id,{auth:auth.student})).status,404);assert.equal((await req(prefix+'/papers/'+created.data.id,{auth:auth.outside})).status,404);
  const own=await req(prefix+'/papers/'+created.data.id,{auth:auth.teacher});assert.equal(own.status,200);assert.equal(own.data.referenceSolutions.Q1,'SECRET_REFERENCE');
  assert.equal((await req(prefix+'/papers/import-preview',{auth:auth.teacher,method:'POST',body:{files:[]}})).status,400);
  assert.equal((await req(prefix+'/attempts/'+randomUUID()+'/files/Q1',{auth:auth.student,method:'PUT',body:{code:'pass',expectedRevision:1},csrf:false})).status,403);
 }finally{await app?.close();await pool.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
