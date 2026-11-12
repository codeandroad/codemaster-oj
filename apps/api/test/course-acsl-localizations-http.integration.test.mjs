import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {LEGACY_SCHOOL_ID,provisionSchool} from '../../../packages/domain/src/schools.mjs';
import {importAcslPaper} from '../../../packages/domain/src/acsl-import.mjs';
import {processSchoolOne} from '../../../packages/domain/school-worker.mjs';
import {GoJudge} from '../../../packages/domain/judge.mjs';

const noExamSecrets = value => {
 if(!value||typeof value!=='object')return;
 for(const [key,child] of Object.entries(value)){assert.ok(!['correctOptionIds','explanation','explanationDiagrams','referenceCode','tests','solution'].includes(key),'ACSL secret field '+key);noExamSecrets(child);}
};
test('bilingual courses keep shared progress and school-scoped immutable ACSL links', {skip:!process.env.TEST_DATABASE_URL,timeout:180000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const manager=createPool(base.href),schema='course_acsl_'+randomBytes(5).toString('hex'),scoped=new URL(base);
 scoped.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(scoped.href);
 let server,worker;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password),users={};
  for(const name of ['legacy-teacher','legacy-student','legacy-peer','admin','teacher','student','peer','beta-admin','outsider']){
   const identity=randomUUID(),kind=name==='legacy-teacher'?'teacher':name.startsWith('legacy-')?'student':'personal';
   await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)',[identity,kind,name]);
   users[name]=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity,name,passwordHash])).rows[0];users[name].identityId=identity;
   if(name.startsWith('legacy-')){await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[users[name].id,name==='legacy-teacher'?'teacher':'student']);await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[users[name].id]);}
   else await pool.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1',[users[name].id]);
  }
  const classId=randomUUID();await pool.query('INSERT INTO classes(id,name,owner_account_id) VALUES($1,$2,$3)',[classId,'Tutorial class',users['legacy-teacher'].id]);
  await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2)',[classId,users['legacy-teacher'].id]);
  for(const name of ['legacy-student','legacy-peer'])await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,users[name].identityId]);
  const school=await provisionSchool(pool,{slug:'bilingual-alpha',name:'Alpha',adminUsername:'admin'}),beta=await provisionSchool(pool,{slug:'bilingual-beta',name:'Beta',adminUsername:'beta-admin'});
  for(const name of ['teacher','student','peer']){
   const role=name==='teacher'?'teacher':'student';await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[school.id,users[name].id,role]);
   await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4)',[school.id,role,name,users[name].id]);
  }
  const content=JSON.parse(await readFile(new URL('../../../packages/domain/content/acsl/sample.json',import.meta.url),'utf8'));
  const paper=await importAcslPaper(pool,{schoolId:school.id,ownerAccountId:users.admin.id,content});
  const legacyPaper=await importAcslPaper(pool,{schoolId:LEGACY_SCHOOL_ID,ownerAccountId:users['legacy-teacher'].id,content});
  await importAcslPaper(pool,{schoolId:beta.id,ownerAccountId:users['beta-admin'].id,content});
  const asRole=role=>{const url=new URL(scoped);url.searchParams.set('options',`-crole=${role} -csearch_path=${schema}`);return url.href;};
  worker=createPool(asRole('campus_worker'));
  const origin='http://bilingual.test';server=await createApiApplication({databaseUrl:asRole('campus_app'),logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});await server.listen(0,'127.0.0.1');const host=await server.getUrl();
  const request=async(path,{auth,method='GET',body,status=200,csrf=true}={})=>{const response=await fetch(host+'/api/v1'+path,{method,headers:{Origin:origin,...(auth?{Cookie:auth.cookie,...(csrf?{'X-CSRF-Token':auth.csrfToken}:{})}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${path}: ${response.status} ${JSON.stringify(data.error??{})}`);return {data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const auth={};for(const name of Object.keys(users)){const response=await request('/auth/login',{method:'POST',body:{username:name,password}});auth[name]={cookie:response.cookie,csrfToken:response.data.csrfToken};}
  const post=(path,name,body,status=200)=>request(path,{auth:auth[name],method:'POST',body,status}),patch=(path,name,body,status=200)=>request(path,{auth:auth[name],method:'PATCH',body,status}),get=(path,name,status=200)=>request(path,{auth:auth[name],status});
  const loc={en:{title:'Numbers',description:'Base conversion'},zh:{title:'数制',description:'进制转换'}};
  const chapterLoc={en:{title:'Digits',content:'English $10_2$.',objective:'Understand digits',checkpoint:'Self-authored question',checkpointAnswer:'Lesson answer'},zh:{title:'数字',content:'中文 $10_2$。',objective:'认识数位',checkpoint:'原创自测',checkpointAnswer:'课件答案'}};
  const links=[{paperSlug:content.slug,kind:'question',questionId:'q1'},{paperSlug:content.slug,kind:'written'},{paperSlug:content.slug,kind:'programming'}];
  const document={format:'codemaster-learning-path',version:1,title:'Numbers',description:'Base conversion',category:'ACSL',estimatedMinutes:30,localizations:loc,chapters:[{title:'Digits',content:'English $10_2$.',objective:'Understand digits',checkpoint:'Self-authored question',checkpointAnswer:'Lesson answer',problemIds:[],localizations:chapterLoc,acslLinks:links}]};
  let legacyCourse,legacyChapter,course,chapterId=randomUUID();const coursePath=()=>`/schools/${school.id}/courses/${course.id}`,paperPath=`/schools/${school.id}/acsl/${paper.id}`;
  const schoolInput={requestId:randomUUID(),title:document.title,description:document.description,localizations:loc,accessScope:'school',classIds:[],chapters:[{id:chapterId,title:'Digits',body:'English $10_2$.',localizations:chapterLoc,acslLinks:links,problems:[]}]};
  await t.test('picker and creation preserve translations while rejecting invalid or cross-school references',async()=>{
   await get(`/schools/${school.id}/acsl/links`,'student',403);await get(`/schools/${school.id}/acsl/links`,'outsider',404);
   const picker=(await get(`/schools/${school.id}/acsl/links`,'teacher')).data;assert.equal(picker.items[0].questions.length,6);noExamSecrets(picker);assert.equal(picker.items[0].questions[0].statement,undefined);
   await get(`/schools/${LEGACY_SCHOOL_ID}/acsl/links`,'legacy-student',403);assert.equal((await get(`/schools/${LEGACY_SCHOOL_ID}/acsl/links`,'legacy-teacher')).data.items.length,1);
   await post('/learning-paths/import','teacher',document,403);
   await post('/learning-paths/import','legacy-teacher',{...document,chapters:[{...document.chapters[0],acslLinks:[{...links[0],versionId:paper.versionId}]}]},409);
   await post('/learning-paths/import','legacy-teacher',{...document,localizations:{fr:{title:'invalid'}}},400);
   legacyCourse=(await post('/learning-paths/import','legacy-teacher',document,201)).data;
   let detail=(await get('/learning-paths/'+legacyCourse.id,'legacy-teacher')).data;legacyChapter=detail.chapters[0].id;
   assert.deepEqual(detail.localizations,loc);assert.deepEqual(detail.chapters[0].localizations,chapterLoc);assert.equal(detail.chapters[0].acslLinks[0].versionId,legacyPaper.versionId);noExamSecrets(detail);
   await get('/learning-paths/'+legacyCourse.id,'legacy-student',404);
   await request('/learning-paths/'+legacyCourse.id+'/publish',{auth:auth['legacy-teacher'],method:'POST',body:{},csrf:false,status:403});
   await post('/learning-paths/'+legacyCourse.id+'/publish','legacy-teacher',{});
   course=(await post(`/schools/${school.id}/courses`,'teacher',schoolInput,201)).data;
   assert.deepEqual(course.localizations,loc);assert.equal(course.chapters[0].acslLinks[0].versionId,paper.versionId);
   await get(coursePath(),'student',404);await get(coursePath(),'outsider',404);await get(coursePath(),'beta-admin',404);
   course=(await post(coursePath()+'/publish','teacher',{expectedRevision:course.revision})).data;
  });
  await t.test('language changes preserve one chapter identity and do not submit exam answers',async()=>{
   const before=(await pool.query('SELECT (SELECT count(*) FROM acsl_drafts)::int drafts,(SELECT count(*) FROM acsl_paper_grades)::int grades,(SELECT count(*) FROM acsl_point_awards)::int awards')).rows[0];
   await post('/chapters/'+legacyChapter+'/progress','legacy-student',{completed:true});
   await post(coursePath()+`/chapters/${chapterId}/read`,'student',{expectedRevision:course.revision,read:true});
   for(const language of ['en','zh']){
    const legacy=(await get('/learning-paths/'+legacyCourse.id+'?language='+language,'legacy-student')).data;
    const modern=(await get(coursePath()+'?language='+language,'student')).data;
    assert.equal(legacy.chapters[0].id,legacyChapter);assert.equal(legacy.completedChapters,1);assert.equal(modern.chapters[0].id,chapterId);assert.equal(modern.completedChapters,1);noExamSecrets(legacy);noExamSecrets(modern);
    assert.ok(modern.chapters[0].acslLinks.every(link=>link.status==='not_started'&&!link.completed));
   }
   assert.equal((await get(coursePath(),'peer')).data.completedChapters,0);
   await get('/learning-paths/'+legacyCourse.id+'/progress','legacy-student',403);
   await get(`${paperPath}/questions/q1/explanation?versionId=${paper.versionId}`,'student',403);
   assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM acsl_drafts)::int drafts,(SELECT count(*) FROM acsl_paper_grades)::int grades,(SELECT count(*) FROM acsl_point_awards)::int awards')).rows[0],before);
   const backlinks=(await get(paperPath,'student')).data.learningLinks;assert.equal(backlinks.length,1);assert.equal(backlinks[0].chapterId,chapterId);assert.match(backlinks[0].href,/section=courses/);assert.deepEqual(backlinks[0].questionIds,['q1']);assert.equal(backlinks[0].written,true);assert.equal(backlinks[0].programming,true);
   await get(paperPath+'?paperVersionId='+randomUUID(),'student',409);
   assert.equal((await get(paperPath+'?paperVersionId='+paper.versionId,'student')).data.id,paper.id);
   const legacyBack=(await get(`/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`,'legacy-student')).data.learningLinks;assert.equal(legacyBack[0].chapterId,legacyChapter);
  });
  await t.test('published snapshots, draft preservation and pinned reference versions survive teacher saves',async()=>{
   const preserved=(await patch('/chapters/'+legacyChapter,'legacy-teacher',{content:'English $10_2$. refreshed'})).data;assert.equal(preserved.id,legacyChapter);
   const detail=(await get('/learning-paths/'+legacyCourse.id,'legacy-student')).data;assert.deepEqual(detail.chapters[0].localizations,chapterLoc);assert.equal(detail.chapters[0].acslLinks[0].versionId,legacyPaper.versionId);
   await patch('/chapters/'+legacyChapter,'legacy-teacher',{localizations:{zh:chapterLoc.zh}});assert.equal((await get('/learning-paths/'+legacyCourse.id,'legacy-student')).data.completedChapters,1);
   course=(await patch(coursePath(),'teacher',{...schoolInput,expectedRevision:course.revision,localizations:{zh:{title:'未发布译文'}},chapters:[{...schoolInput.chapters[0],localizations:{zh:{...chapterLoc.zh,content:'未发布正文'}}}]})).data;
   assert.deepEqual((await get(coursePath(),'student')).data.localizations,loc);
   assert.equal((await get(coursePath(),'student')).data.completedChapters,1);
   const staleVersion={...links[0],versionId:randomUUID()};await patch(coursePath(),'teacher',{...schoolInput,expectedRevision:course.revision,chapters:[{...schoolInput.chapters[0],acslLinks:[staleVersion]}]},409);
   course=(await patch(coursePath(),'teacher',{...schoolInput,expectedRevision:course.revision})).data;course=(await post(coursePath()+'/publish','teacher',{expectedRevision:course.revision})).data;
   assert.equal((await get(coursePath(),'student')).data.completedChapters,1,'Adding/translating display language does not invalidate the canonical chapter read hash.');
  });
  await t.test('existing monolingual readers keep progress when translations are added',async()=>{
   const oldChapter={id:randomUUID(),title:'Existing chapter',body:'Existing canonical content',problems:[]};
   const oldInput={requestId:randomUUID(),title:'Existing monolingual course',description:'',accessScope:'school',classIds:[],chapters:[oldChapter]};
   let old=(await post(`/schools/${school.id}/courses`,'teacher',oldInput,201)).data;
   const path=`/schools/${school.id}/courses/${old.id}`;
   old=(await post(path+'/publish','teacher',{expectedRevision:old.revision})).data;
   await post(path+`/chapters/${oldChapter.id}/read`,'student',{expectedRevision:old.revision,read:true});
   const before=(await pool.query('SELECT content_hash,read,updated_at FROM school_course_progress WHERE school_id=$1 AND course_id=$2',[school.id,old.id])).rows;
   old=(await patch(path,'teacher',{...oldInput,expectedRevision:old.revision,localizations:{zh:{title:'补充译文'}},chapters:[{...oldChapter,localizations:{zh:{title:'译文',content:'仅添加翻译'}}}]})).data;
   await post(path+'/publish','teacher',{expectedRevision:old.revision});
   const translated=(await get(path,'student')).data;assert.equal(translated.completedChapters,1);assert.equal(translated.chapters[0].read,true);
   assert.deepEqual((await pool.query('SELECT content_hash,read,updated_at FROM school_course_progress WHERE school_id=$1 AND course_id=$2',[school.id,old.id])).rows,before);
  });
  await t.test('question status uses whole grade and immutable historical snapshot, never an early verdict',async()=>{
   const revisions={};for(const [index,q] of content.questions.entries()){
    const answer=index===0?q.options.find(o=>!q.correctOptionIds.includes(o.id)).id:q.correctOptionIds[0];
    const saved=(await patch(`${paperPath}/questions/${q.id}/draft`,'student',{versionId:paper.versionId,expectedRevision:0,selectedOptionIds:[answer]})).data;revisions[q.id]=saved.revision;
   }
   let links=(await get(coursePath(),'student')).data.chapters[0].acslLinks;assert.equal(links[0].status,'draft');assert.equal(links[0].completed,false);assert.equal(links[0].correct,undefined);
   const grade=(await post(paperPath+'/submit','student',{versionId:paper.versionId,revisions})).data;assert.equal(grade.score,5);
   links=(await get(coursePath(),'student')).data.chapters[0].acslLinks;assert.equal(links[0].status,'submitted');assert.equal(links[0].completed,false);assert.equal(links[1].completed,true);noExamSecrets(links);
   const manage=(await get(`/schools/${school.id}/acsl/manage/${paper.id}`,'teacher')).data;
   await patch(`/schools/${school.id}/acsl/manage/${paper.id}`,'teacher',{requestId:randomUUID(),expectedContentHash:manage.contentHash,reason:'Test historical display correction',questions:[{id:'q1',statement:{en:'Updated display only',zh:'更新显示'}}]});
   const after=(await get(coursePath(),'student')).data.chapters[0].acslLinks;assert.equal(after[0].historical,true);assert.equal(after[0].completed,false);assert.equal((await get(paperPath,'student')).data.gradeId,grade.gradeId);
   assert.ok((await get(coursePath(),'peer')).data.chapters[0].acslLinks.every(link=>link.status==='not_started'));
  });
  await t.test('teacher progress uses each authorized student account rather than the teacher results',async()=>{
   const path=`/schools/${LEGACY_SCHOOL_ID}/acsl/${legacyPaper.id}`,revisions={};
   for(const q of content.questions){const saved=(await patch(`${path}/questions/${q.id}/draft`,'legacy-student',{versionId:legacyPaper.versionId,expectedRevision:0,selectedOptionIds:q.correctOptionIds})).data;revisions[q.id]=saved.revision;}
   await post(path+'/submit','legacy-student',{versionId:legacyPaper.versionId,revisions});
   await patch(path+'/questions/q1/draft','legacy-peer',{versionId:legacyPaper.versionId,expectedRevision:0,selectedOptionIds:content.questions[0].correctOptionIds});
   const overview=(await get('/learning-paths/'+legacyCourse.id+'/progress','legacy-teacher')).data;
   assert.equal(overview.taskCount,3);
   assert.equal(overview.items.find(item=>item.id===users['legacy-student'].identityId).completedTasks,2);
   assert.equal(overview.items.find(item=>item.id===users['legacy-peer'].identityId).completedTasks,0);
   assert.equal((await get('/learning-paths/'+legacyCourse.id,'legacy-student')).data.completedTasks,2);
   assert.equal((await get('/learning-paths/'+legacyCourse.id,'legacy-peer')).data.completedTasks,0);
  });
  await t.test('programming completion is the same real isolated formal AC and no new reward rule', {skip:!process.env.GO_JUDGE_TEST_URL},async()=>{
   const programming=(await get(paperPath+'/programming','student')).data;
   const judge=new GoJudge({url:process.env.GO_JUDGE_TEST_URL,token:process.env.GO_JUDGE_TEST_TOKEN,environmentVersion:process.env.JUDGE_ENVIRONMENT_VERSION??'course-acsl-test'});
   const solve=async kind=>{const job=(await post(paperPath+'/programming/submissions','student',{paperVersionId:paper.versionId,versionId:programming.versionId,requestId:randomUUID(),kind,language:'python',code:content.programming.definition.referenceCode},202)).data;await processSchoolOne({pool:worker,judge});const result=(await get(paperPath+'/programming/submissions/'+job.id,'student')).data;assert.equal(result.status,'AC');};
   await solve('samples');assert.equal((await get(coursePath(),'student')).data.chapters[0].acslLinks[2].completed,false);
   await solve('submit');const link=(await get(coursePath(),'student')).data.chapters[0].acslLinks[2];assert.equal(link.completed,true);assert.equal(link.status,'accepted');assert.match(link.href,/coding=1/);
   assert.equal((await pool.query('SELECT count(*)::int n FROM acsl_point_awards')).rows[0].n,0);
  });
  await t.test('public course preserves translations without giving outsiders school ACSL access',async()=>{
   await pool.query('INSERT INTO platform_admins(account_id) VALUES($1) ON CONFLICT DO NOTHING',[users.admin.id]);
   const candidates=(await get('/platform/course-publications','admin')).data.items;
   const legacyCandidate=candidates.find(item=>item.schoolId===LEGACY_SCHOOL_ID&&item.courseId===legacyCourse.id);assert.ok(legacyCandidate);
   const legacyListing=(await post('/platform/course-publications','admin',{schoolId:LEGACY_SCHOOL_ID,courseId:legacyCourse.id,revision:legacyCandidate.revision,sourceVersion:legacyCandidate.sourceVersion},201)).data;
   const legacyExternal=(await get('/practice/courses/'+legacyListing.id,'outsider')).data;assert.deepEqual(legacyExternal.localizations,loc);assert.deepEqual(legacyExternal.chapters[0].localizations,{zh:{title:chapterLoc.zh.title,content:chapterLoc.zh.content}});assert.ok(!JSON.stringify(legacyExternal).includes('checkpointAnswer'));assert.ok(legacyExternal.chapters[0].acslLinks.every(link=>!link.available));noExamSecrets(legacyExternal);
   const listing=(await post('/platform/course-publications','admin',{schoolId:school.id,courseId:course.id,revision:course.publishedRevision},201)).data;
   const external=(await get('/practice/courses/'+listing.id,'outsider')).data;assert.deepEqual(external.localizations,loc);assert.deepEqual(external.chapters[0].localizations,Object.fromEntries(Object.entries(chapterLoc).map(([language,entry])=>[language,{title:entry.title,content:entry.content}])));assert.ok(!JSON.stringify(external).includes('checkpointAnswer'));noExamSecrets(external);
   assert.ok(external.chapters[0].acslLinks.every(link=>!link.available&&link.reason==='school_access_required'&&!link.paperId&&!link.href));
   await get(paperPath,'outsider',404);
   await post(`/schools/${beta.id}/courses`,'beta-admin',{...schoolInput,requestId:randomUUID(),chapters:[{...schoolInput.chapters[0],acslLinks:(await get(coursePath(),'student')).data.chapters[0].acslLinks}]},409);
   await pool.query('UPDATE acsl_papers SET enabled=false WHERE school_id=$1 AND id=$2',[school.id,paper.id]);
   assert.ok((await get(coursePath(),'student')).data.chapters[0].acslLinks.every(link=>!link.available&&link.status==='unavailable'));
   await get(paperPath,'student',404);
  });
 }finally{if(server)await server.close();if(worker)await worker.end();await pool.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
