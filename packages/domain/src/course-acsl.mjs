import { transaction } from './db.mjs';
import { LEGACY_SCHOOL_ID, schoolRole } from './schools.mjs';
import { fail, field, uuid } from './security.mjs';
import { readableCourseIds } from './course-access.mjs';
import { platformCourseAudienceSql } from './platform-course-access.mjs';
import { legacyCourseIsLive } from './legacy-public-course.mjs';

export function normalizeCourseAcslLinks(value = []) {
  if (!Array.isArray(value) || value.length > 100) fail(400, 'INVALID_ACSL_LINK', '每章最多关联 100 项 ACSL 练习。');
  const seen = new Set();
  return value.map(link => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) fail(400, 'INVALID_ACSL_LINK', 'ACSL 引用无效。');
    const paperSlug = field(link.paperSlug, 'ACSL 试卷标识', { max: 150 });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(paperSlug) || !['question','written','programming'].includes(link.kind)) fail(400, 'INVALID_ACSL_LINK', 'ACSL 引用类型或试卷标识无效。');
    const questionId = link.kind === 'question' ? field(link.questionId, 'ACSL 题号', { max: 100 }) : undefined;
    if (questionId && !/^[A-Za-z0-9_-]+$/.test(questionId) || link.kind !== 'question' && link.questionId != null) fail(400, 'INVALID_ACSL_LINK', 'ACSL 题号无效。');
    const key = `${paperSlug}:${link.kind}:${questionId ?? ''}`;
    if (seen.has(key)) fail(400, 'INVALID_ACSL_LINK', '章节 ACSL 引用不能重复。');
    seen.add(key);
    return { paperSlug, kind: link.kind, ...(questionId ? { questionId } : {}), ...(link.versionId ? { versionId: uuid(link.versionId, 'ACSL 版本') } : {}) };
  });
}
const same = (a,b) => a.paperSlug === b.paperSlug && a.kind === b.kind && a.questionId === b.questionId;
const unavailable = (link, reason) => ({ ...link, available: false, reason, status: 'unavailable', completed: false });
const run = (db, fn) => typeof db.release === 'function' ? fn(db) : transaction(db, fn);
async function context(db, schoolId, user, fn, { optional = false } = {}) {
  return run(db, async client => {
    const previous = (await client.query("SELECT current_setting('campus.school_id',true) AS school")).rows[0].school ?? '';
    try {
      const { requireAcslCourseAccess } = await import('./acsl.mjs');
      try { await requireAcslCourseAccess(client, schoolId, user); }
      catch (error) { if (optional && [401,403,404].includes(error.status)) return null; throw error; }
      return await fn(client);
    } finally { await client.query("SELECT set_config('campus.school_id',$1,true)", [previous]); }
  });
}

// Explicit school context in a public course is a real membership check, not
// permission inherited from the course's publishing source or audience.
export const requireCourseAcslSchool = (db,schoolId,user) => context(db,schoolId,user,async()=>schoolId);

export async function resolveCourseAcslLinks(db, schoolId, user, value, previous = []) {
  const input = normalizeCourseAcslLinks(value);
  if (!input.length) return [];
  return context(db, schoolId, user, async client => {
    const output = [];
    for (const link of input) {
      const old = previous.find(item => same(item, link));
      const versionId = link.versionId ?? old?.versionId;
      const paper = (await client.query('SELECT id,version_id,enabled,definition,programming_problem_id FROM acsl_papers WHERE school_id=$1 AND slug=$2', [schoolId,link.paperSlug])).rows[0];
      const unchanged = old && (!versionId || versionId === old.versionId);
      if (!paper || !paper.enabled || versionId && versionId !== paper.version_id || link.kind === 'programming' && !paper.programming_problem_id
        || link.kind === 'question' && !paper.definition.questions.some(q => q.id === link.questionId)) {
        if (unchanged) { output.push({ ...link, versionId: old.versionId }); continue; }
        fail(409, 'UNAVAILABLE_ACSL_LINK', 'ACSL 引用须为本校启用的试卷及有效题目版本。');
      }
      output.push({ ...link, versionId: versionId ?? paper.version_id });
    }
    return output;
  });
}

export function acslPracticeHref(schoolId, paperId, link) {
  const params = new URLSearchParams(schoolId === LEGACY_SCHOOL_ID ? {} : { schoolId, section: 'acsl' });
  params.set('paperId',paperId);
  if(link.versionId)params.set('paperVersionId',link.versionId);
  if (link.questionId) params.set('questionId',link.questionId);
  if (link.kind === 'programming') params.set('coding','1');
  return `${schoolId === LEGACY_SCHOOL_ID ? '/student/acsl' : '/schools'}?${params}`;
}

export async function projectCourseAcslLinks(db, schoolId, user, value = []) {
  if (!value.length) return [];
  const projected = await context(db, schoolId, user, async client => {
    const { acslCourseGrade, acslCourseCodingProgress } = await import('./acsl.mjs');
    const cache = new Map(), output = [];
    for (const link of value) {
      if (!cache.has(link.paperSlug)) {
        const paper = (await client.query('SELECT * FROM acsl_papers WHERE school_id=$1 AND slug=$2', [schoolId,link.paperSlug])).rows[0];
        cache.set(link.paperSlug, paper ? { paper, grade: paper.enabled ? await acslCourseGrade(client,paper,user.id) : null } : null);
      }
      const entry = cache.get(link.paperSlug), paper = entry?.paper;
      if (!paper?.enabled) { output.push(unavailable(link,'paper_unavailable')); continue; }
      if (paper.version_id !== link.versionId) { output.push(unavailable(link,'version_changed')); continue; }
      const question = (entry.grade?.questionSnapshot ?? paper.definition.questions).find(q => q.id === link.questionId);
      if (link.kind === 'question' && !question || link.kind === 'programming' && !paper.programming_problem_id) { output.push(unavailable(link,'section_unavailable')); continue; }
      const base = { ...link, paperId: paper.id, title: paper.definition.title, ...(question ? { questionNumber: question.number } : {}), available: true,
        href: acslPracticeHref(schoolId,paper.id,link), status: 'not_started', completed: false };
      if (link.kind === 'programming') {
        entry.coding ??= await acslCourseCodingProgress(client,paper,user.id);
        base.status = entry.coding.solved ? 'accepted' : entry.coding.attempts ? 'submitted' : 'not_started'; base.completed = entry.coding.solved;
      } else if (entry.grade) {
        const correct = link.kind === 'written' || entry.grade.answers.find(answer => answer.questionId === link.questionId)?.correct === true;
        base.status = link.kind === 'question' && correct ? 'accepted' : 'submitted'; base.completed = correct;
        base.historical = Boolean(entry.grade.writtenRevision && entry.grade.writtenRevision !== (paper.written_revision ?? paper.version_id));
      } else {
        const rows = (await client.query(`SELECT selected_option_ids,updated_at FROM acsl_drafts
          WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND account_id=$4 AND ($5::text IS NULL OR question_id=$5)`,
          [schoolId,paper.id,paper.version_id,user.id,link.questionId ?? null])).rows;
        if (rows.some(row => row.selected_option_ids.length)) base.status = 'draft';
      }
      output.push(base);
    }
    return output;
  }, { optional: true });
  return projected ?? value.map(link => unavailable(link,'school_access_required'));
}

export async function legacyCourseAcsl(db, pathIds, user) {
  if (!pathIds.length) return {chapters:new Map(),paths:new Map()};
  const rows = (await db.query('SELECT id,path_id,acsl_links FROM learning_chapters WHERE path_id=ANY($1::uuid[]) AND archived_at IS NULL', [pathIds])).rows;
  const chapters = new Map(), paths = new Map();
  const projected = await projectCourseAcslLinks(db,LEGACY_SCHOOL_ID,user,rows.flatMap(row=>row.acsl_links??[]));
  let offset = 0;
  for (const row of rows) {
    const links = projected.slice(offset,offset+(row.acsl_links?.length??0));offset+=row.acsl_links?.length??0;chapters.set(row.id,links);
    if (!paths.has(row.path_id)) paths.set(row.path_id,new Map());
    for(const link of links) paths.get(row.path_id).set(`${link.paperSlug}:${link.versionId}:${link.kind}:${link.questionId??''}`,link);
  }
  return {chapters,paths:new Map([...paths].map(([id,links])=>[id,[...links.values()]]))};
}
export const acslLinkCounts = links => ({ total: links.filter(link => link.available).length, completed: links.filter(link => link.available && link.completed).length });

const courseHref=(schoolId,courseId,chapterId)=>schoolId===LEGACY_SCHOOL_ID
 ?`/student/learning-paths/${courseId}/chapters/${chapterId}`
 :`/practice/courses/${courseId}?${new URLSearchParams({chapterId,schoolId})}`;

async function platformAcslCourses(db,user) {
 return (await db.query(`SELECT p.id,p.title,p.description,p.localizations FROM learning_paths p
  WHERE p.owner_scope='platform' AND (${legacyCourseIsLive}) AND ${platformCourseAudienceSql('p','$1')}
  AND EXISTS(SELECT 1 FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL AND jsonb_array_length(c.acsl_links)>0)
  ORDER BY p.title,p.id`,[user.id])).rows;
}

// The ACSL directory is already in an authorized school transaction. Reuse its
// shallow catalogue and only retrieve question IDs/correctness, never statements,
// answer keys, explanations or generated programming test vectors.
export async function acslLearningCourses(db,schoolId,user,catalog) {
 const courses=await platformAcslCourses(db,user);
 if(!courses.length||!catalog.length)return [];
 const papers=new Map(catalog.map(paper=>[paper.slug,paper]));
 const questionIds=new Map((await db.query(`SELECT p.id,ARRAY(SELECT q->>'id' FROM jsonb_array_elements(p.definition->'questions') q) AS question_ids
  FROM acsl_papers p WHERE p.school_id=$1 AND p.enabled`,[schoolId])).rows.map(row=>[row.id,new Set(row.question_ids)]));
 const correct=new Map((await db.query(`SELECT paper_id,version_id,ARRAY(SELECT answer->>'questionId'
  FROM jsonb_array_elements(answers) answer WHERE answer->>'correct'='true') AS question_ids
  FROM acsl_paper_grades WHERE school_id=$1 AND account_id=$2`,[schoolId,user.id])).rows.map(row=>[`${row.paper_id}:${row.version_id}`,new Set(row.question_ids)]));
 const chapters=(await db.query(`SELECT c.id,c.path_id,c.acsl_links,COALESCE(pr.completed,false) AS completed
  FROM learning_chapters c LEFT JOIN learning_progress pr ON pr.chapter_id=c.id
   AND pr.identity_id=(SELECT identity_id FROM accounts WHERE id=$2)
  WHERE c.path_id=ANY($1::uuid[]) AND c.archived_at IS NULL ORDER BY c.position,c.created_at,c.id`,[courses.map(course=>course.id),user.id])).rows;
 const output=[];
 for(const course of courses){
  const lessons=chapters.filter(chapter=>chapter.path_id===course.id);
  let totalExercises=0,completedExercises=0;
  for(const chapter of lessons)for(const link of chapter.acsl_links){
   const paper=papers.get(link.paperSlug);
   if(!paper||paper.versionId!==link.versionId
     ||link.kind==='question'&&!questionIds.get(paper.id)?.has(link.questionId)
     ||link.kind==='programming'&&!paper.hasProgramming)continue;
   totalExercises++;
   if(link.kind==='programming'?paper.programmingSolved:link.kind==='written'?paper.graded:correct.get(`${paper.id}:${paper.versionId}`)?.has(link.questionId))completedExercises++;
  }
  if(!totalExercises)continue;
  const nextLesson=lessons.find(chapter=>!chapter.completed)??lessons[0];
  output.push({courseId:course.id,href:courseHref(schoolId,course.id,nextLesson.id),title:course.title,description:course.description,
   ...(course.localizations?{localizations:course.localizations}:{}),ownerScope:'platform',sourceSchool:'平台管理员',
   chapterCount:lessons.length,completedChapters:lessons.filter(chapter=>chapter.completed).length,totalExercises,completedExercises});
 }
 return output;
}

export async function courseAcslPicker(db, schoolId, user) {
  return context(db,schoolId,user,async client => {
    if (schoolId === LEGACY_SCHOOL_ID) {
      if (!(await client.query("SELECT 1 FROM account_roles WHERE account_id=$1 AND role IN ('teacher','admin')",[user.id])).rowCount) fail(403,'FORBIDDEN','需要本校教师权限。');
    } else if (!['teacher','school_admin'].includes(await schoolRole(client,schoolId,user.id))) fail(403,'FORBIDDEN','需要本校教师权限。');
    const rows = (await client.query('SELECT id,version_id,slug,definition,programming_problem_id FROM acsl_papers WHERE school_id=$1 AND enabled ORDER BY slug',[schoolId])).rows;
    return { items: rows.map(p => ({ paperId:p.id,versionId:p.version_id,paperSlug:p.slug,title:p.definition.title,division:p.definition.division,season:p.definition.season,round:p.definition.round,
      hasProgramming:!!p.programming_problem_id,questions:p.definition.questions.map(q=>({id:q.id,number:q.number,topic:q.topic})) })) };
  });
}

export async function acslLearningLinks(db, schoolId, paper, user) {
  const output = [];
  const add = (course, chapter, title, description) => {
    const links = (chapter.acslLinks ?? chapter.acsl_links ?? []).filter(item => item.paperSlug === paper.slug && item.versionId === paper.version_id);
    if (!links.length) return;
    const courseLocale = course.localizations ?? course.properties?.localizations, chapterLocale = chapter.localizations;
    const params = new URLSearchParams({schoolId,section:'courses',courseId:course.id,chapterId:chapter.id});
    output.push({courseId:course.id,chapterId:chapter.id,title,chapterTitle:chapter.title,
      questionIds:[...new Set(links.filter(link=>link.kind==='question').map(link=>link.questionId))],written:links.some(link=>link.kind==='written'),programming:links.some(link=>link.kind==='programming'),
      ...(courseLocale || chapterLocale ? {localizations:Object.fromEntries(['en','zh'].map(language=>[language,{title:courseLocale?.[language]?.title??title,chapterTitle:chapterLocale?.[language]?.title??chapter.title}]))}:{}),
      href:schoolId===LEGACY_SCHOOL_ID?courseHref(schoolId,course.id,chapter.id):course.ownerScope==='platform'?courseHref(schoolId,course.id,chapter.id):`/schools?${params}`});
  };
  if (schoolId === LEGACY_SCHOOL_ID) {
    const courses = (await db.query(`SELECT p.* FROM learning_paths p WHERE p.published_at IS NOT NULL AND p.archived_at IS NULL
      AND (p.owner_scope<>'platform' OR p.listed AND p.withdrawn_at IS NULL)
      AND EXISTS(SELECT 1 FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL AND c.acsl_links @> $1::jsonb)`,[JSON.stringify([{paperSlug:paper.slug,versionId:paper.version_id}])])).rows;
    const allowed = await readableCourseIds(db,user,courses.map(c=>c.id));
    for (const course of courses.filter(c=>allowed.has(c.id))) {
      for (const chapter of (await db.query('SELECT * FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL ORDER BY position',[course.id])).rows) add(course,chapter,course.title);
    }
  } else {
    const role = await schoolRole(db,schoolId,user.id);
    const { loadSchoolCourse } = await import('./school-courses.mjs');
    const courses = (await db.query(`SELECT c.id FROM school_courses c JOIN school_course_publications p ON p.school_id=c.school_id AND p.course_id=c.id AND p.revision=c.published_revision
      WHERE c.school_id=$1 AND c.published AND c.archived_at IS NULL AND p.chapters @? '$[*].acslLinks[*]'`,[schoolId])).rows;
    for (const course of courses) {
      let loaded; try { loaded=await loadSchoolCourse(db,schoolId,course.id,user,role,{publishedOnly:true}); }
      catch(error){if([403,404].includes(error.status))continue;throw error;}
      for(const chapter of loaded.view.chapters)add({...loaded.view,id:course.id},chapter,loaded.view.title);
    }
    for(const course of await platformAcslCourses(db,user)){
      const chapters=(await db.query(`SELECT id,title,localizations,acsl_links FROM learning_chapters
        WHERE path_id=$1 AND archived_at IS NULL AND acsl_links @> $2::jsonb ORDER BY position,created_at,id`,
      [course.id,JSON.stringify([{paperSlug:paper.slug,versionId:paper.version_id}])])).rows;
      for(const chapter of chapters)add({...course,ownerScope:'platform'},chapter,course.title);
    }
  }
  return output;
}
