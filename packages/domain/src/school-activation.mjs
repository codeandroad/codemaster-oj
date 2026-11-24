import { transaction } from './db.mjs';
import { auditSchool, lockSchoolTeaching, requireSchoolAdmin } from './schools.mjs';
import { fail, field, randomToken, safeEqual, tokenHash, uuid } from './security.mjs';

const claimFailed = () => fail(400, 'CLAIM_FAILED', '学校、身份信息或认领码无效，请联系本校管理员');

// The activation selector is public; identity directories and claim codes
// remain authenticated. Return an explicit display-only projection.
export async function activationSchools(db) {
  const { rows } = await db.query(`SELECT id,slug,name,name_zh AS "nameZh",name_en AS "nameEn"
    FROM schools ORDER BY name,id`);
  return { items: rows };
}

export function activationSchoolSlug(body) {
  return field(body.schoolSlug, '学校', { max: 50 }).toLowerCase();
}

export async function verifySchoolIdentity(db, { schoolSlug, kind, number, name, code }) {
  const school = (await db.query(`SELECT id,slug,name,name_zh AS "nameZh",name_en AS "nameEn" FROM schools
    WHERE slug=$1`, [schoolSlug])).rows[0];
  if (!school) claimFailed();
  await lockSchoolTeaching(db, school.id);
  const identity = (await db.query(`SELECT * FROM school_identities WHERE school_id=$1 AND kind=$2 AND number=$3
    AND archived_at IS NULL FOR UPDATE`, [school.id, kind, number])).rows[0];
  const token = identity && (await db.query(`SELECT * FROM school_activation_tokens WHERE school_id=$1 AND identity_id=$2
    AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [school.id, identity.id])).rows[0];
  const claimed = identity?.account_id != null;
  if (!identity || identity.name !== name || !token || claimed || !safeEqual(tokenHash(code), token.token_hash)) claimFailed();
  try { await requireSchoolAdmin(db, school.id, token.issued_by); }
  catch (error) { if ([401,403,404].includes(error.status)) claimFailed(); throw error; }
  return { school, identity };
}

export async function schoolClaimPreview(db, claim) {
  const { school, identity } = claim;
  const classes = (await db.query(`SELECT c.name FROM school_class_roster r JOIN school_classes c
        ON c.school_id=r.school_id AND c.id=r.class_id
        WHERE r.school_id=$1 AND r.identity_id=$2 AND c.archived_at IS NULL ORDER BY c.name,c.id`, [school.id, identity.id])).rows;
  return { school, person: { kind: identity.kind, number: identity.number, name: identity.name, gender: identity.gender ?? null, classes } };
}

export async function handleSchoolActivation({ pool, user, route, method, body }) {
  const match = route.match(/^\/schools\/([^/]+)\/identities\/(?:(?:([^/]+)\/activation-code)|activation-batch)$/);
  if (!match || method !== 'POST') return null;
  const schoolId = uuid(match[1], '学校 ID');
  const single = Boolean(match[2]);
  return transaction(pool, async db => {
    await lockSchoolTeaching(db, schoolId);
    await requireSchoolAdmin(db, schoolId, user.id);
    const requested = single ? [match[2]] : body.identityIds;
    if (!Array.isArray(requested) || !requested.length || requested.length > 500) {
      fail(400, 'VALIDATION', '每次请选择 1 至 500 个身份档案');
    }
    const ids = requested.map(id => uuid(id, '身份档案 ID').toLowerCase());
    if (new Set(ids).size !== ids.length) fail(400, 'VALIDATION', '身份档案重复');

    const { rows: identities } = await db.query(`SELECT id,kind,number,name,account_id FROM school_identities
      WHERE school_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL
        AND kind IN ('student','teacher') ORDER BY name,id FOR UPDATE`, [schoolId, ids]);
    if (identities.length !== ids.length) fail(404, 'NOT_FOUND', '本校身份档案不存在');
    if (identities.some(identity => identity.account_id !== null)) fail(409, 'ACTIVATED', '所选身份中有档案已认领');

    const codes = identities.map(() => randomToken());
    const issuedIds = identities.map(identity => identity.id);
    const { rows: [token] } = await db.query(`INSERT INTO school_activation_tokens(school_id,identity_id,token_hash,issued_by,expires_at)
      SELECT $1, id, digest, $4, now()+interval '7 days' FROM unnest($2::uuid[], $3::text[]) AS selected(id,digest)
      ON CONFLICT(school_id,identity_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,issued_by=EXCLUDED.issued_by,
        expires_at=EXCLUDED.expires_at,consumed_at=NULL RETURNING expires_at`, [schoolId, issuedIds, codes.map(tokenHash), user.id]);
    await db.query(`INSERT INTO school_audit_events(school_id,actor_account_id,action,target_id)
      SELECT $1,$2,'school.identity.activation_issue',id FROM unnest($3::uuid[]) AS selected(id)`, [schoolId, user.id, issuedIds]);
    const { rows: [school] } = await db.query('SELECT id,slug,name FROM schools WHERE id=$1', [schoolId]);
    const items = identities.map(({ kind, number, name }, index) => ({
      person: { kind, number, name }, activationCode: codes[index],
    }));
    const common = { school, expiresAt: token.expires_at };
    return { status: 201, body: single ? { ...common, ...items[0] } : { ...common, items } };
  });
}
