import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createPool,transaction} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {getLuqSettings,handleLuqLedger,postLuqEntry} from '../src/luq-ledger.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};
async function fixture(run,{legacy=false}={}){
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(url.pathname),'A dedicated local test database is required.');
 const manager=createPool(url.href),schema='luq_initial_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);
 try{
  if(legacy){
   await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
   const dir=new URL('../migrations/',import.meta.url);
   for(const name of(await readdir(dir)).filter(name=>name.endsWith('.sql')&&name<'044').sort()){
    const sql=(await readFile(new URL(name,dir),'utf8')).replaceAll('SECURITY DEFINER SET search_path=public,pg_temp',`SECURITY DEFINER SET search_path="${schema}",pg_temp`);
    await pool.query(sql);await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
   }
  }else await migrate(pool);
  async function identity(kind='student',archived=false){return(await pool.query('INSERT INTO identities(kind,number,name,archived_at) VALUES($1,$2,$2,$3) RETURNING id',[kind,randomUUID(),archived?new Date():null])).rows[0].id;}
  const balance=async id=>(await pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[id])).rows[0]?.balance??0;
  const entries=async id=>(await pool.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id',[id])).rows;
  const setAmount=async amount=>pool.query('UPDATE luq_settings SET initial_grant=$1,rule_version=rule_version+1 WHERE singleton',[amount]);
  await run({pool,identity,balance,entries,setAmount});
 }finally{await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}

test('initial allowance is 100 once for active stable students before activation, with independent append-only records',options,async()=>fixture(async f=>{
 assert.equal((await getLuqSettings(f.pool)).initialGrant,100);
 const id=await f.identity();assert.equal(await f.balance(id),100);
 const ledger=await f.entries(id);assert.equal(ledger.length,1);assert.equal(ledger[0].kind,'initial_grant');assert.equal(ledger[0].delta,100);
 assert.equal(ledger[0].source_key,'initial-grant:'+id);assert.equal(ledger[0].actor_account_id,null);
 const claim=(await f.pool.query('SELECT * FROM luq_initial_grants WHERE identity_id=$1',[id])).rows[0];
 assert.equal(claim.amount,100);assert.equal(claim.ledger_id,ledger[0].id);
 const version=(await f.pool.query('SELECT settings FROM luq_setting_versions WHERE rule_version=$1',[claim.rule_version])).rows[0];
 assert.equal(version.settings.initial_grant,100);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM accounts')).rows[0].n,0,'No activated account is needed');
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM point_ledger')).rows[0].n,0);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM school_rank_ledger')).rows[0].n,0);
 await assert.rejects(f.pool.query('UPDATE luq_initial_grants SET amount=101 WHERE identity_id=$1',[id]),/append-only/);
 await assert.rejects(f.pool.query('DELETE FROM luq_initial_grants WHERE identity_id=$1',[id]),/append-only/);
 await assert.rejects(f.pool.query('DELETE FROM luq_ledger WHERE identity_id=$1',[id]),/append-only/);
}));

test('migration backfills active identities additively, leaves existing ledger/account data intact, and reruns do not reissue',options,async()=>fixture(async f=>{
 const old=await f.identity(),unassigned=await f.identity(),archived=await f.identity('student',true),teacher=await f.identity('teacher');
 await transaction(f.pool,db=>postLuqEntry(db,{identityId:old,delta:17,kind:'admin_grant',sourceKey:'legacy-credit',reason:'Existing funds'}));
 await transaction(f.pool,db=>postLuqEntry(db,{identityId:old,delta:-8,kind:'purchase',sourceKey:'legacy-purchase',reason:'Existing purchase'}));
 const before=await f.entries(old),identities=(await f.pool.query('SELECT * FROM identities ORDER BY id')).rows;
 await migrate(f.pool);await migrate(f.pool);
 assert.equal(await f.balance(old),109);assert.equal(await f.balance(unassigned),100);assert.equal(await f.balance(archived),0);assert.equal(await f.balance(teacher),0);
 assert.deepEqual((await f.entries(old)).slice(0,2),before,'Existing ledger entries retain all fields');
 assert.deepEqual((await f.pool.query('SELECT * FROM identities ORDER BY id')).rows,identities);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_ledger WHERE kind='initial_grant'")).rows[0].n,2);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_initial_grants')).rows[0].n,2);
 await f.pool.query('UPDATE identities SET archived_at=NULL WHERE id=$1',[archived]);assert.equal(await f.balance(archived),100);
},{legacy:true}));

test('concurrent restore and duplicate grant callbacks remain once-only across rename, account activation and archival cycles',options,async()=>fixture(async f=>{
 const id=await f.identity('student',true);
 await Promise.all(Array.from({length:8},()=>f.pool.query('UPDATE identities SET archived_at=NULL WHERE id=$1',[id])));
 await Promise.all(Array.from({length:8},()=>f.pool.query('SELECT luq_grant_initial($1)',[id])));
 const account=(await f.pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$2) RETURNING id',[id,randomUUID()])).rows[0].id;
 await f.pool.query('UPDATE accounts SET username=$2 WHERE id=$1',[account,randomUUID()]);
 await f.pool.query('UPDATE identities SET number=$2,name=$3,archived_at=now() WHERE id=$1',[id,randomUUID(),'Renamed stable student']);
 await f.pool.query('UPDATE identities SET archived_at=NULL WHERE id=$1',[id]);
 await assert.rejects(f.pool.query('UPDATE accounts SET identity_id=$2 WHERE id=$1',[account,await f.identity()]),/identity is immutable/);
 assert.equal(await f.balance(id),100);assert.equal((await f.entries(id)).length,1);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_initial_grants WHERE identity_id=$1',[id])).rows[0].n,1);
}));

test('batch import retries and transaction failures cannot duplicate or partially grant initial Luq',options,async()=>fixture(async f=>{
 const rows=Array.from({length:25},()=>({id:randomUUID(),number:randomUUID()}));
 const insert=()=>transaction(f.pool,async db=>{for(const item of rows)await db.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2) ON CONFLICT(id) DO UPDATE SET archived_at=NULL",[item.id,item.number]);});
 await insert();await Promise.all([insert(),insert()]);
 const grants=(await f.pool.query("SELECT count(*)::int n,sum(delta)::int amount FROM luq_ledger WHERE kind='initial_grant'")).rows[0];assert.deepEqual(grants,{n:25,amount:2500});
 const failedId=randomUUID();await assert.rejects(transaction(f.pool,async db=>{await db.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,'Rolled back')",[failedId,randomUUID()]);throw new Error('Simulated later roster validation failure');}),/Simulated/);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM identities WHERE id=$1',[failedId])).rows[0].n,0);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_initial_grants WHERE identity_id=$1',[failedId])).rows[0].n,0);
 assert.equal((await f.entries(failedId)).length,0);
}));

test('zero marks the allowance consumed, subsequent setting changes affect only new identities and cannot top up existing students',options,async()=>fixture(async f=>{
 await f.setAmount(0);const zero=await f.identity();assert.equal(await f.balance(zero),0);assert.equal((await f.entries(zero)).length,0);
 const claim=(await f.pool.query('SELECT amount,ledger_id FROM luq_initial_grants WHERE identity_id=$1',[zero])).rows[0];assert.deepEqual(claim,{amount:0,ledger_id:null});
 await f.setAmount(150);await f.pool.query('UPDATE identities SET archived_at=now() WHERE id=$1',[zero]);await f.pool.query('UPDATE identities SET archived_at=NULL WHERE id=$1',[zero]);
 assert.equal(await f.balance(zero),0);const newcomer=await f.identity();assert.equal(await f.balance(newcomer),150);
 await f.setAmount(50);await f.pool.query('SELECT luq_grant_initial($1)',[newcomer]);assert.equal(await f.balance(newcomer),150);
 assert.equal(await f.balance(await f.identity()),50);
}));

test('initial allowance settings are admin-only, range validated and versioned; routine account reads never grant again',options,async()=>fixture(async f=>{
 const adminIdentity=await f.identity('admin'),student=await f.identity();
 const adminId=(await f.pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$2) RETURNING id',[adminIdentity,randomUUID()])).rows[0].id;
 const admin={id:adminId,identityId:adminIdentity,roles:['admin']},user={identityId:student,roles:['student']};
 const request=(route,method,actor,body={})=>handleLuqLedger({pool:f.pool,route,method,user:actor,body,url:new URL('http://test'+route)});
 await assert.rejects(request('/luq/settings','PATCH',user,{initialGrant:999}),error=>error.code==='FORBIDDEN');
 for(const amount of [-1,100001,1.5])await assert.rejects(request('/luq/settings','PATCH',admin,{initialGrant:amount}),error=>error.code==='VALIDATION');
 const before=await getLuqSettings(f.pool),next=(await request('/luq/settings','PATCH',admin,{initialGrant:25})).body;
 assert.equal(next.initialGrant,25);assert.equal(next.ruleVersion,before.ruleVersion+1);
 const snapshot=(await f.pool.query('SELECT settings FROM luq_setting_versions WHERE rule_version=$1',[next.ruleVersion])).rows[0];assert.equal(snapshot.settings.initial_grant,25);
 for(let i=0;i<3;i++)assert.equal((await request('/luq/me','GET',user)).body.balance,100);
 assert.equal((await f.entries(student)).length,1);assert.equal(await f.balance(await f.identity()),25);
}));
