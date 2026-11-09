import { readableCourseIds } from './course-access.mjs';
import { transaction } from './db.mjs';
import { bytes, enumValue, fail, integer, uuid } from './security.mjs';

const reply = body => ({ status: 200, body });
export const tutorialSettings = row => ({ mode: row.tutorial_mode, body: row.tutorial_body, revision: row.tutorial_revision });
export const customTutorial = row => row.tutorial_mode === 'custom' ? { source: 'custom', body: row.tutorial_body } : null;

// A published school problem can have teaching material maintained separately
// from its draft, reference solution, tests, and publication.
export const schoolPublishedTutorialProblemSql = `p.archived_at IS NULL AND bank.archived_at IS NULL AND bank.visibility='school'
 AND EXISTS (SELECT 1 FROM problem_versions tv WHERE tv.problem_id=p.id AND tv.published_at IS NOT NULL
  AND tv.school_visible_at IS NOT NULL AND tv.rank_review_status='approved')`;

export async function canManageLegacyTutorial(db,user,problem,canEdit) {
 if (canEdit) return true;
 if (!user.roles.includes('teacher')) return false;
 return !!(await db.query(`SELECT 1 FROM problems p JOIN problem_banks bank ON bank.id=p.bank_id
  WHERE p.id=$1 AND ${schoolPublishedTutorialProblemSql}`,[problem.id])).rowCount;
}

export function tutorialContext(url) {
 const course = url.searchParams.get('courseId'), chapter = url.searchParams.get('chapterId');
 return {
  courseId: course ? uuid(course, '课程 ID').toLowerCase() : null,
  chapterId: chapter ? uuid(chapter, '章节 ID').toLowerCase() : null,
 };
}

export async function saveTutorial(db, problem, body, audit) {
 const mode = enumValue(body.mode, ['course','custom','none'], '教程来源');
 const content = mode === 'custom' ? bytes(body.body, '教程正文', 65536) : '';
 if (mode === 'custom' && !content.trim()) fail(400, 'VALIDATION', '请填写教程正文');
 const expected = integer(body.expectedRevision, 0, 2147483646, '教程版本');
 if (mode === problem.tutorial_mode && content === problem.tutorial_body) return tutorialSettings(problem);

 const school = Boolean(problem.school_id);
 const table = school ? 'school_problems' : 'problems';
 const scope = school ? ' AND school_id=$5' : ' AND archived_at IS NULL';
 const params = [problem.id,mode,content,expected,...(school ? [problem.school_id] : [])];
 const { rows: [saved] } = await db.query(`UPDATE ${table} SET
  tutorial_mode=$2,tutorial_body=$3,tutorial_revision=tutorial_revision+1
  WHERE id=$1 AND tutorial_revision=$4${scope} RETURNING tutorial_mode,tutorial_body,tutorial_revision`, params);
 if (!saved) fail(409, 'REVISION_CONFLICT', '教程已被更新，请重新载入后再保存');
 await audit({ mode, revision: saved.tutorial_revision });
 return tutorialSettings(saved);
}

async function legacyCourseTutorial(db, user, problem, version, url) {
 const {courseId,chapterId} = tutorialContext(url);
 // A chapter teaches the problem across revisions. Its text is read from
 // the published course while both version references retain their access checks.
 const {rows} = await db.query(`SELECT p.id AS course_id,p.title AS course_title,c.id AS chapter_id,
  c.title,c.content FROM chapter_problems link
  JOIN learning_chapters c ON c.id=link.chapter_id AND c.archived_at IS NULL
  JOIN learning_paths p ON p.id=c.path_id AND p.published_at IS NOT NULL AND p.archived_at IS NULL
  JOIN problem_versions v ON v.id=link.version_id AND v.problem_id=link.problem_id
  JOIN problem_versions requested ON requested.id=$2 AND requested.problem_id=link.problem_id
   AND requested.published_at IS NOT NULL AND requested.school_visible_at IS NOT NULL AND requested.rank_review_status='approved'
  JOIN problem_banks b ON b.id=$5 AND b.visibility='school' AND b.archived_at IS NULL
  WHERE link.problem_id=$1 AND v.published_at IS NOT NULL
   AND v.school_visible_at IS NOT NULL AND v.rank_review_status='approved' AND btrim(c.content)<>''
  ORDER BY (p.id=$3 AND c.id=$4) DESC NULLS LAST,(link.version_id=$2) DESC,p.id,c.position,c.id`,
 [problem.id,version.id,courseId,chapterId,problem.bank_id]);
 const readable = await readableCourseIds(db,user,[...new Set(rows.map(row=>row.course_id))]);
 const chapter = rows.find(row=>readable.has(row.course_id) && row.content.trim());
 return chapter ? { source:'course', courseTitle:chapter.course_title, title:chapter.title, body:chapter.content } : null;
}

export async function handleProblemTutorial({pool,user,route,method,body,url,helpers}) {
 const match = route.match(/^\/problems\/([^/]+)\/tutorial$/);
 if (!match || !['GET','PATCH'].includes(method)) return null;
 const manage = method === 'PATCH' || url.searchParams.get('manage') === 'true';
 if (manage && !user.roles.some(role=>role==='admin'||role==='teacher')) fail(403,'FORBIDDEN','需要教师权限');
 return transaction(pool,async db=>{
  const {p,v,permissions} = await helpers.versionAccess(db,user,match[1],manage ? null : url.searchParams.get('versionId'));
  if (manage) {
   if (!await canManageLegacyTutorial(db,user,p,permissions.canEdit)) fail(403,'FORBIDDEN','无权编辑此题的教程');
   return reply(method === 'GET' ? tutorialSettings(p) : await saveTutorial(db,p,body,
    metadata=>helpers.audit(db,user.id,'problem.tutorial_update','problem',p.id,metadata)));
  }
  if (!v.published_at || p.archived_at) return reply({tutorial:null});
  const tutorial = p.tutorial_mode === 'course' ? await legacyCourseTutorial(db,user,p,v,url) : customTutorial(p);
  return reply({tutorial});
 });
}
