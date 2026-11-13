import { activeAccount, LEGACY_SCHOOL_ID } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { fail } from './security.mjs';

export const staffSchoolSql=(account,school)=>`(EXISTS(SELECT 1 FROM school_memberships m
 WHERE m.account_id=${account} AND m.school_id=${school} AND m.revoked_at IS NULL
 AND (m.role IN ('teacher','school_admin') OR EXISTS(SELECT 1 FROM school_administrators a
 WHERE a.school_id=m.school_id AND a.account_id=m.account_id AND a.revoked_at IS NULL)))
 OR (${school}='${LEGACY_SCHOOL_ID}'::uuid AND EXISTS(SELECT 1 FROM legacy_school_account_ownership o
 JOIN account_roles r ON r.account_id=o.account_id WHERE o.account_id=${account} AND o.school_id=${school} AND r.role IN ('teacher','admin'))))`;

export async function canEditPlatformContent(db,accountId,kind,id) {
 if(await isPlatformAdministrator(db,accountId))return true;
 return (await db.query(`SELECT 1 FROM platform_content_editors e WHERE e.resource_kind=$2 AND e.resource_id=$3
 AND e.account_id=$1 AND e.revoked_at IS NULL AND ${staffSchoolSql('e.account_id','e.school_id')}`,[accountId,kind,id])).rowCount>0;
}
export async function requirePlatformContentEditor(db,user,kind,id) {
 await activeAccount(db,user.id);
 if(!await canEditPlatformContent(db,user.id,kind,id))fail(403,'CONTENT_EDITOR_REQUIRED','未获此内容的编辑授权，或授权已失效');
}
