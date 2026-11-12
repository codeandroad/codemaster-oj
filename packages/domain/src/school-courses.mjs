import { courseLocalizations, localizedFields } from './course-localizations.mjs';
import { normalizeCourseAcslLinks, resolveCourseAcslLinks, projectCourseAcslLinks, acslLinkCounts } from './course-acsl.mjs';
import { schoolActivityJobVisibleSql } from './school-activities.mjs';
import { validateCoverImage } from './course-access.mjs';
import { normalizeRequiredLanguage } from './course-language-policy.mjs';
import { handleSchoolLearningResources } from './school-learning-resources.mjs';
import { transaction } from './db.mjs';
import { auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';

const PAGE_SIZE = 50;
const reply = (body, status = 200) => ({ status, body });
const contentHash = chapter => canonicalHash({title:chapter.title,body:chapter.body});
const manages = (course, user, role) => role === 'school_admin' || role === 'teacher' && course.owner_account_id === user.id;

function courseInput(body, previous={}) {
 const old=previous.properties??{};
 const properties={localizations:body.localizations===undefined?old.localizations??null:courseLocalizations(body.localizations),category:field(body.category??old.category??'Programming','课程分类',{min:1,max:100}),
 difficulty:enumValue(body.difficulty??old.difficulty??'beginner',['beginner','intermediate','advanced'],'难度'),
 coverKey:enumValue(body.coverKey??old.coverKey??'general',['python','algorithms','general'],'课程封面'),
 estimatedMinutes:integer(body.estimatedMinutes??old.estimatedMinutes??60,1,10080,'预计学习时间'),
 authorName:field(body.authorName??old.authorName??'','作者',{min:0,max:200}),
 coverImage:body.coverImage===undefined?old.coverImage??null:validateCoverImage(body.coverImage),
 authoredAt:body.authoredAt===undefined?old.authoredAt??null:body.authoredAt};
 if(properties.authoredAt!==null){
  if(typeof properties.authoredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(properties.authoredAt)||!Number.isFinite(Date.parse(properties.authoredAt)))fail(400,'VALIDATION','创建时间须为带时区的有效时间');
  properties.authoredAt=new Date(properties.authoredAt).toISOString();
 }

 const title=field(body.title,'课程名称',{max:200});
 const description=field(body.description??'','课程简介',{min:0,max:4000});
 const accessScope=enumValue(body.accessScope??'school',['school','classes'],'开放范围');
 if(!Array.isArray(body.chapters)||body.chapters.length>100)fail(400,'VALIDATION','课程最多包含100章');
 const chapters=body.chapters.map(chapter=>{
  const previousChapter=previous.chapters?.find(old=>old.id===chapter?.id);
  return {id:uuid(chapter?.id,'章节 ID').toLowerCase(),title:field(chapter?.title,'章节标题',{max:200}),body:field(chapter?.body??'','章节正文',{min:0,max:100000,trim:false}),
   ...localizedFields(chapter?.localizations===undefined?previousChapter?.localizations:courseLocalizations(chapter.localizations,{chapter:true})),
   ...Object.fromEntries(['objective','checkpoint','checkpointAnswer'].filter(key=>chapter?.[key]!==undefined||previousChapter?.[key]!==undefined).map(key=>[key,field(chapter?.[key]??previousChapter[key],key,{min:0,max:key==='objective'?4000:10000,trim:false})])),
   ...(chapter?.acslLinks!==undefined||previousChapter?.acslLinks!==undefined?{acslLinks:normalizeCourseAcslLinks(chapter?.acslLinks??previousChapter?.acslLinks??[])}:{}),problems:chapterProblems(chapter?.problems)};
 });
 if(new Set(chapters.map(c=>c.id)).size!==chapters.length)fail(400,'VALIDATION','章节 ID 不能重复');
 if(Buffer.byteLength(JSON.stringify(chapters))>1000000)fail(400,'VALIDATION','课程正文总量不能超过1 MB');
 if(!Array.isArray(body.classIds??[])||(body.classIds??[]).length>50)fail(400,'VALIDATION','课程最多关联50个班级');
 const classIds=[...new Set((body.classIds??[]).map(id=>uuid(id,'班级 ID').toLowerCase()))].sort();
 if(accessScope==='school'&&classIds.length)fail(400,'VALIDATION','全校课程无需选择班级');
 const requiredLanguage=normalizeRequiredLanguage(body.requiredLanguage,previous.required_language);
 return {title,description,accessScope,chapters,classIds,properties,...(requiredLanguage?{requiredLanguage}:{})};
}

function chapterProblems(value=[]){
 if(!Array.isArray(value)||value.length>100)fail(400,'VALIDATION','每章最多关联100道题');
 const items=value.map(p=>({problemId:uuid(p?.problemId,'题目 ID').toLowerCase(),versionId:uuid(p?.versionId,'题目版本').toLowerCase()}));
 if(new Set(items.map(p=>p.problemId)).size!==items.length)fail(400,'VALIDATION','章节题目不能重复');
 return items;
}
async function validateProblems(db,schoolId,chapters){
 const links=chapters.flatMap(ch=>ch.problems??[]);if(!links.length)return;
 const {rows:[result]}=await db.query(`SELECT count(*)::int AS invalid FROM jsonb_to_recordset($2::jsonb) AS l("problemId" uuid,"versionId" uuid)
  LEFT JOIN school_problems p ON p.school_id=$1 AND p.id=l."problemId" AND p.published_version_id=l."versionId"
  LEFT JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
  WHERE p.id IS NULL OR NOT p.published OR b.archived`,[schoolId,JSON.stringify(links)]);
 if(result.invalid)fail(409,'COURSE_PROBLEM_UNAVAILABLE','配套练习必须为本校当前已审核发布版本');
}
async function chapterPractice(db,schoolId,view,identityId){
 const {chapters,required_language,language_credit_cutoffs}=view;
 const links=chapters.flatMap(ch=>ch.problems??[]);const indexed=new Map();
 if(links.length){
  const rows=(await db.query(`WITH links AS (SELECT DISTINCT "problemId","versionId" FROM jsonb_to_recordset($2::jsonb) AS l("problemId" uuid,"versionId" uuid)),
   solved AS (SELECT DISTINCT j.problem_id,j.version_id FROM school_judge_jobs j JOIN links l ON l."problemId"=j.problem_id AND l."versionId"=j.version_id
    WHERE j.school_id=$1 AND j.identity_id=$3 AND j.access_context='school' AND j.kind='submit' AND j.state='completed' AND j.result->>'status'='AC' AND ${schoolActivityJobVisibleSql('j')}
    AND course_language_allows_credit($4,$5,j.payload->>'language',j.created_at))
   SELECT l."problemId",l."versionId",v.definition->>'title' AS title,
    p.published AND NOT b.archived AND p.published_version_id=l."versionId" AS available,solved.problem_id IS NOT NULL AS solved
   FROM links l JOIN school_problems p ON p.school_id=$1 AND p.id=l."problemId"
   JOIN school_problem_banks b ON b.school_id=p.school_id AND b.id=p.bank_id
   JOIN school_problem_versions v ON v.school_id=p.school_id AND v.problem_id=p.id AND v.id=l."versionId"
   LEFT JOIN solved ON solved.problem_id=p.id AND solved.version_id=l."versionId"`,[schoolId,JSON.stringify(links),identityId,required_language,language_credit_cutoffs??{}])).rows;
  for(const row of rows)indexed.set(row.problemId+':'+row.versionId,row);
 }
 let completed=0,total=0;
 const output=chapters.map(ch=>({...ch,problems:(ch.problems??[]).map(link=>{const p=indexed.get(link.problemId+':'+link.versionId);total++;if(p?.solved)completed++;return {...link,title:p?.title??'Unavailable problem',available:!!p?.available,solved:!!p?.solved};})}));
 return {chapters:output,completedExercises:completed,totalExercises:total};
}
async function validateClasses(db, schoolId, user, role, ids) {
 for(const id of ids) {
  const {rowCount}=await db.query(`SELECT 1 FROM school_classes c WHERE c.school_id=$1 AND c.id=$2 AND c.archived_at IS NULL
   AND ($3::boolean OR EXISTS(SELECT 1 FROM school_class_roster r JOIN school_identities i ON i.school_id=r.school_id AND i.id=r.identity_id
    WHERE r.school_id=c.school_id AND r.class_id=c.id AND i.kind='teacher' AND i.account_id=$4))`,[schoolId,id,role==='school_admin',user.id]);
  if(!rowCount)fail(404,'NOT_FOUND','班级不存在或不在本人负责范围');
 }
}
async function saveClasses(db,schoolId,courseId,ids){
 await db.query('DELETE FROM school_course_classes WHERE school_id=$1 AND course_id=$2',[schoolId,courseId]);
 for(const classId of ids)await db.query('INSERT INTO school_course_classes(school_id,course_id,class_id) VALUES($1,$2,$3)',[schoolId,courseId,classId]);
}
async function studentIdentity(db,schoolId,userId){
 return (await db.query("SELECT id FROM school_identities WHERE school_id=$1 AND account_id=$2 AND kind='student'",[schoolId,userId])).rows[0]?.id??null;
}
export async function loadSchoolCourse(db,schoolId,id,user,role,{publishedOnly=false}={}){
 const course=(await db.query('SELECT * FROM school_courses WHERE school_id=$1 AND id=$2',[schoolId,id])).rows[0];
 if(!course)fail(404,'NOT_FOUND','课程不存在或不可访问');
 const canManage=manages(course,user,role);
 if(canManage&&!publishedOnly)return {course,view:course,canManage,identityId:null};
 if((!canManage&&role!=='student')||!course.published||course.archived_at)fail(404,'NOT_FOUND','课程不存在或不可访问');
 const view=(await db.query('SELECT * FROM school_course_publications WHERE school_id=$1 AND course_id=$2 AND revision=$3',[schoolId,id,course.published_revision])).rows[0];
 if(!view)fail(404,'NOT_FOUND','课程不存在或不可访问');
 if(canManage)return {course,view,canManage,identityId:null};
 const identityId=await studentIdentity(db,schoolId,user.id);
 if(view.access_scope==='classes'){
  const {rowCount}=await db.query(`SELECT 1 FROM school_course_publication_classes pc JOIN school_class_roster r
   ON r.school_id=pc.school_id AND r.class_id=pc.class_id
   WHERE pc.school_id=$1 AND pc.course_id=$2 AND pc.revision=$3 AND r.identity_id=$4 AND EXISTS(SELECT 1 FROM school_classes active WHERE active.school_id=pc.school_id AND active.id=pc.class_id AND active.archived_at IS NULL) LIMIT 1`,[schoolId,id,course.published_revision,identityId]);
  if(!rowCount)fail(404,'NOT_FOUND','课程不存在或不可访问');
 }
 return {course,view,canManage:false,identityId};
}
async function schoolCoursePreviewView(db,schoolId,loaded){
 if(!loaded.canManage)fail(403,'FORBIDDEN','需要课程管理权限');
 const course=loaded.course;
 if(!course.published_revision)return course;
 return (await db.query('SELECT * FROM school_course_publications WHERE school_id=$1 AND course_id=$2 AND revision=$3',
  [schoolId,course.id,course.published_revision])).rows[0];
}
export async function schoolCourseProblemLanguage(db,user,{courseId,chapterId,schoolId,problemId,versionId,role,preview=false}){
 const loaded=await loadSchoolCourse(db,schoolId,courseId,user,role,{publishedOnly:!preview});
 const view=preview?await schoolCoursePreviewView(db,schoolId,loaded):loaded.view;
 const chapter=view.chapters.find(item=>item.id===chapterId);
 if(!chapter?.problems?.some(link=>link.problemId===problemId&&link.versionId===versionId)){
  fail(404,'COURSE_PROBLEM_UNAVAILABLE','此题不在可访问的已发布课程章节中');
 }
 return view.required_language;
}
async function shape(db,schoolId,loaded,{detail=false,user}={}){
 const {course,view,canManage,identityId}=loaded;
 const practice=await chapterPractice(db,schoolId,view,identityId);
 for(const chapter of practice.chapters){const links=await projectCourseAcslLinks(db,schoolId,user,chapter.acslLinks??[]);if(chapter.acslLinks!==undefined)chapter.acslLinks=links;const counts=acslLinkCounts(links);practice.totalExercises+=counts.total;practice.completedExercises+=counts.completed;}
 const progress=identityId?(await db.query('SELECT chapter_id,content_hash,read FROM school_course_progress WHERE school_id=$1 AND course_id=$2 AND identity_id=$3',[schoolId,course.id,identityId])).rows:[];
 const readIds=new Set(progress.filter(row=>row.read&&view.chapters.some(ch=>ch.id===row.chapter_id&&contentHash(ch)===row.content_hash)).map(row=>row.chapter_id));
 const properties=view.properties??{};
 const body={...localizedFields(properties.localizations),id:course.id,title:view.title,description:view.description,
  category:properties.category??'Programming',difficulty:properties.difficulty??'beginner',coverKey:properties.coverKey??'general',
  estimatedMinutes:properties.estimatedMinutes??60,authorName:properties.authorName??'',authoredAt:properties.authoredAt??course.created_at,
  coverImage:properties.coverImage??null,requiredLanguage:view.required_language??null,archived:!!course.archived_at,accessScope:view.access_scope,

  status:course.published?'published':course.published_revision?'unpublished':'draft',
  revision:canManage?course.revision:course.published_revision,publishedRevision:course.published_revision,
  hasUnpublishedChanges:canManage&&course.published&&course.revision!==course.published_revision,
  totalExercises:practice.totalExercises,completedExercises:practice.completedExercises,chapterCount:view.chapters.length,completedChapters:readIds.size,canManage,canTrackProgress:!canManage&&!!identityId};
 if(detail){
  body.accessScope=view.access_scope;
  body.classIds=canManage?(await db.query('SELECT class_id FROM school_course_classes WHERE school_id=$1 AND course_id=$2 ORDER BY class_id',[schoolId,course.id])).rows.map(r=>r.class_id):[];
  body.chapters=practice.chapters.map(ch=>({...ch,read:readIds.has(ch.id)}));
 }
 return body;
}
function expectedRevision(body,course){
 const revision=integer(body.expectedRevision,1,2147483646,'课程版本');
 if(revision!==course.revision)fail(409,'REVISION_CONFLICT','课程已被更新，请刷新后重新修改');
}

export async function handleSchoolCourses(context){
 const resource=await handleSchoolLearningResources(context,loadSchoolCourse);if(resource)return resource;
 const {pool,user,route,method,body={},url}=context;
 const match=route.match(/^\/schools\/([^/]+)\/courses(?:\/([^/]+)(?:\/(publish|unpublish|archive|restore|preview)|\/chapters\/([^/]+)\/read)?)?$/);
 if(!match)return null;
 const schoolId=uuid(match[1],'学校 ID');
 if(schoolId===LEGACY_SCHOOL_ID)fail(404,'NOT_FOUND','请从原学校课程入口访问');
 const courseId=match[2]?uuid(match[2],'课程 ID'):null;
 return transaction(pool,async db=>{
  // The school lock also serializes identity linkage, membership changes and
  // roster edits. No request can read using a partially changed audience.
  await lockSchoolTeaching(db,schoolId,{shared:method==='GET'});
  const role=await schoolRole(db,schoolId,user.id);
  await db.query("SELECT set_config('campus.school_id',$1,true)",[schoolId]);
  if(!courseId&&method==='GET'){
   const page=integer(Number(url.searchParams.get('page')??'1'),1,100000,'页码');
   const archived=url.searchParams.get('archived')==='true';
   if(archived&&role==='student')fail(403,'FORBIDDEN','学生不能访问归档课程');
   const q=field(url.searchParams.get('q')??'','搜索关键词',{min:0,max:100});
   const identityId=role==='student'?await studentIdentity(db,schoolId,user.id):null;
   const {rows}=await db.query(`SELECT c.id FROM school_courses c
    LEFT JOIN school_course_publications p ON p.school_id=c.school_id AND p.course_id=c.id AND p.revision=c.published_revision
    WHERE c.school_id=$1 AND (c.archived_at IS NOT NULL)=$8 AND (
      $2='school_admin' OR $2='teacher' AND c.owner_account_id=$3
      OR $2='student' AND c.published AND (p.access_scope='school' OR EXISTS(
       SELECT 1 FROM school_course_publication_classes pc JOIN school_class_roster r ON r.school_id=pc.school_id AND r.class_id=pc.class_id
       WHERE pc.school_id=c.school_id AND pc.course_id=c.id AND pc.revision=c.published_revision AND r.identity_id=$4 AND EXISTS(SELECT 1 FROM school_classes active WHERE active.school_id=pc.school_id AND active.id=pc.class_id AND active.archived_at IS NULL))))
     AND ($5='' OR strpos(lower(CASE WHEN $2='student' THEN p.title||' '||p.description||' '||COALESCE(p.properties->'localizations','{}'::jsonb)::text ELSE c.title||' '||c.description||' '||COALESCE(c.properties->'localizations','{}'::jsonb)::text END),lower($5))>0)
    ORDER BY c.created_at DESC,c.id LIMIT $6 OFFSET $7`,[schoolId,role,user.id,identityId,q,PAGE_SIZE+1,(page-1)*PAGE_SIZE,archived]);
   const items=[];
   for(const row of rows.slice(0,PAGE_SIZE))items.push(await shape(db,schoolId,await loadSchoolCourse(db,schoolId,row.id,user,role),{user}));
   return reply({items,page,hasMore:rows.length>PAGE_SIZE});
  }
  if(!courseId&&method==='POST'){
   if(!['school_admin','teacher'].includes(role))fail(403,'FORBIDDEN','需要本校教职权限');
   const input=courseInput(body),requestId=uuid(body.requestId,'请求 ID'),hash=canonicalHash(input);
   const old=(await db.query('SELECT * FROM school_courses WHERE school_id=$1 AND owner_account_id=$2 AND create_request_id=$3',[schoolId,user.id,requestId])).rows[0];
   if(old){if(old.create_request_hash!==hash)fail(409,'IDEMPOTENCY_CONFLICT','相同请求 ID 的课程内容不同');return reply(await shape(db,schoolId,{course:old,view:old,canManage:true,identityId:null},{detail:true,user}));}
   await validateClasses(db,schoolId,user,role,input.classIds);
   await validateProblems(db,schoolId,input.chapters);
   for(const chapter of input.chapters)if(chapter.acslLinks!==undefined)chapter.acslLinks=await resolveCourseAcslLinks(db,schoolId,user,chapter.acslLinks,[]);
   const course=(await db.query(`INSERT INTO school_courses(school_id,owner_account_id,title,description,access_scope,chapters,create_request_id,create_request_hash,properties,required_language)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[schoolId,user.id,input.title,input.description,input.accessScope,JSON.stringify(input.chapters),requestId,hash,input.properties,input.requiredLanguage??null])).rows[0];
   await saveClasses(db,schoolId,course.id,input.classIds);
   await auditSchool(db,schoolId,user.id,'school.course.create',course.id);
   return reply(await shape(db,schoolId,{course,view:course,canManage:true,identityId:null},{detail:true,user}),201);
  }
  if(!courseId)return null;
  const loaded=await loadSchoolCourse(db,schoolId,courseId,user,role);
  if(method==='GET'&&match[3]==='preview'){
   const view=await schoolCoursePreviewView(db,schoolId,loaded);
   return reply({...await shape(db,schoolId,{...loaded,view,canManage:false},{detail:true,user}),isPreview:true});
  }
  if(method==='GET'&&!match[3]&&!match[4])return reply(await shape(db,schoolId,loaded,{detail:true,user}));
  if(method==='POST'&&match[4]){
   if(loaded.canManage||role!=='student')fail(403,'FORBIDDEN','阅读进度仅用于学生学习');
   if(!loaded.identityId)fail(409,'SCHOOL_IDENTITY_REQUIRED','请联系学校管理员关联学生身份后记录进度');
   expectedRevision(body,{revision:loaded.course.published_revision});
   const chapterId=uuid(match[4],'章节 ID');
   const chapter=loaded.view.chapters.find(ch=>ch.id===chapterId);
   if(!chapter)fail(404,'NOT_FOUND','已发布课程中没有此章节');
   if(typeof body.read!=='boolean')fail(400,'VALIDATION','阅读状态须为布尔值');
   const changed=await db.query(`INSERT INTO school_course_progress(school_id,course_id,identity_id,chapter_id,content_hash,read)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,course_id,identity_id,chapter_id)
    DO UPDATE SET content_hash=EXCLUDED.content_hash,read=EXCLUDED.read,updated_at=clock_timestamp()
    WHERE school_course_progress.content_hash IS DISTINCT FROM EXCLUDED.content_hash OR school_course_progress.read IS DISTINCT FROM EXCLUDED.read`,[schoolId,courseId,loaded.identityId,chapterId,contentHash(chapter),body.read]);
   if(changed.rowCount)await auditSchool(db,schoolId,user.id,body.read?'school.course.chapter.read':'school.course.chapter.unread',chapterId);
   return reply({ok:true,chapterId,read:body.read});
  }
  if(!loaded.canManage)fail(403,'FORBIDDEN','无权管理此课程');
  expectedRevision(body,loaded.course);
  if(method==='PATCH'&&!match[3]&&!match[4]){
   if(loaded.course.archived_at)fail(409,'COURSE_ARCHIVED','请先恢复已归档课程');
   const input=courseInput(body,loaded.course);
   await validateClasses(db,schoolId,user,role,input.classIds);
   await validateProblems(db,schoolId,input.chapters);
   for(const chapter of input.chapters)if(chapter.acslLinks!==undefined)chapter.acslLinks=await resolveCourseAcslLinks(db,schoolId,user,chapter.acslLinks,loaded.course.chapters.find(old=>old.id===chapter.id)?.acslLinks??[]);
   await db.query(`UPDATE school_courses SET title=$3,description=$4,access_scope=$5,chapters=$6,properties=$7,required_language=$8,revision=revision+1,updated_at=clock_timestamp()
    WHERE school_id=$1 AND id=$2`,[schoolId,courseId,input.title,input.description,input.accessScope,JSON.stringify(input.chapters),input.properties,input.requiredLanguage??null]);
   await saveClasses(db,schoolId,courseId,input.classIds);
   await auditSchool(db,schoolId,user.id,'school.course.update',courseId);
  }else if(method==='POST'&&match[3]==='publish'){
   const c=loaded.course;
   if(c.archived_at)fail(409,'COURSE_ARCHIVED','请先恢复已归档课程');
   if(!c.chapters.length||c.chapters.some(ch=>!ch.body.trim()))fail(409,'COURSE_CONTENT_REQUIRED','发布前请添加章节并填写正文');
   const ids=(await db.query('SELECT class_id FROM school_course_classes WHERE school_id=$1 AND course_id=$2 ORDER BY class_id',[schoolId,courseId])).rows.map(row=>row.class_id);
   if(c.access_scope==='classes'&&!ids.length)fail(409,'COURSE_CLASSES_REQUIRED','发布前请至少选择一个班级');
   await validateClasses(db,schoolId,user,role,ids);
   await validateProblems(db,schoolId,c.chapters);
   for(const chapter of c.chapters){const links=await projectCourseAcslLinks(db,schoolId,user,chapter.acslLinks??[]);if(links.some(link=>!link.available))fail(409,'UNAVAILABLE_ACSL_LINK','请修复不可用的 ACSL 引用后发布课程。');}
   const revision=c.revision+1;
   await db.query(`INSERT INTO school_course_publications(school_id,course_id,revision,title,description,access_scope,chapters,published_by,properties,required_language,language_credit_cutoffs)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
     COALESCE((SELECT course_language_credit_cutoffs(previous.language_credit_cutoffs,previous.required_language,$10,clock_timestamp())
      FROM school_course_publications previous WHERE previous.school_id=$1 AND previous.course_id=$2 AND previous.revision=$11),'{}'::jsonb)`,
    [schoolId,courseId,revision,c.title,c.description,c.access_scope,JSON.stringify(c.chapters),user.id,c.properties,c.required_language,c.published_revision]);
   for(const id of ids)await db.query('INSERT INTO school_course_publication_classes(school_id,course_id,revision,class_id) VALUES($1,$2,$3,$4)',[schoolId,courseId,revision,id]);
   await db.query('UPDATE school_courses SET revision=$3,published_revision=$3,published=true,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[schoolId,courseId,revision]);
   await auditSchool(db,schoolId,user.id,'school.course.publish',courseId);
  }else if(method==='POST'&&match[3]==='unpublish'){
   await db.query('UPDATE school_courses SET published=false,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[schoolId,courseId]);
   await auditSchool(db,schoolId,user.id,'school.course.unpublish',courseId);
  }else if(method==='POST'&&['archive','restore'].includes(match[3])){
   const archive=match[3]==='archive';
   await db.query('UPDATE school_courses SET archived_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,published=false,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[schoolId,courseId,archive]);
   await auditSchool(db,schoolId,user.id,archive?'school.course.archive':'school.course.restore',courseId);
  }else return null;
  return reply(await shape(db,schoolId,await loadSchoolCourse(db,schoolId,courseId,user,role),{detail:true,user}));
 });
}
