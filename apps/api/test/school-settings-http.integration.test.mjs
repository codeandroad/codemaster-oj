import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool, transaction } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { hashPassword } from '../../../packages/domain/src/security.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { handleSchoolSettings } from '../../../packages/domain/src/school-settings.mjs';

// Both HTTP middleware and deployment-role permissions are exercised against a
// temporary schema. No demo/production passwords or student fixtures are used.
test('school names: own-school administration, revisions, legacy compatibility and runtime grants',
 {skip: !process.env.TEST_DATABASE_URL, timeout: 90000}, async t => {
  const baseUrl = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
  assert.match(baseUrl.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const manager = createPool(baseUrl.href);
  const schema = 'school_settings_' + randomBytes(6).toString('hex');
  const schemaUrl = new URL(baseUrl.href);
  schemaUrl.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(schemaUrl.href);
  let app, runtime, worker;
  let created = false;
  try {
   await manager.query(`CREATE SCHEMA ${schema}`); created = true;
   await migrate(pool);
   const password = randomBytes(24).toString('base64url');
   const legacyId = await bootstrap(pool, {name:'Legacy administrator',number:'ADM',username:'legacy-admin',password});
   const passwordHash = await hashPassword(password);
   const accounts = {};
   for (const username of ['alpha-admin','beta-admin','teacher','student']) {
    accounts[username] = await transaction(pool, async db => {
     const {rows:[identity]} = await db.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$1) RETURNING id", [username]);
     return (await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id', [identity.id,username,passwordHash])).rows[0].id;
    });
   }
   const alpha = await provisionSchool(pool, {slug:'settings-alpha',name:'Alpha Academy',adminUsername:'alpha-admin'});
   const beta = await provisionSchool(pool, {slug:'settings-beta',name:'贝塔学校',adminUsername:'beta-admin'});
   for (const role of ['teacher','student']) await pool.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [alpha.id,accounts[role],role]);
   const origin = 'http://school-settings.test';
   app = await createApiApplication({databaseUrl:schemaUrl.href,logger:false,
    config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
   await app.listen(0,'127.0.0.1');
   const base = await app.getUrl();
   async function request(path, {method='GET',auth,body,status=200,csrf=true}={}) {
    const response = await fetch(base+'/api/v1'+path, {method,headers:{Origin:origin,
     ...(body !== undefined && {'Content-Type':'application/json'}),
     ...(auth && {Cookie:auth.cookie,...(csrf && {'X-CSRF-Token':auth.csrfToken})})},
     body:body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json();
    assert.ok((Array.isArray(status)?status:[status]).includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(data.error??{})}`);
    return {data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
   }
   const login = async username => {
    const {data,cookie} = await request('/auth/login', {method:'POST',body:{username,password}});
    return {cookie,csrfToken:data.csrfToken};
   };
   const admin = await login('alpha-admin'), betaAdmin = await login('beta-admin');
   const teacher = await login('teacher'), student = await login('student'), legacy = await login('legacy-admin');
   const path = id => `/schools/${id}/settings`;
   const payload = {nameZh:'阿尔法学校',nameEn:'Alpha Academy',expectedRevision:1};
   let settings;

   await t.test('names are backfilled without invented translations and listed per locale', async () => {
    const legacySettings = (await request(path(LEGACY_SCHOOL_ID),{auth:legacy})).data;
    assert.equal(legacySettings.nameZh, '天行创世纪学校');
    assert.equal(legacySettings.nameEn, '');
    assert.equal(legacySettings.revision,1);
    settings = (await request(path(alpha.id),{auth:admin})).data;
    assert.equal(settings.nameZh,''); assert.equal(settings.nameEn,'Alpha Academy');
    assert.deepEqual(Object.keys(settings).sort(), ['id','name','nameEn','nameZh','revision']);
    const list = (await request('/schools',{auth:admin})).data;
    const schools = Array.isArray(list) ? list : list.items;
    assert.equal(schools.find(s=>s.id===alpha.id).nameEn,'Alpha Academy');
    assert.equal((await request(path(beta.id),{auth:betaAdmin})).data.nameEn,'');
   });
   await t.test('unauthenticated, foreign-school, teacher, student and CSRF writes are denied', async () => {
    await request(path(alpha.id),{status:401});
    for(const auth of [teacher,student]) {
     await request(path(alpha.id),{auth,status:403});
     await request(path(alpha.id),{auth,method:'PATCH',body:payload,status:403});
    }
    await request(path(alpha.id),{auth:betaAdmin,status:404});
    await request(path(beta.id),{auth:admin,method:'PATCH',body:payload,status:404});
    await request(path(LEGACY_SCHOOL_ID),{auth:admin,method:'PATCH',body:payload,status:403});
    await request(path(alpha.id),{auth:admin,method:'PATCH',body:payload,csrf:false,status:403});
   });
   await t.test('validation is atomic, saves are audited and conflicting writes cannot overwrite', async () => {
    for (const bad of [
     {...payload,nameZh:' ',nameEn:'\t'}, {...payload,nameEn:'a'.repeat(101)},
     {...payload,nameZh:null}, {...payload,expectedRevision:undefined},
    ]) await request(path(alpha.id),{auth:admin,method:'PATCH',body:bad,status:400});
    assert.equal((await request(path(alpha.id),{auth:admin})).data.revision,1);
    const responses = await Promise.all([
     request(path(alpha.id),{auth:admin,method:'PATCH',body:payload,status:[200,409]}),
     request(path(alpha.id),{auth:admin,method:'PATCH',body:{...payload,nameEn:'A different name'},status:[200,409]}),
    ]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    settings = responses.find(r=>r.status===200).data;
    assert.equal(settings.nameZh,'阿尔法学校'); assert.equal(settings.revision,2);
    const same = (await request(path(alpha.id),{auth:admin,method:'PATCH',body:{...settings,expectedRevision:settings.revision}})).data;
    assert.deepEqual(same,settings);
    const events = (await pool.query("SELECT metadata FROM audit_events WHERE action='school.settings.update' AND resource_id=$1",[alpha.id])).rows;
    assert.equal(events.length,1); assert.equal(events[0].metadata.before.revision,1); assert.deepEqual(events[0].metadata.after,settings);
    assert.equal((await pool.query("SELECT count(*)::int n FROM school_audit_events WHERE action='school.settings.update' AND school_id=$1",[alpha.id])).rows[0].n,1);
   });
   await t.test('legacy admin edits own names while preserving all other site settings', async () => {
    const before = (await pool.query('SELECT settings FROM site_settings WHERE id=true')).rows[0].settings;
    const after = (await request(path(LEGACY_SCHOOL_ID),{auth:legacy,method:'PATCH',body:{nameZh:'天行创世纪学校',nameEn:'School English Name',expectedRevision:1}})).data;
    assert.equal(after.revision,2);
    assert.deepEqual((await pool.query('SELECT settings FROM site_settings WHERE id=true')).rows[0].settings,{...before,schoolName:'天行创世纪学校'});
    // Historic platform and legacy name-only writers still revise the same settings.
    await pool.query('UPDATE schools SET name=$2 WHERE id=$1',[LEGACY_SCHOOL_ID,'天行学校新名称']);
    const changed = (await request(path(LEGACY_SCHOOL_ID),{auth:legacy})).data;
    assert.equal(changed.nameZh,'天行学校新名称'); assert.equal(changed.nameEn,'School English Name'); assert.equal(changed.revision,3);
    await request(path(LEGACY_SCHOOL_ID),{auth:legacy,method:'PATCH',body:{...after,expectedRevision:after.revision},status:409});
   });
   await t.test('actual app grants permit own settings; audit and worker access remain restricted', async () => {
    const source = await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8');
    const sql = source.match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1]; assert.ok(sql);
    await pool.query(sql.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
    const runtimeUrl = new URL(baseUrl.href); runtimeUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
    const workerUrl = new URL(baseUrl.href); workerUrl.searchParams.set('options',`-crole=campus_worker -csearch_path=${schema}`);
    runtime=createPool(runtimeUrl.href); worker=createPool(workerUrl.href);
    const update = (id,user,body) => handleSchoolSettings({pool:runtime,user:{id:user,roles:[]},route:path(id),method:'PATCH',body});
    assert.equal((await update(alpha.id,accounts['alpha-admin'],{nameZh:'',nameEn:'Runtime names',expectedRevision:settings.revision})).body.revision,3);
    assert.equal((await update(LEGACY_SCHOOL_ID,legacyId,{nameZh:'天行学校',nameEn:'Runtime legacy',expectedRevision:3})).body.revision,4);
    await assert.rejects(runtime.query('UPDATE schools SET settings_revision=99 WHERE id=$1',[alpha.id]),{code:'42501'});
    await assert.rejects(runtime.query('DELETE FROM school_audit_events'),{code:'42501'});
    await assert.rejects(worker.query('SELECT name_zh FROM schools'),{code:'42501'});
    await assert.rejects(worker.query('UPDATE schools SET name_en=$1',['forbidden']),{code:'42501'});
   });
  } finally {
   await app?.close(); await runtime?.end(); await worker?.end(); await pool.end();
   if(created)await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
  }
 });
