// Catalogs need metadata and the current account's progress, never full problem
// statements, reference implementations, test vectors or graded answer snapshots.
const metadata = `p.id,p.version_id AS "versionId",p.slug,
  content.title,content.division,content.season,content.round,content."roundLabel",
  jsonb_array_length(content.questions) AS "questionCount",
  p.programming_problem_id IS NOT NULL AS "hasProgramming"`;
// Extract the shallow fields once: repeated -> operations would repeatedly
// decompress editions whose private generated test vectors are several MB.
const contentFields = `CROSS JOIN LATERAL jsonb_to_record(p.definition)
  AS content(title jsonb,division text,season text,round integer,"roundLabel" jsonb,questions jsonb)`;

function optionalFields({ roundLabel, writtenPointsAwarded, programmingPointsAwarded, ...item }) {
  return { ...item, ...(roundLabel ? { roundLabel } : {}),
    ...(writtenPointsAwarded > 0 ? { writtenPointsAwarded } : {}),
    ...(programmingPointsAwarded > 0 ? { programmingPointsAwarded } : {}) };
}

export async function acslCatalog(db, schoolId, accountId) {
  const { rows } = await db.query(`WITH RECURSIVE catalog AS MATERIALIZED (
    SELECT ${metadata},p.school_id,p.programming_problem_id,p.programming_version_id,
      ARRAY(SELECT question->>'id' FROM jsonb_array_elements(content.questions) question) AS question_ids
    FROM acsl_papers p ${contentFields} WHERE p.school_id=$1 AND p.enabled
  ), lineage(paper_id,problem_id,version_id) AS (
    SELECT id,programming_problem_id,programming_version_id FROM catalog WHERE "hasProgramming"
    UNION
    SELECT lineage.paper_id,lineage.problem_id,revision.before_programming_version_id
    FROM lineage JOIN acsl_programming_revisions revision
      ON revision.school_id=$1 AND revision.paper_id=lineage.paper_id AND revision.problem_id=lineage.problem_id
        AND revision.after_programming_version_id=lineage.version_id
  ), coding AS (
    SELECT lineage.paper_id,bool_or(job.state='completed' AND job.result->>'status'='AC') AS solved
    FROM lineage JOIN school_judge_jobs job ON job.school_id=$1 AND job.problem_id=lineage.problem_id
      AND job.version_id=lineage.version_id AND job.account_id=$2 AND job.access_context='acsl' AND job.kind='submit'
    GROUP BY lineage.paper_id
  ), drafts AS (
    SELECT p.id AS paper_id,count(*)::integer AS answered_count
    FROM catalog p JOIN acsl_drafts draft ON draft.school_id=$1 AND draft.paper_id=p.id
      AND draft.version_id=p."versionId" AND draft.account_id=$2
      AND draft.question_id=ANY(p.question_ids) AND jsonb_array_length(draft.selected_option_ids)>0
    GROUP BY p.id
  ), programming_awards AS (
    SELECT award.paper_id,award.version_id,award.points FROM acsl_point_awards award
    JOIN accounts actor ON actor.identity_id=award.identity_id AND actor.id=$2
    JOIN identities person ON person.id=actor.identity_id AND person.kind='student' AND person.archived_at IS NULL
    JOIN legacy_school_account_ownership membership ON membership.account_id=actor.id AND membership.school_id=award.school_id
    JOIN legacy_school_identity_ownership ownership ON ownership.identity_id=person.id AND ownership.school_id=award.school_id
    WHERE award.school_id=$1 AND award.section='programming'
      AND actor.disabled_at IS NULL AND actor.binding_released_at IS NULL
      AND EXISTS(SELECT 1 FROM account_roles role WHERE role.account_id=actor.id AND role.role='student')
  ) SELECT p.id,p."versionId",p.slug,p.title,p.division,p.season,p.round,p."roundLabel",p."hasProgramming",p."questionCount",
    coalesce(grade.question_count,drafts.answered_count,0) AS "answeredCount",
    grade.id IS NOT NULL AS graded,grade.id AS "gradeId",grade.created_at AS "gradedAt",
    grade.correct_count AS score,p."questionCount" AS "maxScore",grade.correct_count AS "correctCount",
    written_award.points AS "writtenPointsAwarded",programming_awards.points AS "programmingPointsAwarded",
    coalesce(coding.solved,false) AS "programmingSolved"
  FROM catalog p
  LEFT JOIN acsl_paper_grades grade ON grade.school_id=$1 AND grade.paper_id=p.id
    AND grade.version_id=p."versionId" AND grade.account_id=$2
  LEFT JOIN acsl_point_awards written_award ON written_award.school_id=$1 AND written_award.grade_id=grade.id
  LEFT JOIN programming_awards ON p."hasProgramming" AND programming_awards.paper_id=p.id AND programming_awards.version_id=p."versionId"
  LEFT JOIN drafts ON drafts.paper_id=p.id LEFT JOIN coding ON coding.paper_id=p.id
  ORDER BY p.slug`, [schoolId, accountId]);
  return rows.map(optionalFields);
}

export async function acslManagementCatalog(db, schoolId) {
  const { rows } = await db.query(`SELECT ${metadata},p.enabled,true AS "canEdit",true AS "canExport"
    FROM acsl_papers p ${contentFields} WHERE p.school_id=$1 ORDER BY p.slug`, [schoolId]);
  return rows.map(optionalFields);
}
