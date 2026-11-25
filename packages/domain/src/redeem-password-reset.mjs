import { fail, tokenHash } from './security.mjs';
import { lockSchoolTeaching, requireSchoolAdmin, schoolCredentialCustodySql } from './schools.mjs';
import { requirePlatformAdministrator, lockPersonalResetTarget } from './platform-governance.mjs';

const invalid = () => fail(400, 'RESET_FAILED', '重置凭据无效或已过期');

async function consumeSchoolCode(db, credential, digest) {
  await lockSchoolTeaching(db, credential.school);
  try {
    await requireSchoolAdmin(db, credential.school, credential.issuer);
  } catch (error) {
    if ([401,403,404].includes(error.status)) invalid();
    throw error;
  }
  const target = await db.query(`SELECT a.id FROM accounts a JOIN identities i ON i.id=a.identity_id
    WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
    FOR UPDATE OF a`, [credential.id]);
  if (!target.rowCount) invalid();
  const consumed = await db.query(`UPDATE reset_tokens SET consumed_at=clock_timestamp()
    FROM accounts a JOIN school_memberships m ON m.account_id=a.id
    WHERE reset_tokens.account_id=a.id AND a.id=$1 AND m.school_id=$2 AND ${schoolCredentialCustodySql}
      AND reset_tokens.token_hash=$3 AND reset_tokens.consumed_at IS NULL AND reset_tokens.expires_at>clock_timestamp()
    RETURNING a.id`, [credential.id, credential.school, digest]);
  if (!consumed.rowCount) invalid();
}

async function consumePlatformCode(db, credential, digest) {
  try {
    await requirePlatformAdministrator(db, credential.issuer, credential.issued_at);
  } catch (error) {
    if ([401,403,404].includes(error.status)) invalid();
    throw error;
  }
  if (!await lockPersonalResetTarget(db, credential.id)) invalid();
  const consumed = await db.query(`UPDATE reset_tokens SET consumed_at=clock_timestamp()
    WHERE account_id=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()`,
    [credential.id,digest]);
  if (!consumed.rowCount) invalid();
}

export async function redeemPasswordReset(db, login, code, passwordHash) {
  const digest = tokenHash(code);
  const {rows:[credential]} = await db.query(`
    SELECT a.id, issue.actor_account_id AS issuer, issue.metadata->>'schoolId' AS school,
      issue.metadata->>'scope' AS scope, issue.created_at::text AS issued_at
    FROM accounts a JOIN reset_tokens t ON t.account_id=a.id
    JOIN LATERAL (SELECT actor_account_id,metadata,created_at FROM audit_events
      WHERE action='account.reset_issue' AND resource_type='account' AND resource_id=a.id::text
      ORDER BY id DESC LIMIT 1) issue ON true
    WHERE a.username=$1 AND t.token_hash=$2 AND t.consumed_at IS NULL AND t.expires_at>clock_timestamp()`, [login,digest]);
  if (credential?.school) await consumeSchoolCode(db, credential, digest);
  else if (credential?.scope === 'platform-personal') await consumePlatformCode(db, credential, digest);
  else invalid();

  await db.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [credential.id,passwordHash]);
  await db.query('DELETE FROM sessions WHERE account_id=$1', [credential.id]);
  return credential.id;
}
