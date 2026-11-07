import assert from 'node:assert/strict';

// These Paper 4 upgrade fixtures intentionally defer a pre-school migration
// while keeping newer runtime tables available for their HTTP/worker adapters.
// School ownership constraint triggers did not exist at that historical point
// and refer to the deferred participant table. Remove them only in that window,
// then restore their real definitions once all historical tables exist again.
export async function suspendSchoolOwnershipForHistoricalMigration(pool) {
  const { rows: [{ schema }] } = await pool.query('SELECT current_schema() AS schema');
  assert.match(schema, /^paper4_(?:audience|library|rank_upgrade)_[0-9a-f]+$/, 'Historical fixtures must use their isolated schema');
  const { rows: triggers } = await pool.query(`
    SELECT c.relname AS relation, t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname=current_schema() AND NOT t.tgisinternal
      AND p.proname IN ('legacy_school_ownership_on_identity','legacy_school_ownership_on_account','legacy_school_ownership_on_role')
    ORDER BY c.relname,t.tgname`);
  assert.equal(triggers.length, 3, 'Capture the current ownership triggers instead of duplicating their implementations');
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  for (const trigger of triggers) await pool.query(`DROP TRIGGER ${quote(trigger.name)} ON ${quote(schema)}.${quote(trigger.relation)}`);
  let restored = false;
  return async () => {
    assert.equal(restored, false, 'Ownership triggers are restored exactly once');
    for (const trigger of triggers) await pool.query(trigger.definition);
    await pool.query('SELECT assign_legacy_school_identity(id) FROM identities ORDER BY id');
    restored = true;
  };
}

// The recipient-upgrade fixture creates its pre-upgrade actors through today's
// HTTP adapter. Keep its real legacy-access guard active during that interval
// by attaching only fixture accounts which already possess a legacy role.
export async function markHistoricalLegacyActor(pool, accountId) {
  await pool.query(`INSERT INTO legacy_school_identity_ownership(identity_id)
    SELECT a.identity_id FROM accounts a JOIN identities i ON i.id=a.identity_id
    WHERE a.id=$1 AND i.kind<>'personal' AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id)
    ON CONFLICT DO NOTHING`, [accountId]);
  const { rowCount } = await pool.query(`INSERT INTO legacy_school_account_ownership(account_id)
    SELECT a.id FROM accounts a JOIN legacy_school_identity_ownership o ON o.identity_id=a.identity_id
    WHERE a.id=$1 ON CONFLICT DO NOTHING`, [accountId]);
  assert.equal(rowCount, 1, 'Only the newly created legacy fixture actor is attached');
}
