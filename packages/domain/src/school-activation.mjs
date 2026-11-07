import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, requireSchoolAdmin } from './schools.mjs';
import { fail, field, randomToken, safeEqual, tokenHash, uuid } from './security.mjs';

const claimFailed = () => fail(400, 'CLAIM_FAILED', '学校、身份信息或激活码无效，请联系本校管理员');

// The activation selector is public; identity directories and invitation data
// remain authenticated. Return an explicit display-only projection.
export async function activationSchools(db) {
  const { rows } = await db.query(`SELECT id,slug,name,name_zh AS "nameZh",name_en AS "nameEn"
    FROM schools ORDER BY name,id`);
  return { items: rows };
}

export function activationSchoolSlug(body) {
  // Compatibility is limited to the original school's existing clients and
  // tokens. Never search all schools when the client omits the school scope.
  return body.schoolSlug === undefined ? 'legacy-school' : field(body.schoolSlug, '学校', { max: 50 }).toLowerCase();
}

export async function verifySchoolIdentity(db, { schoolSlug, kind, number, name, code }) {
  const school = (await db.query('SELECT id,slug,name,name_zh AS "nameZh",name_en AS "nameEn" FROM schools WHERE slug=$1', [schoolSlug])).rows[0];
  if (!school) claimFailed();
  await lockSchoolTeaching(db, school.id);
  const legacy = school.id === LEGACY_SCHOOL_ID;
  const identity = legacy
    ? (await db.query(`SELECT i.* FROM identities i
        JOIN legacy_school_identity_ownership o ON o.identity_id=i.id
        WHERE o.school_id=$1 AND i.kind=$2 AND i.number=$3 AND i.archived_at IS NULL
        FOR UPDATE OF i`, [school.id, kind, number])).rows[0]
    : (await db.query(`SELECT * FROM school_identities
        WHERE school_id=$1 AND kind=$2 AND number=$3 AND archived_at IS NULL FOR UPDATE`, [school.id, kind, number])).rows[0];
  const token = !identity ? null : legacy
    ? (await db.query(`SELECT * FROM activation_tokens WHERE identity_id=$1
        AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [identity.id])).rows[0]
    : (await db.query(`SELECT * FROM school_activation_tokens WHERE school_id=$1 AND identity_id=$2
        AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [school.id, identity.id])).rows[0];
  const claimed = !identity ? false : legacy
    ? !!(await db.query('SELECT 1 FROM accounts WHERE identity_id=$1 AND binding_released_at IS NULL', [identity.id])).rowCount
    : identity.account_id !== null;
  if (!identity || identity.name !== name || !token || claimed || !safeEqual(tokenHash(code), token.token_hash)) claimFailed();
  if (!legacy) {
    try { await requireSchoolAdmin(db, school.id, token.issued_by); }
    catch (error) { if ([401,403,404].includes(error.status)) claimFailed(); throw error; }
  }
  return { school, identity, legacy };
}

export async function schoolClaimPreview(db, claim) {
  const { school, identity, legacy } = claim;
  const classes = legacy
    ? (await db.query(`SELECT c.name FROM classes c WHERE c.archived_at IS NULL AND
        (EXISTS(SELECT 1 FROM class_members cm WHERE cm.class_id=c.id AND cm.identity_id=$1)
         OR EXISTS(SELECT 1 FROM identity_teacher_classes tc WHERE tc.class_id=c.id AND tc.identity_id=$1))`, [identity.id])).rows
    : (await db.query(`SELECT c.name FROM school_class_roster r JOIN school_classes c
        ON c.school_id=r.school_id AND c.id=r.class_id
        WHERE r.school_id=$1 AND r.identity_id=$2 AND c.archived_at IS NULL ORDER BY c.name,c.id`, [school.id, identity.id])).rows;
  return { school, person: { kind: identity.kind, number: identity.number, name: identity.name, gender: identity.gender ?? null, classes } };
}

export async function registerSchoolIdentity(db, claim, { login, hash, email }) {
  const { school, identity } = claim;
  const globalIdentity = randomUUID();
  await db.query("INSERT INTO identities(id,kind,number,name) VALUES($1::uuid,'personal',$1::text,$2)", [globalIdentity, identity.name]);
  const { rows: [account] } = await db.query(`INSERT INTO accounts(identity_id,username,password_hash,email,last_login_at,default_school_id)
    VALUES($1,$2,$3,$4,now(),$5) RETURNING id`, [globalIdentity, login, hash, email, school.id]);
  await db.query('INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,$3)', [school.id, account.id, identity.kind]);
  await db.query('UPDATE school_identities SET account_id=$3 WHERE school_id=$1 AND id=$2', [school.id, identity.id, account.id]);
  const consumed = await db.query(`UPDATE school_activation_tokens SET consumed_at=clock_timestamp()
    WHERE school_id=$1 AND identity_id=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()`, [school.id, identity.id]);
  if (!consumed.rowCount) claimFailed();
  await auditSchool(db, school.id, account.id, 'school.identity.claim', identity.id);
  return account;
}

export async function handleSchoolActivation({ pool, user, route, method }) {
  const match = route.match(/^\/schools\/([^/]+)\/identities\/([^/]+)\/activation-code$/);
  if (!match || method !== 'POST') return null;
  const schoolId = uuid(match[1], '学校 ID'), identityId = uuid(match[2], '身份档案 ID');
  return transaction(pool, async db => {
    await requireSchoolAdmin(db, schoolId, user.id);
    await lockSchoolTeaching(db, schoolId);
    const identity = (await db.query('SELECT id,kind,number,name,account_id FROM school_identities WHERE school_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE', [schoolId, identityId])).rows[0];
    if (!identity) fail(404, 'NOT_FOUND', '本校身份档案不存在');
    if (identity.account_id !== null) fail(409, 'ACTIVATED', '该身份已认领');
    const activationCode = randomToken();
    const { rows: [token] } = await db.query(`INSERT INTO school_activation_tokens(school_id,identity_id,token_hash,issued_by,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '7 days')
      ON CONFLICT(school_id,identity_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,issued_by=EXCLUDED.issued_by,
        expires_at=EXCLUDED.expires_at,consumed_at=NULL RETURNING expires_at`, [schoolId, identityId, tokenHash(activationCode), user.id]);
    const school = (await db.query('SELECT id,slug,name FROM schools WHERE id=$1', [schoolId])).rows[0];
    await auditSchool(db, schoolId, user.id, 'school.identity.activation_issue', identityId);
    return { status: 201, body: { school, person: { kind: identity.kind, number: identity.number, name: identity.name }, activationCode, expiresAt: token.expires_at } };
  });
}
