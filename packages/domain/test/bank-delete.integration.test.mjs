import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';
import {SCHOOL_BANK} from '../src/library.mjs';

test('empty problem banks can be deleted by their owner or admin; referenced banks are protected',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`bank_delete_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const connection=new URL(process.env.TEST_DATABASE_URL);
  connection.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(connection.href);
  const password=randomBytes(24).toString('base64url');
  let server;
  try {
   await migrate(pool);
   await bootstrap(pool,{name:'管理员',number:'ADM-DEL',username:'bank-delete-admin',password});
   server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('base64url'),APP_ORIGIN:'http://bank-delete.test',COOKIE_SECURE:'false'})));
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const base=`http://127.0.0.1:${server.address().port}/api/v1`;
   const request=async(path,method='GET',body,auth)=>{
    const response=await fetch(`${base}${path}`,{method,headers:{Origin:'http://bank-delete.test',...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};
   };
   const admin=await request('/auth/login','POST',{username:'bank-delete-admin',password});
   assert.equal(admin.status,200);
   const register=async(kind,number,username)=>{
    const person=await request('/people','POST',{kind,number,name:username},admin);
    assert.equal(person.status,201);
    const account=await request('/auth/register','POST',{kind,number,name:username,username,activationCode:person.data.activationCode,password});
    assert.equal(account.status,201);
    return account;
   };
   const owner=await register('teacher','T-DEL-1','bank-owner');
   const other=await register('teacher','T-DEL-2','bank-other');
   const student=await register('student','S-DEL-1','bank-student');
   const create=async(auth,name)=>{
    const response=await request('/problem-banks','POST',{name,visibility:'private'},auth);
    assert.equal(response.status,201,JSON.stringify(response.data));
    return response.data.id;
   };

   const empty=await create(owner,'可删除空库');
   await pool.query('INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,$3)',[empty,other.data.user.id,'read']);
   assert.equal((await request(`/problem-banks/${empty}`,'DELETE',undefined,other)).status,403,'shared teacher is not owner');
   assert.equal((await request(`/problem-banks/${empty}`,'DELETE',undefined,student)).status,403,'students cannot delete banks');
   const deleted=await request(`/problem-banks/${empty}`,'DELETE',undefined,owner);
   assert.equal(deleted.status,200,JSON.stringify(deleted.data));
   assert.equal(deleted.data.deleted,true);
   assert.equal((await pool.query('SELECT 1 FROM problem_banks WHERE id=$1',[empty])).rowCount,0);
   assert.equal((await pool.query('SELECT 1 FROM bank_permissions WHERE bank_id=$1',[empty])).rowCount,0);
   assert.equal((await pool.query("SELECT 1 FROM audit_events WHERE resource_id=$1 AND action='bank.delete'",[empty])).rowCount,1);

   const archiveCandidate=await create(owner,'可恢复教学库');
   const archived=await request(`/problem-banks/${archiveCandidate}`,'PATCH',{archived:true},owner);
   assert.equal(archived.status,200,JSON.stringify(archived.data));
   assert.ok(archived.data.archivedAt);
   assert.equal((await request('/problem-banks','GET',undefined,owner)).data.items.some(bank=>bank.id===archiveCandidate),false);
   const ownedList=await request('/problem-banks?includeArchived=owned','GET',undefined,owner);
   assert.ok(ownedList.data.items.find(bank=>bank.id===archiveCandidate)?.archivedAt);
   assert.equal((await request('/problem-banks?includeArchived=owned','GET',undefined,other)).data.items.some(bank=>bank.id===archiveCandidate),false);
   assert.equal((await request(`/problem-banks/${archiveCandidate}`,'PATCH',{archived:false},other)).status,403);
   const restored=await request(`/problem-banks/${archiveCandidate}`,'PATCH',{archived:false},owner);
   assert.equal(restored.status,200,JSON.stringify(restored.data));
   assert.equal(restored.data.archivedAt,null);
   assert.equal((await request('/problem-banks','GET',undefined,owner)).data.items.some(bank=>bank.id===archiveCandidate),true);

   const adminEmpty=await create(admin,'管理员测试空库');
   assert.equal((await request(`/problem-banks/${adminEmpty}`,'DELETE',undefined,owner)).status,403);
   assert.equal((await request(`/problem-banks/${adminEmpty}`,'DELETE',undefined,admin)).status,200);
   const schoolBank=(await request('/problem-banks','POST',{name:'校内审核题库',visibility:'school'},admin)).data.id;
   await pool.query('UPDATE problem_banks SET owner_account_id=$1 WHERE id=$2',[owner.data.user.id,schoolBank]);
   assert.equal((await request(`/problem-banks/${schoolBank}`,'PATCH',{archived:true},owner)).status,403);
   assert.equal((await request(`/problem-banks/${schoolBank}`,'PATCH',{archived:true},admin)).status,200);
   assert.equal((await request(`/problem-banks/${schoolBank}`,'PATCH',{archived:false},owner)).status,403);
   assert.equal((await request(`/problem-banks/${schoolBank}`,'PATCH',{archived:false},admin)).status,200);
   const system=await request(`/problem-banks/${SCHOOL_BANK}`,'DELETE',undefined,admin);
   assert.equal(system.status,409);
   assert.equal(system.data.error.code,'SYSTEM_BANK');

   const withProblem=await create(owner,'含归档题目');
   await pool.query('INSERT INTO problems(bank_id,owner_account_id,archived_at) VALUES($1,$2,now())',[withProblem,owner.data.user.id]);
   const withProblemInList=(await request('/problem-banks?includeArchived=owned','GET',undefined,owner)).data.items.find(bank=>bank.id===withProblem);
   assert.equal(withProblemInList.problemCount,0);
   assert.equal(withProblemInList.archivedProblemCount,1);
   const problemResult=await request(`/problem-banks/${withProblem}`,'DELETE',undefined,owner);
   assert.equal(problemResult.status,409);
   assert.equal(problemResult.data.error.code,'BANK_NOT_EMPTY');
   assert.equal((await pool.query('SELECT 1 FROM problem_banks WHERE id=$1',[withProblem])).rowCount,1);

   const linkedBank=await create(owner,'课程引用题库');
   const linkedProblem=(await pool.query('INSERT INTO problems(bank_id,owner_account_id) VALUES($1,$2) RETURNING id',[linkedBank,owner.data.user.id])).rows[0].id;
   const linkedVersion=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
    VALUES($1,'课程练习题','stdio','输出 1',1000,64,'print(1)','AC',now()) RETURNING id`,[linkedProblem])).rows[0].id;
   await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[linkedVersion,linkedProblem]);
   const course=(await pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'已发布课程',now()) RETURNING id",[owner.data.user.id])).rows[0].id;
   const chapter=(await pool.query("INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'引用章节',0) RETURNING id",[course])).rows[0].id;
   await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapter,linkedProblem,linkedVersion]);
   const linkedArchive=await request(`/problem-banks/${linkedBank}`,'PATCH',{archived:true},owner);
   assert.equal(linkedArchive.status,409);
   assert.equal(linkedArchive.data.error.code,'BANK_REFERENCED');
   assert.equal((await pool.query('SELECT archived_at FROM problem_banks WHERE id=$1',[linkedBank])).rows[0].archived_at,null);
   await pool.query('UPDATE learning_paths SET archived_at=now() WHERE id=$1',[course]);
   const classId=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('测试班',$1) RETURNING id",[owner.data.user.id])).rows[0].id;
   const practice=(await pool.query("INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes) VALUES('进行中训练',$1,$2,now(),now()+interval '1 day',30) RETURNING id",[classId,owner.data.user.id])).rows[0].id;
   await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,10,0)',[practice,linkedProblem,linkedVersion]);
   await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[practice]);
   const timedArchive=await request(`/problem-banks/${linkedBank}`,'PATCH',{archived:true},owner);
   assert.equal(timedArchive.status,409);
   assert.equal(timedArchive.data.error.code,'BANK_REFERENCED');
   await pool.query("UPDATE timed_practices SET archived_at=now(),state='Archived' WHERE id=$1",[practice]);
   assert.equal((await request(`/problem-banks/${linkedBank}`,'PATCH',{archived:true},owner)).status,200);
   assert.equal((await request(`/problem-banks/${linkedBank}`,'PATCH',{archived:false},owner)).status,200);

   const withGroup=await create(owner,'含分组');
   await pool.query('INSERT INTO problem_groups(bank_id,owner_account_id,name) VALUES($1,$2,$3)',[withGroup,owner.data.user.id,'空分组']);
   assert.equal((await request(`/problem-banks/${withGroup}`,'DELETE',undefined,admin)).data.error.code,'BANK_NOT_EMPTY');

   const withImport=await create(owner,'含导入历史');
   await pool.query('INSERT INTO problem_import_batches(account_id,idempotency_key,request_hash,result,bank_id) VALUES($1,$2,$3,$4,$5)',[owner.data.user.id,randomUUID(),'test-hash',JSON.stringify({summary:{created:0,failed:1,total:1}}),withImport]);
   assert.equal((await request(`/problem-banks/${withImport}`,'DELETE',undefined,owner)).data.error.code,'BANK_NOT_EMPTY');

   const courseBundleBank=await create(owner,'课程练习包引用的空题库');
   const courseBundle=(await pool.query(`INSERT INTO learning_paths(owner_account_id,title,practice_bundle)
    VALUES($1,'旧课程练习包',$2::jsonb) RETURNING id`,[owner.data.user.id,JSON.stringify([{bankId:courseBundleBank}])])).rows[0].id;
   const bundleBlocked=await request(`/problem-banks/${courseBundleBank}`,'DELETE',undefined,owner);
   assert.equal(bundleBlocked.status,409);
   assert.equal(bundleBlocked.data.error.code,'BANK_REFERENCED');
   assert.equal((await pool.query('SELECT 1 FROM problem_banks WHERE id=$1',[courseBundleBank])).rowCount,1);
   await pool.query("UPDATE learning_paths SET practice_bundle='[]'::jsonb WHERE id=$1",[courseBundle]);
   assert.equal((await request(`/problem-banks/${courseBundleBank}`,'DELETE',undefined,owner)).status,200);
  } finally {
   if(server)await new Promise(resolve=>server.close(resolve));
   await pool.end();
   await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
   await manager.end();
  }
 });
