import { randomToken, tokenHash } from './security.mjs';

// The platform issuer holds the target account lock. Reissue replaces its only usable code
// and records who authorized it in the same transaction.
export async function issuePasswordResetCode(db, accountId, issuerId, scope) {
  const code = randomToken();
  await db.query(`INSERT INTO reset_tokens(account_id,token_hash,expires_at)
    VALUES($1,$2,clock_timestamp()+interval '30 minutes')
    ON CONFLICT(account_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL`,
    [accountId,tokenHash(code)]);
  await db.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata,created_at)
    VALUES($1,'account.reset_issue','account',$2,$3,clock_timestamp())`, [issuerId,accountId,{scope}]);
  return code;
}
