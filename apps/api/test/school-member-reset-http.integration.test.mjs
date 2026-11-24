import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';

test('school administrators issue one-time password reset credentials for members',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const manager = createPool(process.env.TEST_DATABASE_URL);
    const schema = 'reset_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    let app;
    try {
      await migrate(pool);
      await bootstrap(pool, { schoolSlug: 'tianxing-chuangshiji', name: 'Legacy admin', number: 'ADM', username: 'legacy-admin', password });
      const grants = (await readFile(new URL('../../../packages/domain/grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
      await pool.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const appUrl = new URL(url);
      appUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      app = await createApiApplication({
        databaseUrl: appUrl.href, logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'http://reset.test', COOKIE_SECURE: 'false' }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth } = {}) {
        const response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Origin: 'http://reset.test',
            ...(body && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, 'X-CSRF-Token': auth.data.csrfToken }),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return {
          status: response.status, data: await response.json(),
          cookie: response.headers.get('set-cookie')?.split(';')[0],
        };
      }
      const admin = await request('/auth/login', { method: 'POST', body: { username: 'legacy-admin', password } });
      assert.equal(admin.status, 200);
      const schoolId = (await request('/schools', { auth: admin })).data.items[0].id;
      const members = `/schools/${schoolId}/members`;
      const reset = (accountId, auth) => request(`${members}/${accountId}/reset`, { method: 'POST', auth });

      const personal = await request('/auth/register-personal', {
        method: 'POST', body: { username: 'personal-member', displayName: 'Personal member', password },
      });
      assert.equal(personal.status, 201);
      assert.equal((await reset(personal.data.user.id, admin)).status, 404);

      const invite = await request(`/schools/${schoolId}/invitations`, { method: 'POST', auth: admin, body: { role: 'student' } });
      assert.equal(invite.status, 201);
      assert.equal((await request('/school-invitations/accept', { method: 'POST', auth: personal, body: { token: invite.data.token } })).status, 200);
      assert.equal((await reset(personal.data.user.id, admin)).status, 403);
      assert.equal((await reset(admin.data.user.id, admin)).status, 403);
      const identity = { kind: 'student', name: 'Reset member', number: 'S01' };
      const created = await request(`/schools/${schoolId}/identities`, { method: 'POST', auth: admin, body: identity });
      assert.equal(created.status, 201);
      const activation = await request(`/schools/${schoolId}/identities/${created.data.id}/activation-code`, { method: 'POST', auth: admin });
      const student = await request('/auth/register', { method: 'POST', body: {
        ...identity, schoolSlug: 'tianxing-chuangshiji', activationCode: activation.data.activationCode, username: 'reset-member', password,
      } });
      assert.equal(student.status, 201);
      const memberId = student.data.user.id;
      const list = (await request(members, { auth: admin })).data.items;
      assert.deepEqual(list.filter(member => member.canResetPassword).map(member => member.accountId), [memberId]);

      assert.equal((await reset(memberId, student)).status, 403, 'members cannot issue reset credentials');
      const issued = await reset(memberId, admin);
      assert.equal(issued.status, 200);
      assert.equal(issued.data.username, 'reset-member');
      assert.match(issued.data.resetCode, /^[A-Za-z0-9_-]{32}$/);

      await t.test('school account directory and detail restrict membership, filter real records and scope account history', async () => {
        const directory = `/schools/${schoolId}/accounts`;
        assert.equal((await request(directory, {auth:student})).status, 403);
        const cls = await request(`/schools/${schoolId}/classes`, {auth:admin, method:'POST', body:{name:'Reset class', type:'training'}});
        assert.equal(cls.status, 201);
        const roster = await request(`/schools/${schoolId}/classes/${cls.data.id}/roster`, {auth:admin, method:'POST', body:{identityId:created.data.id}});
        assert.equal(roster.status, 201);
        const filtered = await request(directory+'?q=S01&role=student&className=Reset&status=enabled', {auth:admin});
        assert.equal(filtered.status, 200);
        assert.deepEqual(filtered.data.items.map(item => item.accountId), [memberId]);
        const detail = await request(directory+'/'+memberId, {auth:admin});
        assert.equal(detail.status, 200);
        assert.equal(detail.data.username,'reset-member');
        assert.deepEqual(detail.data.classes,['Reset class']);
        assert.equal(detail.data.events[0].action,'account.reset_issue');
        assert.equal((await request(directory+'?role=teacher&q=S01',{auth:admin})).data.items.length,0);
        assert.equal((await request(directory+'/'+personal.data.user.id,{auth:admin})).data.lastLoginAt,null);
      });
      await t.test('only local delegates and unlinked base roles are editable, preserving roster identities', async () => {
        const path = `/schools/${schoolId}/accounts/`;
        const edit = (id,auth, role,administrator,expectedRole,expectedAdministrator) => request(path+id+'/roles',{
          method:'PATCH',auth,body:{role,administrator,expectedRole,expectedAdministrator},
        });
        assert.equal((await edit(memberId,student,'student',true,'student',false)).status,403);
        assert.equal((await edit(admin.data.user.id,admin,'student',false,'student',false)).status,403);
        assert.equal((await edit(memberId,admin,'teacher',false,'student',false)).status,409);
        const id=personal.data.user.id;
        assert.equal((await edit(id,admin,'teacher',false,'student',false)).status,200);
        assert.equal((await edit(id,admin,'teacher',true,'teacher',false)).status,200);
        assert.deepEqual(new Set((await request('/schools',{auth:personal})).data.items[0].roles),new Set(['teacher','school_admin']));
        assert.equal((await edit(id,admin,'teacher',false,'teacher',true)).status,200);
        assert.equal((await request(path+memberId,{auth:personal})).status,403);
        assert.equal((await edit(id,admin,'student',false,'teacher',false)).status,200);
        await pool.query('UPDATE school_administrators SET revoked_at=NULL,delegated_by_school=false WHERE account_id=$1',[id]);
        assert.equal((await edit(id,admin,'student',false,'student',true)).status,403);
        await pool.query('UPDATE school_administrators SET revoked_at=now() WHERE account_id=$1',[id]);
      });
      const tokenRow = (await pool.query('SELECT token_hash, consumed_at FROM reset_tokens WHERE account_id=$1', [memberId])).rows[0];
      assert.ok(tokenRow && /^[0-9a-f]{64}$/.test(tokenRow.token_hash) && !tokenRow.consumed_at, 'stores only the code hash');

      const newPassword = randomBytes(24).toString('base64url');
      const redeem = resetCode => request('/auth/reset', {method:'POST', body:{username:'reset-member',resetCode,password:newPassword}});
      const reissued = await reset(memberId, admin);
      assert.equal(reissued.status, 200);
      assert.equal((await redeem(issued.data.resetCode)).status, 400);
      assert.equal((await redeem(reissued.data.resetCode)).status, 200);
      assert.equal((await request('/auth/me', {auth:student})).status, 401);
      assert.equal((await redeem(reissued.data.resetCode)).status, 400);
      assert.equal((await request('/auth/login', { method:'POST', body:{username:'reset-member',password:newPassword} })).status, 200);
      const prior = await reset(memberId, admin);
      await pool.query('INSERT INTO school_administrators(school_id,account_id,granted_by) VALUES($1,$2,$3)', [schoolId,memberId,admin.data.user.id]);
      assert.equal((await redeem(prior.data.resetCode)).status, 400);
      assert.equal((await reset(memberId, admin)).status, 403);
      await pool.query('DELETE FROM school_administrators WHERE school_id=$1 AND account_id=$2', [schoolId,memberId]);
      await provisionSchool(pool, {slug:'second-school',name:'Second School',adminUsername:'reset-member'});
      assert.equal((await redeem(prior.data.resetCode)).status, 400);
      assert.equal((await reset(memberId, admin)).status, 403);

      await t.test('batch activation uses the school roster, rejects mixed batches atomically and issues usable codes', async () => {
        const path = `/schools/${schoolId}/identities`;
        const create = async (kind, number) => {
          const response = await request(path, { method: 'POST', auth: admin, body: { kind, number, name: 'Batch ' + number } });
          assert.equal(response.status, 201);
          return response.data;
        };
        const a = await create('student', 'B01');
        const b = await create('teacher', 'B02');
        const batch = (ids, auth = admin) => request(path + '/activation-batch', { method: 'POST', auth, body: { identityIds: ids } });
        const verify = (person, code) => request('/auth/verify-identity', { method: 'POST',
          body: { schoolSlug: 'tianxing-chuangshiji', kind: person.kind, name: person.name, number: person.number, activationCode: code } });
        const candidates = await request(path + '?pendingActivation=true&kind=teacher&q=B02', { auth: admin });
        assert.deepEqual(candidates.data.items.map(item => item.id), [b.id]);
        const protectedIdentity = (await pool.query("INSERT INTO school_identities(school_id,kind,number,name) VALUES($1,'school_admin','ADMIN-B','School admin') RETURNING id", [schoolId])).rows[0];
        const unlinked = await request(path + '?pendingActivation=true', { auth: admin });
        assert.ok(!unlinked.data.items.some(item => item.id === created.data.id));
        assert.ok(!unlinked.data.items.some(item => item.id === protectedIdentity.id));
        assert.equal((await batch([protectedIdentity.id])).status, 404);
        assert.equal((await batch([a.id], personal)).status, 403);
        for (const ids of [[], [a.id, a.id], Array(501).fill(a.id)]) assert.equal((await batch(ids)).status, 400);
        const first = await batch([a.id, b.id]);
        assert.equal(first.status, 201);
        assert.equal(first.data.school.id, schoolId);
        assert.equal(first.data.items.length, 2);
        const codes = new Map(first.data.items.map(item => [item.person.number, item.activationCode]));
        assert.notEqual(codes.get(a.number), codes.get(b.number));

        const foreignSchool = (await pool.query("SELECT id FROM schools WHERE slug='second-school'")).rows[0].id;
        const foreign = await request(`/schools/${foreignSchool}/identities`, { method: 'POST',
          auth: await request('/auth/login', { method:'POST', body:{username:'reset-member',password:newPassword} }),
          body:{kind:'teacher',number:'B02',name:'Batch B02'} });
        assert.equal(foreign.status, 201);
        assert.equal((await batch([a.id, foreign.data.id])).status, 404);
        assert.equal((await batch([a.id, created.data.id])).status, 409);
        assert.equal((await verify(a, codes.get(a.number))).status, 200);
        assert.equal((await verify(b, codes.get(b.number))).status, 200);
        const replaced = await batch([a.id]);
        assert.equal(replaced.status, 201);
        assert.equal((await verify(a, codes.get(a.number))).status, 400);
        assert.equal((await verify(b, codes.get(b.number))).status, 200);

        const code = replaced.data.items[0].activationCode;
        const register = await request('/auth/register', { method: 'POST', body: { ...a, schoolSlug: 'tianxing-chuangshiji',
          activationCode: code, username: 'batch-student', password } });
        assert.equal(register.status, 201);
        assert.equal((await verify(a, code)).status, 400);
        assert.equal((await batch([a.id])).status, 409);
        const audit = await pool.query("SELECT count(*)::int n FROM school_audit_events WHERE school_id=$1 AND action='school.identity.activation_issue' AND target_id=ANY($2::uuid[])", [schoolId,[a.id,b.id]]);
        assert.equal(audit.rows[0].n, 3);
      });
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
