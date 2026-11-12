import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool, LEGACY_SCHOOL_ID } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

const migration='102_platform_courses.sql';
test('platform courses retain original data and enforce audiences through NestJS and real runtime grants',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.equal(base.pathname,'/campus_qa');assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='platform_course_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const connection=new URL(base);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let app;
 const password=randomBytes(24).toString('base64url'),origin='http://platform-course.test';
 try{
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('INSERT INTO schema_migrations(name) VALUES($1),($2)',[migration,'105_acsl_platform_course.sql']);await migrate(pool);
  await bootstrap(pool,{name:'Original school administrator',number:'A',username:'school-admin',password});
  const admin=(await pool.query("SELECT id,identity_id FROM accounts WHERE username='school-admin'")).rows[0];
  const hash=await hashPassword(password),actors={};
  for(const name of ['platform','student-a','student-b','personal']){
   const i=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$1) RETURNING id",[name])).rows[0];
   const a=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[i.id,name,hash])).rows[0];
   await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[a.id]);actors[name]={id:a.id,identityId:i.id};
  }
  const originals=[];
  for(const title of ['Python 专项训练 · 全目录学习路线','9618 Paper 4 Practical Programming with Python','Unrelated school course']){
   const p=(await pool.query('INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,$2,now()) RETURNING *',[admin.id,title])).rows[0];
   const c=(await pool.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Original chapter','Original **content**',0) RETURNING *",[p.id])).rows[0];
   await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[actors['student-a'].identityId,c.id]);
   originals.push({p,c});
  }
  await pool.query("SELECT set_config('campus.school_id',$1,false)",[LEGACY_SCHOOL_ID]);
  const first=originals[0];
  await pool.query(`INSERT INTO legacy_course_publication_versions(school_id,course_id,revision,source_version,title,description,access_scope,chapters)
   SELECT school_id,id,1,extract(epoch FROM updated_at)::text,title,description,access_scope,$2 FROM learning_paths WHERE id=$1`,[first.p.id,JSON.stringify([{id:first.c.id,title:first.c.title,body:first.c.content,problems:[]}])]);
  const listing=(await pool.query('INSERT INTO public_course_listings(school_id,course_id,revision,approved_by) VALUES($1,$2,1,$3) RETURNING id',[LEGACY_SCHOOL_ID,first.p.id,admin.id])).rows[0];
  await provisionPlatformAdministrator(pool,{username:'platform'});
  await pool.query('DELETE FROM schema_migrations WHERE name=ANY($1::text[])',[[migration,'105_acsl_platform_course.sql']]);await migrate(pool);
  await t.test('migration changes only ownership fields of the two named courses',async()=>{
   for(const [index,{p,c}] of originals.entries()){
    const after=(await pool.query('SELECT * FROM learning_paths WHERE id=$1',[p.id])).rows[0];
    assert.equal(after.owner_scope,index<2?'platform':'school');
    for(const key of Object.keys(p))assert.deepEqual(after[key],p[key],key);
    assert.deepEqual((await pool.query('SELECT * FROM learning_chapters WHERE id=$1',[c.id])).rows[0],c);
   }
   assert.equal((await pool.query('SELECT count(*)::int n FROM learning_progress WHERE completed')).rows[0].n,3);
   await migrate(pool);assert.equal((await pool.query("SELECT count(*)::int n FROM platform_audit_events WHERE action='platform.course.source_migrated'")).rows[0].n,2);
  });
  const alpha=await provisionSchool(pool,{slug:'platform-alpha',name:'Alpha school',adminUsername:'student-a'});
  const beta=await provisionSchool(pool,{slug:'platform-beta',name:'Beta school',adminUsername:'student-b'});
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtime=new URL(connection);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  app=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const endpoint=await app.getUrl();
  async function client(name){
   let cookie='',csrf='';
   const send=async(path,body,method=body===undefined?'GET':'POST',status=200,validCsrf=true)=>{
    const response=await fetch(endpoint+'/api/v1'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie,'X-CSRF-Token':validCsrf?csrf:'invalid'}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??data)}`);
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;return data;
   };
   await send('/auth/login',{username:name,password});return {send};
  }
  const platform=await client('platform'),school=await client('school-admin'),a=await client('student-a'),b=await client('student-b'),personal=await client('personal');
  const list=async api=>(await api.send('/practice/catalog')).courses;
  let course;
  const change=async(patch,status=200)=>{const next=await platform.send('/platform/courses/'+course.id,{...patch,expectedRevision:course.revision,sourceVersion:course.sourceVersion},'PATCH',status);if(status===200)course=next;return next;};
  const action=async(name,status=200)=>{const next=await platform.send(`/platform/courses/${course.id}/${name}`,{expectedRevision:course.revision,sourceVersion:course.sourceVersion},'POST',status);if(status===200)course=next;return next;};
  await t.test('platform-only administrator manages migrated sources; school administrator cannot',async()=>{
   const managed=await platform.send('/platform/courses');assert.equal(managed.items.length,2);
   const entry=(await list(personal)).find(c=>c.id===listing.id);assert.equal(entry.sourceSchool,'平台管理员');
   assert.equal((await a.send('/practice/courses/'+listing.id)).completedChapters,1);
   assert.ok(!(await school.send('/learning-paths')).items.some(c=>c.id===first.p.id));
   for(const operation of ['publish','unpublish','restore'])await school.send(`/learning-paths/${first.p.id}/${operation}`,{},'POST',403);
   await school.send('/learning-paths/'+first.p.id,{title:'steal'},'PATCH',403);
   await school.send('/chapters/'+first.c.id,{content:'steal'},'PATCH',403);
   await school.send('/platform/courses',undefined,'GET',403);
   await personal.send('/platform/courses',{},'POST',403);
   assert.ok(!(await platform.send('/platform/course-publications')).items.some(c=>c.courseId===first.p.id));
   await school.send(`/schools/${LEGACY_SCHOOL_ID}/course-admissions/${first.p.id}`,undefined,'GET',404);
   await platform.send('/platform/courses',{requestId:randomUUID(),title:'CSRF'},'POST',403,false);
  });
  await t.test('create, edit and publish use stale-write checks and retain chapter IDs',async()=>{
   const create={requestId:randomUUID(),title:'Platform course',audienceScope:'all',chapters:[{title:'Lesson',content:'Platform **lesson**'}]};
   course=await platform.send('/platform/courses',create,'POST',201);
   assert.equal((await platform.send('/platform/courses',create,'POST',201)).id,course.id);
   await platform.send('/platform/courses',{...create,title:'Conflicting retry'},'POST',409);
   assert.ok(!(await list(personal)).some(c=>c.id===course.id));
   await personal.send('/practice/courses/'+course.id,undefined,'GET',404);
   await action('publish');
   assert.ok((await list(personal)).some(c=>c.id===course.id));
   const old={...course};await change({title:'Updated platform course'});
   await platform.send('/platform/courses/'+course.id,{title:'stale',expectedRevision:old.revision,sourceVersion:old.sourceVersion},'PATCH',409);
   assert.equal(course.chapters[0].id,old.chapters[0].id);
   await change({chapters:[{id:randomUUID(),title:'Foreign',content:'no'}]},400);
   await change({chapters:[]},409);
  });
  await t.test('platform lessons round-trip every bilingual teaching field without erasing omitted fields',async()=>{
   const chapter=course.chapters[0],fields={title:'Complete lesson',content:'Native $2^3=8$ explanation',objective:'Trace the state',checkpoint:'Original self-check',checkpointAnswer:'Original lesson-only answer'};
   const localizations={en:{...fields},zh:{title:'完整课时',content:'原生 $2^3=8$ 讲解',objective:'追踪状态',checkpoint:'原创自测',checkpointAnswer:'仅课内参考答案'}};
   await change({chapters:[{id:chapter.id,...fields,localizations,acslLinks:[]}]});
   const saved=(await platform.send('/platform/courses/'+course.id)).chapters[0];
   for(const [key,value] of Object.entries(fields))assert.equal(saved[key],value,key);
   assert.deepEqual(saved.localizations,localizations);assert.deepEqual(saved.acslLinks,[]);
   await change({chapters:[{id:chapter.id,title:'Retitled without losing teaching material'}]});
   const preserved=(await platform.send('/platform/courses/'+course.id)).chapters[0];
   for(const key of ['content','objective','checkpoint','checkpointAnswer','localizations','acslLinks'])assert.deepEqual(preserved[key],saved[key],key);
   const reader=(await personal.send('/practice/courses/'+course.id)).chapters[0];
   assert.equal(reader.id,chapter.id);assert.equal(reader.body,fields.content);
   for(const key of ['objective','checkpoint','checkpointAnswer','localizations'])assert.deepEqual(reader[key],saved[key],key);
  });
  await t.test('school audiences block discovery, entry, chapter reads and applications outside the selected schools',async()=>{
   await change({audienceScope:'schools',schoolIds:[alpha.id]});
   assert.ok((await list(a)).some(c=>c.id===course.id));
   for(const denied of [b,personal,school]){
    assert.ok(!(await list(denied)).some(c=>c.id===course.id));
    for(const suffix of ['', '/entry'])await denied.send('/practice/courses/'+course.id+suffix,undefined,'GET',404);
    await denied.send(`/practice/courses/${course.id}/chapters/${course.chapters[0].id}/read`,{read:true,expectedRevision:course.revision},'POST',404);
    await denied.send(`/practice/courses/${course.id}/applications`,{expectedRevision:course.revision},'POST',404);
   }
   await a.send(`/practice/courses/${course.id}/chapters/${course.chapters[0].id}/read`,{read:true,expectedRevision:course.revision});
   assert.equal((await a.send('/practice/courses/'+course.id)).completedChapters,1);
   await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2',[alpha.id,actors['student-a'].id]);
   await a.send('/practice/courses/'+course.id,undefined,'GET',404);
   assert.ok(!(await list(a)).some(c=>c.id===course.id));
   await change({audienceScope:'schools',schoolIds:[]},400);
   await change({audienceScope:'schools',schoolIds:[randomUUID()]},400);
  });
  await t.test('student audiences use stable identities and cannot be bypassed through legacy school routes',async()=>{
   await change({audienceScope:'students',studentIds:[actors.personal.identityId]});
   await personal.send('/practice/courses/'+course.id);
   await b.send('/practice/courses/'+course.id,undefined,'GET',404);
   await school.send('/learning-paths/'+course.id,undefined,'GET',404);
   await school.send('/chapters/'+course.chapters[0].id+'/progress',{completed:true},'POST',403);
   await change({audienceScope:'students',studentIds:[admin.identity_id]},400);
   const candidates=await platform.send('/platform/courses/audience?kind=students&q=personal');
   assert.ok(candidates.items.some(c=>c.id===actors.personal.identityId));
   await personal.send('/platform/courses/audience?kind=students&q=personal',undefined,'GET',403);
  });
  await t.test('withdrawal and restoration preserve progress, contents and original source records',async()=>{
   await change({audienceScope:'all'});
   assert.equal((await a.send('/practice/courses/'+course.id)).completedChapters,1);
   await action('unpublish');await a.send('/practice/courses/'+course.id,undefined,'GET',404);
   await action('publish');await action('archive');await a.send('/practice/courses/'+course.id,undefined,'GET',404);
   await action('restore');assert.equal((await a.send('/practice/courses/'+course.id)).completedChapters,1);
   assert.equal((await pool.query('SELECT content FROM learning_chapters WHERE id=$1',[first.c.id])).rows[0].content,first.c.content);
   const workerConnection=new URL(connection);workerConnection.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
   const worker=createPool(workerConnection.href);try{await assert.rejects(worker.query('SELECT platform_student_ids FROM learning_paths'),/permission denied/);}finally{await worker.end();}
   await pool.query('UPDATE platform_admins SET revoked_at=now() WHERE account_id=$1',[actors.platform.id]);
   await platform.send('/platform/courses',undefined,'GET',403);
  });
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
