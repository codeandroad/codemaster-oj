// Structural checks for the independently installable production project.
// The optional prototype check is read-only and is unnecessary in a standalone clone.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = {
  trackedFiles: 169,
  head: 'e92b0df06f96442276e45f980cf260c8033cfbfe',
  trackedTreeContentSha256: 'b538f5188b46afaad952516f3a5be47a86799b7e24f7a1bdf2594effc03f0172',
};
const issues = [];
const report = { ok: false, sourceFiles: 0, applications: {}, prototype: { checked: false }, issues };
const exists = path => access(path).then(() => true, () => false);
const contained = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
};
const display = path => relative(root, path).split('\\').join('/');
const issue = (code, path, message) => issues.push({ code, ...(path ? { file: display(path) } : {}), message });
const parseJson = async path => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { issue('INVALID_JSON', path, 'A required JSON configuration is missing or invalid.'); return null; }
};
const forbiddenPackage = name => /^(?:@tanstack\/|@lovable(?:\.dev)?\/|vite(?:-|$)|nitro$)/i.test(name);
const ignored = new Set(['node_modules', 'dist', '.next', '.git', '.campus-local', 'coverage', 'backups', '.output']);
const sourceExtensions = /\.(?:[cm]?[jt]sx?|json|ya?ml|sh)$/;

async function collect(directory) {
  if (!(await exists(directory))) return [];
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.env') || /(?:credential|test-accounts|package-lock)/i.test(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (!contained(root, await realpath(path))) issue('EXTERNAL_SYMLINK', path, 'Runtime sources must remain inside this production project.');
      continue;
    }
    if (entry.isDirectory()) found.push(...await collect(path));
    else if (entry.isFile() && (sourceExtensions.test(entry.name) || entry.name.startsWith('Dockerfile'))) found.push(path);
  }
  return found;
}

async function application(folder, framework, entryPaths, dependencies) {
  const path = resolve(root, folder);
  const manifestPath = resolve(path, 'package.json');
  const manifest = await parseJson(manifestPath);
  const lock = await parseJson(resolve(path, 'package-lock.json'));
  const summary = { framework, separateManifest: !!manifest, separateLock: !!lock, entry: false, installedLocally: null };
  report.applications[folder] = summary;
  if (!manifest || !lock) return;
  if (lock.lockfileVersion < 2 || !lock.packages?.[''] || lock.packages[''].name !== manifest.name)
    issue('INDEPENDENT_LOCK_REQUIRED', resolve(path, 'package-lock.json'), 'Use a current package lock belonging to this application.');
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, value] of Object.entries(manifest[section] || {})) {
      if (forbiddenPackage(name)) issue('PROTOTYPE_DEPENDENCY', manifestPath, 'Prototype framework or integration dependencies are forbidden in production.');
      if (typeof value === 'string' && /^(?:file:|link:)/.test(value)) {
        const target = resolve(path, value.replace(/^(?:file:|link:)/, ''));
        if (!contained(root, target)) issue('EXTERNAL_PACKAGE', manifestPath, 'Local package dependencies must stay inside the production project.');
      }
      if (lock.packages?.['']?.[section]?.[name] !== value)
        issue('LOCK_MANIFEST_MISMATCH', resolve(path, 'package-lock.json'), 'Application dependency declarations and their lock file must agree.');
    }
  }
  for (const dependency of dependencies) {
    if (!manifest.dependencies?.[dependency]) issue('FRAMEWORK_DEPENDENCY_MISSING', manifestPath, `Declare the actual ${framework} runtime dependencies locally.`);
  }
  summary.entry = (await Promise.all(entryPaths.map(entry => exists(resolve(path, entry))))).every(Boolean);
  if (!summary.entry) issue('FRAMEWORK_ENTRY_MISSING', path, `The ${framework} application entry files must exist.`);
  if (await exists(resolve(path, 'node_modules'))) {
    summary.installedLocally = true;
    const require = createRequire(manifestPath);
    for (const dependency of dependencies) {
      try {
        const location = await realpath(require.resolve(dependency));
        if (!contained(resolve(path, 'node_modules'), location)) {
          summary.installedLocally = false;
          issue('ROOT_DEPENDENCY_FALLBACK', manifestPath, 'A runtime dependency resolves outside this application’s own installation.');
        }
      } catch {
        summary.installedLocally = false;
        issue('RUNTIME_DEPENDENCY_MISSING', manifestPath, 'An application installation exists but a required local runtime dependency is missing.');
      }
    }
  }
}

async function prototype(argument) {
  const path = resolve(root, argument);
  const git = args => spawnSync('git', args, { cwd: path, encoding: null, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  const status = git(['status', '--porcelain=v1', '-z']);
  const tracked = git(['ls-files', '-z']);
  const head = git(['rev-parse', 'HEAD']);
  report.prototype = { checked: true, clean: false, baselineMatches: false };
  if (status.status !== 0 || tracked.status !== 0 || head.status !== 0) {
    issue('PROTOTYPE_UNAVAILABLE', null, 'The optional prototype must be an accessible Git working tree.');
    return;
  }
  const names = tracked.stdout.toString('utf8').split('\0').filter(Boolean).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const aggregate = createHash('sha256');
  for (const name of names) {
    aggregate.update(Buffer.from(name)).update('\0').update(createHash('sha256').update(await readFile(resolve(path, name))).digest());
  }
  const content = aggregate.digest('hex');
  report.prototype = {
    checked: true, clean: status.stdout.length === 0,
    trackedFiles: names.length, head: head.stdout.toString('utf8').trim(),
    trackedTreeContentSha256: content,
    baselineMatches: names.length === baseline.trackedFiles && content === baseline.trackedTreeContentSha256 && head.stdout.toString('utf8').trim() === baseline.head,
  };
  if (!report.prototype.clean) issue('PROTOTYPE_CHANGED', null, 'The preserved prototype working tree must remain clean.');
  if (!report.prototype.baselineMatches) issue('PROTOTYPE_BASELINE_CHANGED', null, 'The preserved prototype differs from the recorded source baseline.');
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--prototype' || !args[1]))
    throw new Error('Use no arguments, or --prototype followed by a path relative to the production project.');
  const manifest = await parseJson(resolve(root, 'package.json'));
  if (manifest && Object.keys(manifest.dependencies || {}).length)
    issue('ROOT_RUNTIME_DEPENDENCIES', resolve(root, 'package.json'), 'The project root orchestrates separately installed applications and must not supply their runtime dependencies.');
  await application('apps/web', 'Next.js', ['src/app/layout.tsx', 'src/app/[[...path]]/page.tsx', 'next.config.mjs'], ['next', 'react', 'react-dom']);
  await application('apps/api', 'NestJS', ['src/main.ts', 'src/app.module.ts'], ['@nestjs/core', '@nestjs/common', '@nestjs/platform-express']);
  await application('packages/domain', 'shared domain', ['src/app.mjs', 'src/migrate.mjs', 'worker.mjs', 'judge.mjs'], ['pg']);

  const apiEntry = resolve(root, 'apps/api/src/main.ts');
  const apiFactory = resolve(root, 'apps/api/src/application.ts');
  if (await exists(apiEntry)) {
    const source = await readFile(apiEntry, 'utf8');
    const factorySource = await exists(apiFactory) ? await readFile(apiFactory, 'utf8') : '';
    const startsNest = value => /NestFactory\s*\.\s*create\s*(?:<[^>]+>\s*)?\(/.test(value) && /['"]@nestjs\/core['"]/.test(value);
    const delegates = /\bcreateApiApplication\s*\(/.test(source) && /['"]\.\/application\.js['"]/.test(source);
    if (!startsNest(source) && !(delegates && startsNest(factorySource)))
      issue('NEST_RUNTIME_ENTRY', apiEntry, 'The API must start an actual NestJS application.');
  }
  const files = (await Promise.all(['apps', 'packages', 'scripts', 'deploy'].map(path => collect(resolve(root, path))))).flat();
  for (const path of files) {
    if (path === fileURLToPath(import.meta.url) || /\/test\//.test(path)) continue;
    report.sourceFiles += 1;
    const source = await readFile(path, 'utf8');
    if (/\b(?:VITE_APP_MODE|CAMPUS_BUILD_TARGET)\b|import\.meta\.env/.test(source))
      issue('PROTOTYPE_MODE', path, 'Runtime behavior must not depend on prototype build modes.');
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(['"])([^'"\r\n]+)\1/g;
    for (const match of source.matchAll(imports)) {
      const dependency = match[2];
      if (forbiddenPackage(dependency)) issue('PROTOTYPE_IMPORT', path, 'Production runtime sources must not import prototype framework integrations.');
      if (dependency.startsWith('.') || dependency.startsWith('/')) {
        const target = resolve(dirname(path), dependency);
        if (!contained(root, target)) issue('EXTERNAL_SOURCE_IMPORT', path, 'Source imports must not depend on the prototype or the old root application.');
      }
    }
    if (/\.\.\/(?:\.\.\/)*myoj(?:\/|\b)|(?:^|\s)(?:NODE_PATH\s*=|--prefix\s+\.\.\/(?:\.\.\/)*)(?:node_modules|src)?/m.test(source))
      issue('EXTERNAL_RUNTIME_PATH', path, 'Runtime configuration must not reach into the prototype or the old root installation.');
  }
  if (args.length) await prototype(args[1]);
} catch (error) {
  // Do not echo arbitrary configuration, paths, credentials, or source text.
  issue('CHECK_FAILED', null, error?.message?.startsWith('Use no arguments') ? error.message : 'A required structural check could not be completed.');
}
report.ok = issues.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
