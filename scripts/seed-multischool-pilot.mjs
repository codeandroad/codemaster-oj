// Add review accounts only to the isolated local pilot. Never reset existing users.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool, transaction } from '../packages/domain/src/db.mjs';
import { hashPassword } from '../packages/domain/src/security.mjs';
import { provisionPlatformAdministrator } from '../packages/domain/src/platform-governance.mjs';
import { provisionSchool } from '../packages/domain/src/schools.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, '.campus-local/multischool-pilot');
const output = resolve(directory, 'accounts.json');
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)
  && url.port === '35434' && url.pathname === '/campus_demo' && url.username === 'campus_migrator',
  'Load the isolated pilot cli.env before seeding.');
const container = JSON.parse(execFileSync('docker', ['inspect', 'campus-judge-multischool-pilot-db-1'], { encoding: 'utf8' }))[0];
assert.equal(container.Config.Labels['com.docker.compose.project'], 'campus-judge-multischool-pilot');
assert.ok(container.Mounts.some(mount => mount.Destination === '/var/lib/postgresql/data'
  && mount.Name === 'campus-judge-multischool-pilot_database'));
assert.ok(container.NetworkSettings.Ports['5432/tcp'].some(port => port.HostIp === '127.0.0.1' && port.HostPort === '35434'));

await mkdir(directory, { recursive: true, mode: 0o700 });
let state;
try { state = JSON.parse(await readFile(output, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
state ??= {
  schema: 1, origin: 'http://localhost:3004', createdAt: new Date().toISOString(),
  accounts: [
    ['pilot.alpha', 'Alpha school administrator', 'teacher'],
    ['pilot.beta', 'Beta school administrator', 'teacher'],
    ['pilot.teacher', 'Pilot teacher', 'teacher'],
    ['pilot.student', 'Pilot student', 'student'],
  ].map(([username, name, kind]) => ({ username, name, kind,
    accountId: randomUUID(), identityId: randomUUID(),
    number: 'MULTISCHOOL-' + username.toUpperCase(),
    password: randomBytes(18).toString('base64url'),
  })),
};
if (!state.accounts.some(account => account.username === 'pilot.platform')) {
  state.accounts.push({ username: 'pilot.platform', name: 'Pilot platform administrator', kind: 'teacher',
    accountId: randomUUID(), identityId: randomUUID(), number: 'MULTISCHOOL-PILOT.PLATFORM',
    password: randomBytes(18).toString('base64url') });
}
assert.equal(state.schema, 1);
assert.equal(state.origin, 'http://localhost:3004');
async function persist() {
  const temporary = output + '.tmp';
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, output);
}
await persist();
const pool = createPool(url.href);
try {
  await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('local-multischool-pilot-seed', 0))");
    for (const account of state.accounts) {
      const existing = (await db.query('SELECT id,identity_id FROM accounts WHERE username=$1', [account.username])).rows[0];
      if (existing) {
        assert.equal(existing.id, account.accountId, 'Reserved pilot username already belongs to another account.');
        assert.equal(existing.identity_id, account.identityId);
        continue;
      }
      await db.query('INSERT INTO identities(id,kind,number,name) VALUES($1,$2,$3,$4)',
        [account.identityId, account.kind, account.number, account.name]);
      await db.query('INSERT INTO accounts(id,identity_id,username,password_hash) VALUES($1,$2,$3,$4)',
        [account.accountId, account.identityId, account.username, await hashPassword(account.password)]);
      // Membership-only logins deliberately have no legacy account_roles.
    }
  });
  state.schools = [];
  for (const [slug, name, adminUsername] of [
    ['pilot-alpha', 'Alpha School', 'pilot.alpha'], ['pilot-beta', 'Beta School', 'pilot.beta'],
  ]) state.schools.push(await provisionSchool(pool, { slug, name, adminUsername }));
  if (!state.platformProvisionedAt) {
    await provisionPlatformAdministrator(pool, { username: 'pilot.platform' });
    state.platformProvisionedAt = new Date().toISOString();
  }
  state.complete = true;
  await persist();
  console.log('Pilot accounts and schools are ready. Existing passwords and memberships were preserved.');
  console.log('Private account details: ' + output);
} finally { await pool.end(); }
