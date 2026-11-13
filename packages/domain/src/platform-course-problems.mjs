import { fail, uuid } from './security.mjs';
import { LEGACY_SCHOOL_ID, activeAccount, lockSchoolTeaching } from './schools.mjs';
import { legacyCourseIsLive } from './legacy-public-course.mjs';
import { platformCourseAdmission } from './platform-course-access.mjs';
import { preparePlatformCourseProblem } from './legacy-public-problems.mjs';

export const platformProblemReadySql=(p='p',v='v',b='b')=>`${p}.owner_scope='platform' AND ${p}.archived_at IS NULL
 AND ${b}.archived_at IS NULL AND ${v}.published_at IS NOT NULL AND ${v}.validation_status='AC'
 AND ${v}.rank_review_status='approved' AND NOT EXISTS(SELECT 1 FROM timed_practice_problems t WHERE t.problem_id=${p}.id)`;

// Admission grants only this linked exercise, never the source school's bank.
export async function platformCourseProblem(db,user,id,{courseId=null,chapterId=null,versionId=null}={}) {
 await lockSchoolTeaching(db,LEGACY_SCHOOL_ID,{shared:true});
 await activeAccount(db,user.id);
 if(courseId)uuid(courseId);if(chapterId)uuid(chapterId);if(versionId)uuid(versionId);
 const rows=(await db.query(`SELECT p.id course_id,cp.version_id FROM learning_paths p
 JOIN learning_chapters c ON c.path_id=p.id AND c.archived_at IS NULL
 JOIN chapter_problems cp ON cp.chapter_id=c.id
 LEFT JOIN public_course_listings listing ON listing.course_id=p.id
 WHERE p.owner_scope='platform' AND ${legacyCourseIsLive} AND cp.problem_id=$1
 AND ($2::uuid IS NULL OR p.id=$2 OR listing.id=$2) AND ($3::uuid IS NULL OR c.id=$3)
 AND ($4::uuid IS NULL OR cp.version_id=$4) ORDER BY p.id,c.position`,[uuid(id),courseId,chapterId,versionId])).rows;
 for(const row of rows){
  const access=await platformCourseAdmission(db,row.course_id,user.id);
  if(access.admission!=='direct'){if(courseId&&access.admission!=='denied')fail(403,'COURSE_APPLICATION_REQUIRED','请先申请加入课程');continue;}
  await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);
  const p=await preparePlatformCourseProblem(db,id,row.version_id);
  if(p)return p;
  if(courseId&&(await db.query("SELECT 1 FROM problems WHERE id=$1 AND owner_scope='school'",[id])).rowCount)return null;
 }
 fail(404,'COURSE_PROBLEM_UNAVAILABLE','题目不在可访问的课程中，或关联版本暂不可用');
}

export async function platformChapterProblems(db,course,accountId) {
 const links=course.chapters.flatMap(c=>c.problems??[]);
 const rows=(await db.query(`SELECT link.*,v.title, (EXISTS(SELECT 1 FROM school_judge_jobs j
 WHERE j.school_id=$3 AND j.problem_id=p.id AND j.version_id=v.id AND j.account_id=$2
 AND j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL AND j.state='completed'
 AND j.result->>'status'='AC' AND course_language_allows_credit($4,$5,j.payload->>'language',j.created_at))
 OR EXISTS(SELECT 1 FROM submissions s JOIN accounts a ON a.identity_id=s.identity_id
 WHERE a.id=$2 AND s.problem_id=p.id AND s.version_id=v.id AND s.status='AC' AND s.kind IN ('submit','correction')
 AND (s.timed_attempt_id IS NULL OR EXISTS(SELECT 1 FROM timed_attempts ta JOIN timed_practices tp ON tp.id=ta.practice_id
 WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL))
 AND course_language_allows_credit($4,$5,s.language,s.created_at))) solved
 FROM jsonb_to_recordset($1::jsonb) link("problemId" uuid,"versionId" uuid)
 JOIN problems p ON p.id=link."problemId" JOIN problem_versions v ON v.id=link."versionId" AND v.problem_id=p.id
 JOIN problem_banks b ON b.id=p.bank_id WHERE ${platformProblemReadySql()}`,
 [JSON.stringify(links),accountId,LEGACY_SCHOOL_ID,course.required_language,course.language_credit_cutoffs])).rows;
 return new Map(rows.map(r=>[`${r.problemId}:${r.versionId}`,r]));
}
