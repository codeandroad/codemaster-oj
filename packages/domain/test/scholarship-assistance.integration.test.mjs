import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool,transaction} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleScholarshipAssistance} from '../src/scholarship-assistance.mjs';
import {postScholarshipEntry,handleScholarshipLedger} from '../src/scholarship-ledger.mjs';
import {handleEducation} from '../src/education.mjs';

const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};
async function fixture(run){
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(?:qa|test)(?:_[A-Za-z0-9_]+)?$/.test(url.pathname),'Requires a dedicated local QA database');
 const manager=createPool(url.href),schema=`luq_assistance_${randomBytes(5).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(url.href);
 try{
  await migrate(pool);
  // Keep exact-funds/insufficient-funds assertions independent of the initial
  // allowance, covered separately by luq-initial-grant.integration.test.mjs.
  await pool.query('UPDATE luq_settings SET initial_grant=0,rule_version=rule_version+1 WHERE singleton');
  const actor=async role=>{
   const identity=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[role,`${role}-${randomUUID()}`])).rows[0];
   const account=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,randomUUID(),'not-a-login-fixture'])).rows[0];
   await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[account.id,role]);return {id:account.id,identityId:identity.id,roles:[role]};
  };
  const teacher=await actor('teacher'),otherTeacher=await actor('teacher'),student=await actor('student'),otherStudent=await actor('student'),admin=await actor('admin');
  async function version(problemId,referenceCode='PRIVATE_REFERENCE',editorial='',{published=true,approved=true}={}){
   const v=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,metadata,validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at)
    VALUES($1,'Test','stdio','Public statement',1000,128,$2,$3,'AC',CASE WHEN $4 THEN clock_timestamp() END,CASE WHEN $4 AND $5 THEN clock_timestamp() END,CASE WHEN $5 THEN 'approved' ELSE 'pending' END,CASE WHEN $4 AND $5 THEN clock_timestamp() END) RETURNING id`,[problemId,referenceCode,{editorial},published,approved])).rows[0];
   return {problemId,versionId:v.id};
  }
  async function problem(){const p=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[teacher.id])).rows[0];const target=await version(p.id);await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[p.id,target.versionId]);return target;}
  async function call(user,route,body,method='POST'){
   const url=new URL(`http://luq.test${route}`);const result=await handleScholarshipAssistance({pool,user,route:url.pathname,url,method,body});assert.ok(result);return result.body;
  }
  async function publish(target,kind='FULL_SOLUTION',text='Published explanation\n```python\nprint(1)\n```'){
   const existing=kind==='FULL_SOLUTION'?(await call(teacher,'/scholarship/contents?'+new URLSearchParams(target),undefined,'GET')).items.find(item=>item.kind===kind):null;
   const input=existing?{solutions:[{title:'Main approach',body:text}],expectedHash:existing.contentHash}:{body:text};
   const draft=await call(teacher,'/scholarship/contents',{...target,kind,...input});
   await call(teacher,`/scholarship/contents/${draft.id}/publish`,{reviewed:true,expectedHash:draft.contentHash});return draft;
  }
  async function grant(user,amount){return transaction(pool,db=>postScholarshipEntry(db,{identityId:user.identityId,delta:amount,kind:'admin_grant',sourceKey:randomUUID(),reason:'Test grant',actorAccountId:admin.id}));}
  async function refund(user,entry){return transaction(pool,db=>postScholarshipEntry(db,{identityId:user.identityId,delta:-entry.delta,kind:'refund',sourceKey:`refund:${entry.id}`,refundOf:entry.id,reason:'Test refund',actorAccountId:admin.id}));}
  const quote=(user,target,kind='FULL_SOLUTION')=>call(user,'/scholarship/assistance/quote',{...target,kind});
  const provide=(user,target,kind='FULL_SOLUTION')=>call(user,'/scholarship/assistance/provide',{...target,kind});
  async function unlock(user,target,kind='FULL_SOLUTION',requestKey=randomUUID()){
   const q=await quote(user,target,kind);return call(user,'/scholarship/assistance/unlock',{...target,kind,requestKey,confirmedPrice:q.price,confirmedContentId:q.contentId});
  }
  async function submit(user,target){return (await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','print(1)',$5,'fixture') RETURNING *`,[user.id,user.identityId,target.problemId,target.versionId,randomUUID()])).rows[0];}
  await run({pool,teacher,otherTeacher,student,otherStudent,admin,call,problem,version,publish,grant,refund,quote,provide,unlock,submit});
 }finally{await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('policy price displays track school defaults without converting inherited prices into overrides',options,async()=>fixture(async f=>{
 const target=await f.problem();
 const path=`/scholarship/policies?targetType=problem&targetId=${target.problemId}`;
 const read=async()=>Object.fromEntries((await f.call(f.teacher,path,undefined,'GET')).items.map(item=>[item.kind,item]));
 const settings=async(translationPrice,solutionPrice)=>handleScholarshipLedger({pool:f.pool,user:f.admin,route:'/scholarship/settings',method:'PATCH',body:{translationPrice,solutionPrice}});
 await settings(7,13);
 let policies=await read();
 assert.equal(policies.FULL_TRANSLATION.defaultPrice,7);
 assert.equal(policies.FULL_TRANSLATION.effectivePrice,7);
 assert.equal(policies.FULL_SOLUTION.defaultPrice,13);
 assert.equal(policies.FULL_SOLUTION.effectivePrice,13);
 assert.equal(policies.FULL_SOLUTION.price,null);
 assert.equal((await f.pool.query('SELECT count(*)::int count FROM luq_assistance_policies')).rows[0].count,0,'reading numeric defaults does not create overrides');
 await settings(9,17);
 policies=await read();
 assert.equal(policies.FULL_TRANSLATION.effectivePrice,9);
 assert.equal(policies.FULL_SOLUTION.effectivePrice,17,'an inherited price follows the current setting');
 const save=body=>f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',...body});
 await save({price:0});
 policies=await read();
 assert.equal(policies.FULL_SOLUTION.price,0);
 assert.equal(policies.FULL_SOLUTION.effectivePrice,0,'zero is a custom price, not a missing price');
 await settings(11,19);
 assert.equal((await read()).FULL_SOLUTION.effectivePrice,0);
 await save({price:null});
 policies=await read();
 assert.equal(policies.FULL_SOLUTION.price,null);
 assert.equal(policies.FULL_SOLUTION.effectivePrice,19);
 await save({mode:'free'});
 await f.publish(target);
 assert.equal((await read()).FULL_SOLUTION.effectivePrice,19,'the display metadata is the paid base price even in free mode');
 assert.equal((await f.quote(f.student,target)).price,0,'free access still quotes zero');
 assert.equal((await f.pool.query("SELECT count(*)::int count FROM luq_ledger WHERE kind='purchase'")).rows[0].count,0);
 await rejects(f.call(f.student,path,undefined,'GET'),'FORBIDDEN');
 await rejects(f.call(f.otherTeacher,path,undefined,'GET'),'FORBIDDEN');
}));

test('original solution source is read-only, exact-version and available only to authorized authors',options,async()=>fixture(async f=>{
 const original=await f.problem();
 const latest=await f.version(original.problemId,'NEW_PRIVATE_REFERENCE','New private explanation.');
 await f.pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[original.problemId,latest.versionId]);
 const course=(await f.pool.query("INSERT INTO learning_paths(owner_account_id,title) VALUES($1,'Pinned course') RETURNING id",[f.teacher.id])).rows[0];
 const chapters=(await f.pool.query("INSERT INTO learning_chapters(path_id,title,position) SELECT $1,'Pinned chapter',position FROM generate_series(0,1) position RETURNING id",[course.id])).rows;
 for(const chapter of chapters)await f.pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapter.id,original.problemId,original.versionId]);
 const snapshot=async()=>({
  versions:(await f.pool.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY id',[original.problemId])).rows,
  contents:(await f.pool.query('SELECT * FROM luq_assistance_contents WHERE subject_key=$1 ORDER BY id',[`problem:${original.problemId}`])).rows,
 });
 const before=await snapshot();
 const detail=target=>'/scholarship/contents?'+new URLSearchParams(target);
 const earlier=await f.call(f.teacher,detail(original),undefined,'GET');
 assert.deepEqual(earlier.items,[]);
 assert.equal(earlier.originalSolution.body,'```python\nPRIVATE_REFERENCE\n```');
 const current=await f.call(f.teacher,detail(latest),undefined,'GET');
 assert.equal(current.originalSolution.body,'New private explanation.\n\n```python\nNEW_PRIVATE_REFERENCE\n```');
 assert.deepEqual(current.versions.map(({versionId,current,solutionStatus,courseCount})=>({versionId,current,solutionStatus,courseCount})),[
  {versionId:latest.versionId,current:true,solutionStatus:'missing',courseCount:0},
  {versionId:original.versionId,current:false,solutionStatus:'missing',courseCount:1},
 ]);
 assert.ok(current.versions.every(version=>version.title==='Test'&&version.createdAt));
 assert.doesNotMatch(JSON.stringify(current.versions),/PRIVATE_REFERENCE|private explanation/);
 assert.deepEqual(await snapshot(),before,'reading the source must not create a draft or modify a problem version');
 await rejects(f.call(f.student,detail(latest),undefined,'GET'),'FORBIDDEN');
 await rejects(f.call(f.otherTeacher,detail(latest),undefined,'GET'),'FORBIDDEN');
 const another=await f.problem();
 await rejects(f.call(f.teacher,detail({...original,versionId:another.versionId}),undefined,'GET'),'NOT_FOUND');
 const empty=await f.version(original.problemId,'','',{published:false,approved:false});
 assert.equal((await f.call(f.teacher,detail(empty),undefined,'GET')).originalSolution,undefined);
 await f.publish(latest,'FULL_SOLUTION','Reviewed article only.');
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:original.problemId,kind:'FULL_SOLUTION',mode:'free'});
 const quote=await f.quote(f.student,latest),provided=await f.provide(f.student,latest);
 assert.equal(quote.originalSolution,undefined);
 assert.equal(provided.originalSolution,undefined);
 assert.equal(provided.body,'Reviewed article only.');
 assert.doesNotMatch(JSON.stringify([quote,provided]),/PRIVATE_REFERENCE|private explanation/);
}));

test('solution use follows the same resolved revision students open in published courses',options,async()=>fixture(async f=>{
 const original=await f.problem(),middle=await f.version(original.problemId,undefined,undefined,{published:false,approved:false}),latest=await f.version(original.problemId,undefined,undefined,{approved:false});
 await f.pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[original.problemId,latest.versionId]);
 const course=(await f.pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Current student course',clock_timestamp()) RETURNING id",[f.teacher.id])).rows[0];
 const chapter=(await f.pool.query("INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'Lesson',0) RETURNING id",[course.id])).rows[0];
 await f.pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapter.id,original.problemId,original.versionId]);
 const details=()=>f.call(f.teacher,'/scholarship/contents?'+new URLSearchParams(latest),undefined,'GET');
 const studentCourse=async()=>{
  const route=`/learning-paths/${course.id}`;
  const result=await handleEducation({pool:f.pool,user:f.student,route,method:'GET',url:new URL(`http://test${route}`),helpers:{versionAccess:async()=>({})}});
  return result.body.chapters[0].problems[0].versionId;
 };
 const before=(await f.pool.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY id',[original.problemId])).rows;
 let detail=await details();
 assert.equal(detail.recommendedVersionId,original.versionId);
 assert.equal(detail.selectionRequired,false);
 assert.equal(await studentCourse(),detail.recommendedVersionId);
 assert.deepEqual(detail.versions.find(v=>v.versionId===original.versionId).usage,{courseCount:1,courses:[{id:course.id,title:'Current student course'}],assignmentCount:0,assignments:[],timedCount:0,timedPractices:[],schoolPractice:true});
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).latest,true);
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).current,true);
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).published,true);
 assert.equal(detail.versions.find(v=>v.versionId===middle.versionId).published,false);
 assert.deepEqual((await f.pool.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY id',[original.problemId])).rows,before,'usage reads never save a revision');
 // Approval changes what published lessons open without rewriting their source link.
 await f.pool.query("UPDATE problem_versions SET school_visible_at=clock_timestamp(),rank_review_status='approved',rank_approved_at=clock_timestamp() WHERE id=$1",[latest.versionId]);
 detail=await details();
 assert.equal(detail.recommendedVersionId,latest.versionId);
 assert.equal(await studentCourse(),latest.versionId);
 assert.equal(detail.versions.find(v=>v.versionId===original.versionId).courseCount,1,'legacy linked-course metadata remains compatible');
 assert.equal(detail.versions.find(v=>v.versionId===original.versionId).usage.courseCount,0);
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).usage.courseCount,1);
 assert.equal((await f.pool.query('SELECT version_id FROM chapter_problems WHERE chapter_id=$1',[chapter.id])).rows[0].version_id,original.versionId);
 // Teacher edit access to draft/future/expired/withdrawn courses is not student use.
 for(const patch of ["available_from=now()+interval '1 day'","available_from=NULL,available_until=now()-interval '1 day'","available_until=NULL,published_at=NULL,withdrawn_at=now()","published_at=clock_timestamp(),withdrawn_at=NULL,archived_at=now()"]){
  await f.pool.query(`UPDATE learning_paths SET ${patch} WHERE id=$1`,[course.id]);
  assert.ok((await details()).versions.every(version=>version.usage.courseCount===0));
 }
 await rejects(f.quote(f.student,original),'PROBLEM_UPDATED');
 const quote=await f.quote(f.student,latest);
 assert.equal(quote.versions,undefined);assert.equal(quote.recommendedVersionId,undefined);assert.equal(quote.selectionRequired,undefined);
}));

test('solution use reveals only readable course names and managed activity names',options,async()=>fixture(async f=>{
 const original=await f.problem(),latest=await f.version(original.problemId);
 await f.pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[original.problemId,latest.versionId]);
 const cls=(await f.pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Private audience',$1) RETURNING id",[f.otherTeacher.id])).rows[0];
 const course=(await f.pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at,access_scope) VALUES($1,'PRIVATE_OTHER_COURSE',clock_timestamp(),'classes') RETURNING id",[f.otherTeacher.id])).rows[0];
 await f.pool.query('INSERT INTO learning_path_classes(path_id,class_id) VALUES($1,$2)',[course.id,cls.id]);
 const chapter=(await f.pool.query("INSERT INTO learning_chapters(path_id,title,position) VALUES($1,'Private lesson',0) RETURNING id",[course.id])).rows[0];
 await f.pool.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,0)',[chapter.id,original.problemId,original.versionId]);
 const assignment=async(owner,target,title)=>{
  const row=(await f.pool.query("INSERT INTO assignments(owner_account_id,class_id,title,due_at,state,published_at) VALUES($1,$2,$3,now()+interval '1 day','Published',now()) RETURNING id",[owner.id,cls.id,title])).rows[0];
  await f.pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[row.id,target.problemId,target.versionId]);return row;
 };
 const first=await assignment(f.teacher,original,'Older worksheet'),second=await assignment(f.teacher,latest,'Newer worksheet');
 const otherAssignment=await assignment(f.otherTeacher,latest,'PRIVATE_OTHER_ASSIGNMENT');
 const timed=(await f.pool.query("INSERT INTO timed_practices(owner_account_id,class_id,title,starts_at,ends_at,duration_minutes,state) VALUES($1,$2,'Private timed practice',now(),now()+interval '1 hour',30,'Draft') RETURNING id",[f.otherTeacher.id,cls.id])).rows[0];
 await f.pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[timed.id,original.problemId,latest.versionId]);
 await f.pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[timed.id]);
 const get=user=>f.call(user,'/scholarship/contents?'+new URLSearchParams(latest),undefined,'GET');
 let detail=await get(f.teacher);
 assert.equal(detail.recommendedVersionId,latest.versionId,'the published course resolves the latest approved revision');
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).usage.courseCount,1);
 assert.deepEqual(detail.versions.find(v=>v.versionId===latest.versionId).usage.courses,[]);
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE_OTHER_COURSE|PRIVATE_OTHER_ASSIGNMENT|Private timed practice/);
 assert.ok(!JSON.stringify(detail).includes(otherAssignment.id));assert.ok(!JSON.stringify(detail).includes(timed.id));
 assert.deepEqual(detail.versions.find(v=>v.versionId===original.versionId).usage.assignments,[]);
 assert.deepEqual(detail.versions.find(v=>v.versionId===latest.versionId).usage.assignments.map(item=>item.id).sort(),[first.id,second.id].sort());
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).usage.assignmentCount,3);
 assert.equal(detail.versions.find(v=>v.versionId===latest.versionId).usage.timedCount,1);
 assert.deepEqual(detail.versions.find(v=>v.versionId===latest.versionId).usage.timedPractices,[]);
 const admin=await get(f.admin);
 assert.equal(admin.versions.find(v=>v.versionId===latest.versionId).usage.courses[0].title,'PRIVATE_OTHER_COURSE');
 assert.equal(admin.versions.find(v=>v.versionId===latest.versionId).usage.assignmentCount,3);
 assert.equal(admin.versions.find(v=>v.versionId===latest.versionId).usage.timedCount,1);
 await f.pool.query('UPDATE learning_paths SET published_at=NULL WHERE id=$1',[course.id]);
 detail=await get(f.teacher);
 assert.equal(detail.recommendedVersionId,latest.versionId);assert.equal(detail.selectionRequired,false,'all managed activities share the live problem');
 await f.pool.query('UPDATE assignments SET archived_at=now() WHERE id=$1',[second.id]);
 detail=await get(f.teacher);
 assert.equal(detail.recommendedVersionId,latest.versionId);assert.equal(detail.selectionRequired,false,'private activities share the same problem without exposing their names');
 await f.pool.query('UPDATE assignments SET archived_at=now() WHERE id=$1',[first.id]);
 detail=await get(f.teacher);
 assert.equal(detail.recommendedVersionId,latest.versionId,'a private activity still prevents wrongly treating its revision as unused');
 assert.equal(detail.selectionRequired,false);
 await f.pool.query('UPDATE assignments SET archived_at=now() WHERE id=$1',[otherAssignment.id]);
 await f.pool.query("UPDATE timed_practices SET state='Archived',archived_at=now() WHERE id=$1",[timed.id]);
 detail=await get(f.teacher);
 assert.equal(detail.recommendedVersionId,latest.versionId,'without a current course or managed activity, school practice is preferred');
 await f.pool.query("UPDATE problem_versions SET school_visible_at=NULL,rank_review_status='pending',rank_approved_at=NULL WHERE problem_id=$1",[original.problemId]);
 const newest=await f.version(original.problemId,undefined,undefined,{published:false,approved:false});
 detail=await get(f.teacher);
 assert.equal(detail.recommendedVersionId,newest.versionId,'when there is no student use, start from the latest saved draft');
 await rejects(get(f.student),'NOT_FOUND');await rejects(get(f.otherTeacher),'FORBIDDEN');
}));

test('one shared solution retains published content, pending changes and historical source material across problem updates',options,async()=>fixture(async f=>{
 const prior=await f.problem(),kind='FULL_SOLUTION';
 const draft=await f.call(f.teacher,'/scholarship/contents',{...prior,kind,solutions:[
  {title:'Original explanation',body:'Reviewed previous primary.',programmingLanguage:'python'},
  {title:'Second approach',body:'Reviewed previous alternative.',programmingLanguage:'cpp'},
 ]});
 const published=await f.call(f.teacher,`/scholarship/contents/${draft.id}/publish`,{reviewed:true,expectedHash:draft.contentHash});
 const pending=await f.call(f.teacher,'/scholarship/contents',{...prior,kind,expectedHash:published.contentHash,
  solutions:published.solutions.map(solution=>({...solution,body:'PRIVATE PENDING '+solution.body}))});
 const current=await f.version(prior.problemId);
 // Simulate material saved before shared ownership was introduced; keep it intact.
 const historical=(await f.pool.query(`INSERT INTO luq_assistance_contents(subject_key,version_id,kind,body,status,published_at,pending_solution,author_account_id)
  VALUES($1,$2,'FULL_SOLUTION','Historical reviewed explanation.','published',now(),$3,$4) RETURNING *`,
  [`problem:${prior.problemId}`,current.versionId,{body:'Historical private pending.',details:{}},f.teacher.id])).rows[0];
 const unrelated=await f.problem();await f.publish(unrelated,kind,'UNRELATED_PROBLEM_CONTENT');
 const detail=target=>'/scholarship/contents?'+new URLSearchParams(target);
 const before=(await f.pool.query('SELECT * FROM luq_assistance_contents ORDER BY id')).rows;
 for(const target of [prior,current]){
  const data=await f.call(f.teacher,detail(target),undefined,'GET');
  assert.equal(data.items[0].id,published.id);
  assert.equal(data.items[0].contentHash,pending.contentHash);
  assert.match(data.items[0].body,/PRIVATE PENDING/);
  assert.equal(data.sharedSolution.contentId,published.id);
  assert.equal(data.sharedSolution.legacySources[0].contentId,historical.id);
  assert.equal(data.sharedSolution.legacySources[0].body,historical.body);
  assert.equal(data.sharedSolution.legacySources[0].pending.body,'Historical private pending.');
  assert.doesNotMatch(JSON.stringify(data),/UNRELATED_PROBLEM_CONTENT/);
 }
 assert.deepEqual((await f.pool.query('SELECT * FROM luq_assistance_contents ORDER BY id')).rows,before,'read-only historical materials do not create or replace content');
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:prior.problemId,kind,mode:'free'});
 await rejects(f.quote(f.student,prior),'PROBLEM_UPDATED');
 assert.equal((await f.quote(f.student,current)).contentId,published.id);
 assert.deepEqual((await f.provide(f.student,current)).solutions,published.solutions,'pending edits are not exposed when the question is published');
 await rejects(f.call(f.teacher,`/scholarship/contents/${historical.id}/publish`,{reviewed:true}),'SHARED_SOLUTION_REQUIRED');
 await f.call(f.teacher,`/scholarship/contents/${published.id}/publish`,{reviewed:true,expectedHash:pending.contentHash});
 assert.deepEqual((await f.provide(f.student,current)).solutions,pending.solutions);
 assert.deepEqual((await f.pool.query('SELECT * FROM luq_assistance_contents WHERE id=$1',[historical.id])).rows[0],historical);
 const canonical=(await f.call(f.teacher,detail(current),undefined,'GET')).items[0];
 const saves=await Promise.allSettled([prior,current].map((target,index)=>f.call(f.teacher,'/scholarship/contents',{
  ...target,kind,expectedHash:canonical.contentHash,solutions:[{title:'Shared change',body:`Concurrent edit ${index}`}],
 })));
 assert.equal(saves.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(saves.find(result=>result.status==='rejected').reason.code,'CONTENT_CHANGED');
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_problem_solutions WHERE problem_id=$1',[prior.problemId])).rows[0].n,1);
}));

test('published primary solution revisions remain pending until reviewed and reject competing hashes',options,async()=>fixture(async f=>{
 const target=await f.problem(),body='Original reviewed explanation.';
 const published=await f.publish(target,'FULL_SOLUTION',body);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'free'});
 const detail='/scholarship/contents?'+new URLSearchParams(target);
 const original=(await f.call(f.teacher,detail,undefined,'GET')).items[0];
 const edit=label=>f.call(f.teacher,'/scholarship/contents',{...target,kind:'FULL_SOLUTION',expectedHash:original.contentHash,
  solutions:[{id:published.id,title:'Original solution',body:`Revised explanation ${label}.`},{title:'Another approach',body:`Alternative ${label}.`}]});
 const results=await Promise.allSettled([edit('A'),edit('B')]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'CONTENT_CHANGED');
 const staged=results.find(result=>result.status==='fulfilled').value;
 assert.equal(staged.status,'published');assert.equal(staged.hasPendingSolutions,true);
 const pendingDetail=await f.call(f.teacher,detail,undefined,'GET'),pending=pendingDetail.items[0];
 assert.equal(pendingDetail.versions[0].solutionStatus,'draft');
 assert.equal(pendingDetail.versions[0].hasPendingSolutions,true);
 assert.equal(pending.body,staged.body);
 assert.notEqual(pending.body,body);
 const prior=await f.provide(f.student,target);
 assert.equal(prior.body,body);assert.equal(prior.solutions,undefined);
 assert.equal(prior.originalSolution,undefined);
 await rejects(f.call(f.teacher,`/scholarship/contents/${published.id}/publish`,{reviewed:true,expectedHash:original.contentHash}),'CONTENT_CHANGED');
 await rejects(f.call(f.teacher,'/scholarship/contents',{...target,kind:'FULL_SOLUTION',body:'Unreviewed replacement'}),'PUBLISHED_CONTENT_IMMUTABLE');
 await f.call(f.teacher,`/scholarship/contents/${published.id}/publish`,{reviewed:true,expectedHash:pending.contentHash});
 const reviewed=await f.provide(f.student,target);
 assert.equal(reviewed.body,pending.body);
 assert.deepEqual(reviewed.solutions,pending.solutions);
 const final=await f.call(f.teacher,detail,undefined,'GET');
 assert.equal(final.items[0].hasPendingSolutions,undefined);
 assert.equal(final.versions[0].solutionStatus,'published');
 assert.equal(final.versions[0].hasPendingSolutions,undefined);
}));

test('Luq solution credit follows the actual paid translation across versions and charges only once',options,async()=>fixture(async f=>{
 const target=await f.problem(),other=await f.problem();
 await f.publish(target,'FULL_TRANSLATION','中文题面');
 await f.publish(target);await f.publish(other);
 await f.grant(f.student,8);
 const original=await f.quote(f.student,target);
 assert.equal((await f.unlock(f.student,target,'FULL_TRANSLATION')).charged,3);
 const next=await f.version(target.problemId);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_TRANSLATION',mode:'paid',price:7});
 const discounted=await f.quote(f.student,next);
 assert.deepEqual([discounted.basePrice,discounted.translationCredit,discounted.price,discounted.balanceAfter],[8,3,5,0]);
 assert.equal((await f.quote(f.student,other)).price,8);
 assert.equal((await f.quote(f.otherStudent,next)).price,8);
 await rejects(f.call(f.student,'/scholarship/assistance/unlock',{...next,kind:'FULL_SOLUTION',requestKey:randomUUID(),
  confirmedPrice:original.price,confirmedContentId:original.contentId}),'QUOTE_CHANGED');
 const results=await Promise.all(Array.from({length:3},()=>f.unlock(f.student,next)));
 assert.equal(results.reduce((total,result)=>total+result.charged,0),5);
 assert.ok(results.every(result=>result.balance===0));
 const purchases=(await f.pool.query("SELECT id,delta,metadata FROM luq_ledger WHERE kind='purchase' ORDER BY id")).rows;
 assert.deepEqual(purchases.map(entry=>entry.delta),[-3,-5]);
 assert.equal(purchases[1].metadata.translationCreditLedgerId,purchases[0].id);
 await rejects(f.refund(f.student,purchases[0]),'LUQ_TRANSLATION_CREDIT_USED');
 assert.equal((await f.quote(f.student,next)).balance,0);
}));

test('Luq excludes refunded translations and preserves zero-charge credited unlocks with request-key replay',options,async()=>fixture(async f=>{
 const target=await f.problem(),other=await f.problem();
 await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');await f.publish(other);
 for(const user of [f.student,f.otherStudent]){
  await f.grant(user,3);await f.unlock(user,target,'FULL_TRANSLATION');
 }
 const refunded=(await f.pool.query("SELECT id,delta FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.otherStudent.identityId])).rows[0];
 await f.refund(f.otherStudent,refunded);
 assert.deepEqual([(await f.quote(f.otherStudent,target)).price,(await f.quote(f.otherStudent,target)).balance],[8,3]);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',price:2});
 const q=await f.quote(f.student,target);
 assert.deepEqual([q.price,q.translationCredit,q.mode,q.requiresConfirmation],[0,2,'paid',true]);
 await rejects(f.provide(f.student,target),'UNLOCK_REQUIRED');
 const requestKey=randomUUID();
 const first=await f.unlock(f.student,target,'FULL_SOLUTION',requestKey),replay=await f.unlock(f.student,target,'FULL_SOLUTION',requestKey);
 assert.equal(first.unlocked,true);assert.equal(first.charged,0);assert.equal(replay.entitlementId,first.entitlementId);
 await rejects(f.unlock(f.student,other,'FULL_SOLUTION',requestKey),'IDEMPOTENCY_CONFLICT');
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',price:8});
 assert.equal((await f.quote(f.student,target)).unlocked,true);assert.ok((await f.provide(f.student,target)).body);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0].n,1);
 const translation=(await f.pool.query("SELECT id,delta FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0];
 await rejects(f.refund(f.student,translation),'LUQ_TRANSLATION_CREDIT_USED');
}));

test('Luq serializes a translation refund against spending its credit',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');
 await f.grant(f.student,8);await f.unlock(f.student,target,'FULL_TRANSLATION');
 const translation=(await f.pool.query("SELECT id,delta FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0];
 const q=await f.quote(f.student,target);
 const [purchase,refund]=await Promise.allSettled([
  f.call(f.student,'/scholarship/assistance/unlock',{...target,kind:'FULL_SOLUTION',requestKey:randomUUID(),confirmedPrice:q.price,confirmedContentId:q.contentId}),
  f.refund(f.student,translation),
 ]);
 const after=await f.quote(f.student,target);
 if(purchase.status==='fulfilled'){
  assert.equal(purchase.value.charged,5);assert.equal(refund.reason?.code,'LUQ_TRANSLATION_CREDIT_USED');
  assert.equal(after.balance,0);assert.equal(after.unlocked,true);
 }else{
  assert.equal(refund.status,'fulfilled');assert.equal(purchase.reason.code,'QUOTE_CHANGED');
  assert.equal(after.balance,8);assert.equal(after.price,8);assert.equal(after.unlocked,false);
 }
}));

test('Luq reviewed assistance has no body in quotes/unlocks, exact funds and concurrent unlocks charge once',options,async()=>fixture(async f=>{
 const target=await f.problem();
 assert.equal((await f.quote(f.student,target)).available,false);
 await rejects(f.unlock(f.student,target),'ASSISTANCE_UNAVAILABLE');
 const draft=await f.call(f.teacher,'/scholarship/contents',{...target,kind:'FULL_SOLUTION',body:'APPROVED_ONLY_AFTER_REVIEW'});
 assert.equal((await f.quote(f.student,target)).available,false);
 await rejects(f.call(f.teacher,`/scholarship/contents/${draft.id}/publish`,{}),'REVIEW_REQUIRED');
 await f.call(f.teacher,`/scholarship/contents/${draft.id}/publish`,{reviewed:true});
 await rejects(f.call(f.otherTeacher,`/scholarship/contents?problemId=${target.problemId}&versionId=${target.versionId}`,undefined,'GET'),'FORBIDDEN');
 await rejects(f.call(f.student,`/scholarship/contents?problemId=${target.problemId}&versionId=${target.versionId}`,undefined,'GET'),'FORBIDDEN');
 const q=await f.quote(f.student,target);assert.equal(q.balance,0);assert.equal(q.price,8);assert.equal(JSON.stringify(q).includes('APPROVED_ONLY'),false);
 await rejects(f.unlock(f.student,target),'INSUFFICIENT_LUQ');await rejects(f.provide(f.student,target),'UNLOCK_REQUIRED');
 await f.grant(f.student,8);
 const results=await Promise.all(Array.from({length:6},()=>f.unlock(f.student,target)));
 assert.equal(results.reduce((n,r)=>n+r.charged,0),8);assert.ok(results.every(r=>r.balance===0));
 assert.equal(JSON.stringify(results).includes('APPROVED_ONLY'),false);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_deliveries')).rows[0].n,0,'purchase is not answer use');
 assert.equal((await f.submit(f.student,target)).luq_solution_assisted,false,'cancel after purchase does not consume independent-answer eligibility');
 const delivered=await f.provide(f.student,target);assert.equal(delivered.body,'APPROVED_ONLY_AFTER_REVIEW');
 assert.equal((await f.submit(f.student,target)).luq_solution_assisted,true);
 assert.equal((await f.quote(f.student,target)).price,0);
 await rejects(f.call(f.teacher,'/scholarship/contents',{...target,kind:'FULL_SOLUTION',body:'overwrite'}),'PUBLISHED_CONTENT_IMMUTABLE');
}));

test('Luq balance competition, request replay, shared content, refund and cross-version entitlement',options,async()=>fixture(async f=>{
 const a=await f.problem(),b=await f.problem();await f.publish(a);await f.publish(b);await f.grant(f.student,8);
 const outcomes=await Promise.allSettled([f.unlock(f.student,a),f.unlock(f.student,b)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const won=outcomes[0].status==='fulfilled'?a:b,lost=won===a?b:a;
 assert.equal((await f.pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[f.student.identityId])).rows[0].balance,0);
 const oldQuote=await f.quote(f.student,won);
 const next=await f.version(won.problemId);assert.equal((await f.quote(f.student,next)).available,true);
 assert.equal((await f.quote(f.student,next)).contentId,oldQuote.contentId);
 assert.ok((await f.provide(f.student,next)).body);await f.publish(next,'FULL_SOLUTION','SHARED_UPDATED_EXPLANATION');
 assert.equal((await f.quote(f.student,next)).price,0);assert.equal((await f.provide(f.student,next)).body,'SHARED_UPDATED_EXPLANATION');
 await rejects(f.provide(f.student,won),'PROBLEM_UPDATED');
 const purchase=(await f.pool.query("SELECT id FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.student.identityId])).rows[0];
 await transaction(f.pool,db=>postScholarshipEntry(db,{identityId:f.student.identityId,delta:8,kind:'refund',sourceKey:`refund:${purchase.id}`,refundOf:purchase.id,actorAccountId:f.admin.id,reason:'Refund fixture'}));
 assert.equal((await f.quote(f.student,next)).unlocked,true,'refund keeps entitlement');
 const requestKey=randomUUID(),q=await f.quote(f.student,lost);
 const body={...lost,kind:'FULL_SOLUTION',requestKey,confirmedPrice:q.price,confirmedContentId:q.contentId};
 await f.call(f.student,'/scholarship/assistance/unlock',body);await f.call(f.student,'/scholarship/assistance/unlock',body);
 await rejects(f.call(f.student,'/scholarship/assistance/unlock',{...body,...next}),'IDEMPOTENCY_CONFLICT');
}));

test('Luq free task content gives no permanent entitlement, translation does not assist AC and activity policies freeze',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');
 const assignment=(await f.pool.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Learn',$1,now()+interval '1 day','Draft') RETURNING id",[f.teacher.id])).rows[0];
 await f.pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[assignment.id,target.problemId,target.versionId]);
 await f.pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,f.student.identityId]);
 for(const kind of ['FULL_SOLUTION','FULL_TRANSLATION'])await f.call(f.teacher,'/scholarship/policies',{targetType:'assignment',targetId:assignment.id,kind,mode:'free'});
 await f.pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[assignment.id]);
 const publicRules=await f.call(f.student,`/scholarship/policies?targetType=assignment&targetId=${assignment.id}`,undefined,'GET');
 assert.equal(publicRules.canManage,false);assert.equal(publicRules.frozen,true);assert.equal(publicRules.items.length,2);assert.equal(publicRules.items[0].mode,'free');
 const contextual={...target,assignmentId:assignment.id};
 assert.equal((await f.quote(f.student,contextual)).price,0);
 await f.provide(f.student,contextual,'FULL_TRANSLATION');assert.equal((await f.submit(f.student,target)).luq_solution_assisted,false);
 await f.provide(f.student,contextual);assert.equal((await f.quote(f.student,target)).price,8);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements')).rows[0].n,0);
 await rejects(f.call(f.teacher,'/scholarship/policies',{targetType:'assignment',targetId:assignment.id,kind:'FULL_SOLUTION',mode:'paid'}),'RULE_FROZEN');
 await rejects(f.quote(f.otherStudent,contextual),'NOT_FOUND');
 const usage=await f.call(f.teacher,`/scholarship/usage?targetType=assignment&targetId=${assignment.id}`,undefined,'GET');assert.equal(usage.items.length,2);
 await rejects(f.call(f.otherTeacher,`/scholarship/usage?targetType=assignment&targetId=${assignment.id}`,undefined,'GET'),'NOT_FOUND');
}));

test('Luq active exam restrictions beat balance, prior purchase, old versions and free-library entry',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.grant(f.student,8);await f.unlock(f.student,target);
 const accepted=await f.submit(f.student,target);
 await f.pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[accepted.id]);
 const newer=await f.version(target.problemId);await f.publish(newer);
 const exam=(await f.pool.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes,state)
  VALUES('Exam',$1,now()-interval '1 minute',now()+interval '1 hour',60,'Draft') RETURNING id`,[f.teacher.id])).rows[0];
 await f.pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[exam.id,target.problemId,newer.versionId]);
 await f.pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[exam.id,f.student.identityId]);
 await f.pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[exam.id]);
 await rejects(f.quote(f.student,target),'PROBLEM_UPDATED');assert.equal((await f.quote(f.student,newer)).available,false);
 assert.equal((await f.quote(f.student,newer)).mode,'disabled');await rejects(f.provide(f.student,newer),'ASSISTANCE_LOCKED');await rejects(f.unlock(f.student,newer),'ASSISTANCE_LOCKED');
 await f.pool.query('UPDATE timed_practices SET results_published_at=clock_timestamp() WHERE id=$1',[exam.id]);
 assert.equal((await f.quote(f.student,newer)).available,true);assert.ok((await f.provide(f.student,newer)).body);
}));

test('a student’s formal AC keeps the shared solution free across revisions and assignment entry',options,async()=>fixture(async f=>{
 const target=await f.problem();
 await f.publish(target);await f.publish(target,'FULL_TRANSLATION','中文题面');
 const ac=await f.submit(f.student,target);
 await f.pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[ac.id]);
 assert.equal((await f.quote(f.student,target)).mode,'free');
 assert.equal((await f.quote(f.otherStudent,target)).mode,'paid');
 assert.equal((await f.quote(f.student,target,'FULL_TRANSLATION')).price,3);
 const newer=await f.version(target.problemId);
 const free=await f.quote(f.student,newer);
 assert.deepEqual([free.mode,free.price,free.requiresConfirmation,free.body],['free',0,false,undefined]);
 assert.equal((await f.quote(f.otherStudent,newer)).mode,'paid');
 await rejects(f.quote(f.student,target),'PROBLEM_UPDATED');
 const {rows:[assignment]}=await f.pool.query(`INSERT INTO assignments(title,owner_account_id,due_at,state)
  VALUES('Paid policy',$1,now()+interval '1 hour','Draft') RETURNING id`,[f.teacher.id]);
 await f.pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[assignment.id,target.problemId,target.versionId]);
 await f.pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)',[assignment.id,f.student.identityId]);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'assignment',targetId:assignment.id,kind:'FULL_SOLUTION',mode:'paid'});
 await f.pool.query("UPDATE assignments SET state='Published',published_at=now() WHERE id=$1",[assignment.id]);
 const contextual={...newer,assignmentId:assignment.id};
 assert.equal((await f.quote(f.student,contextual)).mode,'free');
 assert.ok((await f.provide(f.student,contextual)).body);
 assert.ok((await f.provide(f.student,newer)).body);
 assert.equal((await f.unlock(f.student,contextual)).charged,0);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_ledger WHERE kind='purchase'")).rows[0].n,0);
}));

test('Luq answer provision and submission share an acceptance lock; later viewing cannot revise an earlier snapshot',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'free'});
 const client=await f.pool.connect();let pending;
 try{
  await client.query('BEGIN');
  const earlier=(await client.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','print(1)',$5,'fixture') RETURNING id,luq_solution_assisted`,[f.student.id,f.student.identityId,target.problemId,target.versionId,randomUUID()])).rows[0];
  assert.equal(earlier.luq_solution_assisted,false);
  pending=f.provide(f.student,target);await client.query('COMMIT');await pending;
  assert.equal((await f.pool.query('SELECT luq_solution_assisted FROM submissions WHERE id=$1',[earlier.id])).rows[0].luq_solution_assisted,false);
  assert.equal((await f.submit(f.student,target)).luq_solution_assisted,true);
 }finally{await client.query('ROLLBACK');client.release();}
}));


test('Luq opening time beats owned access and configured zero prices do not create fake purchases',options,async()=>fixture(async f=>{
 const target=await f.problem();await f.publish(target);await f.grant(f.student,8);await f.unlock(f.student,target);
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid',opensAt:new Date(Date.now()+60_000).toISOString()});
 assert.equal((await f.quote(f.student,target)).available,false);await rejects(f.provide(f.student,target),'ASSISTANCE_LOCKED');
 await f.call(f.teacher,'/scholarship/policies',{targetType:'problem',targetId:target.problemId,kind:'FULL_SOLUTION',mode:'paid'});
 await f.pool.query('UPDATE luq_settings SET solution_price=0,rule_version=rule_version+1,updated_by=$1 WHERE singleton',[f.admin.id]);
 const q=await f.quote(f.otherStudent,target);assert.equal(q.mode,'free');assert.equal(q.price,0);assert.equal(q.unlocked,false);
 await f.provide(f.otherStudent,target);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements WHERE identity_id=$1',[f.otherStudent.identityId])).rows[0].n,0);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[f.otherStudent.identityId])).rows[0].n,0);
}));
