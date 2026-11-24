import { transaction } from '../../../../packages/domain/src/db.mjs';

// A published edition and its editable draft share the problem ID. Seed both
// in the QA transaction without running grading jobs or publishing to the platform.
export async function publishedSchoolProblems(pool, schoolId, ownerId, count) {
  return transaction(pool, async db => {
    await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
    const {rows:[bank]} = await db.query(`INSERT INTO school_problem_banks(school_id,owner_account_id,name,request_id)
      VALUES($1,$2,'School practice',gen_random_uuid()) RETURNING id`, [schoolId,ownerId]);
    await db.query(`INSERT INTO school_problems(school_id,bank_id,owner_account_id,draft,request_id)
      SELECT $1,$2,$3,jsonb_build_object('title','Exercise '||n,'statement','School-only statement','mode','stdio',
        'samples','[]'::jsonb,'tests','[]'::jsonb,'reference_code','private reference'),gen_random_uuid()
      FROM generate_series(1,$4) n`, [schoolId,bank.id,ownerId,count]);
    const {rows} = await db.query(`WITH versions AS (
      INSERT INTO school_problem_versions(school_id,problem_id,draft_revision,definition)
      SELECT school_id,id,revision,draft FROM school_problems WHERE school_id=$1 AND bank_id=$2
      RETURNING problem_id,id
    ) UPDATE school_problems p SET published=true,published_version_id=v.id FROM versions v
      WHERE p.school_id=$1 AND p.id=v.problem_id RETURNING p.id AS "problemId",v.id AS "versionId"`, [schoolId,bank.id]);
    return {bankId:bank.id, links:rows};
  });
}
