import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleLuqAssistance} from '../src/luq-assistance.mjs';

test('same-problem single-kind and two-kind price writes lock the target before kind locks, avoiding an advisory-lock cycle',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(url.pathname),'Use a dedicated local test database.');
 const suffix=randomBytes(6).toString('hex'),schema='luq_price_lock_'+suffix,manager=createPool(url.href);
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(url.href);
 const batchUrl=new URL(url);batchUrl.searchParams.set('application_name','luq_batch_'+suffix);const batchPool=createPool(batchUrl.href);
 const singleUrl=new URL(url);singleUrl.searchParams.set('application_name','luq_single_'+suffix);const singlePool=createPool(singleUrl.href);
 let blocker,blocked=false,batchPromise,singlePromise;
 try{
  await migrate(pool);
  const identityId=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('teacher',$1,'Lock QA') RETURNING id",[randomUUID()])).rows[0].id;
  const accountId=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$2) RETURNING id',[identityId,randomUUID()])).rows[0].id;
  const problemId=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[accountId])).rows[0].id;
  await pool.query("INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code) VALUES($1,'Lock QA','stdio','Public question',1000,64,'print(1)')",[problemId]);
  const user={id:accountId,identityId,roles:['teacher']};
  const request=(connection,route,body)=>handleLuqAssistance({pool:connection,user,route,method:'POST',url:new URL('http://luq-lock.test'+route),body});
  async function waitForLock(applicationName){
   const deadline=Date.now()+5000;
   while(Date.now()<deadline){
    const row=(await pool.query(`SELECT a.pid,a.wait_event,a.query,EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND NOT l.granted) waiting_lock
     FROM pg_stat_activity a WHERE a.application_name=$1 AND a.wait_event_type='Lock'`,[applicationName])).rows[0];
    if(row?.waiting_lock)return row;
    await delay(10);
   }
   assert.fail('Expected a database lock wait for '+applicationName);
  }
  blocker=await pool.connect();await blocker.query('BEGIN');blocked=true;
  // Hold the trigger's target-wide lock. The batch first obtains its target
  // row + FULL_SOLUTION lock, then visibly waits for this external lock.
  await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-policy:problem:'||$1,0))",[problemId]);
  batchPromise=request(batchPool,'/luq/policies/batch-prices',{requestId:randomUUID(),targetType:'problem',targetIds:[problemId],prices:{FULL_SOLUTION:8,FULL_TRANSLATION:3}});
  // Attach rejection handlers immediately while deliberately holding locks.
  batchPromise.catch(()=>{});
  const batchWait=await waitForLock('luq_batch_'+suffix);assert.equal(batchWait.wait_event,'advisory');
  singlePromise=request(singlePool,'/luq/policies',{targetType:'problem',targetId:problemId,kind:'FULL_TRANSLATION',mode:'paid',price:7});
  singlePromise.catch(()=>{});
  const singleWait=await waitForLock('luq_single_'+suffix);
  await blocker.query('ROLLBACK');blocked=false;blocker.release();blocker=null;
  const results=await Promise.allSettled([batchPromise,singlePromise]);
  assert.ok(results.every(result=>result.status==='fulfilled'),JSON.stringify(results.map(result=>result.status==='rejected'?{code:result.reason.code,message:result.reason.message}:{status:result.status})));
  // With the missing FOR UPDATE regression, this request instead takes the
  // translation-kind advisory lock and waits on the trigger's base lock. Once
  // released, that creates a cycle with the batch, which needs translation next.
  assert.ok(['transactionid','tuple'].includes(singleWait.wait_event),`Single write must wait for the target row, not a kind/base advisory lock: ${singleWait.wait_event}`);
  const rows=(await pool.query('SELECT kind,price,rule_version FROM luq_assistance_policies WHERE target_id=$1 ORDER BY kind,rule_version',[problemId])).rows;
  assert.deepEqual(rows,[{kind:'FULL_SOLUTION',price:8,rule_version:1},{kind:'FULL_TRANSLATION',price:3,rule_version:1},{kind:'FULL_TRANSLATION',price:7,rule_version:2}]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_price_batches')).rows[0].n,1);
 }finally{
  if(blocker){if(blocked)await blocker.query('ROLLBACK');blocker.release();}
  await Promise.allSettled([batchPromise,singlePromise].filter(Boolean));
  await batchPool.end();await singlePool.end();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
