import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createPool } from './db.mjs';
import { validateAcslProgrammingSolution } from './acsl-grading.mjs';
import { updateAcslPresentations } from './acsl-presentation.mjs';
import { uuid } from './security.mjs';

// Merge only authored teaching material, preserving any teacher edits and grading versions.
export function addAcslProgrammingSolution(current, authored) {
  if (current.slug !== authored.slug || !current.programming || !authored.programming ||
      current.programming.id !== authored.programming.id) throw new Error('ACSL solution target mismatch.');
  const grading = program => Object.fromEntries(Object.entries(program.definition).filter(([key]) => key !== 'title'));
  if (!isDeepStrictEqual(grading(current.programming), grading(authored.programming)) ||
      current.programming.statementZh !== authored.programming.statementZh ||
      !isDeepStrictEqual(current.programming.statementDiagrams, authored.programming.statementDiagrams)) {
    throw new Error(`Programming content changed since solution review: ${current.slug}`);
  }
  validateAcslProgrammingSolution(authored.programming.solution);
  const after = structuredClone(current);
  after.programming.solution = structuredClone(authored.programming.solution);
  return after;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const schoolId = uuid(option('--school-id')), actorAccountId = uuid(option('--actor-account-id'));
  const root = new URL('../content/acsl/', import.meta.url);
  const files = ['sample.json', ...(await readdir(new URL('editions/', root), { recursive: true }))
    .filter(name => name.endsWith('/paper.json')).map(name => `editions/${name}`)];
  const pool = createPool();
  try {
    const updates = [];
    for (const file of files) {
      const authored = JSON.parse(await readFile(new URL(file, root), 'utf8'));
      if (!authored.programming) continue;
      const row = (await pool.query('SELECT definition,content_hash FROM acsl_papers WHERE school_id=$1 AND slug=$2', [schoolId, authored.slug])).rows[0];
      if (!row) throw new Error(`ACSL edition is not imported: ${authored.slug}`);
      const content = addAcslProgrammingSolution(row.definition, authored);
      // PostgreSQL jsonb key ordering differs from the package file; don't create no-op audits.
      if (!isDeepStrictEqual(row.definition, content)) updates.push({ content, expectedContentHash: row.content_hash });
    }
    const result = updates.length ? await updateAcslPresentations(pool, { schoolId, actorAccountId,
      reason: 'Add independently authored, verified Python programming solutions and bilingual algorithm explanations.',
      updates, dryRun: !process.argv.includes('--apply') }) : { changed: 0, dryRun: !process.argv.includes('--apply'), items: [] };
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}
