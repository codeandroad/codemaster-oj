import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Luq batch price Nest endpoint enforces staff/CSRF, atomic authorization and idempotent retries for papers and problems',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(qa|test)(_[a-z0-9_]+)?$/i.test(url.pathname),'Use a dedicated local QA database');
 const manager=createPool(url.href),schema='luq_batch_http_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(url.href);let app;
 try{
  await migrate(pool);
  const password=randomBytes(30).toString('base64url'),hash=await hashPassword(password),actors={};
  for(const [name,kind]of [['teacher','teacher'],['other','teacher'],['student','student'],['admin','admin']]){
   const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0].id;
   const id=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,'batch-'+name,hash])).rows[0].id;
   await pool.query('INSERT INTO account_roles VALUES($1,$2)',[id,kind]);actors[name]={id,identityId};
  }
  async function problem(owner){
   const p=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner.id])).rows[0];
   const v=(await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code) VALUES($1,'Batch QA','stdio','Public question',1000,64,'private reference') RETURNING id",[p.id])).rows[0];
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);return p.id;
  }
  async function paper(owner){return(await pool.query("INSERT INTO paper4_papers(owner_account_id,title,delivery_kind) VALUES($1,'Batch QA paper','catalog') RETURNING id",[owner.id])).rows[0].id;}
  const targets={problem:[await problem(actors.teacher),await problem(actors.teacher),await problem(actors.other)],paper4:[await paper(actors.teacher),await paper(actors.teacher),await paper(actors.other)]};
  app=await createApiApplication({databaseUrl:url.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://batch-luq.test',COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  function client(){let cookie='',csrf='';return async(path,{body,method=body===undefined?'GET':'POST',expected=200,badCsrf=false}={})=>{
   const r=await fetch(base+'/api/v1'+path,{method,headers:{Origin:'http://batch-luq.test',Cookie:cookie,'X-CSRF-Token':badCsrf?'invalid':csrf,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const d=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(d)}`);assert.equal(r.headers.get('cache-control'),'no-store');
   if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(d.csrfToken)csrf=d.csrfToken;return d;
  };}
  const endpoint='/luq/policies/batch-prices';
  const anonymous=client();await anonymous(endpoint,{body:{},expected:401});
  for(const [name,actor]of Object.entries(actors)){actor.call=client();await actor.call('/auth/login',{body:{username:'batch-'+name,password}});}
  const {teacher,other,student,admin}=actors;
  for(const [targetType,[first,second,foreign]]of Object.entries(targets)){
   const request={requestId:randomUUID(),targetType,targetIds:[first,second],prices:{FULL_TRANSLATION:2,FULL_SOLUTION:9}};
   await student.call(endpoint,{body:request,expected:403});
   await teacher.call(endpoint,{body:request,badCsrf:true,expected:403});
   const mixed={...request,requestId:randomUUID(),targetIds:[first,foreign]};
   await teacher.call(endpoint,{body:mixed,expected:403});
   assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_policies WHERE target_type=$1',[targetType])).rows[0].n,0,'No authorized target is partly updated by a rejected mixed batch');
   assert.equal((await pool.query('SELECT count(*)::int n FROM luq_price_batches WHERE request_id=$1',[mixed.requestId])).rows[0].n,0,'Rejected batch leaves no success record');
   const opensAt=new Date(Date.now()+86_400_000).toISOString();
   await teacher.call('/luq/policies',{body:{targetType,targetId:first,kind:'FULL_TRANSLATION',mode:'free',opensAt},expected:201});
   const [saved,retried]=await Promise.all([teacher.call(endpoint,{body:request}),teacher.call(endpoint,{body:{...request,targetIds:[second,first,first]}})]);
   assert.deepEqual(retried,saved,'Duplicate IDs/order normalize to the same idempotent request');assert.equal(saved.count,2);assert.equal(saved.items.length,4);
   const kept=saved.items.find(item=>item.targetId===first&&item.kind==='FULL_TRANSLATION');assert.equal(kept.mode,'free');assert.equal(kept.opensAt,opensAt);assert.equal(kept.price,2);
   assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_policies WHERE target_type=$1',[targetType])).rows[0].n,5,'One prior policy plus exactly four new policy rows');
   assert.equal((await pool.query('SELECT count(*)::int n FROM luq_price_batches WHERE request_id=$1',[request.requestId])).rows[0].n,1);
   await teacher.call(endpoint,{body:{...request,prices:{FULL_TRANSLATION:7,FULL_SOLUTION:9}},expected:409});
   await other.call(endpoint,{body:request,expected:409});
   const override=await admin.call(endpoint,{body:{requestId:randomUUID(),targetType,targetIds:[first,foreign],prices:{FULL_SOLUTION:null}}});
   assert.equal(override.count,2);assert.ok(override.items.every(item=>item.price===null));
  }
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='luq.price_batch'")).rows[0].n,4,'Only successful batches write an audit event, not retries');
  assert.equal((await pool.query("SELECT count(*)::int n FROM luq_ledger WHERE kind='purchase'")).rows[0].n,0,'Pricing alone never spends student Luq');
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
