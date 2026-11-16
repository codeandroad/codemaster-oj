import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {LEGACY_SCHOOL_ID,provisionSchool} from '../../../packages/domain/src/schools.mjs';
import {validateAnswers} from '../../../packages/domain/src/written-paper-model.mjs';

test('written-paper real Nest transport, school permissions, immutable versions and grading lifecycle',{skip:!process.env.TEST_DATABASE_URL,timeout:180000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(base.href),schema=`written_${randomBytes(5).toString('hex')}`;
 const scoped=new URL(base);scoped.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(scoped.href),asRole=role=>{const u=new URL(scoped);u.searchParams.set('options',`-crole=${role} -csearch_path=${schema}`);return u.href;};
 let server,worker,app;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),hash=await hashPassword(password),users={};
  for(const name of ['teacher','student','other','outsider']){
   const identity=randomUUID();await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)',[identity,name==='teacher'?'teacher':'student',`written-${name}`]);
   const u=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity,`written-${name}`,hash])).rows[0];users[name]={...u,identity,username:`written-${name}`};
   if(name!=='outsider'){await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[u.id,name==='teacher'?'teacher':'student']);await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[u.id]);await pool.query('INSERT INTO legacy_school_identity_ownership(identity_id) VALUES($1) ON CONFLICT DO NOTHING',[identity]);}
  }
  const school=await provisionSchool(pool,{slug:'written-school',name:'Written QA',adminUsername:users.teacher.username});
  for(const name of ['student','other'])await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[school.id,users[name].id]);
  const origin='http://written.test',config=loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'});
  server=await createApiApplication({databaseUrl:asRole('campus_app'),logger:false,config});await server.listen(0,'127.0.0.1');const host=await server.getUrl();
  const auth={};
  async function request(path,{who='teacher',method='GET',body,status=200,csrf=true,binary=false}={}){
   const session=auth[who];const response=await fetch(`${host}/api/v1${path}`,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session.cookie,...(csrf?{'X-CSRF-Token':session.csrfToken}:{})}:{})},body:body?JSON.stringify(body):undefined});
   const data=binary?Buffer.from(await response.arrayBuffer()):await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${path}: ${response.status} ${JSON.stringify(data.error??{})}`);return {data,headers:response.headers};
  }
  for(const [name,u]of Object.entries(users)){const login=await request('/auth/login',{who:'none',method:'POST',body:{username:u.username,password}});auth[name]={cookie:login.headers.get('set-cookie').split(';')[0],csrfToken:login.data.csrfToken};}
  const pack=JSON.parse(await readFile(process.env.PAPER1_PACKAGE,'utf8')),root=`/schools/${school.id}/written-papers`;
  let paperId,versionId,attemptId,attachmentId;
  await t.test('import preview is read-only, guarded and publication is explicit',async()=>{
   await request(root,{who:'none',status:401});await request(root,{who:'outsider',status:404});
   await request(`${root}/import-preview`,{who:'student',method:'POST',body:{package:pack},status:403});
   const preview=await request(`${root}/import-preview`,{method:'POST',body:{package:pack}});
   await request(`${root}/import`,{method:'POST',body:{package:pack,contentHash:preview.data.contentHash},csrf:false,status:403});
   const imported=await request(`${root}/import`,{method:'POST',body:{package:pack,contentHash:preview.data.contentHash},status:201});({paperId,versionId}=imported.data);
   assert.equal((await request(root,{who:'student'})).data.items.length,0);
   await request(`${root}/${paperId}`,{who:'student',status:404});
   assert.equal((await request(`${root}/import`,{method:'POST',body:{package:pack,contentHash:preview.data.contentHash}})).data.imported,false);
   await request(`${root}/${paperId}/publish`,{who:'student',method:'POST',body:{versionId},status:403});
   await request(`${root}/${paperId}/publish`,{method:'POST',body:{versionId}});
   const detail=await request(`${root}/${paperId}`,{who:'student'});assert.equal(detail.data.definition.questions.length,29);assert.ok(!JSON.stringify(detail.data).includes('rubric'));assert.match(detail.headers.get('cache-control'),/no-store/);
   await request(`${root}/${paperId}/assets/mark-scheme?versionId=${versionId}`,{who:'student',status:404});
   const source=await request(`${root}/${paperId}/assets/question-paper?versionId=${versionId}`,{who:'student',binary:true});assert.equal(source.data.toString('ascii',0,5),'%PDF-');assert.match(source.headers.get('content-disposition'),/^attachment/);
  });
  await t.test('draft saving, attachments, concurrency and submission do not leak across students',async()=>{
   const requestId=randomUUID();const started=await request(`${root}/${paperId}/attempts`,{who:'student',method:'POST',body:{versionId,requestId},status:201});attemptId=started.data.id;
   assert.equal((await request(`${root}/${paperId}/attempts`,{who:'student',method:'POST',body:{versionId,requestId}})).data.id,attemptId);
   await request(`${root}/attempts/${attemptId}`,{who:'other',status:404});await request(`${root}/attempts/${attemptId}`,{status:404});
   const png=pack.assets.find(a=>a.mimeType==='image/png').contentBase64;
   attachmentId=(await request(`${root}/attempts/${attemptId}/attachments`,{who:'student',method:'POST',body:{questionId:'q6d',requestId:randomUUID(),contentBase64:png},status:201})).data.id;
   await request(`${root}/attempts/${attemptId}/attachments/${attachmentId}`,{who:'other',status:404});
   const answers=validateAnswers(pack,{});answers.q2a.values={binary:'0010 0010 1110',hex:'22e'};answers.q6d.attachments=[attachmentId];answers.q1c.working='saved working';answers.q1c.flagged=true;
   const save={expectedRevision:0,requestId:randomUUID(),answers};
   assert.equal((await request(`${root}/attempts/${attemptId}/answers`,{who:'student',method:'PATCH',body:save})).data.revision,1);
   assert.equal((await request(`${root}/attempts/${attemptId}/answers`,{who:'student',method:'PATCH',body:save})).data.revision,1);
   await request(`${root}/attempts/${attemptId}/answers`,{who:'student',method:'PATCH',body:{...save,requestId:randomUUID()},status:409});
   const loaded=(await request(`${root}/attempts/${attemptId}`,{who:'student'})).data;assert.equal(loaded.answers.q1c.working,'saved working');assert.ok(loaded.answers.q1c.flagged);assert.deepEqual(loaded.answers.q6d.attachments,[attachmentId]);
   await request(`${root}/attempts/${attemptId}/submit`,{who:'student',method:'POST',body:{versionId,expectedRevision:0,confirmIncomplete:true},status:409});
   await request(`${root}/attempts/${attemptId}/submit`,{who:'student',method:'POST',body:{versionId,expectedRevision:1},status:400});
   const submitted=await request(`${root}/attempts/${attemptId}/submit`,{who:'student',method:'POST',body:{versionId,expectedRevision:1,confirmIncomplete:true}});assert.equal(submitted.data.state,'submitted');assert.deepEqual(submitted.data.marks,{});
   await request(`${root}/attempts/${attemptId}/answers`,{who:'student',method:'PATCH',body:{...save,requestId:randomUUID(),expectedRevision:1},status:409});
   await request(`${root}/attempts/${attemptId}/attachments`,{who:'student',method:'POST',body:{questionId:'q6d',requestId:randomUUID(),contentBase64:png},status:403});
  });
  await t.test('marking is bounded, publication freezes grades, students can reflect separately',async()=>{
   const before=(await request(`${root}/attempts/${attemptId}`)).data;assert.equal(before.suggestions.q2a.p1,1);assert.ok(before.definition.questions[0].rubric);
   await request(`${root}/attempts/${attemptId}/release`,{method:'POST',body:{expectedRevision:0},status:400});
   const marks=Object.fromEntries(pack.questions.map(q=>[q.id,{points:Object.fromEntries(q.rubric.points.map(p=>[p.id,q.id==='q2a'?1:0])),feedback:q.id==='q1c'?'Explain interrupt priorities.':''}]));
   const body={expectedRevision:0,requestId:randomUUID(),marks};
   await request(`${root}/attempts/${attemptId}/marks`,{who:'student',method:'PATCH',body,status:403});
   const invalid=structuredClone(body);invalid.marks.q2a.points.p1=2;await request(`${root}/attempts/${attemptId}/marks`,{method:'PATCH',body:invalid,status:400});
   await request(`${root}/attempts/${attemptId}/marks`,{method:'PATCH',body});await request(`${root}/attempts/${attemptId}/marks`,{method:'PATCH',body});
   await request(`${root}/attempts/${attemptId}/marks`,{method:'PATCH',body:{...body,requestId:randomUUID()},status:409});
   const hidden=(await request(`${root}/attempts/${attemptId}`,{who:'student'})).data;assert.equal(hidden.score,null);assert.deepEqual(hidden.marks,{});assert.ok(!JSON.stringify(hidden).includes('rubric'));
   await request(`${root}/attempts/${attemptId}/release`,{who:'student',method:'POST',body:{expectedRevision:1},status:403});
   await request(`${root}/attempts/${attemptId}/release`,{method:'POST',body:{expectedRevision:0},status:409});
   await request(`${root}/attempts/${attemptId}/release`,{method:'POST',body:{expectedRevision:1}});
   const released=(await request(`${root}/attempts/${attemptId}`,{who:'student'})).data;assert.equal(released.score,2);assert.equal(released.marks.q1c.feedback,'Explain interrupt priorities.');assert.ok(released.definition.questions[0].rubric);
   await request(`${root}/${paperId}/assets/mark-scheme?versionId=${versionId}`,{who:'student',binary:true});await request(`${root}/${paperId}/assets/mark-scheme?versionId=${versionId}`,{who:'other',status:404});
   await request(`${root}/attempts/${attemptId}/marks`,{method:'PATCH',body:{...body,expectedRevision:1,requestId:randomUUID()},status:409});
   await request(`${root}/attempts/${attemptId}/reflection`,{who:'student',method:'PATCH',body:{notes:{q1c:'Review interrupt handling'},selfMarks:{q1c:1}}});
   const reflected=(await request(`${root}/attempts/${attemptId}`,{who:'student'})).data;assert.equal(reflected.score,2);assert.equal(reflected.selfMarks.q1c,1);assert.equal(reflected.notes.q1c,'Review interrupt handling');
  });
  await t.test('content revisions preserve historical papers, attachments and released marks',async()=>{
   const revised=structuredClone(pack);revised.questions[0].statement+='\n\nRevision fixture.';
   const preview=(await request(`${root}/import-preview`,{method:'POST',body:{package:revised}})).data;
   const next=(await request(`${root}/import`,{method:'POST',body:{package:revised,contentHash:preview.contentHash},status:201})).data;assert.equal(next.paperId,paperId);assert.notEqual(next.versionId,versionId);
   await request(`${root}/${paperId}/publish`,{method:'POST',body:{versionId:next.versionId}});
   const old=(await request(`${root}/attempts/${attemptId}`,{who:'student'})).data;assert.equal(old.versionId,versionId);assert.equal(old.score,2);assert.ok(!old.definition.questions[0].statement.includes('Revision fixture'));
   await request(`${root}/attempts/${attemptId}/attachments/${attachmentId}`,{binary:true});
   await request(`${root}/${paperId}/assets/mark-scheme?versionId=${next.versionId}`,{who:'student',status:404});
  });
  await t.test('database and school isolation deny worker access, mutations of history and revoked members',async()=>{
   app=createPool(asRole('campus_app'));worker=createPool(asRole('campus_worker'));
   for(const table of ['written_papers','written_paper_versions','written_assets','written_attempts','written_attachments','written_events'])await assert.rejects(worker.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
   const connection=await app.connect();try{await connection.query('BEGIN');await connection.query("SELECT set_config('campus.school_id',$1,true)",[school.id]);await assert.rejects(connection.query("UPDATE written_attempts SET answers='{}' WHERE id=$1",[attemptId]),e=>e.code==='23514');await connection.query('ROLLBACK');}finally{connection.release();}
   await pool.query('UPDATE school_memberships SET revoked_at=now() WHERE school_id=$1 AND account_id=$2',[school.id,users.other.id]);await request(root,{who:'other',status:404});
   await request(`/schools/${LEGACY_SCHOOL_ID}/written-papers/${paperId}`,{who:'student',status:404});
  });
  if(process.env.PAPER1_QA_STATE){
   const legacy=`/schools/${LEGACY_SCHOOL_ID}/written-papers`;const preview=(await request(`${legacy}/import-preview`,{method:'POST',body:{package:pack}})).data;
   const imported=(await request(`${legacy}/import`,{method:'POST',body:{package:pack,contentHash:preview.contentHash},status:201})).data;await request(`${legacy}/${imported.paperId}/publish`,{method:'POST',body:{versionId:imported.versionId}});
   await writeFile(process.env.PAPER1_QA_STATE,JSON.stringify({schema,databaseUrl:asRole('campus_app'),config:{...config,origins:['http://localhost:3016']},users:Object.fromEntries(Object.entries(users).map(([k,u])=>[k,{username:u.username,password,id:u.id}])),schoolId:school.id,legacyPaperId:imported.paperId}),{mode:0o600});
  }
 }finally{await server?.close();await app?.end();await worker?.end();await pool.end();if(!process.env.PAPER1_QA_STATE)await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
