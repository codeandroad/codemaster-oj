import {HttpError,fail} from './security.mjs';
export function parseJsonBody(raw,headers,limit=2097152) {
 if(!raw?.length)return {};
 if(raw.length>limit)fail(413,'TOO_LARGE','请求过大');
 if(!headers['content-type']?.startsWith('application/json'))fail(415,'CONTENT_TYPE','请使用 JSON 请求');
 let body;try{body=JSON.parse(raw.toString('utf8'));}catch{fail(400,'JSON','JSON 格式无效');}
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'JSON','请求须为 JSON 对象');return body;
}
export function errorResponse(error) {
 if(error instanceof HttpError)return {status:error.status,body:{error:{code:error.code,message:error.message}}};
 if(error.code==='23505')return {status:409,body:{error:{code:'CONFLICT',message:error.constraint==='classes_active_owner_name_idx'?'同一负责人下班级名称已存在':'用户名、编号或记录已存在，请检查后重试'}}};
 if(['23503','22P02','23514'].includes(error.code))return {status:400,body:{error:{code:'VALIDATION',message:'数据关系或字段无效'}}};
 console.error('Request failed',{code:error.code||error.name,message:error.message});return {status:500,body:{error:{code:'INTERNAL',message:'服务暂时不可用，请稍后重试'}}};
}
