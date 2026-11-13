import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { bootstrap } from '../src/bootstrap.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../src/schools.mjs';
import { listPublicProblems } from '../src/school-practice.mjs';

test('public problem discovery batches current publications without writing judge snapshots',
 { skip: !process.env.TEST_DATABASE_URL, timeout: 120000 }, async t => {
 const base = new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
 assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager = createPool(base.href), schema = 'public_problem_list_' + randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const scoped = new URL(base);
 scoped.searchParams.set('options', `-csearch_path=${schema}`);
 const owner = createPool(scoped.href);
 let runtime;
 try {
  await migrate(owner);
  await bootstrap(owner, { name: 'List owner', number: 'PUBLIC-LIST', username: 'public-list-owner', password: randomBytes(24).toString('base64url') });
  const author = (await owner.query("SELECT id FROM accounts WHERE username='public-list-owner'")).rows[0];
  const person = async name => {
   const identity = (await owner.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$1) RETURNING id", [name])).rows[0];
   const account = (await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity.id, name, 'unusable-test-hash'])).rows[0];
   await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [account.id]);
   return { id: account.id, identityId: identity.id, roles: ['student'] };
  };
  const learner = await person('public-list-learner'), other = await person('public-list-other');
  await owner.query("SELECT set_config('campus.school_id',$1,false)", [LEGACY_SCHOOL_ID]);
  const bank = (await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility) VALUES($1,'Searchable source bank','school') RETURNING id", [author.id])).rows[0];
  const archivedBank = (await owner.query("INSERT INTO problem_banks(owner_account_id,name,visibility,archived_at) VALUES($1,'Archived source','school',now()) RETURNING id", [author.id])).rows[0];
  const snapshotBank = (await owner.query(`INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,request_id)
   VALUES($1,$3,$2,'Public practice',$3) RETURNING id`, [LEGACY_SCHOOL_ID, author.id, '00000000-0000-4000-8000-000000000074'])).rows[0];
  const problems = [];
  async function addProblem(index, { hidden = null } = {}) {
   const problem = (await owner.query(`INSERT INTO problems(bank_id,owner_account_id,owner_scope)
    VALUES($1,$2,'platform') RETURNING id`, [hidden === 'bank-archived' ? archivedBank.id : bank.id, author.id])).rows[0];
   const versions = [];
   for (let edition = 1; edition <= 3; edition++) {
    const tags=hidden?[`Hidden ${hidden}`]:edition===3?['Unpublished topic']:edition===1?['Old topic']
     :['Common',index===52?'Tail topic':index%2?'Odd':'Even'];
    versions.push((await owner.query(`INSERT INTO problem_versions(problem_id,title,statement,mode,comparator,reference_code,samples,metadata,tags,time_limit_ms,memory_limit_mb,validation_status)
     VALUES($1,$2,$3,$7,'tokens','PRIVATE_REFERENCE',$4,$5,$6,1000,128,'AC') RETURNING id`,
     [problem.id, edition === 3 ? `Private draft ${index}` : `Published ${String(index).padStart(3, '0')} edition ${edition}`,
      'PRIVATE_STATEMENT_PROSE'.repeat(200), JSON.stringify([{input:'PUBLIC_SAMPLE',expected:'1',enabled:true}]),
      {difficulty:'easy',teacherNote:'PRIVATE_TEACHER_NOTE'},JSON.stringify(tags),edition===2&&index%2?'function':'stdio'])).rows[0]);
    await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'PRIVATE_HIDDEN_TEST','1',100)", [versions.at(-1).id]);
    if (edition < 3) await owner.query(`UPDATE problem_versions SET published_at=now()+$2*interval '1 second',
     school_visible_at=now(),rank_review_status='approved',rank_approved_at=now() WHERE id=$1`, [versions.at(-1).id, edition]);
   }
   await owner.query('UPDATE problems SET current_version_id=$2,archived_at=CASE WHEN $3 THEN now() END WHERE id=$1', [problem.id, versions[2].id, hidden === 'archived']);
   // Publication audit FKs require its old judge snapshot. The live edition is
   // deliberately absent: reading the catalogue must never materialize it.
   await owner.query(`INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id)
    VALUES($1,$2,$3,$4,'{}',$2)`, [LEGACY_SCHOOL_ID, problem.id, snapshotBank.id, author.id]);
   await owner.query(`INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition)
    VALUES($1,$2,$3,1,$4)`, [LEGACY_SCHOOL_ID, versions[0].id, problem.id, {
     title:`Historical ${index}`,statement:'PRIVATE_OLD_SNAPSHOT',mode:'stdio',comparator:'tokens',samples:[],tests:[],reference_code:'PRIVATE_OLD_REFERENCE',
    }]);
   await owner.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2', [LEGACY_SCHOOL_ID, problem.id, versions[0].id]);
   await owner.query(`INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by,approved_at,withdrawn_at)
    VALUES($1,$2,$3,$4,now()-$5*interval '1 second',CASE WHEN $6 THEN now() END)`,
    [LEGACY_SCHOOL_ID, problem.id, versions[0].id, author.id, index, hidden === 'withdrawn']);
   if (hidden === 'statement-pending') await owner.query(`INSERT INTO problem_public_statements
    (version_id,language,statement,metadata,source_hash,content_hash,author_account_id,reviewer_account_id)
    VALUES($1,'en','Reviewed old statement','{}',$2,$2,$3,$3)`, [versions[0].id, 'a'.repeat(64), author.id]);
   const item = { ...problem, originalVersionId:versions[0].id, versionId:versions[1].id, draftVersionId:versions[2].id, index, hidden };
   problems.push(item);
   return item;
  }
  for (let index = 0; index < 53; index++) await addProblem(index);
  for (const [offset, hidden] of ['archived','bank-archived','withdrawn','statement-pending','timed'].entries()) await addProblem(53 + offset, { hidden });
  for (const versionId of [problems[4].originalVersionId, problems[4].versionId]) await owner.query(`INSERT INTO problem_public_statements
   (version_id,language,statement,metadata,source_hash,content_hash,author_account_id,reviewer_account_id)
   VALUES($1,'en','Reviewed English statement','{}',$2,$2,$3,$3)`, [versionId, 'b'.repeat(64), author.id]);
  const timed = problems.find(problem => problem.hidden === 'timed');
  const schoolClass = (await owner.query("INSERT INTO classes(name,owner_account_id) VALUES('Private timed class',$1) RETURNING id", [author.id])).rows[0];
  const practice = (await owner.query(`INSERT INTO timed_practices(title,class_id,owner_account_id,starts_at,ends_at,duration_minutes)
   VALUES('Private timed activity',$1,$2,now(),now()+interval '1 hour',60) RETURNING id`, [schoolClass.id, author.id])).rows[0];
  await owner.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,1)', [practice.id, timed.id, timed.originalVersionId]);

  const submission = async (user, problem, versionId, status, kind = 'submit') => owner.query(`INSERT INTO submissions
   (account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash,status,score)
   VALUES($1,$2,$3,$4,$5,'PRIVATE_STUDENT_CODE',$6,'fixture',$7,$8)`,
   [user.id,user.identityId,problem.id,versionId,kind,randomUUID(),status,status==='AC'?100:0]);
  const job = async (user, problem, access, status, kind = 'submit', state = 'completed') => owner.query(`INSERT INTO school_judge_jobs
   (school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload,state,result)
   VALUES($1,$2,$3,$4,$5,'fixture',$6,$7,$8,$10,$9)`,
   [LEGACY_SCHOOL_ID,problem.id,problem.originalVersionId,user.id,randomUUID(),kind,access,
    {language:'python',code:'PRIVATE_PUBLIC_CODE'}, state==='completed'?{status,score:status==='AC'?100:0}:null,state]);
  await submission(learner, problems[0], problems[0].originalVersionId, 'AC');
  await submission(learner, problems[0], problems[0].versionId, 'WA');
  await job(learner, problems[0], 'public', 'WA');
  await job(learner, problems[0], 'public', 'AC', 'samples');
  await job(learner, problems[1], 'school', 'AC');
  await job(learner, problems[1], 'public', 'WA');
  await job(learner, problems[2], 'public', 'AC');
  await submission(other, problems[3], problems[3].versionId, 'AC');
  await job(other, problems[3], 'public', 'AC');
  const filteredStatuses=['WA','CE','RE','TLE','MLE','OLE','Waiting','Judging','Executed','System Error'];
  for(const [offset,status] of filteredStatuses.entries())await job(learner,problems[offset+5],'public',status,'submit',
   status==='Waiting'?'queued':status==='Judging'?'leased':status==='System Error'?'failed':'completed');
  await submission(learner,problems[52],problems[52].originalVersionId,'AC');
  for(const index of [1,52,53,55])await owner.query('INSERT INTO problem_favorites(identity_id,problem_id) VALUES($1,$2)',[learner.identityId,problems[index].id]);
  await owner.query('INSERT INTO problem_favorites(identity_id,problem_id) VALUES($1,$2)',[other.identityId,problems[2].id]);

  const course = (await owner.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,published_at)
   VALUES($1,'Current catalogue course','platform',now()) RETURNING id`, [author.id])).rows[0];
  await owner.query("INSERT INTO platform_course_rules(course_id,rule_key,target_kind) VALUES($1,'all','all')", [course.id]);
  const chapter = (await owner.query(`INSERT INTO learning_chapters(path_id,title,content,checkpoint_answer,position)
   VALUES($1,'Lesson','PRIVATE_COURSE_BODY','PRIVATE_COURSE_ANSWER',0) RETURNING id`, [course.id])).rows[0];
  for (const problem of problems.slice(0, 4)) await owner.query('INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position) VALUES($1,$2,$3,$4)', [chapter.id,problem.id,problem.originalVersionId,problem.index]);
  const grants = (await readFile(new URL('../grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
  assert.ok(grants);
  await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
  const runtimeUrl = new URL(scoped);
  runtimeUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
  runtime = createPool(runtimeUrl.href);
  assert.equal((await runtime.query('SELECT current_user AS role')).rows[0].role, 'campus_app');
  let trace = [];
  const measured = { connect: async () => {
   const db = await runtime.connect();
   return { release: () => db.release(), query: async (sql, values) => {
    assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i, 'catalogue must not write judge snapshots');
    const result = await db.query(sql, values), json = JSON.stringify(result.rows);
    trace.push({sql,bytes:Buffer.byteLength(json),privateContent:/PRIVATE_/.test(json)});
    return result;
   }};
  }};
  const call = async (query, user = learner) => {
   trace = [];
   const start = performance.now(), body = await listPublicProblems(measured, user, new URL('/practice/problems?' + query, 'http://public-list.test'));
   return {body,trace:[...trace],ms:Math.round(performance.now()-start)};
  };
  const assertReadOnly = request => {
   assert.ok(request.trace.every(row => !/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(row.sql)), 'catalogue must not write judge snapshots');
   assert.ok(request.trace.every(row => !row.privateContent), 'catalogue must not load private bodies, answers, tests or student code: ' + request.trace.filter(row => row.privateContent).map(row => row.sql).join('\n'));
   assert.doesNotMatch(JSON.stringify(request.body), /PRIVATE_/);
  };
  const first = await call('page=1&includeCourseFilters=1');
  await t.test('one page is bounded, read-only and uses the current approved publication', async () => {
   assert.equal(first.body.items.length, 50);
   assert.equal(first.body.page, 1);
   assert.equal(first.body.hasMore, true);
   assert.equal(first.body.query, '');
   assert.deepEqual(first.body.filters,{topic:'',status:'',mode:'',savedOnly:false});
   assert.deepEqual(first.body.topics,['Common','Even','Odd','Tail topic']);
   assert.ok(first.trace.length < 70, `page required ${first.trace.length} database round trips`);
   for (const row of first.body.items) {
    const source = problems.find(problem => problem.id === row.id);
    assert.equal(source.hidden, null);
    assert.equal(row.versionId, source.versionId);
    assert.equal(row.title, `Published ${String(source.index).padStart(3, '0')} edition 2`);
    assert.equal(row.published, true);
    assert.equal(row.canManage, false);
    assert.equal(row.canManageTutorial, false);
    assert.equal(row.definition, undefined);
    assert.equal(row.mode,source.index%2?'function':'stdio');
    assert.deepEqual(row.tags,['Common',source.index%2?'Odd':'Even']);
   }
   assert.equal((await owner.query('SELECT count(*)::int n FROM school_problem_versions WHERE id=ANY($1::uuid[])', [problems.map(problem=>problem.versionId)])).rows[0].n, 0, 'discovery never materializes the new live editions');
   assertReadOnly(first);
  });
  await t.test('page boundaries and search retain only eligible publications', async () => {
   const second = await call('page=2&includeCourseFilters=1');
   assert.equal(second.body.items.length, 3);
   assert.equal(second.body.hasMore, false);
   const listed = new Set([...first.body.items, ...second.body.items].map(problem => problem.id));
   assert.equal(listed.size, 53);
   for (const source of problems) assert.equal(listed.has(source.id), !source.hidden, source.hidden ?? source.id);
   assertReadOnly(second);
   const search = await call('page=1&q=Published%20052%20edition%202&includeCourseFilters=1');
   assert.deepEqual(search.body.items.map(problem => problem.id), [problems[52].id]);
   assert.equal(search.body.query, 'Published 052 edition 2');
   assert.equal(search.body.hasMore, false);
   assertReadOnly(search);
  });
  await t.test('historical school and public achievements are shared, without other learners or sample runs', async () => {
   const byId = new Map(first.body.items.map(problem => [problem.id, problem]));
   for (const [index, attempts, solved] of [[0,3,true],[1,2,true],[2,1,true],[3,0,false]]) {
    assert.equal(byId.get(problems[index].id).attempts, attempts);
    assert.equal(byId.get(problems[index].id).solved, solved);
   }
   const foreign = await call(`page=1&q=${problems[0].id}`, other);
   assert.equal(foreign.body.items[0].attempts, 0);
   assert.equal(foreign.body.items[0].solved, false);
  });
  await t.test('course filtering follows latest versions without loading course prose or snapshot bodies', async () => {
   assert.deepEqual(first.body.courses.map(item => item.id), [course.id]);
   const filtered = await call(`page=1&includeCourseFilters=1&courseId=${course.id}`);
   assert.equal(filtered.body.courseId, course.id);
   assert.deepEqual(new Set(filtered.body.items.map(problem => problem.id)), new Set(problems.slice(0,4).map(problem=>problem.id)));
   assert.equal(filtered.body.hasMore, false);
   assert.deepEqual(filtered.body.topics,['Common','Even','Odd']);
   assertReadOnly(filtered);
   assert.ok(first.trace.length <= filtered.trace.length + 12, 'returning fifty rows must not add one database request per row');
  });
  await t.test('topic and interface filters reach later pages and retain complete accessible topic choices',async()=>{
   const tail=await call('page=1&topic=Tail%20topic');
   assert.deepEqual(tail.body.items.map(item=>item.id),[problems[52].id]);
   assert.equal(tail.body.hasMore,false);
   assert.deepEqual(tail.body.topics,first.body.topics);
   assert.equal(tail.body.filters.topic,'Tail topic');
   assertReadOnly(tail);
   const mode=await call('page=1&mode=function');
   assert.deepEqual(new Set(mode.body.items.map(item=>item.id)),new Set(problems.filter(item=>!item.hidden&&item.index%2).map(item=>item.id)));
   assert.equal(mode.body.filters.mode,'function');
   assert.deepEqual(mode.body.topics,first.body.topics);
   assertReadOnly(mode);
   const empty=await call(`page=1&courseId=${course.id}&topic=Tail%20topic&status=WA&mode=function`);
   assert.deepEqual(empty.body.items,[]);
   assert.deepEqual(empty.body.topics,['Common','Even','Odd']);
   assertReadOnly(empty);
  });
  await t.test('status filters share historical AC, ignore other learners and apply before pagination',async()=>{
   const accepted=await call('page=1&status=AC');
   assert.deepEqual(accepted.body.items.map(item=>item.id),[0,1,2,52].map(index=>problems[index].id));
   assert(accepted.body.items.every(item=>item.status==='AC'&&item.solved));
   assert.deepEqual(accepted.body.topics,first.body.topics);
   assertReadOnly(accepted);
   for(const [offset,status] of filteredStatuses.entries()){
    const request=await call('page=1&status='+encodeURIComponent(status));
    assert.deepEqual(request.body.items.map(item=>item.id),[problems[offset+5].id],status);
    assert.equal(request.body.items[0].status,status);
    assertReadOnly(request);
   }
   const unstarted=await call('page=1&status=Not%20started');
   assert(unstarted.body.items.some(item=>item.id===problems[3].id),'another learner\'s AC must not change this learner\'s status');
   assert(unstarted.body.items.every(item=>item.status==='Not started'&&!item.solved&&item.attempts===0));
   assertReadOnly(unstarted);
   const foreign=await call('page=1&status=AC',other);
   assert.deepEqual(foreign.body.items.map(item=>item.id),[problems[3].id]);
  });
  await t.test('bookmarks are identity scoped and cannot expose private, withdrawn or unrelated course problems',async()=>{
   const saved=await call('page=1&savedOnly=1');
   assert.deepEqual(saved.body.items.map(item=>item.id),[problems[1].id,problems[52].id]);
   assert.equal(saved.body.filters.savedOnly,true);
   assert.deepEqual(saved.body.topics,first.body.topics);
   assertReadOnly(saved);
   const foreign=await call('page=1&savedOnly=1',other);
   assert.deepEqual(foreign.body.items.map(item=>item.id),[problems[2].id]);
   const combined=await call(`page=1&courseId=${course.id}&savedOnly=1&status=AC&mode=function&topic=Odd`);
   assert.deepEqual(combined.body.items.map(item=>item.id),[problems[1].id]);
   assert.deepEqual(combined.body.filters,{topic:'Odd',status:'AC',mode:'function',savedOnly:true});
   assertReadOnly(combined);
   for(const hidden of problems.filter(item=>item.hidden)){
    const request=await call('page=1&topic='+encodeURIComponent(`Hidden ${hidden.hidden}`));
    assert.deepEqual(request.body.items,[]);
    assert.deepEqual(request.body.topics,first.body.topics);
   }
  });
  await t.test('invalid filter values are rejected without broadening discovery',async()=>{
   for(const query of ['status=unknown','mode=script','topic='+encodeURIComponent('x'.repeat(201))]){
    await assert.rejects(call(query),error=>error.status===400);
   }
  });
  await t.test('status filtering switches native school scopes without mixing learners or exposing private snapshots',async()=>{
   const native=[];
   for(const [name,status] of [['alpha','AC'],['beta','WA']]){
    const school=await provisionSchool(owner,{slug:`filter-${name}`,name:`Filter ${name}`,adminUsername:'public-list-owner'});
    const db=await owner.connect();
    try{
     await db.query('BEGIN');
     await db.query("SELECT set_config('campus.school_id',$1,true)",[school.id]);
     const {rows:[bank]}=await db.query(`INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id)
      VALUES($1,$2,'Native filter bank',$3) RETURNING id`,[school.id,author.id,randomUUID()]);
     await db.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'student')",[school.id,learner.id]);
     const {rows:[identity]}=await db.query(`INSERT INTO school_identities(school_id,kind,number,name,account_id)
      VALUES($1,'student','FILTER','Filter learner',$2) RETURNING id`,[school.id,learner.id]);
     const definition={title:`NativeFilter ${name}`,mode:'stdio',tags:[`Native ${name}`],statement:'PRIVATE_NATIVE_STATEMENT',reference_code:'PRIVATE_NATIVE_REFERENCE',tests:[{input:'PRIVATE_NATIVE_CASE'}]};
     const {rows:[problem]}=await db.query(`INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[school.id,bank.id,author.id,definition,randomUUID()]);
     const {rows:[version]}=await db.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
      VALUES($1,$2,1,$3) RETURNING id`,[school.id,problem.id,definition]);
     await db.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[school.id,problem.id,version.id]);
     await db.query(`INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by)
      VALUES($1,$2,$3,$4)`,[school.id,problem.id,version.id,author.id]);
     for(const [user,identityId,verdict,context] of [[learner,identity.id,status,'school'],[other,null,'AC','public']]){
      await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,request_id,request_hash,kind,access_context,payload,state,result)
       VALUES($1,$2,$3,$4,$5,$6,'fixture','submit',$7,'{"code":"PRIVATE_NATIVE_CODE"}','completed',$8)`,
      [school.id,problem.id,version.id,user.id,identityId,randomUUID(),context,{status:verdict,score:verdict==='AC'?100:0}]);
     }
     native.push({id:problem.id,schoolId:school.id,status});
     await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
   }
   for(const status of ['AC','WA']){
    const request=await call(`page=1&q=NativeFilter&status=${status}`);
    assert.deepEqual(request.body.items.map(item=>[item.id,item.schoolId,item.status]),native.filter(item=>item.status===status).map(item=>[item.id,item.schoolId,item.status]));
    assert(request.body.topics.includes('Native alpha')&&request.body.topics.includes('Native beta'));
    assertReadOnly(request);
   }
   const foreign=await call('page=1&q=NativeFilter&status=AC',other);
   assert.deepEqual(new Set(foreign.body.items.map(item=>item.id)),new Set(native.map(item=>item.id)));
   assertReadOnly(foreign);
   assert.equal((await runtime.query('SELECT count(*)::int n FROM school_judge_jobs')).rows[0].n,0,'request-local school scopes must not survive the transaction');
  });
  t.diagnostic(JSON.stringify({visibleProblems:53,pageSize:first.body.items.length,queries:first.trace.length,dbBytes:first.trace.reduce((sum,row)=>sum+row.bytes,0),responseBytes:Buffer.byteLength(JSON.stringify(first.body)),ms:first.ms}));
 } finally {
  await runtime?.end();
  await owner.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);
  await manager.end();
 }
});
