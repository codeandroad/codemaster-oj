import { readableCourseIds } from './course-access.mjs';
import { legacyCourseIsLive } from './legacy-public-course.mjs';
import { uuid } from './security.mjs';

export function problemCatalogCourseRequest(url) {
 const value = url?.searchParams.get('courseId');
 return {
  courseId: value ? uuid(value, 'Course ID').toLowerCase() : null,
  includeCourses: Boolean(value) || url?.searchParams.get('includeCourseFilters') === '1',
 };
}

export function problemCatalogCourseOption(id, course) {
 const localizations = {};
 for (const locale of ['en', 'zh']) {
  const title = course.localizations?.[locale]?.title;
  if (typeof title === 'string' && title) localizations[locale] = { title };
 }
 return { id, title: course.title, localizations };
}

export async function legacyProblemCatalogCourses(db, user, courseId) {
 const { rows } = await db.query(`SELECT p.id,p.title,p.localizations,
  array_agg(DISTINCT link.problem_id) FILTER (WHERE p.id=$1) AS "problemIds"
  FROM learning_paths p
  JOIN learning_chapters chapter ON chapter.path_id=p.id AND chapter.archived_at IS NULL
  JOIN chapter_problems link ON link.chapter_id=chapter.id
  WHERE ${legacyCourseIsLive}
  GROUP BY p.id ORDER BY p.title,p.id`, [courseId]);
 const readable = await readableCourseIds(db, user, rows.map(row => row.id), { listed: true });
 const courses = rows.filter(row => readable.has(row.id));
 return {
  courses: courses.map(course => problemCatalogCourseOption(course.id, course)),
  problemIds: courseId ? courses.find(course => course.id === courseId)?.problemIds ?? [] : null,
 };
}

export function chapterProblemVersions(chapters) {
 const versions = new Map();
 for (const chapter of chapters) {
  for (const link of chapter.problems ?? []) {
   if (!versions.has(link.problemId)) versions.set(link.problemId, new Set());
   versions.get(link.problemId).add(link.versionId);
  }
 }
 return versions;
}
