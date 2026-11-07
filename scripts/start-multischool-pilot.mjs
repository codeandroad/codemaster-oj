// Local, isolated school-workspace pilot. The source database is read only.
// Do not reuse the normal local startup script: its project and volume are fixed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, cp, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = 'campus-judge-multischool-pilot';
const volume = `${project}_database`;
const sourceContainer = 'campus-judge-local-db-1';
const targetContainer = `${project}-db-1`;
const privateDir = resolve(root, '.campus-local/multischool-pilot');
const envPath = resolve(privateDir, 'runtime.env');
const cliEnvPath = resolve(privateDir, 'cli.env');
const statePath = resolve(privateDir, 'initialization.json');
const backupPath = resolve(privateDir, 'initial-source.dump');
const beforePath = resolve(privateDir, 'before-migration.json');
const reportPath = resolve(privateDir, 'migration-verification.json');
const initialReportPath = resolve(privateDir, 'initial-migration-verification.json');
const origin = 'http://localhost:3004';
const exists = path => access(path).then(() => true, () => false);
const now = () => new Date().toISOString();
const secretNames = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'WORKER_DB_PASSWORD', 'SESSION_SECRET', 'JUDGE_AUTH_TOKEN'];
const legacyId = '00000000-0000-4000-8000-000000000052';
const ownershipRoots = ['classes', 'problem_banks', 'learning_paths', 'assignments',
  'timed_practices', 'paper4_papers', 'learning_resources'];

// Compare original business values while checking 055's exact metadata
// transformation separately. This does not exempt subsequent migrations.
function fingerprintSql(plan) {
  const roots = plan.addedOwnershipColumns.map(name => `'${name}'`).join(',') || "''";
  const schoolJson = plan.addSchoolSettings ? "to_jsonb(t) - 'name_zh' - 'name_en' - 'settings_revision'" : 'to_jsonb(t)';
  const expression = `CASE
    ${plan.addPublicPresence ? "WHEN tablename='sessions' THEN 'to_jsonb(t) - ''public_presence_seen_at'''" : ''}
    ${plan.addCourseAdmissions ? "WHEN tablename='public_course_listings' THEN 'to_jsonb(t) - ''access_mode'' - ''access_generation'' - ''school_revision'' - ''legacy_revision'''" : ''}
    ${plan.addSchoolExitArchive ? "WHEN tablename='school_identities' THEN 'to_jsonb(t) - ''archived_at'''" : ''}
    ${plan.addCompletionRewardMode ? "WHEN tablename IN ('luq_activity_rules','school_scholarship_activity_rules') THEN 'to_jsonb(t) - ''require_all'''" : ''}
    ${plan.addActivityContext ? "WHEN tablename='school_judge_jobs' THEN 'to_jsonb(t) - ''activity_id'' - ''activity_attempt_id'' - ''activity_deadline_at'''" : ''}
    ${plan.addCourseParity ? "WHEN tablename='school_courses' THEN 'to_jsonb(t) - ''properties'' - ''archived_at''' WHEN tablename='school_course_publications' THEN 'to_jsonb(t) - ''properties'''" : ''}
    ${plan.addScholarshipVisibility ? "WHEN tablename='leaderboard_settings' THEN 'to_jsonb(t) - ''show_luq_balance'''" : ''}
    ${plan.addClassLifecycle ? "WHEN tablename='school_classes' THEN 'to_jsonb(t) - ''archived_at'' - ''revision'''" : ''}
    ${plan.addDefaultSchool ? "WHEN tablename='accounts' THEN 'to_jsonb(t) - ''default_school_id'''" : ''}
    WHEN tablename IN (${roots}) THEN 'to_jsonb(t) - ''school_id'''
    ${plan.renameLegacySchool ? `WHEN tablename='schools' THEN 'CASE WHEN t.id=''${legacyId}''::uuid THEN ${schoolJson.replaceAll("'","''")} - ''name'' ELSE ${schoolJson.replaceAll("'","''")} END'
    WHEN tablename='site_settings' THEN 'to_jsonb(t) - ''settings'' || jsonb_build_object(''settings'',t.settings - ''schoolName'')'` : ''}
    WHEN tablename='schools' THEN '${schoolJson.replaceAll("'","''")}'
    ELSE 'to_jsonb(t)' END`;
  const filters = [];
  if (plan.renameLegacySchool) filters.push(`WHEN tablename='school_audit_events' THEN ' WHERE NOT (school_id=''${legacyId}''::uuid AND action=''school.legacy.attributed'' AND target_id=''${legacyId}'' AND actor_account_id IS NULL)'`);
  if (plan.publicHistoricalClaims?.length) {
    // Exempt only the exact previously absent keys measured before migration,
    // and only when they are non-paying historical-consumption records.
    const keys = plan.publicHistoricalClaims.map(key => `'${key.replaceAll("'", "''")}'`).join(',');
    const condition = ` WHERE NOT (identity_id::text||'/'||subject_key = ANY(ARRAY[${keys}]::text[]) AND source_key='historical-public' AND reason='historical_public_ac' AND eligible=false AND ledger_id IS NULL)`;
    filters.push(`WHEN tablename='luq_first_ac_claims' THEN '${condition.replaceAll("'", "''")}'`);
  }
  const filter = filters.length ? `CASE ${filters.join(' ')} ELSE '' END` : "''";
  return `SELECT format($q$SELECT jsonb_build_object('table',%L,'count',count(*),
    'hash',encode(sha256(convert_to(coalesce(string_agg(row::text,chr(10) ORDER BY row::text),''),'UTF8')),'hex'))
    FROM (SELECT %s row FROM public.%I t%s) rows$q$,tablename,${expression},tablename,${filter})
    FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename
\\gexec
`;
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    ...options });
}
function optionalInspect(kind, name) {
  try { return JSON.parse(capture('docker', [kind, 'inspect', name], { stdio: ['ignore', 'pipe', 'ignore'] }))[0]; }
  catch { return null; }
}
async function run(command, args, { env = {}, stdin, stdout } = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env },
      stdio: [stdin ?? 'ignore', stdout ?? 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}.`)));
  });
}
async function saveJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
function targetQuery(sql) {
  assert.equal(targetContainer, 'campus-judge-multischool-pilot-db-1');
  return capture('docker', ['exec', '-i', targetContainer, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'campus_migrator', '-d', 'campus_demo'], { input: sql }).trim();
}
function fingerprints(plan) {
  const result = targetQuery(fingerprintSql(plan));
  return Object.fromEntries(result ? result.split('\n').map(line => {
    const row = JSON.parse(line); return [row.table, row];
  }) : []);
}
function verifyConfig(config) {
  assert.equal(config.name, project, 'Unexpected Compose project.');
  assert.equal(config.volumes.database.name, volume, 'The pilot must use its own volume.');
  assert.equal(config.services.db.ports.length, 1);
  assert.equal(config.services.db.ports[0].host_ip, '127.0.0.1');
  assert.equal(String(config.services.db.ports[0].published), '35434');
  assert.equal(config.services.gateway.ports.length, 1);
  assert.equal(config.services.gateway.ports[0].host_ip, '127.0.0.1');
  assert.equal(String(config.services.gateway.ports[0].published), '3004');
  for (const service of ['db', 'migrate', 'api', 'worker']) {
    const url = config.services[service].environment?.DATABASE_URL
      ?? config.services[service].environment?.WORKER_DATABASE_URL;
    if (url) assert.equal(new URL(url).hostname, 'db', 'Database connections must stay in the pilot network.');
  }
  assert.equal(new URL(config.services.api.environment.DATABASE_URL).username, 'campus_app');
  assert.equal(new URL(config.services.worker.environment.WORKER_DATABASE_URL).username, 'campus_worker');
  assert.deepEqual(config.services.judge.networks, { execution: null });
  assert.equal(config.services.judge.environment.DATABASE_URL, undefined);
  for (const service of Object.values(config.services)) {
    for (const mount of service.volumes ?? []) assert(!String(mount.source).includes('docker.sock'));
  }
}
async function copyOriginalAssets(sourceRoot) {
  const source = await realpath(sourceRoot);
  const repositoryDir = path => {
    const common = capture('git', ['-C', path, 'rev-parse', '--git-common-dir']).trim();
    return resolve(path, common);
  };
  assert.equal(await realpath(repositoryDir(source)), await realpath(repositoryDir(root)),
    'Original assets must come from another checkout of this production repository.');
  const from = resolve(source, 'apps/web/public/paper4-originals');
  assert(await exists(from), 'No original Paper 4 assets found in the supplied checkout.');
  const to = resolve(root, 'apps/web/public/paper4-originals');
  if (await realpath(from) === await realpath(to).catch(() => to)) return;
  await cp(from, to, { recursive: true, force: true, filter: async path => {
    assert(!(await lstat(path)).isSymbolicLink(), 'Paper 4 asset symlinks are not accepted.'); return true;
  } });
  console.log('Copied the supplied local Paper 4 assets into the pilot checkout.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Start isolated local pilot: npm run start:pilot -- [--assets-from /path/to/production/checkout]');
    console.log('Stop without deleting data: npm run stop:pilot');
    console.log('No DATABASE_URL is needed. Private generated configuration stays under .campus-local/multischool-pilot/.');
    return;
  }
  const stop = args[0] === '--stop';
  let assetsFrom;
  if (stop) assert.equal(args.length, 1, 'The stop command takes no other arguments.');
  else if (args.length) {
    assert.equal(args.length, 2, 'Expected only --assets-from <production-checkout>.');
    assert.equal(args[0], '--assets-from'); assetsFrom = args[1];
  }
  const priorVolume = optionalInspect('volume', volume);
  let state = await exists(statePath) ? JSON.parse(await readFile(statePath, 'utf8')) : null;
  if (state) {
    assert.equal(state.project, project); assert.equal(state.volume, volume);
    assert.equal(state.sourceContainer, sourceContainer);
    assert(['prepared', 'restoring', 'restored', 'migrating', 'ready', 'failed'].includes(state.phase), 'Unknown initialization state.');
  }
  if (priorVolume) {
    assert.equal(priorVolume.Labels?.['com.docker.compose.project'], project, 'Unexpected database volume owner.');
    assert(state && await exists(envPath), 'Existing pilot data has no matching private initialization record. Refusing to overwrite or regenerate credentials.');
  } else if (state && !['prepared'].includes(state.phase)) {
    throw new Error('The recorded pilot database volume is missing. Restore it explicitly; startup will not silently recreate student data.');
  }
  if (stop && !(await exists(envPath))) throw new Error('The pilot has not been initialized.');
  if (!stop) {
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    await chmod(privateDir, 0o700);
  }
  if (!(await exists(envPath))) {
    assert(!priorVolume, 'Cannot generate replacement credentials for an existing database.');
    const content = secretNames.map(name => `${name}=${randomBytes(32).toString('hex')}`);
    await writeFile(envPath, [...content, 'LOCAL_PORT=3004', 'LOCAL_DB_PORT=35434',
      'PILOT_JUDGE_IMAGE=campus-judge-multischool-pilot-judge:latest', ''].join('\n'), { mode: 0o600, flag: 'wx' });
  }
  await chmod(envPath, 0o600);
  const values = Object.fromEntries((await readFile(envPath, 'utf8')).split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('#')).map(line => {
      const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
    }));
  for (const name of secretNames) assert(/^[a-f\d]{64}$/.test(values[name] ?? ''), `Invalid private setting ${name}.`);
  assert.equal(new Set(secretNames.map(name => values[name])).size, secretNames.length, 'Secrets must be distinct.');
  assert.equal(values.LOCAL_PORT, '3004'); assert.equal(values.LOCAL_DB_PORT, '35434');
  assert(/^[a-z0-9][a-z0-9./:_-]+$/.test(values.PILOT_JUDGE_IMAGE ?? ''), 'Invalid pilot judge image.');
  const compose = ['compose', '--project-name', project, '--env-file', envPath,
    '-f', resolve(root, 'deploy/compose.local.yaml'), '-f', resolve(root, 'deploy/compose.multischool-pilot.yaml')];
  const environment = { ...process.env, ...values };
  const config = JSON.parse(capture('docker', [...compose, 'config', '--format', 'json'], { env: environment }));
  verifyConfig(config);
  if (stop) {
    await run('docker', [...compose, 'stop'], { env: values });
    console.log('Pilot stopped; its database volume and configuration were retained.'); return;
  }
  if (!state) {
    state = { project, volume, sourceContainer, phase: 'prepared', createdAt: now() };
    await saveJson(statePath, state);
  }
  if (['restoring', 'failed'].includes(state.phase)) {
    throw new Error('A previous first restore did not complete. Refusing to reimport over existing data. Inspect the private initialization record and recover the pilot explicitly.');
  }
  if (assetsFrom) await copyOriginalAssets(assetsFrom);
  const hostUrl = role => `postgres://${role}:${values[role === 'campus_migrator' ? 'POSTGRES_PASSWORD'
    : role === 'campus_app' ? 'APP_DB_PASSWORD' : 'WORKER_DB_PASSWORD']}@127.0.0.1:35434/campus_demo`;
  await writeFile(cliEnvPath, [`DATABASE_URL=${hostUrl('campus_migrator')}`,
    `APP_DATABASE_URL=${hostUrl('campus_app')}`, `WORKER_DATABASE_URL=${hostUrl('campus_worker')}`,
    `APP_ORIGINS=${origin}`, ''].join('\n'), { mode: 0o600 });
  await chmod(cliEnvPath, 0o600);
  if (!optionalInspect('image', values.PILOT_JUDGE_IMAGE)) {
    if (optionalInspect('image', 'campus-judge-local-judge:latest')) {
      await run('docker', ['tag', 'campus-judge-local-judge:latest', values.PILOT_JUDGE_IMAGE]);
    } else {
      console.log('Building the isolated judge runtime because the local image is unavailable.');
      await run('docker', ['build', '-f', resolve(root, 'deploy/Dockerfile.judge'),
        '-t', values.PILOT_JUDGE_IMAGE, root]);
    }
  }
  await run('docker', [...compose, 'build', 'migrate', 'api', 'worker', 'web'], { env: values });
  // No consumer may process cloned jobs or change the comparison baseline.
  if (priorVolume) await run('docker', [...compose, 'stop', 'gateway', 'api', 'worker'], { env: values });
  await run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '120', 'db'], { env: values });
  const target = optionalInspect('container', targetContainer);
  assert.equal(target?.Config.Labels?.['com.docker.compose.project'], project);
  assert.equal(target?.Mounts.find(mount => mount.Destination === '/var/lib/postgresql/data')?.Name, volume);
  if (state.phase === 'prepared') {
    assert.equal(targetQuery("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"), '0',
      'First restore requires an empty pilot database.');
    const source = optionalInspect('container', sourceContainer);
    assert(source?.State.Running, 'The original local database must be running for the initial read-only clone.');
    assert.equal(source.Config.Labels?.['com.docker.compose.project'], 'campus-judge-local');
    assert.notEqual(source.Mounts.find(mount => mount.Destination === '/var/lib/postgresql/data')?.Name, volume);
    console.log('Taking a read-only snapshot of the existing local database.');
    const dump = await open(backupPath, 'w', 0o600);
    try { await run('docker', ['exec', sourceContainer, 'pg_dump', '-Fc', '-U', 'campus_migrator', '-d', 'campus_demo'], { stdout: dump.fd }); }
    finally { await dump.close(); }
    state = { ...state, phase: 'restoring', restoreStartedAt: now() }; await saveJson(statePath, state);
    const input = await open(backupPath, 'r');
    try {
      await run('docker', ['exec', '-i', targetContainer, 'pg_restore', '--exit-on-error', '--single-transaction',
        '-U', 'campus_migrator', '-d', 'campus_demo'], { stdin: input.fd });
    } finally { await input.close(); }
    state = { ...state, phase: 'restored', restoredAt: now() }; await saveJson(statePath, state);
  }
  let baseline;
  if (state.phase === 'migrating' && await exists(beforePath)) {
    baseline = JSON.parse(await readFile(beforePath, 'utf8'));
    assert.equal(baseline.schema, 2, 'Existing migration verification needs manual review; refusing to replace its baseline.');
  } else {
    const renameLegacySchool = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='055_legacy_school_ownership.sql');") === 't';
    const addedOwnershipColumns = ownershipRoots.filter(table => targetQuery(`SELECT EXISTS(
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}')
      AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='school_id');`) === 't');
    const addSchoolSettings = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='058_school_settings.sql');") === 't';
    const addDefaultSchool = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='063_account_default_school.sql');") === 't';
    const addClassLifecycle = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='school_classes' AND column_name='archived_at');") === 't';
    const addScholarshipVisibility = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leaderboard_settings' AND column_name='show_luq_balance');") === 't';
    const addCourseParity = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='school_courses' AND column_name='properties');") === 't';
    const addActivityContext = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='school_judge_jobs' AND column_name='activity_id');") === 't';
    const addCourseAdmissions = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='public_course_listings' AND column_name='access_mode');") === 't';
    const addSchoolExitArchive = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='school_identities' AND column_name='archived_at');") === 't';
    const addCompletionRewardMode = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='luq_activity_rules' AND column_name='require_all');") === 't';
    const addPublicPresence = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sessions' AND column_name='public_presence_seen_at');") === 't';
    const addPublicScholarship = targetQuery("SELECT NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='080_public_scholarship.sql');") === 't';
    const publicHistoricalClaims = addPublicScholarship && targetQuery("SELECT to_regclass('public.school_judge_jobs') IS NOT NULL;") === 't'
      ? JSON.parse(targetQuery(`WITH successes AS (SELECT DISTINCT a.identity_id,
          CASE WHEN j.school_id='${legacyId}' THEN 'problem:'||j.problem_id
          ELSE 'public-school:'||j.school_id||':problem:'||j.problem_id END subject_key
        FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
        WHERE j.access_context='public' AND j.kind='submit' ${addActivityContext ? '' : 'AND j.activity_id IS NULL'}
          AND j.state='completed' AND j.result->>'status'='AC')
        SELECT coalesce(jsonb_agg(s.identity_id::text||'/'||s.subject_key ORDER BY s.identity_id,s.subject_key),'[]')
        FROM successes s WHERE NOT EXISTS(SELECT 1 FROM luq_first_ac_claims c WHERE c.identity_id=s.identity_id AND c.subject_key=s.subject_key);`))
      : [];
    const plan = { addActivityContext, renameLegacySchool, addedOwnershipColumns, addSchoolSettings, addDefaultSchool, addClassLifecycle, addScholarshipVisibility, addCourseParity, addCourseAdmissions, addSchoolExitArchive, addCompletionRewardMode, addPublicPresence, addPublicScholarship, publicHistoricalClaims };
    const upgradeBackup = resolve(privateDir, `before-upgrade-${Date.now()}.dump`);
    const dump = await open(upgradeBackup, 'wx', 0o600);
    try { await run('docker', ['exec', targetContainer, 'pg_dump', '-Fc', '-U', 'campus_migrator', '-d', 'campus_demo'], { stdout: dump.fd }); }
    finally { await dump.close(); }
    baseline = { schema: 2, plan, backup: upgradeBackup, tables: fingerprints(plan) };
    await saveJson(beforePath, baseline);
    state = { ...state, phase: 'migrating', migrationStartedAt: now() }; await saveJson(statePath, state);
  }
  const { tables: before, plan } = baseline;
  await run('docker', [...compose, 'run', '--rm', '--no-deps', 'migrate'], { env: values });
  const after = fingerprints(plan);
  for (const [table, fingerprint] of Object.entries(before)) {
    assert.deepEqual(after[table], fingerprint, `Migration changed pre-existing business data in ${table}; pilot services remain stopped.`);
  }
  if (plan.addActivityContext) assert.equal(targetQuery('SELECT count(*) FROM school_judge_jobs WHERE activity_id IS NOT NULL OR activity_attempt_id IS NOT NULL OR activity_deadline_at IS NOT NULL;'), '0', 'Existing submissions must retain their original context.');
  if (plan.addPublicPresence) assert.equal(targetQuery('SELECT count(*) FROM sessions WHERE public_presence_seen_at IS NOT NULL;'), '0', 'Existing school sessions must not be backfilled into public presence.');
  if (plan.publicHistoricalClaims?.length) {
    const keys = plan.publicHistoricalClaims.map(key => `'${key.replaceAll("'", "''")}'`).join(',');
    assert.equal(Number(targetQuery(`SELECT count(*) FROM luq_first_ac_claims
      WHERE identity_id::text||'/'||subject_key = ANY(ARRAY[${keys}]::text[])
        AND source_key='historical-public' AND reason='historical_public_ac' AND eligible=false AND ledger_id IS NULL;`)),
      plan.publicHistoricalClaims.length, 'Historical public ACs must consume eligibility without awarding money.');
  }
  if (plan.addCourseAdmissions) assert.equal(targetQuery("SELECT count(*) FROM public_course_listings WHERE access_mode<>'direct' OR access_generation IS NULL OR school_revision IS DISTINCT FROM revision OR legacy_revision IS NOT NULL;"), '0', 'Existing public course listings must keep direct access.');
  if (plan.addCompletionRewardMode) assert.equal(targetQuery(`SELECT
    (SELECT count(*) FROM luq_activity_rules WHERE require_all IS DISTINCT FROM false)
    +(SELECT count(*) FROM school_scholarship_activity_rules WHERE require_all IS DISTINCT FROM false);`),
    '0', 'Existing scholarship rules must retain their original thresholds.');
  if (plan.addSchoolExitArchive) assert.equal(targetQuery('SELECT count(*) FROM school_identities WHERE archived_at IS NOT NULL;'), '0', 'Existing school identities must remain active.');
  if (plan.addDefaultSchool) assert.equal(targetQuery('SELECT count(*) FROM accounts WHERE default_school_id IS NOT NULL;'), '0', 'Default schools must start unset.');
  if (plan.addClassLifecycle) assert.equal(targetQuery('SELECT count(*) FROM school_classes WHERE archived_at IS NOT NULL OR revision<>1;'), '0', 'Existing classes must remain active at revision 1.');
  if (plan.addScholarshipVisibility) assert.equal(targetQuery('SELECT count(*) FROM leaderboard_settings WHERE show_luq_balance IS DISTINCT FROM true;'), '0', 'Scholarship visibility must default to enabled without changing prior settings.');
  if (plan.addCourseParity) {
    assert.equal(targetQuery("SELECT count(*) FROM school_courses WHERE properties<>'{}'::jsonb OR archived_at IS NOT NULL;"), '0', 'Existing courses must retain their content and default to active with no new metadata.');
    assert.equal(targetQuery("SELECT count(*) FROM school_course_publications WHERE properties<>'{}'::jsonb;"), '0', 'Existing course editions must retain their content.');
  }
  if (plan.renameLegacySchool) {
    assert.equal(targetQuery(`SELECT name FROM schools WHERE id='${legacyId}';`), '天行创世纪学校');
    assert.equal(targetQuery("SELECT settings->>'schoolName' FROM site_settings WHERE id;"), '天行创世纪学校');
    assert.equal(targetQuery(`SELECT count(*) FROM school_audit_events WHERE school_id='${legacyId}' AND action='school.legacy.attributed' AND target_id='${legacyId}' AND actor_account_id IS NULL;`), '1');
  }
  for (const table of plan.addedOwnershipColumns) {
    assert.equal(targetQuery(`SELECT count(*) FROM ${table} WHERE school_id IS DISTINCT FROM '${legacyId}'::uuid;`), '0');
  }
  if(plan.addSchoolSettings) assert.equal(targetQuery(`SELECT bool_and(settings_revision=1 AND
    ((name ~ '[㐀-鿿]' AND name_zh=name AND name_en='') OR (name !~ '[㐀-鿿]' AND name_en=name AND name_zh='')))
    FROM schools;`), 't', 'School name backfill must preserve the existing name exactly.');
  const denied = targetQuery(`SELECT bool_and(
    NOT has_table_privilege('campus_worker', name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege('campus_worker', name, 'SELECT,INSERT,UPDATE,REFERENCES'))
    FROM unnest(ARRAY['schools','school_memberships','school_invitations','school_audit_events',
      'school_identities','school_classes','school_class_roster','school_identity_imports','school_activation_tokens',
      'legacy_school_identity_ownership','legacy_school_account_ownership','platform_admins','school_administrators','platform_audit_events',
      'school_courses','school_course_classes','school_course_publications','school_course_publication_classes','school_course_progress','school_learning_resources',
      'school_problem_banks','school_problems','school_problem_versions','school_problem_publications','public_course_listings','public_course_progress','public_luq_receipts','public_luq_results',
      'public_course_applications','legacy_course_publication_versions','school_exit_requests','school_problem_publication_requests','public_practice_notes','legacy_public_problem_requests','student_system_notifications','staff_course_notification_reads','course_admission_notifications',
      'school_activities','school_activity_problems','school_activity_participants','school_activity_classes','school_activity_attempts','school_activity_results',
      'school_paper4_papers','school_paper4_versions','school_paper4_activities','school_paper4_participants','school_paper4_attempts','school_paper4_files','school_paper4_reviews','school_paper4_requests',
      'school_scholarship_settings','school_scholarship_accounts','school_scholarship_ledger','school_scholarship_contents','school_scholarship_entitlements','school_scholarship_deliveries','school_rank_awards']) AS tables(name);`);
  assert.equal(denied, 't', 'Worker must not access school-management data.');
  const publicRankingGrants = targetQuery(`SELECT
    has_function_privilege('campus_app','public_practice_leaderboard(uuid,integer,integer)','EXECUTE')
    AND NOT has_function_privilege('campus_worker','public_practice_leaderboard(uuid,integer,integer)','EXECUTE');`);
  assert.equal(publicRankingGrants, 't', 'Only the application runtime may read public practice rankings.');
  const publicPresenceGrants = targetQuery(`SELECT
    has_function_privilege('campus_app','public_practice_presence_stats(uuid)','EXECUTE')
    AND NOT has_function_privilege('campus_worker','public_practice_presence_stats(uuid)','EXECUTE');`);
  assert.equal(publicPresenceGrants, 't', 'Only the application runtime may read public presence statistics.');
  const courseRls = targetQuery(`SELECT count(*)=6 AND bool_and(relrowsecurity AND relforcerowsecurity)
    FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY(ARRAY[
      'school_courses','school_course_classes','school_course_publications','school_course_publication_classes','school_course_progress','school_learning_resources']);`);
  assert.equal(courseRls, 't', 'School course tables must enforce row-level isolation.');
  const report = { verifiedAt: now(), project, preservedTables: Object.keys(before).length,
    addedTables: Object.keys(after).filter(table => !(table in before)), workerDeniedSchoolTables: true, courseRls: true, publicRankingGrants: true, publicPresenceGrants: true,
    migration: targetQuery('SELECT max(name) FROM schema_migrations;'),
    allowedMetadataChanges: plan, backup: baseline.backup, before, after };
  await saveJson(reportPath, report);
  if (!(await exists(initialReportPath))) await saveJson(initialReportPath, report);
  state = { ...state, phase: 'ready', migrationVerifiedAt: report.verifiedAt }; await saveJson(statePath, state);
  await run('docker', [...compose, 'up', '-d', '--no-build'], { env: values });
  const deadline = Date.now() + 120000;
  while (true) {
    try {
      const responses = await Promise.all(['/healthz', '/login'].map(path => fetch(`${origin}${path}`, { signal: AbortSignal.timeout(3000) })));
      if (responses.every(response => response.ok)) break;
    } catch { /* Services are starting. */ }
    if (Date.now() > deadline) throw new Error('Pilot health checks timed out. Inspect this pilot Compose project; existing installations were not changed.');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  console.log(`Pilot ready at ${origin}/login`);
  console.log(`Private CLI environment: ${cliEnvPath}`);
  console.log(`Migration verification: ${reportPath}`);
  console.log('Existing cloned account passwords were retained. No demo accounts were reset.');
}

main().catch(error => { console.error(`Pilot startup failed: ${error.message}`); process.exitCode = 1; });
