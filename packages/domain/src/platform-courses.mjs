import { courseSections, chapterSectionKey, assertChapterSections } from './course-sections.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { platformAudiencePolicy, platformCourseAudience, savePlatformCourseAudience } from './platform-course-access.mjs';
import { courseDisplayProperties } from './course-access.mjs';
import { courseLocalizations } from './course-localizations.mjs';
import { assertCoursePaper4Ready } from './course-paper4.mjs';
import { assertPlatformCourseAcslLinksReady, platformCourseAcslPicker, resolvePlatformCourseAcslLinks } from './platform-course-acsl.mjs';
import { liveProblemVersionIdSql } from './live-problem-version.mjs';
import { bytes, canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';

const reply=(body,status=200)=>({body,status});
const sourceVersion='extract(epoch FROM p.updated_at)::text';

async function authorize(db,user) {
 await activeAccount(db,user.id);
 if(!await isPlatformAdministrator(db,user.id))fail(403,'PLATFORM_ADMIN_REQUIRED','需要平台管理员权限');
 await db.query("SELECT set_config('campus.account_id',$1,true)",[user.id]);
 await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);
}
async function get(db,id,{lock=false}={}) {
 const p=(await db.query(`SELECT p.*,${sourceVersion} source_version FROM learning_paths p
  WHERE p.id=$1 AND p.owner_scope='platform' ${lock?'FOR UPDATE':''}`,[uuid(id)])).rows[0];
 if(!p)fail(404,'NOT_FOUND','平台课程不存在');
 return p;
}
async function shape(db,p,{detail=false}={}) {
 const audiencePolicy=await platformAudiencePolicy(db,p);
 const schoolIds=audiencePolicy.schoolRules.map(rule=>rule.schoolId),studentIds=audiencePolicy.accountRules.map(rule=>rule.identityId);
 const chapters=(await db.query(`SELECT id,title,content,objective,checkpoint,checkpoint_answer AS "checkpointAnswer",
  localizations,acsl_links AS "acslLinks",section_key AS "sectionKey",(SELECT count(*)::int FROM chapter_problems WHERE chapter_id=c.id) AS "problemCount"
  FROM learning_chapters c WHERE path_id=$1 AND archived_at IS NULL ORDER BY position,created_at,id`,[p.id])).rows;
 const schools=schoolIds.length?(await db.query('SELECT id,name FROM schools WHERE id=ANY($1::uuid[]) ORDER BY name,id',[schoolIds])).rows:[];
 const students=studentIds.length?(await db.query(`SELECT i.id,i.name,
  (SELECT a.username FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL LIMIT 1) username
  FROM identities i WHERE i.id=ANY($1::uuid[]) ORDER BY i.name,i.id`,[studentIds])).rows:[];
 const pendingApplications=Number((await db.query(`SELECT count(*) n FROM platform_course_admissions a
  JOIN platform_course_rules r ON r.id=a.rule_id AND r.active AND r.generation=a.generation
  WHERE a.course_id=$1 AND a.status='pending'`,[p.id])).rows[0].n);
 return {sections:p.sections??[],id:p.id,title:p.title,description:p.description,category:p.category,difficulty:p.difficulty,coverKey:p.cover_key,
  coverImage:p.cover_image,authorName:p.author_name,authoredAt:p.authored_at,estimatedMinutes:p.estimated_minutes,
  requiredLanguage:p.required_language,localizations:p.localizations,published:!!p.published_at,archived:!!p.archived_at,
  revision:p.platform_revision,sourceVersion:p.source_version,sourceSchool:'平台管理员',ownerScope:'platform',canEdit:true,
  audiencePolicy,audienceScope:audiencePolicy.independentRule||schoolIds.length&&studentIds.length?'custom':p.platform_access_scope,schoolIds,studentIds,
  schools,students,pendingApplications,chapterCount:chapters.length,...(detail?{chapters}:{})};
}
async function audit(db,user,action,p) {
 await db.query(`INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,$2,$3)`,
  [user.id,`platform.course.${action}`,{courseId:p.id,revision:p.platform_revision}]);
}
async function assertReady(db,p,user) {
 if(p.archived_at)fail(409,'COURSE_ARCHIVED','请先恢复课程');
 if(p.platform_access_scope==='schools'&&!p.platform_school_ids.length||p.platform_access_scope==='students'&&!p.platform_student_ids.length)
  fail(409,'COURSE_AUDIENCE_REQUIRED','请选择课程公开范围');
 const chapters=(await db.query('SELECT content,acsl_links FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL',[p.id])).rows;
 if(!chapters.length||chapters.some(c=>!c.content.trim()))fail(409,'INCOMPLETE','发布前需要至少一个有正文的章节');
 await assertCoursePaper4Ready(db,p.id);
 await assertPlatformCourseAcslLinksReady(db,user,chapters.flatMap(chapter=>chapter.acsl_links??[]));
 const links=(await db.query(`SELECT p.archived_at, b.archived_at bank_archived,b.visibility,v.published_at,v.school_visible_at,v.rank_review_status
  FROM learning_chapters c JOIN chapter_problems cp ON cp.chapter_id=c.id
  JOIN problems p ON p.id=cp.problem_id JOIN problem_banks b ON b.id=p.bank_id
  JOIN problem_versions v ON v.id=COALESCE(${liveProblemVersionIdSql('p')},cp.version_id)
  WHERE c.path_id=$1 AND c.archived_at IS NULL FOR SHARE OF p,b,v`,[p.id])).rows;
 if(links.some(l=>l.archived_at||l.bank_archived||l.visibility!=='school'||!l.published_at||!l.school_visible_at||l.rank_review_status!=='approved'))
  fail(409,'UNAPPROVED_LESSON_PROBLEM','关联练习尚未发布或未通过审核');
}
async function save(db,user,body,old) {
 const audience=await platformCourseAudience(db,body,old??{});
 const display=courseDisplayProperties(body,old??{},'平台管理员');
 const title=field(body.title??old?.title,'课程名称',{max:200});
 const description=field(body.description??old?.description??'','课程简介',{min:0,max:4000});
 const category=field(body.category??old?.category??'Programming','分类',{max:100});
 const minutes=integer(body.estimatedMinutes??old?.estimated_minutes??60,1,10080,'预计分钟数');
 const difficulty=enumValue(body.difficulty??old?.difficulty??'beginner',['beginner','intermediate','advanced'],'难度');
 const cover=enumValue(body.coverKey??old?.cover_key??'general',['python','algorithms','general'],'封面');
 const localizations=body.localizations===undefined?old?.localizations??null:courseLocalizations(body.localizations);
 const sections=courseSections(body.sections===undefined?old?.sections??[]:body.sections);
 const id=old?.id??uuid(body.requestId,'请求 ID');
 if(!old)await db.query(`INSERT INTO learning_paths(id,owner_account_id,title,owner_scope,platform_create_request_hash) VALUES($1,$2,$3,'platform',$4)`,[id,user.id,title,canonicalHash(body)]);
 await db.query(`UPDATE learning_paths SET title=$2,description=$3,category=$4,estimated_minutes=$5,difficulty=$6,cover_key=$7,
  author_name=$8,authored_at=COALESCE($9,authored_at),cover_image=$10,required_language=$11,localizations=$12,
  platform_access_scope=$13,platform_school_ids=$14,platform_student_ids=$15,
  language_credit_cutoffs=CASE WHEN published_at IS NOT NULL THEN course_language_credit_cutoffs(language_credit_cutoffs,published_required_language,$11,clock_timestamp()) ELSE language_credit_cutoffs END,
  published_required_language=CASE WHEN published_at IS NOT NULL THEN $11 ELSE published_required_language END,
  updated_at=clock_timestamp(),platform_revision=platform_revision+CASE WHEN $16 THEN 1 ELSE 0 END WHERE id=$1`,
 [id,title,description,category,minutes,difficulty,cover,display.authorName,display.authoredAt,display.coverImage,display.requiredLanguage,localizations,audience.scope,audience.schoolIds,audience.studentIds,!!old]);
 await db.query('UPDATE learning_paths SET sections=$2 WHERE id=$1',[id,JSON.stringify(sections)]);
 await savePlatformCourseAudience(db,id,audience);
 if(body.chapters===undefined)assertChapterSections(sections,(await db.query('SELECT section_key FROM learning_chapters WHERE path_id=$1 AND archived_at IS NULL',[id])).rows);
 if(body.chapters!==undefined){
  if(!Array.isArray(body.chapters)||body.chapters.length>100||Buffer.byteLength(JSON.stringify(body.chapters))>1500000)
   fail(400,'VALIDATION','课程最多 100 章，正文总量不能超过 1.5 MB');
  const existingChapters=new Map((await db.query('SELECT * FROM learning_chapters WHERE path_id=$1',[id])).rows.map(c=>[c.id,c]));
  const existing=new Set(existingChapters.keys());
  const retained=[];
  for(const [position,c] of body.chapters.entries()){
   if(!c||typeof c!=='object'||Array.isArray(c))fail(400,'VALIDATION','章节内容无效');
   const chapterId=c.id?uuid(c.id).toLowerCase():randomUUID();
   if(retained.includes(chapterId))fail(400,'VALIDATION','章节 ID 不能重复');
   if(c.id&&!existing.has(chapterId))fail(400,'VALIDATION','章节不属于此课程');
   retained.push(chapterId);
   const before=existingChapters.get(chapterId);
   const sectionKey=chapterSectionKey(c.sectionKey===undefined?before?.section_key:c.sectionKey,sections);
   const chapterTitle=field(c.title===undefined?before?.title:c.title,'章节标题',{max:200});
   const content=bytes(c.content===undefined?before?.content??'':c.content,'章节正文');
   const objective=field(c.objective===undefined?before?.objective??'':c.objective,'学习目标',{min:0,max:4000,trim:false});
   const checkpoint=field(c.checkpoint===undefined?before?.checkpoint??'':c.checkpoint,'检查点',{min:0,max:10000,trim:false});
   const checkpointAnswer=field(c.checkpointAnswer===undefined?before?.checkpoint_answer??'':c.checkpointAnswer,'检查点答案',{min:0,max:10000,trim:false});
   const chapterLocales=c.localizations===undefined?before?.localizations??null:courseLocalizations(c.localizations,{chapter:true});
   const acslLinks=c.acslLinks===undefined?before?.acsl_links??[]:await resolvePlatformCourseAcslLinks(db,user,c.acslLinks,before?.acsl_links??[]);
   if(existing.has(chapterId))await db.query(`UPDATE learning_chapters SET title=$2,content=$3,position=$4,archived_at=NULL,
    objective=$5,checkpoint=$6,checkpoint_answer=$7,localizations=$8,acsl_links=$9,section_key=$10,updated_at=clock_timestamp() WHERE id=$1`,
   [chapterId,chapterTitle,content,position,objective,checkpoint,checkpointAnswer,chapterLocales,JSON.stringify(acslLinks),sectionKey]);
   else await db.query(`INSERT INTO learning_chapters(id,path_id,title,content,position,objective,checkpoint,checkpoint_answer,localizations,acsl_links,section_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[chapterId,id,chapterTitle,content,position,objective,checkpoint,checkpointAnswer,chapterLocales,JSON.stringify(acslLinks),sectionKey]);
  }
  await db.query('UPDATE learning_chapters SET archived_at=clock_timestamp() WHERE path_id=$1 AND archived_at IS NULL AND NOT(id=ANY($2::uuid[]))',[id,retained]);
 }
 const saved=await get(db,id);
 if(saved.published_at&&!saved.archived_at)await assertReady(db,saved,user);
 return saved;
}

export async function handlePlatformCourses({pool,user,route,method,body,url}) {
 const match=route.match(/^\/platform\/courses(?:\/([^/]+)(?:\/(publish|unpublish|archive|restore))?)?$/);
 if(!match)return null;
 return transaction(pool,async db=>{
  await authorize(db,user);
  if(match[1]==='acsl-links'&&method==='GET'&&!match[2])return reply(await platformCourseAcslPicker(db,user));
  if(match[1]==='audience'&&method==='GET'){
   const q=field(url.searchParams.get('q')??'','搜索',{min:0,max:100}).toLowerCase();
   const kind=enumValue(url.searchParams.get('kind')??'schools',['schools','students'],'选择类型');
   const items=kind==='schools'?(await db.query('SELECT id,name FROM schools WHERE strpos(lower(name),$1)>0 ORDER BY name,id LIMIT 100',[q])).rows
    :q.length<2?[]:(await db.query(`SELECT i.id,i.name,a.username FROM identities i JOIN accounts a ON a.identity_id=i.id
     WHERE i.kind IN ('student','personal') AND i.archived_at IS NULL AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
     AND (strpos(lower(i.name),$1)>0 OR strpos(lower(a.username),$1)>0 OR strpos(lower(i.number),$1)>0)
     ORDER BY a.username,i.id LIMIT 30`,[q])).rows;
   return reply({items});
  }
  if(!match[1]&&method==='GET'){
   const rows=(await db.query(`SELECT p.*,${sourceVersion} source_version FROM learning_paths p WHERE owner_scope='platform' ORDER BY archived_at NULLS FIRST,updated_at DESC,id`)).rows;
   const items=[];for(const p of rows)items.push(await shape(db,p));return reply({items});
  }
  if(match[1]&&method==='GET'&&!match[2])return reply(await shape(db,await get(db,match[1]),{detail:true}));
  if(!['POST','PATCH'].includes(method))return null;
  await lockSchoolTeaching(db,LEGACY_SCHOOL_ID);
  if(!match[1]&&method==='POST'){
   const requestId=uuid(body.requestId,'请求 ID');
   const previous=(await db.query('SELECT p.*,extract(epoch FROM p.updated_at)::text source_version FROM learning_paths p WHERE id=$1',[requestId])).rows[0];
   if(previous){
    if(previous.owner_scope!=='platform'||previous.owner_account_id!==user.id||previous.platform_create_request_hash!==canonicalHash(body))
     fail(409,'IDEMPOTENCY_CONFLICT','相同请求键对应不同课程内容');
    return reply(await shape(db,previous,{detail:true}),201);
   }
  }
  const old=match[1]?await get(db,match[1],{lock:true}):null;
  if(old&&(body.expectedRevision!==old.platform_revision||body.sourceVersion!==old.source_version))
   fail(409,'REVISION_CONFLICT','课程已更新，请重新载入后保存');
  let saved;
  if(!match[2]){
   if(old&&method!=='PATCH'||!old&&method!=='POST')return null;
   if(old?.archived_at)fail(409,'COURSE_ARCHIVED','请先恢复课程');
   saved=await save(db,user,body,old);
  }else{
   if(method!=='POST')return null;
   const action=match[2];
   if(action==='publish')await assertReady(db,old,user);
   if(action==='archive'&&(await db.query("SELECT 1 FROM assignments WHERE course_path_id=$1 AND archived_at IS NULL AND state='Published' AND due_at>clock_timestamp() LIMIT 1",[old.id])).rowCount)
    fail(409,'COURSE_HAS_ACTIVE_ASSIGNMENTS','课程仍有关联的进行中作业');
   await db.query(`UPDATE learning_paths SET
    published_at=CASE WHEN $2='publish' THEN COALESCE(published_at,now()) WHEN $2='unpublish' THEN NULL ELSE published_at END,
    withdrawn_at=CASE WHEN $2='publish' THEN NULL WHEN $2='unpublish' THEN now() ELSE withdrawn_at END,
    archived_at=CASE WHEN $2='archive' THEN now() WHEN $2='restore' THEN NULL ELSE archived_at END,
    language_credit_cutoffs=CASE WHEN $2='publish' AND (published_at IS NOT NULL OR withdrawn_at IS NOT NULL)
     THEN course_language_credit_cutoffs(language_credit_cutoffs,published_required_language,required_language,clock_timestamp()) ELSE language_credit_cutoffs END,
    published_required_language=CASE WHEN $2='publish' THEN required_language ELSE published_required_language END,
    platform_revision=platform_revision+1,updated_at=clock_timestamp() WHERE id=$1`,[old.id,action]);
   saved=await get(db,old.id);
   if(action==='restore'&&saved.published_at)await assertReady(db,saved,user);
  }
  await audit(db,user,match[2]??(old?'updated':'created'),saved);
  return reply(await shape(db,saved,{detail:true}),old?200:201);
 });
}
