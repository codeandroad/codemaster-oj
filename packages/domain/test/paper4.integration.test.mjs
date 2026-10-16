import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';
import { parsePaper4Import } from '../src/paper4-import.mjs';

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
    {key:'Q1',title:'Circular structure',statement:'Implement a circular structure.',starterCode:'# Q1\n',stages:[{id:'Q1a',title:'Initialize',maxMarks:20,judgeMode:'auto'}]},
    {key:'Q2',title:'Text files',statement:'Read an input file.',starterCode:'# Q2\n',initialFiles:{'TheData.txt':'2,Blue\n'},outputFiles:['Blue.txt'],stages:[{id:'Q2a',title:'Read and write',maxMarks:25,judgeMode:'auto'}]},
    {key:'Q3',title:'Binary tree',statement:'Build a tree.',starterCode:'# Q3\n',stages:[{id:'Q3a',title:'Tree',maxMarks:30,judgeMode:'auto'}]},
   ];
   const runnerCases={Q1a:[{id:'one',expectedStdout:'1\n',public:true,driverCode:'print("private-driver")'},
     {id:'hidden',expectedStdout:'1\n',public:false,driverCode:'print("hidden-driver")'}],
    Q2a:[{id:'public1',stdin:'',expectedStdout:'',expectedFiles:{'Blue.txt':'2\n'},public:true}],
    Q3a:[{id:'tree',expectedStdout:'2\n',public:false}]};
   const referenceSolutions={Q1:'print(1)',Q2:"open('Blue.txt','w').write('2\\n')",Q3:'print(2)'};
   async function validateReferences(paperId){
    for(const question of questions){
     const queued=await teacher(`/paper4/papers/${paperId}/reference-runs`,{questionKey:question.key},'POST',201);
     for(const task of queued.items){
      const snapshotId=(await pool.query('SELECT reference_snapshot_id FROM paper4_run_tasks WHERE id=$1',[task.id])).rows[0].reference_snapshot_id;
      assert.ok(snapshotId);
      await pool.query("UPDATE paper4_run_tasks SET state='completed' WHERE id=$1",[task.id]);
      const cases=runnerCases[task.stageId];
      await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,reference_snapshot_id,status,public_output,public_message,private_results,environment_version)
       VALUES($1,$2,$3,'AC','','Validated',$4::jsonb,'test')`,
      [task.id,randomUUID(),snapshotId,JSON.stringify(cases.map(c=>({stageId:task.stageId,caseId:c.id,public:c.public===true,status:'AC',checks:[{kind:'stdout',passed:true}]})))]);
     }
    }
   }
   await otherTeacher('/paper4/papers',{title:'Forbidden',classId:cls.id,questions},'POST',403);
   const packageBytes=await readFile(new URL('../../../examples/paper4-english-practice/paper4-english-practice.json',import.meta.url));
   const importRequest={filename:'paper4-english-practice.json',contentBase64:packageBytes.toString('base64')};
   await student('/paper4/imports/preview',importRequest,'POST',403);
   const beforePreview=(await pool.query('SELECT count(*)::int n FROM paper4_papers')).rows[0].n;
   const preview=await teacher('/paper4/imports/preview',importRequest);
   assert.equal(preview.preview.questionCount,3);
   assert.equal(preview.createBody.classId,null);
   assert.equal(preview.createBody.referenceSolutions.Q3.length>0,true);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_papers')).rows[0].n,beforePreview);
   const unassigned=await teacher('/paper4/papers',{title:'Unassigned draft',questions,runnerCases,referenceSolutions},'POST',201);
   await teacher(`/paper4/papers/${unassigned.id}/publish`,{},'POST',409);
   const manualOnly=await teacher('/paper4/papers',{title:'Manual-only draft',classId:cls.id,
    questions:[{key:'Q1',title:'Unverified question',statement:'Teacher review only',stages:[
     {id:'Q1a',title:'Review',maxMarks:75,judgeMode:'manual'}]}]},'POST',201);
   await teacher(`/paper4/papers/${manualOnly.id}/publish`,{},'POST',409);
   const paper=await teacher('/paper4/papers',{title:'Paper 4 practice',classId:cls.id,questions,runnerCases,referenceSolutions},'POST',201);
   assert.equal(paper.totalMarks,75);
   await student(`/paper4/papers/${paper.id}`,undefined,'GET',404);
   await outsider(`/paper4/papers/${paper.id}`,undefined,'GET',404);
   await teacher(`/paper4/papers/${paper.id}`,{description:'Draft updated'},'PATCH');
   await teacher(`/paper4/papers/${paper.id}/publish`,{},'POST',409);
   await validateReferences(paper.id);
   assert.equal((await teacher(`/paper4/papers/${paper.id}?view=draft`)).referenceValidation.Q1a.status,'AC');
   await pool.query(`UPDATE paper4_runs SET private_results='[]'::jsonb WHERE task_id=(
    SELECT t.id FROM paper4_run_tasks t JOIN paper4_reference_snapshots rs ON rs.id=t.reference_snapshot_id
    WHERE rs.version_id=$1 AND rs.stage_key='Q1a' ORDER BY rs.created_at DESC LIMIT 1)`,[paper.versionId]);
   assert.equal((await teacher(`/paper4/papers/${paper.id}?view=draft`)).referenceValidation.Q1a.status,'error');
   await teacher(`/paper4/papers/${paper.id}/publish`,{},'POST',409);
   await validateReferences(paper.id);
   await teacher(`/paper4/papers/${paper.id}/publish`,{});
   await teacher(`/paper4/papers/${paper.id}`,{description:'Cannot rewrite published version'},'PATCH',409);
   const published=await student(`/paper4/papers/${paper.id}`);
   assert.equal(published.runnerCases,undefined);
   assert.equal(published.referenceSolutions,undefined);
   assert.equal(JSON.stringify(published).includes('private-driver'),false);
   assert.deepEqual(published.questions[1].outputFiles,['Blue.txt']);
   await outsider(`/paper4/papers/${paper.id}`,undefined,'GET',403);
   await outsider(`/paper4/papers/${paper.id}/attempt`,{},'POST',403);
   const attempt=await student(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);
   assert.equal(attempt.files.length,3);
   assert.equal(JSON.stringify(attempt).includes('private-driver'),false);
   assert.equal(JSON.stringify(attempt).includes('referenceSolutions'),false);
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
   const leaking=await student(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q1'},'POST',201);
   const run=await student(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q2'},'POST',201);
   assert.equal((await student(`/paper4/runs/${run.id}`)).state,'queued');
   await outsider(`/paper4/runs/${run.id}`,undefined,'GET',403);
   const snapshotId=(await pool.query('SELECT snapshot_id FROM paper4_run_tasks WHERE id=$1',[run.id])).rows[0].snapshot_id;
   await pool.query("UPDATE paper4_run_tasks SET state='completed' WHERE id=$1",[run.id]);
   await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,public_output,public_message,private_results,environment_version)
    VALUES($1,$2,$3,'Executed','3','Run complete',$4::jsonb,'test')`,[run.id,randomUUID(),snapshotId,JSON.stringify([
    {stageId:'Q2a',caseId:'public1',public:true,status:'AC',stdout:'3',stderr:'',generatedFiles:{'Blue.txt':'2\n'},checks:[{kind:'file',name:'Blue.txt',passed:true}]},
    {stageId:'Q2a',caseId:'hidden1',public:false,status:'WA',secretExpected:'never expose this secret',checks:[{kind:'stdout',passed:false}]},
   ])]);
   const displayed=await student(`/paper4/runs/${run.id}`);
   assert.equal(displayed.result.publicResults[0].generatedFiles['Blue.txt'],'2\n');
   assert.equal(displayed.result.publicResults.length,1);
   assert.equal(displayed.result.publicResults[0].stdout,'3');
   assert.equal(displayed.result.publicOutput,'3');
   assert.equal(displayed.result.questionStatus,'NotPassed');
   assert.equal(JSON.stringify(displayed).includes('never expose this secret'),false);
   assert.equal(JSON.stringify(displayed).includes('private-driver'),false);
   const leakingSnapshot=(await pool.query('SELECT snapshot_id FROM paper4_run_tasks WHERE id=$1',[leaking.id])).rows[0].snapshot_id;
   await pool.query("UPDATE paper4_run_tasks SET state='completed' WHERE id=$1",[leaking.id]);
   await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,public_output,public_message,private_results,environment_version)
    VALUES($1,$2,$3,'RE',$4,$4,$5::jsonb,'test')`,[leaking.id,randomUUID(),leakingSnapshot,
    'Traceback /w/driver.py: print(sum(results))',JSON.stringify([
     {stageId:'Q1a',caseId:'one',public:true,status:'RE',stdout:'teacher driver secret',
      stderr:'Traceback /w/driver.py: print(sum(results))',generatedFiles:{'Blue.txt':'secret file'},checks:[]},
     {stageId:'Q1a',caseId:'hidden',public:false,status:'WA',secretExpected:'hidden answer',checks:[]},
    ])]);
   const safe=await student(`/paper4/runs/${leaking.id}`);
   assert.equal(safe.result.status,'NotPassed');
   assert.equal(safe.result.questionStatus,'NotPassed');
   assert.deepEqual(safe.result.stageResults,[{stageId:'Q1a',status:'NotPassed'}]);
   assert.equal(safe.result.publicResults[0].status,'NotPassed');
   assert.equal(safe.result.publicResults[0].stdout,'');
   assert.equal(safe.result.publicResults[0].stderr,'');
   assert.deepEqual(safe.result.publicResults[0].generatedFiles,{});
   assert.equal(safe.result.publicOutput,'');
   assert.equal(JSON.stringify(safe).includes('/w/driver.py'),false);
   assert.equal(JSON.stringify(safe).includes('print(sum(results))'),false);
   assert.equal(JSON.stringify(safe).includes('teacher driver secret'),false);
   assert.equal(JSON.stringify(safe).includes('hidden answer'),false);
   assert.equal(safe.result.reviewResults,undefined);
   const teacherDiagnostics=await teacher(`/paper4/runs/${leaking.id}`);
   assert.equal(teacherDiagnostics.result.publicResults[0].stderr.includes('/w/driver.py'),true);
   assert.equal(teacherDiagnostics.result.reviewResults.length,2);
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
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_run_tasks WHERE snapshot_id IS NOT NULL')).rows[0].n,5,
    'two practice runs and one frozen formal run for each of three questions');
   assert.equal((await pool.query("SELECT count(*)::int n FROM paper4_snapshots WHERE attempt_id=$1 AND origin='formal'",[attempt.id])).rows[0].n,3);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger')).rows[0].n,0,
    'manual marks and release do not award unjudged formal code');
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_snapshots WHERE attempt_id=$1 AND stage_key=$2',[attempt.id,'Q2a'])).rows[0].n,1);

   // Revisions are prepared privately; both the reference validation and
   // each student attempt stay pinned to one immutable published version.
   const originalVersion=paper.versionId;
   const draft=await teacher(`/paper4/papers/${paper.id}/draft`,{},'POST',201);
   assert.equal(draft.versionNumber,2);
   assert.equal(draft.status,'draft');
   assert.equal(draft.referenceSolutions.Q1,referenceSolutions.Q1);
   assert.equal((await teacher(`/paper4/papers/${paper.id}`)).versionId,originalVersion);
   assert.equal((await student(`/paper4/papers/${paper.id}`)).versionId,originalVersion);
   await validateReferences(paper.id);
   assert.equal((await teacher(`/paper4/papers/${paper.id}?view=draft`)).referenceValidation.Q1a.status,'AC');
   const changed=await teacher(`/paper4/papers/${paper.id}`,{description:'Revised practice'},'PATCH');
   assert.equal(changed.referenceValidation.Q1a.status,'unverified');
   assert.equal((await student(`/paper4/papers/${paper.id}`)).description,'Draft updated');
   const draftExport=await teacher(`/paper4/papers/${paper.id}/export?view=draft`);
   const draftPackage=parsePaper4Import(draftExport).createBody;
   assert.equal(draftPackage.description,'Revised practice');
   assert.equal(draftPackage.classId,null);
   assert.deepEqual(draftPackage.questions,changed.questions);
   assert.deepEqual(draftPackage.referenceSolutions,referenceSolutions);
   const currentExport=await teacher(`/paper4/papers/${paper.id}/export`);
   assert.equal(parsePaper4Import(currentExport).createBody.description,'Draft updated');
   await teacher(`/paper4/papers/${paper.id}/publish`,{},'POST',409);
   await validateReferences(paper.id);
   const revised=await teacher(`/paper4/papers/${paper.id}/publish`,{});
   assert.equal(revised.versionNumber,2);
   assert.notEqual(revised.versionId,originalVersion);
   assert.equal((await student(`/paper4/papers/${paper.id}`)).description,'Revised practice');
   const newAttempt=await student(`/paper4/papers/${paper.id}/attempt`,{},'POST',201);
   assert.notEqual(newAttempt.id,attempt.id);
   assert.equal(newAttempt.versionId,revised.versionId);
   assert.equal(newAttempt.paper.versionNumber,2);
   assert.equal((await student(`/paper4/papers/${paper.id}/attempt`)).id,newAttempt.id);
   const pinned=await student(`/paper4/attempts/${attempt.id}`);
   assert.equal(pinned.versionId,originalVersion);
   assert.equal(pinned.paper.versionNumber,1);
   assert.equal(pinned.score,60);
   const versionRows=(await pool.query('SELECT id,published_at FROM paper4_versions WHERE paper_id=$1 ORDER BY version_number',[paper.id])).rows;
   assert.deepEqual(versionRows.map(v=>v.id),[originalVersion,revised.versionId]);
   assert.ok(versionRows.every(v=>v.published_at));
   const attemptRows=await teacher(`/paper4/attempts?paperId=${paper.id}`);
   assert.deepEqual(new Set(attemptRows.items.map(a=>a.versionNumber)),new Set([1,2]));
   const exported=await teacher(`/paper4/papers/${paper.id}/export`);
   assert.equal(exported.contentType,'application/json');
   assert.match(exported.filename,/^paper4-[a-f0-9-]+-v2\.json$/);
   const reimport=parsePaper4Import(exported);
   assert.equal(reimport.preview.totalMarks,75);
   assert.deepEqual(reimport.createBody.questions,revised.questions);
   assert.deepEqual(reimport.createBody.runnerCases,revised.runnerCases);
   assert.deepEqual(reimport.createBody.referenceSolutions,referenceSolutions);
   assert.equal(reimport.createBody.classId,null);
   assert.equal(reimport.createBody.startsAt,null);
   assert.equal(reimport.createBody.endsAt,null);
   await student(`/paper4/papers/${paper.id}/export`,undefined,'GET',403);
   await otherTeacher(`/paper4/papers/${paper.id}/export`,undefined,'GET',403);
   assert.equal((await admin(`/paper4/papers/${paper.id}`)).canExport,false);
   assert.equal((await admin('/paper4/papers')).items.find(item=>item.id===paper.id).canExport,false);
   await admin(`/paper4/papers/${paper.id}/export`,undefined,'GET',403);
   await otherTeacher(`/paper4/papers/${paper.id}/archive`,{},'POST',403);
   await student(`/paper4/papers/${paper.id}/archive`,{},'POST',403);
   const beforeArchiveSnapshots=(await pool.query('SELECT count(*)::int n FROM paper4_snapshots WHERE attempt_id=$1',[newAttempt.id])).rows[0].n;
   const archived=await teacher(`/paper4/papers/${paper.id}/archive`,{});
   assert.ok(archived.archivedAt);
   assert.equal(archived.canExport,true);
   assert.equal((await teacher(`/paper4/papers/${paper.id}/archive`,{})).archivedAt,archived.archivedAt);
   assert.equal((await teacher('/paper4/papers')).items.find(item=>item.id===paper.id).archivedAt,archived.archivedAt);
   assert.equal((await student('/paper4/papers')).items.some(item=>item.id===paper.id),false);
   await student(`/paper4/papers/${paper.id}`,undefined,'GET',404);
   await student(`/paper4/papers/${paper.id}/attempt`,undefined,'GET',404);
   await student(`/paper4/papers/${paper.id}/attempt`,{},'POST',404);
   await teacher(`/paper4/papers/${paper.id}`,{description:'Archived edit'},'PATCH',409);
   await teacher(`/paper4/papers/${paper.id}/draft`,{},'POST',409);
   await teacher(`/paper4/papers/${paper.id}/reference-runs`,{questionKey:'Q1'},'POST',409);
   await teacher(`/paper4/papers/${paper.id}/publish`,{},'POST',409);
   assert.equal((await teacher(`/paper4/papers/${paper.id}`)).archivedAt,archived.archivedAt);
   assert.equal((await teacher(`/paper4/papers/${paper.id}/export`)).filename,exported.filename);
   assert.equal((await student(`/paper4/attempts/${attempt.id}`)).score,60);
   const frozen=await student(`/paper4/attempts/${newAttempt.id}`);
   assert.equal(frozen.status,'active');
   assert.equal(frozen.canEdit,false);
   await student(`/paper4/attempts/${newAttempt.id}/files/Q1`,{content:'print(8)',revision:0},'PATCH',409);
   await student(`/paper4/attempts/${newAttempt.id}/runs`,{fileKey:'Q1'},'POST',409);
   await student(`/paper4/attempts/${newAttempt.id}/submit`,{},'POST',409);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_snapshots WHERE attempt_id=$1',[newAttempt.id])).rows[0].n,beforeArchiveSnapshots);
   const restored=await teacher(`/paper4/papers/${paper.id}/restore`,{});
   assert.equal(restored.archivedAt,null);
   assert.equal((await teacher(`/paper4/papers/${paper.id}/restore`,{})).archivedAt,null);
   assert.equal((await student('/paper4/papers')).items.some(item=>item.id===paper.id),true);
   assert.equal((await student(`/paper4/papers/${paper.id}`)).versionId,revised.versionId);
   assert.equal((await student(`/paper4/attempts/${newAttempt.id}`)).canEdit,true);
   await student(`/paper4/attempts/${newAttempt.id}/files/Q1`,{content:'print(8)',revision:0},'PATCH');
   assert.ok((await admin(`/paper4/papers/${paper.id}/archive`,{})).archivedAt);
   assert.equal((await admin(`/paper4/papers/${paper.id}/restore`,{})).archivedAt,null);
   assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM point_ledger')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM school_rank_ledger')).rows[0].n,0);

   // A manual code review or historical screenshot stage still contributes to
   // the 75-point teacher rubric, while AC depends on final-program tests.
   const mixedQuestions=structuredClone(questions);
   mixedQuestions[0].stages=[{...mixedQuestions[0].stages[0],maxMarks:10},
    {id:'Q1b',title:'Inspect implementation',maxMarks:10,judgeMode:'manual'}];
   mixedQuestions[1].stages=[{...mixedQuestions[1].stages[0],maxMarks:20},
    {id:'Q2b',title:'Record observed output',maxMarks:5,judgeMode:'evidence'}];
   const mixed=await teacher('/paper4/papers',{title:'Mixed rubric',classId:cls.id,
    questions:mixedQuestions,runnerCases,referenceSolutions},'POST',201);
   await validateReferences(mixed.id);
   await teacher(`/paper4/papers/${mixed.id}/publish`,{});
   const mixedAttempt=await student(`/paper4/papers/${mixed.id}/attempt`,{},'POST',201);
   for(const [questionKey,stageId] of [['Q1','Q1a'],['Q2','Q2a']]){
    const queued=await student(`/paper4/attempts/${mixedAttempt.id}/runs`,{fileKey:questionKey},'POST',201);
    const source=(await pool.query('SELECT snapshot_id FROM paper4_run_tasks WHERE id=$1',[queued.id])).rows[0].snapshot_id;
    await pool.query("UPDATE paper4_run_tasks SET state='completed' WHERE id=$1",[queued.id]);
    await pool.query(`INSERT INTO paper4_runs(task_id,lease_id,snapshot_id,status,public_output,public_message,private_results,environment_version)
     VALUES($1,$2,$3,'AC','','All required tests passed',$4::jsonb,'test')`,
    [queued.id,randomUUID(),source,JSON.stringify(runnerCases[stageId].map(c=>({stageId,caseId:c.id,public:c.public===true,status:'AC',checks:[]})))]);
    const outcome=await student(`/paper4/runs/${queued.id}`);
    assert.equal(outcome.result.questionStatus,'AC');
    assert.deepEqual(outcome.result.stageResults,[{stageId,status:'AC'}]);
    assert.deepEqual(outcome.result.pendingManualStageIds,questionKey==='Q1'?['Q1b']:[]);
    assert.deepEqual(outcome.result.evidenceStageIds,questionKey==='Q2'?['Q2b']:[]);
   }

   const scheduled=await teacher('/paper4/papers',{title:'Scheduled mock',classId:cls.id,
    startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString(),questions,runnerCases,referenceSolutions},'POST',201);
   await validateReferences(scheduled.id);
   await teacher(`/paper4/papers/${scheduled.id}/publish`,{});
   const listing=await student('/paper4/papers');
   const summary=listing.items.find(item=>item.id===scheduled.id);
   assert.equal(summary.questionCount,3);
   assert.equal(JSON.stringify(summary).includes('Implement a circular structure'),false);
   await student(`/paper4/papers/${scheduled.id}`,undefined,'GET',409);
   await student(`/paper4/papers/${scheduled.id}/attempt`,{},'POST',409);

   const timedPaper=await teacher('/paper4/papers',{title:'Deadline freeze',classId:cls.id,
    endsAt:new Date(Date.now()+3600000).toISOString(),questions,runnerCases,referenceSolutions},'POST',201);
   await validateReferences(timedPaper.id);
   await teacher(`/paper4/papers/${timedPaper.id}/publish`,{});
   const expiring=await student(`/paper4/papers/${timedPaper.id}/attempt`,{},'POST',201);
   await student(`/paper4/attempts/${expiring.id}/files/Q1`,{content:'print(7)',revision:0},'PATCH');
   await pool.query('ALTER TABLE paper4_versions DISABLE TRIGGER paper4_version_immutable');
   await pool.query("UPDATE paper4_versions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expiring.versionId]);
   await pool.query('ALTER TABLE paper4_versions ENABLE TRIGGER paper4_version_immutable');
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
