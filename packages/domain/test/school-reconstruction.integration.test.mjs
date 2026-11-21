import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { schoolRole } from '../src/schools.mjs';

test('single-school upgrade keeps platform money, creates ordinary memberships and preserves revocation', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
 const base=new URL(process.env.TEST_DATABASE_URL);
 assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(base.href),schema='school_upgrade_'+randomBytes(6).toString('hex');
 base.searchParams.set('options','-csearch_path='+schema);
 const db=createPool(base.href);
 try{
  await manager.query('CREATE SCHEMA '+schema);
  await migrate(db,{through:'132_school_activity_grading_context.sql'});
  const school=(await db.query("SELECT id FROM schools WHERE slug='tianxing-chuangshiji'")).rows[0].id;
  const {person,account}=await transaction(db,async client=>{
   const person=(await client.query("INSERT INTO identities(kind,number,name) VALUES('student','u001','Upgrade learner') RETURNING id")).rows[0].id;
   const account=(await client.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'upgrade.learner','disabled') RETURNING id",[person])).rows[0].id;
   await client.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[account]);
   await client.query('SELECT luq_grant_initial($1)',[person]);
   return {person,account};
  });
  const money=()=>db.query('SELECT * FROM luq_accounts WHERE identity_id=$1',[person]).then(r=>r.rows);
  const entries=()=>db.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id',[person]).then(r=>r.rows);
  const before=await money(),ledger=await entries();
  assert.ok(before[0].balance>0);assert.ok(ledger.length);
  await migrate(db);await migrate(db);
  assert.deepEqual(await money(),before);assert.deepEqual(await entries(),ledger);
  assert.equal((await db.query('SELECT balance FROM school_scholarship_accounts WHERE school_id=$1 AND identity_id=$2',[school,person])).rows[0].balance,0);
  assert.equal((await db.query('SELECT count(*) FROM school_scholarship_ledger WHERE school_id=$1',[school])).rows[0].count,'0');
  assert.equal(await schoolRole(db,school,account),'student');
  const another=randomUUID();
  await db.query("INSERT INTO schools(id,slug,name) VALUES($1,'another-campus','Another campus')",[another]);
  await assert.rejects(schoolRole(db,another,account),{status:404});
  await db.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2',[school,account]);
  await assert.rejects(schoolRole(db,school,account),{status:404});
  assert.deepEqual(await money(),before);
  assert.equal((await db.query("SELECT to_regclass('account_roles') retired")).rows[0].retired,null);
  assert.equal((await db.query('SELECT count(*) FROM schools WHERE id IN (SELECT id FROM practice_storage_scopes WHERE school_id IS NULL)')).rows[0].count,'0');
 }finally{await db.end();await manager.query('DROP SCHEMA '+schema+' CASCADE');await manager.end();}
});
