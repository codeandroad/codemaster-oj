import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleLuqAssistance} from '../src/luq-assistance.mjs';
import {canonicalHash} from '../src/security.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);
async function fixture(run){
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(url.pathname));
 const manager=createPool(url.href),schema=`luq_prices_${randomBytes(5).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);
 try{
  await migrate(pool);
  async function actor(role){
   const identity=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[role,randomUUID()])).rows[0];
   const account=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,randomUUID(),'not-a-login-fixture'])).rows[0];
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[account.id,role]);return {id:account.id,identityId:identity.id,roles:[role]};
  }
  const teacher=await actor('teacher'),otherTeacher=await actor('teacher'),student=await actor('student');
  const definition={questions:[{key:'Q1',title:'One',statement:'Public statement'},{key:'Q2',title:'Two',statement:'Public statement two'}]};
  async function paper(owner=teacher,source=null,activityKind='practice'){
   const p=(await pool.query(`INSERT INTO paper4_papers(owner_account_id,title,status,published_at,delivery_kind,activity_kind,source_paper_id,source_version_id)
    VALUES($1,'Paper','published',clock_timestamp(),$2,$3,$4,$5) RETURNING id`,[owner.id,source?'activity':'catalog',source?activityKind:null,source?.paperId??null,source?.versionId??null])).rows[0];
   const v=(await pool.query(`INSERT INTO paper4_versions(paper_id,title,description,definition,published_at) VALUES($1,'Paper','',$2,clock_timestamp()) RETURNING id`,[p.id,definition])).rows[0];
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);
   if(source)await pool.query('INSERT INTO paper4_activity_participants(paper_id,identity_id) VALUES($1,$2)',[p.id,student.identityId]);
   const a=(await pool.query('INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id) VALUES($1,$2,$3,$4) RETURNING id',[p.id,v.id,student.identityId,student.id])).rows[0];
   return {paperId:p.id,versionId:v.id,questionKey:'Q1',paper4AttemptId:a.id};
  }
  async function call(user,path,body,method='POST'){
   const url=new URL(`http://test${path}`);const result=await handleLuqAssistance({pool,user,route:url.pathname,url,method,body});assert.ok(result);return result.body;
  }
  async function publish(p,kind='FULL_TRANSLATION'){
   const draft=await call(teacher,'/luq/contents',{paperId:p.paperId,versionId:p.versionId,questionKey:p.questionKey,kind,body:'REVIEWED_CONTENT_ONLY'});
   await call(teacher,`/luq/contents/${draft.id}/publish`,{reviewed:true});
  }
  const batch=(papers,prices,requestId=randomUUID(),user=teacher)=>call(user,'/luq/policies/batch-prices',{requestId,targetType:'paper4',targetIds:papers.map(p=>p.paperId),prices});
  const target=p=>({paper4AttemptId:p.paper4AttemptId,questionKey:p.questionKey,kind:'FULL_TRANSLATION'});
  const quote=p=>call(student,'/luq/assistance/quote',target(p));
  const policies=p=>call(teacher,`/luq/policies?targetType=paper4&targetId=${p.paperId}`,undefined,'GET');
  const unlock=(p,q)=>call(student,'/luq/assistance/unlock',{...target(p),requestKey:randomUUID(),confirmedPrice:q.price,confirmedContentId:q.contentId});
  await run({pool,teacher,otherTeacher,student,paper,call,publish,batch,target,quote,policies,unlock});
 }finally{await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}

test('Luq batch prices are atomic, idempotent under concurrency and retain independently configured policies',options,()=>fixture(async f=>{
 const a=await f.paper(),b=await f.paper(),foreign=await f.paper(f.otherTeacher);
 const opensAt=new Date(Date.now()+3600000).toISOString();
 await f.call(f.teacher,'/luq/policies',{targetType:'paper4',targetId:a.paperId,kind:'FULL_TRANSLATION',mode:'paid',opensAt});
 await f.call(f.teacher,'/luq/policies',{targetType:'paper4',targetId:b.paperId,kind:'FULL_SOLUTION',mode:'disabled'});
 const requestId=randomUUID(),prices={FULL_TRANSLATION:5,FULL_SOLUTION:9};
 const results=await Promise.all(Array.from({length:6},()=>f.batch([a,b],prices,requestId)));
 assert.ok(results.every(r=>r.items.length===4));
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_price_batches')).rows[0].n,1);
 let pa=await f.policies(a),pb=await f.policies(b);
 assert.equal(pa.items.find(i=>i.kind==='FULL_TRANSLATION').price,5);
 assert.equal(new Date(pa.items.find(i=>i.kind==='FULL_TRANSLATION').opensAt).toISOString(),opensAt);
 assert.equal(pb.items.find(i=>i.kind==='FULL_SOLUTION').mode,'disabled');
 assert.equal(pb.items.find(i=>i.kind==='FULL_SOLUTION').price,9);
 await rejects(f.batch([a,b],{FULL_TRANSLATION:6},requestId),'IDEMPOTENCY_CONFLICT');
 await rejects(f.batch([a],prices,randomUUID(),f.student),'FORBIDDEN');
 await rejects(f.batch([a,foreign],prices),'FORBIDDEN');
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_policies')).rows[0].n,6,'mixed unauthorized batch does not partially apply');
 await Promise.all([f.batch([a,b],{FULL_TRANSLATION:6}),f.batch([b,a],{FULL_TRANSLATION:7})]);
 pa=await f.policies(a);pb=await f.policies(b);
 assert.equal(pa.items.find(i=>i.kind==='FULL_TRANSLATION').price,pb.items.find(i=>i.kind==='FULL_TRANSLATION').price);
 assert.equal(pa.items.find(i=>i.kind==='FULL_TRANSLATION').ruleVersion,4);
 await assert.rejects(f.pool.query('DELETE FROM luq_price_batches'),/append.only|immutable/i);
 for(const value of [-1,1001,1.5,'8'])await rejects(f.batch([a],{FULL_TRANSLATION:value}),'VALIDATION');
}));

test('Luq price changes invalidate old confirmations without double charging purchased rights',options,()=>fixture(async f=>{
 const p=await f.paper();await f.publish(p);const before=await f.quote(p);
 assert.equal(before.price,3);assert.equal(before.balance,100);assert.equal(JSON.stringify(before).includes('REVIEWED_CONTENT'),false);
 await f.batch([p],{FULL_TRANSLATION:4});
 await rejects(f.unlock(p,before),'QUOTE_CHANGED');
 assert.equal((await f.quote(p)).balance,100);
 const current=await f.quote(p),results=await Promise.all(Array.from({length:5},()=>f.unlock(p,current)));
 assert.equal(results.reduce((sum,r)=>sum+r.charged,0),4);
 await f.batch([p],{FULL_TRANSLATION:10,FULL_SOLUTION:12});
 assert.equal((await f.quote(p)).price,0);assert.equal((await f.quote(p)).balance,96);
 assert.equal((await f.call(f.student,'/luq/assistance/provide',f.target(p))).body,'REVIEWED_CONTENT_ONLY');
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_assistance_deliveries WHERE kind='FULL_SOLUTION'")).rows[0].n,0);
 const q2={...p,questionKey:'Q2'};await f.publish(q2);assert.equal((await f.quote(q2)).price,10,'price applies to each big question, rights remain separate');
 await f.batch([p],{FULL_TRANSLATION:null});assert.equal((await f.quote(q2)).price,3);
 await f.batch([p],{FULL_TRANSLATION:0});assert.equal((await f.quote(q2)).mode,'free');
 await f.call(f.student,'/luq/assistance/provide',f.target(q2));
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements')).rows[0].n,1,'zero-price viewing does not mint permanent purchases');
 const missing=await f.paper();await f.batch([missing],{FULL_TRANSLATION:4});
 assert.equal((await f.quote(missing)).available,false);await rejects(f.unlock(missing,await f.quote(missing)),'ASSISTANCE_UNAVAILABLE');
}));

test('Luq catalog prices follow immutable activity copies but never bypass exam or opening restrictions',options,()=>fixture(async f=>{
 const p=await f.paper();await f.publish(p);await f.batch([p],{FULL_TRANSLATION:6});
 const activity=await f.paper(f.teacher,p);assert.equal((await f.quote(activity)).price,6);
 await f.unlock(p,await f.quote(p));assert.equal((await f.quote(activity)).price,0);
 const exam=await f.paper(f.teacher,p,'exam');
 await f.batch([p],{FULL_TRANSLATION:0});
 for(const entry of [p,activity,exam]){
  assert.equal((await f.quote(entry)).available,false);
  await rejects(f.call(f.student,'/luq/assistance/provide',f.target(entry)),'ASSISTANCE_LOCKED');
 }
 await f.pool.query('UPDATE paper4_papers SET archived_at=clock_timestamp() WHERE id=$1',[exam.paperId]);
 await f.call(f.teacher,'/luq/policies',{targetType:'paper4',targetId:p.paperId,kind:'FULL_TRANSLATION',mode:'paid',opensAt:new Date(Date.now()+60000).toISOString()});
 await f.batch([p],{FULL_TRANSLATION:1});
 assert.equal((await f.quote(p)).available,false,'batch price retains future opening');
}));

test('Luq batch pricing reports safe current-version publication metadata without publishing, leaking bodies or changing replay results',options,()=>fixture(async f=>{
 const paper=await f.paper();
 const draft=await f.call(f.teacher,'/luq/contents',{paperId:paper.paperId,versionId:paper.versionId,questionKey:'Q1',kind:'FULL_SOLUTION',body:'DRAFT_BODY_MUST_NOT_APPEAR'});
 await f.publish({...paper,questionKey:'Q2'},'FULL_TRANSLATION');
 const requestId=randomUUID();
 const saved=await f.batch([paper],{FULL_TRANSLATION:3,FULL_SOLUTION:8},requestId);
 assert.deepEqual(saved.publication.find(i=>i.kind==='FULL_SOLUTION'),{
  kind:'FULL_SOLUTION',total:2,published:0,draft:1,withdrawn:0,missing:1,firstUnpublished:{targetId:paper.paperId,questionKey:'Q1'},
 });
 assert.deepEqual(saved.publication.find(i=>i.kind==='FULL_TRANSLATION'),{
  kind:'FULL_TRANSLATION',total:2,published:1,draft:0,withdrawn:0,missing:1,firstUnpublished:{targetId:paper.paperId,questionKey:'Q1'},
 });
 assert.equal((await f.pool.query('SELECT status FROM luq_assistance_contents WHERE id=$1',[draft.id])).rows[0].status,'draft','Pricing never publishes a draft');
 const serialized=JSON.stringify(saved);
 assert.ok(!serialized.includes('DRAFT_BODY_MUST_NOT_APPEAR')&&!serialized.includes('REVIEWED_CONTENT_ONLY')&&!serialized.includes('"body"'),'Only publication counts and safe target identifiers are returned');
 await f.call(f.teacher,`/luq/contents/${draft.id}/publish`,{reviewed:true});
 assert.deepEqual(await f.batch([paper],{FULL_TRANSLATION:3,FULL_SOLUTION:8},requestId),saved,'Replay keeps the original publication snapshot');
 const refreshed=await f.batch([paper],{FULL_SOLUTION:8});
 assert.equal(refreshed.publication.length,1,'Report only requested assistance kinds');
 assert.equal(refreshed.publication[0].published,1);
 assert.equal(refreshed.publication[0].firstUnpublished.questionKey,'Q2');

 const problem=(await f.pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[f.teacher.id])).rows[0];
 const version=(await f.pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code)
  VALUES($1,'Current question','stdio','Statement',1000,64,'PRIVATE_REFERENCE_SENTINEL') RETURNING id`,[problem.id])).rows[0];
 await f.pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problem.id,version.id]);
 const newer=(await f.pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,created_at)
  VALUES($1,'Newer draft','stdio','Statement',1000,64,'OTHER_PRIVATE_REFERENCE',clock_timestamp()+interval '1 second') RETURNING id`,[problem.id])).rows[0];
 const newerContent=await f.call(f.teacher,'/luq/contents',{problemId:problem.id,versionId:newer.id,kind:'FULL_SOLUTION',body:'UNRELATED_NEWER_VERSION_BODY'});
 await f.call(f.teacher,`/luq/contents/${newerContent.id}/publish`,{reviewed:true});
 const request={requestId:randomUUID(),targetType:'problem',targetIds:[problem.id],prices:{FULL_SOLUTION:5}};
 const current=await f.call(f.teacher,'/luq/policies/batch-prices',request);
 assert.deepEqual(current.publication,[{kind:'FULL_SOLUTION',total:1,published:0,draft:0,withdrawn:0,missing:1,firstUnpublished:{targetId:problem.id}}],'Newer-version publication must not imply the current version is available');
 assert.ok(!JSON.stringify(current).includes('REFERENCE')&&!JSON.stringify(current).includes('VERSION_BODY'));
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_contents WHERE version_id=$1',[version.id])).rows[0].n,0,'Pricing neither copies private reference code nor copies another version');

 const legacyId=randomUUID(),legacyResult={requestId:legacyId,count:1,items:[]};
 await f.pool.query('INSERT INTO luq_price_batches(request_id,actor_account_id,request_hash,result) VALUES($1,$2,$3,$4)',[
  legacyId,f.teacher.id,canonicalHash({actor:f.teacher.id,targetType:'problem',targetIds:[problem.id],prices:{FULL_SOLUTION:5}}),legacyResult,
 ]);
 assert.deepEqual(await f.call(f.teacher,'/luq/policies/batch-prices',{...request,requestId:legacyId}),legacyResult,'Pre-upgrade idempotency records remain unchanged even without publication metadata');
}));
