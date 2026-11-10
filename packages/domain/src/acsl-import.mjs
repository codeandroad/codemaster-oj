import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createPool, transaction } from './db.mjs';
import { canonicalHash, uuid } from './security.mjs';
import { normalizeSchoolProblem } from './school-practice.mjs';
import { LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { paperAssetPurposes, validatePaperDefinition } from './acsl-grading.mjs';

const MAX_ASSET_BYTES = 8388608;
const MAX_PACKAGE_ASSET_BYTES = 67108864;

function normalizeProgramming(programming) {
  if (!programming) return null;
  // Official cases already supply the oracle. An absent reference is not replaced by an invented solution.
  const definition = normalizeSchoolProblem({ ...programming.definition, referenceCode: programming.definition.referenceCode ?? '' });
  if (programming.definition.referenceCode == null) delete definition.reference_code;
  return definition;
}

export function prepareAcslPackage({ content, assets = [] }) {
  validatePaperDefinition(content);
  const purposes = paperAssetPurposes(content), metadata = content.assets ?? [];
  if (!Array.isArray(assets) || assets.length !== metadata.length || new Set(assets.map(asset => asset.id)).size !== assets.length) {
    throw new Error('Supply every ACSL asset exactly once.');
  }
  let totalBytes = 0;
  const preparedAssets = metadata.map(asset => {
    const data = assets.find(item => item.id === asset.id)?.content;
    if (!Buffer.isBuffer(data) || data.length < 24 || data.length > MAX_ASSET_BYTES ||
        !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        data.toString('ascii', 12, 16) !== 'IHDR' || data.readUInt32BE(16) !== asset.width || data.readUInt32BE(20) !== asset.height ||
        createHash('sha256').update(data).digest('hex') !== asset.sha256) {
      throw new Error(`ACSL asset integrity check failed: ${asset.id}`);
    }
    totalBytes += data.length;
    return { ...asset, content: data, purpose: purposes.get(asset.id) };
  });
  if (totalBytes > MAX_PACKAGE_ASSET_BYTES) throw new Error('ACSL edition assets exceed 64 MB.');
  return { content, contentHash: canonicalHash(content), definition: normalizeProgramming(content.programming), assets: preparedAssets };
}

export async function readAcslPackage(filename) {
  const source = await realpath(filename), base = dirname(source);
  if ((await stat(source)).size > 2000000) throw new Error('ACSL paper package exceeds 2 MB.');
  const content = JSON.parse(await readFile(source, 'utf8'));
  validatePaperDefinition(content);
  const assets = [];
  let totalBytes = 0;
  for (const asset of content.assets ?? []) {
    const file = await realpath(resolve(base, asset.path)), path = relative(base, file);
    if (path === '..' || path.startsWith('../') || isAbsolute(path)) throw new Error('ACSL assets must remain inside their package directory.');
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) throw new Error('Invalid ACSL asset file size.');
    totalBytes += info.size;
    if (totalBytes > MAX_PACKAGE_ASSET_BYTES) throw new Error('ACSL edition assets exceed 64 MB.');
    assets.push({ id: asset.id, content: await readFile(file) });
  }
  prepareAcslPackage({ content, assets });
  return { content, assets };
}

async function insertPaper(db, { schoolId, ownerAccountId }, { content, contentHash, definition, assets }) {
    const existing = (await db.query('SELECT id,version_id,content_hash FROM acsl_papers WHERE school_id=$1 AND slug=$2', [schoolId, content.slug])).rows[0];
    if (existing) {
      if (existing.content_hash !== contentHash) throw new Error('The imported edition differs. Preserve existing answers and import a separately reviewed edition.');
      return { id: existing.id, versionId: existing.version_id, imported: false };
    }
    let problemId = null, versionId = null;
    if (definition) {
      const bank = (await db.query(`INSERT INTO school_problem_banks(school_id,owner_account_id,name,archived,resource_kind,request_id)
        VALUES($1,$2,'ACSL practice',true,'acsl',$3) RETURNING id`, [schoolId, ownerAccountId, randomUUID()])).rows[0];
      const problem = (await db.query(`INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id`, [schoolId, bank.id, ownerAccountId, JSON.stringify(definition), randomUUID()])).rows[0];
      const version = (await db.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
        VALUES($1,$2,1,$3) RETURNING id`, [schoolId, problem.id, JSON.stringify(definition)])).rows[0];
      problemId = problem.id; versionId = version.id;
    }
    const paper = (await db.query(`INSERT INTO acsl_papers(school_id,slug,content_hash,definition,programming_problem_id,programming_version_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version_id`, [schoolId, content.slug, contentHash, JSON.stringify(content), problemId, versionId])).rows[0];
    for (const asset of assets) await db.query(`INSERT INTO acsl_assets(school_id,paper_id,version_id,asset_id,purpose,mime_type,sha256,width,height,content)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [schoolId, paper.id, paper.version_id, asset.id, asset.purpose, asset.mimeType, asset.sha256, asset.width, asset.height, asset.content]);
    return { id: paper.id, versionId: paper.version_id, imported: true };
}

export async function importAcslPapers(pool, { schoolId, ownerAccountId, packages, enablePoints = false }) {
  uuid(schoolId); uuid(ownerAccountId);
  if (typeof enablePoints !== 'boolean' || enablePoints && schoolId !== LEGACY_SCHOOL_ID) throw new Error('ACSL points can be explicitly enabled only for the legacy school.');
  if (!Array.isArray(packages) || !packages.length || packages.length > 200) throw new Error('Import 1–200 ACSL editions at a time.');
  const prepared = packages.map(prepareAcslPackage);
  if (new Set(prepared.map(item => item.content.slug)).size !== prepared.length) throw new Error('Duplicate ACSL edition slugs in batch.');
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId);
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    const results = [];
    for (const item of prepared) {
      const result = await insertPaper(db, { schoolId, ownerAccountId }, item);
      if (enablePoints) await db.query(`INSERT INTO acsl_point_rules(school_id,paper_id,version_id,written_points_per_correct,programming_points)
        VALUES($1,$2,$3,1,$4) ON CONFLICT DO NOTHING`, [schoolId, result.id, result.versionId, item.definition ? 10 : 0]);
      results.push({ slug: item.content.slug, ...result });
    }
    return results;
  });
}

export async function importAcslPaper(pool, { schoolId, ownerAccountId, content, assets = [], enablePoints = false }) {
  const [{ slug: _slug, ...result }] = await importAcslPapers(pool, { schoolId, ownerAccountId, packages: [{ content, assets }], enablePoints });
  return result;
}

async function packageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }), files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await packageFiles(filename));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(filename);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const schoolId = option('--school-id');
  const ownerAccountId = option('--owner-account-id');
  const dryRun = process.argv.includes('--dry-run'), enablePoints = process.argv.includes('--enable-points'), directory = option('--directory'), filename = option('--file');
  if ((!dryRun && (!schoolId || !ownerAccountId)) || directory && filename) throw new Error('Usage: acsl-import.mjs --school-id UUID --owner-account-id UUID [--file path | --directory path] [--enable-points] [--dry-run]. DATABASE_URL must use the migration role.');
  const files = directory ? await packageFiles(resolve(directory)) : [filename ?? fileURLToPath(new URL('../content/acsl/sample.json', import.meta.url))];
  if (!files.length || files.length > 200) throw new Error('Import 1–200 ACSL editions at a time.');
  const packages = [];
  for (const file of files) packages.push(await readAcslPackage(file));
  if (new Set(packages.map(item => item.content.slug)).size !== packages.length) throw new Error('Duplicate ACSL edition slugs in batch.');
  if (dryRun) console.log(JSON.stringify({ validated: packages.length, enablePoints, slugs: packages.map(item => item.content.slug) }));
  else {
    const pool = createPool();
    try { console.log(JSON.stringify(await importAcslPapers(pool, { schoolId, ownerAccountId, packages, enablePoints }))); }
    finally { await pool.end(); }
  }
}
