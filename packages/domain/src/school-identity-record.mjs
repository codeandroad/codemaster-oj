import { auditSchool } from './schools.mjs';

export const identityFields = 'id, kind, number, name, account_id AS "accountId", created_at AS "createdAt"';

export async function insertSchoolIdentity(db, schoolId, actorId, { kind, number, name, accountId = null, gender = null, notes = null }) {
  const { rows: [identity] } = await db.query(`
    INSERT INTO school_identities (school_id,kind,number,name,account_id,gender,notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${identityFields}`, [schoolId, kind, number, name, accountId, gender, notes]);
  await auditSchool(db, schoolId, actorId, 'school.identity.create', identity.id);
  return identity;
}
