import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword } from '../src/security.mjs';
import { LEGACY_SCHOOL_ID, provisionSchool } from '../src/schools.mjs';
import { importAcslPaper, importAcslPapers } from '../src/acsl-import.mjs';
import { handleAcsl } from '../src/acsl.mjs';

test('a full catalog uses bounded queries and compact rows while preserving account progress and school visibility',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 }, async t => {
    const base = new URL(process.env.TEST_DATABASE_URL); assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
    const schema = `acsl_catalog_${randomBytes(5).toString('hex')}`, manager = createPool(base.href);
    const scoped = new URL(base); scoped.searchParams.set('options', `-csearch_path=${schema}`);
    const owner = createPool(scoped.href); let app;
    try {
      await manager.query(`CREATE SCHEMA ${schema}`); await migrate(owner);
      const grants = (await readFile(new URL('../grants.mjs', import.meta.url), 'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
      await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));
      const passwordHash = await hashPassword(randomBytes(24).toString('base64url')), users = {};
      for (const [name, role] of [['teacher', 'teacher'], ['student', 'student'], ['other', 'student']]) {
        const identity = randomUUID();
        await owner.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$3)', [identity, role, name]);
        const account = (await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
          [identity, name, passwordHash])).rows[0];
        await owner.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)', [account.id, role]);
        await owner.query('INSERT INTO legacy_school_identity_ownership(identity_id) VALUES($1) ON CONFLICT DO NOTHING', [identity]);
        await owner.query('INSERT INTO legacy_school_account_ownership(account_id) VALUES($1) ON CONFLICT DO NOTHING', [account.id]);
        users[name] = { ...account, roles: [role] };
      }
      const source = JSON.parse(await readFile(new URL('../content/acsl/sample.json', import.meta.url), 'utf8'));
      const packages = Array.from({ length: 96 }, (_, index) => {
        const content = structuredClone(source); content.slug = `acsl-catalog-${String(index).padStart(3, '0')}`;
        if (index % 4 === 0) { content.division = 'Elementary'; content.programming = null; }
        return { content };
      });
      const papers = await importAcslPapers(owner, { schoolId: LEGACY_SCHOOL_ID, ownerAccountId: users.teacher.id, packages });
      const foreignSchool = await provisionSchool(owner, { slug: 'catalog-foreign', name: 'Other school', adminUsername: 'teacher' });
      await importAcslPaper(owner, { schoolId: foreignSchool.id, ownerAccountId: users.teacher.id,
        content: { ...source, slug: 'foreign-catalog-paper' } });
      const roleUrl = new URL(scoped); roleUrl.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
      app = createPool(roleUrl.href);
      const root = `/schools/${LEGACY_SCHOOL_ID}/acsl`;
      const request = (user, path = '', method = 'GET', body = {}, pool = app) => handleAcsl({ pool, user: users[user],
        route: root + path, method, body, url: new URL(`http://catalog.test${root}${path}`) });
      const measure = async (user, path = '') => {
        let queries = 0, bytes = 0;
        const measured = { connect: async () => {
          const client = await app.connect();
          return { release: () => client.release(), query: async (...args) => {
            queries++; const result = await client.query(...args); bytes += Buffer.byteLength(JSON.stringify(result.rows));
            return result;
          } };
        } };
        const result = await request(user, path, 'GET', {}, measured);
        assert.ok(queries <= 10, `Catalog must not query every edition separately (${queries} queries)`);
        assert.ok(bytes < 100000, `Catalog must not fetch private definitions or full answer snapshots (${bytes} bytes)`);
        return result.body;
      };
      await t.test('96-paper student and teacher lists are compact and omit protected content', async () => {
        for (const [user, path] of [['student', ''], ['teacher', '/manage']]) {
          const catalog = await measure(user, path); assert.equal(catalog.enabled, true); assert.equal(catalog.items.length, 96);
          assert.equal(catalog.items.filter(item => item.hasProgramming).length, 72);
          assert.doesNotMatch(JSON.stringify(catalog), /correctOptionIds|referenceCode|"solution"|"tests"|"answers"|"statement"/);
          assert.ok(catalog.items.every(item => item.slug.startsWith('acsl-catalog-')));
        }
      });
      await t.test('empty, obsolete and foreign-account drafts do not inflate the answered count', async () => {
        const paper = papers[1], path = `/${paper.id}`;
        await request('student', `${path}/questions/q1/draft`, 'PATCH', { versionId: paper.versionId,
          expectedRevision: 0, selectedOptionIds: ['A'] });
        await request('student', `${path}/questions/q2/draft`, 'PATCH', { versionId: paper.versionId,
          expectedRevision: 0, selectedOptionIds: [] });
        await request('other', `${path}/questions/q2/draft`, 'PATCH', { versionId: paper.versionId,
          expectedRevision: 0, selectedOptionIds: ['B'] });
        await owner.query(`INSERT INTO acsl_drafts(school_id,paper_id,version_id,account_id,question_id,selected_option_ids)
          VALUES($1,$2,$3,$4,'obsolete-question','["A"]')`, [LEGACY_SCHOOL_ID, paper.id, paper.versionId, users.student.id]);
        const catalog = (await measure('student')).items.find(item => item.id === paper.id);
        const detail = (await request('student', path)).body;
        assert.equal(catalog.answeredCount, 1); assert.equal(catalog.graded, false); assert.equal(catalog.score, null);
        for (const [key, value] of Object.entries(catalog)) assert.deepEqual(value, detail[key], key);
        assert.equal((await measure('teacher', '/manage')).items.find(item => item.id === paper.id).answeredCount, undefined);
      });
      await t.test('disabled editions and revoked or foreign membership cannot be read through the catalog', async () => {
        await owner.query('UPDATE acsl_papers SET enabled=false WHERE school_id=$1 AND id=$2', [LEGACY_SCHOOL_ID, papers[0].id]);
        assert.equal((await measure('student')).items.length, 95);
        const managed = await measure('teacher', '/manage'); assert.equal(managed.items.length, 96);
        assert.equal(managed.items.find(item => item.id === papers[0].id).enabled, false);
        const foreignRoute = `/schools/${foreignSchool.id}/acsl`;
        await assert.rejects(handleAcsl({ pool: app, user: users.student, route: foreignRoute, method: 'GET',
          url: new URL('http://catalog.test' + foreignRoute) }), error => error.status === 404);
        await owner.query('UPDATE accounts SET disabled_at=clock_timestamp() WHERE id=$1', [users.student.id]);
        await assert.rejects(request('student'), error => error.status === 401);
      });
    } finally {
      await app?.end(); await owner.end(); await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await manager.end();
    }
  });
