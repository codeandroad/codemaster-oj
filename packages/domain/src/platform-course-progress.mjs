import { LEGACY_SCHOOL_ID } from './schools.mjs';
import { availableLegacyPublicProblemVersions } from './legacy-public-problems.mjs';
import { loadCoursePaper4, paper4Progress } from './course-paper4.mjs';
import { latestCourseProblemVersion } from './course-problem-version.mjs';

async function schoolScope(db,schoolId,fn) {
 const previous=(await db.query("SELECT current_setting('campus.school_id',true) school")).rows[0].school??'';
 let failed=false;
 try {await db.query("SELECT set_config('campus.school_id',$1,true)",[schoolId]);return await fn();}
 catch(error){failed=true;throw error;}
 finally {try{await db.query("SELECT set_config('campus.school_id',$1,true)",[previous]);}catch(error){if(!failed)throw error;}}
}

export async function platformAdmissionPoints(db,user,schoolId=null) {
 if(!schoolId){const row=(await db.query('SELECT solved*10 AS points FROM public_practice_leaderboard($1,1,1) WHERE is_own',[user.id])).rows[0];return {source:'public',current:Number(row?.points??0)};}
 const row=await schoolScope(db,schoolId,async()=>schoolId===LEGACY_SCHOOL_ID
  ?(await db.query(`SELECT ((SELECT COALESCE(sum(points),0) FROM school_rank_ledger WHERE identity_id=$1)
    +(SELECT COALESCE(sum(points),0) FROM paper4_rank_ledger WHERE identity_id=$1)
    +(SELECT COALESCE(sum(points),0) FROM acsl_point_awards WHERE school_id=$2 AND identity_id=$1))::integer points`,[user.identityId,schoolId])).rows[0]
  :(await db.query(`SELECT COALESCE(sum(a.points),0)::integer points FROM school_rank_awards a
    JOIN school_identities i ON i.school_id=a.school_id AND i.id=a.identity_id
    WHERE a.school_id=$1 AND i.account_id=$2 AND i.kind='student' AND i.archived_at IS NULL`,[schoolId,user.id])).rows[0]);
 return {source:'school',schoolId,current:Number(row?.points??0)};
}

export const unavailablePrerequisite=courseId=>({courseId,available:false,completed:false,canOpen:false,requiresAdmission:false,readChapters:0,totalChapters:0,completedExercises:0,totalExercises:0});

// Match the ordinary legacy learning page's current published exercise and
// credit rules. This is used only in an actual legacy-school membership
// context; a platform course never grants access to a school's private bank.
async function legacyChapterProblems(db,course,user,chapterIds) {
 if(!chapterIds.length)return new Map();
 const rows=(await db.query(`SELECT cp.problem_id,cp.version_id,EXISTS(
  SELECT 1 FROM submissions s WHERE s.identity_id=$2 AND s.problem_id=cp.problem_id
   AND s.kind IN ('submit','correction') AND s.status='AC'
   AND (s.timed_attempt_id IS NULL OR EXISTS(SELECT 1 FROM timed_attempts ta
    JOIN timed_practices tp ON tp.id=ta.practice_id WHERE ta.id=s.timed_attempt_id AND tp.results_published_at IS NOT NULL))
   AND course_language_allows_credit($3,$4,s.language,s.created_at)
   AND (s.version_id=cp.version_id OR EXISTS(SELECT 1 FROM problem_versions attempted
    WHERE attempted.id=s.version_id AND attempted.problem_id=cp.problem_id
     AND attempted.published_at>=linked.published_at AND attempted.rank_approved_at IS NOT NULL))) solved
  FROM chapter_problems cp JOIN problems p ON p.id=cp.problem_id
  JOIN problem_banks b ON b.id=p.bank_id
  JOIN problem_versions linked ON linked.id=cp.version_id AND linked.problem_id=cp.problem_id
  ${latestCourseProblemVersion} true JOIN problem_versions v ON v.id=COALESCE(latest.id,linked.id)
  WHERE cp.chapter_id=ANY($1::uuid[]) AND p.archived_at IS NULL AND b.archived_at IS NULL
   AND b.visibility='school' AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL
   AND v.rank_review_status='approved'`,[chapterIds,user.identityId,course.required_language,course.language_credit_cutoffs])).rows;
 return new Map(rows.map(row=>[`${row.problem_id}:${row.version_id}`,row]));
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
  const legacyAllowed=course.school_id===LEGACY_SCHOOL_ID&&schoolIds.includes(LEGACY_SCHOOL_ID)&&contexts.includes(LEGACY_SCHOOL_ID);
  const legacy=legacyAllowed?await legacyChapterProblems(db,course,user,chapters.map(c=>c.id)):new Map();
  const acslLinks=chapters.flatMap(c=>c.acsl_links??[]);
  const {projectCourseAcslLinks}=acslLinks.length?await import('./course-acsl.mjs'):{};
  const paper4Count=Number((await db.query(`SELECT count(*) n FROM chapter_paper4_links l JOIN learning_chapters c ON c.id=l.chapter_id WHERE c.path_id=$1 AND c.archived_at IS NULL`,[course.id])).rows[0].n);
  const paper4=paper4Count&&legacyAllowed?await loadCoursePaper4(db,[course.id],[user.identityId]):null;
  let best=null;
  // Evaluate the whole prerequisite in one lawful school context, with public
  // practice credit usable in each. Never combine ordinary, ACSL or Paper 4
  // achievements from different school contexts into an artificial pass.
  for(const context of contexts){
   const current={available:chapters.length>0,totalExercises:configured.length+acslLinks.length,completedExercises:0};
   for(const link of configured){
    const key=`${link.problemId}:${link.versionId}`,publicProblem=problems.get(key),schoolProblem=context===LEGACY_SCHOOL_ID?legacy.get(key):null;
    if(!publicProblem&&!schoolProblem)current.available=false;
    else if(publicProblem?.solved||schoolProblem?.solved)current.completedExercises++;
   }
   if(acslLinks.length){
    const projected=context?await projectCourseAcslLinks(db,context,user,acslLinks):[];
    if(projected.length!==acslLinks.length||projected.some(link=>!link.available))current.available=false;
    current.completedExercises+=projected.filter(link=>link.available&&link.completed).length;
   }
   if(paper4Count){
    if(context!==LEGACY_SCHOOL_ID||!paper4){current.available=false;current.totalExercises+=paper4Count;}
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
  const links = course.chapters.flatMap(chapter => chapter.problems ?? []);
  const problems = new Map();
  if (!links.length) return problems;

  const { rows } = await db.query(`WITH links AS (
    SELECT DISTINCT "problemId","versionId"
    FROM jsonb_to_recordset($2::jsonb) AS link("problemId" uuid,"versionId" uuid)
  )
  SELECT links.*,v.definition->>'title' AS title, EXISTS (
    SELECT 1 FROM school_judge_jobs j WHERE j.school_id=p.school_id
      AND j.problem_id=p.id AND j.version_id=v.id AND j.account_id=$3
      AND j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL
      AND j.state='completed' AND j.result->>'status'='AC'
      AND course_language_allows_credit($4,$5,j.payload->>'language',j.created_at)
  ) AS solved
  FROM links
  JOIN school_problem_publications pub ON pub.school_id=$1 AND pub.problem_id=links."problemId"
    AND pub.version_id=links."versionId" AND pub.withdrawn_at IS NULL
  JOIN school_problems p ON p.school_id=pub.school_id AND p.id=pub.problem_id
    AND p.published AND p.published_version_id=pub.version_id
  JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id AND NOT b.archived
  JOIN school_problem_versions v ON v.school_id=p.school_id AND v.problem_id=p.id AND v.id=pub.version_id`,
  [listing.school_id, JSON.stringify(links), accountId, course.required_language, course.language_credit_cutoffs]);
  const legacyVersions = listing.school_id === LEGACY_SCHOOL_ID && rows.length
    ? await availableLegacyPublicProblemVersions(db, rows.map(row => row.versionId))
    : null;
  for (const row of rows) {
    if (!legacyVersions || legacyVersions.has(row.versionId)) {
      problems.set(`${row.problemId}:${row.versionId}`, row);
    }
  }
  return problems;
}

