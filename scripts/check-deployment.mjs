import { readFile } from 'node:fs/promises';
const source = await readFile(process.argv[2] ?? 'deploy/.env', 'utf8');
const env = Object.fromEntries(source.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
  const index = line.indexOf('=');
  if (index < 1) throw new Error('Invalid deployment environment line.');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));
const secrets = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'WORKER_DB_PASSWORD', 'SESSION_SECRET', 'JUDGE_AUTH_TOKEN'];
for (const name of secrets) if (!/^[a-f0-9]{64}$/i.test(env[name] ?? '')) throw new Error(`${name} must be an independently generated 32-byte hex secret.`);
if (new Set(secrets.map(name => env[name])).size !== secrets.length) throw new Error('Use independent secrets for database roles, sessions and execution.');
const origin = new URL(env.APP_ORIGIN ?? '');
if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN || origin.host !== env.CAMPUS_HOST || /(^|\.)example\./.test(origin.hostname)) throw new Error('Set a real school HTTPS hostname and matching exact APP_ORIGIN.');
if (!['1', '2'].includes(env.WORKER_CONCURRENCY ?? '2')) throw new Error('Initial worker concurrency must be 1 or 2.');
console.log('Deployment settings validated. No secret values displayed.');
