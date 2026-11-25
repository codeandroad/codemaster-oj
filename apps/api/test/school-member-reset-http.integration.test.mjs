import { seedUnlinkedMembership, registerPersonal } from './support/workspace-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { hashPassword, tokenHash } from '../../../packages/domain/src/security.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('platform administrators recover member logins while school administrators manage local records',
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
      await migrate(pool, {through:'051_student_presence.sql'});
      const historical = [];
      const hash = await hashPassword(password);
      for (const kind of ['student','teacher']) {
        const username = 'historical-' + kind;
        const {rows:[identity]} = await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,username]);
        const {rows:[account]} = await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,username,hash]);
        await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[account.id,kind]);
        historical.push({id:account.id,identityId:identity.id,kind,username});
      }
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

      const issuer = await registerPersonal(request,'platform-resetter',password);
      await provisionPlatformAdministrator(pool,{username:'platform-resetter'});
      const issue = (id, auth = issuer) => request('/platform/accounts/'+id+'/reset', {
        method:'POST', auth, body:{verificationNote:'Verified account ownership in a manual review.'},
      });
      await t.test('platform recovers both migrated Tianxing logins with their original school identities', async () => {
        for (const {id,identityId,kind,username} of historical) {
          const login = password => request('/auth/login',{method:'POST',body:{username,password}});
          const original = await login(password);
          assert.equal(original.status,200);
          assert.equal((await reset(id,admin)).status,404);
          assert.equal((await issue(id,admin)).status,403);
          assert.equal((await request('/people/'+identityId+'/reset',{method:'POST',auth:admin})).status,410);
          const issued = await issue(id);
          assert.equal(issued.status,200);
          const next = randomBytes(24).toString('base64url');
          assert.equal((await request('/auth/reset',{method:'POST',body:{username,resetCode:issued.data.resetCode,password:next}})).status,200);
          assert.equal((await request('/auth/me',{auth:original})).status,401);
          assert.equal((await login(password)).status,401);
          const recovered = await login(next);
          assert.equal(recovered.status,200);
          assert.equal(recovered.data.user.id,id);
          const school = (await request('/schools',{auth:recovered})).data.items[0];
          assert.equal(school.id,schoolId);
          assert.deepEqual(school.roles,[kind]);
          const record = await request('/schools/'+schoolId+'/accounts/'+id,{auth:admin});
          assert.equal(record.data.identityId,identityId);
          assert.equal(record.data.canResetPassword,false);
        }
      });

      const personal = await request('/auth/register-personal', {
        method: 'POST', body: { username: 'personal-member', displayName: 'Personal member', password },
      });
      assert.equal(personal.status, 201);
      assert.equal((await reset(personal.data.user.id, admin)).status, 404);

      await seedUnlinkedMembership(pool,schoolId,personal.data.user.id,'student');
      assert.equal((await reset(personal.data.user.id, admin)).status, 404);
      assert.equal((await reset(admin.data.user.id, admin)).status, 404);
      const identity = { kind: 'student', name: 'Reset member', number: 'S01' };
      const created = await request(`/schools/${schoolId}/identities`, { method: 'POST', auth: admin, body: identity });
      assert.equal(created.status, 201);
      const activation = await request(`/schools/${schoolId}/identities/${created.data.id}/activation-code`, { method: 'POST', auth: admin });
      const student = await registerPersonal(request,'reset-member',password);
      const claim = (auth,facts,code,schoolSlug='tianxing-chuangshiji') => request('/auth/claim-identity',{
        method:'POST',auth,body:{...facts,schoolSlug,activationCode:code}});
      assert.equal((await claim(student,identity,activation.data.activationCode)).status,200);
      const memberId = student.data.user.id;
      assert.equal((await reset(memberId,admin)).status,404,'claiming a dossier does not give the school custody of a personal login');
      // Before personal-first enrollment, school-created logins shared the original membership timestamp.
      const legacyCustody = id => pool.query('UPDATE school_memberships m SET joined_at=a.created_at FROM accounts a WHERE m.account_id=a.id AND m.school_id=$1 AND a.id=$2',[schoolId,id]);
      await legacyCustody(memberId);
      const list = (await request(members, { auth: admin })).data.items;
      assert.ok(list.some(member => member.accountId === memberId));
      assert.ok(list.every(member => member.canResetPassword === false));

      assert.equal((await issue(memberId,student)).status,403);
      async function outstandingCode(id, actor, metadata) {
        const code = randomBytes(24).toString('base64url');
        await pool.query("INSERT INTO reset_tokens(account_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[id,tokenHash(code)]);
        await pool.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata)
          VALUES($1,'account.reset_issue','account',$2,$3)`,[actor.data.user.id,id,metadata]);
        return code;
      }
      await t.test('outstanding platform codes from the previous release can still be redeemed', async () => {
        const username = 'previous-platform-code';
        const holder = await registerPersonal(request,username,password);
        const code = await outstandingCode(holder.data.user.id,issuer,{scope:'platform-personal'});
        const next = randomBytes(24).toString('base64url');
        assert.equal((await request('/auth/reset',{method:'POST',body:{username,resetCode:code,password:next}})).status,200);
        assert.equal((await request('/auth/login',{method:'POST',body:{username,password:next}})).status,200);
      });
      const schoolCode = await outstandingCode(memberId,admin,{schoolId});
      const retired = await request('/auth/reset',{method:'POST',body:{username:'reset-member',resetCode:schoolCode,password:randomBytes(24).toString('base64url')}});
      assert.equal(retired.status,400);
      assert.equal((await request('/auth/login',{method:'POST',body:{username:'reset-member',password}})).status,200);
      const issued = await issue(memberId);
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
        assert.deepEqual(detail.data.events.filter(event=>event.action==='account.reset_issue').map(event=>event.action),['account.reset_issue'], 'only the historical school issuance is visible here');
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
      const reissued = await issue(memberId);
      assert.equal(reissued.status, 200);
      assert.equal((await redeem(issued.data.resetCode)).status, 400);
      assert.equal((await redeem(reissued.data.resetCode)).status, 200);
      assert.equal((await request('/auth/me', {auth:student})).status, 401);
      assert.equal((await redeem(reissued.data.resetCode)).status, 400);
      assert.equal((await request('/auth/login', { method:'POST', body:{username:'reset-member',password:newPassword} })).status, 200);
      const prior = await issue(memberId);
      assert.equal(prior.status,200);
      await pool.query('INSERT INTO school_administrators(school_id,account_id,granted_by) VALUES($1,$2,$3)', [schoolId,memberId,admin.data.user.id]);
      assert.equal((await redeem(prior.data.resetCode)).status, 400);
      assert.equal((await issue(memberId)).status, 200);
      await pool.query('DELETE FROM school_administrators WHERE school_id=$1 AND account_id=$2', [schoolId,memberId]);
      await provisionSchool(pool, {slug:'second-school',name:'Second School',adminUsername:'reset-member'});
      assert.equal((await redeem(prior.data.resetCode)).status, 400);
      assert.equal((await issue(memberId)).status, 200);

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
        const verify = (person, code) => request('/auth/verify-identity', { method: 'POST', auth:personal,
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
        const batchStudent = await registerPersonal(request,'batch-student',password);
        assert.equal((await claim(batchStudent,a,code)).status,200);
        assert.equal((await verify(a, code)).status, 400);
        assert.equal((await batch([a.id])).status, 409);
        const audit = await pool.query("SELECT count(*)::int n FROM school_audit_events WHERE school_id=$1 AND action='school.identity.activation_issue' AND target_id=ANY($2::uuid[])", [schoolId,[a.id,b.id]]);
        assert.equal(audit.rows[0].n, 3);
      });
      await t.test('platform login and school suspension are independently authorized and reversible', async () => {
        const personalAccount = username => request('/auth/register-personal', {
          method:'POST',body:{username,displayName:username,password},
        });
        const platform = await personalAccount('login-manager');
        await provisionPlatformAdministrator(pool,{username:'login-manager'});
        const secondAdmin = await personalAccount('other-admin');
        const second = await provisionSchool(pool,{slug:'access-school',name:'Access School',adminUsername:'other-admin'});
        const person = {kind:'student',name:'Access member',number:'ACCESS'};
        const record = await request(`/schools/${schoolId}/identities`,{auth:admin,method:'POST',body:person});
        const code = await request(`/schools/${schoolId}/identities/${record.data.id}/activation-code`,{auth:admin,method:'POST'});
        const member = await personalAccount('access-member');
        assert.equal((await claim(member,person,code.data.activationCode)).status,200);
        const id = member.data.user.id;
        await legacyCustody(id);
        const detailPath = `/schools/${schoolId}/accounts/${id}`;
        const setAccess = (school, auth, suspended, target=id) => request(`/schools/${school}/accounts/${target}/access`,{method:'PATCH',auth,body:{suspended}});
        const setLogin = (auth, disabled, target=id) => request(`/platform/accounts/${target}/login`,{method:'PATCH',auth,body:{disabled}});
        const login = () => request('/auth/login',{method:'POST',body:{username:'access-member',password}});
        const issueClaim = async (school,auth) => {
          const student = {kind:'student',name:'Applicant',number:'APPLY'};
          const dir = `/schools/${school.id}/identities`;
          const identity = await request(dir,{auth,method:'POST',body:student});
          const code = await request(dir+'/'+identity.data.id+'/activation-code',{auth,method:'POST'});
          return claim(member,student,code.data.activationCode,school.slug);
        };
        const read = (path,auth) => request(path,{auth});
        const cls = await request(`/schools/${schoolId}/classes`,{auth:admin,method:'POST',body:{name:'Access class',type:'training'}});
        assert.equal((await request(`/schools/${schoolId}/classes/${cls.data.id}/roster`,{auth:admin,method:'POST',body:{identityId:record.data.id}})).status,201);
        const before = (await read(detailPath,admin)).data;
        assert.equal(before.canResetPassword,false);
        assert.equal((await reset(id,admin)).status,404);
        assert.equal((await issue(id)).status,200);
        assert.equal((await issueClaim(second,secondAdmin)).status,200);
        assert.equal((await setAccess(second.id,admin,true)).status,404);
        assert.equal((await setAccess(schoolId,member,true)).status,403);
        assert.equal((await setAccess(schoolId,platform,true)).status,404);
        assert.equal((await setAccess(schoolId,admin,true,admin.data.user.id)).status,403);
        assert.equal((await setLogin(admin,true)).status,403);
        assert.equal((await setLogin(platform,true,platform.data.user.id)).status,403);
        assert.equal((await read('/platform/accounts')).status,401);
        assert.equal((await read('/platform/accounts',admin)).status,403);
        const peer = await personalAccount('peer-manager');
        await provisionPlatformAdministrator(pool,{username:'peer-manager'});
        assert.equal((await setLogin(platform,true,peer.data.user.id)).status,403);
        // A paused second affiliation must not transfer global credential custody to the first school.
        assert.equal((await setAccess(second.id,secondAdmin,true)).status,200);
        assert.equal((await reset(id,admin)).status,404);
        assert.equal((await setAccess(second.id,secondAdmin,false)).status,200);

        assert.equal((await setAccess(schoolId,admin,true)).status,200);
        assert.equal((await setAccess(schoolId,admin,true)).status,200);
        assert.deepEqual((await read('/schools',member)).data.items.map(item=>item.id),[second.id]);
        assert.equal((await read(`/schools/${schoolId}/courses`,member)).status,404);
        assert.equal((await read(`/schools/${second.id}/courses`,member)).status,200);
        assert.equal((await read('/practice/courses',member)).status,200);
        assert.equal((await setAccess(second.id,secondAdmin,true)).status,200);
        const {rows:[independent]} = await pool.query(`INSERT INTO learning_paths(owner_account_id,title,owner_scope,published_at,platform_audience_scope)
          VALUES($1,'Independent learners','platform',now(),'custom') RETURNING id`,[platform.data.user.id]);
        await pool.query(`INSERT INTO platform_course_rules(course_id,rule_key,target_kind,admission_mode)
          VALUES($1,'independent','independent','direct')`,[independent.id]);
        assert.equal((await read('/schools',member)).data.items.length,0);
        assert.equal((await read('/practice/courses/'+independent.id+'/entry',member)).status,404);
        const independentUser=await personalAccount('independent-user');
        assert.equal((await read('/practice/courses/'+independent.id+'/entry',independentUser)).status,200);
        assert.equal((await setAccess(second.id,secondAdmin,false)).status,200);
        assert.equal((await issueClaim({id:schoolId,slug:'tianxing-chuangshiji'},admin)).data.error.code,'SCHOOL_ACCESS_SUSPENDED');
        assert.equal((await request(`/platform/schools/${schoolId}/administrators`,{
          auth:platform,method:'POST',body:{username:'access-member'},
        })).status,409);
        const filtered = await read(`/schools/${schoolId}/accounts?access=suspended&q=access-member`,admin);
        assert.deepEqual(filtered.data.items.map(item=>item.accountId),[id]);
        const secondSession = await login();
        assert.equal(secondSession.status,200);

        assert.equal((await setLogin(platform,true)).status,200);
        assert.equal((await setLogin(platform,true)).status,200);
        for (const session of [member,secondSession]) assert.equal((await read('/auth/me',session)).status,401);
        assert.equal((await login()).status,403);
        const disabled = await read('/platform/accounts?status=disabled&q=access-member',platform);
        assert.deepEqual(disabled.data.items.map(item=>item.accountId),[id]);
        assert.equal((await read(detailPath,admin)).data.disabled,true);
        assert.equal((await setAccess(schoolId,admin,false)).status,200);
        assert.equal((await login()).status,403);
        assert.equal((await setAccess(schoolId,admin,true)).status,200);
        assert.equal((await setLogin(platform,false)).status,200);
        assert.equal((await read('/auth/me',member)).status,401);
        const restored = await login();
        assert.equal(restored.status,200);
        assert.equal((await read(`/schools/${schoolId}/courses`,restored)).status,404);
        assert.equal((await setAccess(schoolId,admin,false)).status,200);
        assert.equal((await read(`/schools/${schoolId}/courses`,restored)).status,200);
        const after = (await read(detailPath,admin)).data;
        for (const key of ['identityId','classes','role','joinedAt']) assert.deepEqual(after[key],before[key],key);
        assert.equal(after.suspended,false);
        assert.equal(after.events.filter(e=>e.action==='school.account.suspend').length,2);
        const audit = await pool.query('SELECT action FROM platform_audit_events WHERE target_account_id=$1 ORDER BY created_at',[id]);
        assert.deepEqual(audit.rows.map(row=>row.action),['platform.password_reset.issue','platform.login.disable','platform.login.restore']);
        assert.equal((await pool.query('SELECT count(*)::int n FROM reset_tokens WHERE account_id=$1 AND consumed_at IS NULL',[id])).rows[0].n,0);
      });
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
