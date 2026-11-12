import { fail } from './security.mjs';
import { activeAccount, LEGACY_SCHOOL_ID } from './schools.mjs';
import { publicChapterLocalizations, localizedFields } from './course-localizations.mjs';

// Original-school lessons are mutable. The parent version changes whenever
// teaching staff edit the course, its audience or its chapters.
export const legacyCourseSourceVersion = "extract(epoch FROM p.updated_at)::text";
export const legacyCourseIsLive = `p.published_at IS NOT NULL AND p.archived_at IS NULL AND p.withdrawn_at IS NULL
  AND p.listed AND (p.available_from IS NULL OR p.available_from<=now())
  AND (p.available_until IS NULL OR p.available_until>now())`;

export async function legacyCourseStaffRole(db, accountId) {
  await activeAccount(db, accountId);
  const { rows } = await db.query(`SELECT r.role FROM legacy_school_account_ownership o
    JOIN account_roles r ON r.account_id=o.account_id
    WHERE o.school_id=$1 AND o.account_id=$2 AND r.role IN ('admin','teacher') FOR SHARE OF r`,
  [LEGACY_SCHOOL_ID, accountId]);
  return rows.some(row => row.role === 'admin') ? 'school_admin' : rows[0]?.role;
}

export async function requireLegacyCourseAdmin(db, accountId) {
  if (await legacyCourseStaffRole(db, accountId) !== 'school_admin') {
    fail(403, 'FORBIDDEN', '需要本校管理员权限');
  }
}

async function legacyCandidates(db, courseId, { lock = false, preview = false } = {}) {
  const { rows } = await db.query(`SELECT p.id,p.title,p.description,p.access_scope,p.localizations,p.required_language,p.language_credit_cutoffs,
    ${legacyCourseSourceVersion} source_version,
    (${legacyCourseIsLive}) published,
    CASE WHEN latest.source_version=${legacyCourseSourceVersion} THEN latest.revision
      ELSE COALESCE(latest.revision,0)+1 END published_revision,
    latest.source_version IS NOT DISTINCT FROM ${legacyCourseSourceVersion} snapshotted
    ${preview ? `, l.id listing_id,l.revision approved_revision,l.withdrawn_at,l.access_mode,
      (SELECT count(*)::int FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL) chapter_count,
      CASE WHEN p.access_scope='school' THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'body',c.content) ORDER BY c.position,c.created_at,c.id)
        FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL
      ),'[]'::jsonb) ELSE '[]'::jsonb END chapters` : ''}
    FROM learning_paths p
    LEFT JOIN LATERAL (
      SELECT v.revision,v.source_version FROM legacy_course_publication_versions v
      WHERE v.school_id=p.school_id AND v.course_id=p.id ORDER BY v.revision DESC LIMIT 1
    ) latest ON true
    ${preview ? 'LEFT JOIN public_course_listings l ON l.school_id=p.school_id AND l.course_id=p.id' : ''}
    WHERE p.school_id=$1 AND ($2::uuid IS NULL OR p.id=$2)
    ${preview ? `AND (${legacyCourseIsLive}) AND (p.access_scope='school' OR (
      l.access_mode='application' AND l.withdrawn_at IS NULL AND l.revision=latest.revision
      AND latest.source_version=${legacyCourseSourceVersion}
    )) ORDER BY p.title,p.id` : ''}
    ${lock ? 'FOR SHARE OF p' : ''}`,
  [LEGACY_SCHOOL_ID, courseId]);
  return rows;
}

export const legacyCourseCandidate = async (db, courseId, options) => (await legacyCandidates(db, courseId, options))[0];
export const legacyCourseReviewCandidates = (db) => legacyCandidates(db, null, { preview: true });

async function legacyCandidateChapters(db, courseId) {
  const { rows } = await db.query(`SELECT c.id,c.title,c.content body,c.localizations,c.acsl_links AS "acslLinks",COALESCE((
      SELECT jsonb_agg(jsonb_build_object('problemId',cp.problem_id,'versionId',cp.version_id)
        ORDER BY cp.position,cp.problem_id)
      FROM chapter_problems cp WHERE cp.chapter_id=c.id
    ),'[]'::jsonb) problems
    FROM learning_chapters c WHERE c.path_id=$1 AND c.archived_at IS NULL
    ORDER BY c.position,c.created_at,c.id`, [courseId]);
  return rows.map(({localizations,acslLinks,...chapter})=>({...chapter,...localizedFields(publicChapterLocalizations(localizations)),...(acslLinks?.length?{acslLinks}:{})}));
}

export async function snapshotLegacyCourse(db, course) {
  if (course.snapshotted) return;
  const chapters = await legacyCandidateChapters(db, course.id);
  if (!chapters.length || chapters.some(chapter => !chapter.body.trim())) {
    fail(409, 'NOT_PUBLISHED', '请先发布包含完整章节的校内课程');
  }
  await db.query(`INSERT INTO legacy_course_publication_versions
    (school_id,course_id,revision,source_version,title,description,access_scope,chapters,localizations,required_language,language_credit_cutoffs)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
  [LEGACY_SCHOOL_ID, course.id, course.published_revision, course.source_version, course.title,
    course.description, course.access_scope, JSON.stringify(chapters),course.localizations??null,course.required_language,course.language_credit_cutoffs]);
}

export async function legacyEdition(db, listing, { detail, lock }) {
  return (await db.query(`SELECT v.title,v.description,v.revision,v.access_scope,v.localizations,v.required_language,v.language_credit_cutoffs,s.name school_name,
    p.category,p.difficulty,p.cover_key,p.cover_image,p.author_name,p.authored_at,
    jsonb_array_length(v.chapters) chapter_count ${detail ? ', v.chapters' : ''}
    FROM legacy_course_publication_versions v
    JOIN learning_paths p ON p.id=v.course_id AND p.school_id=v.school_id
    JOIN schools s ON s.id=v.school_id
    WHERE v.school_id=$1 AND v.course_id=$2 AND v.revision=$3
      AND (${legacyCourseIsLive}) AND v.source_version=${legacyCourseSourceVersion}
      AND ($4='application' OR v.access_scope='school') ${lock ? 'FOR SHARE OF p' : ''}`,
  [listing.school_id, listing.course_id, listing.revision, listing.access_mode])).rows[0];
}

export async function legacyDirectAccess(db, listing, scope, accountId) {
  const { rowCount } = await db.query(`SELECT 1 FROM legacy_school_account_ownership o
    JOIN account_roles r ON r.account_id=o.account_id
    JOIN accounts a ON a.id=o.account_id
    WHERE o.school_id=$1 AND o.account_id=$2
      AND ($3='school' OR (r.role='student' AND EXISTS (
        SELECT 1 FROM learning_path_classes pc
        JOIN classes c ON c.id=pc.class_id AND c.school_id=o.school_id AND c.archived_at IS NULL
        JOIN class_members m ON m.class_id=c.id AND m.identity_id=a.identity_id
        WHERE pc.path_id=$4
      )))`, [listing.school_id, accountId, scope, listing.course_id]);
  return rowCount > 0;
}
