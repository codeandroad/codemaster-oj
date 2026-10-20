import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('Nest bulk solution review routes enforce authentication, CSRF, managed inventory, atomic authorization and private no-store responses',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(qa|test)(_[a-z0-9_]+)?$/i.test(url.pathname),'Use a dedicated local QA database');
 const manager=createPool(url.href),schema=`luq_publish_http_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(url.href);let app;
 try{
  await migrate(pool);
  const password=randomBytes(30).toString('base64url'),hash=await hashPassword(password),actors={};
  for(const [name,kind]of [['teacher','teacher'],['other','teacher'],['student','student'],['admin','admin']]){
   const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0].id;
   const id=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,`publish-${name}`,hash])).rows[0].id;
   await pool.query('INSERT INTO account_roles VALUES($1,$2)',[id,kind]);actors[name]={id,identityId};
  }
  async function problem(owner,title){
   const p=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner.id])).rows[0];
   const v=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,school_visible_at,rank_review_status,rank_approved_at)
    VALUES($1,$2,'stdio','Public question',1000,64,'PRIVATE_REFERENCE_SENTINEL',now(),now(),'approved',now()) RETURNING id`,[p.id,title])).rows[0];
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);
   return {problemId:p.id,versionId:v.id};
  }
  const first=await problem(actors.teacher,'Teacher first'),second=await problem(actors.teacher,'Teacher second'),foreign=await problem(actors.other,'Foreign private title');
  app=await createApiApplication({databaseUrl:url.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://publish-luq.test',COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  function client(){
   let cookie='',csrf='';
   return async(path,{body,method=body===undefined?'GET':'POST',expected=200,badCsrf=false}={})=>{
    const response=await fetch(base+'/api/v1'+path,{
     method,headers:{Origin:'http://publish-luq.test',Cookie:cookie,'X-CSRF-Token':badCsrf?'invalid':csrf,...(body===undefined?{}:{'Content-Type':'application/json'})},
     ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json();assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);
    assert.equal(response.headers.get('cache-control'),'no-store','Staff review metadata and purchased bodies must never enter shared caches');
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(data.csrfToken)csrf=data.csrfToken;return data;
   };
  }
  const inventory='/luq/contents/review?targetType=problem',endpoint='/luq/contents/batch-publish';
  const anonymous=client();
  await anonymous(inventory,{expected:401});await anonymous(endpoint,{body:{},expected:401});
  for(const [name,actor]of Object.entries(actors)){actor.call=client();await actor.call('/auth/login',{body:{username:`publish-${name}`,password}});}
  const {teacher,other,student,admin}=actors;
  await student.call(inventory,{expected:403});
  const initial=await teacher.call(inventory);
  assert.equal(initial.total,2);assert.equal(initial.counts.missing,2);
  assert.equal(JSON.stringify(initial).includes('Foreign private title'),false);
  const foreignInventory=await other.call(inventory);assert.equal(foreignInventory.total,1);
  assert.equal((await admin.call(inventory)).total,3);
  const draft=async(actor,target,body)=>actor.call('/luq/contents',{body:{...target,kind:'FULL_SOLUTION',body},expected:201});
  const firstContent=await draft(teacher,first,'REVIEWED_HTTP_SOLUTION_ONE'),secondContent=await draft(teacher,second,'REVIEWED_HTTP_SOLUTION_TWO'),foreignContent=await draft(other,foreign,'PRIVATE_FOREIGN_DRAFT');
  const review=await teacher.call(inventory),otherReview=await other.call(inventory);
  assert.deepEqual(review.counts,{published:0,draft:2,missing:0,withdrawn:0});
  for(const marker of ['REVIEWED_HTTP_SOLUTION','PRIVATE_REFERENCE','PRIVATE_FOREIGN_DRAFT','"body"'])assert.equal(JSON.stringify(review).includes(marker),false);
  const candidate=row=>({contentId:row.contentId,expectedHash:row.contentHash});
  const items=review.items.map(candidate);
  const preview=await teacher.call(`/luq/contents?problemId=${first.problemId}&versionId=${first.versionId}`);
  assert.equal(preview.items[0].body,'REVIEWED_HTTP_SOLUTION_ONE');
  assert.equal(preview.items[0].contentHash,items.find(item=>item.contentId===firstContent.id).expectedHash,'Preview and inventory share the reviewed revision hash');
  await student.call(`/luq/contents?problemId=${first.problemId}&versionId=${first.versionId}`,{expected:403});
  const request={requestId:randomUUID(),reviewed:true,items};
  await student.call(endpoint,{body:request,expected:403});
  await teacher.call(endpoint,{body:request,badCsrf:true,expected:403});
  await teacher.call(endpoint,{body:{...request,reviewed:false},expected:400});
  await teacher.call(endpoint,{body:{...request,items:[items[0],items[0]]},expected:400});
  const denied={...request,requestId:randomUUID(),items:[items[0],candidate(otherReview.items.find(row=>row.contentId===foreignContent.id))]};
  await teacher.call(endpoint,{body:denied,expected:403});
  assert.equal((await pool.query("SELECT count(*)::int n FROM luq_assistance_contents WHERE status='published'")).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_content_batches')).rows[0].n,0);
  const offeredBefore=await student.call('/luq/assistance/quote',{body:{...first,kind:'FULL_SOLUTION'}});
  assert.equal(offeredBefore.available,false);
  const ledgerBefore=(await pool.query('SELECT row_to_json(l) r FROM luq_ledger l ORDER BY id')).rows;
  const saved=await teacher.call(endpoint,{body:request});
  assert.equal(saved.publishedCount,2);assert.equal(saved.alreadyPublishedCount,0);
  assert.deepEqual(await teacher.call(endpoint,{body:{...request,items:[...items].reverse()}}),saved,'Reordered retries retain the original result');
  await teacher.call(endpoint,{body:{...request,items:[items[0]]},expected:409});
  await admin.call(endpoint,{body:request,expected:409});
  const published=await teacher.call(inventory);assert.equal(published.counts.published,2);assert.equal(published.counts.draft,0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='luq.content_batch_publish'")).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='luq.content_publish'")).rows[0].n,2);
  assert.deepEqual((await pool.query('SELECT row_to_json(l) r FROM luq_ledger l ORDER BY id')).rows,ledgerBefore,'Staff publication never spends or grants student money');
  const offered=await student.call('/luq/assistance/quote',{body:{...first,kind:'FULL_SOLUTION'}});
  assert.equal(offered.available,true);assert.equal(offered.price,8);assert.equal(Object.hasOwn(offered,'body'),false);
  await student.call('/luq/assistance/provide',{body:{...first,kind:'FULL_SOLUTION'},expected:403});
  const publicProblem=await student.call(`/problems/${first.problemId}?versionId=${first.versionId}`);
  for(const marker of ['REVIEWED_HTTP_SOLUTION','PRIVATE_REFERENCE','PRIVATE_FOREIGN_DRAFT'])assert.equal(JSON.stringify(publicProblem).includes(marker),false);
  await student.call('/luq/assistance/unlock',{body:{...first,kind:'FULL_SOLUTION',requestKey:randomUUID(),confirmedPrice:offered.price,confirmedContentId:offered.contentId}});
  assert.equal((await student.call('/luq/assistance/provide',{body:{...first,kind:'FULL_SOLUTION'}})).body,'REVIEWED_HTTP_SOLUTION_ONE');
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n,1);
  assert.notEqual(firstContent.id,secondContent.id);
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
