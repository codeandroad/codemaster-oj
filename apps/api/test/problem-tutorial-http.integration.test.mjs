import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';

test('problem tutorials allow school teachers to teach with approved shared problems without editing the problem', {
 skip: !process.env.TEST_DATABASE_URL, timeout: 60000,
}, async () => {
 const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
 assert.match(databaseUrl.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager = createPool(databaseUrl.href);
 const schema = 'tutorial_' + randomBytes(6).toString('hex');
 databaseUrl.searchParams.set('options', '-csearch_path=' + schema);
 const pool = createPool(databaseUrl.href);
 const password = randomBytes(24).toString('base64url');
 const origin = 'http://tutorial.test';
 let app;
 try {
  await manager.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const adminId = await bootstrap(pool,{name:'Administrator',number:'A1',username:'tutorial-admin',password});
  app = await createApiApplication({ databaseUrl:databaseUrl.href,logger:false,
   config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'}) });
  await app.listen(0,'127.0.0.1');
  const base = await app.getUrl();
  async function call(path,{auth,method='GET',body,status=200,csrf=true}={}) {
   const response = await fetch(base+'/api/v1'+path,{method,headers:{
    Origin:origin,...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{}),
    ...(body===undefined?{}:{'Content-Type':'application/json'}),
   },body:body===undefined?undefined:JSON.stringify(body)});
   const data = await response.json();
   if(status!==null)assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);
   assert.equal(response.headers.get('cache-control'),'no-store');
   return {...data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin = await call('/auth/login',{method:'POST',body:{username:'tutorial-admin',password}});
  async function register(kind,number,username) {
   const {person,activationCode} = await call('/people',{auth:admin,method:'POST',body:{kind,number,name:username},status:201});
   const auth=await call('/auth/register',{method:'POST',body:{kind,number,name:username,username,password,activationCode},status:201});
   return {...auth,identityId:person.id};
  }
  const student=await register('student','S1','tutorial-student');
  const teacher=await register('teacher','T1','tutorial-teacher');
  const other=await register('teacher','T2','tutorial-other');
  const {rows:[problem]}=await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[teacher.user.id]);
  const {rows:[version]}=await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,
   reference_code,validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at)
   VALUES($1,'Independent practice','stdio','Read two values.',1000,64,'# private program','AC',now(),now(),'approved',now()) RETURNING id`,[problem.id]);
  await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[version.id,problem.id]);
  const endpoint='/problems/'+problem.id+'/tutorial';
  const view=(auth=student,extra='')=>call(endpoint+'?versionId='+version.id+extra,{auth});
  const save=(auth,body,status=200)=>call(endpoint,{auth,method:'PATCH',body,status});

  await call(endpoint,{status:401});
  assert.equal((await view()).tutorial,null);
  const manage=await call(endpoint+'?manage=true',{auth:teacher});
  assert.deepEqual([manage.mode,manage.body,manage.revision],['course','',0]);
  await call(endpoint+'?manage=true',{auth:student,status:403});
  const otherDetail=await call('/problems/'+problem.id,{auth:other});
  assert.equal(otherDetail.canEdit,false);
  assert.equal(otherDetail.canManageTutorial,true);
  assert.equal(otherDetail.referenceCode,undefined);
  const otherRow=(await call('/problems',{auth:other})).items.find(item=>item.id===problem.id);
  assert.equal(otherRow.canManageTutorial,true);
  assert.equal(otherRow.canEdit,false);
  assert.equal((await call(endpoint+'?manage=true',{auth:other})).revision,0);
  await call('/problems/'+problem.id+'/versions',{auth:other,method:'POST',body:{
   title:'Peer rewrite',statement:'A new statement.',mode:'stdio',referenceCode:'print(0)',
   samples:[{input:'',expected:'0'}],tests:[{input:'',expected:'0',weight:100}],
  },status:403});
  const {rows:[readOnlyBank]}=await pool.query(`INSERT INTO problem_banks(owner_account_id,name,visibility)
   VALUES($1,'Read-only bank','private') RETURNING id`,[teacher.user.id]);
  await pool.query("INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,'read')",[readOnlyBank.id,other.user.id]);
  const {rows:[privateProblem]}=await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[teacher.user.id,readOnlyBank.id]);
  await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
   VALUES($1,'Private practice','stdio','Read two values.',1000,64,'print(input())','AC',now())`,[privateProblem.id]);
  const privateDetail=await call('/problems/'+privateProblem.id,{auth:other});
  assert.equal(privateDetail.canManageTutorial,false);
  await call('/problems/'+privateProblem.id+'/tutorial?manage=true',{auth:other,status:403});
  const custom={mode:'custom',body:'    # Indented code example\n\n## Two-pointer technique\n\nAn independent Markdown example.  \n',expectedRevision:0};
  await save(student,custom,403);
  await call('/problems/'+privateProblem.id+'/tutorial',{auth:other,method:'PATCH',body:custom,status:403});
  await pool.query("UPDATE problem_banks SET visibility='school' WHERE id=$1",[readOnlyBank.id]);
  await call('/problems/'+privateProblem.id+'/tutorial',{auth:other,method:'PATCH',body:custom,status:403});
  await call(endpoint,{auth:teacher,method:'PATCH',body:custom,status:403,csrf:false});
  await save(teacher,{...custom,body:'   '},400);
  await save(teacher,{...custom,body:'字'.repeat(21846)},413);
  assert.equal((await save(other,custom)).revision,1);
  assert.equal((await save(teacher,custom)).revision,1,'retry does not create a new revision');
  await save(admin,{...custom,body:'stale'},409);
  assert.deepEqual((await view()).tutorial,{source:'custom',body:custom.body});
  const detail=await call('/problems/'+problem.id,{auth:student});
  assert.equal(detail.versionId,version.id);
  assert.equal(detail.canManageTutorial,false);
  assert.equal(detail.referenceCode,undefined);
  assert.ok(!JSON.stringify(detail).includes(custom.body));

  const {rows:[course]}=await pool.query(`INSERT INTO learning_paths(owner_account_id,title,published_at,access_scope)
   VALUES($1,'Authorized course',now(),'classes') RETURNING id`,[adminId]);
  const {rows:[chapter]}=await pool.query(`INSERT INTO learning_chapters(path_id,title,content,position,checkpoint_answer)
   VALUES($1,'Patterns','### General technique','0','PRIVATE_CHECKPOINT') RETURNING id`,[course.id]);
  await pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapter.id,problem.id,version.id]);
  const selected='&'+new URLSearchParams({courseId:course.id,chapterId:chapter.id});
  await save(admin,{mode:'course',expectedRevision:1});
  assert.equal((await view(student,selected)).tutorial,null,'chapter query cannot grant course access');
  await pool.query("UPDATE learning_paths SET access_scope='school' WHERE id=$1",[course.id]);
  assert.deepEqual((await view(student,selected)).tutorial,{
   source:'course',courseTitle:'Authorized course',title:'Patterns',body:'### General technique',
  });
  assert.equal((await view()).tutorial?.body,'### General technique','a direct problem entry can find its linked course');
  await pool.query('UPDATE learning_paths SET published_at=NULL WHERE id=$1',[course.id]);
  assert.equal((await view()).tutorial,null);
  await pool.query('UPDATE learning_paths SET published_at=now() WHERE id=$1',[course.id]);
  const contenders=await Promise.all([
   save(teacher,{mode:'custom',body:'New content',expectedRevision:2},null),
   save(admin,{mode:'none',expectedRevision:2},null),
  ]);
  assert.deepEqual(contenders.map(result=>result.status).sort(),[200,409]);
  const result=await save(admin,{mode:'none',expectedRevision:3});
  assert.equal(result.body,'');
  assert.equal((await view(student,selected)).tutorial,null);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM problem_versions WHERE problem_id=$1',[problem.id])).rows[0].total,1);
 } finally {
  await app?.close();
  await pool.end();
  await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await manager.end();
 }
});
