import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { normalizeSchoolProblem } from '../../../packages/domain/src/school-practice.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school course HTTP lifecycle preserves published boundaries and stable learning progress',
 { skip: !process.env.TEST_DATABASE_URL, timeout: 90000 }, async t => {
  const baseUrl = new URL(process.env.TEST_DATABASE_URL);
  assert.match(baseUrl.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/, 'course integration fixtures must use the isolated QA database');
  const manager = createPool(baseUrl.href);
  const schema = 'school_courses_' + randomBytes(6).toString('hex');
  const schemaUrl = new URL(baseUrl);
  schemaUrl.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(schemaUrl.href);
  const password = randomBytes(24).toString('base64url');
  const origin = 'http://school-courses.test';
  let app;
  let schemaCreated = false;
  try {
   await manager.query(`CREATE SCHEMA ${schema}`);
   schemaCreated = true;
   await migrate(pool);
   await bootstrap(pool, { name: 'Legacy administrator', number: 'ADM', username: 'legacy-admin', password });
   const passwordHash = await hashPassword(password);
   for (const username of ['alpha-admin', 'beta-admin', 'teacher', 'other-teacher', 'student', 'new-login', 'unlinked-student']) {
    await transaction(pool, async db => {
     const identityId = randomUUID();
     await db.query("INSERT INTO identities(id,kind,number,name) VALUES($1,'student',$2,$2)", [identityId,username]);
     await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3)', [identityId,username,passwordHash]);
    });
   }
   app = await createApiApplication({ databaseUrl: schemaUrl.href, logger: false,
    config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: origin, COOKIE_SECURE: 'false' }) });
   await app.listen(0,'127.0.0.1');
   const base = await app.getUrl();
   async function request(path, { method='GET', body, auth, status=200, csrf=true }={}) {
    const response = await fetch(base+'/api/v1'+path, { method,
     headers: { Origin: origin, ...(body !== undefined && { 'Content-Type':'application/json' }),
      ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token':auth.csrfToken }) }) },
     body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    const expected = Array.isArray(status) ? status : [status];
    assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(data.error??{})}; expected ${expected}`);
    return { data, status:response.status, cookie:response.headers.get('set-cookie')?.split(';')[0], headers:response.headers };
   }
   const login = async username => {
    const { data,cookie } = await request('/auth/login',{method:'POST',body:{username,password}});
    return {id:data.user.id,roles:data.user.roles,csrfToken:data.csrfToken,cookie};
   };
   const legacy = await login('legacy-admin');
   const admin = await login('alpha-admin');
   const betaAdmin = await login('beta-admin');
   const teacher = await login('teacher');
   const otherTeacher = await login('other-teacher');
   const student = await login('student');
   const newLogin = await login('new-login');
   const unlinked = await login('unlinked-student');
   const alpha = await provisionSchool(pool,{slug:'courses-alpha',name:'Alpha',adminUsername:'alpha-admin'});
   const beta = await provisionSchool(pool,{slug:'courses-beta',name:'Beta',adminUsername:'beta-admin'});
   const school = (id,resource) => `/schools/${id}/${resource}`;
   const post = (path,auth,body,status=201) => request(path,{method:'POST',auth,body,status});
   const patch = (path,auth,body,status=200) => request(path,{method:'PATCH',auth,body,status});
   const remove = (path,auth,status=200) => request(path,{method:'DELETE',auth,status});
   for (const [member,role] of [[teacher,'teacher'],[otherTeacher,'teacher'],[student,'student'],[newLogin,'student'],[unlinked,'student']]) {
    const invitation = (await post(school(alpha.id,'invitations'),admin,{role})).data;
    await post('/school-invitations/accept',member,{token:invitation.token},200);
   }
   const teacherIdentity = (await post(school(alpha.id,'identities'),admin,{kind:'teacher',number:'T1',name:'Teacher',accountId:teacher.id})).data;
   let studentIdentity = (await post(school(alpha.id,'identities'),admin,{kind:'student',number:'S1',name:'Learner',accountId:student.id})).data;
   const classA = (await post(school(alpha.id,'classes'),admin,{name:'Alpha A',type:'training'})).data;
   const classB = (await post(school(alpha.id,'classes'),admin,{name:'Alpha B',type:'training'})).data;
   const foreignClass = (await post(school(beta.id,'classes'),betaAdmin,{name:'Beta A',type:'training'})).data;
   const roster = school(alpha.id,`classes/${classA.id}/roster`);
   await post(roster,admin,{identityId:teacherIdentity.id});
   await post(roster,admin,{identityId:studentIdentity.id});
   const legacyBaseline=(await pool.query(`SELECT (SELECT count(*)::int FROM submissions) submissions,
    (SELECT count(*)::int FROM luq_ledger) luq, (SELECT count(*)::int FROM learning_paths) courses`)).rows[0];
   const courses = school(alpha.id,'courses');
   const chapterA = {id:randomUUID(),title:'Introduction',body:'# Introduction\n\nOriginal **published** body.'};
   const chapterB = {id:randomUUID(),title:'Next chapter',body:'Second chapter.'};
   const input = {requestId:randomUUID(),title:'Published course',description:'Published description',chapters:[chapterA,chapterB],accessScope:'school',classIds:[]};
   let course;
   let coursePath;
   let revision;
   const get = (auth=teacher) => request(coursePath,{auth});
   const save = async (changes={},status=200) => {
    const result = await patch(coursePath,teacher,{...input,...changes,expectedRevision:revision},status);
    if(result.status===200)revision=result.data.revision;
    return result.data;
   };
   const publish = async (auth=teacher,status=200) => {
    const result = await post(coursePath+'/publish',auth,{expectedRevision:revision},status);
    if(result.status===200)revision=result.data.revision;
    return result.data;
   };
   const readPath = chapterId => coursePath+`/chapters/${chapterId}/read`;

   await t.test('membership authorization, CSRF, idempotent creates and draft privacy', async () => {
    await request(courses,{status:401});
    await request(courses,{auth:legacy,status:404});
    await request(courses,{auth:betaAdmin,status:404});
    await request(school(LEGACY_SCHOOL_ID,'courses'),{auth:legacy,status:404});
    await post(courses,student,input,403);
    await request(courses,{method:'POST',auth:teacher,body:input,csrf:false,status:403});
    const retries = await Promise.all([post(courses,teacher,input,[200,201]),post(courses,teacher,input,[200,201])]);
    assert.deepEqual(retries.map(r=>r.status).sort(),[200,201]);
    course = retries[0].data;
    coursePath = courses+'/'+course.id;
    revision = course.revision;
    assert.equal(retries[1].data.id,course.id);
    assert.equal(course.status,'draft');
    assert.equal(course.canTrackProgress,false);
    assert.equal(course.canManage,true);
    await post(courses,teacher,{...input,title:'Different replay'},409);
    assert.equal((await request(courses,{auth:teacher})).data.items.length,1);
    assert.deepEqual((await request(courses,{auth:otherTeacher})).data.items,[]);
    assert.equal((await request(courses,{auth:admin})).data.items.length,1);
    assert.deepEqual((await request(courses,{auth:student})).data.items,[]);
    await request(coursePath,{auth:student,status:404});
    await request(coursePath,{auth:otherTeacher,status:404});
    const createdAudit = await pool.query("SELECT count(*)::int n FROM school_audit_events WHERE target_id=$1 AND action='school.course.create'",[course.id]);
    assert.equal(createdAudit.rows[0].n,1);
   });

   await t.test('published snapshots hide drafts and reject stale concurrent edits', async () => {
    await publish();
    const studentView = await get(student);
    assert.match(studentView.headers.get('cache-control'),/no-store/);
    assert.equal(studentView.data.revision,revision);
    assert.equal(studentView.data.canTrackProgress,true);
    assert.equal(studentView.data.title,input.title);
    const draft = {...input,title:'Secret draft title',description:'Secret draft description',chapters:[{...chapterA,body:'Unpublished confidential chapter'},chapterB]};
    const races = await Promise.all([
     patch(coursePath,teacher,{...draft,expectedRevision:revision},[200,409]),
     patch(coursePath,teacher,{...draft,expectedRevision:revision},[200,409]),
    ]);
    assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
    revision=races.find(r=>r.status===200).data.revision;
    assert.equal((await get()).data.hasUnpublishedChanges,true);
    const after = (await get(student)).data;
    assert.equal(after.title,input.title);
    assert.equal(after.description,input.description);
    assert.equal(after.chapters[0].body,chapterA.body);
    assert.equal(after.hasUnpublishedChanges,false);
    assert.deepEqual((await request(courses+'?q=Secret',{auth:student})).data.items,[]);
    assert.equal((await request(courses+'?q=Published',{auth:student})).data.items.length,1);
    assert.equal((await request(courses+'?q=Secret',{auth:teacher})).data.items.length,1);
    await post(coursePath+'/publish',teacher,{expectedRevision:revision-1},409);
    await save();
    await publish();
   });

   await t.test('progress uses stable school identity, content digests and published revision', async () => {
    const staleRevision=revision;
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},200);
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},200);
    assert.equal((await get(student)).data.completedChapters,1);
    assert.equal((await request(courses,{auth:student})).data.items[0].completedChapters,1);
    await post(readPath(chapterA.id),teacher,{read:true,expectedRevision:revision},403);
    await post(readPath(randomUUID()),student,{read:true,expectedRevision:revision},404);
    await post(readPath(chapterA.id),student,{read:'yes',expectedRevision:revision},400);
    assert.equal((await get(unlinked)).data.canTrackProgress,false);
    await post(readPath(chapterA.id),unlinked,{read:true,expectedRevision:revision},409);
    await save({chapters:[chapterB,chapterA]});
    await publish();
    assert.equal((await get(student)).data.completedChapters,1,'reordering must preserve read status');
    await post(readPath(chapterB.id),student,{read:true,expectedRevision:staleRevision},409);
    assert.equal((await get(student)).data.completedChapters,1,'an old view must not mark a new publication as read');
    await save({chapters:[{...chapterA,body:'Revised chapter content'},chapterB]});
    await publish();
    assert.equal((await get(student)).data.completedChapters,0,'revised content must be read again');
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},200);
    const bind=school(alpha.id,`identities/${studentIdentity.id}/account`);
    await patch(bind,admin,{accountId:null,expectedAccountId:student.id});
    assert.equal((await get(student)).data.canTrackProgress,false);
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},409);
    await patch(bind,admin,{accountId:newLogin.id});
    assert.equal((await get(newLogin)).data.completedChapters,1,'progress follows identity after account relinking');
    await patch(bind,admin,{accountId:null,expectedAccountId:newLogin.id});
    await patch(bind,admin,{accountId:student.id});
    assert.equal((await get(student)).data.completedChapters,1);
    const records=await pool.query('SELECT count(*)::int n FROM school_course_progress WHERE course_id=$1 AND identity_id=$2',[course.id,studentIdentity.id]);
    assert.equal(records.rows[0].n,1,'duplicate reads and account relinks never duplicate progress');
   });

   await t.test('class audience is scoped, published, and rechecked against current membership and roster', async () => {
    await save({accessScope:'classes',classIds:[foreignClass.id]},404);
    await save({accessScope:'classes',classIds:[classB.id]},404);
    await save({accessScope:'classes',classIds:[]});
    await publish(teacher,409);
    await save({accessScope:'classes',classIds:[classA.id]});
    assert.equal((await get(unlinked)).data.accessScope,'school','draft audience must not change published access');
    await publish();
    assert.equal((await get(student)).data.accessScope,'classes');
    assert.deepEqual((await get(student)).data.classIds,[],'student payload does not disclose other audience class IDs');
    await request(coursePath,{auth:unlinked,status:404});
    assert.deepEqual((await request(courses,{auth:unlinked})).data.items,[]);
    await remove(roster+'/'+studentIdentity.id,admin);
    await request(coursePath,{auth:student,status:404});
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},404);
    assert.deepEqual((await request(courses,{auth:student})).data.items,[]);
    await post(roster,admin,{identityId:studentIdentity.id});
    assert.equal((await get(student)).data.completedChapters,0);
    await remove(roster+'/'+teacherIdentity.id,admin);
    await publish(teacher,404);
    await post(roster,admin,{identityId:teacherIdentity.id});
    await remove(school(alpha.id,`members/${student.id}`),admin);
    await request(coursePath,{auth:student,status:404});
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},404);
    const invitation=(await post(school(alpha.id,'invitations'),admin,{role:'student'})).data;
    await post('/school-invitations/accept',student,{token:invitation.token},200);
    await patch(school(alpha.id,`identities/${studentIdentity.id}/account`),admin,{accountId:student.id},404);
    const archived=(await pool.query('SELECT archived_at,account_id FROM school_identities WHERE id=$1',[studentIdentity.id])).rows[0];
    assert.ok(archived.archived_at);
    assert.equal(archived.account_id,null);
    assert.equal((await pool.query('SELECT count(*)::int n FROM school_course_progress WHERE course_id=$1 AND identity_id=$2',[course.id,studentIdentity.id])).rows[0].n,1);
    studentIdentity=(await post(school(alpha.id,'identities'),admin,{kind:'student',number:'S1-return',name:'Learner',accountId:student.id})).data;
    await post(roster,admin,{identityId:studentIdentity.id});
    assert.equal((await get(student)).data.completedChapters,0,'a new school dossier does not inherit archived course progress');
   });

   await t.test('unpublish revokes contents and writes immediately and administrator retains management', async () => {
    const unpublished = await post(coursePath+'/unpublish',admin,{expectedRevision:revision},200);
    revision=unpublished.data.revision;
    assert.equal(unpublished.data.status,'unpublished');
    await request(coursePath,{auth:student,status:404});
    await post(readPath(chapterA.id),student,{read:true,expectedRevision:revision},404);
    assert.deepEqual((await request(courses,{auth:student})).data.items,[]);
    await save({chapters:[]});
    await publish(teacher,409);
    await save({chapters:[{...chapterA,body:''}]});
    await publish(teacher,409);
    await save();
    await publish(admin);
    assert.equal((await get(student)).data.status,'published');
    await patch(coursePath,otherTeacher,{...input,expectedRevision:revision},404);
    await request(school(beta.id,'courses/'+course.id),{auth:betaAdmin,status:404});
   });

   await t.test('catalogue metadata, student preview and archive preserve the approved edition and progress', async () => {
    const ci={...input,requestId:randomUUID(),title:'Parity catalogue',category:'Python',difficulty:'intermediate',coverKey:'python',estimatedMinutes:90,authorName:'Course author',authoredAt:'2026-01-02T00:00:00Z'};
    let c=(await post(courses,teacher,ci)).data;const cp=courses+'/'+c.id;
    assert.equal(c.category,'Python');assert.equal(c.estimatedMinutes,90);
    await post(courses,teacher,{...ci,requestId:randomUUID(),coverImage:'https://example.com/private.svg'},400);
    c=(await post(cp+'/publish',teacher,{expectedRevision:c.revision},200)).data;
    await post(cp+'/chapters/'+chapterA.id+'/read',student,{read:true,expectedRevision:c.revision},200);
    c=(await patch(cp,teacher,{...ci,category:'Secret draft',authorName:'Secret draft author',expectedRevision:c.revision})).data;
    assert.equal((await request(cp,{auth:student})).data.category,'Python');
    assert.equal((await request(cp+'/preview',{auth:teacher})).data.category,'Python');
    await request(cp+'/preview',{auth:student,status:403});
    await request(cp+'/archive',{method:'POST',auth:teacher,csrf:false,body:{expectedRevision:c.revision},status:403});
    const races=await Promise.all([post(cp+'/archive',teacher,{expectedRevision:c.revision},[200,409]),post(cp+'/archive',teacher,{expectedRevision:c.revision},[200,409])]);
    assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);c=races.find(r=>r.status===200).data;
    assert.equal(c.archived,true);assert.equal((await request(courses+'?archived=true',{auth:teacher})).data.items.some(x=>x.id===c.id),true);
    await request(cp,{auth:student,status:404});await request(courses+'?archived=true',{auth:student,status:403});
    await post(cp+'/publish',teacher,{expectedRevision:c.revision},409);
    c=(await post(cp+'/restore',teacher,{expectedRevision:c.revision},200)).data;
    assert.equal(c.archived,false);assert.equal(c.status,'unpublished');await request(cp,{auth:student,status:404});
    c=(await post(cp+'/publish',teacher,{expectedRevision:c.revision},200)).data;
    assert.equal((await request(cp,{auth:student})).data.completedChapters,1);
   });

   await t.test('learning resource CRUD scopes bodies, course audience, revisions, and idempotent retries', async () => {
    const resources=school(alpha.id,'learning-resources');
    let c=(await post(courses,teacher,{...input,requestId:randomUUID(),title:'Resource course',accessScope:'classes',classIds:[classA.id]})).data;
    const cp=courses+'/'+c.id;
    const ri={requestId:randomUUID(),title:'Private resource',type:'reference',scope:'private',content:'PRIVATE RESOURCE BODY',courseId:c.id,chapterId:chapterA.id};
    const [a,b]=await Promise.all([post(resources,teacher,ri,[200,201]),post(resources,teacher,ri,[200,201])]);
    assert.equal(a.data.id,b.data.id);let r=a.data;const rp=resources+'/'+r.id;
    await request(rp,{auth:student,status:404});await request(rp,{auth:otherTeacher,status:404});await request(school(beta.id,'learning-resources/'+r.id),{auth:betaAdmin,status:404});
    await post(resources,student,{...ri,requestId:randomUUID()},403);
    await request(resources,{method:'POST',auth:teacher,csrf:false,body:{...ri,requestId:randomUUID()},status:403});
    assert.equal(JSON.stringify((await request(resources,{auth:student})).data).includes('PRIVATE'),false);
    r=(await patch(rp,teacher,{...ri,scope:'school',expectedRevision:r.revision})).data;
    await request(rp,{auth:student,status:404});
    c=(await post(cp+'/publish',teacher,{expectedRevision:c.revision},200)).data;
    assert.equal((await request(rp,{auth:student})).data.content,ri.content);
    assert.equal('content' in (await request(resources,{auth:student})).data.items.find(x=>x.id===r.id),false);
    await request(rp,{auth:unlinked,status:404});
    await patch(rp,teacher,{...ri,scope:'school',expectedRevision:r.revision-1},409);
    await patch(rp,student,{...ri,scope:'school',expectedRevision:r.revision},403);
    const foreign=(await post(school(beta.id,'courses'),betaAdmin,{...input,requestId:randomUUID(),title:'Foreign'})).data;
    await post(resources,teacher,{...ri,requestId:randomUUID(),courseId:foreign.id},404);
    await post(resources,teacher,{...ri,requestId:randomUUID(),chapterId:randomUUID()},404);
    c=(await post(cp+'/archive',teacher,{expectedRevision:c.revision},200)).data;
    await request(rp,{auth:student,status:404});
    await request(rp,{method:'DELETE',auth:teacher,body:{expectedRevision:r.revision}});
    await request(rp,{auth:teacher,status:404});
    assert.ok((await pool.query('SELECT deleted_at FROM school_learning_resources WHERE id=$1',[r.id])).rows[0].deleted_at);
   });

   await t.test('chapter practice pins the approved school version and uses stable identity formal AC', async () => {
    const bank=randomUUID(),problem=randomUUID(),unpublished=randomUUID(),version=randomUUID(),nextVersion=randomUUID();
    const definition=normalizeSchoolProblem({title:'Safe title',statement:'Read an integer and output it.',mode:'stdio',referenceCode:'print(input()) # PRIVATE_CODE',samples:[{input:'1',expected:'1'}],tests:[{input:'SECRET_TEST',expected:'SECRET_TEST',weight:100}]});
    await transaction(pool,async db=>{
     await db.query("SELECT set_config('campus.school_id',$1,true)",[alpha.id]);
     await db.query('INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,request_id) VALUES($1,$2,$3,$4,$5)',[alpha.id,bank,teacher.id,'Practice fixtures',randomUUID()]);
     await db.query('INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5,$6)',[alpha.id,problem,bank,teacher.id,definition,randomUUID()]);
     await db.query('INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id) VALUES($1,$2,$3,$4,$5,$6)',[alpha.id,unpublished,bank,teacher.id,definition,randomUUID()]);
     await db.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) VALUES($1,$2,$3,1,$4)',[alpha.id,version,problem,definition]);
     await db.query('UPDATE school_problems SET published=true,published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,problem,version]);
    });
    const ci={...input,requestId:randomUUID(),title:'Practice course',chapters:[{...chapterA,problems:[{problemId:problem,versionId:version}]}]};
    await post(courses,teacher,{...ci,requestId:randomUUID(),chapters:[{...chapterA,problems:[{problemId:randomUUID(),versionId:version}]}]},409);
    let c=(await post(courses,teacher,ci)).data;const cp=courses+'/'+c.id;
    c=(await post(cp+'/publish',teacher,{expectedRevision:c.revision},200)).data;
    let view=(await request(cp,{auth:student})).data;assert.equal(view.totalExercises,1);assert.equal(view.completedExercises,0);
    assert.equal(JSON.stringify(view).includes('PRIVATE_CODE'),false);assert.equal(JSON.stringify(view).includes('SECRET_TEST'),false);
    const tutorialPath=school(alpha.id,`problems/${problem}/tutorial`);
    const tutorialView=tutorialPath+'?'+new URLSearchParams({versionId:version,courseId:c.id,chapterId:chapterA.id});
    const originalTutorial={source:'course',courseTitle:ci.title,title:chapterA.title,body:chapterA.body};
    assert.deepEqual((await request(tutorialView,{auth:student})).data.tutorial,originalTutorial);
    c=(await patch(cp,teacher,{...ci,chapters:[{...ci.chapters[0],body:'UNPUBLISHED_CHAPTER'}],expectedRevision:c.revision})).data;
    assert.deepEqual((await request(tutorialView,{auth:student})).data.tutorial,originalTutorial);
    assert.deepEqual((await request(tutorialView,{auth:teacher})).data.tutorial,originalTutorial);
    await request(tutorialView,{auth:betaAdmin,status:404});
    await request(tutorialPath+'?manage=true',{auth:student,status:403});
    const settings={mode:'custom',body:'## Independent tutorial',expectedRevision:0};
    const problemPath=school(alpha.id,`problems/${problem}`);
    const peerProblem=(await request(problemPath,{auth:otherTeacher})).data;
    assert.equal(peerProblem.canManage,false);
    assert.equal(peerProblem.canManageTutorial,true);
    assert.equal(peerProblem.definition.referenceCode,undefined);
    const peerRow=(await request(school(alpha.id,'problems'),{auth:otherTeacher})).data.items.find(item=>item.id===problem);
    assert.equal(peerRow.canManageTutorial,true);
    assert.equal((await request(problemPath,{auth:student})).data.canManageTutorial,false);
    await patch(problemPath,otherTeacher,{...definition,expectedRevision:1},403);
    await patch(school(alpha.id,`problems/${unpublished}/tutorial`),otherTeacher,settings,404);
    await patch(tutorialPath,betaAdmin,settings,404);
    assert.equal((await request(tutorialPath+'?manage=true',{auth:otherTeacher})).data.revision,0);
    assert.equal((await patch(tutorialPath,otherTeacher,settings)).data.revision,1);
    assert.deepEqual((await request(tutorialView,{auth:student})).data.tutorial,{source:'custom',body:settings.body});
    assert.equal((await patch(tutorialPath,admin,{mode:'none',expectedRevision:1})).data.revision,2);
    assert.equal((await request(tutorialView,{auth:student})).data.tutorial,null);
    await patch(tutorialPath,teacher,{mode:'course',expectedRevision:2});
    assert.deepEqual((await request(tutorialView,{auth:student})).data.tutorial,originalTutorial);
    const addJob=async(kind,state='completed')=>pool.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,identity_id,request_id,request_hash,kind,access_context,payload,state,result) VALUES($1,$2,$3,$4,$5,$6,'fixture',$7,'school','{}',$8,'{"status":"AC"}')`,[alpha.id,problem,version,student.id,studentIdentity.id,randomUUID(),kind,state]);
    await addJob('samples');await addJob('submit','queued');assert.equal((await request(cp,{auth:student})).data.completedExercises,0);
    const submitted=(await post(school(alpha.id,`problems/${problem}/submissions`),student,{requestId:randomUUID(),kind:'submit',language:'python',code:'print(input())'},202)).data;
    const snapshot=(await pool.query('SELECT identity_id FROM school_judge_jobs WHERE id=$1',[submitted.id])).rows[0];assert.equal(snapshot.identity_id,studentIdentity.id);
    await pool.query("UPDATE school_judge_jobs SET state='completed',result=$2 WHERE id=$1",[submitted.id,{status:'AC',score:100}]);
    assert.equal((await request(cp,{auth:student})).data.completedExercises,1);
    const bind=school(alpha.id,`identities/${studentIdentity.id}/account`);
    await patch(bind,admin,{accountId:null,expectedAccountId:student.id});await patch(bind,admin,{accountId:newLogin.id});
    assert.equal((await request(cp,{auth:newLogin})).data.completedExercises,1);assert.equal((await request(cp,{auth:student})).data.completedExercises,0);
    await patch(bind,admin,{accountId:null,expectedAccountId:newLogin.id});await patch(bind,admin,{accountId:student.id});
    await pool.query('INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition) VALUES($1,$2,$3,2,$4)',[alpha.id,nextVersion,problem,{title:'New current title'}]);
    await pool.query('UPDATE school_problems SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[alpha.id,problem,nextVersion]);
    view=(await request(cp,{auth:student})).data;assert.equal(view.chapters[0].problems[0].available,false);assert.equal(view.chapters[0].problems[0].title,'Safe title');
    await post(cp+'/publish',teacher,{expectedRevision:c.revision},409);
   });

   await t.test('typed content whitelist, school composite foreign keys, pagination and validation', async () => {
    const indentedMarkdown='    print("Indented code block")\n\nTrailing Markdown break  \n\n';
    const malicious={...input,requestId:randomUUID(),title:'Whitelist course',hiddenTests:'SECRET_TESTS',teacherNotes:'PRIVATE_NOTES',
     chapters:[{...chapterA,body:indentedMarkdown,hiddenTests:'CHAPTER_SECRET',referenceCode:'PRIVATE_CODE'}]};
    const safe=(await post(courses,teacher,malicious)).data;
    assert.equal(JSON.stringify(safe).includes('SECRET'),false);
    assert.equal(JSON.stringify(safe).includes('PRIVATE'),false);
    const stored=(await pool.query('SELECT chapters FROM school_courses WHERE id=$1',[safe.id])).rows[0];
    assert.deepEqual(Object.keys(stored.chapters[0]).sort(),['body','id','problems','title']);
    assert.equal(safe.chapters[0].body,indentedMarkdown,'draft creation must preserve meaningful Markdown whitespace');
    assert.equal(stored.chapters[0].body,indentedMarkdown);
    const whitespacePath=courses+'/'+safe.id;
    const editedMarkdown=indentedMarkdown+'    print("Another indented block")\n';
    const whitespaceEdit=(await patch(whitespacePath,teacher,{...malicious,chapters:[{...chapterA,body:editedMarkdown}],expectedRevision:safe.revision})).data;
    assert.equal(whitespaceEdit.chapters[0].body,editedMarkdown,'draft edits must preserve whitespace');
    await post(whitespacePath+'/publish',teacher,{expectedRevision:whitespaceEdit.revision},200);
    assert.equal((await request(whitespacePath,{auth:student})).data.chapters[0].body,editedMarkdown,'published snapshots must preserve whitespace');
    await assert.rejects(pool.query('INSERT INTO school_course_classes(school_id,course_id,class_id) VALUES($1,$2,$3)',[alpha.id,course.id,foreignClass.id]),{code:'23503'});
    await assert.rejects(pool.query('INSERT INTO school_course_classes(school_id,course_id,class_id) VALUES($1,$2,$3)',[beta.id,course.id,foreignClass.id]),{code:'23503'});
    await post(courses,teacher,{...input,requestId:randomUUID(),chapters:[chapterA,chapterA]},400);
    await post(courses,teacher,{...input,requestId:randomUUID(),title:''},400);
    await post(courses,teacher,{...input,requestId:randomUUID(),classIds:[classA.id]},400);
    await request(courses+'?page=0',{auth:teacher,status:400});
    await transaction(pool,async db=>{
     await db.query("SELECT set_config('campus.school_id',$1,true)",[alpha.id]);
     for(let n=0;n<51;n++)await db.query(`INSERT INTO school_courses(school_id,owner_account_id,title,access_scope,create_request_id,create_request_hash)
      VALUES($1,$2,$3,'school',$4,'fixture')`,[alpha.id,teacher.id,`Pagination ${String(n).padStart(2,'0')}`,randomUUID()]);
    });
    const first=(await request(courses+'?q=Pagination',{auth:teacher})).data;
    const second=(await request(courses+'?q=Pagination&page=2',{auth:teacher})).data;
    assert.equal(first.items.length,50);assert.equal(first.hasMore,true);
    assert.equal(second.items.length,1);assert.equal(second.hasMore,false);
    assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,51);
    assert.deepEqual((await request(courses+'?q=Pagination',{auth:student})).data.items,[]);
    assert.deepEqual((await request('/auth/me',{auth:teacher})).data.user.roles,[]);
    const legacyAfter=(await pool.query(`SELECT (SELECT count(*)::int FROM submissions) submissions,
     (SELECT count(*)::int FROM luq_ledger) luq, (SELECT count(*)::int FROM learning_paths) courses`)).rows[0];
    assert.deepEqual(legacyAfter,legacyBaseline,'school courses must not mutate legacy submissions, Luq or courses');
   });
  } finally {
   await app?.close();
   await pool.end();
   if(schemaCreated)await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
