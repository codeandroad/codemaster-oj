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

const sections=[
 {key:'number-systems',title:'Number systems',groupKey:'contest-1',groupTitle:'Contest 1',localizations:{en:{title:'Number systems',groupTitle:'Contest 1'},zh:{title:'数制',groupTitle:'第一轮'}}},
 {key:'recursion',title:'Recursion',groupKey:'contest-1',groupTitle:'Contest 1'},
];
const noPrivateAnswers=value=>assert.ok(!JSON.stringify(value).includes('private-checkpoint-answer'));

test('course sections retain ownership, publication snapshots and shared lesson progress', {skip:!process.env.TEST_DATABASE_URL,timeout:180000},async t=>{
 const base=new URL(process.env.TEST_DATABASE_URL);assert.match(base.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 const schema='course_sections_'+randomBytes(5).toString('hex'),manager=createPool(base.href),scoped=new URL(base);
 scoped.searchParams.set('options',`-csearch_path=${schema}`);const pool=createPool(scoped.href);let server;
 try{
  await manager.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];await pool.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password),users={};
  for(const name of ['legacy-teacher','legacy-peer','legacy-student','admin','teacher','student','outsider']){
   const identityId=randomUUID(),kind=name==='legacy-student'?'student':name.startsWith('legacy-')?'teacher':'personal';
   await pool.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)',[identityId,kind,name]);
   users[name]=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,name,passwordHash])).rows[0];users[name].identityId=identityId;
   if(name.startsWith('legacy-')){await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[users[name].id,kind]);await pool.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING',[users[name].id]);}
   else await pool.query('DELETE FROM legacy_school_account_ownership WHERE account_id=$1',[users[name].id]);
  }
  const school=await provisionSchool(pool,{slug:'section-school',name:'Section School',adminUsername:'admin'});
  for(const name of ['teacher','student']){
   await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)',[school.id,users[name].id,name]);
   await pool.query('INSERT INTO school_identities(school_id,kind,number,name,account_id) VALUES($1,$2,$3,$3,$4)',[school.id,name,name,users[name].id]);
  }
  await pool.query('INSERT INTO platform_admins(account_id) VALUES($1)',[users.admin.id]);
  const runtime=new URL(scoped);runtime.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const origin='http://course-sections.test';server=await createApiApplication({databaseUrl:runtime.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});await server.listen(0,'127.0.0.1');const host=await server.getUrl();
  const auth={};
  async function request(path,name,{method='GET',body,status=200,csrf=true}={}){
   const a=auth[name];const response=await fetch(host+'/api/v1'+path,{method,headers:{Origin:origin,...(a?{Cookie:a.cookie,...(csrf?{'X-CSRF-Token':a.csrfToken}:{})}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);
   if(path==='/auth/login')auth[name]={cookie:response.headers.get('set-cookie')?.split(';')[0],csrfToken:data.csrfToken};return data;
  }
  for(const name of Object.keys(users))await request('/auth/login',name,{method:'POST',body:{username:name,password}});
  const post=(path,name,body,status=200)=>request(path,name,{method:'POST',body,status}),patch=(path,name,body,status=200)=>request(path,name,{method:'PATCH',body,status});
  const document={format:'codemaster-learning-path',version:1,title:'Intermediate foundations',description:'Grouped course',category:'ACSL',estimatedMinutes:60,sections,chapters:[{title:'Digits',content:'Place values',sectionKey:'number-systems',checkpointAnswer:'private-checkpoint-answer',problemIds:[]},{title:'Recursion',content:'Base case',sectionKey:'recursion',problemIds:[]}]};
  let legacy,schoolCourse,platform;
  await t.test('legacy import, edit and chapter references respect ownership and preserve progress',async()=>{
   await post('/learning-paths/import','legacy-teacher',{...document,chapters:[{...document.chapters[0],sectionKey:'missing'}]},400);
   legacy=await post('/learning-paths/import','legacy-teacher',document,201);const path='/learning-paths/'+legacy.id;
   legacy=await request(path,'legacy-teacher');assert.deepEqual(legacy.sections,sections);assert.deepEqual(legacy.chapters.map(c=>c.sectionKey),['number-systems','recursion']);
   await request(path,'legacy-student',{status:404});await patch(path,'legacy-peer',{sections:[]},403);await patch(path,'legacy-student',{sections:[]},403);
   await patch(path,'legacy-teacher',{sections:[]},400);
   await patch('/chapters/'+legacy.chapters[0].id,'legacy-teacher',{sectionKey:'missing'},400);
   await post(path+'/chapters','legacy-teacher',{title:'Bad section',content:'Body',sectionKey:'missing'},400);
   const extra=await post(path+'/chapters','legacy-teacher',{title:'Additional',content:'Body',sectionKey:'number-systems'},201);assert.equal(extra.sectionKey,'number-systems');
   await request(path+'/publish','legacy-teacher',{method:'POST',body:{},csrf:false,status:403});await post(path+'/publish','legacy-teacher',{});
   await post('/chapters/'+legacy.chapters[0].id+'/progress','legacy-student',{completed:true});
   await patch('/chapters/'+legacy.chapters[0].id,'legacy-teacher',{title:'Digits renamed'});
   const renamed=sections.map(s=>({...s,title:s.title+' topic'}));await patch(path,'legacy-teacher',{sections:renamed});
   const after=await request(path,'legacy-student');assert.equal(after.completedChapters,1);assert.equal(after.chapters[0].id,legacy.chapters[0].id);assert.equal(after.chapters[0].sectionKey,'number-systems');assert.deepEqual(after.sections,renamed);
   await patch(path,'legacy-teacher',{sections});legacy=await request(path,'legacy-teacher');
   const old=await post('/learning-paths/import','legacy-teacher',{...document,sections:undefined,chapters:[{...document.chapters[0],sectionKey:undefined}]},201);
   const oldDetail=await request('/learning-paths/'+old.id,'legacy-teacher');assert.deepEqual(oldDetail.sections,[]);assert.equal(oldDetail.chapters[0].sectionKey,null);
   await patch('/chapters/'+oldDetail.chapters[0].id,'legacy-teacher',{sectionKey:'number-systems'},400);
  });
  await t.test('school publication freezes the directory and grouping changes keep the same reading progress',async()=>{
   const chapter={id:randomUUID(),title:'Digits',body:'Place values',sectionKey:'number-systems',checkpointAnswer:'private-checkpoint-answer',problems:[]};
   const input={requestId:randomUUID(),title:document.title,description:document.description,sections,accessScope:'school',classIds:[],chapters:[chapter]};
   schoolCourse=await post(`/schools/${school.id}/courses`,'teacher',input,201);const path=`/schools/${school.id}/courses/${schoolCourse.id}`;
   assert.deepEqual(schoolCourse.sections,sections);assert.equal(schoolCourse.chapters[0].sectionKey,chapter.sectionKey);
   await request(path,'student',{status:404});await request(path,'outsider',{status:404});
   schoolCourse=await post(path+'/publish','teacher',{expectedRevision:schoolCourse.revision});
   await post(path+`/chapters/${chapter.id}/read`,'student',{expectedRevision:schoolCourse.revision,read:true});
   const changed=sections.map(s=>({...s,title:s.title+' revised'}));
   schoolCourse=await patch(path,'teacher',{...input,expectedRevision:schoolCourse.revision,sections:changed,chapters:[{...chapter,sectionKey:undefined}]});
   assert.equal(schoolCourse.chapters[0].sectionKey,'number-systems');assert.deepEqual((await request(path,'student')).sections,sections);
   await patch(path,'teacher',{...input,expectedRevision:schoolCourse.revision,sections:[]},400);
   await patch(path,'student',{...input,expectedRevision:schoolCourse.revision},403);
   schoolCourse=await post(path+'/publish','teacher',{expectedRevision:schoolCourse.revision});
   const after=await request(path,'student');assert.deepEqual(after.sections,changed);assert.equal(after.completedChapters,1);assert.equal(after.chapters[0].read,true);
  });
  await t.test('public listings preserve school and legacy section snapshots without checkpoint answers',async()=>{
   const candidates=(await request('/platform/course-publications','admin')).items;
   const old=candidates.find(c=>c.courseId===legacy.id);assert.deepEqual(old.sections,sections);assert.equal(old.chapters[0].sectionKey,'number-systems');
   const listing=await post('/platform/course-publications','admin',{schoolId:LEGACY_SCHOOL_ID,courseId:legacy.id,revision:old.revision,sourceVersion:old.sourceVersion},201);
   const publicPath='/practice/courses/'+listing.id;
   const before=await request(publicPath,'outsider');assert.deepEqual(before.sections,sections);assert.equal(before.chapters[0].sectionKey,'number-systems');noPrivateAnswers(before);
   await patch('/learning-paths/'+legacy.id,'legacy-teacher',{sections:sections.map(s=>({...s,title:s.title+' draft'}))});
   await request(publicPath,'outsider',{status:404});
   const stored=(await pool.query('SELECT sections,chapters FROM legacy_course_publication_versions WHERE course_id=$1 AND revision=$2',[legacy.id,old.revision])).rows[0];
   assert.deepEqual(stored.sections,sections,'Reapproval is required after legacy edits; its previous snapshot remains intact.');assert.equal(stored.chapters[0].sectionKey,'number-systems');
   const schoolListing=await post('/platform/course-publications','admin',{schoolId:school.id,courseId:schoolCourse.id,revision:schoolCourse.publishedRevision},201);
   const schoolPublic=await request('/practice/courses/'+schoolListing.id,'outsider');assert.deepEqual(schoolPublic.sections,schoolCourse.sections);assert.equal(schoolPublic.chapters[0].sectionKey,'number-systems');noPrivateAnswers(schoolPublic);
  });
  await t.test('platform courses validate references and expose the same directory through the public reader',async()=>{
   await request('/platform/courses','teacher',{status:403});
   platform=await post('/platform/courses','admin',{requestId:randomUUID(),title:'Unified platform course',audienceScope:'all',sections,chapters:[{title:'Digits',content:'Place values',sectionKey:'number-systems'}]},201);
   const path='/platform/courses/'+platform.id,revision=()=>({expectedRevision:platform.revision,sourceVersion:platform.sourceVersion});
   assert.deepEqual(platform.sections,sections);assert.equal(platform.chapters[0].sectionKey,'number-systems');
   await patch(path,'admin',{...revision(),sections:[]},400);
   await patch(path,'admin',{...revision(),chapters:[{...platform.chapters[0],sectionKey:'missing'}]},400);
   platform=await patch(path,'admin',{...revision(),chapters:platform.chapters.map(c=>({id:c.id,title:c.title,content:c.content}))});assert.equal(platform.chapters[0].sectionKey,'number-systems');
   platform=await post(path+'/publish','admin',revision());
   let publicCourse=await request('/practice/courses/'+platform.id,'outsider');assert.deepEqual(publicCourse.sections,sections);assert.equal(publicCourse.chapters[0].sectionKey,'number-systems');
   await post(`/practice/courses/${platform.id}/chapters/${platform.chapters[0].id}/read`,'outsider',{expectedRevision:platform.revision,read:true});
   platform=await patch(path,'admin',{...revision(),sections:sections.map(s=>({...s,title:s.title+' revised'}))});
   publicCourse=await request('/practice/courses/'+platform.id,'outsider');assert.equal(publicCourse.completedChapters,1);assert.equal(publicCourse.chapters[0].id,platform.chapters[0].id);assert.deepEqual(publicCourse.sections,platform.sections);
   platform=await patch(path,'admin',{...revision(),sections:[],chapters:platform.chapters.map(c=>({...c,sectionKey:null}))});assert.deepEqual(platform.sections,[]);assert.equal(platform.chapters[0].sectionKey,null);
  });
 }finally{if(server)await server.close();await pool.end();await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await manager.end();}
});
