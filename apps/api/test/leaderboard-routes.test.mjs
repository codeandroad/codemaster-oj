import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Nest school leaderboard routes enforce admin-only visibility, cross-class filtering and student redaction',
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
   const teacherIdentityId=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('teacher',$1,'Teacher') RETURNING id",[randomUUID()])).rows[0].id;
   const teacherId=(await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'leaderboard-teacher',$2) RETURNING id",[teacherIdentityId,await hashPassword(password)])).rows[0].id;
   await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'teacher')",[teacherId]);
   const adminId=(await pool.query("SELECT id FROM accounts WHERE username='leaderboard-admin'")).rows[0].id;
   const classId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Class A',$1) RETURNING id",[adminId])).rows[0].id;
   await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[classId,teacherId]);
   await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,identityId]);
   const otherClassId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Class B',$1) RETURNING id",[adminId])).rows[0].id;
   const otherIdentityId=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,'Other Student') RETURNING id",[randomUUID()])).rows[0].id;
   const otherStudentId=(await pool.query("INSERT INTO accounts(identity_id,username,password_hash,nickname) VALUES($1,'leaderboard-other',$2,'Other Coder') RETURNING id",[otherIdentityId,await hashPassword(password)])).rows[0].id;
   await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[otherStudentId]);
   await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[otherClassId,otherIdentityId]);
   const problemId=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[teacherId])).rows[0].id;
   const versionId=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
    VALUES($1,'Leaderboard transport problem','stdio','Test',500,64,'print(1)','AC',now()) RETURNING id`,[problemId])).rows[0].id;
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,versionId]);
   await pool.query(`UPDATE problem_versions SET school_visible_at=now()-interval '1 second',
    rank_review_status='approved',rank_approved_at=now()-interval '1 second',
    rank_reviewed_at=now(),rank_reviewed_by=$2 WHERE id=$1`,[versionId,adminId]);
   await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
    VALUES($1,$2,$3,$4,'submit','print(1)',$5,'leaderboard-http','AC',100)`,[otherStudentId,otherIdentityId,problemId,versionId,randomUUID()]);
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
   const admin=await login('leaderboard-admin'),student=await login('leaderboard-student'),otherStudent=await login('leaderboard-other'),teacher=await login('leaderboard-teacher');
   const contexts='/api/v1/points/leaderboard/contexts';
   const settings='/api/v1/points/leaderboard/settings';
   assert.equal((await request(contexts)).status,401);
   const studentContext=await request(contexts,{auth:student});
   assert.equal(studentContext.status,200);
   assert.deepEqual(new Set(studentContext.data.items.map(item=>item.id)),new Set([classId,otherClassId]));
   assert.equal(studentContext.data.canManage,false);
   assert.equal(studentContext.data.visibleFields.attempts,false);
   assert.equal((await request(contexts,{auth:teacher})).data.canManage,false);
   assert.equal((await request(contexts,{auth:admin})).data.canManage,true);
   assert.equal((await request(settings,{auth:student})).data.visibleFields.attempts,false);
   const all=await request('/api/v1/points/leaderboard',{auth:student});
   assert.equal(all.status,200);
   assert.equal(all.data.classId,null);
   assert.equal(all.data.total,2,'default board includes students from every class, including zero-point students');
   assert.equal(all.data.items[0].id,otherIdentityId);
   assert.equal(all.data.items[1].id,identityId);
   const ownPoints=await request('/api/v1/points/me',{auth:student});
   assert.equal(ownPoints.status,200);
   assert.equal(ownPoints.data.points,0);
   assert.equal(ownPoints.data.rankPoints,0);
   const earnedPoints=await request('/api/v1/points/me',{auth:otherStudent});
   assert.equal(earnedPoints.status,200);
   assert.equal(earnedPoints.data.points,10);
   assert.equal(earnedPoints.data.rankPoints,10);
   assert.equal(earnedPoints.data.rankingPolicy.scope,'approved_school_first_ac');
   const leaderboard=`/api/v1/points/leaderboard?classId=${classId}`;
   const before=await request(leaderboard,{auth:student});
   assert.equal(before.status,200);
   assert.equal(before.data.me.id,identityId);
   assert.equal(before.data.total,1);
   assert.equal(before.data.items[0].points,0);
   assert.equal(Object.hasOwn(before.data.me,'attempts'),false);
   const otherClass=await request(`/api/v1/points/leaderboard?classId=${otherClassId}`,{auth:student});
   assert.equal(otherClass.status,200,'student may filter a different class');
   assert.equal(otherClass.data.items[0].id,otherIdentityId);
   assert.equal(otherClass.data.me,null);
   assert.equal((await request(`/api/v1/points/leaderboard?classId=${randomUUID()}`,{auth:student})).status,404);
   const visibleFields={solvedProblems:true,attempts:true,acRate:false};
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:student})).status,403);
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:teacher})).status,403);
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:admin,csrf:false})).status,403);
   assert.equal((await request(settings,{method:'PATCH',body:{visibleFields},auth:admin})).status,200);
   assert.equal((await request(`${contexts}/${classId}`,{method:'PATCH',body:{visibleFields},auth:admin})).status,404);
   const after=await request(leaderboard,{auth:student});
   assert.equal(after.status,200);
   assert.equal(after.data.me.attempts,0);
   assert.equal(Object.hasOwn(after.data.me,'acRate'),false);
   assert.equal(Object.hasOwn(after.data.me,'publicTag'),false);
   const otherAfter=await request(`/api/v1/points/leaderboard?classId=${otherClassId}`,{auth:student});
   assert.equal(otherAfter.data.visibleFields.attempts,true,'one admin setting covers all class filters');
  }finally{
   if(app)await app.close();
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
