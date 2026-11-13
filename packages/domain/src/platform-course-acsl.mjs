import { canEditPlatformContent } from './platform-content-access.mjs';
import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { normalizeCourseAcslLinks } from './course-acsl.mjs';
import { fail } from './security.mjs';

// Authoring checks read only source metadata. They never borrow a school role,
// calculate a learner's grade or weaken the student ACSL access boundary.
async function sourceContext(db, user, fn, courseId=null) {
 const run=async client=>{
  await activeAccount(client,user.id);
  if(!await isPlatformAdministrator(client,user.id)&&!(courseId&&await canEditPlatformContent(client,user.id,'course',courseId)))fail(403,'PLATFORM_ADMIN_REQUIRED','需要平台管理员权限');
  await lockSchoolTeaching(client,LEGACY_SCHOOL_ID,{shared:true});
  const previous=(await client.query("SELECT current_setting('campus.school_id',true) AS school")).rows[0].school??'';
  let failed=false;
  try {
   await client.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);
   return await fn(client);
  } catch(error) { failed=true;throw error; }
  finally {
   // A failed SQL statement has already aborted the transaction; preserve its
   // original error instead of masking it with the context-reset failure.
   try { await client.query("SELECT set_config('campus.school_id',$1,true)",[previous]); }
   catch(error) { if(!failed)throw error; }
  }
 };
 return typeof db.release==='function'?run(db):transaction(db,run);
}

async function papers(db,slugs=null) {
 return (await db.query(`SELECT id,slug,version_id,enabled,programming_problem_id,
  definition->'title' AS title,definition->>'division' AS division,definition->>'season' AS season,
  (definition->>'round')::integer AS round,COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',q->>'id','number',q->'number','topic',q->'topic')) FROM jsonb_array_elements(definition->'questions') q),'[]'::jsonb) AS questions
  FROM acsl_papers WHERE school_id=$1 AND ($2::text[] IS NULL OR slug=ANY($2)) ORDER BY slug`,[LEGACY_SCHOOL_ID,slugs])).rows;
}
const same=(a,b)=>a.paperSlug===b.paperSlug&&a.kind===b.kind&&a.questionId===b.questionId;
const available=(paper,link,versionId)=>paper?.enabled&&(!versionId||paper.version_id===versionId)
 &&(link.kind!=='programming'||Boolean(paper.programming_problem_id))
 &&(link.kind!=='question'||paper.questions.some(question=>question.id===link.questionId));

export async function resolvePlatformCourseAcslLinks(db,user,value,previous=[],courseId=null) {
 const input=normalizeCourseAcslLinks(value);
 return sourceContext(db,user,async client=>{
  if(!input.length)return [];
  const bySlug=new Map((await papers(client,[...new Set(input.map(link=>link.paperSlug))])).map(paper=>[paper.slug,paper]));
  return input.map(link=>{
   const old=previous.find(item=>same(item,link)),versionId=link.versionId??old?.versionId;
   const paper=bySlug.get(link.paperSlug);
   if(!available(paper,link,versionId)){
    // Existing broken references can be inspected and repaired without being
    // silently rebound. Publication still rejects them below.
    if(old&&versionId===old.versionId)return {...link,versionId:old.versionId};
    fail(409,'UNAVAILABLE_ACSL_LINK','ACSL 引用须为启用的来源试卷及有效题目版本。');
   }
   return {...link,versionId:versionId??paper.version_id};
  });
 },courseId);
}

export async function assertPlatformCourseAcslLinksReady(db,user,value,courseId=null) {
 return sourceContext(db,user,async client=>{
  if(!value.length)return;
  const bySlug=new Map((await papers(client,[...new Set(value.map(link=>link.paperSlug))])).map(paper=>[paper.slug,paper]));
  if(value.some(link=>!link.versionId||!available(bySlug.get(link.paperSlug),link,link.versionId)))
   fail(409,'UNAVAILABLE_ACSL_LINK','请修复不可用的 ACSL 引用');
 },courseId);
}

export async function platformCourseAcslPicker(db,user,courseId=null) {
 return sourceContext(db,user,async client=>({items:(await papers(client)).filter(paper=>paper.enabled).map(paper=>({
  paperId:paper.id,versionId:paper.version_id,paperSlug:paper.slug,title:paper.title,division:paper.division,
  season:paper.season,round:paper.round,hasProgramming:Boolean(paper.programming_problem_id),questions:paper.questions,
 }))}),courseId);
}
