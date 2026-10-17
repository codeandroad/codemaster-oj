import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {bootstrap} from '../src/bootstrap.mjs';
import {createApp,loadConfig} from '../src/app.mjs';

const upgrade='042_course_paper4_links.sql';
import {completePaper4Task} from '../paper4-worker.mjs';
const options={skip:!process.env.TEST_DATABASE_URL,timeout:60000};

async function fixture(run,{beforeUpgrade=false}={}){
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`course_paper4_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(connection.href);let server;
 try{
  if(beforeUpgrade){await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[upgrade]);}
  await migrate(pool);const password=`fixture-${randomUUID()}`;
  await bootstrap(pool,{name:'Administrator',number:'P4-AUDIENCE-ADMIN',username:'p4-audience-admin',password});
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  function client(){let cookie='',csrf='',user;const send=async(path,body,method=body===undefined?'GET':'POST',status=200,token)=>{
   const response=await fetch(base+path,{method,headers:{Origin:'http://paper4.test',...(cookie?{Cookie:cookie,'X-CSRF-Token':token??csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;if(data.user)user=data.user;return data;
  };return{send,get user(){return user;}};}
  const admin=client();await admin.send('/auth/login',{username:'p4-audience-admin',password});
  const actors={admin};
  for(const [tag,kind] of [['teacher','teacher'],['otherTeacher','teacher'],['classmate','student'],['cross','student'],['unassigned','student'],['excluded','student']]){
   const api=client(),person=await admin.send('/people',{kind,number:`P4-${tag}`,name:tag},'POST',201);
   await api.send('/auth/register',{kind,number:person.person.number,name:tag,activationCode:person.activationCode,username:`p4-${tag.toLowerCase()}`,password},'POST',201);actors[tag]=api;
  }
  const classA=await admin.send('/classes',{name:'Class A',teacherIds:[actors.teacher.user.identityId],studentIds:[actors.classmate.user.identityId]},'POST',201);
  const classB=await admin.send('/classes',{name:'Class B',teacherIds:[actors.otherTeacher.user.identityId],studentIds:[actors.cross.user.identityId]},'POST',201);
  
  const questions=['Q1','Q2'].map((key,index)=>({key,title:`Question ${index+1}`,statement:`English ${key} statement`,starterCode:`# ${key} starter`,initialFiles:{},outputFiles:[],stages:[{id:`${key}a`,title:`${key} operations`,maxMarks:index===0?35:40,judgeMode:'auto'}]}));
  const runnerCases=Object.fromEntries(questions.map(q=>[q.stages[0].id,[{id:'public',public:true,expectedStdout:'1\n'},{id:'hidden',public:false,expectedStdout:'2\n',driverCode:'private driver'}]]));
  const referenceSolutions={Q1:'reference Q1',Q2:'reference Q2'};
  async function finish(taskId,{status='AC',incomplete=false}={}){
   const task=(await pool.query("UPDATE paper4_run_tasks SET state='leased',lease_id=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1 RETURNING *",[taskId,randomUUID()])).rows[0];
   let stageId;if(task.reference_snapshot_id)stageId=(await pool.query('SELECT stage_key FROM paper4_reference_snapshots WHERE id=$1',[task.reference_snapshot_id])).rows[0].stage_key;
   else stageId=(await pool.query('SELECT question_key FROM paper4_snapshots WHERE id=$1',[task.snapshot_id])).rows[0].question_key+'a';
   let privateResults=runnerCases[stageId].map(c=>({stageId,caseId:c.id,public:c.public,status,checks:[]}));if(incomplete)privateResults=privateResults.slice(0,1);
   assert.equal(await completePaper4Task(pool,task,{status,publicOutput:'',publicMessage:'',privateResults,environmentVersion:'fixture'}),true);
  }
  async function validate(paperId){for(const question of questions){const queued=await actors.teacher.send(`/paper4/papers/${paperId}/reference-runs`,{questionKey:question.key},'POST',201);for(const task of queued.items)await finish(task.id);}}
  async function paper({publish=true,title='Course paper',overrides={}}={}){
   const created=await actors.teacher.send('/paper4/papers',{title,questions,runnerCases,referenceSolutions,...overrides},'POST',201);
   if(!publish)return created;await validate(created.id);return actors.teacher.send(`/paper4/papers/${created.id}/publish`,{});
  }
  async function course(links=[],{problemIds=[],title='Paper 4 course'}={}){
   const path=await actors.teacher.send('/learning-paths',{title},'POST',201);
   const chapter=await actors.teacher.send(`/learning-paths/${path.id}/chapters`,{title:'Linked practice',content:'Course body',problemIds,paper4Links:links},'POST',201);
   return {...path,chapter};
  }
  async function submit(user,paperId,{versionId,verdicts={},finishRuns=true}={}){
   const attempt=await user.send(`/paper4/papers/${paperId}/attempt`,versionId?{versionId}:{},'POST',201);
   await user.send(`/paper4/attempts/${attempt.id}/submit`,{});
   const tasks=(await pool.query("SELECT t.id,s.question_key FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id WHERE s.attempt_id=$1 AND s.origin='formal' ORDER BY s.question_key",[attempt.id])).rows;
   if(finishRuns)for(const task of tasks)await finish(task.id,verdicts[task.question_key]??{});
   return {...attempt,tasks};
  }
  await run({...actors,pool,classA,classB,paper,course,submit,finish,validate,questions,runnerCases,referenceSolutions});
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
}




test('whole-paper and specific-question course practice deduplicates formal AC and retains ordinary OJ progress',options,async()=>{
 await fixture(async f=>{
  const {pool,teacher,admin,classmate,cross,paper,course,submit,finish}=f;
  const source=await paper();
  const problem=await teacher.send('/problems',{title:'Normal practice',mode:'stdio',statement:'Print 1',samples:[{input:'',expected:'1'}],tests:[{input:'',expected:'1',weight:100}],referenceCode:'print(1)'},'POST',201);
  await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[problem.versionId]);await teacher.send(`/problems/${problem.id}/publish`,{versionId:problem.versionId});await admin.send(`/problems/${problem.id}/rank-review`,{versionId:problem.versionId,decision:'approved'},'PATCH');
  const refs=[{paperId:source.id},{paperId:source.id,questionKey:'Q1'}];const path=await course(refs,{problemIds:[problem.id]});
  const second=await teacher.send(`/learning-paths/${path.id}/chapters`,{title:'Repeat Q1',content:'Revisit this question',paper4Links:[{paperId:source.id,questionKey:'Q1'}]},'POST',201);
  await teacher.send(`/learning-paths/${path.id}/publish`,{});
  let view=await classmate.send(`/learning-paths/${path.id}`);assert.equal(view.taskCount,3);assert.equal(view.chapters[0].taskCount,3);assert.equal(view.chapters[1].taskCount,1);assert.equal(view.completedTasks,0);
  assert.equal(view.chapters[0].paper4Links[0].questionCount,2);assert.equal(view.chapters[0].paper4Links[1].questionTitle,'Question 1');assert.equal(view.chapters[0].paper4Links[0].versionId,source.versionId);
  assert.ok(!JSON.stringify(view.chapters[0].paper4Links).includes('private driver'));assert.ok(!JSON.stringify(view.chapters[0].paper4Links).includes('reference Q1'));
  await classmate.send(`/chapters/${path.chapter.id}`,{paper4Links:[]},'PATCH',403);
  await teacher.send(`/chapters/${path.chapter.id}`,{paper4Links:[]},'PATCH',403,'wrong-csrf');
  await classmate.send(`/chapters/${path.chapter.id}/progress`,{completed:true});
  const attempt=await classmate.send(`/paper4/papers/${source.id}/attempt`,{},'POST',201);
  const run=await classmate.send(`/paper4/attempts/${attempt.id}/runs`,{fileKey:'Q1'},'POST',201);await finish(run.id);
  assert.equal((await classmate.send(`/learning-paths/${path.id}`)).completedTasks,0,'practice AC and marked reading are not formal completion');
  await classmate.send(`/paper4/attempts/${attempt.id}/submit`,{});
  const tasks=(await pool.query("SELECT t.id,s.question_key FROM paper4_run_tasks t JOIN paper4_snapshots s ON s.id=t.snapshot_id WHERE s.attempt_id=$1 AND s.origin='formal' ORDER BY s.question_key",[attempt.id])).rows;
  view=await classmate.send(`/learning-paths/${path.id}`);assert.equal(view.chapters[0].paper4Links[0].pendingQuestions,2);assert.equal(view.completedTasks,0);
  await finish(tasks[0].id);await finish(tasks[1].id,{incomplete:true});
  view=await classmate.send(`/learning-paths/${path.id}`);assert.equal(view.completedTasks,1);assert.equal(view.chapters[0].paper4Links[0].completedQuestions,1);assert.equal(view.chapters[0].paper4Links[1].completed,true);assert.equal(view.chapters[1].completedTasks,1);
  assert.equal(view.chapters[0].paper4Links[0].pendingQuestions,0);assert.equal((await cross.send(`/learning-paths/${path.id}`)).completedTasks,0);
  const normal=await classmate.send('/submissions',{problemId:problem.id,kind:'submit',code:'print(1)',idempotencyKey:randomUUID()},'POST',201);await pool.query("UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[normal.id.slice(3)]);
  view=await classmate.send(`/learning-paths/${path.id}`);assert.equal(view.completedTasks,2);assert.equal(view.chapters[0].completedTasks,2);
  const listed=(await classmate.send('/learning-paths')).items.find(p=>p.id===path.id);assert.equal(listed.taskCount,3);assert.equal(listed.completedTasks,2);
  const roster=await teacher.send(`/learning-paths/${path.id}/progress`);assert.equal(roster.taskCount,3);assert.equal(roster.items.find(s=>s.id===classmate.user.identityId).completedTasks,2);
  assert.equal((await admin.send(`/learning-paths/${path.id}/progress`)).items.find(s=>s.id===classmate.user.identityId).completedTasks,2);
 });
});

test('course links pin versions, count later formal AC without new points, and mask exam completion until release',options,async()=>{
 await fixture(async f=>{
  const {pool,teacher,admin,classmate,paper,course,submit,validate,questions,runnerCases,referenceSolutions}=f;
  const source=await paper();const oldPath=await course([{paperId:source.id}]);await teacher.send(`/learning-paths/${oldPath.id}/publish`,{});
  await submit(classmate,source.id);assert.equal((await classmate.send(`/learning-paths/${oldPath.id}`)).completedTasks,2);
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger WHERE identity_id=$1',[classmate.user.identityId])).rows[0].n,2);
  const newerQuestions=questions.map(q=>({...q,title:q.title+' revised'}));
  await teacher.send(`/paper4/papers/${source.id}/draft`,{},'POST',201);
  await teacher.send(`/paper4/papers/${source.id}`,{title:'Revised paper',questions:newerQuestions,runnerCases,referenceSolutions},'PATCH');await validate(source.id);const revised=await teacher.send(`/paper4/papers/${source.id}/publish`,{});
  assert.notEqual(revised.versionId,source.versionId);
  await teacher.send(`/chapters/${oldPath.chapter.id}`,{content:'Updated lesson',paper4Links:[{paperId:source.id}]},'PATCH');
  assert.equal((await teacher.send(`/learning-paths/${oldPath.id}`)).chapters[0].paper4Links[0].versionId,source.versionId);
  const newPath=await course([{paperId:source.id,versionId:revised.versionId,questionKey:'Q1'}]);await teacher.send(`/learning-paths/${newPath.id}/publish`,{});
  assert.equal((await classmate.send(`/learning-paths/${newPath.id}`)).completedTasks,0);
  const activity=await teacher.send(`/paper4/papers/${source.id}/activities`,{activityKind:'exam',participants:[classmate.user.identityId],startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()},'POST',201);
  const attempt=await submit(classmate,activity.id);
  assert.equal((await classmate.send(`/learning-paths/${newPath.id}`)).completedTasks,0,'unreleased examination AC must not leak through course progress');
  await teacher.send(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q1a',marks:35},'PATCH');await teacher.send(`/paper4/attempts/${attempt.id}/marks`,{stageId:'Q2a',marks:40},'PATCH');await teacher.send(`/paper4/attempts/${attempt.id}/release`,{});
  assert.equal((await classmate.send(`/learning-paths/${newPath.id}`)).completedTasks,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger WHERE identity_id=$1',[classmate.user.identityId])).rows[0].n,2,'the existing canonical points ledger need not award a newer version again');
  const identityId=classmate.user.identityId;const released=await admin.send(`/people/${identityId}/unbind`,{});
  await classmate.send('/auth/register',{kind:'student',number:'P4-classmate',name:'classmate',activationCode:released.activationCode,username:'course-p4-reclaimed',password:`fixture-${randomUUID()}`},'POST',201);
  assert.equal((await classmate.send(`/learning-paths/${newPath.id}`)).completedTasks,1,'completion follows immutable identity across credential recovery');
 });
});

test('course Paper 4 references reject unsafe/unfinishable targets atomically and retain archived references only for repair',options,async()=>{
 await fixture(async f=>{
  const {pool,teacher,otherTeacher,classmate,paper,course,questions,runnerCases,referenceSolutions}=f;
  const source=await paper(),unpublished=await paper({publish:false}),foreign=await paper({title:'Other source'});
  const activity=await teacher.send(`/paper4/papers/${source.id}/activities`,{activityKind:'practice',participants:[classmate.user.identityId]},'POST',201);
  const manual=await paper({publish:false,overrides:{questions:questions.map(q=>({...q,stages:q.stages.map(s=>({...s,judgeMode:'manual'}))})),runnerCases:{},referenceSolutions:{}}});await teacher.send(`/paper4/papers/${manual.id}/publish`,{},'POST',409);
  // Legacy publications can predate the current automatic-coverage requirement.
  await pool.query('UPDATE paper4_versions SET published_at=now() WHERE id=$1',[manual.versionId]);await pool.query("UPDATE paper4_papers SET status='published',published_at=now(),current_version_id=$2,draft_version_id=NULL WHERE id=$1",[manual.id,manual.versionId]);
  const path=await course([{paperId:source.id}]);
  const before=(await pool.query('SELECT * FROM chapter_paper4_links WHERE chapter_id=$1',[path.chapter.id])).rows;
  for(const invalid of [{paperId:unpublished.id},{paperId:activity.id},{paperId:source.id,versionId:foreign.versionId},{paperId:source.id,questionKey:'Missing'},{paperId:manual.id}]){
   await teacher.send(`/chapters/${path.chapter.id}`,{content:'Must rollback',paper4Links:[{paperId:source.id},invalid]},'PATCH',409);
   assert.deepEqual((await pool.query('SELECT * FROM chapter_paper4_links WHERE chapter_id=$1',[path.chapter.id])).rows,before);
   assert.equal((await teacher.send(`/learning-paths/${path.id}`)).chapters[0].content,'Course body');
  }
  await otherTeacher.send(`/chapters/${path.chapter.id}`,{paper4Links:[]},'PATCH',403);
  await teacher.send(`/chapters/${path.chapter.id}`,{paper4Links:[{paperId:source.id,versionId:false}]},'PATCH',400);
  await teacher.send(`/chapters/${path.chapter.id}`,{paper4Links:[{paperId:source.id,questionKey:'bad key'}]},'PATCH',400);
  const doc={format:'codemaster-learning-path',version:1,title:'Imported Paper 4 references',estimatedMinutes:30,chapters:[{title:'Linked lesson',content:'Imported body',problemIds:[],paper4Links:[{paperId:source.id,versionId:source.versionId,questionKey:'Q2'}]}]};
  const imported=await teacher.send('/learning-paths/import',doc,'POST',201);const restored=await teacher.send(`/learning-paths/${imported.id}`);assert.equal(restored.chapters[0].paper4Links[0].questionKey,'Q2');assert.equal(restored.taskCount,1);assert.equal(restored.published,false);
  const pathsBefore=(await pool.query('SELECT count(*)::int n FROM learning_paths')).rows[0].n;
  await teacher.send('/learning-paths/import',{...doc,chapters:[doc.chapters[0],{...doc.chapters[0],paper4Links:[{paperId:unpublished.id}]}]},'POST',409);assert.equal((await pool.query('SELECT count(*)::int n FROM learning_paths')).rows[0].n,pathsBefore);
  await teacher.send(`/learning-paths/${path.id}/publish`,{});await teacher.send(`/paper4/papers/${source.id}/archive`,{});
  const staff=await teacher.send(`/learning-paths/${path.id}`);assert.equal(staff.chapters[0].paper4Links[0].available,false);assert.equal(staff.taskCount,0);
  const student=await classmate.send(`/learning-paths/${path.id}`);assert.deepEqual(student.chapters[0].paper4Links,[]);assert.equal(student.taskCount,0);
  await teacher.send(`/chapters/${path.chapter.id}`,{content:'Keep repairing',paper4Links:[{paperId:source.id,versionId:source.versionId,questionKey:null}]},'PATCH');
  await teacher.send(`/learning-paths/${path.id}/publish`,{},'POST',409);
  await teacher.send(`/chapters/${path.chapter.id}`,{paper4Links:[]},'PATCH');assert.equal((await teacher.send(`/learning-paths/${path.id}/publish`,{})).taskCount,0);
 });
});

test('course Paper 4 migration is additive and keeps legacy course content, progress and Paper 4 evidence untouched',options,async()=>{
 await fixture(async({pool,teacher,classmate,paper})=>{
  const source=await paper();const path=(await pool.query("INSERT INTO learning_paths(owner_account_id,title,published_at) VALUES($1,'Legacy course',now()) RETURNING id",[teacher.user.id])).rows[0];
  const chapter=(await pool.query("INSERT INTO learning_chapters(path_id,title,content,position) VALUES($1,'Original lesson','Original content',0) RETURNING id",[path.id])).rows[0];await pool.query('INSERT INTO learning_progress(identity_id,chapter_id,completed) VALUES($1,$2,true)',[classmate.user.identityId,chapter.id]);
  const tables=['learning_paths','learning_chapters','learning_progress','paper4_papers','paper4_versions','paper4_runs'];const before=await Promise.all(tables.map(async table=>(await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows));
  await pool.query('DELETE FROM schema_migrations WHERE name=$1',[upgrade]);await migrate(pool);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await pool.query(`SELECT * FROM ${tables[i]} ORDER BY 1`)).rows,before[i]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM chapter_paper4_links')).rows[0].n,0);
  const visible=await classmate.send(`/learning-paths/${path.id}`);assert.equal(visible.completedChapters,1);assert.deepEqual(visible.chapters[0].paper4Links,[]);
 },{beforeUpgrade:true});
});


test('restoring a course with another teacher archived Paper 4 source creates an editable withdrawn repair state',options,async()=>{
 await fixture(async({pool,teacher,otherTeacher,classmate,paper,course,submit})=>{
  const source=await paper();
  const healthy=await course([{paperId:source.id}]);await teacher.send(`/learning-paths/${healthy.id}/publish`,{});await teacher.send(`/learning-paths/${healthy.id}`,{archived:true},'PATCH');
  const normalRestore=await teacher.send(`/learning-paths/${healthy.id}/restore`,{});assert.equal(normalRestore.published,true);assert.equal(normalRestore.withdrawnAt,null);
  const path=await otherTeacher.send('/learning-paths',{title:'Another teacher course'},'POST',201);
  const chapter=await otherTeacher.send(`/learning-paths/${path.id}/chapters`,{title:'Linked source',content:'Original course body',paper4Links:[{paperId:source.id}]},'POST',201);
  await otherTeacher.send(`/learning-paths/${path.id}/publish`,{});await classmate.send(`/chapters/${chapter.id}/progress`,{completed:true});await submit(classmate,source.id);
  const originalReferences=(await pool.query('SELECT * FROM chapter_paper4_links WHERE chapter_id=$1',[chapter.id])).rows;
  const originalProgress=(await pool.query('SELECT * FROM learning_progress WHERE chapter_id=$1',[chapter.id])).rows;
  const originalAwards=(await pool.query('SELECT * FROM paper4_rank_ledger ORDER BY 1,2,5')).rows;
  await otherTeacher.send(`/learning-paths/${path.id}`,{archived:true},'PATCH');await teacher.send(`/paper4/papers/${source.id}/archive`,{});
  await otherTeacher.send(`/paper4/papers/${source.id}/restore`,{},'POST',403);
  await classmate.send(`/learning-paths/${path.id}/restore`,{},'POST',403);
  const restored=await otherTeacher.send(`/learning-paths/${path.id}/restore`,{});
  assert.equal(restored.archived,false);assert.equal(restored.published,false);assert.ok(restored.withdrawnAt);assert.equal(restored.canEdit,true);
  assert.equal(restored.chapters[0].content,'Original course body');assert.equal(restored.chapters[0].paper4Links[0].available,false);assert.equal(restored.chapters[0].paper4Links[0].versionId,source.versionId);
  assert.deepEqual((await pool.query('SELECT * FROM chapter_paper4_links WHERE chapter_id=$1',[chapter.id])).rows,originalReferences);
  assert.deepEqual((await pool.query('SELECT * FROM learning_progress WHERE chapter_id=$1',[chapter.id])).rows,originalProgress);
  assert.deepEqual((await pool.query('SELECT * FROM paper4_rank_ledger ORDER BY 1,2,5')).rows,originalAwards);
  await classmate.send(`/learning-paths/${path.id}`,undefined,'GET',404);assert.ok(!(await classmate.send('/learning-paths')).items.some(p=>p.id===path.id));
  await otherTeacher.send(`/learning-paths/${path.id}/publish`,{},'POST',409);
  await otherTeacher.send(`/chapters/${chapter.id}`,{paper4Links:[]},'PATCH');
  const repaired=await otherTeacher.send(`/learning-paths/${path.id}/publish`,{});assert.equal(repaired.published,true);assert.equal(repaired.withdrawnAt,null);
  assert.equal((await classmate.send(`/learning-paths/${path.id}`)).completedChapters,1);
 });
});
