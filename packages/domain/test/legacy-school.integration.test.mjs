import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createPool, transaction } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { LEGACY_SCHOOL_ID, getLegacySchoolOwnershipSummary, reconcileLegacySchoolOwnership } from '../src/legacy-school.mjs';

const roots = ['classes', 'problem_banks', 'learning_paths', 'assignments', 'timed_practices', 'paper4_papers', 'learning_resources'];

test('legacy school ownership upgrades real PostgreSQL without rewriting history or claiming pilot logins', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 60000,
}, async t => {
  const manager = createPool(process.env.TEST_DATABASE_URL);
  const schema = `legacy_school_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = createPool(url.href);
  const beforeMigration = new URL('../migrations/', import.meta.url);
  async function person(db, kind, { roles = [], account = true, archived = false } = {}) {
    const identityId = randomUUID(), accountId = randomUUID();
    await db.query('INSERT INTO identities(id,kind,number,name,archived_at) VALUES($1,$2,$3,$4,$5)',
      [identityId, kind, randomUUID(), 'Migration fixture', archived ? new Date() : null]);
    if (account) {
      await db.query('INSERT INTO accounts(id,identity_id,username,password_hash) VALUES($1,$2,$3,$4)',
        [accountId, identityId, randomUUID(), randomBytes(32).toString('hex')]);
      for (const role of roles) await db.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [accountId, role]);
    }
    return { identityId, accountId };
  }
  async function digest(table, omit = []) {
    const { rows: [row] } = await pool.query(`SELECT count(*)::int AS count,
      encode(sha256(convert_to(coalesce(string_agg(value::text, E'\\n' ORDER BY value::text),''),'UTF8')),'hex') AS hash
      FROM (SELECT to_jsonb(t)-$1::text[] AS value FROM ${table} t) q`, [omit]);
    return row;
  }
  try {
    await transaction(pool, async db => {
      await db.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
      for (const name of (await readdir(beforeMigration)).filter(n => n.endsWith('.sql') && n < '055_').sort()) {
        const sql = (await readFile(new URL(name, beforeMigration), 'utf8'))
          .replaceAll('SECURITY DEFINER SET search_path=public,pg_temp', `SECURITY DEFINER SET search_path="${schema}",pg_temp`);
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      }
    });
    const administrator = await person(pool, 'admin', { roles: ['admin', 'teacher'] });
    const student = await person(pool, 'student', { roles: ['student'] });
    const unclaimed = await person(pool, 'student', { account: false, archived: true });
    const pilot = await person(pool, 'student');
    const retiredTeacher = await person(pool, 'teacher');
    const previousAccount = randomUUID();
    await pool.query('INSERT INTO accounts(id,identity_id,username,password_hash,binding_released_at,disabled_at) VALUES($1,$2,$3,$4,now(),now())',
      [previousAccount, student.identityId, randomUUID(), randomBytes(32).toString('hex')]);
    const classId = randomUUID(), courseId = randomUUID(), assignmentId = randomUUID();
    const problemId = randomUUID(), versionId = randomUUID();
    await pool.query('INSERT INTO classes(id,name,owner_account_id) VALUES($1,$2,$3)', [classId, 'Original class', administrator.accountId]);
    await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)', [classId, student.identityId]);
    await pool.query('INSERT INTO learning_paths(id,owner_account_id,title) VALUES($1,$2,$3)', [courseId, retiredTeacher.accountId, 'Original course']);
    await pool.query('INSERT INTO assignments(id,title,owner_account_id,due_at) VALUES($1,$2,$3,now()+interval \'1 day\')', [assignmentId, 'Classless assignment', administrator.accountId]);
    await pool.query('INSERT INTO problems(id,owner_account_id) VALUES($1,$2)', [problemId, administrator.accountId]);
    await pool.query(`INSERT INTO problem_versions(id,problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code)
      VALUES($1,$2,'Original problem','stdio','Original statement',1000,128,'print(1)')`, [versionId, problemId]);
    await pool.query('UPDATE problems SET current_version_id=$2 WHERE id=$1', [problemId, versionId]);
    await pool.query('INSERT INTO assignment_problems(assignment_id,problem_id,version_id,points,position) VALUES($1,$2,$3,100,0)', [assignmentId, problemId, versionId]);
    await pool.query('INSERT INTO assignment_participants(assignment_id,identity_id) VALUES($1,$2)', [assignmentId, student.identityId]);
    await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,assignment_id,kind,code,idempotency_key,request_hash,status,score)
      VALUES($1,$2,$3,$4,$5,'submit','print(1)',$6,$7,'AC',100)`,
      [previousAccount, student.identityId, problemId, versionId, assignmentId, randomUUID(), randomBytes(32).toString('hex')]);
    const tables = (await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [schema])).rows.map(r => r.tablename);
    const mutable = new Set(['schema_migrations', 'schools', 'school_audit_events', 'site_settings']);
    const before = {};
    for (const table of tables.filter(name => !mutable.has(name))) before[table] = await digest(table);
    const originalSettings = (await pool.query('SELECT settings FROM site_settings')).rows[0].settings;

    await t.test('upgrade preserves every pre-existing business row and all old FK associations', async () => {
      await migrate(pool);
      for (const [table, fingerprint] of Object.entries(before)) {
        const added = roots.includes(table) ? ['school_id'] : {
          accounts: ['default_school_id'], leaderboard_settings: ['show_luq_balance'],
        }[table] ?? [];
        assert.deepEqual(await digest(table, added), fingerprint, table);
      }
      assert.equal((await pool.query('SELECT count(*)::int n FROM accounts WHERE default_school_id IS NOT NULL')).rows[0].n, 0);
      assert.equal((await pool.query('SELECT show_luq_balance FROM leaderboard_settings')).rows[0].show_luq_balance, true);
      assert.deepEqual((await pool.query('SELECT settings FROM site_settings')).rows[0].settings,
        { ...originalSettings, schoolName: '天行创世纪学校' });
      assert.equal((await pool.query('SELECT name FROM schools WHERE id=$1', [LEGACY_SCHOOL_ID])).rows[0].name, '天行创世纪学校');
      for (const root of roots) assert.equal((await pool.query(`SELECT count(*)::int n FROM ${root} WHERE school_id<>$1 OR school_id IS NULL`, [LEGACY_SCHOOL_ID])).rows[0].n, 0, root);
      assert.equal((await pool.query('SELECT count(*)::int n FROM problems p LEFT JOIN problem_banks b ON b.id=p.bank_id WHERE b.id IS NULL')).rows[0].n, 0);
      const summary = await getLegacySchoolOwnershipSummary(pool);
      assert.equal(summary.identities, 4); assert.equal(summary.accounts, 4); assert.equal(summary.students, 2);
      assert.equal(summary.teachers, 1, 'historical course ownership survives removal of the old role');
      assert.equal(summary.submissions, 1); assert.equal(summary.classes, 1); assert.equal(summary.courses, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM legacy_school_identity_ownership WHERE identity_id=$1', [pilot.identityId])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM legacy_school_account_ownership WHERE account_id=$1', [previousAccount])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM legacy_school_identity_ownership WHERE identity_id=$1', [unclaimed.identityId])).rows[0].n, 1);
      assert.deepEqual((await pool.query('SELECT role FROM account_roles WHERE account_id=$1 ORDER BY role', [administrator.accountId])).rows.map(r => r.role), ['admin', 'teacher']);
    });

    await t.test('repeated migrations and reconciliation do not grant Luq or duplicate ownership', async () => {
      const ledger = await digest('luq_ledger'), balances = await digest('luq_accounts');
      const identities = await digest('legacy_school_identity_ownership'), accounts = await digest('legacy_school_account_ownership');
      await migrate(pool); await reconcileLegacySchoolOwnership(pool); await reconcileLegacySchoolOwnership(pool);
      assert.deepEqual(await digest('luq_ledger'), ledger); assert.deepEqual(await digest('luq_accounts'), balances);
      assert.deepEqual(await digest('legacy_school_identity_ownership'), identities);
      assert.deepEqual(await digest('legacy_school_account_ownership'), accounts);
    });

    await t.test('future people, role-based registrations and replacement credentials retain attribution', async () => {
      const fresh = await transaction(pool, db => person(db, 'student', { roles: ['student'] }));
      const publicLogin = await transaction(pool, db => person(db, 'student'));
      const imported = await transaction(pool, db => person(db, 'teacher', { account: false }));
      const mapped = async id => (await pool.query('SELECT 1 FROM legacy_school_identity_ownership WHERE identity_id=$1', [id])).rowCount;
      assert.equal(await mapped(fresh.identityId), 1); assert.equal(await mapped(imported.identityId), 1);
      assert.equal(await mapped(publicLogin.identityId), 0, 'membership-only registration stays global after commit');
      await pool.query('UPDATE accounts SET binding_released_at=now() WHERE id=$1', [fresh.accountId]);
      const nextId = randomUUID();
      await pool.query('INSERT INTO accounts(id,identity_id,username,password_hash) VALUES($1,$2,$3,$4)', [nextId, fresh.identityId, randomUUID(), randomBytes(32).toString('hex')]);
      assert.equal((await pool.query('SELECT count(*)::int n FROM legacy_school_account_ownership WHERE account_id=ANY($1::uuid[])', [[fresh.accountId, nextId]])).rows[0].n, 2);
      await pool.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')", [publicLogin.accountId]);
      assert.equal(await mapped(publicLogin.identityId), 1, 'explicit legacy role establishes school attribution');
    });

    await t.test('trusted definer paths and closed root ownership prevent accidental cross-school attribution', async () => {
      const funcs = (await pool.query(`SELECT p.proname,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=$1 AND (p.proname='assign_legacy_school_identity' OR p.proname LIKE 'legacy_school_ownership_on_%')`, [schema])).rows;
      assert.equal(funcs.length, 4);
      assert(funcs.every(f => f.proconfig?.includes(`search_path=${schema}, pg_temp`)), JSON.stringify(funcs));
      for (const f of funcs) {
        const signature = `${schema}.${f.proname}(${f.proname === 'assign_legacy_school_identity' ? 'uuid' : ''})`;
        assert.equal((await pool.query('SELECT has_function_privilege(\'campus_worker\',$1,\'EXECUTE\') allowed', [signature])).rows[0].allowed, false);
        assert.equal((await pool.query('SELECT has_function_privilege(\'campus_app\',$1,\'EXECUTE\') allowed', [signature])).rows[0].allowed, false);
      }
      const other = (await pool.query("INSERT INTO schools(slug,name) VALUES('other-school','Other') RETURNING id")).rows[0].id;
      await assert.rejects(pool.query('UPDATE classes SET school_id=$1 WHERE id=$2', [other, classId]), /check constraint/);
    });
  } finally {
    await pool.end(); await manager.query(`DROP SCHEMA ${schema} CASCADE`); await manager.end();
  }
});
