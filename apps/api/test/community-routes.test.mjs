import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Nest profile routes preserve authentication, class access and CSRF for guestbook writes',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`community_http_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const connection=new URL(process.env.TEST_DATABASE_URL);
  connection.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(connection.toString());
  let app;
  try {
   await migrate(pool);
   const password=randomBytes(20).toString('base64url');
   await bootstrap(pool,{name:'Admin',number:'ADMIN',username:'community-admin',password});
   const hash=await hashPassword(password);
   async function student(number,nickname) {
    const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
     ['student',number,`LEGAL-${number}`])).rows[0].id;
    const id=(await pool.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname)
     VALUES($1,$2,$3,$4) RETURNING id`,[identityId,`community-${number}`,hash,nickname])).rows[0].id;
    await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[id]);
    return {id,identityId,username:`community-${number}`};
   }
   const alpha=await student('alpha','Alpha'),beta=await student('beta','Beta'),outsider=await student('outsider','Outside');
   const adminId=(await pool.query("SELECT id FROM accounts WHERE username='community-admin'")).rows[0].id;
   const classId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Class A',$1) RETURNING id",[adminId])).rows[0].id;
   for(const person of [alpha,beta])await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,person.identityId]);
   app=await createApiApplication({databaseUrl:connection.toString(),logger:false,
    config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:'http://school.test',COOKIE_SECURE:'false'})});
   await app.listen(0,'127.0.0.1');
   const base=await app.getUrl();
   const request=async(path,{method='GET',body,auth,csrf=true}={})=>{
    const res=await fetch(base+path,{method,headers:{Origin:'http://school.test',
     ...(body!==undefined?{'Content-Type':'application/json'}:{}),
     ...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{})},
     ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data=await res.json();
    return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
   };
   const login=async username=>{
    const r=await request('/api/v1/auth/login',{method:'POST',body:{username,password}});
    assert.equal(r.status,200);
    return {cookie:r.cookie,csrfToken:r.data.csrfToken};
   };
   const a=await login(alpha.username),b=await login(beta.username),o=await login(outsider.username),admin=await login('community-admin');
   const profile=`/api/v1/profiles/${alpha.identityId}`;
   assert.equal((await request(profile)).status,401);
   const visible=await request(profile,{auth:b});
   assert.equal(visible.status,200);
   assert.equal(visible.data.profile.nickname,'Alpha');
   assert.equal(JSON.stringify(visible.data).includes('LEGAL-alpha'),false);
   assert.equal((await request(profile,{auth:o})).status,404);
   assert.equal((await request(profile,{auth:admin})).status,200);
   assert.equal((await request(`${profile}/activity`,{auth:b})).status,200);
   const messages=`${profile}/messages`;
   assert.equal((await request(messages,{auth:b})).status,200);
   assert.equal((await request(messages,{method:'POST',body:{body:'Hi'},auth:b,csrf:false})).status,403);
   assert.equal((await request(messages,{method:'POST',body:{body:'Hi'},auth:o})).status,404);
   const posted=await request(messages,{method:'POST',body:{body:'Great work'},auth:b});
   assert.equal(posted.status,201,JSON.stringify(posted.data));
   assert.equal(posted.data.author.nickname,'Beta');
   assert.equal((await request(`${messages}/${posted.data.id}/report`,{method:'POST',body:{reason:'spam'},auth:a})).status,200);
   const ownerMessages=await request(messages,{auth:a});
   assert.equal(ownerMessages.data.items[0].reportedByMe,true);
   assert.equal(ownerMessages.data.items[0].canDelete,true);
   assert.equal(ownerMessages.data.items[0].canReport,false);
   assert.equal((await request(`${profile}/message-reports`,{auth:admin})).status,200);
   assert.equal((await request('/api/v1/profile-message-reports',{auth:b})).status,403);
   const reports=await request('/api/v1/profile-message-reports',{auth:admin});
   assert.equal(reports.status,200);
   assert.equal(reports.data.items[0].profileIdentityId,alpha.identityId);
   assert.equal(reports.data.items[0].profileAvailable,true);
   assert.equal(reports.data.items[0].authorNickname,'Beta');
   assert.equal(reports.data.items[0].deleted,false);
   assert.equal(reports.data.items[0].status,'pending');
   assert.equal(reports.data.counts.pending,1);
   const dismissPath=`/api/v1/profile-message-reports/${reports.data.items[0].id}/dismiss`;
   assert.equal((await request(dismissPath,{method:'POST',auth:b})).status,403);
   assert.equal((await request(dismissPath,{method:'POST',auth:admin,csrf:false})).status,403);
   const dismissed=await request(dismissPath,{method:'POST',auth:admin});
   assert.equal(dismissed.status,200);
   assert.deepEqual(dismissed.data,{ok:true,status:'dismissed'});
   assert.equal((await request('/api/v1/profile-message-reports',{auth:admin})).data.total,0);
   assert.equal((await request('/api/v1/profile-message-reports?status=dismissed',{auth:admin})).data.items[0].status,'dismissed');
   await pool.query('UPDATE accounts SET disabled_at=now() WHERE id=$1',[alpha.id]);
   assert.equal((await request(profile,{auth:b})).status,404);
   assert.equal((await request(`${messages}/${posted.data.id}`,{method:'DELETE',auth:o})).status,404);
   assert.equal((await request(`${messages}/${posted.data.id}`,{method:'DELETE',auth:b})).status,404);
   assert.equal((await request(`${messages}/${posted.data.id}`,{method:'DELETE',auth:admin})).status,200);
   const deleted=(await request('/api/v1/profile-message-reports?status=deleted',{auth:admin})).data.items[0];
   assert.equal(deleted.deleted,true);
   assert.equal(deleted.status,'deleted');
   assert.equal(deleted.profileAvailable,false);
   const times=(await pool.query(`SELECT r.resolution,r.resolved_at,m.deleted_at
    FROM student_guestbook_reports r JOIN student_guestbook_messages m ON m.id=r.message_id
    WHERE r.id=$1`,[deleted.id])).rows[0];
   assert.equal(times.resolution,'delete');
   assert.equal(times.resolved_at.getTime(),times.deleted_at.getTime());
  }finally{
   if(app)await app.close();
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
