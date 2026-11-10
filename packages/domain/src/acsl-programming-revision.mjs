import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, transaction } from './db.mjs';
import { canonicalHash, field, uuid } from './security.mjs';
import { lockSchoolTeaching } from './schools.mjs';
import { validatePaperDefinition } from './acsl-grading.mjs';
import { normalizeSchoolProblem } from './school-practice.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => Array.isArray(value) ? value.map(stable) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a, b) => canonicalHash(stable(a)) === canonicalHash(stable(b));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function only(value, keys, label) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label}.`);
}

// No whole-package input: a reviewed operation can change only named expected
// outputs. Every correction supplies its exact before value for concurrency.
export function applyAcslProgrammingCorrections(before, corrections) {
  if (!before.programming || !Array.isArray(corrections) || !corrections.length || corrections.length > 100 ||
      new Set(corrections.map(item => item?.index)).size !== corrections.length) throw new Error('Provide unique programming test corrections.');
  const after = structuredClone(before);
  for (const item of corrections) {
    only(item, ['index', 'beforeExpected', 'afterExpected'], 'programming test correction');
    const target = after.programming.definition.tests[item.index];
    if (!Number.isInteger(item.index) || item.index < 0 || !target ||
        typeof item.beforeExpected !== 'string' || typeof item.afterExpected !== 'string' ||
        item.afterExpected.length > 262144 || item.beforeExpected === item.afterExpected) throw new Error('Invalid programming expected-output correction.');
    if (target.expected !== item.beforeExpected) throw new Error('Programming expected output changed since review.');
    target.expected = item.afterExpected;
  }
  // Reuse the normal import validation, including normalized judge limits.
  validatePaperDefinition(after);
  normalizeSchoolProblem({ ...after.programming.definition, referenceCode: after.programming.definition.referenceCode ?? '' });
  return after;
}

function evidence(value) {
  only(value, ['path', 'sha256', 'pages', 'note'], 'source evidence');
  if (!hash(value.sha256) || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 100 ||
      value.pages.some(page => !Number.isInteger(page) || page < 1)) throw new Error('Provide the reviewed source hash and page numbers.');
  return { path: field(value.path, 'Source path', { max: 1000 }), sha256: value.sha256, pages: value.pages,
    note: field(value.note, 'Source evidence note', { max: 4000 }) };
}

export async function reviseAcslProgramming(pool, args) {
  only(args, ['schoolId', 'actorAccountId', 'slug', 'expectedContentHash', 'requestId', 'reason', 'corrections', 'sourceEvidence', 'dryRun'], 'programming revision arguments');
  const { schoolId, actorAccountId, expectedContentHash, requestId, corrections, dryRun = false } = args;
  uuid(schoolId); uuid(actorAccountId); uuid(requestId);
  const slug = field(args.slug, 'ACSL edition slug', { max: 100 });
  if (!/^[a-z0-9-]{3,100}$/.test(slug) || !hash(expectedContentHash) || typeof dryRun !== 'boolean') throw new Error('Invalid programming revision identity or reviewed content hash.');
  const reason = field(args.reason, 'Programming revision reason', { max: 2000 });
  const sourceEvidence = evidence(args.sourceEvidence);
  const requestHash = canonicalHash(stable({ schoolId, actorAccountId, slug, expectedContentHash, requestId, reason, corrections, sourceEvidence }));
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId);
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    if (!(await db.query('SELECT 1 FROM accounts WHERE id=$1', [actorAccountId])).rowCount) throw new Error('Programming revision audit actor does not exist.');
    const prior = (await db.query('SELECT * FROM acsl_programming_revisions WHERE school_id=$1 AND request_id=$2', [schoolId, requestId])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash) throw new Error('Programming revision request ID was used for different content.');
      return { dryRun, changed: false, id: prior.id, paperId: prior.paper_id, versionId: prior.version_id,
        beforeProgrammingVersionId: prior.before_programming_version_id, afterProgrammingVersionId: prior.after_programming_version_id,
        beforeHash: prior.before_hash, afterHash: prior.after_hash };
    }
    const paper = (await db.query('SELECT * FROM acsl_papers WHERE school_id=$1 AND slug=$2 FOR UPDATE', [schoolId, slug])).rows[0];
    if (!paper?.programming_problem_id) throw new Error('The ACSL programming edition is not imported in this school.');
    if (paper.content_hash !== expectedContentHash) throw new Error('ACSL programming content changed since review.');
    const after = applyAcslProgrammingCorrections(paper.definition, corrections);
    const beforeVersion = (await db.query('SELECT * FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 AND id=$3',
      [schoolId, paper.programming_problem_id, paper.programming_version_id])).rows[0];
    const afterJudge = structuredClone(beforeVersion.definition);
    for (const item of corrections) {
      const originalTest = paper.definition.programming.definition.tests[item.index];
      const judgeTest = afterJudge.tests[item.index];
      if (!judgeTest || judgeTest.expected !== item.beforeExpected || judgeTest.input !== originalTest.input || judgeTest.weight !== originalTest.weight) {
        throw new Error('The current judge snapshot does not match the reviewed programming test.');
      }
      judgeTest.expected = item.afterExpected;
    }
    // Explicit full-object equivalence catches accidental changes to normalized
    // inputs, weights, comparator, resources, samples, reference or metadata.
    const reverted = structuredClone(afterJudge);
    for (const item of corrections) reverted.tests[item.index].expected = item.beforeExpected;
    if (!same(reverted, beforeVersion.definition)) throw new Error('Programming revision changed fields other than expected outputs.');
    const afterHash = canonicalHash(after);
    const result = { dryRun, changed: true, paperId: paper.id, versionId: paper.version_id,
      beforeProgrammingVersionId: paper.programming_version_id, beforeHash: paper.content_hash, afterHash };
    if (dryRun) return { ...result, id: null, afterProgrammingVersionId: null };
    const newVersion = (await db.query(`INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
      SELECT $1,$2,coalesce(max(draft_revision),0)+1,$3 FROM school_problem_versions WHERE school_id=$1 AND problem_id=$2 RETURNING id`,
      [schoolId, paper.programming_problem_id, JSON.stringify(afterJudge)])).rows[0];
    const audit = (await db.query(`INSERT INTO acsl_programming_revisions(school_id,paper_id,version_id,problem_id,
      before_programming_version_id,after_programming_version_id,request_id,request_hash,actor_account_id,reason,source_evidence,corrections,
      before_hash,after_hash,before_definition,after_definition,before_judge_definition,after_judge_definition)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [schoolId, paper.id, paper.version_id, paper.programming_problem_id, paper.programming_version_id, newVersion.id,
        requestId, requestHash, actorAccountId, reason, JSON.stringify(sourceEvidence), JSON.stringify(corrections), paper.content_hash, afterHash,
        JSON.stringify(paper.definition), JSON.stringify(after), JSON.stringify(beforeVersion.definition), JSON.stringify(afterJudge)])).rows[0];
    const updated = await db.query(`UPDATE acsl_papers SET programming_version_id=$4,definition=$5,content_hash=$6
      WHERE school_id=$1 AND id=$2 AND content_hash=$3`, [schoolId, paper.id, expectedContentHash, newVersion.id, JSON.stringify(after), afterHash]);
    if (updated.rowCount !== 1) throw new Error('ACSL programming content changed during revision.');
    return { ...result, id: audit.id, afterProgrammingVersionId: newVersion.id };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const filename = option('--manifest'), schoolId = option('--school-id'), actorAccountId = option('--actor-account-id');
  if (!filename || !schoolId || !actorAccountId) throw new Error('Usage: acsl-programming-revision.mjs --school-id UUID --actor-account-id UUID --manifest path [--dry-run]. DATABASE_URL must use the migration role.');
  const manifest = JSON.parse(await readFile(resolve(filename), 'utf8'));
  only(manifest, ['schemaVersion', 'slug', 'expectedContentHash', 'requestId', 'reason', 'corrections', 'sourceEvidence'], 'programming revision manifest');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported programming revision manifest.');
  const { schemaVersion: _schemaVersion, ...args } = manifest;
  const pool = createPool();
  try { console.log(JSON.stringify(await reviseAcslProgramming(pool, { ...args, schoolId, actorAccountId, dryRun: process.argv.includes('--dry-run') }))); }
  finally { await pool.end(); }
}
