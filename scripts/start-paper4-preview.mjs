// Isolated local preview for the Paper 4 worktree. Does not touch rslab or the
// existing campus-judge-local Compose project and database volume.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(root, 'deploy/.env.paper4.local');
const accountPath = resolve(root, '.campus-local/test-accounts.json');
const baseCompose = resolve(root, 'deploy/compose.local.yaml');
const previewCompose = resolve(root, 'deploy/compose.paper4-preview.yaml');
const projectName = 'campus-judge-paper4-preview';
const exists = async (path) => access(path).then(() => true, () => false);

if (!(await exists(envPath))) {
  const values = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'WORKER_DB_PASSWORD', 'SESSION_SECRET', 'JUDGE_AUTH_TOKEN']
    .map((name) => `${name}=${randomBytes(32).toString('hex')}`);
  await writeFile(envPath, [...values, 'LOCAL_PORT=3002', 'LOCAL_DB_PORT=35433', ''].join('\n'), { mode: 0o600, flag: 'wx' });
}
await chmod(envPath, 0o600);
const values = Object.fromEntries((await readFile(envPath, 'utf8')).split(/\r?\n/)
  .filter((line) => line.trim() && !line.trim().startsWith('#'))
  .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
const secrets = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'WORKER_DB_PASSWORD', 'SESSION_SECRET', 'JUDGE_AUTH_TOKEN'];
for (const name of secrets) {
  if (!/^[a-f\d]{64}$/i.test(values[name] ?? '')) throw new Error(`Invalid ${name} in Paper 4 preview configuration.`);
}
if (new Set(secrets.map((name) => values[name])).size !== secrets.length) {
  throw new Error('Paper 4 preview database roles, sessions, and executor require independent secrets.');
}
const port = Number(values.LOCAL_PORT ?? 3002);
const databasePort = Number(values.LOCAL_DB_PORT ?? 35433);
if (![port, databasePort].every((value) => Number.isInteger(value) && value >= 1024 && value <= 65535)
    || port === databasePort || port === 3000 || databasePort === 35432) {
  throw new Error('Paper 4 preview must use distinct local ports separate from the main local installation.');
}
await mkdir(resolve(root, '.campus-local'), { recursive: true, mode: 0o700 });

async function run(command, args, extraEnv = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...extraEnv }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}.`)));
  });
}
const compose = ['compose', '--project-name', projectName, '--env-file', envPath,
  '-f', baseCompose, '-f', previewCompose];
const composeEnv = { ...values, LOCAL_PORT: String(port), LOCAL_DB_PORT: String(databasePort),
  BUILDX_CONFIG: process.env.BUILDX_CONFIG ?? resolve(root, '.campus-local/buildx') };
await run('docker', [...compose, 'config', '--quiet'], composeEnv);
await run('docker', [...compose, 'up', '--build', '-d'], composeEnv);

const origin = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 180000;
while (true) {
  try {
    const [api, web] = await Promise.all([
      fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) }),
    ]);
    if (api.ok && web.ok) break;
  } catch { /* starting */ }
  if (Date.now() >= deadline) throw new Error('Paper 4 preview did not become ready; inspect its Compose service logs.');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
}
await run(process.execPath, [resolve(root, 'scripts/seed-demo.mjs')], {
  CAMPUS_DEMO_DATABASE_URL: `postgres://campus_migrator:${values.POSTGRES_PASSWORD}@127.0.0.1:${databasePort}/campus_demo`,
  CAMPUS_DEMO_API: origin,
  CAMPUS_DEMO_ORIGIN: origin,
  CAMPUS_DEMO_OUTPUT: accountPath,
});
await run(process.execPath, [resolve(root, 'scripts/seed-paper4-preview.mjs')]);
console.log(`Paper 4 local preview ready: ${origin}/login`);
console.log(`Test account details saved privately: ${accountPath}`);
