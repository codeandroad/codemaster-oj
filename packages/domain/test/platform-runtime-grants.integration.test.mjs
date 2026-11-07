import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword } from '../src/security.mjs';
import { handlePlatformGovernance, provisionPlatformAdministrator } from '../src/platform-governance.mjs';
import { handleSchools, LEGACY_SCHOOL_ID } from '../src/schools.mjs';

test('platform operations work with the real application grants while grants, audits, and worker boundaries stay protected',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
    const baseUrl = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
    assert.ok(['/campus_qa','/campus_test'].includes(baseUrl.pathname), 'Use a dedicated local campus_qa/campus_test database.');
    const manager = createPool(baseUrl.href);
    const schema = 'platform_grants_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const ownerUrl = new URL(baseUrl.href);
    ownerUrl.searchParams.set('options', `-csearch_path=${schema}`);
    const owner = createPool(ownerUrl.href);
    let app;
    let worker;
    try {
      await migrate(owner);
      // Apply the actual deployment grant SQL to this temporary QA schema.
      // Existing login roles are not altered, and DROP SCHEMA removes all of
      // this test's object grants. Public application tables are never touched.
      const source = await readFile(new URL('../grants.mjs', import.meta.url), 'utf8');
      const grantSql = source.match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
      assert.ok(grantSql, 'Deployment grants must remain discoverable for the integration test.');
      await owner.query(grantSql.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const appUrl = new URL(baseUrl.href);
      appUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      const workerUrl = new URL(baseUrl.href);
      workerUrl.searchParams.set('options', `-crole=campus_worker -csearch_path=${schema}`);
      app = createPool(appUrl.href);
      worker = createPool(workerUrl.href);
      assert.equal((await app.query('SELECT current_user AS role')).rows[0].role, 'campus_app');
      assert.equal((await worker.query('SELECT current_user AS role')).rows[0].role, 'campus_worker');

      const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
      async function account(username) {
        return transaction(owner, async db => {
          const { rows:[identity] } = await db.query(`INSERT INTO identities(kind,number,name) VALUES('teacher',$1,$1) RETURNING id`, [username]);
          return (await db.query(`INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id`, [identity.id,username,passwordHash])).rows[0];
        });
      }
      const platform = await account('qa-platform');
      const founder = await account('qa-founder');
      const another = await account('qa-another');
      await provisionPlatformAdministrator(owner, { username:'qa-platform' });
      const user = { id:platform.id,roles:[] };
      const governance = (route,method='GET',body={}) => handlePlatformGovernance({
        pool:app,user,route,method,body,url:new URL(route,'http://qa.local'),
      });
      const school = await governance('/platform/schools','POST',{ slug:'app-role-school',name:'App role school',adminUsername:'qa-founder' });
      assert.equal(school.status, 201);
      assert.equal((await governance(`/platform/schools/${school.body.id}`,'PATCH',{
        name:'Renamed using app role',expectedName:'App role school',
      })).status, 200);
      assert.equal((await governance(`/platform/schools/${school.body.id}/administrators`,'POST',{ username:'qa-another' })).status, 200);
      assert.equal((await governance('/platform/schools')).body.items.find(s=>s.id===school.body.id).administrators.length,2);
      const invitation = await handleSchools({ pool:app,user:{id:another.id,roles:[]},route:`/schools/${school.body.id}/invitations`,method:'POST',body:{role:'student'} });
      assert.equal(invitation.status,201,'an additionally appointed admin can issue an invitation with runtime grants');
      assert.equal((await governance(`/platform/schools/${LEGACY_SCHOOL_ID}`,'PATCH',{
        name:'Legacy app role name',expectedName:'天行创世纪学校',
      })).status,200);
      assert.equal((await owner.query('SELECT settings FROM site_settings WHERE id=true')).rows[0].settings.schoolName,'Legacy app role name');

      await assert.rejects(app.query('UPDATE platform_admins SET revoked_at=NULL WHERE account_id=$1',[founder.id]),{code:'42501'});
      await assert.rejects(app.query('INSERT INTO platform_admins(account_id) VALUES($1)',[founder.id]),{code:'42501'});
      await assert.rejects(app.query('UPDATE platform_audit_events SET action=action'),{code:'42501'});
      await assert.rejects(app.query('DELETE FROM platform_audit_events'),{code:'42501'});
      await assert.rejects(app.query('DELETE FROM school_audit_events'),{code:'42501'});
      for (const table of ['platform_admins','school_administrators','platform_audit_events','legacy_school_identity_ownership','legacy_school_account_ownership']) {
        await assert.rejects(worker.query(`SELECT * FROM ${table} LIMIT 1`),{code:'42501'},table);
      }
      assert.equal((await owner.query('SELECT count(*)::int n FROM platform_audit_events')).rows[0].n,5);
    } finally {
      await app?.end();
      await worker?.end();
      await owner.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
