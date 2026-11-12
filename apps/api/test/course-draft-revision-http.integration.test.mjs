import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {DomainService} from '../dist/domain.service.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';

// Real Nest transport with an application-role connection in a disposable QA
// schema. No production records, credentials, or judge execution are used.
test('draft revision guards reject concurrent course changes before writing', {skip:!process.env.TEST_DATABASE_URL,timeout:180000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const schema='course_draft_revision_'+randomBytes(5).toString('hex'),manager=createPool(base.href),scoped=new URL(base);
 scoped.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(scoped.href);let server;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password),users={};
  for(const name of ['owner','peer','student']){
   const identityId=randomUUID(),role=name==='student'?'student':'teacher';
   await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)',[identityId,role,name]);
   const account=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,name,passwordHash])).rows[0];
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[account.id,role]);
   await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[account.id]);users[name]={...account,identityId};
  }
  const runtime=new URL(scoped);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const origin='http://course-revision.test';server=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await server.listen(0,'127.0.0.1');const host=await server.getUrl(),auth={};
  async function request(path,name='owner',{method='GET',body,status=200,csrf=true}={}){
   const a=auth[name],response=await fetch(host+'/api/v1'+path,{method,headers:{Origin:origin,...(a?{Cookie:a.cookie,...(csrf?{'X-CSRF-Token':a.csrfToken}:{})}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await response.json();if(status!==null)assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);
   if(path==='/auth/login')auth[name]={cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrfToken:data.csrfToken};
   return status===null?{status:response.status,data}:data;
  }
  for(const name of Object.keys(users))await request('/auth/login',name,{method:'POST',body:{username:name,password}});
  const post=(path,body,status=200)=>request(path,'owner',{method:'POST',body,status});
  const patch=(path,body,status=200)=>request(path,'owner',{method:'PATCH',body,status});
  const document={format:'codemaster-learning-path',version:1,title:'Revision course',description:'Original description',category:'ACSL',estimatedMinutes:30,
   sections:[{key:'first',title:'First'}],chapters:[{title:'One',content:'Original body',sectionKey:'first',problemIds:[]},{title:'Two',content:'Second body',sectionKey:'first',problemIds:[]}]};
  const created=await post('/learning-paths/import',document,201),path='/learning-paths/'+created.id;
  let current=await request(path);const originalIds=current.chapters.map(c=>c.id),firstChapter='/chapters/'+originalIds[0];
  const chapter={title:'Appended',content:'Safe new body',sectionKey:'first'};
  const guard=course=>({expectedDraftRevision:course.editRevision});
  const snapshot=async()=>({
   path:(await pool.query('SELECT xmin::text revision,title,description,sections,published_at,localizations FROM learning_paths WHERE id=$1',[created.id])).rows[0],
   chapters:(await pool.query('SELECT id,title,content,position,archived_at,section_key,localizations,acsl_links FROM learning_chapters WHERE path_id=$1 ORDER BY position,created_at,id',[created.id])).rows,
   progress:(await pool.query('SELECT * FROM learning_progress ORDER BY identity_id,chapter_id')).rows,
   audits:(await pool.query("SELECT count(*)::int n FROM audit_events WHERE action LIKE 'learning.%'")).rows[0].n,
  });
  const conflict=async(action)=>{const before=await snapshot();const error=await action();assert.equal(error.error.code,'COURSE_DRAFT_CONFLICT');assert.deepEqual(await snapshot(),before,'A rejected guard must not partially write metadata, chapters, progress, or audit records.');};
  await t.test('fresh guards work, rotate after successful writes, and stale retries have no partial effect',async()=>{
   assert.match(current.editRevision,/^\d{1,10}$/);
   const old=current;current=await patch(path,{...guard(old),description:'Guarded metadata'});assert.notEqual(current.editRevision,old.editRevision);
   await conflict(()=>patch(path,{...guard(old),title:'Must not replace',sections:[{key:'first',title:'Must not replace'}]},409));
   const before=current;await post(path+'/chapters',{...chapter,...guard(before)},201);current=await request(path);
   assert.notEqual(current.editRevision,before.editRevision);assert.equal(current.chapters.length,3);assert.deepEqual(current.chapters.slice(0,2).map(c=>c.id),originalIds);
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(before)},409));
  });
  await t.test('teacher metadata and chapter edits invalidate a previously read draft',async()=>{
   const old=current;await patch(path,{title:'Teacher title',description:'Teacher description'});
   await conflict(()=>patch(path,{...guard(old),title:'Importer title',description:'Importer description'},409));
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(old)},409));
   current=await request(path);assert.equal(current.title,'Teacher title');assert.equal(current.description,'Teacher description');
   const beforeChapter=current;await patch(firstChapter,{content:'Teacher chapter body',localizations:{en:{title:'One',content:'English edit'},zh:{title:'第一课',content:'中文修改'}}});
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(beforeChapter)},409));
   await conflict(()=>patch(path,{...guard(beforeChapter),title:'Importer overwrite'},409));
   current=await request(path);assert.equal(current.chapters[0].content,'Teacher chapter body');assert.notEqual(current.editRevision,beforeChapter.editRevision);
   // Reordering and archival also update the parent token, not only body edits.
   const beforeOrder=current;await patch('/chapters/'+originalIds[1],{position:0});
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(beforeOrder)},409));
   current=await request(path);const disposable=current.chapters.find(c=>!originalIds.includes(c.id));
   await request('/chapters/'+disposable.id,'owner',{method:'DELETE'});
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(current)},409));current=await request(path);
  });
  await t.test('two guarded HTTP appends with one revision serialize to one insert and one conflict',async()=>{
   const before=current,count=current.chapters.length;
   const outcomes=await Promise.all(['A','B'].map(suffix=>request(path+'/chapters','owner',{method:'POST',body:{...chapter,title:'Concurrent '+suffix,...guard(before)},status:null})));
   assert.deepEqual(outcomes.map(o=>o.status).sort(),[201,409]);assert.equal(outcomes.find(o=>o.status===409).data.error.code,'COURSE_DRAFT_CONFLICT');
   current=await request(path);assert.equal(current.chapters.length,count+1);
  });
  await t.test('publication after a read refuses metadata and chapter writes, even with its fresh published revision',async()=>{
   const before=current;await post(path+'/publish',{});
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(before)},409));
   await conflict(()=>patch(path,{...guard(before),description:'Must not edit published course'},409));
   current=await request(path);assert.equal(current.published,true);
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(current)},409));
   await conflict(()=>patch(path,{...guard(current),title:'Must not edit published course'},409));
   await request(firstChapter+'/progress','student',{method:'POST',body:{completed:true}});
   // Guard-free callers retain the established published-course editing behavior.
   await patch(path,{description:'Compatible ordinary edit'});await post(path+'/chapters',{...chapter,title:'Compatible ordinary append'},201);
   current=await request(path);assert.equal(current.published,true);assert.equal(current.description,'Compatible ordinary edit');
   const progress=(await request(path,'student')).chapters.find(c=>c.id===originalIds[0]);assert.equal(progress.completed,true);
  });
  await t.test('revision is editor-only and does not bypass ownership, student roles or CSRF',async()=>{
   for(const name of ['peer','student']){
    const detail=await request(path,name);assert.equal(detail.canEdit,false);assert.equal(Object.hasOwn(detail,'editRevision'),false);
    for(const method of ['PATCH','POST'])await request(path+(method==='POST'?'/chapters':''),name,{method,body:{...chapter,...guard(current)},status:403});
   }
   for(const method of ['PATCH','POST'])await request(path+(method==='POST'?'/chapters':''),'owner',{method,body:{...chapter,...guard(current)},csrf:false,status:403});
   await post(path+'/unpublish',{});current=await request(path);
   for(const revision of [null,5,'',{},'not-a-revision','12345678901']){
    const before=await snapshot();const e=await patch(path,{expectedDraftRevision:revision,title:'Invalid guard'},400);assert.equal(e.error.code,'VALIDATION');assert.deepEqual(await snapshot(),before);
   }
   await request(path,'peer',{status:404});await request(path,'student',{status:404});
  });
  await t.test('a detail read and editRevision use one snapshot even when a chapter changes midway',async()=>{
   const before=await request(path),oldBody=before.chapters.find(c=>c.id===originalIds[0]).content;
   const runtimePool=server.get(DomainService).pool,connect=runtimePool.connect.bind(runtimePool),clients=new Map();
   let resume,arrive,armed=true;const paused=new Promise(resolve=>arrive=resolve),released=new Promise(resolve=>resume=resolve);
   runtimePool.connect=function(callback){
    if(callback)return connect(callback);
    return connect().then(client=>{
     if(!clients.has(client)){
      const query=client.query;clients.set(client,query);
      client.query=function(...args){
       const result=query.apply(this,args),sql=typeof args[0]==='string'?args[0]:args[0]?.text;
       if(armed&&sql?.includes('xmin::text AS edit_revision')&&!sql.includes('FOR UPDATE')&&args[1]?.[0]===created.id){
        armed=false;return result.then(async value=>{arrive();await released;return value;});
       }
       return result;
      };
     }
     return client;
    });
   };
   let pending;
   try{
    pending=request(path);
    await Promise.race([paused,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Did not reach the deterministic read pause')),5000);timer.unref();})]);
    await patch(firstChapter,{content:'Changed during GET'});resume();const during=await pending;
    assert.equal(during.editRevision,before.editRevision);assert.equal(during.chapters.find(c=>c.id===originalIds[0]).content,oldBody,'Do not combine an old token with a new chapter body.');
    current=await request(path);assert.notEqual(current.editRevision,during.editRevision);assert.equal(current.chapters.find(c=>c.id===originalIds[0]).content,'Changed during GET');
    await conflict(()=>post(path+'/chapters',{...chapter,...guard(during)},409));
   }finally{resume();if(pending)await pending.catch(()=>{});runtimePool.connect=connect;for(const [client,query] of clients)client.query=query;}
   const progress=(await pool.query('SELECT completed FROM learning_progress WHERE chapter_id=$1 AND identity_id=$2',[originalIds[0],users.student.identityId])).rows;
   assert.deepEqual(progress,[{completed:true}]);
   const stored=(await pool.query('SELECT id FROM learning_chapters WHERE path_id=$1 AND id=ANY($2::uuid[])',[created.id,originalIds])).rows;assert.equal(stored.length,2);
  });
  await t.test('publishing a prepared practice bundle invalidates the draft when it attaches chapter exercises',async()=>{
   // A prepared fixture isolates publication/linking; this test does not run
   // or claim to validate a reference program through the judge.
   const {rows:[{id:problemId}]}=await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[users.owner.id]);
   const {rows:[{id:versionId}]}=await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,
    time_limit_ms,memory_limit_mb,reference_code,validation_status,samples)
    VALUES($1,'Prepared exercise','stdio','Echo an integer.',1000,64,'print(input())','AC',$2) RETURNING id`,
    [problemId,JSON.stringify([{input:'5',expected:'5'}])]);
   await pool.query('UPDATE learning_paths SET practice_bundle=$2 WHERE id=$1',[created.id,JSON.stringify([{problemId,versionId,chapterId:originalIds[0]}])]);
   const before=await request(path),after=await post(path+'/python-exercises/publish',{});
   assert.notEqual(after.editRevision,before.editRevision);
   assert.ok(after.chapters.find(c=>c.id===originalIds[0]).problems.some(p=>p.problemId===problemId));
   await conflict(()=>post(path+'/chapters',{...chapter,...guard(before)},409));
  });
 }finally{if(server)await server.close();await pool.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
