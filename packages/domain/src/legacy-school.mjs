import { transaction } from './db.mjs';

export const LEGACY_SCHOOL_ID = '00000000-0000-4000-8000-000000000052';
export const LEGACY_SCHOOL_NAME = '天行创世纪学校';

// Maintenance-only: execute as the migrator, never grant the runtime role
// EXECUTE on assign_legacy_school_identity. Normal writes use deferred triggers.
export async function reconcileLegacySchoolOwnership(pool) {
  return transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('legacy-school-ownership', 0))");
    await db.query('SELECT assign_legacy_school_identity(id) FROM identities ORDER BY id');
    return getLegacySchoolOwnershipSummary(db);
  });
}

// This returns aggregates only. Its API caller must independently require the
// original school administrator or an explicit platform administration grant.
export async function getLegacySchoolOwnershipSummary(db) {
  const { rows: [summary] } = await db.query(`
    SELECT
      (SELECT count(*)::int FROM legacy_school_identity_ownership WHERE school_id=$1) AS identities,
      (SELECT count(*)::int FROM legacy_school_identity_ownership o JOIN identities i ON i.id=o.identity_id WHERE o.school_id=$1 AND i.kind='student') AS students,
      (SELECT count(*)::int FROM legacy_school_identity_ownership o JOIN identities i ON i.id=o.identity_id WHERE o.school_id=$1 AND i.kind='teacher') AS teachers,
      (SELECT count(*)::int FROM legacy_school_identity_ownership o JOIN identities i ON i.id=o.identity_id WHERE o.school_id=$1 AND i.kind='admin') AS administrators,
      (SELECT count(*)::int FROM legacy_school_account_ownership WHERE school_id=$1) AS accounts,
      (SELECT count(*)::int FROM classes WHERE school_id=$1) AS classes,
      (SELECT count(*)::int FROM problem_banks WHERE school_id=$1) AS banks,
      (SELECT count(*)::int FROM problems p JOIN problem_banks b ON b.id=p.bank_id WHERE b.school_id=$1) AS problems,
      (SELECT count(*)::int FROM learning_paths WHERE school_id=$1 AND owner_scope='school') AS courses,
      (SELECT count(*)::int FROM assignments WHERE school_id=$1) AS assignments,
      (SELECT count(*)::int FROM timed_practices WHERE school_id=$1) AS "timedPractices",
      (SELECT count(*)::int FROM paper4_papers WHERE school_id=$1) AS papers,
      (SELECT count(*)::int FROM learning_resources WHERE school_id=$1) AS resources,
      (SELECT count(*)::int FROM submissions s JOIN legacy_school_identity_ownership o ON o.identity_id=s.identity_id WHERE o.school_id=$1) AS submissions,
      (SELECT count(*)::int FROM luq_ledger l JOIN legacy_school_identity_ownership o ON o.identity_id=l.identity_id WHERE o.school_id=$1) AS "luqEntries"
  `, [LEGACY_SCHOOL_ID]);
  return { schoolId: LEGACY_SCHOOL_ID, ...summary };
}
