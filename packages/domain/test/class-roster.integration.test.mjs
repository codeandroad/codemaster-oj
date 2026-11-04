import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';
import {handleClassHub} from '../src/activity-audience.mjs';
import {defaultAvatarPath} from '../src/avatars.mjs';

test('class roster exposes only public active classmates and checks current membership over HTTP',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`class_roster_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const database=new URL(process.env.TEST_DATABASE_URL);database.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(database.href);let server;
 try{
  await migrate(pool);
  const password=`Roster-${randomUUID()}!`,adminUsername=randomUUID();
  await bootstrap(pool,{name:'Roster administrator',number:randomUUID(),username:adminUsername,password});
  const adminAccount=(await pool.query('SELECT id,password_hash FROM accounts WHERE username=$1',[adminUsername])).rows[0];
  async function person(name,{nickname='',useNickname=false,kind='student',role=kind,activated=true}={}){
   const identity=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',[kind,`PRIVATE-NUMBER-${randomUUID()}`,name])).rows[0];
   const user={identityId:identity.id,name,roles:[role],username:randomUUID()};
   if(activated){
    user.id=(await pool.query(`INSERT INTO accounts(identity_id,username,password_hash,email,nickname,leaderboard_use_nickname,bio)
     VALUES($1,$2,$3,$4,$5,$6,'PRIVATE-BIO') RETURNING id`,[identity.id,user.username,adminAccount.password_hash,`${randomUUID()}@private.invalid`,nickname,useNickname])).rows[0].id;
    await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[user.id,role]);
   }
   return user;
  }
  const viewer=await person('Viewer'),real=await person('Alice Real',{nickname:'UNSELECTED-NICKNAME'}),alias=await person('HIDDEN-LEGAL-NAME',{nickname:'A chosen nickname',useNickname:true});
  const fallback=await person('Bob Real',{nickname:'  ',useNickname:true}),outsider=await person('Other class'),unassigned=await person('Unassigned');
  const disabled=await person('DISABLED-STUDENT'),archived=await person('ARCHIVED-STUDENT'),released=await person('RELEASED-STUDENT');
  const revoked=await person('ROLE-REVOKED-STUDENT',{role:'teacher'}),pending=await person('PENDING-ACTIVATION',{activated:false});
  const teacher=await person('Class teacher',{kind:'teacher'}),otherTeacher=await person('Other teacher',{kind:'teacher'});
  const classId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Roster class',$1) RETURNING id",[teacher.id])).rows[0].id;
  const otherClass=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Other class',$1) RETURNING id",[otherTeacher.id])).rows[0].id;
  await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2),($3,$4)',[classId,teacher.id,otherClass,otherTeacher.id]);
  for(const user of [viewer,real,alias,fallback,disabled,archived,released,revoked,pending])await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,user.identityId]);
  await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[otherClass,outsider.identityId]);
  await pool.query('UPDATE accounts SET disabled_at=now() WHERE id=$1',[disabled.id]);
  await pool.query('UPDATE identities SET archived_at=now() WHERE id=$1',[archived.identityId]);
  await pool.query('UPDATE accounts SET binding_released_at=now() WHERE id=$1',[released.id]);
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://roster.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='';return async(path,body,status=200)=>{
   const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:'http://roster.test',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const result=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return result;
  };}
  async function login(user){const api=client();await api('/auth/login',{username:user.username,password});return api;}
  const student=await login(viewer);
  const roster=(await student(`/classes/${classId}`)).members;
  assert.deepEqual(roster.map(item=>item.displayName),['A chosen nickname','Alice Real','Bob Real','Viewer']);
  assert.deepEqual(new Set(roster.map(item=>item.id)),new Set([viewer,real,alias,fallback].map(user=>user.identityId)));
  for(const item of roster){
   assert.deepEqual(Object.keys(item).sort(),['avatar','displayName','id']);
   assert.equal(item.avatar,defaultAvatarPath(item.id));
   assert.equal((await student(`/profiles/${item.id}`)).profile.id,item.id,'every classmate link must have a readable public profile');
  }
  const serialized=JSON.stringify(roster);
  for(const privateValue of ['PRIVATE-NUMBER','private.invalid','PRIVATE-BIO','UNSELECTED-NICKNAME','HIDDEN-LEGAL-NAME',disabled.identityId,archived.identityId,released.identityId,revoked.identityId,pending.identityId,...[viewer,real,alias,fallback].flatMap(user=>[user.id,user.username])])assert(!serialized.includes(privateValue),privateValue);
  await client()(`/classes/${classId}`,undefined,401);
  await (await login(outsider))(`/classes/${classId}`,undefined,403);
  await (await login(unassigned))(`/classes/${classId}`,undefined,403);
  await (await login(otherTeacher))(`/classes/${classId}`,undefined,403);
  assert.equal((await (await login(teacher))(`/classes/${classId}`)).members.length,4);
  // Domain checks do not rely on a stale caller role or a released identity.
  for(const user of [disabled,archived,released,revoked])await assert.rejects(handleClassHub({pool,user:{...user,roles:['student']},route:`/classes/${classId}`,method:'GET'}),error=>error.status===403);
  await pool.query('DELETE FROM class_members WHERE class_id=$1 AND identity_id=$2',[classId,viewer.identityId]);
  await student(`/classes/${classId}`,undefined,403);
  await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,viewer.identityId]);
  await pool.query('UPDATE classes SET archived_at=now() WHERE id=$1',[classId]);
  await student(`/classes/${classId}`,undefined,404);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
