import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {publicStatementSourceHash} from '../../../packages/domain/src/problem-public-statements.mjs';

test('reviewed public English statements bind exact versions without leaking paid Chinese content or changing judge/student data',
 {skip:!process.env.TEST_DATABASE_URL,timeout:90000},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&/^\/campus_(qa|test)(_[a-z0-9_]+)?$/i.test(url.pathname),'Use a dedicated local QA database');
 const manager=createPool(url.href),schema=`public_statement_http_${randomBytes(6).toString('hex')}`;
 await manager.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-csearch_path=${schema}`);
 const pool=createPool(url.href);let app;
 try{
  await migrate(pool);
  const password=randomBytes(30).toString('base64url'),hash=await hashPassword(password),actors={};
  for(const [name,kind]of [['teacher','teacher'],['other','teacher'],['student','student'],['admin','admin']]){
   const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,name])).rows[0].id;
   const id=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,`statement-${name}`,hash])).rows[0].id;
   await pool.query('INSERT INTO account_roles VALUES($1,$2)',[id,kind]);actors[name]={id,identityId};
  }
  const original='原始中文题面：读取价格字符串，并截去小数部分。';
  const privateMarkers=['PRIVATE_REFERENCE_SENTINEL','PRIVATE_TEST_INPUT','PRIVATE_TEST_OUTPUT','PRIVATE_EDITORIAL_SENTINEL','PRIVATE_HINT_SENTINEL','UNPUBLISHED_TRANSLATION_SENTINEL','PRIVATE_NOTES_SENTINEL'];
  const originalMetadata={objective:'中文目标：转换整数',inputDescription:'中文输入说明',outputDescription:'中文输出说明',
   parameters:[{name:'price',type:'str',description:'中文参数说明',teacherNote:'PRIVATE_NOTES_SENTINEL'}],
   returnType:'int',difficulty:'Easy',hintPolicy:'always',editorial:'PRIVATE_EDITORIAL_SENTINEL',hints:['PRIVATE_HINT_SENTINEL'],
   translations:{'zh-CN':'UNPUBLISHED_TRANSLATION_SENTINEL'},privateNotes:'PRIVATE_NOTES_SENTINEL'};
  async function problem(owner,title,statement=original,{problemId,published=true,metadata=originalMetadata}={}){
   if(!problemId)problemId=(await pool.query('INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id',[owner.id])).rows[0].id;
   const v=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,metadata,time_limit_ms,memory_limit_mb,reference_code,starter_code,samples)
    VALUES($1,$2,'stdio',$3,$4,1000,64,'# PRIVATE_REFERENCE_SENTINEL\nprint(1)','# Your program','[{"input":"19.99","expected":"19"}]'::jsonb) RETURNING id`,
   [problemId,title,statement,metadata])).rows[0];
   await pool.query('INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,0,$2,$3,100)',[v.id,'PRIVATE_TEST_INPUT','PRIVATE_TEST_OUTPUT']);
   if(published){
    await pool.query("UPDATE problem_versions SET published_at=clock_timestamp(),school_visible_at=clock_timestamp(),rank_review_status='approved',rank_approved_at=clock_timestamp() WHERE id=$1",[v.id]);
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,v.id]);
   }
   return {problemId,versionId:v.id};
  }
  const legacy=await problem(actors.teacher,'Price conversion',original+'\n历史版说明。');
  const first=await problem(actors.teacher,'Price conversion',original,{problemId:legacy.problemId});
  const native=await problem(actors.teacher,'Native Chinese problem','本题本来就是中文，不应自动改写。',{metadata:{difficulty:'Easy'}});
  const foreign=await problem(actors.other,'Another teacher question');
  const draft=await problem(actors.teacher,'Unpublished source',original,{published:false});
  app=await createApiApplication({databaseUrl:url.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:'http://statement-luq.test',COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  function client(){
   let cookie='',csrf='';
   return async(path,{body,method=body===undefined?'GET':'POST',expected=200,badCsrf=false,language='en'}={})=>{
    const response=await fetch(base+'/api/v1'+path,{
     method,headers:{Origin:'http://statement-luq.test',Cookie:cookie,'X-CSRF-Token':badCsrf?'invalid':csrf,'Accept-Language':language,...(body===undefined?{}:{'Content-Type':'application/json'})},
     ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json();
    assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status),`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    assert.equal(response.headers.get('cache-control'),'no-store');
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    if(data.csrfToken)csrf=data.csrfToken;return data;
   };
  }
  const endpoint='/luq/public-statements',query=target=>`${endpoint}?problemId=${target.problemId}&versionId=${target.versionId}`;
  await client()(query(first),{expected:401});
  for(const [name,actor]of Object.entries(actors)){actor.call=client();await actor.call('/auth/login',{body:{username:`statement-${name}`,password}});}
  const {teacher,other,student,admin}=actors;
  await student.call(query(first),{expected:403});
  await other.call(query(first),{expected:403});
  await teacher.call(query(foreign),{expected:403});
  const sourceInfo=await teacher.call(query(first));
  const source=(await pool.query('SELECT * FROM problem_versions WHERE id=$1',[first.versionId])).rows[0];
  assert.equal(sourceInfo.sourceHash,publicStatementSourceHash(source));assert.equal(sourceInfo.presentation,null);
  assert.equal((await admin.call(query(first))).sourceHash,sourceInfo.sourceHash);
  const english='Read a price as a string. Output its integer part.\nKeep the variable `price` unchanged.';
  const metadata={objective:'Convert a price to an integer.',inputDescription:'A decimal price.',outputDescription:'Its integer part.',
   parameters:[{name:'price',type:'str',description:'The price to convert.'}],returnType:'int',difficulty:'Easy'};
  const request={...first,language:'en',statement:english,metadata,sourceHash:sourceInfo.sourceHash,reviewed:true};
  await student.call(endpoint,{body:request,expected:403});
  await other.call(endpoint,{body:request,expected:403});
  await teacher.call(endpoint,{body:request,badCsrf:true,expected:403});
  assert.equal((await teacher.call(endpoint,{body:{...request,reviewed:false},expected:400})).error.code,'REVIEW_REQUIRED');
  assert.equal((await teacher.call(endpoint,{body:{...request,sourceHash:'0'.repeat(64)},expected:409})).error.code,'SOURCE_CHANGED');
  await teacher.call(endpoint,{body:{...request,metadata:{...metadata,privateNotes:'Do not publish'}},expected:400});
  await teacher.call(endpoint,{body:{...request,metadata:{parameters:[{name:'price',teacherNote:'Do not publish'}]}},expected:400});
  const draftSource=await teacher.call(query(draft));
  assert.equal((await teacher.call(endpoint,{body:{...request,...draft,sourceHash:draftSource.sourceHash},expected:409})).error.code,'VERSION_NOT_PUBLISHED');
  assert.equal((await pool.query('SELECT count(*)::int n FROM problem_public_statements')).rows[0].n,0);

  const course=await teacher.call('/learning-paths',{body:{title:'Version-pinned English course'},expected:201});
  const chapter=await teacher.call(`/learning-paths/${course.id}/chapters`,{body:{title:'Price practice',content:'Public lesson',problemIds:[first.problemId]},expected:201});
  await teacher.call(`/learning-paths/${course.id}/publish`,{body:{}});
  const submission=(await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,code,idempotency_key,request_hash)
   VALUES($1,$2,$3,$4,'submit','price = input()\nprint(int(float(price)))',$5,'preserved') RETURNING id`,
  [student.id,student.identityId,first.problemId,first.versionId,randomUUID()])).rows[0];
  const stateSnapshot=async()=>({
   versions:(await pool.query('SELECT row_to_json(v) r FROM problem_versions v ORDER BY id')).rows,
   tests:(await pool.query('SELECT row_to_json(t) r FROM test_cases t ORDER BY id')).rows,
   submissions:(await pool.query('SELECT row_to_json(s) r FROM submissions s ORDER BY id')).rows,
   links:(await pool.query('SELECT row_to_json(p) r FROM chapter_problems p ORDER BY chapter_id,position')).rows,
  });
  const before=await stateSnapshot();
  // Distinct clients avoid any in-process serialization. Uppercase UUIDs are the same target.
  const upperRequest={...request,problemId:first.problemId.toUpperCase(),versionId:first.versionId.toUpperCase()};
  const repeated=await Promise.all([
   teacher.call(endpoint,{body:request,expected:[200,201]}),
   teacher.call(endpoint,{body:upperRequest,expected:[200,201]}),
   admin.call(endpoint,{body:request,expected:[200,201]}),
  ]);
  const firstPublished=repeated[0];
  for(const replay of repeated)assert.deepEqual(replay,firstPublished);
  assert.deepEqual(await stateSnapshot(),before,'Publishing a presentation never rewrites source/judge/student/course data');
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='problem.public_statement_publish'")).rows[0].n,1);
  assert.equal((await teacher.call(endpoint,{body:{...request,statement:'Different revision'},expected:409})).error.code,'PUBLISHED_STATEMENT_IMMUTABLE');
  await assert.rejects(pool.query("UPDATE problem_public_statements SET statement='Changed' WHERE version_id=$1",[first.versionId]),/append.only|immutable/);
  await assert.rejects(pool.query('DELETE FROM problem_public_statements WHERE version_id=$1',[first.versionId]),/append.only|immutable/);

  const privateAndChinese=[...privateMarkers,original,...['中文目标','中文输入','中文输出','中文参数']];
  function assertSafe(view){
   const serialized=JSON.stringify(view);
   for(const marker of privateAndChinese)assert.equal(serialized.includes(marker),false,`Student payload leaked ${marker}`);
  }
  function assertPending(view){
   assert.equal(view.publicStatementPending,true);
   assert.equal(view.statementLanguage,'en');
   assert.match(view.statement,/English statement.*awaiting review/);
   assert.equal(view.objective,'');assert.equal(view.inputDescription,'');assert.equal(view.outputDescription,'');
   assert.equal(view.difficulty,'');assert.equal(view.returnType,'');assert.deepEqual(view.parameters,[]);
   assertSafe(view);
  }
  for(const language of ['en','zh-CN']){
   const view=await student.call(`/problems/${first.problemId}?locale=${language}&versionId=${first.versionId}`,{language});
   assert.equal(view.statement,english);assert.equal(view.statementLanguage,'en');
   assert.equal(view.publicStatementPending,false);
   for(const [key,value]of Object.entries(metadata))assert.deepEqual(view[key],value);
   assertSafe(view);assert.equal(Object.hasOwn(view,'referenceCode'),false);assert.equal(Object.hasOwn(view,'tests'),false);
   const list=await student.call(`/problems?locale=${language}`,{language});
   assertSafe(list.items.find(item=>item.id===first.problemId));
   assert.equal(list.items.find(item=>item.id===first.problemId).statement,english);
   assert.equal(list.items.find(item=>item.id===native.problemId).statement,'本题本来就是中文，不应自动改写。');
   assertPending(await student.call(`/problems/${legacy.problemId}?versionId=${legacy.versionId}&locale=${language}`,{language}));
  }
  assert.equal((await teacher.call(`/problems/${legacy.problemId}?versionId=${legacy.versionId}`)).statement,original+'\n历史版说明。','Teachers retain the original pending historical statement');
  await student.call(`/problem-favorites/${first.problemId}`,{body:{favorite:true},method:'PUT'});
  assert.deepEqual((await student.call('/problem-favorites')).items,[first.problemId]);
  const teacherView=await teacher.call(`/problems/${first.problemId}?versionId=${first.versionId}`);
  assert.equal(teacherView.statement,original);assert.equal(teacherView.hintPolicy,'always');
  assert.equal(teacherView.objective,originalMetadata.objective);assert.equal(teacherView.privateNotes,'PRIVATE_NOTES_SENTINEL');
  assert.equal(teacherView.referenceCode,'# PRIVATE_REFERENCE_SENTINEL\nprint(1)');assert.equal(teacherView.tests[0].input,'PRIVATE_TEST_INPUT');

  // The course and historical submission keep V1 while the library advances to V2.
  const second=await problem(teacher,'Price conversion',original+'\n第二版说明。',{problemId:first.problemId});
  assertPending(await student.call(`/problems/${second.problemId}`));
  assertPending((await student.call('/problems')).items.find(item=>item.id===second.problemId));
  assert.equal((await student.call(`/problems/${first.problemId}?versionId=${first.versionId}`)).statement,english,'Publishing another version cannot remove the reviewed historical presentation');
  const secondSource=await teacher.call(query(second));
  const secondEnglish=english+'\nVersion two: preserve the input order.';
  await teacher.call(endpoint,{body:{...request,...second,sourceHash:secondSource.sourceHash,statement:secondEnglish},expected:201});
  const courseView=await student.call(`/learning-paths/${course.id}`);
  const link=courseView.chapters.find(item=>item.id===chapter.id).problems[0];
  assert.equal(link.versionId,first.versionId);assertSafe(courseView);
  assert.equal((await student.call(`/problems/${link.problemId}?versionId=${link.versionId}`)).statement,english);
  assert.equal((await student.call(`/problems/${first.problemId}`)).statement,secondEnglish);
  const history=await student.call(`/submissions/${submission.id}`);assertSafe(history);
  assert.equal(history.versionId,first.versionId);
  assertSafe(await student.call('/submissions'));
  assertSafe(await student.call('/review-notebook'));

  // Chinese remains a distinct reviewed, priced Luq item; presentation publication grants no assistance entitlement.
  const target={...first,kind:'FULL_TRANSLATION',language:'zh-CN'};
  const translated=await teacher.call('/luq/contents',{body:{...target,body:original},expected:201});
  await teacher.call(`/luq/contents/${translated.id}/publish`,{body:{reviewed:true}});
  const quote=await student.call('/luq/assistance/quote',{body:target});assert.equal(quote.price,3);assertSafe(quote);
  await student.call('/luq/assistance/provide',{body:target,expected:403});
  assert.equal((await pool.query('SELECT count(*)::int n FROM luq_assistance_entitlements')).rows[0].n,0);
  const oldBalance=Number((await pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[student.identityId])).rows[0].balance);
  const unlocked=await student.call('/luq/assistance/unlock',{body:{...target,requestKey:randomUUID(),confirmedPrice:3,confirmedContentId:quote.contentId}});
  assert.equal(unlocked.charged,3);assertSafe(unlocked);
  assert.equal((await student.call('/luq/assistance/provide',{body:target})).body,original);
  assert.equal(Number((await pool.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[student.identityId])).rows[0].balance),oldBalance-3);
  assert.equal((await pool.query("SELECT count(*)::int n FROM luq_assistance_deliveries WHERE kind='FULL_SOLUTION'")).rows[0].n,0);
  assert.equal((await student.call(`/problems/${first.problemId}?versionId=${first.versionId}`,{language:'zh-CN'})).statement,english,'Paid Chinese does not silently replace the public English statement');
  const exam=(await pool.query(`INSERT INTO timed_practices(title,owner_account_id,starts_at,ends_at,duration_minutes,state)
   VALUES('Translation restriction',$1,now()-interval '1 minute',now()+interval '1 hour',60,'Draft') RETURNING id`,[teacher.id])).rows[0];
  await pool.query('INSERT INTO timed_practice_problems(practice_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)',[exam.id,first.problemId,second.versionId]);
  await pool.query('INSERT INTO timed_practice_participants(practice_id,identity_id) VALUES($1,$2)',[exam.id,student.identityId]);
  await pool.query("UPDATE timed_practices SET state='Published' WHERE id=$1",[exam.id]);
  assert.equal((await student.call('/luq/assistance/quote',{body:target})).mode,'disabled');
  assert.equal((await student.call('/luq/assistance/provide',{body:target,expected:403})).error.code,'ASSISTANCE_LOCKED');
  assert.equal((await student.call(`/problems/${first.problemId}?versionId=${first.versionId}`)).statement,english,'Course/history still show only public English during a restricted assessment');
 }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
