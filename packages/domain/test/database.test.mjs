import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { createApp, loadConfig } from '../src/app.mjs';
import { hashPassword } from '../src/security.mjs';

test('real PostgreSQL + HTTP: atomic identities, permissions, immutable versions, deadlines, grades, reset and admin safety',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async t=>{
 const manager=createPool(process.env.TEST_DATABASE_URL),schema=`integration_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);
 const conn=new URL(process.env.TEST_DATABASE_URL);conn.searchParams.set('options',`-csearch_path=${schema}`);conn.searchParams.set('application_name',schema);
 const pool=createPool(conn.toString());let server;
 try {
  await migrate(pool);await migrate(pool);
  const definerPaths=(await pool.query(`SELECT p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=ANY($2::text[])`,[schema,['award_submission_points','points_on_submission','points_on_timed_publish']])).rows;
  assert.deepEqual(definerPaths.map(p=>p.proname).sort(),['award_submission_points','points_on_submission','points_on_timed_publish'].sort());
  assert(definerPaths.every(p=>p.proconfig?.includes(`search_path=${schema}, pg_temp`)), 'point functions must use their trusted schema before pg_temp');
  const adminId=await bootstrap(pool,{name:'测试管理员',number:'ADMIN',username:'integration-admin',password:'Integration-pass-2026'});
  await assert.rejects(()=>bootstrap(pool,{name:'重复管理员',number:'ADMIN2',username:'duplicate-admin',password:'Integration-pass-2026'}),/already exists/);
  server=http.createServer(await createApp(pool,loadConfig({SESSION_SECRET:'integration-secret-with-at-least-32-bytes',APP_ORIGIN:'http://school.test',COOKIE_SECURE:'false'})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const request=async(path,method='GET',body,auth,extra={})=>{
   const result=await fetch(`${base}${path}`,{method,headers:{Origin:'http://school.test',...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
   const data=await result.json();return {status:result.status,data,cookie:result.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};
  };
  const login=async(username,password='Integration-pass-2026')=>{const r=await request('/auth/login','POST',{username,password});assert.equal(r.status,200,JSON.stringify(r.data));return r;};
  const admin=await login('integration-admin');
  await t.test('last administrator cannot be disabled or stripped',async()=>{
   assert.equal((await request(`/accounts/${adminId}`,'PATCH',{disabled:true},admin)).status,409);
   assert.equal((await request(`/accounts/${adminId}`,'PATCH',{roles:['teacher']},admin)).status,409);
  });
  const person=async(kind,number,name)=>{const r=await request('/people','POST',{kind,number,name},admin);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
  const p=await person('student','S001','学生一');
  let student;
  await t.test('concurrent activation succeeds once, exposes no reusable token',async()=>{
   const body={kind:'student',number:'S001',name:'学生一',activationCode:p.activationCode,password:'Integration-pass-2026'};
   const outcomes=await Promise.all([request('/auth/register','POST',{...body,username:'student-a'}),request('/auth/register','POST',{...body,username:'student-b'})]);
   assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,400]);student=outcomes.find(r=>r.status===201);
   assert.equal((await pool.query('SELECT count(*)::int n FROM accounts WHERE identity_id=$1',[p.person.id])).rows[0].n,1);
   assert.notEqual((await pool.query('SELECT token_hash FROM activation_tokens WHERE identity_id=$1',[p.person.id])).rows[0].token_hash,p.activationCode);
  });
  const teacherPerson=await person('teacher','T001','教师一');
  const teacher=await request('/auth/register','POST',{kind:'teacher',number:'T001',name:'教师一',activationCode:teacherPerson.activationCode,username:'teacher-a',password:'Integration-pass-2026'});assert.equal(teacher.status,201);
  const otherPerson=await person('student','S002','学生二');
  const other=await request('/auth/register','POST',{kind:'student',number:'S002',name:'学生二',activationCode:otherPerson.activationCode,username:'student-other',password:'Integration-pass-2026'});
  const cls=await request('/classes','POST',{name:'测试训练班',studentIds:[p.person.id],teacherIds:[teacherPerson.person.id]},admin);assert.equal(cls.status,201,JSON.stringify(cls.data));
  await t.test('teacher sees own roster, student cannot read administration',async()=>{
   const roster=await request('/people','GET',null,teacher);assert.equal(roster.status,200);assert(roster.data.items.some(i=>i.id===p.person.id));assert(!roster.data.items.some(i=>i.id===otherPerson.person.id));
   assert.equal((await request('/people','GET',null,student)).status,403);
   assert.equal((await request(`/accounts/${adminId}`,'PATCH',{roles:['student']},teacher)).status,403);
   assert.equal((await request('/classes','GET',null,teacher)).data.items[0].studentIds[0],p.person.id);
   assert.equal((await request(`/classes/${cls.data.id}/members`,'POST',{identityIds:[otherPerson.person.id]},teacher)).status,403);
   assert.equal((await request('/classes','POST',{name:'未授权班级',studentIds:[otherPerson.person.id]},teacher)).status,403);
   assert.equal((await request('/classes','POST',{name:'重复训练班',studentIds:[p.person.id]},teacher)).status,201);
  });
  await t.test('class names are unique per active owner under concurrent creation and renaming',async()=>{
   const outcomes=await Promise.all([request('/classes','POST',{name:'Unique class label'},teacher),request('/classes','POST',{name:'  UNIQUE CLASS LABEL  '},teacher)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,409]);const created=outcomes.find(r=>r.status===201);
   const second=await request('/classes','POST',{name:'另一课程班'},teacher);assert.equal(second.status,201);assert.equal((await request(`/classes/${second.data.id}`,'PATCH',{name:'unique class label'},teacher)).status,409);assert.equal((await pool.query('SELECT name FROM classes WHERE id=$1',[second.data.id])).rows[0].name,'另一课程班');
   const differentOwner=await request('/classes','POST',{name:'Unique class label'},admin);assert.equal(differentOwner.status,201);assert.notEqual(differentOwner.data.id,created.data.id);
  });
  const input={title:'求和',mode:'stdio',statement:'读入两个整数，输出和。',starterCode:'',samples:[{input:'1 2',expected:'3'}],tests:[{input:'secret 3',expected:'private expected',weight:100}],referenceCode:'print(sum(map(int,input().split())))',timeLimitMs:2000,memoryLimitMb:256};
  const draft=await request('/problems','POST',input,teacher);assert.equal(draft.status,201,JSON.stringify(draft.data));
  await t.test('drafts stay private and publication waits for reference verification',async()=>{
   assert.equal((await request(`/problems/${draft.data.id}`,'GET',null,student)).status,404);
   assert.equal((await request(`/problems/${draft.data.id}/publish`,'POST',{versionId:draft.data.versionId},teacher)).status,409);
   await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[draft.data.versionId]);
   assert.equal((await request(`/problems/${draft.data.id}/publish`,'POST',{versionId:draft.data.versionId},teacher)).status,200);
   assert.equal((await request(`/problems/${draft.data.id}`,'GET',null,student)).status,404);
   assert.equal((await request(`/problems/${draft.data.id}/rank-review`,'PATCH',{versionId:draft.data.versionId,decision:'approved'},admin)).status,200);
   const publicProblem=await request(`/problems/${draft.data.id}`,'GET',null,student);assert.equal(publicProblem.status,200);assert(!('tests'in publicProblem.data));assert(!('referenceCode'in publicProblem.data));assert(!JSON.stringify(publicProblem.data).includes('secret'));
   await assert.rejects(()=>pool.query('UPDATE test_cases SET expected=$1 WHERE version_id=$2',['modified',draft.data.versionId]),/immutable/);
   await assert.rejects(()=>pool.query('UPDATE problem_versions SET statement=$1 WHERE id=$2',['modified',draft.data.versionId]),/immutable/);
  });
  const a=await request('/assignments','POST',{title:'练习一',classId:cls.data.id,dueAt:new Date(Date.now()+60000).toISOString(),problems:[{problemId:draft.data.id,points:50}],participants:[p.person.id]},teacher);assert.equal(a.status,201,JSON.stringify(a.data));
  await t.test('school visibility requires per-version administrator review without blocking assigned private work',async()=>{
   assert.equal((await request('/problem-banks','POST',{name:'教师不能直接建校内库',visibility:'school'},teacher)).status,403);
   const bank=await request('/problem-banks','POST',{name:'待审核题库',visibility:'private'},teacher);assert.equal(bank.status,201);
   assert.equal((await request(`/problem-banks/${bank.data.id}`,'PATCH',{visibility:'school'},teacher)).status,403);
   assert.equal((await request(`/problem-banks/${bank.data.id}`,'PATCH',{visibility:'school'},admin)).status,200);
   const created=await request('/problems','POST',{...input,bankId:bank.data.id,title:'未审核题'},teacher);assert.equal(created.status,201);
   await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[created.data.versionId]);
   assert.equal((await request(`/problems/${created.data.id}/publish`,'POST',{versionId:created.data.versionId},teacher)).status,200);
   assert.equal((await request(`/problems/${created.data.id}`,'GET',null,student)).status,404);
   assert.equal((await request('/problems','GET',null,student)).data.items.some(problem=>problem.id===created.data.id),false);
   assert.equal((await request('/problems/rank-review','GET',null,teacher)).status,403);
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'approved'},teacher)).status,403);
   const pending=(await request('/problems/rank-review','GET',null,admin)).data.items.find(problem=>problem.problemId===created.data.id);
   assert.equal(pending.rankReviewStatus,'pending');assert.equal(pending.schoolVisibleAt,null);
   const assigned=await request('/assignments','POST',{title:'指定学生私有题',classId:cls.data.id,dueAt:new Date(Date.now()+60000).toISOString(),problems:[{problemId:created.data.id,points:100}],participants:[p.person.id]},teacher);
   assert.equal(assigned.status,201);assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,student)).status,200);
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'rejected',reason:'题面仍需复核'},admin)).status,200);
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'approved'},admin)).status,200);
   const publicProblem=await request(`/problems/${created.data.id}`,'GET',null,student);assert.equal(publicProblem.status,200);assert.equal(publicProblem.data.rankReviewStatus,'approved');
   const revision=await request(`/problems/${created.data.id}/versions`,'POST',{...input,bankId:bank.data.id,title:'未审新版'},teacher);assert.equal(revision.status,201);
   assert.equal((await request('/problems','GET',null,teacher)).data.items.find(problem=>problem.id===created.data.id)?.versionId,revision.data.versionId);
   await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[revision.data.versionId]);
   assert.equal((await request(`/problems/${created.data.id}/publish`,'POST',{versionId:revision.data.versionId},teacher)).status,200);
   assert.equal((await request(`/problems/${created.data.id}?versionId=${revision.data.versionId}`,'GET',null,student)).status,404);
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'approved'},admin)).status,409);
   assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,student)).status,200);
   const priorDefault=await request(`/problems/${created.data.id}`,'GET',null,other);
   assert.equal(priorDefault.status,200);assert.equal(priorDefault.data.versionId,created.data.versionId);
   const priorSubmission=await request('/submissions','POST',{kind:'samples',problemId:created.data.id,code:'print(3)',idempotencyKey:randomUUID()},other);
   assert.equal(priorSubmission.status,201,JSON.stringify(priorSubmission.data));
   assert.equal(priorSubmission.data.versionId,created.data.versionId,'submission without versionId must use the same public version shown to the student');
   assert.equal((await request('/problems','GET',null,other)).data.items.find(problem=>problem.id===created.data.id)?.versionId,created.data.versionId);
   assert.equal((await request('/problem-banks','GET',null,other)).data.items.find(item=>item.id===bank.data.id)?.problemCount,1);
   const older=(await request('/problems/rank-review','GET',null,admin)).data.items.find(item=>item.versionId===created.data.versionId);
   assert.equal(older.isCurrent,false);
   // Legacy public versions can still have pending review after migration.
   await pool.query('UPDATE problem_versions SET school_visible_at=clock_timestamp() WHERE id=$1',[revision.data.versionId]);
   assert.equal((await request(`/problems/${created.data.id}`,'GET',null,other)).data.versionId,revision.data.versionId);
   const rejected=await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:revision.data.versionId,decision:'rejected',reason:'历史公开版题面不应公开'},admin);
   assert.equal(rejected.status,200);assert.equal(rejected.data.schoolVisibleAt,null);
   assert.equal((await request(`/problems/${created.data.id}`,'GET',null,other)).data.versionId,created.data.versionId);
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'revoked',reason:'撤下待复核题面'},teacher)).status,403);
   const revoked=await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'revoked',reason:'撤下待复核题面'},admin);
   assert.equal(revoked.status,200);assert.equal(revoked.data.isCurrent,false);
   assert.equal(revoked.data.rankReviewStatus,'revoked');assert.equal(revoked.data.schoolVisibleAt,null);
   assert.equal(revoked.data.rankApprovedAt,older.rankApprovedAt);
   assert.equal((await request(`/problems/${created.data.id}`,'GET',null,other)).status,404);
   assert.equal((await request('/problems','GET',null,other)).data.items.some(problem=>problem.id===created.data.id),false);
   assert.equal((await request('/problem-banks','GET',null,other)).data.items.find(item=>item.id===bank.data.id)?.problemCount,0);
   assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,student)).status,200);
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'approved'},admin)).status,409);
   const legacy=await request(`/problems/${created.data.id}/versions`,'POST',{...input,bankId:bank.data.id,title:'历史公开待审版'},teacher);
   assert.equal(legacy.status,201);await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[legacy.data.versionId]);
   assert.equal((await request(`/problems/${created.data.id}/publish`,'POST',{versionId:legacy.data.versionId},teacher)).status,200);
   await pool.query('UPDATE problem_versions SET school_visible_at=clock_timestamp() WHERE id=$1',[legacy.data.versionId]);
   assert.equal((await request(`/problems/${created.data.id}`,'GET',null,other)).data.versionId,legacy.data.versionId);
   const emergency=await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:legacy.data.versionId,decision:'revoked',reason:'历史版本应急撤下'},admin);
   assert.equal(emergency.status,200);assert.equal(emergency.data.rankReviewStatus,'revoked');assert.equal(emergency.data.rankApprovedAt,null);
   assert.equal((await request(`/problems/${created.data.id}`,'GET',null,other)).status,404);
  });
  const subBody={problemId:draft.data.id,assignmentId:a.data.id,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()};
  const sub=await request('/submissions','POST',subBody,student);assert.equal(sub.status,201,JSON.stringify(sub.data));
  await t.test('admission is idempotent and permissions/CSRF prevent forged operations',async()=>{
   const repeated=await request('/submissions','POST',subBody,student);assert.equal(repeated.data.id,sub.data.id);
   assert.equal((await request('/submissions','POST',{...subBody,code:'print(4)'},student)).status,409);
   assert.equal((await request(`/submissions/${sub.data.id}`,'GET',null,other)).status,403);
   assert.equal((await request(`/submissions/${sub.data.id}`,'GET',null,teacher)).status,200);
   assert.equal((await request('/submissions','POST',{...subBody,idempotencyKey:randomUUID()},student,{'X-CSRF-Token':'wrong'})).status,403);
   assert.equal((await request('/submissions','POST',{...subBody,idempotencyKey:randomUUID()},student,{Origin:'https://attacker.test'})).status,403);
   assert.equal((await request(`/submissions?assignmentId=${a.data.id}`,'GET',null,student)).data.items.length,1);
  });
  await t.test('system failures are pending rather than zero and correction does not rewrite score',async()=>{
   await pool.query("UPDATE submissions SET status='System Error' WHERE id=$1",[sub.data.id.slice(3)]);
   let grade=(await request(`/assignments/${a.data.id}`,'GET',null,teacher)).data.grades[0];assert.equal(grade.score,null);assert.equal(grade.pending,true);assert.equal(grade.problems[0].status,'System Error');
   await pool.query("UPDATE submissions SET status='WA',score=40,passed=0,total=1 WHERE id=$1",[sub.data.id.slice(3)]);
   const correction=await request('/submissions','POST',{problemId:draft.data.id,kind:'correction',originalSubmissionId:sub.data.id,code:'print(5)',idempotencyKey:randomUUID()},student);assert.equal(correction.status,201);
   await pool.query("UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[correction.data.id.slice(3)]);
   grade=(await request(`/assignments/${a.data.id}`,'GET',null,teacher)).data.grades[0];assert.equal(grade.score,20);
   const unresolved=await request('/submissions','POST',{...subBody,idempotencyKey:randomUUID()},student);assert.equal(unresolved.status,201);
   await pool.query("UPDATE submissions SET status='System Error' WHERE id=$1",[unresolved.data.id.slice(3)]);
   grade=(await request(`/assignments/${a.data.id}`,'GET',null,teacher)).data.grades[0];assert.equal(grade.score,20);assert.equal(grade.pending,true);assert.equal(grade.problems[0].pending,true);
   await pool.query("UPDATE submissions SET status='WA',score=0 WHERE id=$1",[unresolved.data.id.slice(3)]);
   const note=await request('/review-notebook','POST',{submissionId:sub.data.id,note:'请检查输入边界'},teacher);assert.equal(note.status,201);
   const notes=(await request('/review-notebook','GET',null,student)).data.items;assert(notes.some(n=>n.note==='请检查输入边界'&&n.problemId===draft.data.id&&n.authorIdentityId===teacherPerson.person.id));
   const detail=(await request(`/submissions/${sub.data.id}`,'GET',null,student)).data;assert(detail.reviews.some(n=>n.note==='请检查输入边界'&&n.authorIdentityId===teacherPerson.person.id));
  });
  await t.test('versions pinned to assignments and late admission rejected, existing retries accepted',async()=>{
   const revision=await request(`/problems/${draft.data.id}/versions`,'POST',{...input,title:'求和二'},teacher);assert.equal(revision.status,201);
   await assert.rejects(()=>pool.query('UPDATE test_cases SET version_id=$1 WHERE version_id=$2',[draft.data.versionId,revision.data.versionId]),/immutable/);
   await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[revision.data.versionId]);
   assert.equal((await request(`/problems/${draft.data.id}/publish`,'POST',{versionId:revision.data.versionId},teacher)).status,200);
   const oldVersion=await request('/submissions','POST',{problemId:draft.data.id,versionId:draft.data.versionId,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()},student);assert.equal(oldVersion.status,201);assert.equal(oldVersion.data.versionId,draft.data.versionId);
   assert.equal((await request('/submissions','POST',{...subBody,versionId:revision.data.versionId,idempotencyKey:randomUUID()},student)).status,409);
   assert.equal((await request(`/assignments/${a.data.id}`,'GET',null,student)).data.problems[0].versionId,draft.data.versionId);
   await pool.query("UPDATE assignments SET due_at=clock_timestamp()-interval '1 second' WHERE id=$1",[a.data.id]);
   assert.equal((await request('/submissions','POST',{...subBody,idempotencyKey:randomUUID()},student)).status,409);
   assert.equal((await request('/submissions','POST',subBody,student)).data.id,sub.data.id);
  });
  await t.test('function protocol errors are rejected before a submission or judge task is created',async()=>{
   const fnInput={...input,title:'函数求和',mode:'function',functionName:'add',samples:[{input:'[1,2]',expected:'3'}],tests:[{input:'[2,3]',expected:'5',weight:100}],referenceCode:'def add(a,b):\n    return a+b'};
   assert.equal((await request('/problems','POST',{...fnInput,samples:[{input:'{"args":[],"kwargs":null}',expected:'3'}]},teacher)).status,400);
   const fn=await request('/problems','POST',fnInput,teacher);assert.equal(fn.status,201);await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[fn.data.versionId]);assert.equal((await request(`/problems/${fn.data.id}/publish`,'POST',{versionId:fn.data.versionId},teacher)).status,200);assert.equal((await request(`/problems/${fn.data.id}/rank-review`,'PATCH',{versionId:fn.data.versionId,decision:'approved'},admin)).status,200);
   const count=(await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n;
   for(const customInput of ['broken','{"args":[],"kwargs":[]}','{"args":[],"other":1}']){const invalid=await request('/submissions','POST',{problemId:fn.data.id,versionId:fn.data.versionId,kind:'custom',customInput,code:'def add(a,b): return a+b',idempotencyKey:randomUUID()},student);assert.equal(invalid.status,400,JSON.stringify(invalid.data));}
   assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n,count);
   assert.equal((await request('/judge-status','GET',null,admin)).status,200);assert.equal((await request('/judge-status','GET',null,student)).status,403);
  });
  await t.test('bulk import repeats safely and does not overwrite activated identities',async()=>{
   const body={rows:[{kind:'student',number:'S001',name:'学生一'},{kind:'student',number:'S001',name:'错名'},{kind:'student',number:'S003',name:'新学生'}]};
   const first=await request('/people/import','POST',body,admin);assert.equal(first.status,200);assert.deepEqual(first.data.summary,{created:1,skipped:1,failed:1,total:3});assert(first.data.items[2].activationCode);
   const repeated=await request('/people/import','POST',body,admin);assert.equal(repeated.data.summary.created,0);assert(!repeated.data.items.some(i=>i.activationCode));
   const renamed=await request(`/people/${p.person.id}`,'PATCH',{name:'学生一新名'},admin);assert.equal(renamed.data.id,p.person.id);
  });
  await t.test('a student with teacher role can submit their assigned work without obtaining peers or teaching authority',async()=>{
   assert.equal((await request(`/accounts/${other.data.user.id}`,'PATCH',{roles:['student','teacher']},admin)).status,200);
   const mixed=await login('student-other');const enrolled=await request('/classes','POST',{name:'混合角色学生班',studentIds:[otherPerson.person.id,p.person.id],teacherIds:[teacherPerson.person.id]},admin);assert.equal(enrolled.status,201);
   const homework=await request('/assignments','POST',{title:'混合角色作业',classId:enrolled.data.id,dueAt:new Date(Date.now()+60000).toISOString(),problems:[{problemId:draft.data.id,points:100}],participants:[otherPerson.person.id]},teacher);assert.equal(homework.status,201);
   const mine=await request(`/assignments/${homework.data.id}`,'GET',null,mixed);assert.equal(mine.status,200);assert.equal(mine.data.grades.length,1);assert.equal(mine.data.grades[0].identityId,otherPerson.person.id);assert(!('participants'in mine.data));assert((await request('/assignments','GET',null,mixed)).data.items.some(a=>a.id===homework.data.id));
   const classes=(await request('/classes','GET',null,mixed)).data.items;assert.equal(classes.find(c=>c.id===enrolled.data.id).members.length,1);
   assert.equal((await request('/submissions','POST',{problemId:draft.data.id,versionId:mine.data.problems[0].versionId,assignmentId:homework.data.id,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()},mixed)).status,201);
   assert.equal((await request(`/classes/${enrolled.data.id}/members`,'POST',{identityIds:[p.person.id]},mixed)).status,403);
  });
  await t.test('password reset is one-use, revokes sessions and password change rotates requester session',async()=>{
   const reset=await request(`/people/${p.person.id}/reset`,'POST',{},admin);assert.equal(reset.status,200);
   const changed=await request('/auth/reset','POST',{username:student.data.user.username,resetCode:reset.data.resetCode,password:'New-integration-pass-2026'});assert.equal(changed.status,200);
   assert.equal((await request('/auth/me','GET',null,student)).status,401);
   assert.equal((await request('/auth/reset','POST',{username:student.data.user.username,resetCode:reset.data.resetCode,password:'Other-integration-pass-2026'})).status,400);
   const fresh=await login(student.data.user.username,'New-integration-pass-2026');
   const profile=await request('/auth/profile','PATCH',{currentPassword:'New-integration-pass-2026',newPassword:'Final-integration-pass-2026'},fresh);assert.equal(profile.status,200);assert.notEqual(profile.csrfToken,fresh.csrfToken);
   assert.equal((await request('/auth/me','GET',null,fresh)).status,401);assert.equal((await request('/auth/me','GET',null,profile)).status,200);
  });
  await t.test('login verified against an old password cannot recreate a session after a concurrent reset',async()=>{
   const locked=await pool.connect();
   try {
    await locked.query('BEGIN');await locked.query('SELECT * FROM accounts WHERE identity_id=$1 FOR UPDATE',[p.person.id]);
    const attempt=request('/auth/login','POST',{username:student.data.user.username,password:'Final-integration-pass-2026'});
    let waiting=false;for(let i=0;i<100;i++){const wait=await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM accounts WHERE id=%'",[schema]);if(wait.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(waiting,true,'login must reach the row lock before the reset commits');
    await locked.query('UPDATE accounts SET password_hash=$1 WHERE identity_id=$2',[await hashPassword('Concurrent-reset-pass-2026'),p.person.id]);await locked.query('DELETE FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE identity_id=$1)',[p.person.id]);await locked.query('COMMIT');
    assert.equal((await attempt).status,401);await login(student.data.user.username,'Concurrent-reset-pass-2026');
   } finally {await locked.query('ROLLBACK');locked.release();}
  });
  let privateBank,privateProblem;
  await t.test('private banks, teacher read/edit sharing and groups enforce resource permission boundaries',async()=>{
   const bank=await request('/problem-banks','POST',{name:'私有教学题库',visibility:'private'},teacher);assert.equal(bank.status,201);privateBank=bank.data;
   const created=await request('/problems','POST',{...input,bankId:bank.data.id,tags:['ACSL','Contest 1'],source:'教师原创'},teacher);assert.equal(created.status,201);privateProblem=created.data;
   await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[created.data.versionId]);assert.equal((await request(`/problems/${created.data.id}/publish`,'POST',{versionId:created.data.versionId},teacher)).status,200);
   const learner=await login(student.data.user.username,'Concurrent-reset-pass-2026');assert.equal((await request(`/problems/${created.data.id}`,'GET',null,learner)).status,404);assert(!(await request('/problems','GET',null,learner)).data.items.some(p=>p.id===created.data.id));
   const reader=await login('student-other');assert.equal((await request(`/problem-banks/${bank.data.id}/permissions`,'POST',{identityId:otherPerson.person.id,permission:'read'},teacher)).status,200);
   const shared=await request(`/problems/${created.data.id}`,'GET',null,reader);assert.equal(shared.status,200);assert.deepEqual(shared.data.tags,['ACSL','Contest 1']);assert.equal(shared.data.source,'教师原创');assert.equal(shared.data.canEdit,false);assert(!('tests'in shared.data));assert(!('referenceCode'in shared.data));
   assert.equal((await request(`/problems/${created.data.id}/versions`,'POST',{...input,bankId:bank.data.id},reader)).status,403);
   assert.equal((await request(`/problem-banks/${bank.data.id}/permissions`,'POST',{identityId:otherPerson.person.id,permission:'edit'},teacher)).status,200);
   assert.equal((await request(`/problems/${created.data.id}/versions`,'POST',{...input,bankId:bank.data.id,title:'协作草稿'},reader)).status,201);
   assert.equal((await request(`/problem-banks/${bank.data.id}/permissions/${otherPerson.person.id}`,'DELETE',{},teacher)).status,200);assert.equal((await request(`/problems/${created.data.id}`,'GET',null,reader)).status,404);
   const group=await request('/problem-groups','POST',{name:'私有分组',bankId:bank.data.id,problemIds:[created.data.id]},teacher);assert.equal(group.status,201);assert.equal(group.data.problemIds[0],created.data.id);
   assert(!(await request('/problem-groups','GET',null,learner)).data.items.some(g=>g.id===group.data.id));assert.equal((await request('/problem-groups','POST',{name:'越权公开引用',problemIds:[created.data.id]},teacher)).status,400);
   const assigned=await request('/assignments','POST',{title:'私有题作业',classId:cls.data.id,dueAt:new Date(Date.now()+60000).toISOString(),problems:[{problemId:created.data.id,points:100}],participants:[p.person.id]},teacher);assert.equal(assigned.status,201);assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,learner)).status,200);
   assert((await request('/teachers','GET',null,teacher)).data.items.some(i=>i.id===otherPerson.person.id));assert.equal((await request('/teachers','GET',null,learner)).status,403);
   const publicGroup=await request('/problem-groups','POST',{name:'教师创建的公开分组',problemIds:[]},teacher);assert.equal(publicGroup.status,201);
   assert.equal((await request(`/accounts/${teacher.data.user.id}`,'PATCH',{roles:['student']},admin)).status,200);const removed=await login('teacher-a');assert.equal((await request(`/problems/${created.data.id}`,'GET',null,removed)).status,404);assert.equal((await request(`/problem-groups/${publicGroup.data.id}`,'PATCH',{name:'已撤销角色不能编辑'},removed)).status,403);assert.equal((await request('/problem-groups','GET',null,removed)).data.items.find(g=>g.id===publicGroup.data.id).canEdit,false);
   await request(`/accounts/${teacher.data.user.id}`,'PATCH',{roles:['teacher']},admin);Object.assign(teacher,await login('teacher-a'));
  });
  await t.test('group move is atomic, permission scoped, retry safe and rollback protects all memberships',async()=>{
   const make=async(name,problemIds=[])=>{const r=await request('/problem-groups','POST',{bankId:privateBank.id,name,problemIds},teacher);assert.equal(r.status,201);return r.data;};
   const source=await make('原子来源',[privateProblem.id]),first=await make('原子目标一'),second=await make('原子目标二');
   const body={bankId:privateBank.id,sourceGroupId:source.id,targetGroupIds:[first.id,second.id],problemIds:[privateProblem.id]};
   assert.equal((await request('/problem-groups/move','POST',body)).status,401);
   assert.equal((await request('/problem-groups/move','POST',{...body,targetGroupIds:[source.id]},teacher)).status,400);
   const other=await request('/problem-groups','POST',{name:'跨题库目标',problemIds:[]},teacher);assert.equal(other.status,201);
   assert.equal((await request('/problem-groups/move','POST',{...body,targetGroupIds:[other.data.id]},teacher)).status,400);
   const memberships=async()=>new Map((await pool.query('SELECT group_id,array_agg(problem_id) ids FROM problem_group_members WHERE group_id=ANY($1::uuid[]) GROUP BY group_id',[[source.id,first.id,second.id]])).rows.map(r=>[r.group_id,r.ids]));
   // Force a failure after the first target insert to exercise actual PostgreSQL rollback.
   await pool.query(`CREATE FUNCTION reject_move_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.group_id='${second.id}'::uuid THEN RAISE EXCEPTION 'injected transaction failure'; END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER reject_move_target BEFORE INSERT ON problem_group_members FOR EACH ROW EXECUTE FUNCTION reject_move_target()');
   try{assert.equal((await request('/problem-groups/move','POST',body,teacher)).status,500);const rows=await memberships();assert(rows.get(source.id).includes(privateProblem.id));assert(!rows.has(first.id));assert(!rows.has(second.id));}
   finally{await pool.query('DROP TRIGGER reject_move_target ON problem_group_members');await pool.query('DROP FUNCTION reject_move_target()');}
   const moved=await request('/problem-groups/move','POST',body,teacher);assert.equal(moved.status,200,JSON.stringify(moved.data));const rows=await memberships();assert(!rows.has(source.id));assert(rows.get(first.id).includes(privateProblem.id));assert(rows.get(second.id).includes(privateProblem.id));
   const retry=await request('/problem-groups/move','POST',body,teacher);assert.equal(retry.status,200);assert.equal(retry.data.alreadyMoved,true);
   const blocked=await request('/problem-groups','POST',{name:'管理员只读目标',bankId:privateBank.id,problemIds:[]},admin);assert.equal(blocked.status,201);
   const missing=randomUUID();assert.equal((await request('/problem-groups/move','POST',{...body,sourceGroupId:missing},teacher)).status,404);
  });
  await t.test('problem import partial results and queued drafts are atomically idempotent',async()=>{
   const body={bankId:privateBank.id,idempotencyKey:randomUUID(),rows:[{...input,title:'批量题一'},{...input,title:'无合法测试',tests:[]}]};
   const first=await request('/problems/import','POST',body,teacher);assert.equal(first.status,200);assert.deepEqual(first.data.summary,{created:1,failed:1,total:2});const count=(await pool.query('SELECT count(*)::int n FROM problems')).rows[0].n;
   const replay=await request('/problems/import','POST',body,teacher);assert.deepEqual(replay.data,first.data);assert.equal((await pool.query('SELECT count(*)::int n FROM problems')).rows[0].n,count);
   assert.equal((await request('/problems/import','POST',{...body,rows:[{...input,title:'不同内容'}]},teacher)).status,409);assert(!first.data.items[0].problem.published);assert.equal(first.data.items[0].problem.validationStatus,'Waiting');
  });
  await t.test('private timed questions cannot bypass feedback embargo through free practice, corrections or notebook status',async()=>{
   const learner=await login(student.data.user.username,'Concurrent-reset-pass-2026');const bank=await request('/problem-banks','POST',{name:'训练前曾公开的题库',visibility:'school'},admin);assert.equal(bank.status,201);assert.equal((await request(`/problem-banks/${bank.data.id}/permissions`,'POST',{identityId:teacherPerson.person.id,permission:'edit'},admin)).status,200);const created=await request('/problems','POST',{...input,bankId:bank.data.id,title:'私有计时专用题'},teacher);assert.equal(created.status,201);await pool.query("UPDATE problem_versions SET validation_status='AC' WHERE id=$1",[created.data.versionId]);await request(`/problems/${created.data.id}/publish`,'POST',{versionId:created.data.versionId},teacher);assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'approved'},admin)).status,200);
   const historical=await request('/submissions','POST',{problemId:created.data.id,versionId:created.data.versionId,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()},learner);assert.equal(historical.status,201);await pool.query("UPDATE submissions SET status='WA',score=0,passed=0,total=1 WHERE id=$1",[historical.data.id.slice(3)]);await pool.query("UPDATE judge_tasks SET state='completed' WHERE submission_id=$1",[historical.data.id.slice(3)]);
   const blockedDemotion=await request(`/problem-banks/${bank.data.id}`,'PATCH',{visibility:'private'},admin);assert.equal(blockedDemotion.status,409);assert.equal(blockedDemotion.data.error.code,'REVOKE_PUBLIC_VERSIONS');
   assert.equal((await request(`/problems/${created.data.id}/rank-review`,'PATCH',{versionId:created.data.versionId,decision:'revoked',reason:'训练改为私有前撤下公开版'},admin)).status,200);
   assert.equal((await request(`/problem-banks/${bank.data.id}`,'PATCH',{visibility:'private'},admin)).status,200);
   assert.equal((await request(`/classes/${cls.data.id}/members`,'POST',{identityIds:[otherPerson.person.id]},admin)).status,200);const unstarted=await login('student-other');
   const practice=await request('/timed-practices','POST',{title:'隐藏反馈训练',classId:cls.data.id,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+120000).toISOString(),durationMinutes:1,showVerdict:false,problems:[{problemId:created.data.id,points:100}],participants:[p.person.id,otherPerson.person.id]},teacher);assert.equal(practice.status,201,JSON.stringify(practice.data));assert.equal((await request(`/timed-practices/${practice.data.id}/publish`,'POST',{},teacher)).status,200);
   assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,learner)).status,404);
   assert.equal((await request(`/timed-practices/${practice.data.id}/start`,'POST',{},learner)).status,200);assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,learner)).status,200);
   assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,unstarted)).status,404);const oldCorrection={problemId:created.data.id,kind:'correction',originalSubmissionId:historical.data.id,code:'print(3)',idempotencyKey:randomUUID()};assert.equal((await request('/submissions','POST',oldCorrection,learner)).status,403,'a historical ordinary submission must not bypass current timed-only execution rights');
   const submit={problemId:created.data.id,versionId:created.data.versionId,kind:'submit',code:'print(3)',idempotencyKey:randomUUID()};assert.equal((await request('/submissions','POST',submit,learner)).status,403);
   const accepted=await request('/submissions','POST',{...submit,timedPracticeId:practice.data.id,idempotencyKey:randomUUID()},learner);assert.equal(accepted.status,201,JSON.stringify(accepted.data));await pool.query("UPDATE submissions SET status='AC',score=100,passed=1,total=1 WHERE id=$1",[accepted.data.id.slice(3)]);await pool.query("UPDATE judge_tasks SET state='completed' WHERE submission_id=$1",[accepted.data.id.slice(3)]);
   const hidden=await request(`/submissions/${accepted.data.id}`,'GET',null,learner);assert.equal(hidden.data.status,'AC');assert.equal(hidden.data.score,null);
   assert.equal((await request('/review-notebook','POST',{submissionId:accepted.data.id,note:'训练笔记'},learner)).status,201);const note=(await request('/review-notebook','GET',null,learner)).data.items.find(n=>n.submissionId===accepted.data.id);assert.equal(note.status,'AC');
   assert.equal((await request('/submissions','POST',{problemId:created.data.id,kind:'correction',originalSubmissionId:accepted.data.id,code:'print(3)',idempotencyKey:randomUUID()},learner)).status,409);
   assert.equal((await request(`/timed-practices/${practice.data.id}/end`,'POST',{reason:'教师结束课堂练习'},teacher)).status,200);assert.equal((await request('/submissions','POST',{...submit,idempotencyKey:randomUUID()},learner)).status,403);
   assert.equal((await request(`/timed-practices/${practice.data.id}/results`,'POST',{},teacher)).status,200);const visible=await request(`/submissions/${accepted.data.id}`,'GET',null,learner);assert.equal(visible.data.score,100);assert.equal(visible.data.status,'AC');assert.equal((await request('/submissions','POST',{...submit,idempotencyKey:randomUUID()},learner)).status,201);assert.equal((await request('/submissions','POST',{...oldCorrection,idempotencyKey:randomUUID()},learner)).status,201);assert.equal((await request(`/problems/${created.data.id}?versionId=${created.data.versionId}`,'GET',null,unstarted)).status,200);assert((await request('/problems','GET',null,unstarted)).data.items.some(p=>p.id===created.data.id),'published results authorize participant review even without an attempt');
  });
  await t.test('assignment exemptions and deadline extensions are authorized, explicit and audited',async()=>{
   const learner=await login(student.data.user.username,'Concurrent-reset-pass-2026');assert.equal((await request(`/assignments/${a.data.id}/participants/${p.person.id}`,'PATCH',{exempt:true,reason:'不参加'},teacher)).status,409);
   assert.equal((await request(`/assignments/${a.data.id}/extend`,'POST',{dueAt:new Date(Date.now()+120000).toISOString(),reason:'补课延期'},teacher)).status,200);
   const exempt=await request(`/assignments/${a.data.id}/participants/${p.person.id}`,'PATCH',{exempt:true,reason:'健康原因'},teacher);assert.equal(exempt.status,200);assert.equal(exempt.data.grades.length,0);assert(exempt.data.participantDetails[0].exempt);
   assert.equal((await request(`/assignments/${a.data.id}`,'GET',null,learner)).status,403);
   assert.equal((await request(`/assignments/${a.data.id}/participants/${p.person.id}`,'PATCH',{exempt:false,reason:'恢复参加'},teacher)).status,200);
   assert.equal((await request(`/assignments/${a.data.id}/extend`,'POST',{dueAt:new Date(Date.now()+180000).toISOString(),reason:'自行延期'},learner)).status,403);
  });
  await t.test('teacher member import creates only students, rejects outsiders and retries without reissuing credentials',async()=>{
   const destination=await request('/classes','POST',{name:'教师导入目标班'},teacher);assert.equal(destination.status,201);
   const body={idempotencyKey:randomUUID(),rows:[{number:'NEW-IN-CLASS',name:'新建学生'},{number:p.person.number,name:'学生一新名'},{number:otherPerson.person.number,name:'冒用姓名'}]};
   const first=await request(`/classes/${destination.data.id}/import-members`,'POST',body,teacher);assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual(first.data.summary,{created:1,added:1,skipped:0,failed:1,total:3});assert(first.data.items[0].activationCode);assert.equal(first.data.items[0].person.kind,'student');assert(!first.data.items[1].activationCode);assert(!first.data.items[2].person);assert(first.data.items[0].person.classes.some(c=>c.id===destination.data.id));
   const cached=(await pool.query('SELECT * FROM member_import_batches WHERE idempotency_key=$1',[body.idempotencyKey])).rows[0];assert(!cached.result_ciphertext.includes(first.data.items[0].activationCode));assert(!JSON.stringify(cached.nonsecret_result).includes(first.data.items[0].activationCode));
   const count=(await pool.query('SELECT count(*)::int n FROM activation_tokens')).rows[0].n;assert.deepEqual((await request(`/classes/${destination.data.id}/import-members`,'POST',body,teacher)).data,first.data);assert.equal((await pool.query('SELECT count(*)::int n FROM activation_tokens')).rows[0].n,count);
   assert.equal((await request(`/classes/${destination.data.id}/import-members`,'POST',{...body,rows:[{number:'DIFFERENT',name:'不同学生'}]},teacher)).status,409);
   const outsider=await person('student','OUTSIDE-IMPORT','不属于教师的学生');const denied=await request(`/classes/${destination.data.id}/import-members`,'POST',{idempotencyKey:randomUUID(),rows:[{number:outsider.person.number,name:outsider.person.name}]},teacher);assert.equal(denied.data.summary.failed,1);assert(!denied.data.items[0].person);assert(!(await pool.query('SELECT 1 FROM class_members WHERE class_id=$1 AND identity_id=$2',[destination.data.id,outsider.person.id])).rowCount);
   const otherClass=await request('/classes','POST',{name:'教师无权限班'},admin);assert.equal((await request(`/classes/${otherClass.data.id}/import-members`,'POST',{idempotencyKey:randomUUID(),rows:[{number:'NO-CREATE',name:'无权建档'}]},teacher)).status,403);assert(!(await pool.query("SELECT 1 FROM identities WHERE number='NO-CREATE'")).rowCount);
   await pool.query("UPDATE member_import_batches SET replay_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[cached.id]);const expired=(await request(`/classes/${destination.data.id}/import-members`,'POST',body,teacher)).data;assert(!expired.items[0].activationCode);assert(expired.items[0].activationUnavailable);assert.equal((await pool.query('SELECT result_ciphertext FROM member_import_batches WHERE id=$1',[cached.id])).rows[0].result_ciphertext,null);
   assert((await pool.query("SELECT 1 FROM audit_events WHERE action='class.members_import' AND resource_id=$1",[destination.data.id])).rowCount);
  });
  await t.test('audited rejudge preserves current grade until confirmation and failed candidates can be discarded',async()=>{
   const running=await request(`/submissions/${sub.data.id}/rejudge`,'POST',{reason:'重判测试'},admin);assert.equal(running.status,409,'an original queued task must finish first');
   await pool.query("UPDATE judge_tasks SET state='completed' WHERE submission_id=$1",[sub.data.id.slice(3)]);
   const accepted=await request(`/submissions/${sub.data.id}/rejudge`,'POST',{reason:'修订运行环境'},admin);assert.equal(accepted.status,200);assert.equal(accepted.data.originalScore,40);
   const run=(await pool.query("INSERT INTO judge_runs(task_id,lease_id,submission_id,version_id,status,score,passed,total,environment_version) VALUES($1,$2,$3,$4,'AC',100,1,1,'integration') RETURNING id",[accepted.data.taskId,randomUUID(),sub.data.id.slice(3),draft.data.versionId])).rows[0];await pool.query('UPDATE submissions SET pending_judge_run_id=$1 WHERE id=$2',[run.id,sub.data.id.slice(3)]);await pool.query("UPDATE judge_tasks SET state='completed' WHERE id=$1",[accepted.data.taskId]);
   assert.equal((await request(`/submissions/${sub.data.id}`,'GET',null,admin)).data.score,40);assert.equal((await request(`/assignments/${a.data.id}`,'GET',null,teacher)).data.grades[0].score,20);
   assert.equal((await request(`/submissions/${sub.data.id}/rejudge-confirm`,'POST',{runId:run.id},admin)).status,200);assert.equal((await request(`/assignments/${a.data.id}`,'GET',null,teacher)).data.grades[0].score,50);
   const second=await request(`/submissions/${sub.data.id}/rejudge`,'POST',{reason:'失败运行验证'},admin);const fault=(await pool.query("INSERT INTO judge_runs(task_id,lease_id,submission_id,version_id,status,environment_version) VALUES($1,$2,$3,$4,'System Error','integration') RETURNING id",[second.data.taskId,randomUUID(),sub.data.id.slice(3),draft.data.versionId])).rows[0];await pool.query('UPDATE submissions SET pending_judge_run_id=$1 WHERE id=$2',[fault.id,sub.data.id.slice(3)]);await pool.query("UPDATE judge_tasks SET state='failed' WHERE id=$1",[second.data.taskId]);
   assert.equal((await request(`/submissions/${sub.data.id}/rejudge-confirm`,'POST',{runId:fault.id},admin)).status,409);assert.equal((await request(`/submissions/${sub.data.id}/rejudge-discard`,'POST',{runId:fault.id,reason:'恢复执行器后再评测'},admin)).status,200);assert.equal((await request(`/submissions/${sub.data.id}`,'GET',null,admin)).data.score,100);assert.equal((await pool.query('SELECT count(*)::int n FROM judge_runs WHERE submission_id=$1',[sub.data.id.slice(3)])).rows[0].n,2);
  });
  await t.test('identity rebind revokes old credentials while preserving grades, submissions, notes and teaching ownership',async()=>{
   const learner=await login(student.data.user.username,'Concurrent-reset-pass-2026');assert.equal((await request(`/people/${admin.data.user.identityId}/unbind`,'POST',{},admin)).status,409);
   const released=await request(`/people/${p.person.id}/unbind`,'POST',{},admin);assert.equal(released.status,200);assert.equal(released.data.person.activated,false);assert.equal((await request('/auth/me','GET',null,learner)).status,401);
   const reclaimed=await request('/auth/register','POST',{kind:'student',number:'S001',name:'学生一新名',activationCode:released.data.activationCode,username:'student-reclaimed',password:'Reclaimed-pass-2026'});assert.equal(reclaimed.status,201,JSON.stringify(reclaimed.data));assert.equal(reclaimed.data.user.identityId,p.person.id);assert.notEqual(reclaimed.data.user.id,learner.data.user.id);
   assert.equal((await request(`/submissions/${sub.data.id}`,'GET',null,reclaimed)).status,200);assert((await request('/submissions','GET',null,reclaimed)).data.items.some(s=>s.id===sub.data.id));assert((await request('/review-notebook','GET',null,reclaimed)).data.items.some(n=>n.note==='请检查输入边界'));assert.equal((await request(`/assignments/${a.data.id}`,'GET',null,reclaimed)).data.grades[0].score,50);
   assert.equal((await request('/submissions','POST',{problemId:draft.data.id,kind:'correction',originalSubmissionId:sub.data.id,code:'print(3)',idempotencyKey:randomUUID()},reclaimed)).status,201);
   assert.equal((await request('/auth/profile','PATCH',{email:'teacher@school.test'},teacher)).status,200);const oldTeacherId=teacher.data.user.id;const teacherRelease=await request(`/people/${teacherPerson.person.id}/unbind`,'POST',{},admin);assert.equal(teacherRelease.status,200);
   const newTeacher=await request('/auth/register','POST',{kind:'teacher',number:'T001',name:'教师一',activationCode:teacherRelease.data.activationCode,username:'teacher-reclaimed',password:'Reclaimed-pass-2026'});assert.equal(newTeacher.status,201,JSON.stringify(newTeacher.data));assert.equal(newTeacher.data.user.email,'teacher@school.test');assert.equal((await request('/auth/me','GET',null,teacher)).status,401);
   const owned=await request(`/problems/${privateProblem.id}`,'GET',null,newTeacher);assert.equal(owned.status,200);assert(owned.data.canEdit);assert('tests'in owned.data);assert((await request('/classes','GET',null,newTeacher)).data.items.some(c=>c.id===cls.data.id));assert.equal((await request(`/accounts/${oldTeacherId}`,'PATCH',{disabled:false},admin)).status,409);
   const old=(await pool.query('SELECT disabled_at,binding_released_at FROM accounts WHERE id=$1',[oldTeacherId])).rows[0];assert(old.disabled_at&&old.binding_released_at);
  });
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
