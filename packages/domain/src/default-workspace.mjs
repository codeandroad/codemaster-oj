import { transaction } from './db.mjs';
import { fail, uuid } from './security.mjs';
import { LEGACY_SCHOOL_ID } from './schools.mjs';

// Used only with the accounts alias `a`. Read-time validation makes revoked
// memberships immediately ineligible, including in existing login sessions.
// A platform administrator still needs a school membership to prefer a school.
export const DEFAULT_SCHOOL_EXPRESSION = `CASE WHEN EXISTS (
 SELECT 1 FROM schools ds WHERE ds.id=a.default_school_id AND (
  EXISTS (SELECT 1 FROM school_memberships dm
   WHERE dm.school_id=ds.id AND dm.account_id=a.id AND dm.revoked_at IS NULL)
  OR ds.id='${LEGACY_SCHOOL_ID}'::uuid AND EXISTS (
   SELECT 1 FROM legacy_school_account_ownership lo JOIN account_roles lr ON lr.account_id=lo.account_id
   WHERE lo.account_id=a.id AND lo.school_id=ds.id
  )
 )
) THEN a.default_school_id ELSE NULL END`;

export async function handleDefaultWorkspace({ pool, user, route, method, body }) {
 if (route !== '/auth/default-workspace' || !['GET','PATCH'].includes(method)) return null;
 if (!user) fail(401,'UNAUTHENTICATED','请先登录');
 if (method === 'GET') {
  const { rows: [account] } = await pool.query(`SELECT ${DEFAULT_SCHOOL_EXPRESSION} AS "defaultSchoolId"
   FROM accounts a JOIN identities i ON i.id=a.identity_id
   WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL`,[user.id]);
  if (!account) fail(401,'UNAUTHENTICATED','请重新登录');
  return {status:200,body:account};
 }
 if (!Object.hasOwn(body,'defaultSchoolId') || Object.keys(body).some(key=>key!=='defaultSchoolId')) {
  fail(400,'VALIDATION','请仅提供默认学校 ID，或使用 null 清除默认学校');
 }
 const schoolId=body.defaultSchoolId===null?null:uuid(body.defaultSchoolId,'默认学校 ID');
 return transaction(pool,async db=>{
  // Serialize preferences per account, without upgrading a shared row lock.
  const {rowCount}=await db.query(`SELECT a.id FROM accounts a JOIN identities i ON i.id=a.identity_id
   WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
   FOR UPDATE OF a FOR SHARE OF i`,[user.id]);
  if(!rowCount)fail(401,'UNAUTHENTICATED','请重新登录');
  if(schoolId){
   const access=schoolId===LEGACY_SCHOOL_ID
    ? await db.query(`SELECT r.account_id FROM account_roles r
       JOIN legacy_school_account_ownership o ON o.account_id=r.account_id
       JOIN schools s ON s.id=o.school_id
       WHERE r.account_id=$1 AND o.school_id=$2 FOR SHARE OF r`,[user.id,schoolId])
    : await db.query(`SELECT m.account_id FROM school_memberships m JOIN schools s ON s.id=m.school_id
       WHERE m.account_id=$1 AND m.school_id=$2 AND m.revoked_at IS NULL FOR SHARE OF m`,[user.id,schoolId]);
   if(!access.rowCount)fail(404,'NOT_FOUND','学校不存在或尚未加入');
  }
  await db.query('UPDATE accounts SET default_school_id=$2 WHERE id=$1 AND default_school_id IS DISTINCT FROM $2::uuid',[user.id,schoolId]);
  return {status:200,body:{defaultSchoolId:schoolId}};
 });
}
