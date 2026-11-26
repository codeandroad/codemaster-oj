import { assignmentPassingProgressSubmission } from './assignment-grades.mjs';
import { platformContentEditorSql } from './platform-content-access.mjs';
import { schoolRole } from './schools.mjs';
import { enumValue, fail, field, uuid } from './security.mjs';

// Selection is a teaching permission within this school. Following a link as
// a learner still goes through readableClassCourse and its admission checks.
export async function assignmentCourses(db, schoolId, user, courseId = null) {
  const role = await schoolRole(db, schoolId, user.id);
  const local = await db.query(
    `SELECT c.id,p.title,p.required_language AS "requiredLanguage",'school' AS scope,
    ARRAY(SELECT ex->>'problemId' FROM jsonb_array_elements(p.chapters) WITH ORDINALITY ch(item,n),
      jsonb_array_elements(ch.item->'problems') WITH ORDINALITY problem(ex,pos) ORDER BY n,pos) AS "problemIds"
    FROM school_courses c JOIN school_course_publications p ON (p.school_id,p.course_id,p.revision)=(c.school_id,c.id,c.published_revision)
    WHERE c.school_id=$1 AND c.published AND c.archived_at IS NULL AND ($2::uuid IS NULL OR c.id=$2)
    AND ($3='school_admin' OR c.owner_account_id=$4) ORDER BY p.title,c.id`,
    [schoolId, courseId, role, user.id],
  );
  const platform = await db.query(
    `SELECT c.id,c.title,c.required_language AS "requiredLanguage",'platform' AS scope,
    ARRAY(SELECT cp.problem_id FROM learning_chapters ch JOIN chapter_problems cp ON cp.chapter_id=ch.id
      WHERE ch.path_id=c.id AND ch.archived_at IS NULL ORDER BY ch.position,ch.id,cp.position) AS "problemIds"
    FROM learning_paths c WHERE c.owner_scope='platform' AND c.merged_into_id IS NULL AND c.published_at IS NOT NULL AND c.archived_at IS NULL AND c.withdrawn_at IS NULL
    AND (c.available_from IS NULL OR c.available_from<=now()) AND (c.available_until IS NULL OR c.available_until>now())
    AND ($2::uuid IS NULL OR c.id=$2) AND ${platformContentEditorSql('course', 'c.id', '$3', '$1::uuid')} ORDER BY c.title,c.id`,
    [schoolId, courseId, user.id],
  );
  return [...local.rows, ...platform.rows];
}

export async function assignmentMetadata(db, activity, user, body) {
  const current = activity.school_course_id ?? activity.platform_course_id;
  const courseId = body.courseId === undefined ? current : body.courseId ? uuid(body.courseId) : null;
  let schoolCourse = activity.school_course_id ?? null,
    platformCourse = activity.platform_course_id ?? null;
  let language = activity.required_language ?? null;
  if (courseId !== current || (courseId && activity.state === 'Draft')) {
    const [course] = courseId ? await assignmentCourses(db, activity.school_id, user, courseId) : [];
    if (courseId && !course)
      fail(409, 'COURSE_UNAVAILABLE', 'The linked course is unavailable in this school.');
    schoolCourse = course?.scope === 'school' ? course.id : null;
    platformCourse = course?.scope === 'platform' ? course.id : null;
    language = course?.requiredLanguage ?? null;
    if (activity.state === 'Published' && language !== activity.required_language)
      fail(409, 'ACTIVITY_FROZEN', 'Published assignments keep their language requirement.');
  }
  await db.query(
    `UPDATE school_activities SET subject_label=$3,problem_order=$4,school_course_id=$5,platform_course_id=$6,required_language=$7
    WHERE school_id=$1 AND id=$2`,
    [
      activity.school_id,
      activity.id,
      field(body.subjectLabel ?? activity.subject_label, 'Subject', { min: 0, max: 120 }),
      enumValue(body.problemOrder ?? activity.problem_order, ['custom', 'course'], 'Problem order'),
      schoolCourse,
      platformCourse,
      language,
    ],
  );
  return platformCourse;
}

export async function recordedParticipants(db, a) {
  return (
    await db.query(
      `SELECT identity_id FROM school_activity_attempts WHERE school_id=$1 AND activity_id=$2
    UNION SELECT identity_id FROM school_judge_jobs WHERE school_id=$1 AND activity_id=$2 AND identity_id IS NOT NULL
    UNION SELECT identity_id FROM submissions WHERE school_id=$1 AND assignment_id=$2`,
      [a.school_id, a.id],
    )
  ).rows.map((row) => row.identity_id);
}

export async function assignmentSubmissions(db, activity, identityId, problemId, page) {
  const { school_id: schoolId, id } = activity;
  const rows = (
    await db.query(
      `WITH records AS (
    SELECT j.id::text, j.kind, j.created_at, j.payload->>'language' AS language, j.payload->>'code' AS code,
      coalesce(j.result->>'status',CASE j.state WHEN 'failed' THEN 'System Error' WHEN 'leased' THEN 'Judging' ELSE 'Waiting' END) AS status,
      (j.result->>'score')::float8 AS score,
      ARRAY(SELECT f.note FROM school_assignment_feedback f WHERE (f.school_id,f.job_id)=(j.school_id,j.id) ORDER BY f.created_at,f.id) AS notes
    FROM school_judge_jobs j WHERE j.school_id=$1 AND j.activity_id=$2 AND j.identity_id=$3 AND j.problem_id=$4
      AND j.access_context='school' AND j.kind='submit'
    UNION ALL SELECT 'SUB'||s.id,s.kind,s.created_at,s.language,s.code,s.status,s.score::float8,
      ARRAY(SELECT r.note FROM review_entries r WHERE r.submission_id=s.id ORDER BY r.created_at,r.id)
    FROM submissions s WHERE s.school_id=$1 AND s.identity_id=$3 AND s.problem_id=$4
      AND ((s.assignment_id=$2 AND s.kind='submit') OR (s.kind='correction' AND EXISTS(
        SELECT 1 FROM submissions original WHERE original.id=s.original_submission_id AND original.school_id=$1
        AND original.assignment_id=$2 AND original.identity_id=$3 AND original.problem_id=$4 AND original.kind='submit')))
    ) SELECT id,kind,created_at AS "createdAt",language,code,status,score,notes FROM records ORDER BY created_at DESC,id LIMIT 11 OFFSET $5`,
      [schoolId, id, identityId, problemId, (page - 1) * 10],
    )
  ).rows;
  return {
    items: rows
      .slice(0, 10)
      .map(({ notes, ...entry }) => ({ ...entry, reviews: notes.map((note) => ({ note })) })),
    hasMore: rows.length > 10,
  };
}

export async function addAssignmentFeedback(db, a, user, identityId, problemId, body) {
  const id = String(body.submissionId),
    note = field(body.note, 'Feedback', { max: 10000 });
  const numeric = /^SUB([1-9][0-9]{0,17})$/.exec(id)?.[1];
  const args = [a.school_id, a.id, identityId, problemId, numeric ?? uuid(id), user.id, note];
  const result = numeric
    ? await db.query(
        `INSERT INTO review_entries(submission_id,author_account_id,note)
        SELECT id,$6,$7 FROM submissions WHERE school_id=$1 AND assignment_id=$2 AND identity_id=$3 AND problem_id=$4 AND id=$5 AND kind='submit'
        RETURNING id`,
        args,
      )
    : await db.query(
        `INSERT INTO school_assignment_feedback(school_id,job_id,author_account_id,note)
        SELECT school_id,id,$6,$7 FROM school_judge_jobs WHERE school_id=$1 AND activity_id=$2 AND identity_id=$3 AND problem_id=$4 AND id=$5 AND kind='submit' AND access_context='school'
        RETURNING id`,
        args,
      );
  if (!result.rowCount) fail(404, 'NOT_FOUND', 'Assignment submission not found.');
  const reviewId = result.rows[0].id;
  await db.query(
    `INSERT INTO student_system_notifications(school_id,school_identity_id,kind,source_key,data)
    SELECT p.school_id,$3,'teacher_feedback',$5,jsonb_build_object('reviewId',$5::text,'submissionId',$6::text,'problemTitle',v.definition->>'title')
    FROM school_activity_problems p JOIN school_problem_versions v ON (v.school_id,v.id)=(p.school_id,p.version_id)
    WHERE p.school_id=$1 AND p.activity_id=$2 AND p.problem_id=$4`,
    [a.school_id, a.id, identityId, problemId, reviewId, id],
  );
  return { id: reviewId };
}

// Completion follows learning progress, including late work. Official grades keep their cutoff.
// Limit the aggregation to the visible page; no per-student grade queries on the list.
export async function assignmentCompletionCounts(db, schoolId, ids, visibleJobSql) {
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT completed.activity_id,count(*)::int AS count FROM (
    SELECT part.activity_id,part.identity_id FROM school_activity_participants part
    JOIN school_activities assignment ON (assignment.school_id,assignment.id)=(part.school_id,part.activity_id)
    JOIN school_activity_problems ap ON (ap.school_id,ap.activity_id)=(part.school_id,part.activity_id)
    WHERE part.school_id=$1 AND part.activity_id=ANY($2::uuid[]) AND NOT part.exempt
    GROUP BY part.activity_id,part.identity_id
    HAVING bool_and(EXISTS (
      SELECT 1 FROM school_judge_jobs j WHERE (j.school_id,j.identity_id,j.problem_id,j.version_id)=(part.school_id,part.identity_id,ap.problem_id,ap.version_id)
      AND j.access_context='school' AND j.kind='submit' AND j.state='completed' AND j.result->>'status'='AC'
      AND (assignment.required_language IS NULL OR assignment.required_language=coalesce(j.payload->>'language','python'))
      AND (j.activity_id=assignment.id OR (
        j.activity_id IS DISTINCT FROM assignment.id AND ${visibleJobSql}
        AND (assignment.cancelled_at IS NULL OR j.created_at<=assignment.cancelled_at)))
    ) OR EXISTS (
      SELECT 1 FROM submissions previous WHERE previous.school_id=part.school_id AND ${assignmentPassingProgressSubmission}
    ))
  ) completed GROUP BY completed.activity_id`,
    [schoolId, ids],
  );
  return new Map(rows.map((r) => [r.activity_id, r.count]));
}

export async function orderAssignmentProblems(db, activity, pins) {
  if (
    activity.problem_order !== 'course' ||
    !pins.length ||
    !(activity.school_course_id || activity.platform_course_id)
  )
    return pins;
  const outline = activity.school_course_id
    ? await db.query(
        `SELECT ex->>'problemId' AS id FROM school_courses c JOIN school_course_publications p
        ON (p.school_id,p.course_id,p.revision)=(c.school_id,c.id,c.published_revision),
        jsonb_array_elements(p.chapters) WITH ORDINALITY ch(item,n),
        jsonb_array_elements(ch.item->'problems') WITH ORDINALITY problem(ex,pos)
        WHERE c.school_id=$1 AND c.id=$2 ORDER BY n,pos`,
        [activity.school_id, activity.school_course_id],
      )
    : await db.query(
        `SELECT cp.problem_id AS id FROM learning_chapters ch JOIN chapter_problems cp ON cp.chapter_id=ch.id
        WHERE ch.path_id=$1 AND ch.archived_at IS NULL ORDER BY ch.position,ch.id,cp.position`,
        [activity.platform_course_id],
      );
  const order = new Map();
  for (const { id } of outline.rows) if (!order.has(id)) order.set(id, order.size);
  return pins.sort((left, right) => (order.get(left.id) ?? order.size) - (order.get(right.id) ?? order.size));
}

export async function assignmentHasRuns(db, activity) {
  return (
    (
      await db.query(
        `SELECT 1 FROM school_judge_jobs WHERE school_id=$1 AND activity_id=$2
    UNION ALL SELECT 1 FROM submissions WHERE school_id=$1 AND assignment_id=$2 LIMIT 1`,
        [activity.school_id, activity.id],
      )
    ).rowCount > 0
  );
}
