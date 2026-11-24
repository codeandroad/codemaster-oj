import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function registerPersonal(request, username, password) {
  const response = await request('/auth/register-personal', {
    method: 'POST', body: { username, displayName: 'QA ' + username, password },
  });
  assert.equal(response.status, 201);
  return response;
}

// Use the production application's table privileges inside the test's private schema.
export async function applicationDatabaseUrl(owner, url, schema) {
  const script = await readFile(new URL('../../../../packages/domain/grants.mjs', import.meta.url), 'utf8');
  const sql = script.match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await owner.query(sql.replaceAll('SCHEMA public', 'SCHEMA ' + schema));
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-crole=campus_app -csearch_path=${schema}`);
  return scoped.href;
}

// Existing installations can contain memberships created before dossiers were required.
export async function seedUnlinkedMembership(db, schoolId, accountId, role) {
  await db.query(`INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)
    ON CONFLICT(school_id,account_id) DO UPDATE SET revoked_at=NULL,role=EXCLUDED.role
    WHERE school_memberships.revoked_at IS NOT NULL AND NOT school_memberships.suspended`,
    [schoolId,accountId,role]);
}

export async function enrollWithClaim(post, school, admin, applicant, facts) {
  const path = '/schools/'+school.id+'/identities';
  const identity = await post(path,admin,facts,201);
  assert.equal(identity.status,201);
  const issued = await post(path+'/'+identity.data.id+'/activation-code',admin,{},201);
  assert.equal(issued.status,201);
  const claimed = await post('/auth/claim-identity',applicant,{
    ...facts, schoolSlug:school.slug, activationCode:issued.data.activationCode,
  },200);
  assert.equal(claimed.status,200);
  assert.equal(claimed.data.identityId,identity.data.id);
  return identity.data;
}
