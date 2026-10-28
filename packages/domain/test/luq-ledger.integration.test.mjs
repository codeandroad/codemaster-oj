import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { handleLuqLedger, postLuqEntry } from '../src/luq-ledger.mjs';
const url=process.env.TEST_DATABASE_URL;
let pool,manager,schema,teacher,admin;
const req=(route,method,user,body={})=>handleLuqLedger({pool,route,method,user,body,url:new URL('http://localhost'+route)});
async function account(kind='student') {
 const key=randomUUID(); const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,key])).rows[0].id;
 const id=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$2) RETURNING id',[identityId,key])).rows[0].id;
 await pool.query('INSERT INTO account_roles VALUES($1,$2)',[id,kind]);return{id,identityId,roles:[kind]};
}
async function problem() {
 const id=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[teacher.id])).rows[0].id;
 const versionId=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,
 validation_status,published_at,rank_review_status,rank_approved_at,school_visible_at)
 VALUES($1,'Luq test','stdio','Test',500,64,'print(1)','AC',now(),'approved',now(),now()) RETURNING id`,[id])).rows[0].id;
 return{id,versionId};
}
async function submit(user,p,{status='AC',assignmentId=null,timedAttemptId=null,createdAt=null,kind='submit'}={}) {
 return(await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,assignment_id,timed_attempt_id,kind,code,idempotency_key,request_hash,status,score,created_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,'print(1)',$8,'test',$9,$10,COALESCE($11::timestamptz,clock_timestamp())) RETURNING *`,
 [user.id,user.identityId,p.id,p.versionId,assignmentId,timedAttemptId,kind,randomUUID(),status,status==='AC'?100:status==='WA'?0:null,createdAt])).rows[0];
}
async function delivery(user,p,kind='FULL_SOLUTION') {
 const content=(await pool.query(`INSERT INTO luq_assistance_contents(subject_key,version_id,kind,language,body,author_account_id)
 VALUES($1,$2,$3,'','test',$4) ON CONFLICT(subject_key,version_id,kind,language) DO UPDATE SET body=EXCLUDED.body RETURNING id`,['problem:'+p.id,p.versionId,kind,teacher.id])).rows[0];
 await pool.query(`INSERT INTO luq_assistance_deliveries(identity_id,subject_key,version_id,kind,content_id,context_type)
 VALUES($1,$2,$3,$4,$5,'problem')`,[user.identityId,'problem:'+p.id,p.versionId,kind,content.id]);
}
const balance=async user=>(await req('/luq/me','GET',user)).body.balance;
const credit=async(user,amount=20)=>req('/luq/grants','POST',admin,{requestId:randomUUID(),identityIds:[user.identityId],amount,reason:'Integration grant'});
const purchase=async(user,key=randomUUID(),amount=8)=>transaction(pool,db=>postLuqEntry(db,{identityId:user.identityId,delta:-amount,kind:'purchase',sourceKey:'purchase:'+key,reason:'Test purchase',requestHash:key}));
test.before(async()=>{if(!url)return;manager=createPool(url);schema='luq_'+randomBytes(8).toString('hex');await manager.query(`CREATE SCHEMA ${schema}`);const conn=new URL(url);conn.searchParams.set('options',`-csearch_path=${schema}`);pool=createPool(conn.toString());await migrate(pool);await migrate(pool);await pool.query('UPDATE luq_settings SET initial_grant=0,rule_version=rule_version+1 WHERE singleton');teacher=await account('teacher');admin=await account('admin');});
test.after(async()=>{if(pool)await pool.end();if(schema)await manager.query(`DROP SCHEMA ${schema} CASCADE`);if(manager)await manager.end();});

test('With initial allowance disabled, Luq starts at zero without converting points and forbids nonadmin adjustments',{skip:!url},async()=>{
 const s=await account();assert.equal(await balance(s),0);await assert.rejects(req('/luq/grants','POST',teacher,{}),e=>e.code==='FORBIDDEN');
 const p=await problem();await submit(s,p);assert.equal(await balance(s),4);
 assert.equal((await pool.query("SELECT sum(points)::int n FROM point_ledger WHERE identity_id=$1 AND reason='first_ac'",[s.identityId])).rows[0].n,10);
});
test('concurrent first AC and duplicate callback mint once across versions and activity contexts',{skip:!url},async()=>{
 const s=await account(),p=await problem();const results=await Promise.all([submit(s,p),submit(s,p),submit(s,p)]);
 await Promise.all(results.map(r=>pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[r.id])));
 assert.equal(await balance(s),4);assert.equal((await pool.query('SELECT count(*)::int n FROM luq_first_ac_claims WHERE identity_id=$1',[s.identityId])).rows[0].n,1);
 const another=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,
 rank_review_status,rank_approved_at,school_visible_at) VALUES($1,'v2','stdio','New',500,64,'print(1)',now(),'approved',now(),now()) RETURNING id`,[p.id])).rows[0].id;
 await submit(s,{...p,versionId:another});assert.equal(await balance(s),4);
});
test('samples never award; unapproved first AC consumes eligibility and rejudges are audit only',{skip:!url},async()=>{
 const s=await account(),p=await problem();await submit(s,p,{kind:'samples'});assert.equal(await balance(s),0);
 const result=await submit(s,p,{status:'WA'});await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[result.id]);assert.equal(await balance(s),0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_review_cases WHERE identity_id=$1',[s.identityId])).rows[0].n,1);
});
test('translation preserves first AC; prior full solution blocks Luq but preserves grades and points',{skip:!url},async()=>{
 const s=await account(),p=await problem();await delivery(s,p,'FULL_TRANSLATION');await submit(s,p);assert.equal(await balance(s),4);
 const q=await problem();await delivery(s,q);await submit(s,q);assert.equal(await balance(s),4);
 assert.equal((await pool.query("SELECT count(*)::int n FROM point_ledger WHERE identity_id=$1 AND reason='first_ac'",[s.identityId])).rows[0].n,2);
});
test('solution delivered after accepted submission while judge waits does not remove Luq',{skip:!url},async()=>{
 const s=await account(),p=await problem(),pending=await submit(s,p,{status:'Waiting'});await delivery(s,p);
 await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[pending.id]);assert.equal(await balance(s),4);
 await assert.rejects(pool.query('UPDATE submissions SET luq_solution_assisted=true WHERE id=$1',[pending.id]),/immutable/);
 await submit(s,p);assert.equal(await balance(s),4);
});
test('competing purchases cannot overdraw, exact balance succeeds, retries debit once',{skip:!url},async()=>{
 const s=await account();await credit(s,8);const outcomes=await Promise.allSettled([purchase(s,'race-a'),purchase(s,'race-b')]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'LUQ_INSUFFICIENT_BALANCE');assert.equal(await balance(s),0);
 const winner=outcomes[0].status==='fulfilled'?'race-a':'race-b';await purchase(s,winner);assert.equal(await balance(s),0);
 await assert.rejects(pool.query('UPDATE luq_ledger SET delta=100 WHERE identity_id=$1',[s.identityId]),/append-only/);
});
test('bulk grant retries preserve original class membership and reject changed payload',{skip:!url},async()=>{
 const a=await account(),b=await account();const cls=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Luq',$1) RETURNING id",[teacher.id])).rows[0].id;
 await pool.query('INSERT INTO class_members VALUES($1,$2)',[cls,a.identityId]);const body={requestId:randomUUID(),classIds:[cls],amount:7,reason:'Batch'};
 await Promise.all([req('/luq/grants','POST',admin,body),req('/luq/grants','POST',admin,body)]);
 await pool.query('INSERT INTO class_members VALUES($1,$2)',[cls,b.identityId]);await req('/luq/grants','POST',admin,body);
 assert.equal(await balance(a),7);assert.equal(await balance(b),0);
 await assert.rejects(req('/luq/grants','POST',admin,{...body,amount:8}),e=>e.code==='IDEMPOTENCY_CONFLICT');
});
test('refunds are linked and once-only; different retry IDs do not pay twice and entitlement remains',{skip:!url},async()=>{
 const s=await account();await credit(s,8);const debit=await purchase(s);await pool.query("INSERT INTO luq_assistance_entitlements(identity_id,subject_key,kind,ledger_id) VALUES($1,'problem:test','FULL_SOLUTION',$2)",[s.identityId,debit.id]);
 assert.equal((await req('/luq/ledger','GET',admin)).body.items.find(item=>item.id===debit.id).refunded,false);
 const refund=()=>req('/luq/refunds','POST',admin,{requestId:randomUUID(),ledgerId:debit.id,reason:'Refund'});await Promise.all([refund(),refund()]);assert.equal(await balance(s),8);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_ledger WHERE refund_of=$1',[debit.id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements WHERE identity_id=$1',[s.identityId])).rows[0].n,1);
 const ledger=(await req('/luq/ledger','GET',admin)).body.items;
 assert.equal(ledger.find(item=>item.id===debit.id).refunded,true);
 assert.equal(ledger.find(item=>item.refundOf===debit.id).refunded,false);
});
async function assignment(s,problems,amount=6,allow=false){
 const id=(await pool.query("INSERT INTO assignments(title,owner_account_id,due_at,state) VALUES('Luq',$1,now()+interval '1 hour','Draft') RETURNING id",[teacher.id])).rows[0].id;
 for(const[pindex,p]of problems.entries())await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,$4,$5)',[id,p.id,p.versionId,100/problems.length,pindex]);
 await pool.query('INSERT INTO assignment_participants VALUES($1,$2,false)',[id,s.identityId]);
 await pool.query(`INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,task_kind,allow_solution_assisted,created_by)
 VALUES('assignment',$1,1,$2,$3,100,$4,$5,$6)`,[id,amount,problems.length,allow?'learning':'challenge',allow,teacher.id]);
 await pool.query("UPDATE assignments SET state='Published' WHERE id=$1",[id]);return id;
}
test('assignment targets stack with first AC exactly once and published rules freeze',{skip:!url},async()=>{
 const s=await account(),p=await problem(),q=await problem(),id=await assignment(s,[p,q]);
 await Promise.all([submit(s,p,{assignmentId:id}),submit(s,q,{assignmentId:id})]);assert.equal(await balance(s),14);
 await submit(s,p,{assignmentId:id});assert.equal(await balance(s),14);
 await assert.rejects(pool.query("INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,created_by) VALUES('assignment',$1,2,10,$2)",[id,teacher.id]),/LUQ_RULE_FROZEN/);
 const next=await assignment(s,[p],3);await submit(s,p,{assignmentId:next});assert.equal(await balance(s),17,'same problem new activity earns only configured activity bonus');
});
test('challenge excludes assisted attempts; learning may explicitly allow them',{skip:!url},async()=>{
 const s=await account(),p=await problem();await delivery(s,p);const challenge=await assignment(s,[p],6);await submit(s,p,{assignmentId:challenge});assert.equal(await balance(s),0);
 const learning=await assignment(s,[p],6,true);await submit(s,p,{assignmentId:learning});assert.equal(await balance(s),6);
});
async function timedPractice(s,p,{reward=7,allow=false}={}){
 const id=(await pool.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes)
 VALUES('Luq timed',$1,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour',60) RETURNING id`,[teacher.id])).rows[0].id;
 await pool.query('INSERT INTO timed_practice_participants VALUES($1,$2,false)',[id,s.identityId]);
 await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[id,p.id,p.versionId]);
 await pool.query(`INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,task_kind,allow_solution_assisted,created_by)
 VALUES('timed',$1,1,$2,1,100,$3,$4,$5)`,[id,reward,allow?'learning':'challenge',allow,teacher.id]);
 await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[id]);
 const attempt=(await pool.query(`INSERT INTO timed_attempts(practice_id,identity_id,account_id,started_at,deadline_at)
 VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '1 hour') RETURNING id`,[id,s.identityId,s.id])).rows[0].id;
 return{id,attempt};
}
async function publishTimed(id){await transaction(pool,async db=>{
 await db.query('SELECT id FROM timed_practices WHERE id=$1 FOR UPDATE',[id]);
 if((await db.query('SELECT results_published_at FROM timed_practices WHERE id=$1',[id])).rows[0].results_published_at)return;
 await db.query(`INSERT INTO timed_first_ac_candidates(submission_id,practice_id) SELECT s.id,$1 FROM submissions s
 JOIN timed_attempts a ON a.id=s.timed_attempt_id WHERE a.practice_id=$1 AND s.kind='submit' AND s.status='AC'
 AND s.created_at<=LEAST(a.deadline_at,(SELECT ends_at FROM timed_practices WHERE id=$1))`,[id]);
 await db.query("UPDATE timed_practices SET state='ResultsPublished',results_published_at=clock_timestamp() WHERE id=$1",[id]);
});}
test('timed first AC and target bonuses wait for first release, then settle once',{skip:!url},async()=>{
 const s=await account(),p=await problem(),timed=await timedPractice(s,p);await submit(s,p,{timedAttemptId:timed.attempt});assert.equal(await balance(s),0);
 await Promise.all([publishTimed(timed.id),publishTimed(timed.id)]);assert.equal(await balance(s),11);
 await pool.query('UPDATE timed_practices SET results_published_at=results_published_at WHERE id=$1',[timed.id]);assert.equal(await balance(s),11);
});
test('timed final assisted submission cannot fall back to an earlier unassisted AC for challenge bonus',{skip:!url},async()=>{
 const s=await account(),p=await problem(),timed=await timedPractice(s,p);await submit(s,p,{timedAttemptId:timed.attempt});await delivery(s,p);
 await submit(s,p,{timedAttemptId:timed.attempt});await publishTimed(timed.id);assert.equal(await balance(s),4);
});
test('timed submissions after personal deadline never settle first AC or bonus',{skip:!url},async()=>{
 const s=await account(),p=await problem(),timed=await timedPractice(s,p);
 const at=new Date(Date.now()+2000);await pool.query('UPDATE timed_attempts SET deadline_at=$2 WHERE id=$1',[timed.attempt,at]);
 await submit(s,p,{timedAttemptId:timed.attempt,createdAt:new Date(at.getTime()+1)});await publishTimed(timed.id);assert.equal(await balance(s),0);
});
test('bulk negative adjustment is atomic if any student lacks funds',{skip:!url},async()=>{
 const a=await account(),b=await account();await credit(a,10);await credit(b,2);
 await assert.rejects(req('/luq/adjustments','POST',admin,{requestId:randomUUID(),identityIds:[a.identityId,b.identityId],amount:-5,reason:'Correction'}),e=>e.code==='LUQ_INSUFFICIENT_BALANCE');
 assert.equal(await balance(a),10);assert.equal(await balance(b),2);
});
test('old submissions do not backfill Luq or allow a new first AC later',{skip:!url},async()=>{
 const s=await account(),p=await problem();await submit(s,p,{createdAt:new Date('2020-01-01T00:00:00Z')});assert.equal(await balance(s),0);
 await submit(s,p);assert.equal(await balance(s),0);
});
async function paper4({source=null,exam=false}={}) {
 const definition={questions:[{key:'Q1',stages:[{id:'stage1',judgeMode:'auto',maxMarks:75}]}]},cases={stage1:[{id:'case1'}]};
 const row=(await pool.query(`INSERT INTO paper4_papers(owner_account_id,title,status,published_at,delivery_kind,activity_kind,source_paper_id,source_version_id,starts_at,ends_at)
 VALUES($1,'Luq Paper4','published',now(),$2,$3,$4,$5,$6,$7) RETURNING id`,[teacher.id,source?'activity':'catalog',source?(exam?'exam':'practice'):null,source?.id??null,source?.versionId??null,
 source?new Date(Date.now()+60000):null,source?new Date(Date.now()+3600000):null])).rows[0];
 const versionId=(await pool.query(`INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,published_at)
 VALUES($1,'Luq Paper4','',$2,$3,now()) RETURNING id`,[row.id,definition,cases])).rows[0].id;
 await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[row.id,versionId]);return{id:row.id,versionId};
}
async function paper4Attempt(s,p,{origin='formal',number=1,assisted=false}={}){
 if(assisted){const subject='paper4:'+p.id+':Q1';const content=(await pool.query("INSERT INTO luq_assistance_contents(subject_key,version_id,kind,body,author_account_id) VALUES($1,$2,'FULL_SOLUTION','answer',$3) RETURNING id",[subject,p.versionId,teacher.id])).rows[0].id;
 await pool.query("INSERT INTO luq_assistance_deliveries(identity_id,subject_key,version_id,kind,content_id,context_type) VALUES($1,$2,$3,'FULL_SOLUTION',$4,'paper4')",[s.identityId,subject,p.versionId,content]);}
 const id=(await pool.query(`INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,attempt_number,state,submitted_at)
 VALUES($1,$2,$3,$4,$5,'submitted',clock_timestamp()) RETURNING id`,[p.id,p.versionId,s.identityId,s.id,number])).rows[0].id;
 const snapshotId=(await pool.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin) VALUES($1,'Q1','print(1)',0,$2) RETURNING id",[id,origin])).rows[0].id;
 return{id,snapshotId};
}
async function paper4AC(a,{valid=true,status='AC'}={}){
 const lease=randomUUID();const task=(await pool.query("INSERT INTO paper4_run_tasks(snapshot_id,state,lease_id,lease_expires_at) VALUES($1,'leased',$2,now()+interval '1 minute') RETURNING id",[a.snapshotId,lease])).rows[0].id;
 return(await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,private_results,environment_version)
 VALUES($1,$2,$3,$5,$4,'luq-test') RETURNING *`,[task,lease,a.snapshotId,JSON.stringify(valid?[{stageId:'stage1',caseId:'case1',status}]:[]),status])).rows[0];
}
test('Paper4 full-question AC awards once across catalog and activity; sample/invalid runs never award',{skip:!url},async()=>{
 const s=await account(),p=await paper4();const practice=await paper4Attempt(s,p,{origin:'practice'});await paper4AC(practice);assert.equal(await balance(s),0);
 const formal=await paper4Attempt(s,p,{number:2});assert.equal((await paper4AC(formal)).rank_ac_valid,true);assert.equal(await balance(s),4);
 const activity=await paper4({source:p});await pool.query("UPDATE paper4_papers SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[activity.id]);
 await pool.query('INSERT INTO paper4_activity_participants VALUES($1,$2)',[activity.id,s.identityId]);await paper4AC(await paper4Attempt(s,activity));assert.equal(await balance(s),4);
 const other=await account();await paper4AC(await paper4Attempt(other,p),{valid:false});assert.equal(await balance(other),0);
});
test('Paper4 exam AC and activity target wait for first result release',{skip:!url},async()=>{
 const s=await account(),p=await paper4(),exam=await paper4({source:p,exam:true});
 await pool.query('INSERT INTO paper4_activity_participants VALUES($1,$2)',[exam.id,s.identityId]);
 await pool.query("INSERT INTO luq_activity_rules(activity_type,activity_id,rule_version,amount,minimum_ac,minimum_score,created_by) VALUES('paper4_activity',$1,1,9,1,100,$2)",[exam.id,teacher.id]);
 await pool.query("UPDATE paper4_papers SET starts_at=clock_timestamp()-interval '1 second' WHERE id=$1",[exam.id]);
 const a=await paper4Attempt(s,exam);await paper4AC(a);assert.equal(await balance(s),0);
 await pool.query('UPDATE paper4_attempts SET released_at=clock_timestamp() WHERE id=$1',[a.id]);assert.equal(await balance(s),13);
 await pool.query('UPDATE paper4_attempts SET released_at=released_at WHERE id=$1',[a.id]);assert.equal(await balance(s),13);
});
test('Paper4 solution state snapshot excludes rewards but preserves school ranking',{skip:!url},async()=>{
 const s=await account(),p=await paper4();await paper4AC(await paper4Attempt(s,p,{assisted:true}));assert.equal(await balance(s),0);
 assert.equal((await pool.query('SELECT sum(points)::int n FROM paper4_rank_ledger WHERE identity_id=$1',[s.identityId])).rows[0].n,10);
});
test('upgrading preserves old points and consumes historical AC; only the one-time initial allowance is issued',{skip:!url},async()=>{
 const priorSchema='luq_upgrade_'+randomBytes(6).toString('hex');await manager.query(`CREATE SCHEMA ${priorSchema}`);
 const conn=new URL(url);conn.searchParams.set('options',`-csearch_path=${priorSchema}`);const old=createPool(conn.href);
 try {
  await old.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  const migrations=new URL('../migrations/',import.meta.url);
  for(const name of(await readdir(migrations)).filter(n=>n.endsWith('.sql')&&n<'043').sort()){
   const sql=(await readFile(new URL(name,migrations),'utf8')).replaceAll('SECURITY DEFINER SET search_path=public,pg_temp',`SECURITY DEFINER SET search_path="${priorSchema}",pg_temp`);
   await old.query(sql);await old.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
  }
  const identity=(await old.query("INSERT INTO identities(kind,number,name) VALUES('student','old','Old student') RETURNING id")).rows[0].id;
  const owner=(await old.query("INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,'old','unused') RETURNING id",[identity])).rows[0].id;
  const p=(await old.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner])).rows[0].id;
  const version=(await old.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,rank_review_status,rank_approved_at,school_visible_at)
   VALUES($1,'Historic','stdio','Historic',500,64,'print(1)',now(),'approved',now(),now()) RETURNING id`,[p])).rows[0].id;
  const oldSubmit=()=>old.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,'submit','print(1)',$5,'test','AC',100) RETURNING id`,[owner,identity,p,version,randomUUID()]);
  const historic=(await oldSubmit()).rows[0].id;
  await old.query("UPDATE submissions SET status='WA',score=0 WHERE id=$1",[historic]);
  const pendingProblem=(await old.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner])).rows[0].id;
  const pendingVersion=(await old.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,rank_review_status,rank_approved_at,school_visible_at)
   VALUES($1,'Pending','stdio','Pending',500,64,'print(2)',now(),'approved',now(),now()) RETURNING id`,[pendingProblem])).rows[0].id;
  const waiting=(await old.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','print(2)',$5,'test') RETURNING id`,[owner,identity,pendingProblem,pendingVersion,randomUUID()])).rows[0].id;
  // Legacy immutable awards may identify the classroom copy rather than its
  // source. A missing/rejudged run must not cause the old award to be forgotten.
  const sourcePaper=(await old.query("INSERT INTO paper4_papers(owner_account_id,title,status,published_at) VALUES($1,'Historic source','published',now()) RETURNING id",[owner])).rows[0].id;
  const paperDefinition={questions:[{key:'Q1',stages:[{id:'a',judgeMode:'auto',maxMarks:75}]}]};
  const sourceVersion=(await old.query("INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,published_at) VALUES($1,'Historic source','',$2,$3,now()) RETURNING id",[sourcePaper,paperDefinition,{a:[{id:'case'}]}])).rows[0].id;
  const copyPaper=(await old.query(`INSERT INTO paper4_papers(owner_account_id,title,status,published_at,delivery_kind,activity_kind,source_paper_id,source_version_id)
   VALUES($1,'Historic copy','published',now(),'activity','practice',$2,$3) RETURNING id`,[owner,sourcePaper,sourceVersion])).rows[0].id;
  const copyVersion=(await old.query("INSERT INTO paper4_versions(paper_id,title,description,definition,runner_cases,published_at) VALUES($1,'Historic copy','',$2,$3,now()) RETURNING id",[copyPaper,paperDefinition,{a:[{id:'case'}]}])).rows[0].id;
  const historicAttempt=(await old.query("INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at) VALUES($1,$2,$3,$4,'submitted',now()) RETURNING id",[copyPaper,copyVersion,identity,owner])).rows[0].id;
  const historicSnapshot=(await old.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin) VALUES($1,'Q1','old paper code',0,'formal') RETURNING id",[historicAttempt])).rows[0].id;
  const historicTask=(await old.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[historicSnapshot])).rows[0].id;
  const historicRun=(await old.query("INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,environment_version) VALUES($1,$2,$3,'WA','legacy') RETURNING id",[historicTask,randomUUID(),historicSnapshot])).rows[0].id;
  await old.query("INSERT INTO paper4_rank_ledger(identity_id,paper_id,version_id,attempt_id,question_key,run_id) VALUES($1,$2,$3,$4,'Q1',$5)",[identity,copyPaper,copyVersion,historicAttempt,historicRun]);
  const before=(await old.query('SELECT id,identity_id,code,status,score FROM submissions ORDER BY id')).rows;
  const beforeAccounts=(await old.query('SELECT * FROM accounts ORDER BY id')).rows;
  await migrate(old);await migrate(old);
  assert.deepEqual((await old.query('SELECT id,identity_id,code,status,score FROM submissions ORDER BY id')).rows,before);
  const upgradedAccounts=(await old.query('SELECT * FROM accounts ORDER BY id')).rows;
  assert.deepEqual(upgradedAccounts.map(({leaderboard_use_nickname,...legacy})=>legacy),beforeAccounts);
  assert.ok(upgradedAccounts.every(account=>account.leaderboard_use_nickname===false));
  assert.equal((await old.query('SELECT count(*)::int n FROM luq_ledger WHERE kind<>\'initial_grant\'')).rows[0].n,0);
  assert.equal((await old.query("SELECT reason FROM luq_first_ac_claims WHERE identity_id=$1 AND subject_key=$2",[identity,'problem:'+p])).rows[0].reason,'historical_ac');
  assert.equal((await old.query("SELECT reason FROM luq_first_ac_claims WHERE identity_id=$1 AND subject_key=$2",[identity,'paper4:'+sourcePaper+':Q1'])).rows[0].reason,'historical_ac');
  await old.query('SELECT luq_claim_first_ac($1,$2,$3,true,4,$4)',[identity,'paper4:'+sourcePaper+':Q1','catalog-retry','eligible']);
  assert.equal((await old.query('SELECT count(*)::int n FROM luq_ledger WHERE kind<>\'initial_grant\'')).rows[0].n,0,'historical classroom copy consumes canonical catalog reward');
  await oldSubmit();assert.equal((await old.query('SELECT count(*)::int n FROM luq_ledger WHERE kind<>\'initial_grant\'')).rows[0].n,0);
  assert.equal((await old.query('SELECT sum(points)::int n FROM point_ledger WHERE identity_id=$1',[identity])).rows[0].n,10);
  await old.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[waiting]);
  assert.equal((await old.query('SELECT count(*)::int n FROM luq_ledger WHERE kind<>\'initial_grant\'')).rows[0].n,0,'preactivation pending submission cannot backfill');
  const fresh=(await old.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner])).rows[0].id;
  const freshVersion=(await old.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,published_at,rank_review_status,rank_approved_at,school_visible_at)
   VALUES($1,'Fresh','stdio','Fresh',500,64,'print(3)',now(),'approved',now(),now()) RETURNING id`,[fresh])).rows[0].id;
  await old.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,'submit','print(3)',$5,'test','AC',100)`,[owner,identity,fresh,freshVersion,randomUUID()]);
  assert.equal((await old.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[identity])).rows[0].balance,104);
  assert.equal((await old.query("SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1 AND kind='initial_grant' AND delta=100",[identity])).rows[0].n,1);
 } finally {await old.end();await manager.query(`DROP SCHEMA ${priorSchema} CASCADE`);}
});
test('settings changes retain immutable rule versions and activation cutoff',{skip:!url},async()=>{
 const before=(await req('/luq/settings','GET',admin)).body;
 const next=(await req('/luq/settings','PATCH',admin,{translationPrice:5})).body;
 assert.equal(next.ruleVersion,before.ruleVersion+1);assert.equal(next.translationPrice,5);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_setting_versions')).rows[0].n,next.ruleVersion);
 await assert.rejects(pool.query("UPDATE luq_settings SET enabled_at=clock_timestamp(),rule_version=rule_version+1 WHERE singleton"),/immutable/);
 await assert.rejects(pool.query('DELETE FROM luq_setting_versions'),/append-only/);
});

test('submission received before solution delivery keeps its unassisted snapshot even if insert waits',{skip:!url},async()=>{
 const s=await account(),p=await problem();const acceptedAt=(await pool.query('SELECT clock_timestamp() t')).rows[0].t;
 await delivery(s,p);const earlier=await submit(s,p,{createdAt:acceptedAt,status:'Waiting'});
 assert.equal(earlier.luq_solution_assisted,false);
 const later=await submit(s,p,{status:'Waiting'});assert.equal(later.luq_solution_assisted,true);
 await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[earlier.id]);assert.equal(await balance(s),4);
});

test('Paper4 rejudge changed verdict creates review without minting first AC or activity Luq',{skip:!url},async()=>{
 const s=await account(),p=await paper4(),a=await paper4Attempt(s,p);await paper4AC(a,{status:'WA'});assert.equal(await balance(s),0);
 await paper4AC(a);assert.equal(await balance(s),0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM luq_review_cases WHERE identity_id=$1',[s.identityId])).rows[0].n,1);
});

test('earlier clean submission keeps first AC when a later assisted submission finishes first',{skip:!url},async()=>{
 const s=await account(),p=await problem();const clean=await submit(s,p,{status:'Waiting'});await delivery(s,p);
 const assisted=await submit(s,p);assert.equal(assisted.luq_solution_assisted,true);assert.equal(await balance(s),0);
 await pool.query("UPDATE submissions SET status='AC',score=100 WHERE id=$1",[clean.id]);assert.equal(await balance(s),4);
 await submit(s,p);assert.equal(await balance(s),4);
});
test('Paper4 clean snapshot retains first AC when later assisted attempt finishes first',{skip:!url},async()=>{
 const s=await account(),p=await paper4(),clean=await paper4Attempt(s,p);
 const assisted=await paper4Attempt(s,p,{number:2,assisted:true});await paper4AC(assisted);assert.equal(await balance(s),0);
 await paper4AC(clean);assert.equal(await balance(s),4);
});
