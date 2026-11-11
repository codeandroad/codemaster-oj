import {liveProblemVersionIdSql} from './live-problem-version.mjs';
import { readableCourseIds } from './course-access.mjs';
import { latestCourseProblemVersion } from './course-problem-version.mjs';

export function recommendSolutionVersion(versions) {
 const recommend = candidates => ({recommendedVersionId:candidates.length === 1 ? candidates[0].versionId : null,selectionRequired:candidates.length > 1});
 const courses = versions.filter(version => version.usage.courseCount > 0);
 if (courses.length) return recommend(courses);
 const activities = versions.filter(version => version.usage.assignmentCount > 0 || version.usage.timedCount > 0);
 if (activities.length) return recommend(activities);
 const practice = versions.filter(version => version.usage.schoolPractice);
 if (practice.length) return recommend(practice);
 return {recommendedVersionId:versions.find(version => version.latest)?.versionId ?? versions[0]?.versionId ?? null,selectionRequired:false};
}

/** Management only: the caller must first authorize editing the exact problem. */
export async function withProblemSolutionUsage(db,user,problemId,versions) {
 const courseRows = (await db.query(`SELECT DISTINCT course.id,course.title,COALESCE(latest.id,linked.id) AS version_id
  FROM chapter_problems cp JOIN learning_chapters ch ON ch.id=cp.chapter_id
  JOIN learning_paths course ON course.id=ch.path_id
  JOIN problems p ON p.id=cp.problem_id JOIN problem_banks bank ON bank.id=p.bank_id
  JOIN problem_versions linked ON linked.id=cp.version_id AND linked.problem_id=cp.problem_id
  ${latestCourseProblemVersion} linked.published_at IS NOT NULL AND linked.school_visible_at IS NOT NULL
  JOIN problem_versions active ON active.id=COALESCE(latest.id,linked.id)
  WHERE cp.problem_id=$1 AND ch.archived_at IS NULL AND course.archived_at IS NULL AND course.published_at IS NOT NULL
   AND (course.available_from IS NULL OR course.available_from<=now())
   AND (course.available_until IS NULL OR course.available_until>now())
   AND (course.access_scope='school' OR EXISTS(SELECT 1 FROM learning_path_classes audience
    JOIN classes class ON class.id=audience.class_id AND class.archived_at IS NULL WHERE audience.path_id=course.id))
   AND p.archived_at IS NULL AND bank.archived_at IS NULL AND bank.visibility='school'
   AND active.published_at IS NOT NULL AND active.school_visible_at IS NOT NULL
  ORDER BY course.title,course.id`,[problemId])).rows;
 const readableCourses = await readableCourseIds(db,user,courseRows.map(course => course.id));
 const admin = user.roles.includes('admin');
 const assignments = (await db.query(`SELECT a.id,a.title,a.owner_account_id,${liveProblemVersionIdSql('p')} version_id FROM assignment_problems ap
  JOIN problems p ON p.id=ap.problem_id JOIN assignments a ON a.id=ap.assignment_id WHERE ap.problem_id=$1 AND a.state='Published'
   AND a.archived_at IS NULL ORDER BY a.title,a.id`,[problemId])).rows;
 const timedPractices = (await db.query(`SELECT t.id,t.title,t.owner_account_id,${liveProblemVersionIdSql('p')} version_id FROM timed_practice_problems tp
  JOIN problems p ON p.id=tp.problem_id JOIN timed_practices t ON t.id=tp.practice_id WHERE tp.problem_id=$1 AND t.state IN ('Published','ResultsPublished')
   AND t.archived_at IS NULL ORDER BY t.title,t.id`,[problemId])).rows;
 // This is the default school-wide practice revision, not current_version_id:
 // a pending teaching replacement must not displace a student's public one.
 const practice = (await db.query(`SELECT v.id FROM problem_versions v JOIN problems p ON p.id=v.problem_id
  JOIN problem_banks bank ON bank.id=p.bank_id WHERE p.id=$1 AND p.archived_at IS NULL
   AND bank.archived_at IS NULL AND bank.visibility='school' AND v.id=${liveProblemVersionIdSql('p')} AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL
  ORDER BY v.published_at DESC,v.created_at DESC,v.id DESC LIMIT 1`,[problemId])).rows[0];
 const shape = row => ({id:row.id,title:row.title});
 const readableActivity = row => admin || row.owner_account_id === user.id;
 const items = versions.map(version => {
  const courses = courseRows.filter(row => row.version_id === version.versionId);
  const assigned = assignments.filter(row => row.version_id === version.versionId);
  const timed = timedPractices.filter(row => row.version_id === version.versionId);
  return {...version,usage:{courseCount:courses.length,courses:courses.filter(course => readableCourses.has(course.id)).map(shape),
   assignmentCount:assigned.length,assignments:assigned.filter(readableActivity).map(shape),timedCount:timed.length,timedPractices:timed.filter(readableActivity).map(shape),
   schoolPractice:practice?.id === version.versionId}};
 });
 return {versions:items,...recommendSolutionVersion(items)};
}
