import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';

const upgrade='041_course_access_and_metadata.sql';
const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};

async function fixture(run,{beforeUpgrade=false}={}){
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`course_access_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let server;
 try{
  if(beforeUpgrade){await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[upgrade]);}
  await migrate(pool);const password=`fixture-${randomUUID()}`;
  await bootstrap(pool,{name:'Administrator',number:'P4-AUDIENCE-ADMIN',username:'p4-audience-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='',user;const send=async(path,body,method=body===undefined?'GET':'POST',status=200,token)=>{
   const response=await fetch(base+path,{method,headers:{Origin:'http://paper4.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':token??csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;if(data.user)user=data.user;return data;
  };return{send,get user(){return user;}};}
  const admin=client();await admin.send('/auth/login',{username:'p4-audience-admin',password});
  const actors={admin};
  for(const [tag,kind] of [['teacher','teacher'],['otherTeacher','teacher'],['classmate','student'],['cross','student'],['unassigned','student'],['excluded','student']]){
   const api=client(),person=await admin.send('/people',{kind,number:`P4-${tag}`,name:tag},'POST',201);
   await api.send('/auth/register',{kind,number:person.person.number,name:tag,activationCode:person.activationCode,username:`p4-${tag.toLowerCase()}`,password},'POST',201);actors[tag]=api;
  }
  const classA=await admin.send('/classes',{name:'Class A',teacherIds:[actors.teacher.user.identityId],studentIds:[actors.classmate.user.identityId]},'POST',201);
  const classB=await admin.send('/classes',{name:'Class B',teacherIds:[actors.otherTeacher.user.identityId],studentIds:[actors.cross.user.identityId]},'POST',201);
  await run({...actors,pool,classA,classB});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}


const iso=offset=>new Date(Date.now()+offset).toISOString();
async function course(teacher,options={}){
 const path=await teacher.send('/learning-paths',{title:'Restricted course',...options},'POST',201);
 const chapter=await teacher.send(`/learning-paths/${path.id}/chapters`,{title:'A chapter',content:'Private lesson body',checkpoint:'Practice independently',checkpointAnswer:'Learning reference answer'},'POST',201);
 return {...path,chapter};
}

test('course metadata, multi-class eligibility, hidden discovery, availability and withdrawal use normal HTTP guards',options,async()=>{
 await fixture(async({pool,teacher,otherTeacher,admin,classmate,cross,unassigned,classA,classB})=>{
  const path=await course(teacher,{authorName:'Display author',authoredAt:'2024-05-12T00:00:00Z',accessScope:'classes',classIds:[classA.id]});
  assert.equal(path.authorName,'Display author');assert.equal(path.authoredAt,'2024-05-12T00:00:00.000Z');assert.deepEqual(path.classIds,[classA.id]);
  const original=(await pool.query('SELECT owner_account_id,created_at FROM learning_paths WHERE id=$1',[path.id])).rows[0];
  await cross.send(`/learning-paths/${path.id}`,undefined,'GET',404);
  await teacher.send(`/learning-paths/${path.id}`,{classIds:[classB.id]},'PATCH',403);
  await otherTeacher.send(`/learning-paths/${path.id}`,{title:'No'},'PATCH',403);
  await classmate.send(`/learning-paths/${path.id}/publish`,{},'POST',403);
  const published=await teacher.send(`/learning-paths/${path.id}/publish`,{});assert.equal(published.published,true);
  assert.equal((await classmate.send(`/learning-paths/${path.id}`)).chapters[0].checkpointAnswer,'Learning reference answer');
  for(const reader of [cross,unassigned]){await reader.send(`/learning-paths/${path.id}`,undefined,'GET',404);await reader.send(`/chapters/${path.chapter.id}/progress`,{completed:true},'POST',404);assert.equal((await reader.send('/learning-paths')).items.some(p=>p.id===path.id),false);}
  await classmate.send(`/chapters/${path.chapter.id}/progress`,{completed:true});
  const changed=await admin.send(`/learning-paths/${path.id}`,{classIds:[classA.id,classB.id],authorName:'Edited author',authoredAt:'2023-01-01T00:00:00Z',ownerAccountId:otherTeacher.user.id,createdAt:'2000-01-01T00:00:00Z'},'PATCH');
  assert.equal(changed.chapters.length,1);assert.deepEqual(new Set(changed.classIds),new Set([classA.id,classB.id]));
  assert.equal((await cross.send(`/learning-paths/${path.id}`)).authorName,'Edited author');
  assert.deepEqual((await pool.query('SELECT owner_account_id,created_at FROM learning_paths WHERE id=$1',[path.id])).rows[0],original);
  await assert.rejects(pool.query('UPDATE learning_paths SET owner_account_id=$2 WHERE id=$1',[path.id,otherTeacher.user.id]),/immutable/);
  await teacher.send(`/learning-paths/${path.id}`,{listed:false},'PATCH');
  assert.equal((await classmate.send('/learning-paths')).items.some(p=>p.id===path.id),false);
  assert.equal((await classmate.send(`/learning-paths/${path.id}`)).id,path.id);
  await teacher.send(`/learning-paths/${path.id}`,{availableFrom:iso(3600000),availableUntil:iso(7200000)},'PATCH');
  await classmate.send(`/learning-paths/${path.id}`,undefined,'GET',404);
  await classmate.send(`/chapters/${path.chapter.id}/progress`,{completed:false},'POST',404);
  await teacher.send(`/learning-paths/${path.id}`,{availableFrom:iso(7200000),availableUntil:iso(3600000)},'PATCH',400);
  await teacher.send(`/learning-paths/${path.id}`,{availableFrom:iso(-7200000),availableUntil:iso(-3600000)},'PATCH');
  await classmate.send(`/learning-paths/${path.id}`,undefined,'GET',404);
  await teacher.send(`/learning-paths/${path.id}`,{availableFrom:null,availableUntil:null,listed:true},'PATCH');
  await teacher.send(`/learning-paths/${path.id}/unpublish`,{},'POST',403,'wrong-token');
  const withdrawn=await teacher.send(`/learning-paths/${path.id}/unpublish`,{});assert.equal(withdrawn.published,false);assert.ok(withdrawn.withdrawnAt);assert.equal(withdrawn.chapters.length,1);
  await classmate.send(`/learning-paths/${path.id}`,undefined,'GET',404);await classmate.send(`/chapters/${path.chapter.id}/progress`,{completed:false},'POST',404);
  assert.equal((await pool.query('SELECT completed FROM learning_progress WHERE chapter_id=$1',[path.chapter.id])).rows[0].completed,true);
  const restored=await teacher.send(`/learning-paths/${path.id}/publish`,{});assert.equal(restored.withdrawnAt,null);assert.equal((await classmate.send(`/learning-paths/${path.id}`)).completedChapters,1);
  await teacher.send(`/learning-paths/${path.id}`,{classIds:[]},'PATCH',409);
  assert.equal((await classmate.send(`/learning-paths/${path.id}`)).published,true);
  const empty=await course(teacher,{accessScope:'classes'});await teacher.send(`/learning-paths/${empty.id}/publish`,{},'POST',409);
  const open=await course(teacher);assert.equal(open.authorName,'teacher');await teacher.send(`/learning-paths/${open.id}/publish`,{});assert.equal((await unassigned.send(`/learning-paths/${open.id}`)).published,true);
  await admin.send(`/classes/${classA.id}/archive`,{});await admin.send(`/classes/${classB.id}/archive`,{});
  await classmate.send(`/learning-paths/${path.id}`,undefined,'GET',404);
  const historical=await teacher.send(`/learning-paths/${path.id}`,{authorName:'Historical author',accessScope:'classes',classIds:[classA.id,classB.id]},'PATCH');assert.ok(historical.classes.every(c=>c.archived));
  assert.equal((await teacher.send(`/learning-paths/${path.id}`,{archived:true},'PATCH')).archived,true);
  assert.equal((await pool.query('SELECT completed FROM learning_progress WHERE chapter_id=$1',[path.chapter.id])).rows[0].completed,true);
 });
});

test('course restrictions also protect resource discovery, task course links and class hubs without hiding assigned work',options,async()=>{
 await fixture(async({pool,teacher,admin,classmate,cross,unassigned,classA})=>{
  const path=await course(teacher,{accessScope:'classes',classIds:[classA.id]});await teacher.send(`/learning-paths/${path.id}/publish`,{});
  const resource=await teacher.send('/learning-resources',{title:'Course reference',type:'reference',content:'Restricted resource content',pathId:path.id,chapterId:path.chapter.id,scope:'school'},'POST',201);
  const privateResource=await teacher.send('/learning-resources',{title:'Teacher notes',content:'Staff secret',pathId:path.id,scope:'private'},'POST',201);
  assert.equal((await classmate.send(`/learning-resources/${resource.id}`)).content,'Restricted resource content');
  for(const reader of [cross,unassigned]){assert.equal((await reader.send('/learning-resources')).items.some(r=>r.id===resource.id),false);await reader.send(`/learning-resources/${resource.id}`,undefined,'GET',404);}
  await classmate.send(`/learning-resources/${privateResource.id}`,undefined,'GET',404);
  let hub=await classmate.send(`/classes/${classA.id}`);assert.ok(hub.courses.some(c=>c.id===path.id),'directly associated course must appear without an assignment');assert.ok(hub.resources.some(r=>r.id===resource.id));assert.ok(!hub.resources.some(r=>r.id===privateResource.id));
  await teacher.send(`/learning-paths/${path.id}`,{listed:false},'PATCH');
  hub=await classmate.send(`/classes/${classA.id}`);assert.ok(!hub.courses.some(c=>c.id===path.id));
  assert.ok(!(await classmate.send('/learning-resources')).items.some(r=>r.id===resource.id));await classmate.send(`/learning-resources/${resource.id}`);
  const problem=await teacher.send('/problems',{title:'Assigned public exercise',mode:'stdio',statement:'Print 1',samples:[{input:'',expected:'1'}],tests:[{input:'',expected:'1',weight:100}],referenceCode:'print(1)'},'POST',201);
  await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[problem.versionId]);await teacher.send(`/problems/${problem.id}/publish`,{versionId:problem.versionId});await admin.send(`/problems/${problem.id}/rank-review`,{versionId:problem.versionId,decision:'approved'},'PATCH');
  const assignment=await teacher.send('/assignments',{title:'Cross-class assigned work',classIds:[classA.id],participants:[classmate.user.identityId,cross.user.identityId,unassigned.user.identityId],coursePathId:path.id,dueAt:iso(7200000),problems:[{problemId:problem.id,points:100}],state:'Published'},'POST',201);
  const practice=await teacher.send('/timed-practices',{title:'Cross-class timed work',classIds:[],participants:[cross.user.identityId],coursePathId:path.id,startsAt:iso(-1000),endsAt:iso(7200000),durationMinutes:30,problems:[{problemId:problem.id,versionId:problem.versionId,points:100}]},'POST',201);await teacher.send(`/timed-practices/${practice.id}/publish`,{});
  for(const reader of [cross,unassigned]){const work=await reader.send(`/assignments/${assignment.id}`);assert.equal(work.id,assignment.id);assert.equal(work.coursePathId,null);assert.equal(work.courseTitle,null);assert.ok(work.problems.length);await reader.send(`/learning-paths/${path.id}`,undefined,'GET',404);}
  const timed=await cross.send(`/timed-practices/${practice.id}`);assert.equal(timed.coursePathId,null);assert.equal(timed.courseTitle,null);assert.equal(timed.id,practice.id);
  assert.equal((await classmate.send(`/assignments/${assignment.id}`)).coursePathId,path.id);
  await teacher.send(`/learning-paths/${path.id}/unpublish`,{});
  assert.equal((await classmate.send(`/assignments/${assignment.id}`)).coursePathId,null);
  hub=await classmate.send(`/classes/${classA.id}`);assert.ok(hub.assignments.some(a=>a.id===assignment.id));assert.ok(!hub.courses.some(c=>c.id===path.id));assert.ok(!hub.resources.some(r=>r.id===resource.id));assert.equal(hub.assignments.find(a=>a.id===assignment.id).courseTitle,null);
 });
});

test('display cover import is bounded and access settings never survive a document import',options,async()=>{
 await fixture(async({teacher,otherTeacher,admin,classA,classB})=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPp8AAAAASUVORK5CYII=';
  for(const coverImage of ['https://example.test/tracker.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,aGVsbG8='])await teacher.send('/learning-paths',{title:'Bad cover',coverImage},'POST',400);
  const doc={format:'codemaster-learning-path',version:1,title:'Imported display',category:'Paper 4',estimatedMinutes:30,authorName:'Original author',authoredAt:'2022-06-01T00:00:00Z',coverImage:image,accessScope:'classes',classIds:[classB.id],availableFrom:iso(7200000),listed:false,published:true,chapters:[{title:'Lesson',content:'Imported body',problemIds:[]}]};
  const imported=await teacher.send('/learning-paths/import',doc,'POST',201);
  assert.equal(imported.authorName,'Original author');assert.equal(imported.coverImage,image);assert.equal(imported.authoredAt,'2022-06-01T00:00:00.000Z');assert.equal(imported.accessScope,'school');assert.deepEqual(imported.classIds,[]);assert.equal(imported.availableFrom,null);assert.equal(imported.listed,true);assert.equal(imported.published,false);
  await otherTeacher.send(`/learning-paths/${imported.id}`,{coverImage:null},'PATCH',403);
  const changed=await admin.send(`/learning-paths/${imported.id}`,{coverImage:null},'PATCH');assert.equal(changed.coverImage,null);assert.equal(changed.chapters.length,1);
 });
});

test('course access migration preserves legacy content, progress and ownership while retaining school defaults',options,async()=>{
 await fixture(async({pool,teacher,classmate})=>{
  const path=(await pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Legacy course',now()) RETURNING *",[teacher.user.id])).rows[0];
  const chapter=(await pool.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Original lesson','Original content',0) RETURNING *",[path.id])).rows[0];
  await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[classmate.user.identityId,chapter.id]);
  const before=(await pool.query('SELECT * FROM learning_progress')).rows;
  await pool.query('DELETE FROM schema_migrations WHERE name=$1',[upgrade]);await migrate(pool);
  const after=(await pool.query('SELECT * FROM learning_paths WHERE id=$1',[path.id])).rows[0];
  for(const key of Object.keys(path))assert.deepEqual(after[key],path[key]);
  assert.equal(after.author_name,'teacher');assert.deepEqual(after.authored_at,path.created_at);assert.equal(after.access_scope,'school');assert.equal(after.listed,true);assert.equal(after.available_from,null);assert.equal(after.withdrawn_at,null);
  assert.deepEqual((await pool.query('SELECT * FROM learning_progress')).rows,before);
  const visible=await classmate.send(`/learning-paths/${path.id}`);assert.equal(visible.completedChapters,1);assert.equal(visible.chapters[0].content,chapter.content);
 },{beforeUpgrade:true});
});


test('teacher credential recovery retains the same identity course ownership and original creation metadata',options,async()=>{
 await fixture(async({pool,teacher,otherTeacher,admin,classmate,classA})=>{
  const path=await course(teacher,{accessScope:'classes',classIds:[classA.id],authorName:'Preserved display author'});await teacher.send(`/learning-paths/${path.id}/publish`,{});await classmate.send(`/chapters/${path.chapter.id}/progress`,{completed:true});
  const oldAccountId=teacher.user.id,identityId=teacher.user.identityId;
  const original=(await pool.query('SELECT created_at,authored_at,author_name FROM learning_paths WHERE id=$1',[path.id])).rows[0];
  const released=await admin.send(`/people/${identityId}/unbind`,{});
  await teacher.send('/auth/me',undefined,'GET',401);
  const reclaimed=await teacher.send('/auth/register',{kind:'teacher',number:'P4-teacher',name:'teacher',activationCode:released.activationCode,username:'course-teacher-reclaimed',password:`fixture-${randomUUID()}`},'POST',201);
  assert.equal(reclaimed.user.identityId,identityId);assert.notEqual(reclaimed.user.id,oldAccountId);
  const recovered=await teacher.send(`/learning-paths/${path.id}`);assert.equal(recovered.canEdit,true);assert.deepEqual(recovered.classIds,[classA.id]);assert.equal(recovered.authorName,'Preserved display author');
  assert.equal((await classmate.send(`/learning-paths/${path.id}`)).completedChapters,1);
  assert.equal((await pool.query('SELECT owner_account_id FROM learning_paths WHERE id=$1',[path.id])).rows[0].owner_account_id,reclaimed.user.id);
  assert.deepEqual((await pool.query('SELECT created_at,authored_at,author_name FROM learning_paths WHERE id=$1',[path.id])).rows[0],original);
  await assert.rejects(pool.query('UPDATE learning_paths SET owner_account_id=$2 WHERE id=$1',[path.id,otherTeacher.user.id]),/immutable/);
  await assert.rejects(pool.query("UPDATE learning_paths SET created_at=now()-interval '1 day' WHERE id=$1",[path.id]),/immutable/);
 });
});
