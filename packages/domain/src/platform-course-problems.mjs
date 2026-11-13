import { fail, uuid } from './security.mjs';
import { LEGACY_SCHOOL_ID, activeAccount, lockSchoolTeaching } from './schools.mjs';
import { legacyCourseIsLive } from './legacy-public-course.mjs';
import { platformCourseAdmission } from './platform-course-access.mjs';
import { preparePlatformCourseProblem } from './legacy-public-problems.mjs';
import { liveProblemVersionIdSql } from './live-problem-version.mjs';
import { problemSolvedSql } from './problem-progress.mjs';

export const platformProblemReadySql=(p='p',v='v',b='b')=>`${p}.owner_scope='platform' AND ${p}.archived_at IS NULL
 AND ${b}.archived_at IS NULL AND ${v}.published_at IS NOT NULL AND ${v}.validation_status='AC'
 AND ${v}.rank_review_status='approved' AND NOT EXISTS(SELECT 1 FROM timed_practice_problems t WHERE t.problem_id=${p}.id)`;

// Admission grants only this linked exercise, never the source school's bank.
export async function platformCourseProblem(db,user,id,{courseId=null,chapterId=null,versionId=null}={}) {
 await lockSchoolTeaching(db,LEGACY_SCHOOL_ID,{shared:true});
 await activeAccount(db,user.id);
 if(courseId)uuid(courseId);if(chapterId)uuid(chapterId);if(versionId)uuid(versionId);
 const rows=(await db.query(`SELECT p.id course_id FROM learning_paths p
 JOIN learning_chapters c ON c.path_id=p.id AND c.archived_at IS NULL
 JOIN chapter_problems cp ON cp.chapter_id=c.id
 LEFT JOIN public_course_listings listing ON listing.course_id=p.id
 WHERE p.owner_scope='platform' AND ${legacyCourseIsLive} AND cp.problem_id=$1
 AND ($2::uuid IS NULL OR p.id=$2 OR listing.id=$2) AND ($3::uuid IS NULL OR c.id=$3)
 ORDER BY p.id,c.position`,[uuid(id),courseId,chapterId])).rows;
 for(const row of rows){
  const access=await platformCourseAdmission(db,row.course_id,user.id);
  if(access.admission!=='direct'){if(courseId&&access.admission!=='denied')fail(403,'COURSE_APPLICATION_REQUIRED','请先申请加入课程');continue;}
  await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);
  const p=await preparePlatformCourseProblem(db,id);
  if(p)return p;
  if(courseId&&(await db.query("SELECT 1 FROM problems WHERE id=$1 AND owner_scope='school'",[id])).rowCount)return null;
 }
 fail(404,'COURSE_PROBLEM_UNAVAILABLE','题目不在可访问的课程中，或关联版本暂不可用');
}

export async function platformChapterProblems(db,course,accountId) {
 const links=course.chapters.flatMap(c=>c.problems??[]);
 const rows=(await db.query(`SELECT link."problemId",link."versionId" AS "linkedVersionId",v.id AS "versionId",v.title,
 ${problemSolvedSql({problemId:'p.id',accountId:'$2',requiredLanguage:'$3',languageCreditCutoffs:'$4'})} solved
 FROM jsonb_to_recordset($1::jsonb) link("problemId" uuid,"versionId" uuid)
 JOIN problems p ON p.id=link."problemId" JOIN problem_versions v ON v.id=${liveProblemVersionIdSql('p')}
 JOIN problem_banks b ON b.id=p.bank_id WHERE ${platformProblemReadySql()}`,
 [JSON.stringify(links),accountId,course.required_language,course.language_credit_cutoffs])).rows;
 return new Map(rows.map(({linkedVersionId,...row})=>[`${row.problemId}:${linkedVersionId}`,row]));
}
