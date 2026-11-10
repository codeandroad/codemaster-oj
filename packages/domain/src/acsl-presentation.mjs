import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createPool, transaction } from './db.mjs';
import { canonicalHash, field, uuid } from './security.mjs';
import { lockSchoolTeaching } from './schools.mjs';
import { normalizeSchoolProblem } from './school-practice.mjs';
import { paperAssetPurposes, validatePaperDefinition } from './acsl-grading.mjs';

const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stable = value => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const semanticHash = value => canonicalHash(stable(value));

// Unknown fields remain in this comparison. Only named display fields can change.
export function acslGradingContract(content) {
  const contract = without(content, ['title', 'roundLabel', 'sources', 'notes', 'contentNotes', 'assets']);
  contract.questions = content.questions.map(question => ({
    ...without(question, ['topic', 'statement', 'statementAssets', 'statementDiagrams', 'explanation', 'explanationAssets', 'explanationDiagrams', 'source']),
    options: question.options.map(option => without(option, ['text', 'diagrams'])),
  }));
  if (content.programming != null) contract.programming = {
    ...without(content.programming, ['statementZh', 'statementAssets', 'statementDiagrams', 'source', 'solution']),
    definition: without(content.programming.definition, ['title', 'statement']),
  };
  return contract;
}

export function assertAcslPresentationOnly(before, after) {
  validatePaperDefinition(before); validatePaperDefinition(after);
  const beforeContract = semanticHash(acslGradingContract(before));
  if (beforeContract !== semanticHash(acslGradingContract(after))) {
    throw new Error(`Presentation update changes the immutable grading contract: ${before.slug}`);
  }
  if (after.programming) normalizeSchoolProblem({ ...after.programming.definition, referenceCode: after.programming.definition.referenceCode ?? '' });
  const originalAssets = new Map((before.assets ?? []).map(asset => [asset.id, asset]));
  const beforePurposes = paperAssetPurposes(before), afterPurposes = paperAssetPurposes(after);
  for (const asset of after.assets ?? []) {
    if (!originalAssets.has(asset.id) || semanticHash(asset) !== semanticHash(originalAssets.get(asset.id)) ||
        afterPurposes.get(asset.id) !== beforePurposes.get(asset.id)) {
      throw new Error('Presentation updates may remove existing source images but cannot add, replace or reclassify them.');
    }
  }
  return beforeContract;
}

export async function updateAcslPresentations(pool, { schoolId, actorAccountId, reason, updates, dryRun = false }) {
  uuid(schoolId); uuid(actorAccountId); reason = field(reason, 'Presentation update reason', { max: 2000 });
  if (typeof dryRun !== 'boolean' || !Array.isArray(updates) || !updates.length || updates.length > 200) throw new Error('Update 1–200 ACSL presentations at a time.');
  const prepared = updates.map(update => {
    if (!update || !hash(update.expectedContentHash)) throw new Error('Every presentation update requires its reviewed before-content hash.');
    validatePaperDefinition(update.content);
    const changedQuestionIds = update.changedQuestionIds ?? [];
    if (!Array.isArray(changedQuestionIds) || new Set(changedQuestionIds).size !== changedQuestionIds.length ||
        changedQuestionIds.some(id => typeof id !== 'string' || !update.content.questions.some(question => question.id === id))) {
      throw new Error('Semantic revision question IDs must be unique IDs from the unchanged grading contract.');
    }
    return { ...update, changedQuestionIds, targetHash: canonicalHash(update.content) };
  });
  if (new Set(prepared.map(item => item.content.slug)).size !== prepared.length) throw new Error('Duplicate ACSL presentation slugs in batch.');
  const batchId = randomUUID();
  return transaction(pool, async db => {
    // Student access, saving and grading take the shared form of this lock.
    await lockSchoolTeaching(db, schoolId);
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    if (!(await db.query('SELECT 1 FROM accounts WHERE id=$1', [actorAccountId])).rowCount) throw new Error('Presentation audit actor does not exist.');
    const plans = [];
    for (const update of prepared) {
      const paper = (await db.query('SELECT * FROM acsl_papers WHERE school_id=$1 AND slug=$2 FOR UPDATE', [schoolId, update.content.slug])).rows[0];
      if (!paper) throw new Error(`ACSL edition is not imported in this school: ${update.content.slug}`);
      // content_hash follows the existing importer's package-key order; PostgreSQL jsonb reorders keys.
      // Compare that opaque reviewed hash for concurrency, and use sorted structural hashes for grading.
      const contractHash = assertAcslPresentationOnly(paper.definition, update.content);
      const unchanged = paper.content_hash === update.targetHash;
      if (!unchanged && update.changedQuestionIds.some(id => semanticHash(paper.definition.questions.find(q => q.id === id)) ===
          semanticHash(update.content.questions.find(q => q.id === id)))) {
        throw new Error(`Semantic revision names an unchanged question: ${paper.slug}`);
      }
      if (paper.content_hash !== update.expectedContentHash) {
        const replay = unchanged && (await db.query(`SELECT 1 FROM acsl_presentation_updates
          WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND before_hash=$4 AND after_hash=$5
            AND changed_question_ids @> $6::text[] AND changed_question_ids <@ $6::text[]`,
          [schoolId, paper.id, paper.version_id, update.expectedContentHash, update.targetHash, update.changedQuestionIds])).rowCount > 0;
        if (!replay) throw new Error(`ACSL presentation changed since review: ${paper.slug}`);
      }
      plans.push({ paper, update, contractHash, unchanged });
    }
    const items = [];
    for (const { paper, update, contractHash, unchanged } of plans) {
      const semanticRevision = update.changedQuestionIds.length > 0;
      let writtenRevision = paper.written_revision ?? paper.version_id;
      if (!unchanged && !dryRun) {
        let revisionAt = null;
        const questionRevisions = { ...paper.written_question_revisions };
        if (semanticRevision) {
          // The exclusive school lock fences all saving/grading before this
          // snapshot and clock instant; ordinary presentation repairs do not.
          await db.query(`INSERT INTO acsl_grade_question_snapshots(school_id,grade_id,written_revision,questions)
            SELECT school_id,id,$4,$5 FROM acsl_paper_grades WHERE school_id=$1 AND paper_id=$2 AND version_id=$3
            ON CONFLICT(school_id,grade_id) DO NOTHING`,
            [schoolId, paper.id, paper.version_id, writtenRevision, JSON.stringify(paper.definition.questions)]);
          await db.query(`INSERT INTO acsl_submission_question_snapshots(school_id,submission_id,written_revision,question)
            SELECT s.school_id,s.id,$4,q FROM acsl_submissions s CROSS JOIN jsonb_array_elements($5::jsonb) q
            WHERE s.school_id=$1 AND s.paper_id=$2 AND s.version_id=$3 AND q->>'id'=s.question_id
            ON CONFLICT(school_id,submission_id) DO NOTHING`,
            [schoolId, paper.id, paper.version_id, writtenRevision, JSON.stringify(paper.definition.questions)]);
          writtenRevision = randomUUID();
          revisionAt = (await db.query('SELECT clock_timestamp()::text AS value')).rows[0].value;
          for (const id of update.changedQuestionIds) questionRevisions[id] = revisionAt;
        }
        await db.query(`INSERT INTO acsl_presentation_updates(school_id,batch_id,paper_id,version_id,actor_account_id,reason,
          before_hash,after_hash,grading_contract_hash,before_definition,after_definition,written_revision,changed_question_ids)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [schoolId, batchId, paper.id, paper.version_id, actorAccountId, reason, paper.content_hash, update.targetHash,
            contractHash, JSON.stringify(paper.definition), JSON.stringify(update.content), semanticRevision ? writtenRevision : null, update.changedQuestionIds]);
        const result = await db.query(`UPDATE acsl_papers SET definition=$4,content_hash=$5,
          written_revision=CASE WHEN $6 THEN $7::uuid ELSE written_revision END,
          written_revision_at=CASE WHEN $6 THEN $8::timestamptz ELSE written_revision_at END,
          written_changed_question_ids=CASE WHEN $6 THEN $9::text[] ELSE written_changed_question_ids END,
          written_question_revisions=$10
          WHERE school_id=$1 AND id=$2 AND content_hash=$3`,
          [schoolId, paper.id, paper.content_hash, JSON.stringify(update.content), update.targetHash, semanticRevision,
            writtenRevision, revisionAt, update.changedQuestionIds, JSON.stringify(questionRevisions)]);
        if (result.rowCount !== 1) throw new Error(`ACSL presentation changed during update: ${paper.slug}`);
      }
      items.push({ slug: paper.slug, id: paper.id, versionId: paper.version_id, beforeHash: paper.content_hash,
        afterHash: update.targetHash, gradingContractHash: contractHash, changed: !unchanged,
        semanticRevision, changedQuestionIds: update.changedQuestionIds, writtenRevision });
    }
    return { batchId: dryRun ? null : batchId, dryRun, changed: items.filter(item => item.changed).length, items };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const manifestPath = option('--manifest'), schoolId = option('--school-id'), actorAccountId = option('--actor-account-id');
  if (!manifestPath || !schoolId || !actorAccountId) throw new Error('Usage: acsl-presentation.mjs --school-id UUID --actor-account-id UUID --manifest path [--dry-run]. DATABASE_URL must use the migration role.');
  const filename = resolve(manifestPath), manifest = JSON.parse(await readFile(filename, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.updates)) throw new Error('Invalid ACSL presentation manifest.');
  const updates = [];
  for (const item of manifest.updates) {
    if (!item || typeof item.file !== 'string') throw new Error('Presentation manifest entries require a content file.');
    const content = JSON.parse(await readFile(resolve(dirname(filename), item.file), 'utf8'));
    updates.push({ content, expectedContentHash: item.expectedContentHash, changedQuestionIds: item.changedQuestionIds });
  }
  const pool = createPool();
  try { console.log(JSON.stringify(await updateAcslPresentations(pool, { schoolId, actorAccountId, reason: manifest.reason, updates, dryRun: process.argv.includes('--dry-run') }))); }
  finally { await pool.end(); }
}
