import { platformChapterProblems } from './platform-course-problems.mjs';
import { currentCatalogPublicProblems } from './catalog-problem-publication.mjs';
import { problemSolvedSql } from './problem-progress.mjs';
import { loadCoursePaper4, paper4Progress } from './course-paper4.mjs';

async function schoolScope(db,schoolId,fn) {
 const previous=(await db.query("SELECT current_setting('campus.school_id',true) school")).rows[0].school??'';
 let failed=false;
 try {await db.query("SELECT set_config('campus.school_id',$1,true)",[schoolId]);return await fn();}
 catch(error){failed=true;throw error;}
 finally {try{await db.query("SELECT set_config('campus.school_id',$1,true)",[previous]);}catch(error){if(!failed)throw error;}}
}

export const unavailablePrerequisite=courseId=>({courseId,available:false,completed:false,canOpen:false,requiresAdmission:false,readChapters:0,totalChapters:0,completedExercises:0,totalExercises:0});

async function schoolChapterProblems(db,schoolId,course,user,chapterIds) {
 return schoolScope(db,schoolId,async()=>{
  const rows=(await db.query(`SELECT cp.problem_id,cp.version_id,
   ${problemSolvedSql({problemId:'cp.problem_id',accountId:'$2',requiredLanguage:'$3',languageCreditCutoffs:'$4'})} solved
   FROM chapter_problems cp JOIN school_problems p ON p.id=cp.problem_id AND p.school_id=$5 AND p.published
   JOIN school_problem_banks b ON (b.school_id,b.id)=(p.school_id,p.bank_id) AND b.resource_kind='ordinary' AND NOT b.archived
   JOIN school_problem_versions linked ON (linked.school_id,linked.problem_id,linked.id)=(p.school_id,p.id,cp.version_id)
   WHERE cp.chapter_id=ANY($1::uuid[])`,[chapterIds,user.id,course.required_language,course.language_credit_cutoffs,schoolId])).rows;
  return new Map(rows.map(row=>[`${row.problem_id}:${row.version_id}`,row]));
 });
}

// No course admission calls here: the resolver checks the prerequisite's own
// current access before requesting these pure statistics, preventing recursion.
export async function platformPrerequisiteProgress(db,course,user,{schoolId=null,schoolIds=[]}={}) {
 return schoolScope(db,course.school_id,async()=>{
  const chapters=(await db.query(`SELECT c.id,c.acsl_links,COALESCE(pr.completed,false) AS read,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('problemId',cp.problem_id,'versionId',cp.version_id)) FROM chapter_problems cp WHERE cp.chapter_id=c.id),'[]'::jsonb) problems
   FROM learning_chapters c LEFT JOIN learning_progress pr ON pr.chapter_id=c.id AND pr.identity_id=$2
   WHERE c.path_id=$1 AND c.archived_at IS NULL ORDER BY c.position,c.id`,[course.id,user.identityId])).rows;
  const output={courseId:course.id,title:course.title,available:chapters.length>0,completed:false,canOpen:true,requiresAdmission:false,
   readChapters:chapters.filter(c=>c.read).length,totalChapters:chapters.length,totalExercises:0,completedExercises:0};
  const configured=chapters.flatMap(c=>c.problems),problems=await publicChapterProblems(db,{school_id:course.school_id},{...course,chapters},user.id);
  const contexts=schoolId?[schoolId]:[null,...schoolIds];
  const acslLinks=chapters.flatMap(c=>c.acsl_links??[]);
  const {projectCourseAcslLinks}=acslLinks.length?await import('./course-acsl.mjs'):{};
  const paper4Count=Number((await db.query(`SELECT count(*) n FROM chapter_paper4_links l JOIN learning_chapters c ON c.id=l.chapter_id WHERE c.path_id=$1 AND c.archived_at IS NULL`,[course.id])).rows[0].n);
  const paper4=paper4Count&&schoolIds.includes(course.school_id)?await loadCoursePaper4(db,[course.id],[user.identityId]):null;
  let best=null;
  // Evaluate the whole prerequisite in one lawful school context, with public
  // practice credit usable in each. Never combine ordinary, ACSL or Paper 4
  // achievements from different school contexts into an artificial pass.
  for(const context of contexts){
   const schoolProblems=context&&schoolIds.includes(context)?await schoolChapterProblems(db,context,course,user,chapters.map(c=>c.id)):new Map();
   const current={available:chapters.length>0,totalExercises:configured.length+acslLinks.length,completedExercises:0};
   for(const link of configured){
    const key=`${link.problemId}:${link.versionId}`,publicProblem=problems.get(key),schoolProblem=schoolProblems.get(key);
    if(!publicProblem&&!schoolProblem)current.available=false;
    else if(publicProblem?.solved||schoolProblem?.solved)current.completedExercises++;
   }
   if(acslLinks.length){
    const projected=context?await projectCourseAcslLinks(db,context,user,acslLinks):[];
    if(projected.length!==acslLinks.length||projected.some(link=>!link.available))current.available=false;
    current.completedExercises+=projected.filter(link=>link.available&&link.completed).length;
   }
   if(paper4Count){
    if(context!==course.school_id||!paper4){current.available=false;current.totalExercises+=paper4Count;}
    else{
     const progress=paper4Progress(paper4,'path',course.id,user.identityId);
     const unavailable=paper4.rows.filter(row=>!row.available).length+(paper4Count-paper4.rows.length);
     current.totalExercises+=progress.taskCount+unavailable;current.completedExercises+=progress.completedTasks;
     if(unavailable)current.available=false;
    }
   }
   if(!best||current.available&&!best.available||current.available===best.available&&current.completedExercises>best.completedExercises)best=current;
   if(best.available&&best.completedExercises===best.totalExercises)break;
  }
  Object.assign(output,best);
  output.completed=output.available&&output.totalChapters>0&&output.readChapters===output.totalChapters&&output.completedExercises===output.totalExercises;
  return output;
 });
}

export async function publicChapterProblems(db, listing, course, accountId) {
  const platformProblems=listing.platform_owned||course.owner_scope==='platform'?await platformChapterProblems(db,course,accountId):new Map();
  const links = course.chapters.flatMap(chapter => chapter.problems ?? []);
  const problems = new Map(platformProblems);
  if (!links.length) return problems;

  const { rows } = await db.query(`WITH links AS (
    SELECT DISTINCT "problemId","versionId"
    FROM jsonb_to_recordset($2::jsonb) AS link("problemId" uuid,"versionId" uuid)
  )
  SELECT b.resource_kind,links."problemId",links."versionId" AS "linkedVersionId",v.id AS "versionId",v.definition->>'title' AS title,
   ${problemSolvedSql({problemId:'p.id',accountId:'$3',requiredLanguage:'$4',languageCreditCutoffs:'$5'})} solved
  FROM links
  JOIN school_problem_publications pub ON pub.school_id=$1 AND pub.problem_id=links."problemId" AND pub.withdrawn_at IS NULL
  JOIN school_problems p ON p.school_id=pub.school_id AND p.id=pub.problem_id AND p.published
  JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id AND NOT b.archived
  JOIN school_problem_versions v ON v.school_id=p.school_id AND v.problem_id=p.id AND v.id=p.published_version_id`,
  [listing.school_id, JSON.stringify(links), accountId, course.required_language, course.language_credit_cutoffs]);
  const catalogIds=rows.filter(row=>row.resource_kind==='publication').map(row=>row.problemId);
  const sources=new Map((catalogIds.length?await currentCatalogPublicProblems(db,catalogIds):[]).map(row=>[row.problem_id,row]));
  for (const {resource_kind,linkedVersionId,...row} of rows) {
    const schoolProblems=context&&schoolIds.includes(context)?await schoolChapterProblems(db,context,course,user,chapters.map(c=>c.id)):new Map();
   const current=sources.get(row.problemId);
    if (resource_kind==='publication'&&!current) continue;
    const key=`${row.problemId}:${linkedVersionId}`;
    problems.set(key, {...row,...(current?{versionId:current.id,title:current.title}:{}),solved:row.solved||problems.get(key)?.solved||false});
  }
  return problems;
}
