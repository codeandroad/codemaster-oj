// Idempotently adds an original English Paper 4-style sample to the isolated
// local preview. Reference solutions are validated by the ordinary isolated
// worker before publication; this script never executes candidate code.
import { readFile } from 'node:fs/promises';

const state = JSON.parse(await readFile(new URL('../.campus-local/test-accounts.json', import.meta.url), 'utf8'));
const origin = state.base;
const parsed = new URL(origin);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.port !== '3002')
  throw new Error('English Paper 4 sample may only be seeded into the isolated port 3002 preview.');
const teacher = state.accounts?.teacher;
const classId = state.fixtures?.class?.id;
if (!teacher?.username || !teacher?.password || !classId)
  throw new Error('Run the local demo seed before the English Paper 4 sample seed.');

let cookie = '', csrf = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  if (result.csrfToken) csrf = result.csrfToken;
  if (!response.ok) throw new Error(`Paper 4 English seed ${method} ${path}: HTTP ${response.status} ${result.error?.code ?? ''}`);
  return result;
}
await request('auth/login', 'POST', { username: teacher.username, password: teacher.password });
const manifest = JSON.parse(await readFile(new URL('../examples/paper4-english-practice/paper4-english-practice.json', import.meta.url), 'utf8'));
const marker = '[local-paper4-english-v2]';
if (!manifest.paper.description.startsWith(marker)) throw new Error('English Paper 4 sample marker is missing.');
let paper = (await request('paper4/papers')).items.find(item => item.description?.startsWith('[local-paper4-english-v'));
if (paper?.status === 'published' && paper.description.startsWith(marker)) {
  console.log(`English Paper 4 sample ready: ${origin}/teacher/paper4/${paper.id}`);
  process.exit(0);
}
const startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const endsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
if (!paper) {
  paper = await request('paper4/papers', 'POST', { ...manifest.paper, classId, startsAt, endsAt,
    questions: manifest.questions, runnerCases: manifest.runnerCases,
    referenceSolutions: manifest.referenceSolutions });
} else {
  // New published versions preserve every existing student's version-pinned
  // attempt. Re-running the seed after a failed validation reuses this draft.
  if (paper.status === 'published' && !paper.hasDraft)
    await request(`paper4/papers/${paper.id}/draft`, 'POST', {});
  paper = await request(`paper4/papers/${paper.id}`, 'PATCH', { ...manifest.paper,
    classId: paper.classId ?? classId, startsAt, endsAt,
    questions: manifest.questions, runnerCases: manifest.runnerCases,
    referenceSolutions: manifest.referenceSolutions });
}
const tasks = [];
for (const question of manifest.questions) {
  const queued = await request(`paper4/papers/${paper.id}/reference-runs`, 'POST', { questionKey: question.key });
  tasks.push(...queued.items);
}
const deadline = Date.now() + 120000;
for (const task of tasks) {
  let result;
  while (Date.now() < deadline) {
    result = await request(`paper4/runs/${task.id}`);
    if (result.state === 'completed' || result.state === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (result?.state !== 'completed' || result.result?.status !== 'AC')
    throw new Error(`Reference program did not pass isolated ${task.stageId} checks; draft remains unpublished.`);
}
paper = await request(`paper4/papers/${paper.id}/publish`, 'POST', {});
console.log(`English Paper 4 sample ready: ${origin}/teacher/paper4/${paper.id}`);
