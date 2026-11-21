import { activeAccount } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { fail } from './security.mjs';

export function lockPlatformContent(db, {shared = false} = {}) {
 const lock = shared ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
 return db.query(`SELECT ${lock}(hashtextextended('platform-content',0))`);
}

export const staffSchoolSql=(account,school)=>`EXISTS(SELECT 1 FROM school_workspace_roles authorized_staff
 WHERE authorized_staff.account_id=${account} AND authorized_staff.school_id=${school}
 AND authorized_staff.role IN ('teacher','school_admin'))`;

// Course permissions are evaluated against current links, never copied into problem grants.
// Removing a link, ending the school role, or revoking the course grant takes effect immediately.
export function platformContentEditorSql(kind,resourceId,accountId,schoolId=null) {
 if(!['course','problem'].includes(kind))throw new TypeError('Unknown platform content kind');
 const grant=`platform_edit_grant.account_id=${accountId} AND platform_edit_grant.revoked_at IS NULL
  ${schoolId?`AND (${schoolId} IS NULL OR platform_edit_grant.school_id=${schoolId})`:''}
  AND ${staffSchoolSql('platform_edit_grant.account_id','platform_edit_grant.school_id')}`;
 const direct=`platform_edit_grant.resource_kind='${kind}' AND platform_edit_grant.resource_id=${resourceId}`;
 if(kind==='course')return `EXISTS(SELECT 1 FROM platform_content_editors platform_edit_grant WHERE ${grant} AND ${direct})`;
 return `EXISTS(SELECT 1 FROM problems platform_edit_problem WHERE platform_edit_problem.id=${resourceId}
  AND platform_edit_problem.owner_scope='platform' AND platform_edit_problem.archived_at IS NULL
  AND EXISTS(SELECT 1 FROM platform_content_editors platform_edit_grant WHERE ${grant} AND ((${direct}) OR
   (platform_edit_grant.resource_kind='course' AND EXISTS(SELECT 1 FROM learning_paths platform_edit_course
    JOIN learning_chapters platform_edit_chapter ON platform_edit_chapter.path_id=platform_edit_course.id AND platform_edit_chapter.archived_at IS NULL
    JOIN chapter_problems platform_edit_link ON platform_edit_link.chapter_id=platform_edit_chapter.id
    WHERE platform_edit_course.id=platform_edit_grant.resource_id AND platform_edit_course.owner_scope='platform'
     AND platform_edit_course.archived_at IS NULL AND platform_edit_link.problem_id=platform_edit_problem.id)))))`;
}

export async function canEditPlatformContent(db,accountId,kind,id) {
 if(await isPlatformAdministrator(db,accountId))return true;
 return (await db.query(`SELECT 1 WHERE ${platformContentEditorSql(kind,'$2::uuid','$1::uuid')}`,[accountId,id])).rowCount>0;
}
export async function requirePlatformContentEditor(db,user,kind,id) {
 await activeAccount(db,user.id);
 if(!await canEditPlatformContent(db,user.id,kind,id))fail(403,'CONTENT_EDITOR_REQUIRED','未获此内容的编辑授权，或授权已失效');
}
