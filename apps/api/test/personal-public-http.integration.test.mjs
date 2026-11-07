import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {LEGACY_SCHOOL_ID,provisionSchool} from '../../../packages/domain/src/schools.mjs';
import {provisionPlatformAdministrator} from '../../../packages/domain/src/platform-governance.mjs';
import {processSchoolOne} from '../../../packages/domain/school-worker.mjs';

test('personal registration and reviewed public learning use real grants without granting school or legacy access',
 {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const baseUrl=new URL(process.env.TEST_DATABASE_URL);
 assert.match(baseUrl.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
 const manager=createPool(baseUrl.href),schema='personal_public_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const schemaUrl=new URL(baseUrl);schemaUrl.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(schemaUrl.href);let app,worker;
 const password=randomBytes(24).toString('base64url'),origin='http://personal.test';
 try {
  await migrate(owner);
  await bootstrap(owner,{name:'Legacy admin',number:'ADMIN',username:'legacy-admin',password});
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const appUrl=new URL(baseUrl);appUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const workerUrl=new URL(baseUrl);workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
  worker=createPool(workerUrl.href);
  app=await createApiApplication({databaseUrl:appUrl.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  async function request(path,{auth,body,method='GET',status=200,csrf=true,requestOrigin=origin}={}) {
   const res=await fetch(base+'/api/v1'+path,{method,headers:{Origin:requestOrigin,...(body!==undefined&&{'Content-Type':'application/json'}),...(auth&&{Cookie:auth.cookie,...(csrf&&{'X-CSRF-Token':auth.csrfToken})})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await res.json();assert.ok([status].flat().includes(res.status),`${method} ${path} ${res.status}: ${JSON.stringify(data.error??{})}`);
   return {data,cookie:res.headers.get('set-cookie')?.split(';')[0],status:res.status,headers:res.headers};
  }
  const session=r=>({id:r.data.user.id,identityId:r.data.user.identityId,csrfToken:r.data.csrfToken,cookie:r.cookie});
  const register=async username=>session(await request('/auth/register-personal',{method:'POST',status:201,body:{username,displayName:username,password,email:''}}));
  const applicantInbox = '/account-notifications';
  const applicantNotices = async (auth, path=applicantInbox) => (await request(path,{auth})).data;
  const legacy=session(await request('/auth/login',{method:'POST',body:{username:'legacy-admin',password}}));
  const baseline=(await owner.query('SELECT (SELECT count(*) FROM luq_ledger)::int luq,(SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM point_ledger)::int points')).rows[0];
  let personal,admin,platform,course,alpha,listing;
  await t.test('registration requires origin, validates fields, leaves roles empty and is concurrency-safe',async()=>{
   await request('/auth/register-personal',{method:'POST',body:{username:'invalid-user',displayName:'Test',password},requestOrigin:'https://evil.test',status:403});
   await request('/auth/register-personal',{method:'POST',body:{username:'invalid-user',displayName:'Test',password,roles:['admin']},status:400});
   await request('/auth/register-personal',{method:'POST',body:{username:'invalid-user',displayName:'Test',password,email:'bad'},status:400});
   const results=await Promise.all([1,2].map(()=>request('/auth/register-personal',{method:'POST',body:{username:'personal-student',displayName:'Independent learner',password,email:''},status:[201,409]})));
   assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
   const created=results.find(r=>r.status===201);personal=session(created);assert.deepEqual(created.data.user.roles,[]);assert.equal(created.data.user.platformAdmin,false);
   assert.equal((await owner.query("SELECT count(*)::int count FROM identities WHERE kind='personal'")).rows[0].count,1);
   assert.equal((await owner.query('SELECT count(*)::int count FROM legacy_school_account_ownership WHERE account_id=$1',[personal.id])).rows[0].count,0);
   assert.equal((await request('/schools',{auth:personal})).data.items.length,0);
   for(const path of ['/people','/problems','/learning-paths','/luq/me','/platform/schools'])await request(path,{auth:personal,status:403});
   await request('/auth/profile',{auth:personal,method:'PATCH',body:{nickname:'Learner'},csrf:false,status:403});
   await request('/auth/profile',{auth:personal,method:'PATCH',body:{nickname:'Learner'}});
   const people=await request('/people',{auth:legacy});assert.ok(!people.data.items.some(i=>i.id===personal.identityId));
   const accounts=await request('/accounts',{auth:legacy});assert.ok(!accounts.data.items.some(i=>i.id===personal.id));
   await request(`/people/${personal.identityId}`,{auth:legacy,status:404});
   await request(`/people/${personal.identityId}`,{auth:legacy,method:'PATCH',body:{name:'Hijacked'},status:403});
   await request(`/people/${personal.identityId}/reset`,{auth:legacy,method:'POST',body:{},status:[403,404]});
   assert.deepEqual((await owner.query('SELECT (SELECT count(*) FROM luq_ledger)::int luq,(SELECT count(*) FROM submissions)::int submissions,(SELECT count(*) FROM point_ledger)::int points')).rows[0],baseline);
  });
  await t.test('existing school accounts and personal accounts can accept invitations without implicit privilege',async()=>{
   admin=await register('school-admin');platform=await register('platform-account');
   alpha=await provisionSchool(owner,{slug:'public-alpha',name:'Alpha',adminUsername:'school-admin'});
   await provisionPlatformAdministrator(owner,{username:'platform-account'});
   const invite=(await request(`/schools/${alpha.id}/invitations`,{auth:admin,method:'POST',body:{role:'teacher'},status:201})).data;
   await request('/school-invitations/accept',{auth:personal,method:'POST',body:{token:invite.token}});
   assert.equal((await request('/schools',{auth:personal})).data.items[0].roles[0],'teacher');
   assert.deepEqual((await request('/auth/me',{auth:personal})).data.user.roles,[]);
   const second=(await request(`/schools/${alpha.id}/invitations`,{auth:admin,method:'POST',body:{role:'teacher'},status:201})).data;
   await request('/school-invitations/accept',{auth:legacy,method:'POST',body:{token:second.token}});
   assert.equal((await request('/schools',{auth:legacy})).data.items.length,2);
   await request('/problems',{auth:personal,status:403});
  });
  await t.test('school courses are not global until explicit exact-version platform approval',async()=>{
   const chapter={id:randomUUID(),title:'First chapter',body:'Only approved chapter text.'};
   course=(await request(`/schools/${alpha.id}/courses`,{auth:admin,method:'POST',status:201,body:{requestId:randomUUID(),title:'Public introduction',description:'Example',category:'Algorithms',difficulty:'advanced',coverKey:'algorithms',accessScope:'school',classIds:[],chapters:[chapter]}})).data;
   course=(await request(`/schools/${alpha.id}/courses/${course.id}/publish`,{auth:admin,method:'POST',body:{expectedRevision:course.revision}})).data;
   assert.equal((await request('/practice/catalog',{auth:personal})).data.courses.length,0);
   const review=(await request('/platform/course-publications',{auth:platform})).data.items.find(i=>i.courseId===course.id);assert.equal(review.chapters[0].body,chapter.body);
   await request('/platform/course-publications',{auth:admin,method:'POST',body:{schoolId:alpha.id,courseId:course.id,revision:course.revision},status:403});
   await request('/platform/course-publications',{auth:platform,method:'POST',body:{schoolId:alpha.id,courseId:course.id,revision:999},status:409});
   listing=(await request('/platform/course-publications',{auth:platform,method:'POST',status:201,body:{schoolId:alpha.id,courseId:course.id,revision:course.revision}})).data;
   const catalogue=(await request('/practice/catalog',{auth:personal})).data;
   const summary=catalogue.courses[0];
   assert.equal(summary.id,listing.id);
   assert.deepEqual([summary.category,summary.difficulty,summary.coverKey,summary.completedChapters],['Algorithms','advanced','algorithms',0]);
   assert.ok(!JSON.stringify(catalogue).includes(chapter.body));
   const outsider=await register('outsider');
   await request(`/schools/${alpha.id}/courses/${course.id}`,{auth:outsider,status:404});
   assert.equal((await request(`/practice/courses/${listing.id}`,{auth:outsider})).data.chapters[0].body,chapter.body);
   const reading=(await request(`/practice/courses/${listing.id}/chapters/${chapter.id}/read`,{auth:outsider,method:'POST',body:{read:true,expectedRevision:course.revision}})).data;
   assert.equal(reading.completedChapters,1);
   assert.equal((await request('/practice/catalog',{auth:outsider})).data.courses[0].completedChapters,1);
   assert.equal((await request('/practice/catalog',{auth:personal})).data.courses[0].completedChapters,0);
   assert.equal((await request(`/practice/courses/${listing.id}`,{auth:personal})).data.completedChapters,0);
   course=(await request(`/schools/${alpha.id}/courses/${course.id}`,{auth:admin,method:'PATCH',body:{expectedRevision:course.revision,title:'New edition awaiting review',description:'Example',chapters:[chapter],accessScope:'school',classIds:[]}})).data;
   // A draft never changes the already approved edition.
   assert.equal((await request(`/practice/courses/${listing.id}`,{auth:outsider})).data.title,'Public introduction');
   course=(await request(`/schools/${alpha.id}/courses/${course.id}/publish`,{auth:admin,method:'POST',body:{expectedRevision:course.revision}})).data;
   await request(`/practice/courses/${listing.id}`,{auth:outsider,status:404});
   assert.equal((await request('/practice/catalog',{auth:outsider})).data.courses.length,0);
   await request('/platform/course-publications',{auth:platform,method:'POST',status:201,body:{schoolId:alpha.id,courseId:course.id,revision:course.revision}});
   assert.equal((await request(`/practice/courses/${listing.id}`,{auth:outsider})).data.completedChapters,1);
   await request(`/platform/course-publications/${listing.id}`,{auth:platform,method:'DELETE'});
   await request(`/practice/courses/${listing.id}`,{auth:outsider,status:404});
   await request(`/practice/courses/${listing.id}/chapters/${chapter.id}/read`,{auth:outsider,method:'POST',body:{read:true,expectedRevision:course.revision},status:404});
   assert.equal((await owner.query('SELECT count(*)::int count FROM public_course_progress')).rows[0].count,1);
  });
  await t.test('course applications authorize only the reviewed edition and preserve school boundaries', async () => {
   const eligible = await register('course-classmate');
   const outsider = await register('course-applicant');
   const other = await register('other-applicant');
   const betaAdmin = await register('course-beta-admin');
   const beta = await provisionSchool(owner, {slug:'course-beta',name:'Course Beta',adminUsername:'course-beta-admin'});
   const school = `/schools/${alpha.id}`;
   const inbox = school+'/staff-notifications';
   const notices = async (auth=admin, path=inbox) => (await request(path,{auth})).data;
   const secondAdmin = await register('course-second-admin');
   const adminInvite = (await request(school+'/invitations',{auth:admin,method:'POST',status:201,
    body:{role:'school_admin'}})).data;
   await request('/school-invitations/accept',{auth:secondAdmin,method:'POST',body:{token:adminInvite.token}});
   const invite = (await request(school+'/invitations', {auth:admin,method:'POST',body:{role:'student'},status:201})).data;
   await request('/school-invitations/accept', {auth:eligible,method:'POST',body:{token:invite.token}});
   const identity = (await request(school+'/identities', {auth:admin,method:'POST',status:201,
    body:{kind:'student',name:'Classmate',number:'C1',accountId:eligible.id}})).data;
   const cls = (await request(school+'/classes', {auth:admin,method:'POST',status:201,
    body:{name:'Eligible class',type:'training'}})).data;
   const roster = `${school}/classes/${cls.id}/roster`;
   await request(roster, {auth:admin,method:'POST',status:201,body:{identityId:identity.id}});
   const chapter = {id:randomUUID(),title:'Restricted chapter',body:'Private material for an approved learner'};
   const input = {title:'Class course',description:'Public summary',accessScope:'classes',classIds:[cls.id],chapters:[chapter]};
   const draft = (await request(school+'/courses', {auth:admin,method:'POST',status:201,
    body:{...input,requestId:randomUUID()}})).data;
   const coursePath = `${school}/courses/${draft.id}`;
   const admissionQueue = `${school}/course-admissions`;
   const admissions = `${admissionQueue}/${draft.id}`;
   const published = (await request(coursePath+'/publish', {auth:admin,method:'POST',body:{expectedRevision:draft.revision}})).data;
   const body = {expectedRevision:published.revision};
   await request(admissions, {auth:personal,method:'POST',body,status:403});
   await request(admissions, {auth:betaAdmin,status:404});
   await request(admissions, {auth:admin,method:'POST',body,csrf:false,status:403});
   const listing = (await request(admissions, {auth:admin,method:'POST',body,status:201})).data;
   const publicPath = `/practice/courses/${listing.id}`;
   const entry = async auth => (await request(publicPath+'/entry', {auth})).data;
   const denied = async auth => {
    const result = await request(publicPath, {auth,status:403});
    assert.equal(result.data.error.code,'COURSE_APPLICATION_REQUIRED');
    assert.ok(!JSON.stringify(result.data).includes(chapter.body));
   };
   assert.equal((await entry(eligible)).admission,'direct');
   assert.equal((await request(publicPath,{auth:eligible})).data.chapters[0].body,chapter.body);
   assert.equal((await entry(outsider)).admission,'apply');
   assert.equal((await entry(outsider)).accessScope,'classes');
   assert.ok(!Object.hasOwn(await entry(outsider),'chapters'));
   await denied(outsider);
   await request(publicPath+`/chapters/${chapter.id}/read`,{auth:outsider,method:'POST',body:{...body,read:true},status:403});
   await request('/platform/course-publications',{auth:platform,method:'POST',
    body:{schoolId:alpha.id,courseId:draft.id,revision:published.revision},status:409});
   assert.equal((await notices()).unreadCount,0);
   await request(publicPath+'/applications',{auth:outsider,method:'POST',body:{expectedRevision:999},status:409});
   await Promise.all([1,2].map(() => request(publicPath+'/applications',{auth:outsider,method:'POST',body,status:[200,201]})));
   await request(publicPath+'/applications',{auth:other,method:'POST',body,status:201});
   assert.equal((await entry(outsider)).admission,'pending');
   await denied(outsider);
   await request(applicantInbox,{status:401});
   assert.deepEqual(await applicantNotices(outsider),{items:[],total:0,unreadCount:0,page:1,pageSize:10});
   const requests = (await request(admissions,{auth:admin})).data.applications;
   assert.equal(requests.length,2,'duplicate application does not create another row');
   const decide = (item, action, auth=admin, status=200) => request(admissions+'/'+item.id+'/decision',
    {auth,method:'POST',body:{...body,action},status});
   const applicant = requests.find(item => item.username === 'course-applicant');
   const rejected = requests.find(item => item.username === 'other-applicant');
   await request(admissionQueue,{auth:personal,status:403});
   await request(admissionQueue,{auth:betaAdmin,status:404});
   assert.deepEqual((await request(admissionQueue,{auth:admin})).data.items,[{id:draft.id,title:input.title,pendingCount:2}]);
   const focused = (await request(admissions+'?applicationId='+rejected.id,{auth:admin})).data;
   assert.equal(focused.courseTitle,input.title);
   assert.equal(focused.applications[0].id,rejected.id);
   await request(inbox,{status:401});
   await request(inbox,{auth:eligible,status:403});
   for (const auth of [outsider,betaAdmin,platform]) await request(inbox,{auth,status:404});
   assert.equal((await notices(betaAdmin,`/schools/${beta.id}/staff-notifications`)).total,0);
   assert.equal((await notices(personal)).total,0,'an ordinary teacher has no admission notices');
   assert.equal((await notices(legacy)).total,0,'a legacy admin acting as a teacher in Alpha sees no notices');
   await request(inbox+'/not-a-uuid/read',{auth:admin,method:'POST',status:400});
   await request(inbox+'/'+applicant.id+'/read',{auth:personal,method:'POST',status:404});
   await request(inbox+'/read-all',{auth:admin,method:'POST',csrf:false,status:403});
   const feed = await notices(admin,inbox+'?pageSize=1');
   assert.deepEqual([feed.total,feed.unreadCount,feed.page,feed.pageSize,feed.items.length],[2,2,1,1,1]);
   assert.deepEqual(Object.keys(feed.items[0]).sort(),['courseId','courseTitle','createdAt','id','kind','readAt','schoolId']);
   assert.equal(feed.items[0].kind,'course_application');
   assert.equal(feed.items[0].schoolId,alpha.id);
   assert.equal(feed.items[0].courseId,draft.id);
   assert.equal(feed.items[0].courseTitle,input.title);
   assert.equal(feed.items[0].readAt,null);
   const secondPage = await notices(admin,inbox+'?page=2&pageSize=1');
   assert.deepEqual(new Set([feed.items[0].id,secondPage.items[0].id]),new Set([applicant.id,rejected.id]));
   const reads = await Promise.all([1,2].map(() => request(inbox+'/'+applicant.id+'/read',{auth:admin,method:'POST'})));
   assert.equal(reads[0].data.readAt,reads[1].data.readAt);
   assert.equal((await notices()).unreadCount,1);
   assert.equal((await notices(secondAdmin)).unreadCount,2,'read receipts are per administrator');
   await request(inbox+'/read-all',{auth:admin,method:'POST'});
   assert.equal((await notices()).unreadCount,0);
   assert.equal((await notices(secondAdmin)).unreadCount,2);
   await assert.rejects(worker.query('SELECT 1 FROM staff_course_notification_reads'),{code:'42501'});
   const appDb = createPool(appUrl.href);
   try {
    assert.equal((await appDb.query('SELECT 1 FROM staff_course_notification_reads')).rowCount,0);
    await assert.rejects(appDb.query(`INSERT INTO staff_course_notification_reads(school_id,account_id,application_id)
     VALUES($1,$2,$3)`,[alpha.id,secondAdmin.id,applicant.id]),{code:'42501'});
   } finally {await appDb.end();}
   await decide(applicant,'approve',betaAdmin,404);
   assert.equal((await applicantNotices(outsider)).total,0);
   const decisions = await Promise.all([admin,secondAdmin].map(auth => decide(applicant,'approve',auth,[200,409])));
   assert.deepEqual(decisions.map(result => result.status).sort(),[200,409]);
   assert.equal((await notices(secondAdmin)).unreadCount,1);
   await decide(rejected,'reject');
   await decide(rejected,'reject',admin,409);
   assert.equal((await notices(secondAdmin)).total,0);
   const approvedFeed = await applicantNotices(outsider);
   const deniedFeed = await applicantNotices(other);
   assert.deepEqual([approvedFeed.total,approvedFeed.unreadCount,deniedFeed.total,deniedFeed.unreadCount],[1,1,1,1]);
   const [approvedNotice] = approvedFeed.items;
   const [deniedNotice] = deniedFeed.items;
   assert.deepEqual(Object.keys(approvedNotice).sort(),['courseTitle','createdAt','id','kind','listingId','outcome','readAt']);
   assert.deepEqual([approvedNotice.kind,approvedNotice.outcome,approvedNotice.listingId,approvedNotice.courseTitle,approvedNotice.readAt],
    ['course_application_result','approved',listing.id,input.title,null]);
   assert.deepEqual([deniedNotice.kind,deniedNotice.outcome,deniedNotice.listingId,deniedNotice.courseTitle,deniedNotice.readAt],
    ['course_application_result','rejected',listing.id,input.title,null]);
   assert.equal((await request('/practice/courses/'+approvedNotice.listingId,{auth:outsider})).data.chapters[0].body,chapter.body);
   await denied(other);
   for (const auth of [other,admin,platform,betaAdmin]) {
    await request(applicantInbox+'/'+approvedNotice.id+'/read',{auth,method:'POST',status:404});
   }
   assert.equal((await applicantNotices(admin)).total,0);
   assert.equal((await applicantNotices(outsider)).unreadCount,1);
   await request(applicantInbox+'/'+approvedNotice.id+'/read',{auth:outsider,method:'POST',csrf:false,status:403});
   const applicantReads = await Promise.all([1,2].map(() => request(applicantInbox+'/'+approvedNotice.id+'/read',
    {auth:outsider,method:'POST'})));
   assert.ok(applicantReads[0].data.readAt);
   assert.equal(applicantReads[0].data.readAt,applicantReads[1].data.readAt);
   assert.equal((await applicantNotices(outsider)).unreadCount,0);
   assert.equal((await applicantNotices(other)).unreadCount,1);
   await request(applicantInbox+'/read-all',{auth:other,method:'POST'});
   assert.equal((await applicantNotices(other)).unreadCount,0);
   await assert.rejects(worker.query('SELECT 1 FROM course_admission_notifications'),{code:'42501'});
   const notificationDb = createPool(appUrl.href);
   try {
    assert.equal((await notificationDb.query('SELECT 1 FROM course_admission_notifications')).rowCount,0,
     'the application database role requires recipient context');
   } finally {await notificationDb.end();}
   assert.equal((await request(admissionQueue,{auth:admin})).data.items[0].pendingCount,0);
   assert.equal((await entry(other)).admission,'rejected');
   assert.equal((await entry(outsider)).admission,'direct');
   assert.equal((await request(publicPath,{auth:outsider})).data.chapters[0].body,chapter.body);
   const progress = await request(publicPath+`/chapters/${chapter.id}/read`,
    {auth:outsider,method:'POST',body:{...body,read:true}});
   assert.equal(progress.data.completedChapters,1);
   assert.equal((await request('/schools',{auth:outsider})).data.items.length,0,'course approval grants no school membership');
   await request(coursePath,{auth:outsider,status:404});
   await request(roster+'/'+identity.id,{auth:admin,method:'DELETE'});
   await denied(eligible);
   await request(publicPath+'/applications',{auth:eligible,method:'POST',body,status:201});
   const studentApplication = (await request(admissions,{auth:admin})).data.applications.find(
    item => item.username === 'course-classmate');
   await decide(studentApplication,'reject');
   const studentInbox = school+'/student-notifications';
   const studentFeed = await applicantNotices(eligible,studentInbox);
   assert.deepEqual([studentFeed.total,studentFeed.unreadCount,studentFeed.items[0].outcome],[1,1,'rejected']);
   await request(studentInbox+'/'+studentFeed.items[0].id+'/read',{auth:eligible,method:'POST'});
   assert.equal((await applicantNotices(eligible)).unreadCount,0,'notification read state is shared across workspaces');
   await request(publicPath+'/applications',{auth:personal,method:'POST',body,status:201});
   const teacherApplication = (await request(admissions,{auth:admin})).data.applications.find(
    item => item.username === 'personal-student');
   await decide(teacherApplication,'approve');
   const teacherFeed = await notices(personal);
   assert.deepEqual(teacherFeed.items.map(item => [item.kind,item.outcome]),[['course_application_result','approved']]);
   await request(inbox+'/read-all',{auth:personal,method:'POST'});
   assert.equal((await applicantNotices(personal)).unreadCount,0);
   await decide(applicant,'revoke');
   await denied(outsider);
   const revoked = (await request('/practice/catalog',{auth:outsider})).data.courses.find(item => item.id === listing.id);
   assert.equal(revoked.admission,'rejected');
   assert.ok(!Object.hasOwn(revoked,'completedChapters'));
   assert.ok(!JSON.stringify(revoked).includes(chapter.body));
   await request(admissions,{auth:admin,method:'DELETE',body});
   await request(publicPath+'/entry',{auth:outsider,status:404});
   await request(admissions,{auth:admin,method:'POST',body,status:201});
   assert.equal((await entry(outsider)).admission,'apply','relisting does not restore the previous approval');
   assert.deepEqual((await request(admissions,{auth:admin})).data.applications,[]);
   await request(publicPath+'/applications',{auth:outsider,method:'POST',body,status:201});
   assert.equal((await notices()).unreadCount,1,'new generation has its own notification');
   const revised = (await request(coursePath,{auth:admin,method:'PATCH',body:{...input,...body,title:'Updated edition'}})).data;
   await request(coursePath+'/publish',{auth:admin,method:'POST',body:{expectedRevision:revised.revision}});
   assert.equal((await notices()).total,0,'outdated applications are no longer actionable');
   assert.deepEqual((await request(admissionQueue,{auth:admin})).data.items,[]);
   await request(publicPath+'/entry',{auth:outsider,status:404});
   await request(admissions,{auth:admin,method:'POST',body,status:409});
  });
  await t.test('original-school publication freezes reviewed lesson text and never exports checkpoint answers', async () => {
   const outsider = await register('legacy-course-applicant');
   const original = (await request('/learning-paths', {auth:legacy,method:'POST',status:201,
    body:{title:'Original-school course',description:'Public description'}})).data;
   const schoolPath = `/learning-paths/${original.id}`;
   const admissionPath = `/schools/${LEGACY_SCHOOL_ID}/course-admissions/${original.id}`;
   const chapter = (await request(schoolPath+'/chapters', {auth:legacy,method:'POST',status:201,
    body:{title:'First lesson',content:'Reviewed original lesson.',checkpoint:'Private prompt',checkpointAnswer:'PRIVATE-ANSWER'}})).data;
   const secondChapter = (await request(schoolPath+'/chapters', {auth:legacy,method:'POST',status:201,
    body:{title:'Second lesson',content:'Second reviewed lesson.',checkpoint:'PRIVATE-PROMPT',checkpointAnswer:'PRIVATE-SECOND-ANSWER'}})).data;
   await owner.query(`UPDATE learning_paths SET author_name='Published teacher',authored_at='2026-01-02T03:04:05Z',
    cover_image=NULL WHERE id=$1`, [original.id]);
   const visibleMetadata = {
    difficulty:'easy',objective:'Read and return the supplied integer.',
    inputDescription:'One integer.',outputDescription:'The same integer.',returnType:'integer',
    parameters:[{name:'data',type:'integer',description:'The supplied integer.'},'No additional arguments.'],
   };
   const addProblem = async (title, position) => {
    const { rows: [{ id: problemId }] } = await owner.query(
     'INSERT INTO problems(owner_account_id) VALUES($1) RETURNING id', [legacy.id]);
    const { rows: [{ id: versionId }] } = await owner.query(`INSERT INTO problem_versions
     (problem_id,title,mode,statement,reference_code,samples,time_limit_ms,memory_limit_mb,validation_status)
     VALUES($1,$2,'stdio','Print the number.','PRIVATE-REFERENCE',
     '[{"input":"2","expected":"2","enabled":true}]',1000,128,'AC') RETURNING id`, [problemId, title]);
    await owner.query('UPDATE problem_versions SET starter_codes=$2 WHERE id=$1', [versionId,JSON.stringify({
     python:'# Write your program',cpp:'// Write your program',javascript:'// Write your program',
     teacherNotes:'PRIVATE-STARTER-NOTE',
    })]);
    await owner.query('UPDATE problem_versions SET metadata=$2,tags=$3 WHERE id=$1',[versionId,JSON.stringify({
     ...visibleMetadata,parameters:[{...visibleMetadata.parameters[0],teacherNotes:'PRIVATE-PARAMETER-NOTE'},visibleMetadata.parameters[1]],
     teacherNotes:'PRIVATE-TEACHER-NOTE',editorial:'PRIVATE-EDITORIAL',
     translatedStatement:'PRIVATE-CHINESE-TRANSLATION',solution:'PRIVATE-SOLUTION',
    }),JSON.stringify(['Python','Input/output',{teacherNotes:'PRIVATE-TAG-NOTE'},42])]);
    await owner.query(`INSERT INTO test_cases(version_id,position,input,expected,weight)
     VALUES($1,1,'PRIVATE-TEST','7',100)`, [versionId]);
    await owner.query(`UPDATE problem_versions SET published_at=now(),rank_review_status='approved',
     school_visible_at=now(),rank_approved_at=now() WHERE id=$1`, [versionId]);
    await owner.query('UPDATE problems SET current_version_id=$1 WHERE id=$2', [versionId,problemId]);
    await owner.query(`INSERT INTO chapter_problems(chapter_id,problem_id,version_id,position)
     VALUES($1,$2,$3,$4)`, [chapter.id,problemId,versionId,position]);
    return { problemId, versionId, title };
   };
   const first = await addProblem('Public practice first', 0);
   await addProblem('PRIVATE-LINK-TITLE', 1);
   const last = await addProblem('Public practice last', 2);
   for (const problem of [last,first]) await request('/platform/problem-publications', {
    auth:platform,method:'POST',body:{schoolId:LEGACY_SCHOOL_ID,problemId:problem.problemId,versionId:problem.versionId},
   });
   const practicePath = '/practice/problems/' + first.problemId;
   const {rows:[{id:draftVersionId}]} = await owner.query(`INSERT INTO problem_versions
    (problem_id,title,mode,statement,reference_code,samples,time_limit_ms,memory_limit_mb,metadata,tags)
    VALUES($1,'PRIVATE-DRAFT-TITLE','stdio','PRIVATE-DRAFT-STATEMENT','PRIVATE-DRAFT-REFERENCE',
    '[{"input":"3","expected":"3"}]',1000,128,$2,'["PRIVATE-DRAFT-TAG"]') RETURNING id`,
    [first.problemId,JSON.stringify({...visibleMetadata,difficulty:'hard',objective:'PRIVATE-DRAFT-OBJECTIVE'})]);
   assert.equal((await request(admissionPath,{auth:legacy})).data.revision,null);
   await request(schoolPath+'/publish',{auth:legacy,method:'POST',body:{}});
   await request(admissionPath,{auth:admin,status:403});
   const version = (await request(admissionPath,{auth:legacy})).data;
   const expected = {expectedRevision:version.revision,sourceVersion:version.sourceVersion};
   await request(admissionPath,{auth:legacy,method:'POST',body:{expectedRevision:version.revision},status:409});
   const listing = (await request(admissionPath,{auth:legacy,method:'POST',body:expected,status:201})).data;
   const publicPath = `/practice/courses/${listing.id}`;
   assert.equal((await request(publicPath+'/entry',{auth:legacy})).data.admission,'direct');
   const summary = (await request(publicPath+'/entry',{auth:outsider})).data;
   assert.equal(summary.admission,'apply');
   assert.equal(summary.accessScope,'school');
   assert.ok(!JSON.stringify(summary).includes('Reviewed original lesson.'));
   assert.ok(!JSON.stringify(summary).includes(first.title));
   await request(publicPath,{auth:outsider,status:403});
   await request(publicPath+`/chapters/${chapter.id}/read`,{auth:outsider,method:'POST',
    body:{expectedRevision:version.revision,read:true},status:403});
   const practice = await request(practicePath+'?versionId='+first.versionId,{auth:outsider});
   assert.equal(practice.data.versionId,first.versionId);
   assert.equal(practice.data.canManage,false);
   assert.equal(practice.data.solved,false);
   assert.deepEqual(practice.data.definition.starterCodes,{
    python:'# Write your program',cpp:'// Write your program',javascript:'// Write your program',
   });
   assert.deepEqual(practice.data.definition.samples,[{input:'2',expected:'2'}]);
   assert.deepEqual(Object.fromEntries(Object.keys(visibleMetadata).map(key => [key,practice.data.definition[key]])),visibleMetadata);
   assert.deepEqual(practice.data.definition.tags,['Python','Input/output']);
   assert.equal(practice.data.hasDraftChanges,false,'a separate legacy draft cannot replace the approved practice snapshot');
   assert.doesNotMatch(JSON.stringify(practice.data),/PRIVATE-|reference_code|referenceCode|"tests"|checkpoint/);
   assert.match(practice.headers.get('cache-control')??'',/no-store/);
   await request(practicePath+'?versionId='+draftVersionId,{auth:outsider,status:404});
   // Existing snapshots must adopt the safe presentation for this exact reviewed
   // version, without exposing the author's original metadata or another draft.
   const source = (await request(`/luq/public-statements?problemId=${first.problemId}&versionId=${first.versionId}`,{auth:legacy})).data;
   const reviewedMetadata = {...visibleMetadata,objective:'Reviewed learning objective.'};
   await request('/luq/public-statements',{auth:legacy,method:'POST',status:201,body:{
    problemId:first.problemId,versionId:first.versionId,language:'en',reviewed:true,
    statement:'Reviewed public statement.',metadata:reviewedMetadata,sourceHash:source.sourceHash,
   }});
   const reviewed = (await request(practicePath+'?versionId='+first.versionId,{auth:outsider})).data;
   assert.deepEqual(Object.fromEntries(Object.keys(reviewedMetadata).map(key => [key,reviewed.definition[key]])),reviewedMetadata);
   assert.deepEqual(reviewed.definition.tags,['Python','Input/output']);
   assert.match(reviewed.definition.statement,/^Reviewed public statement\./);
   assert.doesNotMatch(JSON.stringify(reviewed),/PRIVATE-|Read and return the supplied integer|reference_code|referenceCode|"tests"|checkpoint/);
   await request(practicePath+'?versionId='+last.versionId,{auth:outsider,status:404});
   await request(practicePath+'/submissions',{auth:outsider,method:'POST',status:404,
    body:{versionId:last.versionId,kind:'submit',code:'print(7)',requestId:randomUUID()}});
   await request(publicPath+'/applications',{auth:outsider,method:'POST',status:201,body:{expectedRevision:version.revision}});
   await request(publicPath,{auth:outsider,status:403});
   await request(publicPath+`/chapters/${chapter.id}/read`,{auth:outsider,method:'POST',
    body:{expectedRevision:version.revision,read:true},status:403});
   const pendingSummary = (await request('/practice/catalog',{auth:outsider})).data.courses.find(item => item.id === listing.id);
   assert.equal(pendingSummary.admission,'pending');
   assert.equal(pendingSummary.totalExercises,undefined,'pending applicants do not receive private course progress');
   assert.doesNotMatch(JSON.stringify(pendingSummary),/Reviewed original lesson|Public practice first|PRIVATE-/);
   const application = (await request(admissionPath,{auth:legacy})).data.applications[0];
   const admissionQueue = `/schools/${LEGACY_SCHOOL_ID}/course-admissions`;
   assert.deepEqual((await request(admissionQueue,{auth:legacy})).data.items,
    [{id:original.id,title:'Original-school course',pendingCount:1}]);
   await request(admissionQueue,{auth:admin,status:403});
   const inbox = '/staff-notifications';
   await request(inbox,{auth:platform,status:403});
   await request(inbox,{auth:outsider,status:403});
   const notice = (await request(inbox,{auth:legacy})).data.items[0];
   assert.deepEqual([notice.id,notice.schoolId,notice.courseId,notice.courseTitle,notice.readAt],
    [application.id,LEGACY_SCHOOL_ID,original.id,'Original-school course',null]);
   await request(inbox+'/'+notice.id+'/read',{auth:legacy,method:'POST'});
   assert.equal((await request(inbox,{auth:legacy})).data.unreadCount,0);
   await request(admissionPath+`/${application.id}/decision`,{auth:legacy,method:'POST',body:{...expected,action:'approve'}});
   const result = await applicantNotices(outsider);
   assert.equal(result.unreadCount,1);
   assert.deepEqual(result.items.map(item => [item.kind,item.listingId,item.courseTitle,item.outcome]),
    [['course_application_result',listing.id,original.title,'approved']]);
   assert.equal((await request(inbox,{auth:legacy})).data.total,0);
   assert.equal((await request(admissionQueue,{auth:legacy})).data.items[0].pendingCount,0);
   const response = await request(publicPath,{auth:outsider});
   const content = response.data;
   assert.deepEqual(content.chapters,[{id:chapter.id,position:0,title:'First lesson',body:'Reviewed original lesson.',read:false,
    problems:[{...first,solved:false},{...last,solved:false}]},
   {id:secondChapter.id,position:1,title:'Second lesson',body:'Second reviewed lesson.',read:false,problems:[]}]);
   assert.deepEqual([content.authorName,content.authoredAt,content.coverImage,content.category,content.difficulty,content.coverKey],
    ['Published teacher','2026-01-02T03:04:05.000Z',null,'Python','beginner','general']);
   assert.equal(typeof content.sourceSchool,'string');
   assert.deepEqual([content.chapterCount,content.completedChapters,content.totalExercises,content.completedExercises],[2,0,2,0]);
   assert.match(response.headers.get('cache-control')??'',/no-store/);
   assert.doesNotMatch(JSON.stringify(content),/PRIVATE-/);
   const submitted = (await request(practicePath+'/submissions',{auth:outsider,method:'POST',status:202,
    body:{versionId:first.versionId,kind:'submit',code:'print(7)',requestId:randomUUID()}})).data;
   const resultPath = practicePath+'/submissions/'+submitted.id;
   const queued = (await request(resultPath,{auth:outsider})).data;
   assert.deepEqual([queued.versionId,queued.status,queued.runtimeMs,queued.memoryKb],[first.versionId,'Waiting',null,null]);
   assert.doesNotMatch(JSON.stringify(queued),/PRIVATE-/);
   await processSchoolOne({pool:worker,judge:{judge:async task => {
    assert.equal(task.tests[0].input,'PRIVATE-TEST');
    return {status:'AC',score:100,passed:1,total:1,publicMessage:'',privateResults:[{
     position:1,status:'AC',cpuMs:7,memoryBytes:7168,input:'PRIVATE-TEST',expected:'PRIVATE-EXPECTED',
     stdout:'PRIVATE-OUTPUT',stderr:'PRIVATE-TEACHER-NOTE',
    }]};
   }}});
   const judged = await request(resultPath,{auth:outsider});
   assert.equal(judged.data.status,'AC');
   assert.deepEqual([judged.data.versionId,judged.data.runtimeMs,judged.data.memoryKb],[first.versionId,7,7]);
   assert.equal(judged.data.code,'print(7)');
   assert.deepEqual(judged.data.caseFeedback,[{position:1,status:'AC',timeMs:7,memoryKb:7}]);
   assert.doesNotMatch(JSON.stringify(judged.data),/PRIVATE-|"tests"|referenceCode|reference_code/);
   assert.match(judged.headers.get('cache-control')??'',/no-store/);
   await request(resultPath,{auth:legacy,status:404});
   await request(resultPath,{auth:admin,status:404});
   const completed = (await request(publicPath,{auth:outsider})).data;
   assert.equal(completed.chapters[0].problems[0].solved,true);
   assert.deepEqual([completed.totalExercises,completed.completedExercises,completed.completedChapters],[2,1,0]);
   const otherProgress = (await request(publicPath,{auth:legacy})).data;
   assert.equal(otherProgress.chapters[0].problems[0].solved,false);
   assert.equal(otherProgress.completedExercises,0);
   const completedSummary = (await request('/practice/catalog',{auth:outsider})).data.courses.find(item => item.id === listing.id);
   assert.deepEqual([completedSummary.totalExercises,completedSummary.completedExercises],[2,1]);
   await request(`/platform/problem-publications/${first.problemId}/withdraw`, {auth:platform,method:'POST',
    body:{schoolId:LEGACY_SCHOOL_ID,versionId:first.versionId}});
   const withdrawn = (await request(publicPath,{auth:outsider})).data;
   assert.deepEqual(withdrawn.chapters[0].problems,[{...last,solved:false}]);
   assert.deepEqual([withdrawn.totalExercises,withdrawn.completedExercises],[1,0]);
   await request(practicePath+'?versionId='+first.versionId,{auth:outsider,status:404});
   await request(practicePath+'/submissions',{auth:outsider,method:'POST',status:404,
    body:{versionId:first.versionId,kind:'submit',code:'print(7)',requestId:randomUUID()}});
   await request(publicPath+`/chapters/${chapter.id}/read`,{auth:outsider,method:'POST',body:{expectedRevision:version.revision,read:true}});
   const originalSummary = (await request('/practice/catalog',{auth:outsider})).data.courses.find(item => item.id === listing.id);
   assert.deepEqual([originalSummary.category,originalSummary.difficulty,originalSummary.coverKey,originalSummary.completedChapters],
     ['Python','beginner','general',1]);
   await request(schoolPath,{auth:outsider,status:403});
   const preview = (await request('/platform/course-publications',{auth:platform})).data.items.find(item=>item.courseId===original.id);
   assert.deepEqual(preview.chapters,[{id:chapter.id,title:'First lesson',body:'Reviewed original lesson.'},
    {id:secondChapter.id,title:'Second lesson',body:'Second reviewed lesson.'}]);
   await request(`/chapters/${chapter.id}`,{auth:legacy,method:'PATCH',body:{content:'Updated lesson.'}});
   await request(publicPath,{auth:outsider,status:404});
   const publish = {schoolId:LEGACY_SCHOOL_ID,courseId:original.id,revision:preview.revision,sourceVersion:preview.sourceVersion};
   await request('/platform/course-publications',{auth:platform,method:'POST',body:publish,status:409});
   const fresh = (await request('/platform/course-publications',{auth:platform})).data.items.find(item=>item.courseId===original.id);
   assert.notEqual(fresh.sourceVersion,preview.sourceVersion);
   assert.equal(fresh.revision,preview.revision+1);
   await request('/platform/course-publications',{auth:platform,method:'POST',status:201,
    body:{...publish,revision:fresh.revision,sourceVersion:fresh.sourceVersion}});
   assert.equal((await request(publicPath,{auth:outsider})).data.chapters[0].body,'Updated lesson.');
   const updatedSummary = (await request('/practice/catalog',{auth:outsider})).data.courses.find(item => item.id === listing.id);
   assert.equal(updatedSummary.completedChapters,0,'read count excludes progress for changed lesson text');
   assert.equal((await request('/schools',{auth:outsider})).data.items.length,0);
   await request(schoolPath+'/unpublish',{auth:legacy,method:'POST',body:{}});
   await request(publicPath,{auth:outsider,status:404});
  });
 } finally {await app?.close();await worker?.end();await owner.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
});
