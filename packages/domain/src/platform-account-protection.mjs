import { fail } from './security.mjs';

// Called inside the original account-management transactions. Locking the
// credential row also serializes with an explicit platform capability grant.
export async function protectPlatformAccount(db, actor, { accountId, identityId }) {
  const accounts = await db.query(`SELECT id FROM accounts
    WHERE ($1::uuid IS NOT NULL AND id=$1) OR ($2::uuid IS NOT NULL AND identity_id=$2)
    ORDER BY id FOR UPDATE`, [accountId ?? null, identityId ?? null]);
  if (!accounts.rowCount) return;
  const protectedAccount = await db.query(`SELECT 1 FROM platform_admins
    WHERE account_id=ANY($1::uuid[]) AND revoked_at IS NULL LIMIT 1`, [accounts.rows.map(row => row.id)]);
  if (protectedAccount.rowCount && !(await db.query(`SELECT 1 FROM platform_admins
    WHERE account_id=$1 AND revoked_at IS NULL`, [actor.id])).rowCount) {
    fail(403, 'PLATFORM_ACCOUNT_PROTECTED', '学校管理员不能修改或重置平台管理员账号');
  }
  if ((await db.query(`SELECT 1 FROM accounts a WHERE a.id=ANY($1::uuid[])
    AND NOT EXISTS(SELECT 1 FROM legacy_school_account_ownership o WHERE o.account_id=a.id)`,
  [accounts.rows.map(row=>row.id)])).rowCount) {
    fail(403, 'LEGACY_TARGET_REQUIRED', '此账号不属于本学校，不能通过学校身份维护修改个人或其他学校账号');
  }

}
