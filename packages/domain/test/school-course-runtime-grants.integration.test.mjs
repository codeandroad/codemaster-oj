import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword } from '../src/security.mjs';
import { provisionSchool } from '../src/schools.mjs';
import { handleSchoolCourses } from '../src/school-courses.mjs';
import { handlePlatformGovernance, provisionPlatformAdministrator } from '../src/platform-governance.mjs';

const courseTables = ['school_courses','school_course_classes','school_course_publications',
  'school_course_publication_classes','school_course_progress','school_learning_resources'];

test('school courses enforce real runtime RLS, append-only publications, and worker isolation',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const baseUrl = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
    assert.match(baseUrl.pathname,/^\/campus_(qa(?:_[a-z0-9_]+)?|test)$/, 'Use a dedicated local QA database.');
    const manager = createPool(baseUrl.href);
    const schema = 'school_course_grants_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    function scopedPool(role) {
      const url = new URL(baseUrl.href);
      url.searchParams.set('options', `${role ? '-crole=' + role + ' ' : ''}-csearch_path=${schema}`);
      return createPool(url.href);
    }
    const owner = scopedPool();
    let app, worker;
    try {
      await migrate(owner);
      const source = await readFile(new URL('../grants.mjs', import.meta.url), 'utf8');
      const sql = source.match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
      assert.ok(sql);
      await owner.query(sql.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      app = scopedPool('campus_app');
      worker = scopedPool('campus_worker');
      assert.equal((await app.query('SELECT current_user AS role')).rows[0].role, 'campus_app');
      const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
      const account = name => transaction(owner, async db => {
        const { rows:[identity] } = await db.query("INSERT INTO identities(kind,number,name) VALUES('teacher',$1,$1) RETURNING id",[name]);
        return (await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,name,passwordHash])).rows[0];
      });
      const alpha = await account('qa-course-alpha'), beta = await account('qa-course-beta');
      const a = await provisionSchool(owner,{slug:'course-alpha',name:'Alpha',adminUsername:'qa-course-alpha'});
      const b = await provisionSchool(owner,{slug:'course-beta',name:'Beta',adminUsername:'qa-course-beta'});
      const call = (user, school, suffix='', method='GET', body={}) => {
        const route = `/schools/${school.id}/courses${suffix}`;
        return handleSchoolCourses({pool:app,user,route,method,body,url:new URL(route,'http://qa.local')});
      };
      const input = title => ({requestId:randomUUID(),title,description:'',accessScope:'school',classIds:[],
        chapters:[{id:randomUUID(),title:'Chapter',body:'Private school chapter'}]});
      const ca = (await call(alpha,a,'','POST',input('Alpha course'))).body;
      const cb = (await call(beta,b,'','POST',input('Beta course'))).body;
      await call(alpha,a,`/${ca.id}/publish`,'POST',{expectedRevision:ca.revision});
      const resourceCall = (user,school,suffix='',method='GET',body={}) => {
        const route=`/schools/${school.id}/learning-resources${suffix}`;
        return handleSchoolCourses({pool:app,user,route,method,body,url:new URL(route,'http://qa.local')});
      };
      const ra=(await resourceCall(alpha,a,'','POST',{requestId:randomUUID(),title:'Alpha reference',content:'Alpha private body',type:'reference',scope:'school'})).body;
      const rb=(await resourceCall(beta,b,'','POST',{requestId:randomUUID(),title:'Beta reference',content:'Beta private body',type:'reference',scope:'school'})).body;

      await t.test('runtime API scopes content and rejects cross-school IDs', async () => {
        assert.deepEqual((await call(alpha,a)).body.items.map(c=>c.id),[ca.id]);
        assert.deepEqual((await call(beta,b)).body.items.map(c=>c.id),[cb.id]);
        await assert.rejects(call(alpha,a,`/${cb.id}`), e=>e.status===404);
        await assert.rejects(call(alpha,b), e=>e.status===404);
        assert.deepEqual((await resourceCall(alpha,a)).body.items.map(r=>r.id),[ra.id]);
        await assert.rejects(resourceCall(alpha,a,`/${rb.id}`),e=>e.status===404);
        assert.equal((await resourceCall(alpha,a,`/${ra.id}`)).body.content,'Alpha private body');
      });
      await t.test('missing context denies every course table; school context applies to reads and writes', async () => {
        for (const table of courseTables) assert.equal((await app.query(`SELECT * FROM ${table}`)).rowCount,0,table);
        await transaction(app, async db => {
          await db.query("SELECT set_config('campus.school_id',$1,true)",[a.id]);
          assert.deepEqual((await db.query('SELECT id FROM school_courses')).rows.map(r=>r.id),[ca.id]);
          assert.equal((await db.query('SELECT * FROM school_course_publications')).rowCount,1);
          assert.deepEqual((await db.query('SELECT id FROM school_learning_resources')).rows.map(r=>r.id),[ra.id]);
          assert.equal((await db.query("UPDATE school_learning_resources SET content='Forbidden' WHERE id=$1",[rb.id])).rowCount,0);
          assert.equal((await db.query("UPDATE school_courses SET title='Forbidden' WHERE id=$1",[cb.id])).rowCount,0);
        });
        await assert.rejects(transaction(app, async db => {
          await db.query("SELECT set_config('campus.school_id',$1,true)",[a.id]);
          await db.query(`INSERT INTO school_courses(school_id,owner_account_id,title,access_scope,create_request_id,create_request_hash)
            VALUES($1,$2,'Cross-scope','school',$3,'hash')`,[b.id,beta.id,randomUUID()]);
        }),{code:'42501'});
        assert.equal((await owner.query('SELECT title FROM school_courses WHERE id=$1',[cb.id])).rows[0].title,'Beta course');
      });
      await t.test('the same pooled connection drops its scope after commit and rollback', async () => {
        const client = await app.connect();
        try {
          for (const ending of ['COMMIT','ROLLBACK']) {
            await client.query('BEGIN');
            await client.query("SELECT set_config('campus.school_id',$1,true)",[a.id]);
            assert.equal((await client.query('SELECT * FROM school_courses')).rowCount,1);
            await client.query(ending);
            assert.equal((await client.query('SELECT * FROM school_courses')).rowCount,0);
          }
          await client.query('BEGIN');
          await client.query("SELECT set_config('campus.school_id',$1,true)",[b.id]);
          assert.deepEqual((await client.query('SELECT id FROM school_courses')).rows.map(r=>r.id),[cb.id]);
          await client.query('COMMIT');
        } finally { client.release(); }
      });
      await t.test('published content is immutable to the runtime and worker has no course access', async () => {
        for(const table of ['school_course_publications','school_course_publication_classes']){
          await assert.rejects(app.query(`DELETE FROM ${table}`),{code:'42501'});
        }
        await assert.rejects(app.query('UPDATE school_course_publications SET title=title'),{code:'42501'});
        await assert.rejects(app.query('UPDATE school_course_publication_classes SET revision=revision'),{code:'42501'});
        await assert.rejects(app.query('DELETE FROM school_course_progress'),{code:'42501'});
        await assert.rejects(app.query('DELETE FROM school_learning_resources'),{code:'42501'});
        for(const table of courseTables) await assert.rejects(worker.query(`SELECT * FROM ${table}`),{code:'42501'},table);
        const {rows} = await owner.query(`SELECT relname FROM pg_class WHERE relnamespace=$1::regnamespace
          AND relname=ANY($2) AND relrowsecurity AND relforcerowsecurity`,[schema,courseTables]);
        assert.equal(rows.length,courseTables.length);
      });
      await t.test('authorized platform statistics count scoped courses without returning content', async () => {
        await provisionPlatformAdministrator(owner,{username:'qa-course-alpha'});
        const result = await handlePlatformGovernance({pool:app,user:alpha,route:'/platform/schools',
          method:'GET',body:{},url:new URL('http://qa.local/platform/schools')});
        assert.equal(result.body.items.find(s=>s.id===a.id).counts.courses,1);
        assert.equal(result.body.items.find(s=>s.id===b.id).counts.courses,1);
        assert.ok(!JSON.stringify(result.body).includes('Private school chapter'));
        assert.equal((await app.query('SELECT * FROM school_courses')).rowCount,0);
      });
    } finally {
      await app?.end(); await worker?.end(); await owner.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
    }
  });
