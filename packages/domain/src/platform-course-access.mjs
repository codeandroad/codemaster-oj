import { enumValue, fail, uuid } from './security.mjs';

// Reused by legacy direct links and the independent public catalogue. School
// membership is evaluated at read time, so leaving a school revokes access.
export function platformCourseAudienceSql(alias, accountParameter) {
 return `(${alias}.platform_access_scope='all'
  OR ${alias}.platform_access_scope='students' AND EXISTS (
   SELECT 1 FROM accounts pa WHERE pa.id=${accountParameter} AND pa.identity_id=ANY(${alias}.platform_student_ids))
  OR ${alias}.platform_access_scope='schools' AND (
   EXISTS(SELECT 1 FROM school_memberships pm WHERE pm.account_id=${accountParameter}
    AND pm.revoked_at IS NULL AND pm.school_id=ANY(${alias}.platform_school_ids))
   OR EXISTS(SELECT 1 FROM legacy_school_account_ownership po WHERE po.account_id=${accountParameter}
    AND po.school_id=ANY(${alias}.platform_school_ids))))`;
}

export async function platformCourseEligible(db, id, accountId) {
 return !!(await db.query(`SELECT 1 FROM learning_paths p WHERE p.id=$1 AND p.owner_scope='platform'
  AND ${platformCourseAudienceSql('p','$2')}`, [id,accountId])).rowCount;
}

function ids(value, maximum, label) {
 if(!Array.isArray(value)||value.length>maximum)fail(400,'VALIDATION',`${label}数量无效`);
 return [...new Set(value.map(id=>uuid(id,label).toLowerCase()))].sort();
}
export async function platformCourseAudience(db, body, old={}) {
 const scope=enumValue(body.audienceScope??old.platform_access_scope??'all',['all','schools','students'],'公开范围');
 const schoolIds=scope==='schools'?ids(body.schoolIds??old.platform_school_ids??[],500,'学校 ID'):[];
 // Stable global identity IDs survive a released/rebound login credential.
 const studentIds=scope==='students'?ids(body.studentIds??old.platform_student_ids??[],5000,'学生 ID'):[];
 if(scope!=='all'&&!(schoolIds.length||studentIds.length))fail(400,'COURSE_AUDIENCE_REQUIRED','请选择至少一所学校或一名学生');
 if(schoolIds.length&&(await db.query('SELECT id FROM schools WHERE id=ANY($1::uuid[])',[schoolIds])).rowCount!==schoolIds.length)
  fail(400,'VALIDATION','所选学校不存在');
 if(studentIds.length&&(await db.query(`SELECT i.id FROM identities i WHERE i.id=ANY($1::uuid[])
  AND i.kind='student' AND i.archived_at IS NULL AND EXISTS(SELECT 1 FROM accounts a
   WHERE a.identity_id=i.id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL)`,[studentIds])).rowCount!==studentIds.length)
  fail(400,'VALIDATION','所选学生没有有效账号');
 return {scope,schoolIds,studentIds};
}
