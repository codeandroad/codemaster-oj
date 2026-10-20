import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';

test('Luq production grants: application cannot overwrite balances and worker settles rewards without Luq privileges',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(qa|test)(_[a-z0-9_]+)?$/i.test(url.pathname),'Requires local test-only PostgreSQL');
 const manager=createPool(url.href),database=`campus_test_luq_roles_${randomBytes(5).toString('hex')}`;
 let pool,created=false;
 try{
  // Roles and this disposable database belong to the isolated test server.
  await manager.query(`DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='campus_app') THEN CREATE ROLE campus_app NOLOGIN; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='campus_worker') THEN CREATE ROLE campus_worker NOLOGIN; END IF;
  END $$`);
  await manager.query(`CREATE DATABASE ${database}`);created=true;
  url.pathname=`/${database}`;url.searchParams.delete('options');pool=createPool(url.href);await migrate(pool);
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../grants.mjs',import.meta.url))],{env:{...process.env,DATABASE_URL:url.href}});
  const teacher=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('teacher','T','T') RETURNING id")).rows[0].id;
  const account=(await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'role-teacher','not-a-login') RETURNING id",[teacher])).rows[0].id;
  const initialClient=await pool.connect();let student;
  try{await initialClient.query('BEGIN');await initialClient.query('SET LOCAL ROLE campus_app');student=(await initialClient.query("INSERT INTO identities(kind,number,name) VALUES('student','S','S') RETURNING id")).rows[0].id;await initialClient.query('COMMIT');}finally{initialClient.release();}
  assert.equal((await pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[student])).rows[0].balance,100,'identity trigger grants through the restricted application role');
  const studentAccount=(await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'role-student','not-a-login') RETURNING id",[student])).rows[0].id;
  const problem=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[account])).rows[0].id;
  const version=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,school_visible_at,rank_review_status,rank_approved_at)
   VALUES($1,'Roles','stdio','Text',1000,64,'print(1)',now(),now(),'approved',now()) RETURNING id`,[problem])).rows[0].id;
  async function asRole(role,sql,args=[]){const db=await pool.connect();try{await db.query('BEGIN');await db.query(`SET LOCAL ROLE ${role}`);const result=await db.query(sql,args);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
  await asRole('campus_app',"SELECT * FROM luq_post_entry($1,10,'admin_grant','role-grant',$2,'Grant','{}',NULL,NULL,NULL)",[student,account]);
  await assert.rejects(asRole('campus_app','UPDATE luq_accounts SET balance=999 WHERE identity_id=$1',[student]),e=>e.code==='42501');
  await assert.rejects(asRole('campus_app',"INSERT INTO luq_ledger(identity_id,delta,balance_after,kind,source_key,reason) VALUES($1,99,109,'admin_grant','direct','Denied')",[student]),e=>e.code==='42501');
  await assert.rejects(asRole('campus_app','DELETE FROM luq_ledger WHERE identity_id=$1',[student]),e=>e.code==='42501');
  for(const table of ['luq_accounts','luq_ledger','luq_initial_grants','luq_assistance_contents','luq_assistance_entitlements','luq_assistance_deliveries','problem_public_statements'])await assert.rejects(asRole('campus_worker',`SELECT * FROM ${table}`),e=>e.code==='42501');
  await asRole('campus_app',`INSERT INTO problem_public_statements(version_id,language,statement,metadata,source_hash,content_hash,author_account_id,reviewer_account_id)
   VALUES($1,'en','Reviewed English','{}',$2,$2,$3,$3)`,[version,'a'.repeat(64),account]);
  assert.equal((await asRole('campus_app','SELECT statement FROM problem_public_statements WHERE version_id=$1',[version])).rows[0].statement,'Reviewed English');
  await assert.rejects(asRole('campus_app',"UPDATE problem_public_statements SET statement='Changed' WHERE version_id=$1",[version]),e=>e.code==='42501');
  await assert.rejects(asRole('campus_app','DELETE FROM problem_public_statements WHERE version_id=$1',[version]),e=>e.code==='42501');
  await assert.rejects(asRole('campus_app','DELETE FROM luq_initial_grants WHERE identity_id=$1',[student]),e=>e.code==='42501');
  for(const role of ['campus_app','campus_worker'])await assert.rejects(asRole(role,'SELECT luq_grant_initial($1)',[student]),e=>e.code==='42501');
  await assert.rejects(asRole('campus_worker',"SELECT * FROM luq_post_entry($1,10,'admin_grant','worker-grant',$2,'Denied','{}',NULL,NULL,NULL)",[student,account]),e=>e.code==='42501');
  const submission=(await asRole('campus_app',`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','print(1)',$5,'roles') RETURNING id`,[studentAccount,student,problem,version,randomUUID()])).rows[0].id;
  await asRole('campus_worker',"UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[submission]);
  assert.equal((await asRole('campus_app','SELECT balance FROM luq_accounts WHERE identity_id=$1',[student])).rows[0].balance,114);
  assert.equal((await pool.query("SELECT sum(points)::int n FROM point_ledger WHERE identity_id=$1",[student])).rows[0].n,10);
  await assert.rejects(asRole('campus_app','UPDATE submissions SET luq_solution_assisted=true WHERE id=$1',[submission]),/immutable/);
 }finally{if(pool)await pool.end();if(created)await manager.query(`DROP DATABASE ${database}`);await manager.end();}
});
