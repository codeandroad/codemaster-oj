import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';

test('Paper 4 practice has isolated drafts, immutable stages, class authorization and teacher released marks',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`paper4_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(url.href);let server;
  try{
   await migrate(pool);
   const password=`test-${randomUUID()}-Paper4`;
   await bootstrap(pool,{name:'Admin',number:'P4-A',username:'paper4-admin',password});
   server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})));
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const base=`http://127.0.0.1:${server.address().port}/api/v1`;
   function client(){let cookie='',csrf='';return async(path,body,method=body===undefined?'GET':'POST',status=200)=>{
    const response=await fetch(base+path,{method,headers:{Origin:'http://paper4.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();
    assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(data.csrfToken)csrf=data.csrfToken;return data;
   };}
   const admin=client(),teacher=client(),otherTeacher=client(),student=client(),outsider=client();
   await admin('/auth/login',{username:'paper4-admin',password});
   const identities={};
   for(const [kind,api,tag] of [['teacher',teacher,'teacher'],['teacher',otherTeacher,'otherteacher'],['student',student,'student'],['student',outsider,'outsider']]){
    const number=`P4-${tag}`;
    const created=await admin('/people',{kind,number,name:number},'POST',201);
    identities[tag]=created.person;
    await api('/auth/register',{kind,number,name:number,activationCode:created.activationCode,username:number.toLowerCase(),password},'POST',201);
   }
   const cls=await admin('/classes',{name:'Paper4 practice',teacherIds:[identities.teacher.id],studentIds:[identities.student.id]},'POST',201);
   const questions=[
    {key:'Q1',title:'Circular structure',statement:'Implement a circular structure.',starterCode:'# Q1\n',stages:[{id:'Q1a',title:'Initialize',maxMarks:20}]},
    {key:'Q2',title:'Text files',statement:'Read an input file.',starterCode:'# Q2\n',initialFiles:{'TheData.txt':'2,Blue\n'},outputFiles:['Blue.txt'],stages:[{id:'Q2a',title:'Read and write',maxMarks:25}]},
    {key:'Q3',title:'Binary tree',statement:'Build a tree.',starterCode:'# Q3\n',stages:[{id:'Q3a',title:'Tree',maxMarks:30}]},
   ];
   const runnerCases={Q2:[{id:'public1',stdin:'',expectedStdout:'',expectedFiles:{'Blue.txt':'2\n'},public:true}]};
   await otherTeacher('/paper4/papers',{title:'Forbidden',classId:cls.id,questions},'POST',403);
   await teacher('/paper4/papers',{title:'Missing class',questions},'POST',403);
   const paper=await teacher('/paper4/papers',{title:'Paper 4 practice',classId:cls.id,questions,runnerCases},'POST',201);
   assert.equal(paper.totalMarks,75);
   await student(`/paper4/papers/${paper.id}`,undefined,'GET',404);
   await outsider(`/paper4/papers/${paper.id}`,undefined,'GET',404);
   await teacher(`/paper4/papers/${paper.id}`,{description:'Draft updated'},'PATCH');
   await teacher(`/paper4/papers/${paper.id}/publish`,{});
   await teacher(`/paper4/papers/${paper.id}`,{description:'Cannot rewrite published version'},'PATCH',409);
   const published=await student(`/paper4/papers/${paper.id}`);
   assert.equal(published.runnerCases,undefined);
   assert.deepEqual(published.questions[1].outputFiles,['Blue.txt']);
   await outsider(`/paper4/papers/${paper.id}`,undefined,'GET',403);
   await outsider(`/paper4/papers/${paper.id}/attempt`,{},'POST',403);
   const attempt=await student(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);
   assert.equal(attempt.files.length,3);
   assert.equal((await student(`/paper4/papers/${paper.id}/attempt`,{},'POST')).id,attempt.id);
   assert.equal((await student(`/paper4/papers/${paper.id}/attempt`)).id,attempt.id);
   await outsider(`/paper4/attempts/${attempt.id}`,undefined,'GET',403);
   await otherTeacher(`/paper4/attempts/${attempt.id}`,undefined,'GET',403);
   const saved=await student(`/paper4/attempts/${attempt.id}/files/Q2`,{content:"open('Blue.txt','w').write('2\\n')",revision:0},'PATCH');
   assert.equal(saved.revision,1);
   await student(`/paper4/attempts/${attempt.id}/files/Q2`,{content:'stale',revision:0},'PATCH',409);
   const checkpoint=await student(`/paper4/attempts/${attempt.id}/checkpoints`,{stageId:'Q2a'},'POST',201);
   assert.equal(checkpoint.revision,1);
   assert.equal(checkpoint.sourceCode,saved.content);
   await student(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q1'},'POST',201);
   const run=await student(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q2'},'POST',201);
   assert.equal((await student(`/paper4/runs/${run.id}`)).state,'queued');
   await outsider(`/paper4/runs/${run.id}`,undefined,'GET',403);
   const snapshotId=(await pool.query('SELECT snapshot_id FROM paper4_run_tasks WHERE id=$1',[run.id])).rows[0].snapshot_id;
   await pool.query("UPDATE paper4_run_tasks SET state='completed' WHERE id=$1",[run.id]);
   await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,public_output,public_message,private_results,environment_version)
    VALUES($1,$2,$3,'Executed','3','Run complete',$4::jsonb,'test')`,[run.id,randomUUID(),snapshotId,JSON.stringify([
    {caseId:'public1',public:true,status:'Executed',stdout:'3',stderr:'',generatedFiles:{'Blue.txt':'2\n'},checks:[{kind:'file',name:'Blue.txt',passed:true}]},
    {caseId:'hidden1',public:false,status:'NeedsReview',secretExpected:'never expose this secret',checks:[{kind:'stdout',passed:false}]},
   ])]);
   const displayed=await student(`/paper4/runs/${run.id}`);
   assert.equal(displayed.result.publicResults[0].generatedFiles['Blue.txt'],'2\n');
   assert.equal(displayed.result.publicResults.length,1);
   assert.equal(JSON.stringify(displayed).includes('never expose this secret'),false);
   await teacher(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q2a',marks:25},'PATCH',409);
   await student(`/paper4/attempts/${attempt.id}/submit`,{});
   await student(`/paper4/attempts/${attempt.id}/files/Q2`,{content:'late',revision:1},'PATCH',409);
   await student(`/paper4/attempts/${attempt.id}/submit`,{},'POST',409);
   await teacher(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q2a',marks:26},'PATCH',400);
   await teacher(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q1a',marks:15},'PATCH');
   await teacher(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q2a',marks:25},'PATCH');
   await teacher(`/paper4/attempts/${attempt.id}/release`,{},'POST',409);
   const before=await student(`/paper4/attempts/${attempt.id}`);
   assert.equal(before.score,null);assert.deepEqual(before.marks,[]);
   await teacher(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q3a',marks:20},'PATCH');
   const released=await teacher(`/paper4/attempts/${attempt.id}/release`,{});
   assert.equal(released.score,60);
   assert.equal((await student(`/paper4/attempts/${attempt.id}`)).score,60);
   await teacher(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q3a',marks:30},'PATCH',409);
   assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM judge_tasks')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_run_tasks')).rows[0].n,2);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_snapshots WHERE attempt_id=$1 AND stage_key=$2',[attempt.id,'Q2a'])).rows[0].n,1);

   const scheduled=await teacher('/paper4/papers',{title:'Scheduled mock',classId:cls.id,
    startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),questions},'POST',201);
   await teacher(`/paper4/papers/${scheduled.id}/publish`,{});
   const listing=await student('/paper4/papers');
   const summary=listing.items.find(item=>item.id===scheduled.id);
   assert.equal(summary.questionCount,3);
   assert.equal(JSON.stringify(summary).includes('Implement a circular structure'),false);
   await student(`/paper4/papers/${scheduled.id}`,undefined,'GET',409);
   await student(`/paper4/papers/${scheduled.id}/attempt`,{},'POST',409);

   const timedPaper=await teacher('/paper4/papers',{title:'Deadline freeze',classId:cls.id,
    endsAt:new Date(Date.now()+3600000).toISOString(),questions},'POST',201);
   await teacher(`/paper4/papers/${timedPaper.id}/publish`,{});
   const expiring=await student(`/paper4/papers/${timedPaper.id}/attempt`,{},'POST',201);
   await student(`/paper4/attempts/${expiring.id}/files/Q1`,{content:'print(7)',revision:0},'PATCH');
   await pool.query("UPDATE paper4_papers SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[timedPaper.id]);
   const [firstRead,secondRead]=await Promise.all([
    student(`/paper4/attempts/${expiring.id}`),student(`/paper4/attempts/${expiring.id}`),
   ]);
   assert.equal(firstRead.status,'submitted');assert.equal(secondRead.status,'submitted');
   assert.equal(firstRead.snapshots.filter(s=>s.fileKey==='Q1'&&s.stageId===null).length,1);
   assert.equal(firstRead.snapshots.find(s=>s.fileKey==='Q1').sourceCode,'print(7)');
   assert.equal((await teacher(`/paper4/attempts?paperId=${timedPaper.id}`)).items[0].status,'submitted');
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_snapshots WHERE attempt_id=$1',[expiring.id])).rows[0].n,3);
   await student(`/paper4/attempts/${expiring.id}/files/Q1`,{content:'after deadline',revision:1},'PATCH',409);
   await pool.query('DELETE FROM teacher_classes WHERE class_id=$1',[cls.id]);
   await teacher(`/paper4/papers/${paper.id}`,undefined,'GET',403);
   await teacher(`/paper4/attempts/${attempt.id}`,undefined,'GET',403);
   await teacher(`/paper4/runs/${run.id}`,undefined,'GET',403);
   assert.equal((await admin(`/paper4/attempts/${attempt.id}`)).score,60);
  }finally{
   if(server)await new Promise(resolve=>server.close(resolve));
   await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
  }
 });
