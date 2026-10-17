import {fail,field,uuid,enumValue} from './security.mjs';
const isStaff=user=>user.roles.some(role=>role==='teacher'||role==='admin');
export const managesCourse=(user,course)=>isStaff(user)&&(user.roles.includes('admin')||course.owner_account_id===user.id);

// A course link or a class task never widens the audience of the course itself.
// Listing is a discovery preference; direct eligible links may still be opened.
export async function readableCourseIds(db,user,ids,{listed=false}={}){
 if(!ids.length)return new Set();
 const rows=(await db.query(`SELECT p.id FROM learning_paths p WHERE p.id=ANY($1::uuid[]) AND (
  $4::boolean AND (p.owner_account_id=$2 OR $5::boolean)
  OR p.published_at IS NOT NULL AND p.archived_at IS NULL AND (NOT $6::boolean OR p.listed)
   AND (p.available_from IS NULL OR p.available_from<=now()) AND (p.available_until IS NULL OR p.available_until>now())
   AND (p.access_scope='school' OR EXISTS(SELECT 1 FROM learning_path_classes pc JOIN classes c ON c.id=pc.class_id AND c.archived_at IS NULL
    JOIN class_members cm ON cm.class_id=c.id WHERE pc.path_id=p.id AND cm.identity_id=$3)))`,[ids,user.id,user.identityId,isStaff(user),user.roles.includes('admin'),listed])).rows;
 return new Set(rows.map(row=>row.id));
}
export async function courseMetadataForUser(db,user,id){
 if(!id)return null;
 if(!(await readableCourseIds(db,user,[id])).has(id))return null;
 return (await db.query('SELECT id,title,published_at,archived_at FROM learning_paths WHERE id=$1',[id])).rows[0]??null;
}
export async function courseClasses(db,id){
 return (await db.query(`SELECT c.id,c.name,(c.archived_at IS NOT NULL) archived FROM learning_path_classes pc JOIN classes c ON c.id=pc.class_id WHERE pc.path_id=$1 ORDER BY c.name,c.id`,[id])).rows;
}
export function validateCoverImage(value){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>700000)fail(400,'INVALID_COVER','封面须为不超过 512 KB 的 PNG、JPEG 或 WebP 图片');
 const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match||match[2].length%4!==0)fail(400,'INVALID_COVER','封面须为 PNG、JPEG 或 WebP 图片，不支持 SVG 或外部网址');
 const image=Buffer.from(match[2],'base64');
 if(!image.length||image.length>524288||image.toString('base64')!==match[2])fail(400,'INVALID_COVER','封面图片无效或超过 512 KB');
 const png=image.length>=24&&image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&image.toString('ascii',12,16)==='IHDR';
 const jpeg=image.length>=4&&image[0]===255&&image[1]===216&&image[2]===255&&image[image.length-2]===255&&image[image.length-1]===217;
 const webp=image.length>=20&&image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP'&&image.readUInt32LE(4)+8===image.length;
 if(!({png,jpeg,webp})[match[1]])fail(400,'INVALID_COVER','封面文件内容与图片格式不符');
 return value;
}
function timestamp(value,label,{nullable=true}={}){
 if((value===null||value==='')&&nullable)return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'VALIDATION',`${label}须为包含时区的有效时间`);
 return new Date(value).toISOString();
}
export function courseDisplayProperties(body,old={},defaultName=''){
 return {authorName:field(body.authorName??old.author_name??defaultName,'课程作者',{min:0,max:200}),
  authoredAt:body.authoredAt===undefined?old.authored_at??null:timestamp(body.authoredAt,'编写时间',{nullable:false}),
  coverImage:body.coverImage===undefined?old.cover_image??null:validateCoverImage(body.coverImage)};
}
export async function courseProperties(db,user,body,old={}){
 const display=courseDisplayProperties(body,old,user.name??'');
 const accessScope=enumValue(body.accessScope??old.access_scope??'school',['school','classes'],'课程可见范围');
 const availableFrom=body.availableFrom===undefined?old.available_from??null:timestamp(body.availableFrom,'开放时间');
 const availableUntil=body.availableUntil===undefined?old.available_until??null:timestamp(body.availableUntil,'结束时间');
 if(availableFrom&&availableUntil&&new Date(availableUntil)<=new Date(availableFrom))fail(400,'VALIDATION','结束时间须晚于开放时间');
 const listed=body.listed===undefined?old.listed??true:body.listed;
 if(typeof listed!=='boolean')fail(400,'VALIDATION','课程列表显示设置须为布尔值');
 const previous=old.id?(await courseClasses(db,old.id)).map(c=>c.id):[];
 let classIds=body.classIds===undefined?previous:body.classIds;
 if(!Array.isArray(classIds)||classIds.length>50)fail(400,'VALIDATION','课程最多关联 50 个班级');
 classIds=[...new Set(classIds.map(id=>uuid(id,'班级 ID')))];
 if(accessScope==='school')classIds=[];
 for(const id of classIds){
  if(previous.includes(id))continue;
  const row=(await db.query('SELECT id FROM classes WHERE id=$1 AND archived_at IS NULL FOR SHARE',[id])).rows[0];
  if(!row)fail(404,'NOT_FOUND','关联班级不存在或已归档');
  if(!user.roles.includes('admin')&&!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[id,user.id])).rowCount)fail(403,'FORBIDDEN','只能关联本人负责的班级');
 }
 return {...display,accessScope,availableFrom,availableUntil,listed,classIds,audienceChanged:accessScope!==(old.access_scope??'school')||[...classIds].sort().join(',')!==[...previous].sort().join(',')};
}
export async function saveCourseProperties(db,id,properties){
 const p=properties;
 await db.query(`UPDATE learning_paths SET author_name=$2,authored_at=COALESCE($3,authored_at),cover_image=$4,access_scope=$5,available_from=$6,available_until=$7,listed=$8 WHERE id=$1`,[id,p.authorName,p.authoredAt,p.coverImage,p.accessScope,p.availableFrom,p.availableUntil,p.listed]);
 await db.query('DELETE FROM learning_path_classes WHERE path_id=$1',[id]);
 for(const classId of p.classIds)await db.query('INSERT INTO learning_path_classes(path_id,class_id) VALUES($1,$2)',[id,classId]);
}
export async function assertCoursePublicationAccess(db,course){
 if(course.access_scope==='classes'&&!(await db.query('SELECT 1 FROM learning_path_classes pc JOIN classes c ON c.id=pc.class_id AND c.archived_at IS NULL WHERE pc.path_id=$1',[course.id])).rowCount)fail(409,'COURSE_CLASSES_REQUIRED','发布限班级课程前请选择至少一个有效班级');
}
export async function requireLinkedCourse(db,user,value){
 if(value===null||value===''||value===undefined)return null;
 const id=uuid(value,'关联课程 ID');
 const course=(await db.query('SELECT id,published_at,archived_at FROM learning_paths WHERE id=$1 FOR SHARE',[id])).rows[0];
 if(!course?.published_at||course.archived_at||user&&!(await readableCourseIds(db,user,[id])).has(id))fail(409,'COURSE_UNAVAILABLE','只能关联当前有权访问的已发布课程');
 return id;
}
