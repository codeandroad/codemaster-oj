import {fail,field,integer,bytes,uuid,enumValue} from './security.mjs';
import {normalizeCoursePaper4Links} from './course-paper4.mjs';
import {courseDisplayProperties} from './course-access.mjs';
export function validateLearningDocument(body){
 if(!body||body.format!=='codemaster-learning-path'||body.version!==1)fail(400,'VALIDATION','学习路径文档格式版本无效');
 if(Buffer.byteLength(JSON.stringify(body))>1572864)fail(413,'TOO_LARGE','课程文档不得超过 1.5 MB');
 if(!Array.isArray(body.chapters)||!body.chapters.length||body.chapters.length>100)fail(400,'VALIDATION','学习路径需要 1–100 个章节');
 return {...Object.fromEntries(Object.entries(courseDisplayProperties(body)).filter(([key])=>body[key]!==undefined)),difficulty:enumValue(body.difficulty??'beginner',['beginner','intermediate','advanced'],'课程难度'),coverKey:enumValue(body.coverKey??'general',['python','algorithms','general'],'课程封面'),title:field(body.title,'学习路径标题'),description:field(body.description??'','描述',{min:0,max:4000}),category:field(body.category??'Python','分类',{max:100}),estimatedMinutes:integer(body.estimatedMinutes,1,10080,'预计时长'),chapters:body.chapters.map(c=>{
 if(!c||!Array.isArray(c.problemIds)||c.problemIds.length>100)fail(400,'VALIDATION','章节练习引用无效');
 const content=bytes(c.content,'章节正文');if(!content.trim())fail(400,'VALIDATION','章节正文不能为空');
 return {paper4Links:normalizeCoursePaper4Links(c.paper4Links??[]),difficulty:enumValue(body.difficulty??'beginner',['beginner','intermediate','advanced'],'课程难度'),coverKey:enumValue(body.coverKey??'general',['python','algorithms','general'],'课程封面'),title:field(c.title,'章节标题'),content,objective:field(c.objective??'','学习目标',{min:0,max:4000,trim:false}),checkpoint:field(c.checkpoint??'','检查点',{min:0,max:10000,trim:false}),checkpointAnswer:field(c.checkpointAnswer??'','参考答案',{min:0,max:10000,trim:false}),problemIds:[...new Set(c.problemIds.map(id=>uuid(id,'练习题 ID')))]};})};
}
