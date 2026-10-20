import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleLuqAssistance} from '../src/luq-assistance.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};
const rejects=(promise,status)=>assert.rejects(promise,error=>error.status===status);
function testUrl(){
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(url.pathname),'Requires a dedicated local QA database');
 return url;
}
async function fixture(run){
 const url=testUrl(),manager=createPool(url.href),schema=`luq_publish_${randomBytes(5).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(url.href);
 try{
  await migrate(pool);
  async function actor(role){
   const identity=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[role,randomUUID()])).rows[0];
   const account=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,randomUUID(),'not-a-login-fixture'])).rows[0];
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[account.id,role]);
   return {id:account.id,identityId:identity.id,roles:[role]};
  }
  const teacher=await actor('teacher'),other=await actor('teacher'),student=await actor('student'),admin=await actor('admin');
  async function call(user,path,body,method=body===undefined?'GET':'POST'){
   const url=new URL(`http://test${path}`),result=await handleLuqAssistance({pool,user,route:url.pathname,url,method,body});
   assert.ok(result,`${method} ${path} must be implemented`);return result.body;
  }
  async function problem(owner=teacher,title='Ordinary problem'){
   const p=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner.id])).rows[0];
   const v=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,school_visible_at,rank_review_status,rank_approved_at)
    VALUES($1,$2,'stdio','Public statement',1000,64,'PRIVATE_REFERENCE_DO_NOT_PUBLISH',now(),now(),'approved',now()) RETURNING id`,[p.id,title])).rows[0];
   await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);
   return {problemId:p.id,versionId:v.id};
  }
  async function paper(owner=teacher){
   const p=(await pool.query("INSERT INTO paper4_papers(owner_account_id,title,status,published_at,delivery_kind) VALUES($1,'Paper QA','published',now(),'catalog') RETURNING id",[owner.id])).rows[0];
   const definition={questions:['Q1','Q2','Q3','Q4'].map(key=>({key,title:`Question ${key}`,statement:'Public paper statement',referenceCode:'PRIVATE_PAPER_REFERENCE',stages:[{tests:['PRIVATE_HIDDEN_TEST']}]}))};
   const v=(await pool.query("INSERT INTO paper4_versions(paper_id,title,description,definition,published_at) VALUES($1,'Paper QA','',$2,now()) RETURNING id",[p.id,definition])).rows[0];
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[p.id,v.id]);
   return {paperId:p.id,versionId:v.id};
  }
  const draft=(target,body='REVIEWED_SOLUTION_SENTINEL',user=teacher,kind='FULL_SOLUTION')=>call(user,'/luq/contents',{...target,kind,body});
  const list=(type='problem',user=teacher)=>call(user,`/luq/contents/review?targetType=${type}`);
  const publish=(items,requestId=randomUUID(),user=teacher,extra={})=>call(user,'/luq/contents/batch-publish',{requestId,reviewed:true,items,...extra});
  const candidate=item=>({contentId:item.contentId,expectedHash:item.contentHash});
  const getCandidate=async(id,type='problem',user=teacher)=>candidate((await list(type,user)).items.find(item=>item.contentId===id));
  await run({pool,schema,teacher,other,student,admin,call,problem,paper,draft,list,publish,candidate,getCandidate});
 }finally{await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}

test('Luq review inventory separates published, draft, missing and withdrawn exact-version solutions without leaking private content',options,()=>fixture(async f=>{
 const published=await f.problem(),draft=await f.problem(),missing=await f.problem(),withdrawn=await f.problem();
 const publishedContent=await f.draft(published),draftContent=await f.draft(draft),withdrawnContent=await f.draft(withdrawn);
 await f.call(f.teacher,`/luq/contents/${publishedContent.id}/publish`,{reviewed:true});
 await f.pool.query("UPDATE luq_assistance_contents SET status='withdrawn' WHERE id=$1",[withdrawnContent.id]);
 // Neither a translation nor another version's solution satisfies the current solution.
 await f.draft(missing,'TRANSLATION_BODY_DO_NOT_LEAK',f.teacher,'FULL_TRANSLATION');
 const newer=(await f.pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code)
  VALUES($1,'Other version','stdio','Other statement',1000,64,'OTHER_PRIVATE_CODE') RETURNING id`,[missing.problemId])).rows[0];
 const newerContent=await f.draft({...missing,versionId:newer.id},'OTHER_VERSION_BODY');
 await f.call(f.teacher,`/luq/contents/${newerContent.id}/publish`,{reviewed:true});
 const foreign=await f.problem(f.other,'Foreign teacher title');await f.draft(foreign,'FOREIGN_BODY',f.other);
 const archived=await f.problem();await f.pool.query('UPDATE problems SET archived_at=now() WHERE id=$1',[archived.problemId]);
 const overview=await f.list();
 assert.deepEqual(overview.counts,{published:1,draft:1,missing:1,withdrawn:1});
 assert.equal(overview.total,4);assert.equal(overview.items.length,4);
 assert.equal(overview.items.find(row=>row.targetId===missing.problemId).versionId,missing.versionId);
 assert.equal(overview.items.find(row=>row.targetId===missing.problemId).contentId,null);
 assert.equal(overview.items.find(row=>row.targetId===draft.problemId).contentId,draftContent.id);
 assert.equal(overview.items.find(row=>row.targetId===published.problemId).status,'published');
 assert.equal(overview.items.find(row=>row.targetId===withdrawn.problemId).status,'withdrawn');
 for(const row of overview.items){
  assert.equal(row.targetType,'problem');
  assert.equal(Object.hasOwn(row,'body'),false);
  if(row.contentId)assert.match(row.contentHash,/^[a-f0-9]{64}$/);
 }
 for(const marker of ['REVIEWED_SOLUTION_SENTINEL','TRANSLATION_BODY','OTHER_VERSION_BODY','PRIVATE','Foreign teacher title','FOREIGN_BODY'])assert.equal(JSON.stringify(overview).includes(marker),false);
 assert.equal((await f.list('problem',f.admin)).total,5,'Administrator sees manageable foreign targets too');
 assert.equal((await f.list('problem',f.other)).total,1,'Counts must not disclose another teacher’s inventory');
 await rejects(f.list('problem',f.student),403);
 await rejects(f.list('unknown'),400);
 const unpublished=await f.problem(f.teacher,'Unpublished new problem');
 await f.pool.query('UPDATE problems SET current_version_id=NULL WHERE id=$1',[unpublished.problemId]);
 const unpublishedContent=await f.draft(unpublished,'DRAFT_FOR_NEW_PROBLEM');
 const unpublishedItem=(await f.list()).items.find(row=>row.targetId===unpublished.problemId);
 assert.equal(unpublishedItem.status,'draft','An unpublished problem without current_version_id remains reviewable');
 assert.equal(unpublishedItem.versionId,unpublished.versionId);
 assert.equal(unpublishedItem.contentId,unpublishedContent.id);

 const paper=await f.paper();
 const q1=await f.draft({...paper,questionKey:'Q1'}),q2=await f.draft({...paper,questionKey:'Q2'}),q4=await f.draft({...paper,questionKey:'Q4'});
 await f.call(f.teacher,`/luq/contents/${q1.id}/publish`,{reviewed:true});
 await f.pool.query("UPDATE luq_assistance_contents SET status='withdrawn' WHERE id=$1",[q4.id]);
 await f.paper(f.other);
 const paperOverview=await f.list('paper4');
 assert.deepEqual(paperOverview.counts,{published:1,draft:1,missing:1,withdrawn:1});
 assert.equal(paperOverview.total,4);
 assert.deepEqual(paperOverview.items.map(row=>row.questionKey).sort(),['Q1','Q2','Q3','Q4']);
 assert.ok(paperOverview.items.every(row=>row.targetId===paper.paperId&&row.versionId===paper.versionId&&row.targetType==='paper4'));
 assert.equal(paperOverview.items.find(row=>row.contentId===q2.id).questionTitle,'Question Q2');
 assert.equal(JSON.stringify(paperOverview).includes('PRIVATE'),false);
 assert.equal(JSON.stringify(paperOverview).includes('REVIEWED_SOLUTION_SENTINEL'),false);
 const sharedBank=(await f.pool.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES('Shared QA',$1,'private') RETURNING id",[f.other.id])).rows[0];
 await f.pool.query('UPDATE problems SET bank_id=$2 WHERE id=$1',[foreign.problemId,sharedBank.id]);
 await f.pool.query("INSERT INTO bank_permissions(bank_id,account_id,permission) VALUES($1,$2,'read')",[sharedBank.id,f.teacher.id]);
 assert.equal((await f.list()).items.some(row=>row.targetId===foreign.problemId),false,'Read-only bank access does not grant review access');
 await f.pool.query("UPDATE bank_permissions SET permission='edit' WHERE bank_id=$1 AND account_id=$2",[sharedBank.id,f.teacher.id]);
 const shared=(await f.list()).items.find(row=>row.targetId===foreign.problemId);
 assert.equal(shared.status,'draft','A teacher granted bank edit permission can review shared drafts');
 await f.publish([f.candidate(shared)]);
 await f.pool.query('UPDATE problem_banks SET archived_at=now() WHERE id=$1',[sharedBank.id]);
 assert.equal((await f.list()).items.some(row=>row.targetId===foreign.problemId),false,'Archived banks are excluded despite prior edit grants');
}));

test('Luq batch publication is reviewed, atomic and idempotent across concurrent calls, while preserving prices, balances and append-only history',options,()=>fixture(async f=>{
 const a=await f.problem(),b=await f.paper(),foreign=await f.problem(f.other);
 const ca=await f.draft(a),cb=await f.draft({...b,questionKey:'Q1'}),cf=await f.draft(foreign,'FOREIGN',f.other);
 await f.call(f.teacher,'/luq/policies/batch-prices',{requestId:randomUUID(),targetType:'problem',targetIds:[a.problemId],prices:{FULL_SOLUTION:5}});
 const caItem=await f.getCandidate(ca.id),cbItem=await f.getCandidate(cb.id,'paper4'),cfItem=await f.getCandidate(cf.id,'problem',f.other);
 const before=(await f.pool.query('SELECT row_to_json(p) r FROM luq_assistance_policies p ORDER BY id')).rows;
 const ledgerBefore=(await f.pool.query('SELECT row_to_json(l) r FROM luq_ledger l ORDER BY id')).rows;
 const balancesBefore=(await f.pool.query('SELECT row_to_json(a) r FROM luq_accounts a ORDER BY identity_id')).rows;
 for(const reviewed of [false,undefined,'true'])await rejects(f.publish([caItem],randomUUID(),f.teacher,{reviewed}),400);
 await rejects(f.publish([caItem],randomUUID(),f.student),403);
 const rejected=randomUUID();
 await rejects(f.publish([caItem,cfItem],rejected),403);
 assert.equal((await f.pool.query('SELECT status FROM luq_assistance_contents WHERE id=$1',[ca.id])).rows[0].status,'draft');
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_content_batches WHERE request_id=$1',[rejected])).rows[0].n,0);
 const requestId=randomUUID(),results=await Promise.all(Array.from({length:6},()=>f.publish([caItem,cbItem],requestId)));
 for(const result of results)assert.deepEqual(result,results[0]);
 assert.equal(results[0].publishedCount,2);assert.equal(results[0].alreadyPublishedCount,0);
 assert.ok(results[0].items.every(item=>item.status==='published'&&item.publishedAt));
 assert.equal(JSON.stringify(results).includes('REVIEWED_SOLUTION_SENTINEL'),false,'Publication responses must remain metadata-only');
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE action='luq.content_publish'")).rows[0].n,2);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_content_batches')).rows[0].n,1);
 await rejects(f.publish([caItem],requestId),409);
 await rejects(f.publish([caItem,cbItem],requestId,f.admin),409);
 const retry=await f.publish([caItem,cbItem]);
 assert.equal(retry.publishedCount,0);assert.equal(retry.alreadyPublishedCount,2);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE action='luq.content_publish'")).rows[0].n,2,'Previously published contents are not republished or re-audited');
 assert.deepEqual((await f.pool.query('SELECT row_to_json(p) r FROM luq_assistance_policies p ORDER BY id')).rows,before);
 assert.deepEqual((await f.pool.query('SELECT row_to_json(l) r FROM luq_ledger l ORDER BY id')).rows,ledgerBefore);
 assert.deepEqual((await f.pool.query('SELECT row_to_json(a) r FROM luq_accounts a ORDER BY identity_id')).rows,balancesBefore);
 await assert.rejects(f.pool.query('UPDATE luq_content_batches SET result=$1 WHERE request_id=$2',[{},requestId]),/append.only|immutable/i);
 await assert.rejects(f.pool.query('DELETE FROM luq_content_batches WHERE request_id=$1',[requestId]),/append.only|immutable/i);
 const concurrent=await Promise.all(Array.from({length:3},async()=>f.draft(await f.problem())));
 const candidates=await Promise.all(concurrent.map(item=>f.getCandidate(item.id)));
 await Promise.all([
  f.publish([candidates[0],candidates[1]]),
  f.publish([candidates[2],candidates[1]]),
  f.call(f.teacher,`/luq/contents/${concurrent[1].id}/publish`,{reviewed:true}),
 ]);
 const audits=(await f.pool.query("SELECT resource_id,count(*)::int n FROM audit_events WHERE action='luq.content_publish' AND resource_id=ANY($1::text[]) GROUP BY resource_id",[concurrent.map(item=>item.id)])).rows;
 assert.equal(audits.length,3);
 assert.ok(audits.every(row=>row.n===1),'Overlapping different batches and a simultaneous single publish audit each content exactly once');
}));

test('Luq batch publication rejects stale reviews, missing or withdrawn candidates and validates the complete batch before writing',options,()=>fixture(async f=>{
 const a=await f.problem(),b=await f.problem(),c=await f.problem();
 const ca=await f.draft(a,'Original reviewed body'),cb=await f.draft(b),cc=await f.draft(c);
 const original=await f.getCandidate(ca.id),other=await f.getCandidate(cb.id),withdrawn=await f.getCandidate(cc.id);
 await f.draft(a,'Edited since review');
 await rejects(f.publish([other,original]),409);
 assert.equal((await f.pool.query('SELECT status FROM luq_assistance_contents WHERE id=$1',[cb.id])).rows[0].status,'draft','A later stale candidate rolls the whole batch back');
 await f.pool.query("UPDATE luq_assistance_contents SET status='withdrawn' WHERE id=$1",[cc.id]);
 await rejects(f.publish([other,withdrawn]),409);
 await rejects(f.publish([other,{contentId:randomUUID(),expectedHash:'a'.repeat(64)}]),404);
 for(const items of [
  [],Array.from({length:501},()=>({contentId:randomUUID(),expectedHash:'a'.repeat(64)})),
  [{contentId:ca.id,expectedHash:'invalid'}],
  [other,{...other,contentId:other.contentId.toUpperCase()}],
 ])await rejects(f.publish(items),400);
 const translated=await f.draft(a,'A reviewed translation',f.teacher,'FULL_TRANSLATION');
 const hash=translated.contentHash;
 await rejects(f.publish([{contentId:translated.id,expectedHash:hash}]),400);
 const empty=await f.problem(),emptyContent=await f.draft(empty);
 await f.pool.query('UPDATE luq_assistance_contents SET body=$2 WHERE id=$1',[emptyContent.id,' \n\t ']);
 await rejects(f.publish([other,await f.getCandidate(emptyContent.id)]),409);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_assistance_contents WHERE status='published'")).rows[0].n,0);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_content_batches')).rows[0].n,0);

 // The reviewer has an old hash while a concurrent edit holds the content row.
 // Publication must recheck the locked, committed body, not the earlier snapshot.
 const current=await f.getCandidate(ca.id),blocker=await f.pool.connect();
 let publishing;
 try{
  await blocker.query('BEGIN');
  await blocker.query('UPDATE luq_assistance_contents SET body=$2,updated_at=clock_timestamp() WHERE id=$1',[ca.id,'Concurrent edit after review']);
  publishing=f.publish([current]).then(value=>({value}),error=>({error}));
  let waiting=false;
  for(let attempt=0;attempt<100&&!waiting;attempt++){
   waiting=(await f.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%luq_assistance_contents%') waiting")).rows[0].waiting;
   if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(waiting,true,'Publication must lock content against a simultaneous edit');
  await blocker.query('COMMIT');
  const result=await publishing;assert.equal(result.error?.status,409);
 }finally{await blocker.query('ROLLBACK');blocker.release();if(publishing)await publishing;}
 const row=(await f.pool.query('SELECT body,status FROM luq_assistance_contents WHERE id=$1',[ca.id])).rows[0];
 assert.equal(row.status,'draft');assert.equal(row.body,'Concurrent edit after review');
}));

test('bulk-published solutions still require student purchase and return only the requested problem version',options,()=>fixture(async f=>{
 const p=await f.problem();
 const first=await f.draft(p,'VERSION_ONE_REVIEWED_SOLUTION');
 const version2=(await f.pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,school_visible_at,rank_review_status,rank_approved_at)
  VALUES($1,'Version two','stdio','Second statement',1000,64,'PRIVATE_V2_CODE',now(),now(),'approved',now()) RETURNING id`,[p.problemId])).rows[0].id;
 const second=await f.draft({...p,versionId:version2},'VERSION_TWO_REVIEWED_SOLUTION');
 const target={...p,kind:'FULL_SOLUTION'},quote=()=>f.call(f.student,'/luq/assistance/quote',target);
 assert.equal((await quote()).available,false);
 await f.publish([await f.getCandidate(first.id)]);
 assert.equal((await quote()).available,true);
 const secondTarget={...target,versionId:version2};
 assert.equal((await f.call(f.student,'/luq/assistance/quote',secondTarget)).available,false);
 await rejects(f.call(f.student,'/luq/assistance/provide',target),403);
 const offered=await quote();
 assert.equal(Object.hasOwn(offered,'body'),false);assert.equal(offered.price,8);
 const unlocked=await f.call(f.student,'/luq/assistance/unlock',{...target,requestKey:randomUUID(),confirmedPrice:offered.price,confirmedContentId:offered.contentId});
 assert.equal(unlocked.charged,8);assert.equal(Object.hasOwn(unlocked,'body'),false);
 assert.equal((await f.call(f.student,'/luq/assistance/provide',target)).body,'VERSION_ONE_REVIEWED_SOLUTION');
 await rejects(f.call(f.student,'/luq/assistance/provide',secondTarget),404);
 await f.pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.problemId,version2]);
 await f.publish([await f.getCandidate(second.id)]);
 assert.equal((await f.call(f.student,'/luq/assistance/quote',secondTarget)).price,0,'Stable purchase crosses versions; reviewed content remains exact-version');
 assert.equal((await f.call(f.student,'/luq/assistance/provide',secondTarget)).body,'VERSION_TWO_REVIEWED_SOLUTION');
 assert.equal((await f.call(f.student,'/luq/assistance/provide',target)).body,'VERSION_ONE_REVIEWED_SOLUTION');
}));

test('Luq content batch runtime grants allow application append/read only and deny all judge-worker access',options,async()=>{
 const url=testUrl(),manager=createPool(url.href),database=`campus_test_luq_publish_roles_${randomBytes(5).toString('hex')}`;
 let pool,created=false;
 try{
  await manager.query(`DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='campus_app') THEN CREATE ROLE campus_app NOLOGIN; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='campus_worker') THEN CREATE ROLE campus_worker NOLOGIN; END IF;
  END $$`);
  await manager.query(`CREATE DATABASE ${database}`);created=true;
  url.pathname=`/${database}`;url.searchParams.delete('options');pool=createPool(url.href);await migrate(pool);
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../grants.mjs',import.meta.url))],{env:{...process.env,DATABASE_URL:url.href}});
  const identity=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('teacher','T','T') RETURNING id")).rows[0].id;
  const account=(await pool.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'publish-role-teacher','not-a-login') RETURNING id",[identity])).rows[0].id;
  async function asRole(role,sql,args=[]){
   const db=await pool.connect();
   try{await db.query('BEGIN');await db.query(`SET LOCAL ROLE ${role}`);const result=await db.query(sql,args);await db.query('COMMIT');return result;}
   catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  const requestId=randomUUID();
  await asRole('campus_app','INSERT INTO luq_content_batches(request_id,actor_account_id,request_hash,result) VALUES($1,$2,$3,$4)',[requestId,account,'f'.repeat(64),{requestId,publishedCount:0,alreadyPublishedCount:0,items:[]}]);
  assert.equal((await asRole('campus_app','SELECT count(*)::int n FROM luq_content_batches')).rows[0].n,1);
  await assert.rejects(asRole('campus_app','UPDATE luq_content_batches SET result=$1',[{}]),error=>error.code==='42501');
  await assert.rejects(asRole('campus_app','DELETE FROM luq_content_batches'),error=>error.code==='42501');
  await assert.rejects(asRole('campus_worker','SELECT * FROM luq_content_batches'),error=>error.code==='42501');
  await assert.rejects(asRole('campus_worker','INSERT INTO luq_content_batches(request_id,actor_account_id,request_hash,result) VALUES($1,$2,$3,$4)',[randomUUID(),account,'e'.repeat(64),{}]),error=>error.code==='42501');
  await assert.rejects(asRole('campus_worker','UPDATE luq_content_batches SET result=$1',[{}]),error=>error.code==='42501');
  await assert.rejects(asRole('campus_worker','DELETE FROM luq_content_batches'),error=>error.code==='42501');
 }finally{if(pool)await pool.end();if(created)await manager.query(`DROP DATABASE ${database}`);await manager.end();}
});
