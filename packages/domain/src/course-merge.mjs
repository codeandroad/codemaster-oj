import { transaction } from './db.mjs';
import { fail, field, integer, uuid, canonicalHash } from './security.mjs';
import { LEGACY_SCHOOL_ID } from './schools.mjs';
import { courseLocalizations } from './course-localizations.mjs';
import { courseSections } from './course-sections.mjs';

export async function canonicalMergedCourseId(db, value) {
 const id=uuid(value);
 const row=(await db.query('SELECT merged_into_id FROM learning_paths WHERE id=$1',[id])).rows[0];
 return row?.merged_into_id??id;
}
const conflict=message=>fail(409,'COURSE_MERGE_CONFLICT',message);
export function courseMergeInput(targetId, body) {
 if(!body||typeof body.dryRun!=='boolean')fail(400,'VALIDATION','请明确选择预览或执行合并。');
 if(!Array.isArray(body.courses)||body.courses.length<2||body.courses.length>100)fail(400,'VALIDATION','请选择 2–100 门草稿课程。');
 const sections=courseSections(body.course?.sections);
 const courses=body.courses.map(item=>({courseId:uuid(item?.courseId),sectionKey:item?.sectionKey}));
 if(courses[0].courseId!==uuid(targetId)||new Set(courses.map(c=>c.courseId)).size!==courses.length)fail(400,'VALIDATION','保留课程须为首项，且课程不能重复。');
 if(sections.length!==courses.length||courses.some((c,i)=>c.sectionKey!==sections[i].key))fail(400,'VALIDATION','课程与专题须逐一对应并保持相同顺序。');
 const value=body.course;
 if(!value||Object.keys(value).some(key=>!['title','description','category','estimatedMinutes','localizations','sections'].includes(key)))fail(400,'VALIDATION','合并只能更新课程标题、简介、分类、时长、译文和专题。');
 const course={title:field(value.title,'课程标题',{max:200}),description:field(value.description??'','课程简介',{min:0,max:4000}),category:field(value.category,'课程分类',{max:100}),estimatedMinutes:integer(value.estimatedMinutes,1,10080,'预计时长'),localizations:courseLocalizations(value.localizations),sections};
 if(!body.dryRun&&(!body.expectedPlanHash||!/^[a-f0-9]{64}$/.test(body.expectedPlanHash)))fail(400,'VALIDATION','执行合并前须提供已核对的预览标识。');
 return {targetId:courses[0].courseId,courses,course};
}
const comparableAccess=course=>({school:course.school_id,owner:course.owner_account_id,scope:course.owner_scope,access:course.access_scope,listed:course.listed,
 from:course.available_from,to:course.available_until,language:course.required_language,cutoffs:course.language_credit_cutoffs??{},publishedLanguage:course.published_required_language??null,
 difficulty:course.difficulty,coverKey:course.cover_key});

export async function handleCourseMerge(ctx) {
 const match=ctx.route.match(/^\/learning-paths\/([^/]+)\/merge$/);
 if(!match||ctx.method!=='POST')return null;
 if(!ctx.user.roles.some(role=>role==='teacher'||role==='admin'))fail(403,'FORBIDDEN','需要教师权限。');
 const input=courseMergeInput(match[1],ctx.body),ids=input.courses.map(c=>c.courseId),requestHash=canonicalHash(input);
 return transaction(ctx.pool,async db=>{
  await db.query("SELECT set_config('campus.school_id',$1,true),set_config('campus.account_id',$2,true)",[LEGACY_SCHOOL_ID,ctx.user.id]);
  // Resource editing locks resources before courses; use the same lock order.
  await db.query('LOCK TABLE learning_resources IN SHARE ROW EXCLUSIVE MODE');
  const courses=(await db.query('SELECT * FROM learning_paths WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
  if(courses.length!==ids.length)fail(404,'NOT_FOUND','课程不存在或不可访问。');
  const target=courses.find(c=>c.id===input.targetId);
  if(!ctx.user.roles.includes('admin')&&courses.some(c=>c.owner_account_id!==ctx.user.id))fail(404,'NOT_FOUND','课程不存在或不可访问。');
  if(courses.some(c=>c.owner_scope!=='school'||c.school_id!==LEGACY_SCHOOL_ID||c.owner_account_id!==target.owner_account_id))conflict('只能合并同一学校、同一教师的草稿课程。');
  if(!ctx.body.dryRun){
   const previous=(await db.query('SELECT * FROM learning_course_merges WHERE plan_hash=$1',[ctx.body.expectedPlanHash])).rows[0];
   if(previous){
    if(previous.target_path_id!==target.id||previous.request_hash!==requestHash)conflict('预览标识与本次合并内容不一致。');
    return {status:200,body:{...previous.receipt,alreadyApplied:true}};
   }
  }
  if(courses.some(c=>c.archived_at||c.merged_into_id||c.published_at||c.withdrawn_at||c.owner_scope!=='school'||(c.practice_bundle??[]).length>0))conflict('只支持尚未发布、未归档且没有生成配套练习的课程草稿。');
  if(courses.some(c=>(c.sections??[]).length))conflict('本次整合要求来源课程尚未分组；已有专题的课程请直接编辑。');
  const access=canonicalHash(comparableAccess(target));
  if(courses.some(c=>canonicalHash(comparableAccess(c))!==access))conflict('课程准入、开放时间、语言要求或难度不一致，不能自动合并。');
  const classes=(await db.query('SELECT path_id,class_id FROM learning_path_classes WHERE path_id=ANY($1::uuid[]) ORDER BY path_id,class_id',[ids])).rows;
  const selectedClasses=id=>classes.filter(row=>row.path_id===id).map(row=>row.class_id);
  if(courses.some(c=>canonicalHash(selectedClasses(c.id))!==canonicalHash(selectedClasses(target.id))))conflict('课程关联班级不一致，不能自动扩大访问范围。');
  for(const [table,column]of [['assignments','course_path_id'],['timed_practices','course_path_id'],['legacy_course_publication_versions','course_id'],['public_course_listings','course_id']]){
   if((await db.query(`SELECT 1 FROM ${table} WHERE ${column}=ANY($1::uuid[]) LIMIT 1`,[ids])).rowCount)conflict('课程已有教学活动或公开发布历史，不能使用草稿整合。');
  }
  // Avoid creating alias chains or invalidating a prior integration receipt.
  if((await db.query('SELECT 1 FROM learning_paths WHERE merged_into_id=ANY($1::uuid[]) LIMIT 1',[ids])).rowCount)conflict('课程已经承接其他旧入口，不能再次作为整合来源。');
  const chapters=(await db.query('SELECT * FROM learning_chapters WHERE path_id=ANY($1::uuid[]) ORDER BY path_id,position,created_at,id FOR UPDATE',[ids])).rows;
  if(ids.some(id=>!chapters.some(c=>c.path_id===id&&!c.archived_at))||chapters.filter(c=>!c.archived_at).length>100)conflict('每门来源课程须有课时，整合后最多 100 个有效课时。');
  if(Buffer.byteLength(JSON.stringify({course:input.course,chapters}))>1572864)conflict('整合后的课件超过文档大小上限。');
  const chapterIds=chapters.map(c=>c.id);
  const resources=(await db.query('SELECT * FROM learning_resources WHERE path_id=ANY($1::uuid[]) OR chapter_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[ids,chapterIds])).rows;
  if(resources.some(r=>r.chapter_id&&!chapters.some(c=>c.id===r.chapter_id&&c.path_id===r.path_id)))conflict('存在课程与课时归属不一致的资料，请先核对。');
  const snapshot={courses,chapters,resources,classes};
  const planHash=canonicalHash({input,snapshot});
  const preview={targetCourseId:target.id,courseCount:courses.length,chapterCount:chapters.filter(c=>!c.archived_at).length,resourceCount:resources.length,sections:input.course.sections};
  if(ctx.body.dryRun)return {status:200,body:{dryRun:true,planHash,...preview}};
  if(ctx.body.expectedPlanHash!==planHash)conflict('预览后课程或资料发生变化，请重新预览；未修改任何记录。');
  let position=0;
  const mapping=[];
  for(const source of input.courses){
   const selected=chapters.filter(c=>c.path_id===source.courseId);
   for(const chapter of selected){
    await db.query('UPDATE learning_chapters SET path_id=$2,position=$3,section_key=$4 WHERE id=$1',[chapter.id,target.id,position++,source.sectionKey]);
    mapping.push({chapterId:chapter.id,sourceCourseId:source.courseId,sectionKey:source.sectionKey,archived:!!chapter.archived_at});
   }
   if(source.courseId!==target.id){
    await db.query('UPDATE learning_resources SET path_id=$2 WHERE path_id=$1',[source.courseId,target.id]);
    const first=selected.find(c=>!c.archived_at).id;
    await db.query('UPDATE learning_paths SET archived_at=clock_timestamp(),updated_at=clock_timestamp(),merged_into_id=$2,merged_first_chapter_id=$3 WHERE id=$1',[source.courseId,target.id,first]);
   }
  }
  const meta=input.course;
  await db.query('UPDATE learning_paths SET title=$2,description=$3,category=$4,estimated_minutes=$5,localizations=$6,sections=$7,updated_at=clock_timestamp() WHERE id=$1',
   [target.id,meta.title,meta.description,meta.category,meta.estimatedMinutes,meta.localizations,JSON.stringify(meta.sections)]);
  const receipt={merged:true,targetCourseId:target.id,planHash,sourceCourseIds:ids.slice(1),chapterIds:mapping.filter(c=>!c.archived).map(c=>c.chapterId),mapping,sections:meta.sections,resourceCount:resources.length};
  await db.query('INSERT INTO learning_course_merges(target_path_id,actor_account_id,request_hash,plan_hash,snapshot,receipt) VALUES($1,$2,$3,$4,$5,$6)',[target.id,ctx.user.id,requestHash,planHash,JSON.stringify(snapshot),JSON.stringify(receipt)]);
  await ctx.helpers.audit(db,ctx.user.id,'learning.merge','learning_path',target.id,{sourceCourseIds:ids.slice(1),chapterCount:preview.chapterCount,planHash});
  return {status:200,body:receipt};
 });
}
