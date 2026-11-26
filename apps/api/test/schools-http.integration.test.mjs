import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApiApplication } from '../dist/application.js';
import { createPool } from '../../../packages/domain/src/db.mjs';
import { migrate } from '../../../packages/domain/src/migrate.mjs';
import { bootstrap } from '../../../packages/domain/src/bootstrap.mjs';
import { loadConfig } from '../../../packages/domain/src/application.mjs';
import { provisionSchool } from '../../../packages/domain/src/schools.mjs';
import { applicationDatabaseUrl, registerPersonal, seedUnlinkedMembership } from './support/workspace-accounts.mjs';
import { provisionPlatformAdministrator } from '../../../packages/domain/src/platform-governance.mjs';

test('school claims and reviewed applications stay within each school on the real Nest API',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const manager = createPool(process.env.TEST_DATABASE_URL);
    const schema = 'schools_' + randomBytes(6).toString('hex');
    await manager.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const pool = createPool(url.href);
    const password = randomBytes(24).toString('base64url');
    let app;
    try {
      await migrate(pool);
      await bootstrap(pool,{schoolSlug:'tianxing-chuangshiji', name: 'Legacy admin', number: 'ADM', username: 'legacy-admin', password });
      app = await createApiApplication({
        databaseUrl: await applicationDatabaseUrl(pool,url,schema), logger: false,
        config: loadConfig({ SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'http://schools.test', COOKIE_SECURE: 'false' }),
      });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      async function request(path, { method = 'GET', body, auth, csrf = true } = {}) {
        const response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Origin: 'http://schools.test',
            ...(body && { 'Content-Type': 'application/json' }),
            ...(auth && { Cookie: auth.cookie, ...(csrf && { 'X-CSRF-Token': auth.data.csrfToken }) }),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return {
          status: response.status, data: await response.json(),
          cookie: response.headers.get('set-cookie')?.split(';')[0],
        };
      }
      const legacy = await request('/auth/login', { method: 'POST', body: { username: 'legacy-admin', password } });
      assert.equal(legacy.status, 200);
      const alphaAdmin = await registerPersonal(request,'alpha-admin',password);
      const betaAdmin = await registerPersonal(request,'beta-admin',password);
      const learner = await registerPersonal(request,'test-learner',password);
      const another = await registerPersonal(request,'test-another',password);
      const platform = await registerPersonal(request,'platform-admin',password);
      await provisionPlatformAdministrator(pool,{username:'platform-admin'});
      const alpha = await provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      const beta = await provisionSchool(pool, { slug: 'school-beta', name: 'Beta School', adminUsername: 'beta-admin' });
      const retry = await provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'alpha-admin' });
      assert.equal(retry.id, alpha.id);
      await assert.rejects(provisionSchool(pool, { slug: 'school-alpha', name: 'Alpha School', adminUsername: 'beta-admin' }), { status: 409 });
      await assert.rejects(provisionSchool(pool, { slug: 'invalid slug', name: 'Invalid', adminUsername: 'alpha-admin' }), { status: 400 });

      const members = school => `/schools/${school.id}/members`;
      assert.equal((await request('/schools')).status, 401);
      assert.deepEqual((await request('/schools', { auth: alphaAdmin })).data.items.map(s => s.id), [alpha.id]);
      assert.equal((await request('/platform/accounts', { auth: alphaAdmin })).status, 403, 'school admin grant cannot manage platform accounts');
      assert.equal((await request(members(beta), { auth: alphaAdmin })).status, 404);
      assert.equal((await request(members(alpha), { auth: legacy })).status, 404, 'legacy admin cannot browse a pilot school');
      const post = (path, auth, body, csrf=true) => request(path,{method:'POST',auth,body,csrf});
      const path = school => `/schools/${school.id}/join-requests`;
      const facts = {kind:'student',number:'S001',name:'Alpha Learner'};
      const decide = (school,id,auth,decision,identityId) => post(path(school)+'/'+id+'/decision',auth,{decision,identityId});
      assert.equal((await post('/school-invitations/accept',learner,{token:'unused'})).status,404);
      assert.equal((await post('/schools/'+alpha.id+'/invitations',alphaAdmin,{role:'school_admin'})).status,404);
      assert.equal((await post('/auth/register',undefined,{})).status,404);
      assert.equal((await post('/auth/claim-identity',undefined,{})).status,401);
      assert.equal((await post('/auth/verify-identity',undefined,{})).status,401);
      assert.equal((await post(path(alpha),undefined,facts)).status,401);
      assert.equal((await post(path(alpha),learner,facts,false)).status,403);
      assert.equal((await post(path(alpha),learner,{...facts,kind:'school_admin'})).status,400);
      const submissions=await Promise.all([1,2].map(()=>post(path(alpha),learner,facts)));
      assert.deepEqual(submissions.map(r=>r.status).sort(),[200,201]);
      const id=submissions[0].data.id;
      assert.equal(id,submissions[1].data.id);
      assert.equal((await post(path(alpha),learner,{...facts,name:'Different'})).status,409);
      assert.deepEqual((await request('/schools',{auth:learner})).data.items,[]);
      assert.deepEqual((await request('/schools/join-requests',{auth:another})).data.items,[]);
      assert.equal((await request('/schools/join-requests',{auth:learner})).data.items[0].status,'pending');
      const list = async () => (await request(path(alpha),{auth:alphaAdmin})).data.items;
      assert.equal((await list())[0].identityId,null);
      const make = async (school,auth,body) => (await post('/schools/'+school.id+'/identities',auth,body)).data;
      const local=await make(alpha,alphaAdmin,facts),foreign=await make(beta,betaAdmin,facts);
      const different=await make(alpha,alphaAdmin,{...facts,number:'S002'});
      assert.equal((await list())[0].identityId,local.id);
      assert.equal((await request(path(alpha),{auth:learner})).status,404);
      assert.equal((await decide(beta,id,betaAdmin,'approved',foreign.id)).status,404);
      assert.equal((await decide(alpha,id,betaAdmin,'approved',local.id)).status,404);
      for (const wrong of [foreign,different]) assert.equal((await decide(alpha,id,alphaAdmin,'approved',wrong.id)).status,409);
      const collision=await post(path(alpha),another,facts);
      const sourceCode=(await post('/schools/'+alpha.id+'/identities/'+local.id+'/activation-code',alphaAdmin,{})).data.activationCode;
      const approvals=await Promise.all([1,2].map(()=>decide(alpha,id,alphaAdmin,'approved',local.id)));
      assert.deepEqual(approvals.map(r=>r.status),[200,200]);
      assert.equal((await decide(alpha,collision.data.id,alphaAdmin,'approved',local.id)).status,409);
      assert.equal((await decide(alpha,collision.data.id,alphaAdmin,'rejected')).status,200);
      assert.deepEqual((await request('/schools',{auth:another})).data.items,[]);
      assert.equal((await request('/schools/join-requests',{auth:another})).data.items[0].status,'rejected');
      assert.equal((await request(members(alpha),{auth:learner})).status,403);
      assert.equal((await pool.query('SELECT account_id FROM school_identities WHERE id=$1',[local.id])).rows[0].account_id,learner.data.user.id);
      assert.equal((await post('/auth/claim-identity',another,{...facts,schoolSlug:alpha.slug,activationCode:sourceCode})).status,400);
      assert.equal((await post(path(alpha),learner,facts)).status,409);
      const pending=await post(path(beta),learner,facts);
      const issue=await post('/schools/'+beta.id+'/identities/'+foreign.id+'/activation-code',betaAdmin,{});
      const claim={...facts,schoolSlug:beta.slug,activationCode:issue.data.activationCode};
      assert.equal((await post('/auth/claim-identity',learner,claim,false)).status,403);
      assert.equal((await post('/auth/claim-identity',learner,claim)).status,200);
      const joinedSchools = (await request('/schools',{auth:learner})).data.items;
      assert.deepEqual(Object.fromEntries(joinedSchools.map(s=>[s.id,s.studentProfileId])),{
        [alpha.id]:local.id, [beta.id]:foreign.id,
      });
      for (const school of joinedSchools) {
        const self = await request(`/schools/${school.id}/profiles/${school.studentProfileId}`, {auth:learner});
        assert.equal(self.data.profile.isSelf,true);
      }
      assert.equal((await request('/schools',{auth:alphaAdmin})).data.items[0].studentProfileId,null);
      assert.equal((await decide(beta,pending.data.id,betaAdmin,'approved',foreign.id)).status,409);
      assert.equal((await request('/schools/join-requests',{auth:learner})).data.items.find(r=>r.id===pending.data.id).status,'superseded');
      assert.equal((await request('/auth/me',{auth:learner})).data.user.id,learner.data.user.id);
      assert.equal((await post('/auth/claim-identity',another,claim)).status,400);
      assert.equal((await request('/platform/accounts',{auth:learner})).status,403);

      await t.test('students without a number require an independently verified choice of school record', async () => {
        const applicant = await registerPersonal(request,'unknown-number',password);
        const info = {kind:'student',name:'Same Name',rosterHint:'Year 8, homeroom Lee'};
        for (const body of [{...info,kind:'teacher'},{...info,rosterHint:' '},{...info,rosterHint:'x'.repeat(161)}]) {
          assert.equal((await post(path(alpha),applicant,body)).status,400);
        }
        const a = await make(alpha,alphaAdmin,{...info,number:'N01'});
        const b = await make(alpha,alphaAdmin,{...info,number:'N02'});
        const outside = await make(beta,betaAdmin,{...info,number:'N02'});
        const teacher = await make(alpha,alphaAdmin,{...info,kind:'teacher',number:'T02'});
        const submission = await post(path(alpha),applicant,info);
        assert.equal(submission.status,201);
        const requestId = submission.data.id;
        assert.equal((await post(path(alpha),applicant,{...info,number:' '})).data.id,requestId);
        assert.equal((await post(path(alpha),applicant,{...info,rosterHint:'Other'})).status,409);
        assert.deepEqual((await request('/schools',{auth:applicant})).data.items,[]);
        assert.deepEqual(Object.keys(submission.data).sort(),['id','status']);
        const item = (await list()).find(r=>r.id===requestId);
        assert.equal(item.identityId,null);
        assert.equal(item.rosterHint,info.rosterHint);
        const candidates = path(alpha)+'/'+requestId+'/candidates';
        assert.equal((await request(candidates,{auth:applicant})).status,404);
        assert.equal((await request(candidates,{auth:betaAdmin})).status,404);
        assert.deepEqual((await request(candidates,{auth:alphaAdmin})).data.items.map(r=>r.id),[a.id,b.id]);
        const approve = (identityId,verificationMethod) => post(path(alpha)+'/'+requestId+'/decision',alphaAdmin,{decision:'approved',identityId,verificationMethod});
        assert.equal((await approve(b.id)).status,400);
        assert.equal((await approve(b.id,'same_name')).status,400);
        for (const wrong of [teacher,local,outside]) assert.equal((await approve(wrong.id,'in_person')).status,409);
        assert.equal((await approve(b.id,'school_contact')).status,200);
        assert.equal((await approve(b.id,'school_contact')).status,200);
        assert.equal((await request(path(alpha)+'/'+requestId+'/candidates',{auth:alphaAdmin})).data.items.length,0);
        const own = await request('/schools/join-requests',{auth:applicant});
        assert.equal(own.data.items[0].status,'approved');
        assert.equal(own.data.items[0].number,null);
        const checked = await pool.query('SELECT identity_id,decided_by,verification_method FROM school_join_requests WHERE id=$1',[requestId]);
        assert.deepEqual(checked.rows[0],{identity_id:b.id,decided_by:alphaAdmin.data.user.id,verification_method:'school_contact'});
        const sibling = await registerPersonal(request,'other-same-name',password);
        const next = await post(path(alpha),sibling,info);
        assert.deepEqual((await request(path(alpha)+'/'+next.data.id+'/candidates',{auth:alphaAdmin})).data.items.map(r=>r.id),[a.id]);
        const used = await post(path(alpha)+'/'+next.data.id+'/decision',alphaAdmin,{decision:'approved',identityId:b.id,verificationMethod:'in_person'});
        assert.equal(used.status,409);
        assert.equal((await decide(alpha,next.data.id,alphaAdmin,'rejected')).status,200);
        assert.deepEqual((await request('/schools',{auth:sibling})).data.items,[]);
      });

      await t.test('school admins can create a verified student record and approve exactly once', async () => {
        const secondAdmin = await registerPersonal(request, 'alpha-reviewer', password);
        assert.ok((await post('/platform/schools/'+alpha.id+'/administrators', platform, {username:'alpha-reviewer'})).status < 300);
        const name = 'Unlisted Student';
        const facts = {kind:'student', name, rosterHint:'Class 8A'};
        async function apply(username, details = facts) {
          const account = await registerPersonal(request, username, password);
          const response = await post(path(alpha), account, details);
          assert.equal(response.status, 201);
          const review = path(alpha)+'/'+response.data.id;
          return {
            account, id:response.data.id,
            records: async () => (await request(review+'/candidates', {auth:alphaAdmin})).data,
            approve: (body, admin = alphaAdmin) => post(review+'/decision', admin, {decision:'approved', ...body}),
          };
        }
        const first = await apply('new-student');
        const empty = await first.records();
        assert.deepEqual(empty.records, []);
        const body = {createNumber:'NEW01', verificationMethod:'in_person', recordsVersion:empty.version};
        for (const invalid of [{createNumber:' '}, {verificationMethod:undefined}, {identityId:local.id}, {decision:'rejected'}]) {
          assert.equal((await first.approve({...body, ...invalid})).status, 400);
        }
        assert.equal((await first.approve(body, first.account)).status, 404);
        assert.equal((await first.approve(body, betaAdmin)).status, 404);
        const concurrent = await Promise.all([first.approve(body), first.approve(body, secondAdmin)]);
        assert.deepEqual(concurrent.map(r => r.status), [200,200]);
        assert.equal((await first.approve({...body,createNumber:'NEW02'})).status, 409);
        const {rows:[created]} = await pool.query(`SELECT i.id,i.name,i.number,i.account_id,r.number AS requested_number,
          r.roster_hint,r.created_student_number,r.verification_method,m.role
          FROM school_join_requests r JOIN school_identities i ON i.id=r.identity_id
          JOIN school_memberships m ON m.school_id=i.school_id AND m.account_id=i.account_id
          WHERE r.id=$1 AND r.status='approved'`, [first.id]);
        assert.deepEqual(created, {id:created.id,name,number:'NEW01',account_id:first.account.data.user.id,
          requested_number:null,roster_hint:'Class 8A',created_student_number:'NEW01',verification_method:'in_person',role:'student'});
        const audit = await pool.query('SELECT action FROM school_audit_events WHERE school_id=$1 AND target_id IN ($2,$3) ORDER BY action',
          [alpha.id,created.id,first.id]);
        assert.deepEqual(audit.rows.map(row => row.action), ['school.identity.create','school.identity.link','school.join_request.approved']);
        assert.deepEqual((await request('/schools',{auth:first.account})).data.items.map(s=>s.id), [alpha.id]);

        const same = await apply('namesake');
        const before = await same.records();
        assert.deepEqual(before.records.map(r=>[r.number,r.status]), [['NEW01','linked']]);
        assert.deepEqual(before.items, []);
        const archived = await make(alpha,alphaAdmin,{kind:'student',name,number:'OLD01'});
        assert.equal((await post('/schools/'+alpha.id+'/identities/'+archived.id+'/archive',alphaAdmin,{})).status,200);
        const create = {...body,createNumber:'NEW02',recordsVersion:before.version,distinctStudent:true};
        assert.equal((await same.approve(create)).data.error.code, 'ROSTER_CHANGED');
        const after = await same.records();
        assert.deepEqual(after.records.map(r=>[r.number,r.status]), [['NEW01','linked'],['OLD01','archived']]);
        create.recordsVersion = after.version;
        assert.equal((await same.approve({...create,distinctStudent:false})).data.error.code, 'REVIEW_SAME_NAME');
        for (const used of ['NEW01','OLD01','S002']) {
          assert.equal((await same.approve({...create,createNumber:used})).data.error.code, 'NUMBER_IN_USE');
        }
        assert.equal((await same.approve(create)).status,200);

        const numbered = await apply('prior-number',{kind:'student',name:'Another Learner',number:'N-GIVEN'});
        const given = {...body, recordsVersion:(await numbered.records()).version, verificationMethod:'school_contact'};
        assert.equal((await numbered.approve({...given,createNumber:'N-OTHER'})).status,400);
        assert.equal((await numbered.approve({...given,createNumber:'N-GIVEN'})).status,200);
        const teacher = await apply('new-teacher',{kind:'teacher',name:'Faculty',number:'T101'});
        assert.equal((await teacher.approve({...body,createNumber:'T101',recordsVersion:(await teacher.records()).version})).status,400);

        const contenders = await Promise.all(['east','west'].map(suffix =>
          apply('racing-'+suffix,{...facts,name:'Learner '+suffix})));
        const snapshots = await Promise.all(contenders.map(candidate => candidate.records()));
        const race = await Promise.all(contenders.map((candidate, index) => candidate.approve(
          {...body,createNumber:'SHARED',recordsVersion:snapshots[index].version}, index ? secondAdmin : alphaAdmin)));
        assert.deepEqual(race.map(result => result.status).sort(), [200,409]);
        assert.equal(race.find(result => result.status === 409).data.error.code, 'NUMBER_IN_USE');
        assert.equal((await pool.query("SELECT id FROM school_identities WHERE school_id=$1 AND number='SHARED'",[alpha.id])).rowCount,1);

        const paused = await apply('paused-student',{kind:'student',name:'Paused Student',number:'PAUSED'});
        await seedUnlinkedMembership(pool,alpha.id,paused.account.data.user.id,'student');
        const suspend = await request('/schools/'+alpha.id+'/accounts/'+paused.account.data.user.id+'/access',
          {method:'PATCH',auth:alphaAdmin,body:{suspended:true}});
        assert.equal(suspend.status,200);
        assert.equal((await paused.approve({...body,createNumber:'PAUSED',recordsVersion:(await paused.records()).version})).data.error.code, 'SCHOOL_ACCESS_SUSPENDED');
        assert.equal((await pool.query("SELECT id FROM school_identities WHERE school_id=$1 AND number='PAUSED'",[alpha.id])).rowCount,0);
        assert.equal((await pool.query("SELECT status FROM school_join_requests WHERE id=$1",[paused.id])).rows[0].status,'pending');
      });

      await t.test('inline approval assigns selected local classes atomically and never replays later roster changes', async () => {
        const classes = school => '/schools/'+school.id+'/classes';
        async function createClass(school, admin, name) {
          const response = await post(classes(school), admin, {name, type:'training'});
          assert.equal(response.status, 201);
          return response.data.id;
        }
        const a = await createClass(alpha, alphaAdmin, 'Class A');
        const b = await createClass(alpha, alphaAdmin, 'Class B');
        const closed = await createClass(alpha, alphaAdmin, 'Archived class');
        const outside = await createClass(beta, betaAdmin, 'Class A');
        const applicant = await registerPersonal(request, 'student-for-classes', password);
        const submission = await post(path(alpha), applicant, {kind:'student', name:'Class Learner', rosterHint:'Class A'});
        const review = path(alpha)+'/'+submission.data.id;
        const {data:records} = await request(review+'/candidates', {auth:alphaAdmin});
        const approve = (classIds, admin = alphaAdmin) => post(review+'/decision', admin, {
          decision:'approved', createNumber:'C-001', verificationMethod:'in_person', recordsVersion:records.version, classIds,
        });
        assert.equal((await post(classes(alpha)+'/'+closed+'/archive', alphaAdmin, {expectedRevision:1})).status, 200);
        for (const [invalid, status] of [[[a,outside],404], [[a,closed],409], [[a,'bad-id'],400], [null,400]]) {
          assert.equal((await approve(invalid)).status, status);
        }
        assert.equal((await approve([a,b], betaAdmin)).status, 404);
        assert.equal((await approve([a,b], applicant)).status, 404);
        assert.equal((await post(review+'/decision',alphaAdmin,{decision:'rejected',classIds:[a]})).status,400);
        assert.equal((await post(review+'/decision',alphaAdmin,{decision:'approved',identityId:local.id,classIds:[a]})).status,400);
        assert.equal((await list()).some(r => r.id === submission.data.id), true);
        assert.deepEqual((await request('/schools',{auth:applicant})).data.items, []);
        assert.equal((await pool.query("SELECT id FROM school_identities WHERE school_id=$1 AND number='C-001'", [alpha.id])).rowCount, 0);

        const decisions = await Promise.all([approve([b,a,a.toUpperCase()]), approve([a,b])]);
        assert.deepEqual(decisions.map(r => r.status), [200,200]);
        assert.equal((await approve([a])).status, 409);
        const assigned = async () => (await request(classes(alpha),{auth:applicant})).data.items.map(c => c.id).sort();
        assert.deepEqual(await assigned(), [a,b].sort());
        const {rows:[record]} = await pool.query('SELECT identity_id FROM school_join_requests WHERE id=$1', [submission.data.id]);
        for (const classId of [a,b]) {
          const classroom = await request(classes(alpha)+'/'+classId, {auth:applicant});
          assert.deepEqual(classroom.data.members.map(person => person.id), [record.identity_id]);
        }
        const {rowCount} = await pool.query("SELECT 1 FROM school_audit_events WHERE action='school.roster.add' AND target_id=$1",[record.identity_id]);
        assert.equal(rowCount, 2);
        const change = await request('/schools/'+alpha.id+'/identities/'+record.identity_id+'/classes', {
          method:'PATCH', auth:alphaAdmin, body:{expectedClassIds:[a,b], classIds:[a]},
        });
        assert.equal(change.status, 200);
        assert.equal((await approve([b,a])).status, 200);
        assert.deepEqual(await assigned(), [a]);
      });

      await t.test('link approval starts from the student roster and applies class changes with the account binding', async () => {
        const classes = '/schools/'+alpha.id+'/classes';
        async function newClass(name, school = alpha, admin = alphaAdmin) {
          const response = await post('/schools/'+school.id+'/classes',admin,{name,type:'training'});
          assert.equal(response.status,201);
          return response.data.id;
        }
        const a = await newClass('Review A'), b = await newClass('Review B'), c = await newClass('Review C');
        const historical = await newClass('Old class'), outside = await newClass('Review A',beta,betaAdmin);
        async function existing(username, classIds, {numberProvided = true, kind = 'student'} = {}) {
          const account = await registerPersonal(request,username,password);
          const facts = {kind,number:username,name:'Learner '+username};
          const record = await make(alpha,alphaAdmin,{...facts,classIds});
          const application = await post(path(alpha),account,numberProvided ? facts : {...facts,number:null,rosterHint:'Homeroom'});
          assert.equal(application.status,201);
          const endpoint = path(alpha)+'/'+application.data.id;
          return {
            id:record.id, account,
            snapshot: async () => (await request(endpoint+'/candidates',{auth:alphaAdmin})).data.items,
            approve: (selection, admin = alphaAdmin) => post(endpoint+'/decision',admin,{decision:'approved', identityId:record.id,
              ...(!numberProvided && {verificationMethod:'in_person'}), ...selection}),
            visible: async () => (await request(classes,{auth:account})).data.items.map(row=>row.id).sort(),
            roster: async () => (await request('/schools/'+alpha.id+'/identities/'+record.id+'/classes',{auth:alphaAdmin})).data.classes,
          };
        }
        const student = await existing('prefilled-student',[a,historical],{numberProvided:false});
        assert.equal((await post(classes+'/'+historical+'/archive',alphaAdmin,{expectedRevision:1})).status,200);
        assert.deepEqual((await student.snapshot())[0].classIds,[a]);
        const change = {expectedClassIds:[a],classIds:[b]};
        assert.equal((await student.approve(change,betaAdmin)).status,404);
        assert.equal((await student.approve(change,student.account)).status,404);
        assert.equal((await student.approve({...change,classIds:[outside]})).status,404);
        assert.equal((await student.approve({...change,classIds:[historical]})).status,409);
        assert.equal((await student.approve({...change,verificationMethod:undefined})).status,400);
        assert.equal((await post(classes+'/'+c+'/roster',alphaAdmin,{identityId:student.id})).status,201);
        assert.equal((await student.approve(change)).data.error.code,'ROSTER_CHANGED');
        assert.deepEqual((await request('/schools',{auth:student.account})).data.items,[]);
        const current = (await student.snapshot())[0].classIds;
        assert.deepEqual(current.sort(),[a,c].sort());
        const confirmed = {expectedClassIds:current,classIds:[b,c]};
        const repeated = await Promise.all([student.approve(confirmed),student.approve({...confirmed,classIds:[c,b,b]})]);
        assert.deepEqual(repeated.map(r=>r.status),[200,200]);
        assert.deepEqual(await student.visible(),[b,c].sort());
        assert.deepEqual((await student.roster()).map(row=>row.id).sort(),[b,c,historical].sort());
        assert.equal((await student.approve({...confirmed,classIds:[a]})).status,409);
        const audit = await pool.query("SELECT count(*)::int AS n FROM school_audit_events WHERE target_id=$1 AND action='school.roster.remove'",[student.id]);
        assert.equal(audit.rows[0].n,1);
        assert.equal((await request('/schools/'+alpha.id+'/identities/'+student.id+'/classes',{
          auth:alphaAdmin,method:'PATCH',body:{expectedClassIds:[b,c],classIds:[b]},
        })).status,200);
        assert.equal((await student.approve(confirmed)).status,200);
        assert.deepEqual(await student.visible(),[b]);
        for (const [username,original,desired] of [
          ['first-placement',[],[a,b]], ['keep-placement',[a],[a]], ['clear-placement',[b],[]],
        ]) {
          const person = await existing(username,original);
          const [candidate] = await person.snapshot();
          assert.equal(candidate.id,person.id);
          assert.deepEqual(candidate.classIds,original);
          assert.equal((await person.approve({expectedClassIds:candidate.classIds,classIds:desired})).status,200);
          assert.deepEqual(await person.visible(),[...desired].sort());
        }
        const staff = await existing('staff-placement',[a],{kind:'teacher'});
        assert.equal((await staff.approve(change)).status,400);
        assert.equal((await staff.approve({})).status,200);
        assert.deepEqual(await staff.visible(),[a]);
        const suspended = await existing('paused-placement',[a]);
        await seedUnlinkedMembership(pool,alpha.id,suspended.account.data.user.id,'student');
        assert.equal((await request('/schools/'+alpha.id+'/accounts/'+suspended.account.data.user.id+'/access',{
          method:'PATCH',auth:alphaAdmin,body:{suspended:true},
        })).status,200);
        assert.equal((await suspended.approve(change)).data.error.code,'SCHOOL_ACCESS_SUSPENDED');
        assert.deepEqual((await suspended.roster()).map(row=>row.id),[a]);
        assert.equal((await suspended.snapshot())[0].id,suspended.id);
      });

      // Members who previously used a general invitation can finish linking their original dossier.
      await seedUnlinkedMembership(pool,beta.id,another.data.user.id,'student');
      const memberFacts={kind:'student',name:'Previous member',number:'S003'};
      const oldMemberRequest=await post(path(beta),another,memberFacts);
      assert.equal(oldMemberRequest.status,201);
      const existing=await make(beta,betaAdmin,memberFacts);
      const bind=await request('/schools/'+beta.id+'/identities/'+existing.id+'/account',{
        method:'PATCH',auth:betaAdmin,body:{accountId:another.data.user.id},
      });
      assert.equal(bind.status,200);
      assert.equal((await request('/schools/join-requests',{auth:another})).data.items.find(r=>r.id===oldMemberRequest.data.id).status,'superseded');
      assert.equal((await decide(beta,oldMemberRequest.data.id,betaAdmin,'approved',existing.id)).status,409);
      assert.equal((await post(path(beta),another,memberFacts)).status,409);
      const attempts=await request('/schools/'+beta.id+'/accounts/'+another.data.user.id+'/access',{
        method:'PATCH',auth:betaAdmin,body:{suspended:true},
      });
      assert.equal(attempts.status,200);
      assert.equal((await post(path(beta),another,memberFacts)).data.error.code,'SCHOOL_ACCESS_SUSPENDED');

      await t.test('closing either guestbook preserves its threads and independently blocks new messages and replies', async () => {
        const settings = '/account/guestbook-settings';
        const schoolBook = '/schools/'+alpha.id+'/profiles/'+local.id+'/messages';
        const practiceProfile = '/practice/profiles/'+learner.data.user.id;
        const practiceBook = practiceProfile+'/messages';
        const patch = (scope,open,auth=learner,csrf=true) => request(settings,{method:'PATCH',auth,csrf,body:{scope,open}});
        const add = async (book,auth,body,quoteId) => {
          const result = await post(book,auth,{body,quoteId});
          assert.equal(result.status,201,JSON.stringify(result.data.error));
          return result.data.id;
        };
        assert.equal((await request(settings)).status,401);
        assert.equal((await patch('school',false,learner,false)).status,403);
        assert.equal((await patch('school','false')).status,400);
        assert.equal((await patch('other',true)).status,400);
        assert.deepEqual((await request(settings,{auth:learner})).data,{schoolOpen:true,practiceOpen:true,profileEnabled:false});
        assert.equal((await request(practiceBook,{auth:another})).status,404);
        assert.equal((await request(practiceProfile,{method:'PATCH',auth:learner,body:{profileEnabled:true}})).status,200);

        const schoolRoot = await add(schoolBook,learner,'School message');
        const schoolReply = await add(schoolBook,alphaAdmin,'School reply',schoolRoot);
        for (let attempt=0; attempt<2; attempt++) {
          assert.deepEqual((await patch('school',false)).data,{schoolOpen:false,practiceOpen:true,profileEnabled:true});
        }
        const publicRoot = await add(practiceBook,another,'Practice message');
        const publicReply = await add(practiceBook,platform,'Practice reply',publicRoot);
        assert.deepEqual((await patch('practice',false)).data,{schoolOpen:false,practiceOpen:false,profileEnabled:true});

        for (const [book,reader,root,reply] of [[schoolBook,alphaAdmin,schoolRoot,schoolReply],[practiceBook,another,publicRoot,publicReply]]) {
          const history = (await request(book,{auth:reader})).data;
          assert.equal(history.acceptingMessages,false);
          assert.deepEqual(history.items.map(item=>[item.id,item.replyCount]),[[root,1]]);
          const replies = (await request(book+'/'+root+'/replies',{auth:reader})).data;
          assert.deepEqual(replies.items.map(item=>item.id),[reply]);
          for (const [author,quoteId] of [[learner,null],[reader,root],[learner,reply]]) {
            const denied = await post(book,author,{body:'Closed',quoteId});
            assert.equal(denied.status,403);
            assert.equal(denied.data.error.code,'GUESTBOOK_CLOSED');
          }
        }
        assert.equal((await request('/schools/'+beta.id+'/profiles/'+foreign.id+'/messages',{auth:betaAdmin})).data.acceptingMessages,false);
        assert.equal((await request(schoolBook,{auth:betaAdmin})).status,404);
        assert.equal((await request(settings,{auth:another})).data.practiceOpen,true);

        assert.deepEqual((await patch('school',true)).data,{schoolOpen:true,practiceOpen:false,profileEnabled:true});
        const reviewer = await registerPersonal(request,'guestbook-reviewer',password);
        assert.ok((await post('/platform/schools/'+alpha.id+'/administrators',platform,{username:'guestbook-reviewer'})).status<300);
        await add(schoolBook,reviewer,'Reopened school reply',schoolRoot);
        assert.deepEqual((await patch('practice',true)).data,{schoolOpen:true,practiceOpen:true,profileEnabled:true});
        await add(practiceBook,betaAdmin,'Reopened practice message');
      });
    } finally {
      await app?.close();
      await pool.end();
      await manager.query(`DROP SCHEMA ${schema} CASCADE`);
      await manager.end();
    }
  });
