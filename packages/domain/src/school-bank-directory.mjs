// The staff bank view needs inventory and reference counts, without loading
// individual definitions, judge payloads or a learner's progress for every row.
export async function schoolBankDirectory(db, schoolId, userId, role) {
  const admin = role === 'school_admin';
  const {rows} = await db.query(`WITH inventory AS MATERIALIZED (
    SELECT p.*,b.name AS bank_name,b.archived,($3 OR p.owner_account_id=$2) AS editable
    FROM school_problems p JOIN school_problem_banks b ON (b.school_id,b.id)=(p.school_id,p.bank_id)
    WHERE p.school_id=$1 AND b.resource_kind='ordinary' AND ($3 OR p.owner_account_id=$2 OR p.published AND NOT b.archived)
      AND NOT EXISTS (SELECT 1 FROM problems s WHERE s.id=p.id AND s.owner_scope='platform')
  ), activities AS (
    SELECT l.problem_id,count(*) FILTER(WHERE a.kind='assignment')::int assignments,
      count(*) FILTER(WHERE a.kind='timed')::int timed
    FROM school_activity_problems l JOIN school_activities a ON (a.school_id,a.id)=(l.school_id,l.activity_id)
    WHERE $3 AND l.school_id=$1 GROUP BY l.problem_id
  ), chapters AS (
    SELECT id,chapters FROM school_courses WHERE $3 AND school_id=$1
    UNION ALL SELECT c.id,v.chapters FROM school_courses c JOIN school_course_publications v
      ON (v.school_id,v.course_id,v.revision)=(c.school_id,c.id,c.published_revision) WHERE $3 AND c.school_id=$1 AND c.published
  ), courses AS (
    SELECT link->>'problemId' problem_id,count(DISTINCT c.id)::int n FROM chapters c,
      jsonb_array_elements(c.chapters) chapter,jsonb_array_elements(chapter->'problems') link GROUP BY 1
  ), receipts AS (
    SELECT problem_id FROM submissions WHERE $3 AND school_id=$1 AND kind IN ('submit','correction')
    UNION ALL SELECT problem_id FROM school_judge_jobs WHERE $3 AND school_id=$1 AND kind='submit' AND access_context='school'
  ), totals AS (SELECT problem_id,count(*)::int n FROM receipts GROUP BY 1)
  SELECT p.id,p.school_id AS "schoolId",p.bank_id AS "bankId",p.bank_name AS "bankName",
    CASE WHEN p.editable THEN p.draft->>'title' ELSE v.definition->>'title' END title,p.published,p.archived_at IS NOT NULL AS archived,
    CASE WHEN p.editable THEN p.revision ELSE v.draft_revision END revision,v.id AS "versionId",v.draft_revision AS "publishedRevision",
    p.editable AS "canManage",NOT p.archived AND (p.editable OR p.published) AS "canManageTutorial",
    p.editable AND v.id IS NOT NULL AND p.revision<>v.draft_revision AS "hasDraftChanges",
    CASE WHEN p.editable THEN p.draft->'tags' ELSE v.definition->'tags' END tags,
    validation.info AS validation,
    ($3 AND pub.withdrawn_at IS NULL AND pub.problem_id IS NOT NULL) IS TRUE AS "platformPublished",r.status AS "publicRequestStatus",
    coalesce(si.name,i.name) AS "ownerName",coalesce(a.assignments,0) AS "assignmentCount",coalesce(a.timed,0) AS "timedCount",
    coalesce(c.n,0) AS "courseCount",coalesce(s.n,0) AS "submissionCount"
  FROM inventory p JOIN accounts owner ON owner.id=p.owner_account_id JOIN identities i ON i.id=owner.identity_id
  LEFT JOIN school_identities si ON si.school_id=p.school_id AND si.account_id=owner.id AND si.archived_at IS NULL
  LEFT JOIN school_problem_versions v ON (v.school_id,v.id)=(p.school_id,p.published_version_id)
  LEFT JOIN LATERAL (SELECT jsonb_build_object('id',j.id,'state',j.state,'status',j.result->>'status') info FROM school_judge_jobs j
    WHERE p.editable AND j.school_id=$1 AND j.problem_id=p.id AND j.kind='validation' AND j.validation_revision=p.revision
    ORDER BY j.created_at DESC LIMIT 1) validation ON true
  LEFT JOIN school_problem_publications pub ON $3 AND pub.school_id=$1 AND pub.problem_id=p.id
  LEFT JOIN school_problem_publication_requests r ON $3 AND (r.school_id,r.problem_id,r.version_id)=($1,p.id,v.id)
  LEFT JOIN activities a ON a.problem_id=p.id LEFT JOIN courses c ON c.problem_id=p.id::text
  LEFT JOIN totals s ON s.problem_id=p.id ORDER BY title,p.id`, [schoolId,userId,admin]);
  return {items:rows};
}
