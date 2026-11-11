import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { problemPermissions } from '../src/library.mjs';
import { liveProblemVersionIdSql, resolveLiveProblemVersion, assertLiveProblemVersion } from '../src/live-problem-version.mjs';

test('one live teaching definition preserves approval, activity authorization and publication locks', {
 skip: !process.env.TEST_DATABASE_URL, timeout: 60000,
}, async () => {
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`live_problem_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);
 try {
  await migrate(pool);
  await bootstrap(pool,{name:'Live administrator',number:'LIVE-ADMIN',username:'live-admin',password:randomBytes(24).toString('base64url')});
  const {rows:[admin]}=await pool.query("SELECT id FROM accounts WHERE username='live-admin'");
  const {rows:[bank]}=await pool.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES('Private teaching',$1,'private') RETURNING id",[admin.id]);
  const {rows:[school]}=await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING *',[admin.id]);
  const {rows:[privateProblem]}=await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING *',[admin.id,bank.id]);
  async function version(problemId,{published=true,approved=false,title='Current exercise'}={}) {
   const {rows:[v]}=await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,
    validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at)
    VALUES($1,$2,'stdio','Print the stated value.',500,64,'print(5)','AC',
     CASE WHEN $3 THEN clock_timestamp() END,CASE WHEN $4 THEN clock_timestamp() END,
     CASE WHEN $4 THEN 'approved' ELSE 'pending' END,CASE WHEN $4 THEN clock_timestamp() END) RETURNING *`,[problemId,title,published,approved]);
   return v;
  }
  const approved=await version(school.id,{approved:true}),pending=await version(school.id),draft=await version(school.id,{published:false});
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[school.id,pending.id]);
  assert.equal((await resolveLiveProblemVersion(pool,school.id,{lock:false})).id,approved.id,'an approved exercise survives both a pending replacement and a saved draft');
  assert.equal((await pool.query(`SELECT ${liveProblemVersionIdSql('p')} id FROM problems p WHERE p.id=$1`,[school.id])).rows[0].id,approved.id,'list and transaction resolvers agree');
  assert.throws(()=>assertLiveProblemVersion(draft.id,approved.id),error=>error.status===409&&error.code==='PROBLEM_UPDATED');
  assert.doesNotThrow(()=>assertLiveProblemVersion(approved.id,approved.id));

  const original=await version(privateProblem.id),current=await version(privateProblem.id),privateDraft=await version(privateProblem.id,{published:false});
  await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[privateProblem.id,current.id]);
  assert.equal((await resolveLiveProblemVersion(pool,privateProblem.id,{lock:false})).id,current.id,'private teaching publication does not require school public approval');
  const {rows:[identity]}=await pool.query("INSERT INTO identities(kind,name,number) VALUES('student','Assigned learner','LIVE-STUDENT') RETURNING id");
  const student={id:randomUUID(),identityId:identity.id,roles:['student']};
  assert.equal((await problemPermissions(pool,student,privateProblem,current)).canRead,false,'publication alone grants no access to a private exercise');
  const {rows:[assignment]}=await pool.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Live assignment',$1,now()+interval '1 hour','Draft') RETURNING id",[admin.id]);
  await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,20,0)',[assignment.id,privateProblem.id,original.id]);
  await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,identity.id]);
  await pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[assignment.id]);
  assert.equal((await problemPermissions(pool,student,privateProblem,current)).canRead,true,'activity membership authorizes the current exercise despite its historical pin');
  assert.equal((await problemPermissions(pool,student,privateProblem,privateDraft)).canRead,false,'the same membership never grants authoring drafts');
  assert.equal((await problemPermissions(pool,student,privateProblem,original)).canRead,true,'the original assigned snapshot remains available for history');

  await transaction(pool,async db=>{
   assert.equal((await resolveLiveProblemVersion(db,privateProblem.id)).id,current.id);
   const competing=await pool.connect();
   try {
    await competing.query('BEGIN');
    await competing.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(competing.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[privateProblem.id,original.id]),error=>error.code==='55P03','publication cannot replace the selected definition before the submission transaction commits');
   } finally {await competing.query('ROLLBACK');competing.release();}
  });
  await pool.query('UPDATE problems SET archived_at=now() WHERE id=$1',[privateProblem.id]);
  await assert.rejects(resolveLiveProblemVersion(pool,privateProblem.id,{lock:false}),error=>error.status===404,'archival prevents new execution');
  assert.equal((await resolveLiveProblemVersion(pool,privateProblem.id,{lock:false,allowArchived:true})).id,current.id,'authorized historical activity views can still resolve their content');
  assert.equal((await pool.query('SELECT version_id FROM assignment_problems WHERE assignment_id=$1',[assignment.id])).rows[0].version_id,original.id,'normal resolution never mutates the assignment audit pin');
 } finally {
  await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
