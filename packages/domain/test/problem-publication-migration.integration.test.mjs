import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';

test('publication requests keep the source school, edition and decision through migration', { skip: !process.env.TEST_DATABASE_URL }, async () => {
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.match(url.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(url.href),schema='publication_upgrade_'+randomBytes(6).toString('hex');
 url.searchParams.set('options','-csearch_path='+schema);
 const pool=createPool(url.href);
 try {
  await manager.query('CREATE SCHEMA '+schema);
  await migrate(pool,{through:'129_problem_bank_scope.sql'});
  const sourceSchool='00000000-0000-4000-8000-000000000052';
  const nativeSchool=randomUUID(),account=randomUUID(),nativeEdition=randomUUID(),sourceEditions=[randomUUID(),randomUUID()];
  await transaction(pool,async db=>{
   const identity=(await db.query("INSERT INTO identities(kind,name,number) VALUES('teacher','Teacher','1') RETURNING id")).rows[0];
   await db.query("INSERT INTO accounts(id,identity_id,username,password_hash) VALUES($1,$2,'teacher','disabled')",[account,identity.id]);
   await db.query("INSERT INTO schools(id,slug,name) VALUES($1,'native','Native')",[nativeSchool]);
   await db.query("SELECT set_config('campus.school_id',$1,true)",[nativeSchool]);
   await db.query("INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,request_id) VALUES($1,$2,$3,'Bank',$2)",[nativeSchool,nativeEdition,account]);
   await db.query("INSERT INTO school_problems(school_id,id,owner_account_id,bank_id,draft,request_id) VALUES($1,$2,$3,$2,'{}',$2)",[nativeSchool,nativeEdition,account]);
   await db.query("INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) VALUES($1,$2,$2,1,'{}')",[nativeSchool,nativeEdition]);
   await db.query("INSERT INTO school_problem_publication_requests(school_id,problem_id,version_id,requested_by,requested_at) VALUES($1,$2,$2,$3,'2026-01-01Z')",[nativeSchool,nativeEdition,account]);
   await db.query("SELECT set_config('campus.school_id',$1,true)",[sourceSchool]);
   for (const [index,id] of sourceEditions.entries()) {
    await db.query('INSERT INTO problems(id,owner_account_id) VALUES($1,$2)',[id,account]);
    await db.query("INSERT INTO problem_versions(id,problem_id,title,mode,statement,reference_code,time_limit_ms,memory_limit_mb) VALUES($1,$1,'Sum','stdio','Add.','',1000,128)",[id]);
    await db.query(`INSERT INTO legacy_public_problem_requests(problem_id,version_id,requested_by,requested_at,status,decided_by,decided_at)
     VALUES($1,$1,$2,'2026-01-02Z',$3,$4,$5)`,[id,account,index?'rejected':'pending',index?account:null,index?'2026-01-03Z':null]);
   }
  });
  await migrate(pool);await migrate(pool);
  const {rows}=await pool.query('SELECT * FROM school_problem_publication_requests ORDER BY requested_at,status');
  assert.deepEqual(rows.map(r=>[r.school_id,r.problem_id,r.version_id,r.catalog_version_id,r.school_version_id,r.status,r.requested_by,r.requested_at.toISOString().slice(0,10),r.decided_by,r.decided_at?.toISOString().slice(0,10)]),[
   [nativeSchool,nativeEdition,nativeEdition,null,nativeEdition,'pending',account,'2026-01-01',null,undefined],
   [sourceSchool,sourceEditions[0],sourceEditions[0],sourceEditions[0],null,'pending',account,'2026-01-02',null,undefined],
   [sourceSchool,sourceEditions[1],sourceEditions[1],sourceEditions[1],null,'rejected',account,'2026-01-02',account,'2026-01-03'],
  ]);
  assert.equal((await pool.query("SELECT to_regclass('legacy_public_problem_requests') old")).rows[0].old,null);
  assert.equal((await pool.query('SELECT count(*) FROM school_problem_versions')).rows[0].count,'1');
  await assert.rejects(pool.query('UPDATE school_problem_publication_requests SET school_id=$1 WHERE version_id=$2',[nativeSchool,sourceEditions[0]]),{code:'23503'});
  await assert.rejects(pool.query('UPDATE school_problem_publication_requests SET catalog_version_id=$1,version_id=$1 WHERE problem_id=$2',[sourceEditions[1],sourceEditions[0]]),{code:'23503'});
 } finally {
  await pool.end();
  await manager.query('DROP SCHEMA '+schema+' CASCADE');
  await manager.end();
 }
});
