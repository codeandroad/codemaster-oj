import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('identity deletion is admin-only, recoverable, atomic and serialized with activation',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async()=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`identity_delete_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.toString());let app;
 try{
  await migrate(pool);
  const adminPassword=randomBytes(24).toString('base64url');
  await bootstrap(pool,{name:'QA administrator',number:'ADMIN',username:'delete-admin',password:adminPassword});
  app=await createApiApplication({databaseUrl:connection.toString(),logger:false,
   config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:'http://school.test',COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const request=async(path,{method='GET',body,auth,csrf=true}={})=>{
   const response=await fetch(`${base}/api/v1${path}`,{method,headers:{Origin:'http://school.test',
    ...(body===undefined?{}:{'Content-Type':'application/json'}),...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};
  };
  const admin=await request('/auth/login',{method:'POST',body:{username:'delete-admin',password:adminPassword}});assert.equal(admin.status,200);
  const create=async(kind,number,classIds=[])=>{
   const result=await request('/people',{method:'POST',auth:admin,body:{kind,number,name:`QA ${number}`,classIds}});
   assert.equal(result.status,201,JSON.stringify(result.data));return result.data;
  };
  const claim=async(record,username)=>request('/auth/register',{method:'POST',body:{kind:record.person.kind,number:record.person.number,
   name:record.person.name,activationCode:record.activationCode,username,password:randomBytes(24).toString('base64url')}});
  const target=record=>`/people/${record.person.id}`;
  const remove=(record,auth=admin,extra={})=>request(target(record),{method:'DELETE',auth,body:{name:record.person.name,number:record.person.number},...extra});
  const teacherRecord=await create('teacher','TEACHER');const teacher=await claim(teacherRecord,'delete-teacher');assert.equal(teacher.status,201);
  const studentRecord=await create('student','STUDENT');const student=await claim(studentRecord,'delete-student');assert.equal(student.status,201);
  const cls=await request('/classes',{method:'POST',auth:admin,body:{name:'Deletion QA class'}});assert.equal(cls.status,201);
  const pending=await create('student','PENDING',[cls.data.id]);
  assert.equal(pending.person.canDelete,true);
  const beforeLuq=(await pool.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id',[pending.person.id])).rows;
  assert.equal(beforeLuq.length,1);assert.equal(beforeLuq[0].delta,100);
  assert.equal((await remove(pending,null)).status,401);
  assert.equal((await remove(pending,teacher)).status,403);
  assert.equal((await remove(pending,student)).status,403);
  assert.equal((await remove(pending,admin,{csrf:false})).status,403);
  assert.equal((await request('/people?deleted=true',{auth:teacher})).status,403);
  assert.equal((await request(`${target(pending)}/restore`,{method:'POST',auth:teacher,body:{}})).status,403);
  assert.equal((await request(`${target(pending)}/restore`,{method:'POST',auth:admin,body:{},csrf:false})).status,403);
  assert.equal((await request('/people/not-a-uuid',{method:'DELETE',auth:admin,body:{}})).status,400);
  assert.equal((await request(`/people/${randomUUID()}`,{method:'DELETE',auth:admin,body:{}})).status,404);
  const protectedAdmin=await request(`/people/${admin.data.user.identityId}`,{method:'DELETE',auth:admin,body:{name:'QA administrator',number:'ADMIN'}});
  assert.equal(protectedAdmin.data.error.code,'IDENTITY_PROTECTED');
  assert.equal((await remove(studentRecord)).data.error.code,'IDENTITY_HAS_ACCOUNT');
  // An unbound historical account is still protected.
  await request(`${target(studentRecord)}/unbind`,{method:'POST',auth:admin,body:{}});
  assert.equal((await remove(studentRecord)).data.error.code,'IDENTITY_HAS_ACCOUNT');
  // A stale confirmation must not delete a renamed identity.
  assert.equal((await request(target(pending),{method:'PATCH',auth:admin,body:{name:'QA renamed'}})).status,200);
  assert.equal((await remove(pending)).data.error.code,'IDENTITY_CHANGED');pending.person.name='QA renamed';
  // Failure at the audit append rolls back both visibility and token revocation.
  await pool.query(`CREATE FUNCTION fail_delete_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='identity.delete' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER fail_delete_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_delete_audit()');
  assert.equal((await remove(pending)).status,500);
  assert.equal((await pool.query('SELECT archived_at FROM identities WHERE id=$1',[pending.person.id])).rows[0].archived_at,null);
  assert.equal((await pool.query('SELECT 1 FROM activation_tokens WHERE identity_id=$1',[pending.person.id])).rowCount,1);
  await pool.query('DROP TRIGGER fail_delete_audit ON audit_events');
  const deletes=await Promise.all([remove(pending),remove(pending)]);assert.deepEqual(deletes.map(r=>r.status),[200,200]);
  assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE action='identity.delete' AND resource_id=$1",[pending.person.id])).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM activation_tokens WHERE identity_id=$1',[pending.person.id])).rowCount,0);
  assert.equal((await request('/people',{auth:admin})).data.items.some(p=>p.id===pending.person.id),false);
  assert.equal((await request('/people?deleted=true',{auth:admin})).data.items.some(p=>p.id===pending.person.id&&p.deletedAt),true);
  assert.equal((await request('/classes',{auth:admin})).data.items.find(c=>c.id===cls.data.id).studentIds.includes(pending.person.id),false);
  assert.equal((await claim(pending,'deleted-claim')).data.error.code,'CLAIM_FAILED');
  assert.equal((await request(`${target(pending)}/activation`,{method:'POST',auth:admin,body:{}})).status,404);
  assert.equal((await request(target(pending),{method:'PATCH',auth:admin,body:{name:'hidden edit'}})).status,404);
  const duplicate=await request('/people',{method:'POST',auth:admin,body:{kind:'student',number:'PENDING',name:'different'}});
  assert.equal(duplicate.data.error.code,'IDENTITY_DELETED');
  const restored=await Promise.all([request(`${target(pending)}/restore`,{method:'POST',auth:admin,body:{}}),request(`${target(pending)}/restore`,{method:'POST',auth:admin,body:{}})]);
  assert.deepEqual(restored.map(r=>r.status),[200,200]);
  assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE action='identity.restore' AND resource_id=$1",[pending.person.id])).rowCount,1);
  assert.deepEqual((await pool.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id',[pending.person.id])).rows,beforeLuq,'restoring must not grant Luq again');
  assert.equal((await request('/classes',{auth:admin})).data.items.find(c=>c.id===cls.data.id).studentIds.includes(pending.person.id),true);
  assert.equal((await claim(pending,'restored-old-code')).data.error.code,'CLAIM_FAILED');
  const newCode=await request(`${target(pending)}/activation`,{method:'POST',auth:admin,body:{}});assert.equal(newCode.status,200);
  pending.activationCode=newCode.data.activationCode;
  assert.equal((await claim(pending,'restored-new-code')).status,201);
  assert.equal((await remove(pending)).data.error.code,'IDENTITY_HAS_ACCOUNT');
  // Pending teacher records follow the same recycle/restore rules.
  const pendingTeacher=await create('teacher','PENDING-TEACHER',[cls.data.id]);
  assert.equal((await remove(pendingTeacher)).status,200);
  assert.equal((await request(`${target(pendingTeacher)}/restore`,{method:'POST',auth:admin,body:{}})).data.classes[0].id,cls.data.id);
  // Concurrent activation and deletion cannot produce an archived login identity.
  const racing=await create('student','RACE');
  const [claimed,deleted]=await Promise.all([claim(racing,'race-student'),remove(racing)]);
  assert.ok(claimed.status===201&&deleted.status===409||claimed.status===400&&deleted.status===200,JSON.stringify({claimed:claimed.status,deleted:deleted.status}));
  assert.equal((await pool.query('SELECT 1 FROM identities i JOIN accounts a ON a.identity_id=i.id WHERE i.id=$1 AND i.archived_at IS NOT NULL',[racing.person.id])).rowCount,0);
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
