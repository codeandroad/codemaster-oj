import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { handlePaper4 } from '../src/paper4.mjs';
import { handleEducation } from '../src/education.mjs';
import { handleCommunity } from '../src/community.mjs';
import { completePaper4Task } from '../paper4-worker.mjs';

test('only final Paper 4 whole-question AC awards 10 points once across revisions and periods',
 { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = `paper4_rank_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(url.href);
  try {
    await migrate(pool);
    async function account(kind) {
      const identityId = (await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
        [kind, randomUUID(), `${kind} Paper 4`])).rows[0].id;
      const id = (await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
        [identityId, randomUUID(), 'test-only-hash'])).rows[0].id;
      await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [id,kind]);
      return { id, identityId, roles:[kind] };
    }
    const teacher = await account('teacher'), student = await account('student'), outsider = await account('student');
    const classId = (await pool.query('INSERT INTO classes(name,owner_account_id) VALUES($1,$2) RETURNING id',
      ['Paper 4 rank',teacher.id])).rows[0].id;
    await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[classId,teacher.id]);
    await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,student.identityId]);
    const definition = { language:'python',totalMarks:75,questions:[
      {key:'Q1',title:'Queue',statement:'Queue',starterCode:'print(1)',initialFiles:{},outputFiles:[],stages:[
        {id:'Q1_auto',title:'Behaviour',maxMarks:40,judgeMode:'auto'},
        {id:'Q1_manual',title:'Source review',maxMarks:10,judgeMode:'manual'}]},
      {key:'Q2',title:'Files',statement:'Files',starterCode:'print(2)',initialFiles:{},outputFiles:[],stages:[
        {id:'Q2_auto',title:'Behaviour',maxMarks:25,judgeMode:'auto'}]},
    ] };
    const runnerCases = { Q1_auto:[{id:'public',public:true,expectedStdout:'1\n'},
      {id:'hidden',public:false,expectedStdout:'1\n'}],
    Q2_auto:[{id:'file',public:true,expectedStdout:'2\n'}] };
    async function paper({endsAt=null}={}) {
      const paperId = (await pool.query(`INSERT INTO paper4_papers(owner_account_id,class_id,title,ends_at,status,published_at)
        VALUES($1,$2,'Rank paper',$3,'published',now()) RETURNING id`,[teacher.id,classId,endsAt])).rows[0].id;
      const versionId = (await pool.query(`INSERT INTO paper4_versions(paper_id,version_number,title,description,class_id,ends_at,definition,runner_cases,published_at)
        VALUES($1,1,'Rank paper','',$2,$3,$4::jsonb,$5::jsonb,now()) RETURNING id`,
      [paperId,classId,endsAt,JSON.stringify(definition),JSON.stringify(runnerCases)])).rows[0].id;
      await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[paperId,versionId]);
      return {paperId,versionId};
    }
    async function attempt(paperId,versionId,{submitted=false}={}) {
      const id = (await pool.query(`INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [paperId,versionId,student.identityId,student.id,submitted?'submitted':'active',submitted?new Date():null])).rows[0].id;
      for (const question of definition.questions)
        await pool.query('INSERT INTO paper4_attempt_files(attempt_id,question_key,content) VALUES($1,$2,$3)',
          [id,question.key,question.starterCode]);
      return id;
    }
    const request = (user,route,method='GET',body={}) => handlePaper4({pool,user,route,method,body,url:new URL(`http://localhost/api/v1${route}`)});
    const points = () => handleEducation({pool,user:student,route:'/points/me',method:'GET'});
    const leaderboard = (query='') => handleEducation({pool,user:student,route:'/points/leaderboard',method:'GET',
      url:new URL(`http://localhost/api/v1/points/leaderboard${query}`)});
    const profile = () => handleCommunity({pool,user:student,route:`/profiles/${student.identityId}`,method:'GET',
      url:new URL(`http://localhost/api/v1/profiles/${student.identityId}`)});
    const acQ1 = [{stageId:'Q1_auto',caseId:'public',public:true,status:'AC'},
      {stageId:'Q1_auto',caseId:'hidden',public:false,status:'AC'}];
    const acQ2 = [{stageId:'Q2_auto',caseId:'file',public:true,status:'AC'}];
    async function recordRun(taskId,verdicts,status='AC') {
      const leased = (await pool.query(`UPDATE paper4_run_tasks SET state='leased',lease_id=$2,
        lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *`,[taskId,randomUUID()])).rows[0];
      const result = {status,publicOutput:'',publicMessage:'',privateResults:verdicts,environmentVersion:'test'};
      assert.equal(await completePaper4Task(pool,leased,result),true);
      assert.equal(await completePaper4Task(pool,leased,result),false,'same worker completion is idempotent');
    }
    async function formalTasks(attemptId) {
      return (await pool.query(`SELECT s.id snapshot_id,s.question_key,s.origin,t.id task_id,s.source_code
        FROM paper4_snapshots s JOIN paper4_run_tasks t ON t.snapshot_id=s.id
        WHERE s.attempt_id=$1 AND s.origin='formal' ORDER BY s.question_key`,[attemptId])).rows;
    }
    const first = await paper(), firstAttempt = await attempt(first.paperId,first.versionId);
    await assert.rejects(request(outsider,`/paper4/attempts/${firstAttempt}/submit`,'POST'),error=>error.status===403);
    // A complete practice run, even if labelled AC, cannot earn school points.
    const practiceSnapshot=(await pool.query(`INSERT INTO paper4_snapshots(attempt_id,question_key,stage_key,source_code,revision)
      VALUES($1,'Q1',NULL,'print(1)',0) RETURNING id`,[firstAttempt])).rows[0].id;
    const practiceTask=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[practiceSnapshot])).rows[0].id;
    await recordRun(practiceTask,acQ1);
    assert.equal((await points()).body.rankPoints,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger')).rows[0].n,0);
    const submitted=(await request(student,`/paper4/attempts/${firstAttempt}/submit`,'POST')).body;
    assert.equal(submitted.status,'submitted');
    assert.deepEqual(submitted.formalJudging,{total:2,pending:2,completed:0,failed:0});
    await assert.rejects(request(student,`/paper4/attempts/${firstAttempt}/submit`,'POST'),error=>error.status===409);
    const firstTasks=await formalTasks(firstAttempt);
    assert.deepEqual(firstTasks.map(t=>t.question_key),['Q1','Q2']);
    assert.ok(firstTasks.every(t=>t.origin==='formal'));
    assert.equal((await points()).body.rankPoints,0,'queued result does not award');
    await recordRun(firstTasks[0].task_id,acQ1);
    // A claim of AC with missing hidden-case evidence is not an award.
    await recordRun(firstTasks[1].task_id,[]);
    assert.deepEqual((await request(student,`/paper4/attempts/${firstAttempt}`)).body.formalJudging,
      {total:2,pending:0,completed:2,failed:0});
    assert.deepEqual((await pool.query(`SELECT s.question_key,r.rank_ac_valid FROM paper4_runs r
      JOIN paper4_snapshots s ON s.id=r.snapshot_id WHERE s.attempt_id=$1 AND s.origin='formal' ORDER BY s.question_key`,
      [firstAttempt])).rows.map(r=>[r.question_key,r.rank_ac_valid]),[['Q1',true],['Q2',false]]);
    assert.equal((await leaderboard()).body.me.acRate,50,'an incomplete AC claim is assessed but not accepted');
    assert.equal((await points()).body.points,10);
    assert.equal((await points()).body.rankPoints,10);
    assert.equal((await leaderboard()).body.items.find(item=>item.id===student.identityId).points,10);
    assert.equal((await leaderboard()).body.items.find(item=>item.id===student.identityId).solvedProblems,1);
    assert.equal((await profile()).body.profile.points,10);
    assert.equal((await profile()).body.profile.rankPoints,10);
    assert.equal((await profile()).body.profile.solvedProblems,1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM point_ledger')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM school_rank_ledger')).rows[0].n,0);
    await assert.rejects(pool.query('UPDATE paper4_rank_ledger SET points=20 WHERE attempt_id=$1',[firstAttempt]),
      error=>/immutable/.test(error.message));
    // A published revision allows another attempt, but not a second Q1 award.
    const revised=(await pool.query(`INSERT INTO paper4_versions(paper_id,version_number,title,description,class_id,definition,runner_cases,published_at)
      VALUES($1,2,'Rank paper','',$2,$3::jsonb,$4::jsonb,now()) RETURNING id`,
      [first.paperId,classId,JSON.stringify(definition),JSON.stringify(runnerCases)])).rows[0].id;
    await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[first.paperId,revised]);
    const secondAttempt=await attempt(first.paperId,revised);
    await request(student,`/paper4/attempts/${secondAttempt}/submit`,'POST');
    const secondTasks=await formalTasks(secondAttempt);
    await Promise.all([recordRun(secondTasks[0].task_id,acQ1),recordRun(secondTasks[1].task_id,acQ2)]);
    assert.equal((await points()).body.rankPoints,20);
    assert.deepEqual((await pool.query('SELECT question_key,version_id FROM paper4_rank_ledger WHERE paper_id=$1 ORDER BY question_key',
      [first.paperId])).rows.map(r=>r.question_key),['Q1','Q2']);
    assert.equal((await request(student,`/paper4/attempts/${secondAttempt}`)).body.rankAwards.length,2);
    // A newly published paper with an expired window auto-freezes and queues
    // exactly once on the next authorized read; repeated reads cannot re-award.
    const expired=await paper({endsAt:new Date(Date.now()-1000)});
    const expiredAttempt=await attempt(expired.paperId,expired.versionId);
    assert.equal((await request(student,`/paper4/attempts/${expiredAttempt}`)).body.status,'submitted');
    assert.equal((await request(student,`/paper4/attempts/${expiredAttempt}`)).body.status,'submitted');
    const expiredTasks=await formalTasks(expiredAttempt);
    assert.equal(expiredTasks.length,2);
    await Promise.all([recordRun(expiredTasks[0].task_id,acQ1),recordRun(expiredTasks[1].task_id,acQ2)]);
    assert.equal((await points()).body.rankPoints,40);
    assert.equal((await leaderboard()).body.items.find(item=>item.id===student.identityId).solvedProblems,4);
    // Two submitted versions can finish the same question at once. The
    // immutable (student,paper,question) key awards exactly one of them.
    const racing=await paper(), racingAttemptA=await attempt(racing.paperId,racing.versionId);
    const racingVersionB=(await pool.query(`INSERT INTO paper4_versions(paper_id,version_number,title,description,class_id,definition,runner_cases,published_at)
      VALUES($1,2,'Rank paper','',$2,$3::jsonb,$4::jsonb,now()) RETURNING id`,
      [racing.paperId,classId,JSON.stringify(definition),JSON.stringify(runnerCases)])).rows[0].id;
    await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[racing.paperId,racingVersionB]);
    const racingAttemptB=await attempt(racing.paperId,racingVersionB);
    await Promise.all([request(student,`/paper4/attempts/${racingAttemptA}/submit`,'POST'),
      request(student,`/paper4/attempts/${racingAttemptB}/submit`,'POST')]);
    const racingTasksA=await formalTasks(racingAttemptA),racingTasksB=await formalTasks(racingAttemptB);
    await Promise.all([recordRun(racingTasksA[0].task_id,acQ1),recordRun(racingTasksB[0].task_id,acQ1)]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger WHERE paper_id=$1',[racing.paperId])).rows[0].n,1);
    // Even a trusted-worker shaped AC row cannot borrow another task's
    // formal snapshot or duplicate a public case to earn extra credit.
    const forgedLease=randomUUID();
    await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",
      [racingTasksA[1].task_id,forgedLease]);
    const borrowed=(await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,private_results,environment_version)
      VALUES($1,$2,$3,'AC',$4::jsonb,'test') RETURNING rank_ac_valid`,
      [racingTasksA[1].task_id,forgedLease,racingTasksB[1].snapshot_id,JSON.stringify(acQ2)])).rows[0];
    assert.equal(borrowed.rank_ac_valid,false);
    await recordRun(racingTasksB[1].task_id,[acQ2[0],acQ2[0]]);
    assert.equal((await pool.query(`SELECT rank_ac_valid FROM paper4_runs WHERE snapshot_id=$1`,
      [racingTasksB[1].snapshot_id])).rows[0].rank_ac_valid,false);
    assert.equal((await points()).body.rankPoints,50);
    assert.equal((await leaderboard()).body.items.find(item=>item.id===student.identityId).solvedProblems,5);
    // Period views use award time, not the original exam or attempt time.
    const previousMonth=(await pool.query("SELECT (date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai')-interval '8 days') AT TIME ZONE 'Asia/Shanghai' at")).rows[0].at;
    await pool.query('ALTER TABLE paper4_rank_ledger DISABLE TRIGGER paper4_rank_ledger_immutable');
    await pool.query('UPDATE paper4_rank_ledger SET created_at=$2 WHERE paper_id=$1',[racing.paperId,previousMonth]);
    await pool.query('ALTER TABLE paper4_rank_ledger ENABLE TRIGGER paper4_rank_ledger_immutable');
    assert.equal((await leaderboard('?period=all')).body.me.points,50);
    for(const period of ['week','month']){
      const item=(await leaderboard(`?period=${period}`)).body.me;
      assert.equal(item.points,40);
      assert.equal(item.solvedProblems,4);
    }
    const legacy=await paper(),legacyAttempt=await attempt(legacy.paperId,legacy.versionId,{submitted:true});
    const oldSnapshot=(await pool.query(`INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision)
      VALUES($1,'Q1','print(1)',0) RETURNING id`,[legacyAttempt])).rows[0].id;
    const oldTask=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[oldSnapshot])).rows[0].id;
    await recordRun(oldTask,acQ1);
    assert.equal((await points()).body.rankPoints,50,'historical practice runs never backfill rewards');
    const draftVersion=(await pool.query(`INSERT INTO paper4_versions(paper_id,version_number,title,description,class_id,definition,runner_cases)
      VALUES($1,2,'Unpublished','',$2,$3::jsonb,$4::jsonb) RETURNING id`,
      [legacy.paperId,classId,JSON.stringify(definition),JSON.stringify(runnerCases)])).rows[0].id;
    const draftAttempt=await attempt(legacy.paperId,draftVersion,{submitted:true});
    const draftSnapshot=(await pool.query(`INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin)
      VALUES($1,'Q1','print(1)',0,'formal') RETURNING id`,[draftAttempt])).rows[0].id;
    const draftTask=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[draftSnapshot])).rows[0].id;
    await recordRun(draftTask,acQ1);
    assert.equal((await points()).body.rankPoints,50,'a draft version cannot grant school points');
    // A normal reviewed OJ AC still follows its original two ledgers; the
    // public and personal totals combine both sources without fake problems.
    const bankId=(await pool.query("INSERT INTO problem_banks(name,owner_account_id,visibility) VALUES('Rank coexistence',$1,'school') RETURNING id",[teacher.id])).rows[0].id;
    const problemId=(await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[teacher.id,bankId])).rows[0].id;
    const problemVersion=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,
      reference_code,validation_status,published_at,school_visible_at,rank_review_status,rank_approved_at,rank_reviewed_at,rank_reviewed_by)
      VALUES($1,'Ordinary AC','stdio','Test',500,64,'print(1)','AC',now()-interval '1 minute',
      now()-interval '1 minute','approved',now()-interval '1 minute',now()-interval '1 minute',$2) RETURNING id`,
      [problemId,teacher.id])).rows[0].id;
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,problemVersion]);
    await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,
      request_hash,status,score) VALUES($1,$2,$3,$4,'submit','print(1)',$5,'ordinary-ac','AC',100)`,
      [student.id,student.identityId,problemId,problemVersion,randomUUID()]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM school_rank_ledger WHERE identity_id=$1',[student.identityId])).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM point_ledger WHERE identity_id=$1',[student.identityId])).rows[0].n,1);
    assert.equal((await points()).body.points,60);
    assert.equal((await points()).body.rankPoints,60);
    assert.equal((await leaderboard()).body.me.solvedProblems,6);
    assert.equal((await profile()).body.profile.points,60);
  } finally {
    await pool.end();
    await manager.query(`DROP SCHEMA ${schema} CASCADE`);
    await manager.end();
  }
});

test('Paper 4 rank migration preserves historical attempts and never retroactively awards old runs',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`paper4_rank_upgrade_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(url.href);
  try{
   await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
   await pool.query("INSERT INTO schema_migrations(name) VALUES('035_paper4_rank_points.sql'),('036_paper4_rank_verdict_consistency.sql')");
   await migrate(pool);
   const teacherIdentity=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('teacher',$1,'Teacher') RETURNING id",[randomUUID()])).rows[0].id;
   const studentIdentity=(await pool.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,'Student') RETURNING id",[randomUUID()])).rows[0].id;
   const teacher=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[teacherIdentity,randomUUID(),'hash'])).rows[0].id;
   const student=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[studentIdentity,randomUUID(),'hash'])).rows[0].id;
   const cls=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('Legacy Paper 4',$1) RETURNING id",[teacher])).rows[0].id;
   const paper=(await pool.query("INSERT INTO paper4_papers(owner_account_id,class_id,title,status,published_at) VALUES($1,$2,'Legacy','published',now()) RETURNING id",[teacher,cls])).rows[0].id;
   const definition={language:'python',totalMarks:75,questions:[{key:'Q1',title:'Queue',statement:'Queue',stages:[{id:'s1',title:'Run',maxMarks:75,judgeMode:'auto'}]}]};
   const version=(await pool.query(`INSERT INTO paper4_versions(paper_id,version_number,title,description,class_id,definition,runner_cases,published_at)
    VALUES($1,1,'Legacy','',$2,$3::jsonb,$4::jsonb,now()) RETURNING id`,[paper,cls,JSON.stringify(definition),JSON.stringify({s1:[{id:'case1'}]})])).rows[0].id;
   await pool.query('UPDATE paper4_papers SET current_version_id=$2 WHERE id=$1',[paper,version]);
   const attempt=(await pool.query(`INSERT INTO paper4_attempts(paper_id,version_id,identity_id,account_id,state,submitted_at)
    VALUES($1,$2,$3,$4,'submitted',now()) RETURNING id`,[paper,version,studentIdentity,student])).rows[0].id;
   const oldSnapshot=(await pool.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision) VALUES($1,'Q1','print(1)',0) RETURNING id",[attempt])).rows[0].id;
   const oldTask=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[oldSnapshot])).rows[0].id;
   await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,private_results,environment_version)
    VALUES($1,$2,$3,'AC',$4::jsonb,'legacy')`,[oldTask,randomUUID(),oldSnapshot,JSON.stringify([{stageId:'s1',caseId:'case1',status:'AC'}])]);
   await pool.query("DELETE FROM schema_migrations WHERE name IN ('035_paper4_rank_points.sql','036_paper4_rank_verdict_consistency.sql')");
   await migrate(pool);
   assert.equal((await pool.query('SELECT origin FROM paper4_snapshots WHERE id=$1',[oldSnapshot])).rows[0].origin,'practice');
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_runs WHERE id IS NOT NULL')).rows[0].n,1);
   const finalSnapshot=(await pool.query("INSERT INTO paper4_snapshots(attempt_id,question_key,source_code,revision,origin) VALUES($1,'Q1','print(1)',0,'formal') RETURNING id",[attempt])).rows[0].id;
   const finalTask=(await pool.query('INSERT INTO paper4_run_tasks(snapshot_id) VALUES($1) RETURNING id',[finalSnapshot])).rows[0].id;
    const leaseId=randomUUID();
    await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1",[finalTask,leaseId]);
   await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,private_results,environment_version)
    VALUES($1,$2,$3,'AC',$4::jsonb,'current')`,[finalTask,leaseId,finalSnapshot,JSON.stringify([{stageId:'s1',caseId:'case1',status:'AC'}])]);
   assert.equal((await pool.query('SELECT points FROM paper4_rank_ledger WHERE identity_id=$1 AND paper_id=$2',[studentIdentity,paper])).rows[0].points,10);
  }finally{
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
