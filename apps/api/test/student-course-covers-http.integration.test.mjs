import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {LEGACY_SCHOOL_ID} from '../../../packages/domain/src/schools.mjs';

test('student course cover URLs retain catalog admission and authorize every binary revalidation', {skip:!process.env.TEST_DATABASE_URL,timeout:120000}, async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);
 assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
 const manager=createPool(base.href),schema='student_course_covers_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(scoped.href);let app;
 try{
  await migrate(owner);
  const password=randomBytes(24).toString('base64url'),origin='http://student-course-covers.test';
  await bootstrap(owner,{username:'cover-admin',password,number:'ADMIN',name:'Cover admin'});
  const actors={admin:(await owner.query("SELECT id,identity_id AS \"identityId\" FROM accounts WHERE username='cover-admin'")).rows[0]};
  const hash=await hashPassword(password);
  for(const [name,kind] of [['learner','student'],['peer','student'],['teacher','teacher'],['outsider','personal']]){
   const person=(await owner.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0];
   actors[name]={...(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[person.id,name,hash])).rows[0],identityId:person.id};
   if(kind==='personal')await owner.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1',[actors[name].id]);
   else{
    await owner.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[actors[name].id,kind]);
    await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[actors[name].id]);
   }
  }
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPp8AAAAASUVORK5CYII=','base64');
  // These bounded fixtures exercise the existing supported-format validator;
  // the endpoint must return the original bytes without JSON/base64 wrapping.
  const jpeg=Buffer.from([255,216,255,224,0,2,255,217]);
  const webp=Buffer.alloc(20);webp.write('RIFF',0);webp.writeUInt32LE(12,4);webp.write('WEBP',8);webp.write('VP8 ',12);
  const data=(bytes,type='png')=>`data:image/${type};base64,${bytes.toString('base64')}`;
  const make=async({title='Cover course',cover=data(png),scope='school',published=true,account=actors.teacher.id}={})=>{
   const course=(await owner.query(`INSERT INTO learning_paths(owner_account_id,title,description,owner_scope,published_at,cover_image,localizations)
    VALUES($1,$2,'Course description',$3,CASE WHEN $4 THEN now() END,$5,$6) RETURNING id`,[account,title,scope,published,cover,{en:{title:'English title',description:'English description'}}])).rows[0];
   course.chapter=(await owner.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Lesson','PRIVATE_LESSON_BODY',0) RETURNING id",[course.id])).rows[0].id;
   return course;
  };
  const large=await make({cover:data(Buffer.concat([png,Buffer.alloc(30000)]))});
  const formats=[{course:await make(),bytes:png,type:'png'},{course:await make({cover:data(jpeg,'jpeg')}),bytes:jpeg,type:'jpeg'},{course:await make({cover:data(webp,'webp')}),bytes:webp,type:'webp'}];
  const empty=await make({cover:null}),restricted=await make(),draft=await make({published:false}),pending=await make({scope:'platform',account:actors.admin.id});
  await owner.query("UPDATE learning_paths SET access_scope='classes' WHERE id=$1",[restricted.id]);
  const cls=(await owner.query("INSERT INTO classes(name,owner_account_id) VALUES('Cover class',$1) RETURNING id",[actors.teacher.id])).rows[0];
  await owner.query('INSERT INTO learning_path_classes(path_id,class_id) VALUES($1,$2)',[restricted.id,cls.id]);
  await owner.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[cls.id,actors.learner.identityId]);
  await owner.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[actors.learner.identityId,large.chapter]);
  const bank=(await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Cover exercises','school') RETURNING id",[actors.teacher.id])).rows[0];
  const problem=(await owner.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[actors.teacher.id,bank.id])).rows[0];
  const version=(await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,reference_code,validation_status,time_limit_ms,memory_limit_mb,published_at,school_visible_at,rank_review_status,rank_approved_at)
   VALUES($1,'Practice','stdio','Print one','print(1)','AC',1000,64,now(),now(),'approved',now()) RETURNING id`,[problem.id])).rows[0];
  await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);
  await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[large.chapter,problem.id,version.id]);
  await owner.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,'submit','PRIVATE_STUDENT_CODE',$5,'fixture','AC',100)`,[actors.learner.id,actors.learner.identityId,problem.id,version.id,randomUUID()]);
  await owner.query("UPDATE learning_paths SET platform_audience_scope='custom' WHERE id=$1",[pending.id]);
  const rule=(await owner.query("INSERT INTO platform_course_rules(course_id,rule_key,target_kind,school_id,admission_mode) VALUES($1,'school:legacy','school',$2,'application') RETURNING *",[pending.id,LEGACY_SCHOOL_ID])).rows[0];
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const runtime=new URL(scoped);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const config=loadConfig({SESSION_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,COOKIE_SECURE:'false'});
  app=await createApiApplication({databaseUrl:runtime.href,logger:false,config});await app.listen(0,'127.0.0.1');
  const endpoint=(await app.getUrl())+'/api/v1',sessions={};
  const request=async(path,{name='learner',method='GET',body,headers={},status=200}={})=>{
   const response=await fetch(endpoint+path,{method,headers:{Origin:origin,...(sessions[name]?{Cookie:sessions[name]}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
   assert.equal(response.status,status,`${method} ${path} as ${name}`);return response;
  };
  const json=async(path,options)=>{const response=await request(path,options);assert.match(response.headers.get('cache-control')??'',/no-store/);return response.json();};
  for(const [name,actor]of Object.entries(actors)){
   const response=await request('/auth/login',{name,method:'POST',body:{username:name==='admin'?'cover-admin':name,password}});sessions[name]=response.headers.get('set-cookie').split(';')[0];await response.arrayBuffer();
  }
  const list=(name='learner',summary=true)=>json(`/learning-paths?includeAdmission=true${summary?'&view=student-summary':''}`,{name});
  const cover=(course,options)=>request(`/learning-paths/${course.id}/cover`,options);
  const deny=async(course,status=404,options={})=>{
   for(const headers of [{},{'If-None-Match':'*'},{'If-None-Match':options.etag??'"prior-cover"'}]){
    const response=await cover(course,{...options,status,headers});if(options.etag)assert.notEqual(response.headers.get('etag'),options.etag);assert.match(response.headers.get('content-type')??'',/application\/json/);assert.match(response.headers.get('cache-control')??'',/no-store/);assert.ok((await response.json()).error);
   }
  };
  await t.test('catalog metadata and personal completion are identical while image bytes move to authenticated URLs',async()=>{
   const full=await list('learner',false),summary=await list();
   assert.deepEqual(summary.items.map(c=>c.id),full.items.map(c=>c.id));
   for(const [i,item]of summary.items.entries()){
    assert.deepEqual({...item,coverImage:full.items[i].coverImage},full.items[i]);
    assert.equal(item.coverImage,full.items[i].coverImage?`/api/v1/learning-paths/${item.id}/cover`:null);
   }
   const current=summary.items.find(c=>c.id===large.id);assert.equal(current.taskCount,1);assert.equal(current.completedTasks,1);assert.equal(current.completedChapters,1);
   assert.equal(summary.items.find(c=>c.id===pending.id).admission,'apply');assert.equal(summary.items.find(c=>c.id===pending.id).completedTasks,undefined);
   assert.ok(!JSON.stringify(summary).includes('data:image/'));assert.ok(!JSON.stringify(summary).includes('PRIVATE_'));
   assert.ok(Buffer.byteLength(JSON.stringify(summary))<Buffer.byteLength(JSON.stringify(full))/3);
   assert.equal((await list('peer')).items.find(c=>c.id===large.id).completedTasks,0);
   t.diagnostic(JSON.stringify({fullBytes:Buffer.byteLength(JSON.stringify(full)),summaryBytes:Buffer.byteLength(JSON.stringify(summary))}));
  });
  await t.test('PNG, JPEG and WebP return exact bytes with private revalidation and content-bound ETags',async()=>{
   for(const {course,bytes,type}of formats){
    const response=await cover(course);assert.equal(response.headers.get('content-type'),`image/${type}`);assert.equal(response.headers.get('cache-control'),'private, no-cache');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    const etag=response.headers.get('etag');assert.match(etag,/^"[^"]+"$/);assert.ok(etag.includes(createHash('sha256').update(bytes).digest('hex')));
    for(const conditional of [etag,`W/${etag}`,`"different", ${etag}`,'*']){
     const unchanged=await cover(course,{headers:{'If-None-Match':conditional},status:304});assert.equal((await unchanged.arrayBuffer()).byteLength,0);assert.equal(unchanged.headers.get('etag'),etag);
    }
   }
   const course=formats[0].course,old=(await cover(course)).headers.get('etag');await owner.query('UPDATE learning_paths SET cover_image=$2 WHERE id=$1',[course.id,data(jpeg,'jpeg')]);
   const changed=await cover(course,{headers:{'If-None-Match':old}});assert.notEqual(changed.headers.get('etag'),old);assert.deepEqual(Buffer.from(await changed.arrayBuffer()),jpeg);
   await deny(empty);await deny({id:randomUUID()});
   const invalid=await make({cover:'data:image/png;base64,aGVsbG8='});await deny(invalid);
  });
  await t.test('scope, availability and role revocation precede conditional responses',async()=>{
   const etag=(await cover(restricted)).headers.get('etag');await deny(restricted,404,{name:'peer',etag});
   await owner.query('DELETE FROM class_members WHERE class_id=$1 AND identity_id=$2',[cls.id,actors.learner.identityId]);await deny(restricted,404,{etag});
   await deny(large,401,{name:'anonymous'});await deny(large,403,{name:'outsider'});
   await owner.query('UPDATE accounts SET disabled_at=now() WHERE id=$1',[actors.peer.id]);await deny(large,401,{name:'peer'});
   await deny(draft);await cover(draft,{name:'teacher'});await cover(draft,{name:'admin'});
   await owner.query("DELETE FROM account_roles WHERE account_id=$1 AND role='teacher'",[actors.teacher.id]);await deny(draft,404,{name:'teacher'});
   await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'teacher')",[actors.teacher.id]);
   const archived=await make();await owner.query('UPDATE learning_paths SET archived_at=now() WHERE id=$1',[archived.id]);
   const archivedList=await json('/learning-paths?view=student-summary&archived=true',{name:'teacher'});
   assert.equal(archivedList.items.find(c=>c.id===archived.id).coverImage,`/api/v1/learning-paths/${archived.id}/cover?archived=true`);
   await request(`/learning-paths/${archived.id}/cover?archived=true`,{name:'teacher'});
   await request(`/learning-paths/${archived.id}/cover?archived=true`,{headers:{'If-None-Match':'*'},status:403});
   for(const change of ["listed=false","available_from=now()+interval '1 day'","available_until=now()-interval '1 day'","archived_at=now()","published_at=NULL,withdrawn_at=now()"]){
    const course=await make();const prior=(await cover(course)).headers.get('etag');await owner.query(`UPDATE learning_paths SET ${change} WHERE id=$1`,[course.id]);
    assert.ok(!(await list()).items.some(c=>c.id===course.id));await deny(course,404,{etag:prior});
   }
   await owner.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1',[actors.learner.id]);await deny(large,403);
   await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1)',[actors.learner.id]);
  });
  await t.test('pending school admission exposes the listed cover without lesson content and rechecks audience rules',async()=>{
   const etag=(await cover(pending)).headers.get('etag');
   await json(`/learning-paths/${pending.id}`,{status:404});await json(`/chapters/${pending.chapter}`,{status:404});
   await owner.query("INSERT INTO platform_course_admissions(course_id,rule_id,generation,account_id,origin,status) VALUES($1,$2,$3,$4,'application','pending')",[pending.id,rule.id,rule.generation,actors.learner.id]);
   assert.equal((await list()).items.find(c=>c.id===pending.id).admission,'pending');await cover(pending,{headers:{'If-None-Match':etag},status:304});
   await json(`/learning-paths/${pending.id}`,{status:404});
   await owner.query('UPDATE platform_course_rules SET active=false WHERE id=$1',[rule.id]);assert.ok(!(await list()).items.some(c=>c.id===pending.id));await deny(pending,404,{etag});
  });
 }finally{await app?.close();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
