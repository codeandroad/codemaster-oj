import { readableCourseIds } from '../../../src/course-access.mjs';
import { lockSchoolTeaching } from '../../../src/schools.mjs';
import { LEGACY_SCHOOL_ID } from './legacy-school.mjs';
import { platformContentEditorSql } from '../../../src/platform-content-access.mjs';
import { liveProblemVersionIdSql } from '../../../src/live-problem-version.mjs';
import { fail, uuid } from '../../../src/security.mjs';

// Editorial access in another school does not authorize use in this workspace.
// Keep this separate from learner admission: linking a course grants no access
// to its chapters, and an edit grant is not a course admission.
async function candidates(db,user,id,{lock=false}={}){
 const {rows}=await db.query(`SELECT p.id,p.title,p.published_at,p.archived_at,p.required_language,p.owner_scope
  FROM learning_paths p WHERE p.published_at IS NOT NULL AND p.archived_at IS NULL AND p.merged_into_id IS NULL
   AND ($2::uuid IS NULL OR p.id=$2)
   AND (p.owner_scope='school' OR (
    p.owner_scope='platform' AND p.withdrawn_at IS NULL
    AND (p.available_from IS NULL OR p.available_from<=now())
    AND (p.available_until IS NULL OR p.available_until>now())
    AND ${platformContentEditorSql('course','p.id','$1::uuid','$3::uuid')}))
  ORDER BY p.updated_at DESC,p.id${lock?' FOR SHARE OF p':''}`,[user.id,id,LEGACY_SCHOOL_ID]);
 return rows;
}

function option(course){
 return {id:course.id,title:course.title,requiredLanguage:course.required_language,published:true};
}

export async function assignmentCourseMetadata(db,user,id){
 if(!id)return null;
 const [course]=await candidates(db,user,id);
 return course?.owner_scope==='platform'?course:null;
}

export async function requireAssignmentCourse(db,user,value){
 if(value===null||value==='')return null;
 const id=uuid(value,'关联课程 ID');
 // Platform grant changes acquire the same teaching lock exclusively.
 await lockSchoolTeaching(db,LEGACY_SCHOOL_ID,{shared:true});
 const [course]=await candidates(db,user,id,{lock:true});
 if(!course)fail(409,'COURSE_UNAVAILABLE','只能关联已发布、未归档且有权用于作业的课程');
 return course;
}

export const platformProblemAssignableSql=version=>`${version}.school_visible_at IS NOT NULL
 AND ${version}.rank_review_status='approved' AND NOT ${version}.course_only_published`;

export async function handleAssignmentCourses({pool,user,route,method,url}){
 if(method!=='GET'||url.searchParams.get('purpose')!=='assignment')return null;
 const match=route.match(/^\/learning-paths(?:\/([^/]+))?$/);
 if(!match)return null;
 if(!user.roles.some(role=>role==='teacher'||role==='admin'))fail(403,'FORBIDDEN','需要教师权限');
 const id=match[1]?uuid(match[1],'关联课程 ID'):null;
 const courses=await candidates(pool,user,id);
 const readable=await readableCourseIds(pool,user,courses.filter(course=>course.owner_scope==='school').map(course=>course.id),{listed:!id});
 const eligible=courses.filter(course=>course.owner_scope==='platform'||readable.has(course.id));
 if(!id)return {status:200,body:{items:eligible.map(option)}};
 if(!eligible.length)fail(404,'NOT_FOUND','当前无法将此课程用于作业');
 // The editor needs problem order, not chapter bodies or learner progress.
 const {rows}=await pool.query(`SELECT c.id,COALESCE(jsonb_agg(jsonb_build_object('problemId',p.id) ORDER BY cp.position, p.id)
  FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) problems
  FROM learning_chapters c LEFT JOIN chapter_problems cp ON cp.chapter_id=c.id
  LEFT JOIN problems p ON p.id=cp.problem_id AND p.archived_at IS NULL
  LEFT JOIN problem_banks b ON b.id=p.bank_id AND b.archived_at IS NULL
  LEFT JOIN problem_versions v ON v.id=${liveProblemVersionIdSql('p')} AND b.id IS NOT NULL
   AND (p.owner_scope='school' OR (${platformProblemAssignableSql('v')}))
  WHERE c.path_id=$1 AND c.archived_at IS NULL
  GROUP BY c.id ORDER BY c.position,c.created_at,c.id`,[id]);
 return {status:200,body:{...option(eligible[0]),chapters:rows}};
}
