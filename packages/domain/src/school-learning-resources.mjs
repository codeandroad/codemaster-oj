import { transaction } from './db.mjs';
import { auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';

const reply=(body,status=200)=>({status,body});
const manages=(r,user,role)=>role==='school_admin'||role==='teacher'&&r.owner_account_id===user.id;
function input(body){
 const courseId=body.courseId?uuid(body.courseId):null,chapterId=body.chapterId?uuid(body.chapterId):null;
 if(chapterId&&!courseId)fail(400,'VALIDATION','请选择章节所属课程');
 return {title:field(body.title,'资料名称',{max:200}),type:enumValue(body.type??'note',['note','article','reference'],'资料类型'),
 scope:enumValue(body.scope??'private',['school','private'],'资料范围'),content:field(body.content??'','资料正文',{min:0,max:100000,trim:false}),courseId,chapterId};
}
export async function handleSchoolLearningResources({pool,user,route,method,body={},url},loadCourse){
 const m=route.match(/^\/schools\/([^/]+)\/learning-resources(?:\/([^/]+))?$/);if(!m)return null;
 const schoolId=uuid(m[1]);if(schoolId===LEGACY_SCHOOL_ID)fail(404,'NOT_FOUND','请使用原学校入口');
 const id=m[2]?uuid(m[2]):null;
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,schoolId,{shared:method==='GET'});const role=await schoolRole(db,schoolId,user.id);
  await db.query("SELECT set_config('campus.school_id',$1,true)",[schoolId]);
  async function linked(resource,{editing=false}={}){
   if(!resource.course_id)return null;
   const loaded=await loadCourse(db,schoolId,resource.course_id,user,role);
   if(editing&&(!loaded.canManage||loaded.course.archived_at))fail(404,'NOT_FOUND','课程不可编辑');
   if(resource.chapter_id&&!loaded.view.chapters.some(ch=>ch.id===resource.chapter_id))fail(404,'NOT_FOUND','章节不存在或尚未发布');
   return loaded;
  }
  async function shape(r,{detail=false}={}){
   const course=await linked(r),canManage=manages(r,user,role);
   return {id:r.id,title:r.title,type:r.type,scope:r.scope,courseId:r.course_id,chapterId:r.chapter_id,
    courseTitle:course?.view.title??null,chapterTitle:course?.view.chapters.find(ch=>ch.id===r.chapter_id)?.title??null,
    revision:r.revision,canManage,...(detail?{content:r.content}:{})};
  }
  if(method==='GET'&&!id){
   const courseId=url.searchParams.get('courseId');if(courseId)uuid(courseId);
   const q=field(url.searchParams.get('q')??'','搜索',{min:0,max:100});
   const rows=(await db.query(`SELECT * FROM school_learning_resources WHERE school_id=$1 AND deleted_at IS NULL
    AND ($2='school_admin' OR owner_account_id=$3 AND $2='teacher' OR scope='school')
    AND ($4::uuid IS NULL OR course_id=$4) AND ($5='' OR strpos(lower(title),lower($5))>0) ORDER BY created_at DESC,id`,[schoolId,role,user.id,courseId,q])).rows;
   const items=[];for(const r of rows){try{items.push(await shape(r));}catch(e){if(e.status!==404)throw e;}}
   return reply({items});
  }
  if(method==='POST'&&!id){
   if(!['school_admin','teacher'].includes(role))fail(403,'FORBIDDEN','需要教职权限');
   const data=input(body),requestId=uuid(body.requestId),hash=canonicalHash(data);
   const old=(await db.query('SELECT * FROM school_learning_resources WHERE school_id=$1 AND owner_account_id=$2 AND create_request_id=$3',[schoolId,user.id,requestId])).rows[0];
   if(old){if(old.deleted_at||old.create_request_hash!==hash)fail(409,'IDEMPOTENCY_CONFLICT','请求已用于其他资料');return reply(await shape(old,{detail:true}));}
   await linked({course_id:data.courseId,chapter_id:data.chapterId},{editing:true});
   const row=(await db.query(`INSERT INTO school_learning_resources(school_id,owner_account_id,title,type,scope,content,course_id,chapter_id,create_request_id,create_request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[schoolId,user.id,data.title,data.type,data.scope,data.content,data.courseId,data.chapterId,requestId,hash])).rows[0];
   await auditSchool(db,schoolId,user.id,'school.resource.create',row.id);return reply(await shape(row,{detail:true}),201);
  }
  if(!id)return null;
  const row=(await db.query('SELECT * FROM school_learning_resources WHERE school_id=$1 AND id=$2 AND deleted_at IS NULL',[schoolId,id])).rows[0];
  if(!row||!manages(row,user,role)&&row.scope!=='school')fail(404,'NOT_FOUND','资料不存在或不可访问');
  if(method==='GET')return reply(await shape(row,{detail:true}));
  if(!manages(row,user,role))fail(403,'FORBIDDEN','无权编辑资料');
  if(integer(body.expectedRevision,1,2147483646,'版本')!==row.revision)fail(409,'REVISION_CONFLICT','资料已更新，请刷新');
  if(method==='DELETE'){
   await db.query('UPDATE school_learning_resources SET deleted_at=clock_timestamp(),revision=revision+1 WHERE school_id=$1 AND id=$2',[schoolId,id]);
   await auditSchool(db,schoolId,user.id,'school.resource.delete',id);return reply({ok:true});
  }
  if(method==='PATCH'){
   const data=input(body);await linked({course_id:data.courseId,chapter_id:data.chapterId},{editing:true});
   const updated=(await db.query(`UPDATE school_learning_resources SET title=$3,type=$4,scope=$5,content=$6,course_id=$7,chapter_id=$8,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=$1 AND id=$2 RETURNING *`,[schoolId,id,data.title,data.type,data.scope,data.content,data.courseId,data.chapterId])).rows[0];
   await auditSchool(db,schoolId,user.id,'school.resource.update',id);return reply(await shape(updated,{detail:true}));
  }
  return null;
 });
}
