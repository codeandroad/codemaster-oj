import { fail, tokenHash } from './security.mjs';
import { requirePlatformAdministrator, lockPlatformResetTarget } from './platform-governance.mjs';

const invalid = () => fail(400, 'RESET_FAILED', '重置凭据无效或已过期');

export async function redeemPasswordReset(db, login, code, passwordHash) {
  const digest = tokenHash(code);
  const {rows:[credential]} = await db.query(`
    SELECT a.id, issue.actor_account_id AS issuer, issue.metadata->>'scope' AS scope, issue.created_at::text AS issued_at
    FROM accounts a JOIN reset_tokens t ON t.account_id=a.id
    JOIN LATERAL (SELECT actor_account_id,metadata,created_at FROM audit_events
      WHERE action='account.reset_issue' AND resource_type='account' AND resource_id=a.id::text
      ORDER BY id DESC LIMIT 1) issue ON true
    WHERE a.username=$1 AND t.token_hash=$2 AND t.consumed_at IS NULL AND t.expires_at>clock_timestamp()`, [login,digest]);
  // Older platform-issued codes remain valid until their original expiry.
  if (!credential || !['platform','platform-personal'].includes(credential.scope)) invalid();
  try {
    await requirePlatformAdministrator(db, credential.issuer, credential.issued_at);
  } catch (error) {
    if ([401,403,404].includes(error.status)) invalid();
    throw error;
  }
  if (!await lockPlatformResetTarget(db, credential.id)) invalid();
  const consumed = await db.query(`UPDATE reset_tokens SET consumed_at=clock_timestamp()
    WHERE account_id=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()`,
    [credential.id,digest]);
  if (!consumed.rowCount) invalid();

  await db.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [credential.id,passwordHash]);
  await db.query('DELETE FROM sessions WHERE account_id=$1', [credential.id]);
  return credential.id;
}
