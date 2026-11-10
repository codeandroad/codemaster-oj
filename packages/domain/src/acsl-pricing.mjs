import { auditSchool } from './schools.mjs';
import { fail, integer } from './security.mjs';

export const ACSL_SOLUTION_DEFAULT_PRICE = 12;

// Prices belong to a school's stable paper, independently of content revisions
// and grading snapshots. Reuse the existing school-scoped assistance policies.
export async function readAcslSolutionPrice(db, paper) {
  const policy = (await db.query(`SELECT price,revision FROM school_scholarship_policies
    WHERE school_id=$1 AND target_type='subject' AND target_key=$2 AND kind='FULL_SOLUTION'`,
    [paper.school_id, `acsl:${paper.id}`])).rows[0];
  const price = policy?.price ?? null;
  return { price, defaultPrice: ACSL_SOLUTION_DEFAULT_PRICE,
    effectivePrice: price ?? ACSL_SOLUTION_DEFAULT_PRICE, revision: policy?.revision ?? 0 };
}

// The caller holds the exclusive school teaching lock and has authorized the
// staff member and paper. Student quotes hold the corresponding shared lock.
export async function updateAcslSolutionPrice(db, paper, user, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['price', 'expectedRevision'].includes(key)) || !Object.hasOwn(input, 'price')) {
    fail(400, 'VALIDATION', 'Include a solution price and the current price revision.');
  }
  const price = input.price === null ? null : integer(input.price, 0, 1000, 'Solution price');
  const expectedRevision = integer(input.expectedRevision, 0, 2147483646, 'Price revision');
  const current = await readAcslSolutionPrice(db, paper);
  if (expectedRevision !== current.revision) fail(409, 'PRICE_CONFLICT', 'The solution price changed. Reload before saving.');
  if (price === current.price) return current;
  await db.query(`INSERT INTO school_scholarship_policies(school_id,target_type,target_key,kind,mode,price)
    VALUES($1,'subject',$2,'FULL_SOLUTION','paid',$3)
    ON CONFLICT(school_id,target_type,target_key,kind) DO UPDATE
    SET price=EXCLUDED.price,mode='paid',opens_at=NULL,revision=school_scholarship_policies.revision+1`,
    [paper.school_id, `acsl:${paper.id}`, price]);
  await auditSchool(db, paper.school_id, user.id, 'acsl.solution_price', paper.id);
  return readAcslSolutionPrice(db, paper);
}
