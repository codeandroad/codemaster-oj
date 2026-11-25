import { fail, uuid } from './security.mjs';
import { auditSchool } from './schools.mjs';

export const identityFields = 'id, kind, number, name, account_id AS "accountId", created_at AS "createdAt"';

export const identityClasses = `(SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
  'archived', c.archived_at IS NOT NULL) ORDER BY c.name, c.id), '[]') FROM school_class_roster r
  JOIN school_classes c ON c.school_id = r.school_id AND c.id = r.class_id
  WHERE r.school_id = i.school_id AND r.identity_id = i.id) AS classes`;

export function readClassIds(value) {
  if (!Array.isArray(value)) fail(400, 'VALIDATION', '班级须为列表');
  return [...new Set(value.map(id => uuid(id, '班级 ID').toLowerCase()))];
}

async function requireActiveClasses(db, schoolId, classes) {
  if (!classes.length) return;
  const { rows } = await db.query(`SELECT archived_at FROM school_classes
    WHERE school_id = $1 AND id = ANY($2::uuid[])`, [schoolId, classes]);
  if (rows.length !== classes.length) fail(404, 'NOT_FOUND', '班级不存在或不可访问');
  if (rows.some(row => row.archived_at)) fail(409, 'CLASS_ARCHIVED', '请选择使用中的班级');
}

export async function addToClassRosters(db, schoolId, actorId, identityId, classIds) {
  const {rowCount} = await db.query(`WITH added AS (
    INSERT INTO school_class_roster (school_id, class_id, identity_id)
    SELECT $1, class_id, $3 FROM unnest($4::uuid[]) AS classes(class_id)
    ON CONFLICT (school_id, class_id, identity_id) DO NOTHING
    RETURNING school_id, identity_id
  )
  INSERT INTO school_audit_events (school_id, actor_account_id, action, target_id)
  SELECT school_id, $2, 'school.roster.add', identity_id FROM added`, [schoolId, actorId, identityId, classIds]);
  return rowCount;
}

export async function removeFromClassRosters(db, schoolId, actorId, identityId, classIds) {
  const { rowCount } = await db.query(`WITH removed AS (
    DELETE FROM school_class_roster WHERE school_id=$1 AND identity_id=$3 AND class_id=ANY($4::uuid[])
    RETURNING school_id, identity_id
  )
  INSERT INTO school_audit_events (school_id, actor_account_id, action, target_id)
  SELECT school_id, $2, 'school.roster.remove', identity_id FROM removed`, [schoolId, actorId, identityId, classIds]);
  return rowCount;
}

export async function replaceIdentityClasses(db, schoolId, actorId, identityId, classes, expected, desired) {
  const current = new Set(classes.filter(c => !c.archived).map(c => c.id));
  const additions = desired.filter(id => !current.has(id));
  const selected = new Set(desired);
  const removals = [...current].filter(id => !selected.has(id));
  if (additions.length || removals.length) {
    if (expected.length !== current.size || expected.some(id => !current.has(id))) {
      fail(409, 'ROSTER_CHANGED', '班级名单已变更，请重新加载后确认');
    }
    await requireActiveClasses(db, schoolId, additions);
    if (additions.length) await addToClassRosters(db, schoolId, actorId, identityId, additions);
    if (removals.length) await removeFromClassRosters(db, schoolId, actorId, identityId, removals);
  }
}

export async function insertSchoolIdentity(db, schoolId, actorId, { kind, number, name, accountId = null, gender = null, notes = null, classIds = [] }) {
  await requireActiveClasses(db, schoolId, classIds);
  const { rows: [identity] } = await db.query(`
    INSERT INTO school_identities (school_id,kind,number,name,account_id,gender,notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${identityFields}`, [schoolId, kind, number, name, accountId, gender, notes]);
  await auditSchool(db, schoolId, actorId, 'school.identity.create', identity.id);
  if (classIds.length) await addToClassRosters(db, schoolId, actorId, identity.id, classIds);
  return identity;
}
