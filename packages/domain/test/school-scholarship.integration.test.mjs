import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { provisionSchool } from '../src/schools.mjs';
import { handleSchoolScholarship, configureSchoolActivityScholarshipRule } from '../src/school-scholarship.mjs';
import { handleSchoolLeaderboard } from '../src/school-leaderboard.mjs';
import { schoolActivitiesOperation } from '../src/school-activities.mjs';
import { schoolPracticeOperation } from '../src/school-practice.mjs';
import { claimSchoolPaper4Task, finishSchoolPaper4Task } from '../school-paper4-worker.mjs';
import { claimSchoolTask, finishSchoolTask } from '../school-worker.mjs';

test('school scholarships: real roles, atomic rewards, consumption, timing and isolation',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));assert.match(base.pathname,/^\/campus_(qa(?:_[a-z0-9_]+)?|test)$/);
 const manager=createPool(base.href),schema=`school_scholarship_${randomBytes(6).toString('hex')}`;await manager.query(`CREATE SCHEMA ${schema}`);const asRole=role=>{const u=new URL(base);u.searchParams.set('options',`${role?'-crole='+role+' ':''}-csearch_path=${schema}`);return createPool(u.href);};const owner=asRole();let app,worker;
 try{
  await migrate(owner);const grants=(await readFile(new URL('../grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];assert.ok(grants);await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));app=asRole('campus_app');worker=asRole('campus_worker');
  const users={};for(const name of ['admin','teacher','one','two','outsider']){const identity=(await owner.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$1) RETURNING id",[name])).rows[0];users[name]=(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id,identity_id',[identity.id,name,'unusable-test-hash'])).rows[0];}
  const alpha=await provisionSchool(owner,{slug:'scholarship-alpha',name:'Alpha',adminUsername:'admin'}),beta=await provisionSchool(owner,{slug:'scholarship-beta',name:'Beta',adminUsername:'outsider'}),ids={};
  for(const [name,role] of [['teacher','teacher'],['one','student'],['two','student']]){await owner.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[alpha.id,users[name].id,role]);ids[name]=(await owner.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4) RETURNING id',[alpha.id,role,name,users[name].id])).rows[0].id;}
  const legacyBefore=(await owner.query('SELECT count(*)::int count,sum(delta)::int total FROM luq_ledger')).rows[0];
  const call=async(name,path,method='GET',body={},school=alpha)=>(await handleSchoolScholarship({pool:app,user:users[name],route:`/schools/${school.id}/scholarship/${path.split('?')[0]}`,url:new URL(`http://qa.local/schools/${school.id}/scholarship/${path}`),method,body}))?.body;
  const bank=(await owner.query('INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,$3,$4) RETURNING id',[alpha.id,users.teacher.id,'Tests',randomUUID()])).rows[0].id;
  async function problem(title){const id=randomUUID(),v=randomUUID(),definition={title,statement:'Return 5.',mode:'stdio',comparator:'tokens',time_limit_ms:1000,memory_limit_mb:128,reference_code:'PRIVATE REFERENCE',starter_code:'',samples:[{position:1,input:'',expected:'5'}],tests:[{position:1,input:'HIDDEN INPUT',expected:'5',weight:100}]};await owner.query('INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5,$6)',[alpha.id,id,bank,users.teacher.id,definition,randomUUID()]);await owner.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) VALUES($1,$2,$3,1,$4)',[alpha.id,v,id,definition]);await owner.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,id,v]);return {type:'problem',problemId:id,versionId:v};}
  const p=await problem('First'),q=await problem('Second');
  async function content(target,kind,body='Student-facing reviewed content'){const c=await call('teacher','content','POST',{...target,kind,body,expectedRevision:0});await call('admin','contents/review','POST',{items:[{id:c.id,revision:c.revision}],confirmReviewed:true});return c;}
  async function quote(name,target,kind){return call(name,'assistance/quote','POST',{...target,kind});}
  async function unlock(name,target,kind,req=randomUUID()){const q=await quote(name,target,kind);return call(name,'assistance/unlock','POST',{...target,kind,requestId:req,confirmedContentId:q.contentId,confirmedRevision:q.contentRevision,confirmedPrice:q.price});}
  async function provide(name,target,kind){return call(name,'assistance/provide','POST',{...target,kind});}
  async function submit(name,target){const route=`/schools/${alpha.id}/problems/${target.problemId}/submissions`;return(await schoolPracticeOperation({pool:app,user:users[name],route,url:new URL('http://qa.local'+route),method:'POST',body:{kind:'submit',language:'python',code:'print(5)',requestId:randomUUID()}})).body;}
  async function finish(status='AC'){const j=await claimSchoolTask(worker);assert.ok(j);assert.equal(await finishSchoolTask(worker,j,{status,score:status==='AC'?100:0,total:1,passed:status==='AC'?1:0,publicMessage:'',privateResults:[]}),true);return j;}
  await t.test('initial allowance is school-specific and unlinked to legacy wallets',async()=>{assert.equal((await call('one','wallet')).balance,100);assert.equal((await call('two','wallet')).balance,100);assert.equal((await owner.query('SELECT count(*)::int n FROM school_scholarship_ledger WHERE kind=\'initial_grant\'')).rows[0].n,2);await assert.rejects(call('one','wallet','GET',{},beta),e=>e.status===404);await assert.rejects(call('teacher','wallet'),e=>e.status===403);});
  await t.test('unpublished content and foreign access never expose private tests or drafts',async()=>{const c=await call('teacher','content','POST',{...p,kind:'FULL_SOLUTION',body:'Reviewed explanation\n```python\nprint(5)\n```',expectedRevision:0});const before=await quote('one',p,'FULL_SOLUTION');assert.equal(before.available,false);assert.equal(before.body,undefined);assert.ok(!JSON.stringify(before).includes('PRIVATE'));await assert.rejects(provide('one',p,'FULL_SOLUTION'),e=>e.status===403);await assert.rejects(call('teacher','contents/review','POST',{items:[c],confirmReviewed:true}),e=>e.status===403);await call('admin','contents/review','POST',{items:[c],confirmReviewed:true});assert.equal((await quote('one',p,'FULL_SOLUTION')).available,true);await assert.rejects(call('outsider','content?'+new URLSearchParams({...p,kind:'FULL_SOLUTION'})),e=>e.status===404);});
  await t.test('translation credit, concurrent purchase replay, refund once and preserved entitlement',async()=>{await content(p,'FULL_TRANSLATION','中文题面');await unlock('one',p,'FULL_TRANSLATION');assert.equal((await call('one','wallet')).balance,97);const price=await quote('one',p,'FULL_SOLUTION');assert.equal(price.price,5);assert.equal(price.translationCredit,3);const req=randomUUID();await Promise.all([unlock('one',p,'FULL_SOLUTION',req),unlock('one',p,'FULL_SOLUTION',req)]);assert.equal((await call('one','wallet')).balance,92);assert.equal((await provide('one',p,'FULL_SOLUTION')).body.includes('print(5)'),true);const purchases=(await owner.query("SELECT id,delta FROM school_scholarship_ledger WHERE school_id=$1 AND identity_id=$2 AND kind='purchase' ORDER BY delta",[alpha.id,ids.one])).rows;await assert.rejects(call('admin','refund','POST',{ledgerId:purchases.find(r=>r.delta===-3).id,reason:'Review',requestId:randomUUID()}),e=>e.code==='TRANSLATION_CREDIT_USED');await Promise.all(Array.from({length:2},()=>call('admin','refund','POST',{ledgerId:purchases.find(r=>r.delta===-5).id,reason:'Approved',requestId:randomUUID()})));assert.equal((await call('one','wallet')).balance,97);assert.equal((await quote('one',p,'FULL_SOLUTION')).unlocked,true);});
  await t.test('solution before receipt excludes scholarship but preserves AC ranking points',async()=>{await submit('one',p);await finish();assert.equal((await call('one','wallet')).balance,97);assert.equal((await owner.query('SELECT points FROM school_rank_awards WHERE school_id=$1 AND identity_id=$2',[alpha.id,ids.one])).rows[0].points,10);});
  await t.test('unlock is not delivery; receiving answer while already judging does not cancel first AC',async()=>{await content(q,'FULL_SOLUTION');await unlock('one',q,'FULL_SOLUTION');await submit('one',q);await provide('one',q,'FULL_SOLUTION');await finish();assert.equal((await call('one','wallet')).balance,93);const r=(await owner.query('SELECT assisted FROM school_scholarship_receipts WHERE school_id=$1 AND identity_id=$2 AND subject_key=$3',[alpha.id,ids.one,'problem:'+q.problemId])).rows[0];assert.equal(r.assisted,false);});
  await t.test('duplicate and concurrent AC jobs, replayed callbacks and rejudge never duplicate awards',async()=>{await Promise.all([submit('two',q),submit('two',q)]);const a=await finish(),b=await finish();assert.equal((await call('two','wallet')).balance,104);await owner.query("UPDATE school_judge_jobs SET result=result WHERE school_id=$1 AND id=ANY($2::uuid[])",[alpha.id,[a.id,b.id]]);assert.equal((await call('two','wallet')).balance,104);await owner.query("UPDATE school_judge_jobs SET result=jsonb_set(result,'{status}','\"WA\"') WHERE school_id=$1 AND id=$2",[alpha.id,a.id]);assert.equal((await call('two','wallet')).balance,104);assert.equal((await owner.query('SELECT count(*)::int n FROM school_scholarship_review_cases')).rows[0].n,1);});
  await t.test('batch replay freezes recipients and cross-school grant is rejected atomically',async()=>{const req=randomUUID(),body={identityIds:[ids.one,ids.two],amount:7,reason:'Learning award',requestId:req};await Promise.all([call('admin','grant','POST',body),call('admin','grant','POST',body)]);assert.equal((await call('two','wallet')).balance,111);await assert.rejects(call('admin','grant','POST',{...body,amount:8}),e=>e.status===409);await assert.rejects(call('admin','grant','POST',{identityIds:[ids.one,randomUUID()],amount:9,reason:'Invalid',requestId:randomUUID()}),e=>e.status===404);assert.equal((await call('one','wallet')).balance,100);});
  await t.test('competing purchases cannot overdraw, missing version cannot reuse old body',async()=>{const x=await problem('Expensive A'),y=await problem('Expensive B');await content(x,'FULL_SOLUTION');await content(y,'FULL_SOLUTION');await call('teacher','policies','POST',{targets:[x,y],kind:'FULL_SOLUTION',price:70,mode:'paid'});const outcomes=await Promise.allSettled([unlock('two',x,'FULL_SOLUTION'),unlock('two',y,'FULL_SOLUTION')]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal((await call('two','wallet')).balance,41);const v=randomUUID();await owner.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) SELECT school_id,$3,id,2,draft FROM school_problems WHERE school_id=$1 AND id=$2',[alpha.id,p.problemId,v]);await owner.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,p.problemId,v]);assert.equal((await quote('one',{...p,versionId:v},'FULL_SOLUTION')).available,false);await assert.rejects(provide('one',p,'FULL_SOLUTION'),e=>e.status===404);});
  await t.test('runtime roles prevent ledger overwrite, missing-scope reads and worker wallet access',async()=>{for(const table of ['school_scholarship_accounts','school_scholarship_ledger','school_scholarship_contents','school_scholarship_claims','school_rank_awards']){assert.equal((await app.query(`SELECT * FROM ${table}`)).rowCount,0);await assert.rejects(worker.query(`SELECT * FROM ${table}`),e=>e.code==='42501');}await assert.rejects(app.query('UPDATE school_scholarship_accounts SET balance=999'),e=>e.code==='42501');await assert.rejects(app.query('DELETE FROM school_scholarship_ledger'),e=>e.code==='42501');await assert.rejects(owner.query('UPDATE school_scholarship_ledger SET reason=reason'),/append-only/);assert.deepEqual((await owner.query('SELECT count(*)::int count,sum(delta)::int total FROM luq_ledger')).rows[0],legacyBefore);});
  const act=async(name,id,method='GET',body={})=>{const route=`/schools/${alpha.id}/activities${id?'/'+id:''}`;return(await schoolActivitiesOperation({pool:app,user:users[name],route,url:new URL('http://qa.local'+route),method,body})).body;};
  async function activity(target,extra={},rule={}){let a=await act('teacher','','POST',{kind:'assignment',title:'Reward activity',problems:[{problemId:target.problemId,versionId:target.versionId,points:100}],identityIds:[ids.one,ids.two],requestId:randomUUID(),...extra});await call('teacher','activity-rule','POST',{activityId:a.id,amount:7,minimumAc:1,minimumScore:100,taskKind:'challenge',allowSolutionAssisted:false,expectedRevision:0,...rule});return act('teacher',a.id+'/publish','POST',{expectedRevision:a.revision});}
  const activitySubmit=(name,a,target)=>act(name,a.id+'/problems/'+target.problemId+'/submissions','POST',{kind:'submit',code:'print(5)',language:'python',requestId:randomUUID()});
  await t.test('assignment first-AC stacks once with frozen achievement rule across entrances',async()=>{const x=await problem('Assignment stacking'),a=await activity(x);const before=(await call('one','wallet')).balance;await assert.rejects(call('teacher','activity-rule','POST',{activityId:a.id,amount:9,minimumAc:1,minimumScore:0,expectedRevision:1}),e=>e.code==='RULE_FROZEN');await activitySubmit('one',a,x);await finish();assert.equal((await call('one','wallet')).balance,before+11);await submit('one',x);await finish();await activitySubmit('one',a,x);await finish();assert.equal((await call('one','wallet')).balance,before+11);const another=await activity(x);await activitySubmit('one',another,x);await finish();assert.equal((await call('one','wallet')).balance,before+18);});
  await t.test('assignment completion requires every pinned in-assignment AC and pays once',async()=>{
   const x=await problem('Completion first'),y=await problem('Completion second');
   const a=await activity(x,{problems:[x,y].map(p=>({problemId:p.problemId,versionId:p.versionId,points:50}))},{amount:15,requireAll:true});
   const rule=await call('one','activity-rule?activityId='+a.id);
   assert.equal(rule.requireAll,true);
   const before=(await call('one','wallet')).balance;
   await submit('one',x);await finish();
   await activitySubmit('one',a,y);await finish();
   assert.equal((await call('one','wallet')).balance,before+8);
   await activitySubmit('one',a,x);await finish();
   await activitySubmit('one',a,x);await finish();
   assert.equal((await call('one','wallet')).balance,before+23);
   const rewards=(await owner.query("SELECT delta,metadata->>'activityType' AS type FROM school_scholarship_ledger WHERE school_id=$1 AND identity_id=$2 AND kind='activity' AND metadata->>'activityId'=$3",[alpha.id,ids.one,a.id])).rows;
   assert.deepEqual(rewards,[{delta:15,type:'assignment'}]);
   const notifications=(await owner.query("SELECT n.school_identity_id,n.data FROM student_system_notifications n JOIN school_scholarship_ledger l ON l.school_id=n.school_id AND l.id::text=n.source_key WHERE n.school_id=$1 AND n.kind='activity_reward' AND l.metadata->>'activityId'=$2",[alpha.id,a.id])).rows;
   assert.deepEqual(notifications,[{school_identity_id:ids.one,data:{amount:15,activityTitle:'Reward activity'}}]);
  });
  await t.test('timed results defer both rewards; released results settle once and block assistance from all entrances',async()=>{const x=await problem('Timed reward');await content(x,'FULL_SOLUTION');await unlock('one',x,'FULL_SOLUTION');const a=await activity(x,{kind:'timed',startsAt:new Date(Date.now()-10000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),durationMinutes:30});const before=(await call('one','wallet')).balance;assert.equal((await quote('one',x,'FULL_SOLUTION')).available,false);await assert.rejects(provide('one',x,'FULL_SOLUTION'),e=>e.code==='ASSISTANCE_UNAVAILABLE');await act('one',a.id+'/start','POST');await activitySubmit('one',a,x);await finish();assert.equal((await call('one','wallet')).balance,before);assert.equal((await owner.query('SELECT count(*)::int n FROM school_rank_awards WHERE subject_key=$1',['problem:'+x.problemId])).rows[0].n,0);await act('teacher',a.id+'/end','POST');await act('teacher',a.id+'/publish-results','POST');await act('teacher',a.id+'/publish-results','POST');assert.equal((await call('one','wallet')).balance,before+11);assert.equal((await quote('one',x,'FULL_SOLUTION')).unlocked,true);await provide('one',x,'FULL_SOLUTION');});
  await t.test('free task assistance has no permanent entitlement and assisted learning rules are explicit',async()=>{const x=await problem('Free learning');await content(x,'FULL_SOLUTION');const a=await activity(x,{}, {taskKind:'learning',allowSolutionAssisted:true,assistance:{translation:{mode:'paid'},solution:{mode:'free'}}});const before=(await call('two','wallet')).balance;assert.equal((await quote('two',{...x,activityId:a.id},'FULL_SOLUTION')).mode,'free');await provide('two',{...x,activityId:a.id},'FULL_SOLUTION');assert.equal((await quote('two',x,'FULL_SOLUTION')).unlocked,false);assert.equal((await quote('two',x,'FULL_SOLUTION')).mode,'paid');await activitySubmit('two',a,x);await finish();assert.equal((await call('two','wallet')).balance,before+7);const receipt=(await owner.query('SELECT assisted FROM school_scholarship_receipts WHERE activity_id=$1',[a.id])).rows[0];assert.equal(receipt.assisted,true);});
  await t.test('disabled task policy applies through free-practice URLs and prior entitlements',async()=>{const x=await problem('Disabled activity');await content(x,'FULL_TRANSLATION');await unlock('one',x,'FULL_TRANSLATION');await activity(x,{}, {assistance:{translation:{mode:'disabled'},solution:{mode:'paid'}}});assert.equal((await quote('one',x,'FULL_TRANSLATION')).available,false);await assert.rejects(provide('one',x,'FULL_TRANSLATION'),e=>e.code==='ASSISTANCE_UNAVAILABLE');});
  await t.test('two students completing the same activity concurrently settle without inverted wallet locks',async()=>{const x=await problem('Concurrent activity'),a=await activity(x);const before=[(await call('one','wallet')).balance,(await call('two','wallet')).balance];await Promise.all([activitySubmit('one',a,x),activitySubmit('two',a,x)]);const first=await claimSchoolTask(worker),second=await claimSchoolTask(worker);assert.ok(first&&second);const result={status:'AC',score:100,total:1,passed:1,privateResults:[]};await Promise.all([finishSchoolTask(worker,first,result),finishSchoolTask(worker,second,result)]);assert.equal((await call('one','wallet')).balance,before[0]+11);assert.equal((await call('two','wallet')).balance,before[1]+11);});
  await t.test('practice AC grants free reviewed solution access while an assigned assessment can still block it',async()=>{
   const x=await problem('Free after formal AC');await content(x,'FULL_SOLUTION');
   const before=(await call('one','wallet')).balance;
   await submit('one',x);await finish('WA');
   await assert.rejects(provide('one',x,'FULL_SOLUTION'),e=>e.code==='PAYMENT_REQUIRED');
   await submit('one',x);await finish();
   const free=await quote('one',x,'FULL_SOLUTION');
   assert.deepEqual([free.mode,free.price,free.requiresConfirmation],['free',0,false]);
   assert.equal((await quote('two',x,'FULL_SOLUTION')).mode,'paid');
   assert.equal((await provide('one',x,'FULL_SOLUTION')).body,'Student-facing reviewed content');
   assert.equal((await call('one','wallet')).balance,before+4);
   const a=await activity(x,{kind:'timed',startsAt:new Date(Date.now()-10000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),durationMinutes:30});
   assert.equal((await quote('one',x,'FULL_SOLUTION')).available,false);
   await assert.rejects(provide('one',x,'FULL_SOLUTION'),e=>e.code==='ASSISTANCE_UNAVAILABLE');
   await act('teacher',a.id+'/end','POST');await act('teacher',a.id+'/publish-results','POST');
   assert.equal((await quote('one',x,'FULL_SOLUTION')).mode,'free');
   const versionId=randomUUID();
   await owner.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) SELECT school_id,$3,id,2,draft FROM school_problems WHERE school_id=$1 AND id=$2',[alpha.id,x.problemId,versionId]);
   await owner.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,x.problemId,versionId]);
   const current={...x,versionId};
   await content(current,'FULL_SOLUTION','Current reviewed solution');
   assert.equal((await quote('one',current,'FULL_SOLUTION')).price,0);
   assert.equal((await quote('two',current,'FULL_SOLUTION')).mode,'paid');
   assert.equal((await provide('one',current,'FULL_SOLUTION')).body,'Current reviewed solution');
   assert.equal((await call('one','wallet')).balance,before+4);
  });
  await t.test('Paper 4 uses actual stage marks, keeps stable first-AC and supports delayed examination awards',async()=>{
   const paperId=randomUUID(),versionId=randomUUID(),questions=[{key:'Q1',title:'First',stages:[{id:'s1',judgeMode:'auto',maxMarks:20}]},{key:'Q2',title:'Second',stages:[{id:'s2',judgeMode:'auto',maxMarks:40},{id:'s3',judgeMode:'auto',maxMarks:40}]}],content={title:'Mark proportions',definition:{questions}};
   await owner.query('INSERT INTO school_paper4_papers(school_id,id,owner_account_id,draft) VALUES($1,$2,$3,$4)',[alpha.id,paperId,users.teacher.id,content]);await owner.query('INSERT INTO school_paper4_versions(school_id,id,paper_id,draft_revision,content) VALUES($1,$2,$3,1,$4)',[alpha.id,versionId,paperId,content]);await owner.query('UPDATE school_paper4_papers SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,paperId,versionId]);
   async function createPaperActivity(kind){const aid=randomUUID();await owner.query("INSERT INTO school_paper4_activities(school_id,id,paper_id,version_id,owner_account_id,kind,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')",[alpha.id,aid,paperId,versionId,users.teacher.id,kind]);await owner.query('INSERT INTO school_paper4_participants(school_id,activity_id,identity_id) VALUES($1,$2,$3)',[alpha.id,aid,ids.two]);await transaction(app,async db=>{await db.query("SELECT set_config('campus.school_id',$1,true)",[alpha.id]);await configureSchoolActivityScholarshipRule(db,alpha.id,users.teacher,'teacher',aid,'paper4_activity',{amount:7,minimumAc:1,minimumScore:55},{initialize:true});});const attemptId=randomUUID();await owner.query("INSERT INTO school_paper4_attempts(school_id,id,paper_id,version_id,activity_id,identity_id,account_id,state,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',clock_timestamp())",[alpha.id,attemptId,paperId,versionId,aid,ids.two,users.two.id]);await owner.query("INSERT INTO school_paper4_jobs(school_id,version_id,attempt_id,account_id,identity_id,kind,payload) VALUES($1,$2,$3,$4,$5,'submit',$6)",[alpha.id,versionId,attemptId,users.two.id,ids.two,JSON.stringify({paperId,questions:questions.map(q=>({key:q.key,question:q,sourceCode:'pass'}))})]);return {aid,attemptId};}
   const result={status:'WA',questions:[{key:'Q1',status:'AC',stages:[{stageKey:'s1',status:'AC',marks:20,maxMarks:20}]},{key:'Q2',status:'WA',stages:[{stageKey:'s2',status:'AC',marks:40,maxMarks:40},{stageKey:'s3',status:'WA',marks:0,maxMarks:40}]}]};
   const before=(await call('two','wallet')).balance,practice=await createPaperActivity('practice');await finishSchoolPaper4Task(worker,await claimSchoolPaper4Task(worker),result);assert.equal((await call('two','wallet')).balance,before+11,'60% actual score qualifies although only half the questions are AC');await assert.rejects(call('teacher','activity-rule','POST',{type:'paper4_activity',activityId:practice.aid,amount:5,minimumAc:1,minimumScore:0,expectedRevision:1}),e=>e.code==='RULE_FROZEN');
   const exam=await createPaperActivity('exam');await finishSchoolPaper4Task(worker,await claimSchoolPaper4Task(worker),result);assert.equal((await call('two','wallet')).balance,before+11);await owner.query('UPDATE school_paper4_activities SET results_published_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[alpha.id,exam.aid]);assert.equal((await call('two','wallet')).balance,before+18,'same stable Paper4 question never earns another first-AC');await owner.query('UPDATE school_paper4_activities SET results_published_at=results_published_at WHERE school_id=$1 AND id=$2',[alpha.id,exam.aid]);assert.equal((await call('two','wallet')).balance,before+18);
  });
  await t.test('exact balance is sufficient, price confirmation is enforced and a published new version reuses entitlement',async()=>{const x=await problem('Exact balance');await content(x,'FULL_SOLUTION');const available=(await call('two','wallet')).balance;await call('teacher','policies','POST',{targets:[x],kind:'FULL_SOLUTION',price:available,mode:'paid'});const price=await quote('two',x,'FULL_SOLUTION');await assert.rejects(call('two','assistance/unlock','POST',{...x,kind:'FULL_SOLUTION',requestId:randomUUID(),confirmedContentId:price.contentId,confirmedRevision:price.contentRevision,confirmedPrice:price.price-1}),e=>e.code==='QUOTE_CHANGED');await unlock('two',x,'FULL_SOLUTION');assert.equal((await call('two','wallet')).balance,0);await provide('two',x,'FULL_SOLUTION');const next=randomUUID();await owner.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) SELECT school_id,$3,id,2,draft FROM school_problems WHERE school_id=$1 AND id=$2',[alpha.id,x.problemId,next]);await owner.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,x.problemId,next]);const target={...x,versionId:next};assert.equal((await quote('two',target,'FULL_SOLUTION')).available,false);await content(target,'FULL_SOLUTION','New reviewed version');assert.equal((await quote('two',target,'FULL_SOLUTION')).price,0);assert.equal((await provide('two',target,'FULL_SOLUTION')).body,'New reviewed version');assert.equal((await call('two','wallet')).balance,0);});
  await t.test('leaderboard uses names and distinct rank accounting, hidden fields stay out of JSON',async()=>{const route=`/schools/${alpha.id}/leaderboard`;let result=(await handleSchoolLeaderboard({pool:app,user:users.one,route,method:'GET',url:new URL('http://qa.local'+route)})).body;assert.ok(result.items.find(i=>i.identityId===ids.one).points>=20);assert.equal(result.items.find(i=>i.identityId===ids.one).name,'one');const prior=result.items.find(i=>i.identityId===ids.one),balance=(await call('one','wallet')).balance;await submit('one',q);await finish('WA');result=(await handleSchoolLeaderboard({pool:app,user:users.one,route,method:'GET',url:new URL('http://qa.local'+route)})).body;const repeated=result.items.find(i=>i.identityId===ids.one);assert.equal(repeated.attempts,prior.attempts+1);assert.ok(repeated.acRate<prior.acRate,'post-AC assessed submissions follow the legacy AC-rate policy');assert.equal(repeated.points,prior.points);assert.equal((await call('one','wallet')).balance,balance);const config=await call('admin','settings');await call('admin','settings','PATCH',{...config,expectedRevision:config.revision,displayFields:{solved:false,attempts:false,acRate:false,scholarship:false}});result=(await handleSchoolLeaderboard({pool:app,user:users.one,route,method:'GET',url:new URL('http://qa.local'+route)})).body;assert.equal(result.items[0].scholarship,undefined);assert.equal(result.items[0].acRate,undefined);assert.equal(result.items[0].attempts,undefined);});
  await t.test('school original source stays scoped to authorized authors and the exact version',async()=>{
   const original=await problem('Original school solution'),next=randomUUID();
   await owner.query(`INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition)
    SELECT school_id,$3,id,2,draft||$4::jsonb FROM school_problems WHERE school_id=$1 AND id=$2`,
   [alpha.id,original.problemId,next,{reference_code:'NEXT PRIVATE REFERENCE',editorial:'Next private explanation.'}]);
   await owner.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,original.problemId,next]);
   const latest={...original,versionId:next},kind='FULL_SOLUTION';
   const detail=target=>'content?'+new URLSearchParams({...target,kind});
   const snapshot=async()=>({
    versions:(await owner.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 ORDER BY id',[alpha.id,original.problemId])).rows,
    contents:(await owner.query('SELECT * FROM school_scholarship_contents WHERE school_id=$1 AND subject_key=$2 ORDER BY id',[alpha.id,`problem:${original.problemId}`])).rows,
   });
   const before=await snapshot(),earlier=await call('teacher',detail(original));
   assert.equal(earlier.status,'missing');assert.equal(earlier.revision,0);
   assert.equal(earlier.originalSolution.body,'```python\nPRIVATE REFERENCE\n```');
   assert.equal((await call('admin',detail(latest))).originalSolution.body,'Next private explanation.\n\n```python\nNEXT PRIVATE REFERENCE\n```');
   assert.deepEqual(await snapshot(),before);
   await assert.rejects(call('one',detail(latest)),e=>e.status===404);
   await assert.rejects(call('outsider',detail(latest)),e=>e.status===404);
   await assert.rejects(call('outsider',detail(latest),'GET',{},beta),e=>e.status===404);
   const other=await problem('Unrelated school version');
   await assert.rejects(call('teacher',detail({...latest,versionId:other.versionId})),e=>e.status===404);
   assert.equal((await call('teacher','content?'+new URLSearchParams({...latest,kind:'FULL_TRANSLATION'}))).originalSolution,undefined);
   await content(latest,kind,'Reviewed school article only.');
   await call('teacher','policies','POST',{targets:[latest],kind,price:0,mode:'paid'});
   const price=await quote('one',latest,kind),provided=await provide('one',latest,kind);
   assert.equal(price.originalSolution,undefined);assert.equal(provided.originalSolution,undefined);
   assert.equal(provided.body,'Reviewed school article only.');
   assert.doesNotMatch(JSON.stringify([price,provided]),/PRIVATE REFERENCE|private explanation/);
  });
  await t.test('school multilingual solutions preserve language through review, delivery and language-only revisions',async()=>{
   const target=await problem('Multilingual school solutions'),kind='FULL_SOLUTION';
   const solutions=['python','cpp','javascript',null].map((programmingLanguage,index)=>({title:`Approach ${index}`,body:`Language explanation ${index}`,programmingLanguage}));
   await assert.rejects(call('teacher','content','POST',{...target,kind,expectedRevision:0,solutions:[{...solutions[0],programmingLanguage:'ruby'}]}),e=>e.status===400);
   await assert.rejects(call('one','content','POST',{...target,kind,expectedRevision:0,solutions}),e=>e.status===404);
   const saved=await call('teacher','content','POST',{...target,kind,expectedRevision:0,solutions});
   await call('teacher','policies','POST',{targets:[target],kind,mode:'free'});
   await assert.rejects(provide('one',target,kind),e=>e.status===403);
   await call('admin','contents/review','POST',{confirmReviewed:true,items:[saved]});
   const delivered=await provide('one',target,kind);
   assert.deepEqual(delivered.solutions.map(s=>s.programmingLanguage??null),['python','cpp','javascript',null]);
   const detail='content?'+new URLSearchParams({...target,kind});
   const published=await call('teacher',detail);
   const pending=await call('teacher','content','POST',{...target,kind,expectedRevision:published.revision,
    solutions:published.solutions.map((s,index)=>({...s,programmingLanguage:index===0?null:s.programmingLanguage}))});
   assert.equal(pending.hasPendingSolutions,true);
   assert.deepEqual((await provide('one',target,kind)).solutions,delivered.solutions);
   assert.equal((await call('teacher',detail)).solutions[0].programmingLanguage,undefined);
   await assert.rejects(call('admin','contents/review','POST',{confirmReviewed:true,items:[{id:saved.id,revision:published.revision}]}),e=>e.status===409);
   await call('admin','contents/review','POST',{confirmReviewed:true,items:[pending]});
   const reviewed=await provide('one',target,kind);
   assert.equal(reviewed.solutions[0].programmingLanguage,undefined);
   assert.equal(reviewed.solutions[0].body,delivered.solutions[0].body);
   await assert.rejects(call('outsider',detail),e=>e.status===404);
  });
  await t.test('school versions inherit reviewed bundles without publishing, pending leakage or cross-school fallback',async()=>{
   const prior=await problem('Inherited school solutions'),kind='FULL_SOLUTION';
   const saved=await call('teacher','content','POST',{...prior,kind,expectedRevision:0,solutions:[
    {title:'Original explanation',body:'Reviewed school primary.',programmingLanguage:'python'},
    {title:'Another method',body:'Reviewed school alternative.',programmingLanguage:'cpp'},
   ]});
   await call('admin','contents/review','POST',{confirmReviewed:true,items:[saved]});
   const detail=target=>'content?'+new URLSearchParams({...target,kind});
   const published=await call('teacher',detail(prior));
   await call('teacher','content','POST',{...prior,kind,expectedRevision:published.revision,
    solutions:published.solutions.map(solution=>({...solution,body:'PRIVATE PENDING '+solution.body}))});
   const next=async(target,revision)=>{
    const versionId=randomUUID();
    await owner.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) SELECT school_id,$3,id,$4,draft FROM school_problems WHERE school_id=$1 AND id=$2',[alpha.id,target.problemId,versionId,revision]);
    return {...target,versionId};
   };
   const current=await next(prior,2),future=await next(prior,3);
   await owner.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,prior.problemId,current.versionId]);
   await content(future,kind,'FUTURE SCHOOL CONTENT');
   const unrelated=await problem('Other source');await content(unrelated,kind,'UNRELATED SCHOOL CONTENT');
   const before=(await owner.query('SELECT * FROM school_scholarship_contents ORDER BY school_id,id')).rows;
   const inherited=await call('teacher',detail(current));
   assert.equal(inherited.status,'missing');assert.equal(inherited.revision,0);
   assert.deepEqual(inherited.inheritedSolution,{versionId:prior.versionId,body:published.body,solutions:published.solutions});
   assert.doesNotMatch(JSON.stringify(inherited.inheritedSolution),/PRIVATE PENDING|FUTURE SCHOOL CONTENT|UNRELATED SCHOOL CONTENT/);
   assert.deepEqual((await owner.query('SELECT * FROM school_scholarship_contents ORDER BY school_id,id')).rows,before);
   const price=await quote('one',current,kind);
   assert.equal(price.available,false);assert.equal(price.inheritedSolution,undefined);
   await assert.rejects(provide('one',current,kind),e=>e.status===403);
   const blank=await problem('No prior published solution'),futureOnly=await next(blank,2);
   await content(futureOnly,kind,'FUTURE ONLY');
   assert.equal((await call('teacher',detail(blank))).inheritedSolution,undefined);
   const empty=await problem('No own-school solution'),foreignBank=randomUUID(),foreignVersion=randomUUID();
   await owner.query("INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,request_id) VALUES($1,$2,$3,'Foreign source',$4)",[beta.id,foreignBank,users.outsider.id,randomUUID()]);
   await owner.query("INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,'{}',$5)",[beta.id,empty.problemId,foreignBank,users.outsider.id,randomUUID()]);
   await owner.query("INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition,created_at) VALUES($1,$2,$3,1,'{}','2000-01-01')",[beta.id,foreignVersion,empty.problemId]);
   await owner.query("INSERT INTO school_scholarship_contents(school_id,subject_key,version_id,kind,language,body,status,author_account_id,published_at) VALUES($1,$2,$3,'FULL_SOLUTION','','FOREIGN SCHOOL CONTENT','published',$4,clock_timestamp())",[beta.id,`problem:${empty.problemId}`,foreignVersion,users.outsider.id]);
   assert.equal((await call('teacher',detail(empty))).inheritedSolution,undefined);
   const unstamped=await call('teacher','content','POST',{...empty,kind,body:'Missing school publication stamp.',expectedRevision:0});
   await owner.query("UPDATE school_scholarship_contents SET status='published' WHERE school_id=$1 AND id=$2",[alpha.id,unstamped.id]);
   assert.equal((await call('teacher',detail(await next(empty,2)))).inheritedSolution,undefined);
   assert.equal((await call('teacher','content?'+new URLSearchParams({...current,kind:'FULL_TRANSLATION'}))).inheritedSolution,undefined);
   const own=await call('teacher','content','POST',{...current,kind,body:'Current school draft.',expectedRevision:0});
   for(const status of ['draft','published','withdrawn']){
    await owner.query('UPDATE school_scholarship_contents SET status=$3 WHERE school_id=$1 AND id=$2',[alpha.id,own.id,status]);
    const existing=await call('teacher',detail(current));
    assert.equal(existing.inheritedSolution,undefined);assert.equal(existing.body,'Current school draft.');
   }
  });
  await t.test('school administrator reviews a whole solution bundle while the old solution remains available',async()=>{
   const target=await problem('Multiple school solutions');
   const kind='FULL_SOLUTION';
   const primary='Print the constant.';
   await content(target,kind,primary);
   const solutions=[
    {title:'Direct output',body:primary},
    {title:'Arithmetic',body:'Compute the sum before printing.'},
   ];
   const detail='content?'+new URLSearchParams({...target,kind});
   const current=await call('teacher',detail);
   const edit={...target,kind,body:primary,solutions,expectedRevision:current.revision};
   await assert.rejects(call('one','content','POST',edit),e=>e.status===404);
   await assert.rejects(call('outsider','content','POST',edit),e=>e.status===404);
   const staged=await call('teacher','content','POST',edit);
   assert.equal(staged.status,'published');
   const pending=await call('admin',detail);
   assert.equal(pending.hasPendingSolutions,true);
   await assert.rejects(call('teacher','content','POST',edit),e=>e.code==='REVISION_CONFLICT');
   await assert.rejects(call('admin','contents/review','POST',{confirmReviewed:true,items:[current]}),e=>e.code==='REVISION_CONFLICT');
   await assert.rejects(call('teacher','contents/review','POST',{confirmReviewed:true,items:[staged]}),e=>e.status===403);
   await call('teacher','policies','POST',{targets:[target],kind,price:0,mode:'paid'});
   const prior=await provide('one',target,kind);
   assert.equal(prior.body,primary);
   assert.equal(prior.solutions,undefined);
   await call('admin','contents/review','POST',{confirmReviewed:true,items:[staged]});
   const publishedQuote=await quote('one',target,kind);
   assert.equal(publishedQuote.solutions,undefined);
   assert.ok(!JSON.stringify(publishedQuote).includes('Arithmetic'));
   const published=await provide('one',target,kind);
   assert.deepEqual(published.solutions.map(({title,body})=>({title,body})),solutions);
  });
 }finally{await Promise.all([app?.end(),worker?.end()]);await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});

test('scholarship migration preserves historical AC and grants only the configured initial allowance',{skip:!process.env.TEST_DATABASE_URL,timeout:120000},async()=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(base.hostname));assert.match(base.pathname,/^\/campus_(qa(?:_[a-z0-9_]+)?|test)$/);
 const manager=createPool(base.href),schema='scholarship_history_'+randomBytes(5).toString('hex'),url=new URL(base);url.searchParams.set('options',`-csearch_path=${schema}`);const db=createPool(url.href);
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);
  // This disposable schema defers scholarship tables and dependent migrations.
  const deferred=['070_school_scholarship.sql','076_student_system_notifications.sql','077_assignment_completion_scholarship.sql','080_public_scholarship.sql','082_activity_bonus_scholarship.sql','085_public_practice_preferences.sql','096_problem_solution_bundles.sql','107_public_practice_profiles.sql'];
  await db.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');await db.query('INSERT INTO schema_migrations(name) SELECT unnest($1::text[])',[deferred]);await migrate(db);
  const person=(await db.query("INSERT INTO identities(kind,number,name) VALUES('personal','history','History') RETURNING id")).rows[0],user=(await db.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'history','unusable-qa') RETURNING id",[person.id])).rows[0];
  const school=await provisionSchool(db,{slug:'history-alpha',name:'History',adminUsername:'history'});await db.query("UPDATE school_memberships SET role='student' WHERE school_id=$1 AND account_id=$2",[school.id,user.id]);
  const identity=(await db.query("INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,'student','history','History',$2) RETURNING id",[school.id,user.id])).rows[0],bank=(await db.query("INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id) VALUES($1,$2,'Old bank',$3) RETURNING id",[school.id,user.id,randomUUID()])).rows[0];
  const problemId=randomUUID(),versionId=randomUUID();await db.query("INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,'{}',$5)",[school.id,problemId,bank.id,user.id,randomUUID()]);await db.query("INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) VALUES($1,$2,$3,1,'{}')",[school.id,versionId,problemId]);
  const enqueue=async completed=>(await db.query("INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,request_id,request_hash,kind,access_context,payload,state,result,completed_at) VALUES($1,$2,$3,$4,$5,$6,'history','submit','school','{}',$7,$8,CASE WHEN $7='completed' THEN clock_timestamp() ELSE NULL END) RETURNING *",[school.id,problemId,versionId,user.id,identity.id,randomUUID(),completed?'completed':'queued',completed?{status:'AC',score:100}:null])).rows[0];
  const old=await enqueue(true);await db.query('UPDATE luq_settings SET initial_grant=37,rule_version=rule_version+1 WHERE singleton');const legacy=(await db.query('SELECT count(*)::int n FROM luq_ledger')).rows[0];
  await db.query('DELETE FROM schema_migrations WHERE name=ANY($1::text[])',[deferred]);await migrate(db);
  assert.deepEqual((await db.query('SELECT * FROM school_judge_jobs WHERE school_id=$1 AND id=$2',[school.id,old.id])).rows[0],old);
  assert.equal((await db.query('SELECT balance FROM school_scholarship_accounts WHERE school_id=$1 AND identity_id=$2',[school.id,identity.id])).rows[0].balance,37);
  assert.equal((await db.query('SELECT reason FROM school_scholarship_claims WHERE school_id=$1 AND identity_id=$2',[school.id,identity.id])).rows[0].reason,'historical_ac');
  const later=await enqueue(false);await db.query("UPDATE school_judge_jobs SET state='completed',completed_at=clock_timestamp(),result='{"+'"status":"AC","score":100'+"}' WHERE school_id=$1 AND id=$2",[school.id,later.id]);
  assert.equal((await db.query('SELECT balance FROM school_scholarship_accounts WHERE school_id=$1 AND identity_id=$2',[school.id,identity.id])).rows[0].balance,37);assert.equal((await db.query("SELECT count(*)::int n FROM school_scholarship_ledger WHERE kind='first_ac'")).rows[0].n,0);assert.deepEqual((await db.query('SELECT count(*)::int n FROM luq_ledger')).rows[0],legacy);
 }finally{await db.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
