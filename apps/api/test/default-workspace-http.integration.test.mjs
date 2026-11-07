import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('default school preferences persist per account without extending workspace authorization',
 { skip: !process.env.TEST_DATABASE_URL, timeout: 90000 }, async t => {
  const baseUrl=new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
  assert.match(baseUrl.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const manager=createPool(baseUrl.href),schema='default_workspace_'+randomBytes(6).toString('hex');
  const schemaUrl=new URL(baseUrl.href);schemaUrl.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(schemaUrl.href);
  let app,worker,created=false;
  try {
   await manager.query(`CREATE SCHEMA ${schema}`);created=true;
   // Existing account rows must survive the additive migration untouched.
   await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
   await pool.query("INSERT INTO schema_migrations(name) VALUES('063_account_default_school.sql')");
   await migrate(pool);
   const password=randomBytes(24).toString('base64url'),hash=await hashPassword(password);
   const legacyId=await bootstrap(pool,{name:'Legacy admin',number:'ADM',username:'legacy-admin',password});
   const accounts={};
   for(const login of ['alpha-admin','beta-admin','teacher','student','visitor','platform-user','invalid-account']) {
    accounts[login]=await transaction(pool,async db=>{
     const {rows:[identity]}=await db.query("INSERT INTO identities(kind,number,name) VALUES('personal',$1,$1) RETURNING id",[login]);
     return (await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id,identity_id',[identity.id,login,hash])).rows[0];
    });
   }
   const alpha=await provisionSchool(pool,{slug:'preference-alpha',name:'Alpha',adminUsername:'alpha-admin'});
   const beta=await provisionSchool(pool,{slug:'preference-beta',name:'Beta',adminUsername:'beta-admin'});
   for(const role of ['teacher','student']) await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[alpha.id,accounts[role].id,role]);
   await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[beta.id,accounts.student.id]);
   await provisionPlatformAdministrator(pool,{username:'platform-user'});
   const before=(await pool.query('SELECT * FROM accounts ORDER BY id')).rows;
   await pool.query("DELETE FROM schema_migrations WHERE name='063_account_default_school.sql'");
   await migrate(pool);
   const after=(await pool.query('SELECT * FROM accounts ORDER BY id')).rows;
   assert.ok(after.every(a=>a.default_school_id===null));
   assert.deepEqual(after.map(({default_school_id,...a})=>a),before);

   // Run the actual HTTP application using the same restricted grants as a
   // deployment, not the migration owner's database connection.
   const grantSource=await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8');
   const grantSql=grantSource.match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];assert.ok(grantSql);
   await pool.query(grantSql.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
   const runtimeUrl=new URL(baseUrl.href);
   runtimeUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
   runtimeUrl.searchParams.set('application_name',schema);
   const origin='http://default-workspace.test';
   app=await createApiApplication({databaseUrl:runtimeUrl.href,logger:false,
    config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
   await app.listen(0,'127.0.0.1');const base=await app.getUrl();
   async function request(path,{method='GET',body,auth,csrf=true,status=200,requestOrigin=origin}={}) {
    const response=await fetch(base+'/api/v1'+path,{method,headers:{Origin:requestOrigin,
     ...(body!==undefined&&{'Content-Type':'application/json'}),
     ...(auth&&{Cookie:auth.cookie,...(csrf&&{'X-CSRF-Token':auth.csrfToken})})},
     body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();
    assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${path}: ${response.status} ${JSON.stringify(data.error??{})}`);
    return {data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
   }
   async function login(username) {
    const r=await request('/auth/login',{method:'POST',body:{username,password}});
    return {...r.data,cookie:r.cookie};
   }
   const auth={};for(const loginName of ['legacy-admin',...Object.keys(accounts)])auth[loginName]=await login(loginName);
   const path='/auth/default-workspace';
   const save=(actor,defaultSchoolId,options={})=>request(path,{method:'PATCH',auth:auth[actor],body:{defaultSchoolId},...options});
   const effective=async actor=>(await request(path,{auth:auth[actor]})).data.defaultSchoolId;

   await t.test('the preference starts empty and requires self-service authentication and CSRF',async()=>{
    await request(path,{status:401});
    await request(path,{method:'PATCH',body:{defaultSchoolId:alpha.id},status:401});
    assert.deepEqual((await request(path,{auth:auth.student})).data,{defaultSchoolId:null});
    assert.equal(auth.student.user.defaultSchoolId,null);
    await save('student',alpha.id,{csrf:false,status:403});
    await save('student',alpha.id,{requestOrigin:'http://foreign.test',status:403});
    for(const body of [{},{defaultSchoolId:''},{defaultSchoolId:123},{defaultSchoolId:'bad-id'},
     {defaultSchoolId:alpha.id,accountId:accounts.visitor.id},{defaultSchoolId:alpha.id,role:'school_admin'}]) {
     await request(path,{method:'PATCH',auth:auth.student,body,status:400});
    }
    assert.equal(await effective('student'),null);
   });

   await t.test('students, teachers and school administrators save their own joined school across sessions',async()=>{
    const memberships=(await pool.query('SELECT * FROM school_memberships ORDER BY school_id,account_id')).rows;
    for(const actor of ['student','teacher','alpha-admin']) {
     assert.deepEqual((await save(actor,alpha.id)).data,{defaultSchoolId:alpha.id});
     assert.equal(await effective(actor),alpha.id);
     assert.equal((await request('/auth/me',{auth:auth[actor]})).data.user.defaultSchoolId,alpha.id);
     const secondDevice=await login(actor);
     assert.equal(secondDevice.user.defaultSchoolId,alpha.id);
     assert.equal((await request(path,{auth:secondDevice})).data.defaultSchoolId,alpha.id);
    }
    await request('/auth/profile',{method:'PATCH',auth:auth.student,body:{nickname:'QA student'}});
    assert.equal((await request('/auth/me',{auth:auth.student})).data.user.defaultSchoolId,alpha.id);
    assert.deepEqual((await pool.query('SELECT * FROM school_memberships ORDER BY school_id,account_id')).rows,memberships);
    assert.deepEqual((await request('/auth/me',{auth:auth.student})).data.user.roles,[]);
    await request(`/schools/${alpha.id}/members`,{auth:auth.student,status:403});
    await request('/accounts',{auth:auth.student,status:403});
    await save('student',beta.id);assert.equal(await effective('teacher'),alpha.id);
    await save('student',null);assert.equal(await effective('student'),null);
    assert.equal((await pool.query('SELECT default_school_id FROM accounts WHERE id=$1',[accounts.student.id])).rows[0].default_school_id,null);
   });

   await t.test('foreign schools and platform capabilities do not grant school membership',async()=>{
    const unknown=randomUUID();
    for(const actor of ['visitor','platform-user'])for(const schoolId of [alpha.id,LEGACY_SCHOOL_ID,unknown]) {
     const denied=await save(actor,schoolId,{status:404});assert.equal(denied.data.error.code,'NOT_FOUND');
    }
    await save('teacher',beta.id,{status:404});assert.equal(await effective('teacher'),alpha.id);
    await save('legacy-admin',LEGACY_SCHOOL_ID);assert.equal(await effective('legacy-admin'),LEGACY_SCHOOL_ID);
    await save('legacy-admin',alpha.id,{status:404});
    // Even a valid preference is only navigation: it never replaces the
    // independent platform capability that the client prioritizes on login.
    await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[alpha.id,accounts['platform-user'].id]);
    await save('platform-user',alpha.id);
    const platform=await login('platform-user');
    assert.equal(platform.user.platformAdmin,true);assert.equal(platform.user.defaultSchoolId,alpha.id);
    assert.deepEqual(platform.user.roles,[]);
    await request(`/schools/${alpha.id}/members`,{auth:platform,status:403});
    await request('/platform/schools',{auth:platform});
   });

   await t.test('a membership revoked during a preference write cannot leave an effective default',async()=>{
    const blocker=await pool.connect();let pending;
    try {
     await blocker.query('BEGIN');
     await blocker.query('UPDATE school_memberships SET revoked_at=clock_timestamp() WHERE school_id=$1 AND account_id=$2',[alpha.id,accounts.teacher.id]);
     pending=save('teacher',alpha.id,{status:404});
     let waiting=false;
     for(let retry=0;retry<100;retry++) {
      waiting=(await manager.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'
       AND query LIKE 'SELECT m.account_id FROM school_memberships%'`,[schema])).rowCount>0;
      if(waiting)break;await delay(10);
     }
     assert.ok(waiting,'the preference update waits for the conflicting membership revoke');
     await blocker.query('COMMIT');await pending;
    } finally {await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
    assert.equal(await effective('teacher'),null);
    assert.equal((await request('/auth/me',{auth:auth.teacher})).data.user.defaultSchoolId,null);
    assert.equal((await login('teacher')).user.defaultSchoolId,null);
    await request(`/schools/${alpha.id}/members`,{auth:auth.teacher,status:404});
    await save('teacher',null);
    // Simultaneous device updates serialize successfully, without a lock
    // upgrade deadlock or changes to other accounts' preferences.
    const choices=await Promise.all([alpha.id,beta.id,null].map(id=>save('student',id)));
    assert.ok(choices.every(r=>r.status===200));
    assert.ok([alpha.id,beta.id,null].includes(await effective('student')));
    assert.equal(await effective('alpha-admin'),alpha.id);
   });

   await t.test('missing legacy roles, removed schools and inactive accounts fail closed',async()=>{
    await pool.query("DELETE FROM account_roles WHERE account_id=$1 AND role='admin'",[legacyId]);
    assert.equal(await effective('legacy-admin'),null);
    await save('legacy-admin',LEGACY_SCHOOL_ID,{status:404});
    const {rows:[temporary]}=await pool.query("INSERT INTO schools(slug,name) VALUES('temporary-preference','Temporary') RETURNING id");
    await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[temporary.id,accounts.visitor.id]);
    await save('visitor',temporary.id);
    await pool.query('DELETE FROM school_memberships WHERE school_id=$1',[temporary.id]);
    await pool.query('DELETE FROM schools WHERE id=$1',[temporary.id]);
    assert.equal(await effective('visitor'),null);
    assert.equal((await pool.query('SELECT default_school_id FROM accounts WHERE id=$1',[accounts.visitor.id])).rows[0].default_school_id,null);
    for(const [table,column,id] of [['accounts','disabled_at',accounts['invalid-account'].id],
     ['accounts','binding_released_at',accounts['invalid-account'].id],['identities','archived_at',accounts['invalid-account'].identity_id]]) {
     await pool.query(`UPDATE ${table} SET ${column}=clock_timestamp() WHERE id=$1`,[id]);
     await request(path,{auth:auth['invalid-account'],status:401});
     await save('invalid-account',null,{status:401});
     await pool.query(`UPDATE ${table} SET ${column}=NULL WHERE id=$1`,[id]);
    }
    const workerUrl=new URL(baseUrl.href);workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
    worker=createPool(workerUrl.href);
    await assert.rejects(worker.query('SELECT default_school_id FROM accounts'),{code:'42501'});
    await assert.rejects(worker.query('UPDATE accounts SET default_school_id=NULL'),{code:'42501'});
   });
  } finally {
   await app?.close();await worker?.end();await pool.end();
   if(created)await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
  }
 });
