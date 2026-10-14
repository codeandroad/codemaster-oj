import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Nest class leaderboard routes enforce scoped settings and redact hidden student fields',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`leaderboard_http_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const connection=new URL(process.env.TEST_DATABASE_URL);
  connection.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(connection.toString());
  let app;
  try {
   await migrate(pool);
   const password=randomBytes(20).toString('base64url');
   await bootstrap(pool,{name:'Admin',number:'ADMIN',username:'leaderboard-admin',password});
   const identityId=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,'Student') RETURNING id",[randomUUID()])).rows[0].id;
   const studentId=(await pool.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname)
    VALUES($1,'leaderboard-student',$2,'Coder') RETURNING id`,[identityId,await hashPassword(password)])).rows[0].id;
   await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[studentId]);
   const adminId=(await pool.query("SELECT id FROM accounts WHERE username='leaderboard-admin'")).rows[0].id;
   const classId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Class A',$1) RETURNING id",[adminId])).rows[0].id;
   await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,identityId]);
   app=await createApiApplication({databaseUrl:connection.toString(),logger:false,
    config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:'http://school.test',COOKIE_SECURE:'false'})});
   await app.listen(0,'127.0.0.1');
   const base=await app.getUrl();
   const request=async(path,{method='GET',body,auth,csrf=true}={})=>{
    const res=await fetch(base+path,{method,headers:{Origin:'http://school.test',
     ...(body!==undefined?{'Content-Type':'application/json'}:{}),
     ...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},
     ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
   };
   const login=async username=>{
    const response=await request('/api/v1/auth/login',{method:'POST',body:{username,password}});
    assert.equal(response.status,200);
    return {cookie:response.cookie,csrfToken:response.data.csrfToken};
   };
   const admin=await login('leaderboard-admin'),student=await login('leaderboard-student');
   const contexts='/api/v1/points/leaderboard/contexts';
   const settings=`${contexts}/${classId}`;
   assert.equal((await request(contexts)).status,401);
   const studentContext=await request(contexts,{auth:student});
   assert.equal(studentContext.status,200);
   assert.equal(studentContext.data.items[0].canManage,false);
   assert.equal(studentContext.data.items[0].visibleFields.attempts,false);
   const leaderboard=`/api/v1/points/leaderboard?classId=${classId}`;
   const before=await request(leaderboard,{auth:student});
   assert.equal(before.status,200);
   assert.equal(before.data.me.id,identityId);
   assert.equal(Object.hasOwn(before.data.me,'attempts'),false);
   const visibleFields={solvedProblems:true,attempts:true,acRate:false};
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:student})).status,403);
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:admin,csrf:false})).status,403);
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:admin})).status,200);
   const after=await request(leaderboard,{auth:student});
   assert.equal(after.status,200);
   assert.equal(after.data.me.attempts,0);
   assert.equal(Object.hasOwn(after.data.me,'acRate'),false);
   assert.equal(Object.hasOwn(after.data.me,'publicTag'),false);
  }finally{
   if(app)await app.close();
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
