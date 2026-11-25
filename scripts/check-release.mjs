// Launch an isolated copy of the release stack with a new database and loopback gateway.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkFormalSubmissions, browserBinary } from '../apps/web/tests/e2e/formal-submission.mjs';

const {values: options} = parseArgs({options:{
  'api-image':{type:'string'}, 'web-image':{type:'string'}, 'worker-image':{type:'string'},
  'judge-image':{type:'string'}, receipt:{type:'string'},
}});
const services = ['api','web','worker'];
const supplied = services.filter(service => options[service+'-image'] !== undefined);
assert.ok(supplied.length === 0 || supplied.length === services.length,
  'Supply the API, Web and worker candidate images together');
assert.ok(!options.receipt || !existsSync(options.receipt), 'Use a new receipt path for each release check');
try {
  accessSync(browserBinary(), constants.X_OK);
} catch (cause) {
  throw new Error('Chromium is required. Run apps/web/node_modules/.bin/playwright-core install chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.', {cause});
}

const project = 'campus-release-check-'+randomBytes(6).toString('hex');
const cwd = fileURLToPath(new URL('../',import.meta.url));
const env = {...process.env, LOCAL_PORT:'3000', RELEASE_CHECK_NETWORK:'10.254.'+randomInt(256)};
for (const key of ['POSTGRES_PASSWORD','APP_DB_PASSWORD','WORKER_DB_PASSWORD','SESSION_SECRET','JUDGE_AUTH_TOKEN']) {
  env[key] = randomBytes(32).toString('hex');
}
for (const service of [...services,'judge']) {
  const key = 'RELEASE_CHECK_'+service.toUpperCase()+'_IMAGE';
  env[key] = options[service+'-image'] ?? project+'-'+service;
}
const composeArgs = ['compose','-p',project,'--env-file','/dev/null',
  '-f','deploy/compose.local.yaml','-f','deploy/compose.release-check.yaml'];
function docker(args, extra) {
  return execFileSync('docker',args,{cwd,env,encoding:'utf8',timeout:300000,...extra})?.trim();
}
const compose = (...args) => docker([...composeArgs,...args]);
function imageId(image) {
  return docker(['image','inspect','--format','{{.Id}}',image]);
}

let proof;
let started = false;
try {
  const builds = [...(supplied.length ? [] : services), ...(options['judge-image'] ? [] : ['judge'])];
  if (builds.length) {
    console.log('Building '+builds.join(', ')+' for the release check.');
    docker([...composeArgs,'build',...builds],{stdio:'inherit'});
  }
  const images = Object.fromEntries(services.map(service => {
    const tag = env['RELEASE_CHECK_'+service.toUpperCase()+'_IMAGE'];
    return [service,{tag,id:imageId(tag)}];
  }));
  imageId(env.RELEASE_CHECK_JUDGE_IMAGE);
  console.log('Starting a disposable database, API, Web, worker and isolated executor.');
  started = true;
  compose('up','-d','--no-deps','--no-build','gateway');
  const binding = compose('port','gateway','3000').match(/^127\.0\.0\.1:(\d+)$/);
  assert.ok(binding,'Expected a dynamically allocated loopback-only gateway port');
  env.LOCAL_PORT = binding[1];
  const origin = 'http://127.0.0.1:'+env.LOCAL_PORT;
  compose('up','-d','--no-build','--wait','--wait-timeout','75',...services);

  for (const service of services) {
    const container = compose('ps','-q',service);
    assert.equal(docker(['inspect','--format','{{.Image}}',container]),images[service].id);
  }
  const deadline = Date.now() + 30000;
  for (;;) {
    const ready = await fetch(origin+'/healthz', {signal:AbortSignal.timeout(3000)})
      .then(async response => response.ok && (await response.json()).database === true)
      .catch(() => false);
    if (ready) break;
    assert.ok(Date.now() < deadline, 'The release-check API did not reach database readiness');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const fixture = JSON.parse(docker([...composeArgs,'run','--rm','--no-deps','-T','migrate','node','--input-type=module','-'],{
    input:readFileSync(new URL('../apps/web/tests/e2e/formal-submission-fixture.mjs',import.meta.url)),
  }));
  proof = {checks:await checkFormalSubmissions(origin,fixture),images};
} finally {
  if (started) compose('down','--volumes','--remove-orphans');
}
if (options.receipt) writeFileSync(options.receipt, JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Release browser checks passed.');
