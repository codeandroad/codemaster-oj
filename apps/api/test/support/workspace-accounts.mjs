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
