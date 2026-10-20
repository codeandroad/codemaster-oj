import {transaction} from './db.mjs';
import {canonicalHash,enumValue,fail,field,uuid} from './security.mjs';
import {isLuqStaff,resolveAssistanceTarget} from './luq-access.mjs';

const textKeys=['objective','inputDescription','outputDescription','returnType','difficulty'];
const metadataKeys=[...textKeys,'parameters'];
const one=result=>{if(!result.rowCount)fail(404,'NOT_FOUND','题目版本不存在');return result.rows[0];};
const parameter=value=>typeof value==='string'?value:{
 name:typeof value?.name==='string'?value.name:'',
 type:typeof value?.type==='string'?value.type:'',
 description:typeof value?.description==='string'?value.description:'',
};

// Student metadata is an allowlist: legacy translations, teacher notes and
// arbitrary import fields must not become public merely by being in metadata.
export function publicProblemMetadata(value,{complete=false}={}){
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const metadata={};
 for(const key of textKeys)if(typeof source[key]==='string')metadata[key]=source[key];else if(complete)metadata[key]='';
 if(Array.isArray(source.parameters))metadata.parameters=source.parameters.map(parameter);
 else if(complete)metadata.parameters=[];
 return metadata;
}
export const publicStatementSourceHash=version=>canonicalHash({
 versionId:version.id,statement:version.statement,metadata:publicProblemMetadata(version.metadata,{complete:true}),
});
const shape=row=>({versionId:row.version_id,language:row.language,statement:row.statement,metadata:row.metadata,
 sourceHash:row.source_hash,contentHash:row.content_hash,authorAccountId:row.author_account_id,
 reviewerAccountId:row.reviewer_account_id,publishedAt:row.published_at});

function inputMetadata(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!metadataKeys.includes(key)))fail(400,'VALIDATION','公开题面元数据只能包含明确的学生说明字段');
 const metadata={};
 for(const key of textKeys)metadata[key]=value[key]==null?'':field(value[key],key,{min:0,max:4000,trim:false});
 if(value.parameters!=null&&(!Array.isArray(value.parameters)||value.parameters.length>30))fail(400,'VALIDATION','parameters 须为最多 30 项的数组');
 metadata.parameters=(value.parameters??[]).map(item=>{
  if(typeof item==='string')return field(item,'parameter',{min:0,max:4000,trim:false});
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['name','type','description'].includes(key)))fail(400,'VALIDATION','参数仅可包含名称、类型和说明');
  return {name:field(item.name??'','parameter name',{min:0,max:200,trim:false}),
   type:field(item.type??'','parameter type',{min:0,max:200,trim:false}),
   description:field(item.description??'','parameter description',{min:0,max:4000,trim:false})};
 });
 return metadata;
}

export async function studentPublicStatementRows(db,rows){
 if(!rows.length)return rows;
 const ids=[...new Set(rows.map(row=>row.id))];
 const presentations=new Map((await db.query(`SELECT v.id version_id,p.statement,p.metadata,p.language,
  EXISTS(SELECT 1 FROM problem_public_statements configured JOIN problem_versions source ON source.id=configured.version_id
   WHERE source.problem_id=v.problem_id) english_required
  FROM problem_versions v LEFT JOIN problem_public_statements p ON p.version_id=v.id
  WHERE v.id=ANY($1::uuid[])`,[ids])).rows.map(row=>[row.version_id,row]));
 return rows.map(row=>{
  const published=presentations.get(row.id);
  if(published?.language)return {...row,statement:published.statement,metadata:published.metadata,statement_language:published.language,public_statement_pending:false};
  // Once a stable problem uses reviewed English, an older or newly published
  // version must not expose its stored Chinese merely because its presentation
  // has not been reviewed yet. Native Chinese problems remain unchanged.
  if(published?.english_required)return {...row,
   statement:'The English statement for this version is awaiting review. Please contact your teacher.',
   metadata:publicProblemMetadata({}, {complete:true}),statement_language:'en',public_statement_pending:true};
  return row;
 });
}

export async function handleProblemPublicStatements(ctx){
 const {route,method,user,pool,helpers={},url,body={}}=ctx;
 if(route!=='/luq/public-statements'||!['GET','POST'].includes(method))return null;
 if(!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
 const input=method==='GET'?Object.fromEntries(url.searchParams):body;
 const problemId=uuid(input.problemId,'题目 ID').toLowerCase(),versionId=uuid(input.versionId,'版本 ID').toLowerCase();
 if(method==='GET'){
  await resolveAssistanceTarget(pool,user,{problemId,versionId},{manage:true,helpers});
  const source=one(await pool.query('SELECT id,statement,metadata FROM problem_versions WHERE id=$1 AND problem_id=$2',[versionId,problemId]));
  const published=(await pool.query('SELECT * FROM problem_public_statements WHERE version_id=$1',[versionId])).rows[0];
  return {status:200,body:{problemId,versionId,sourceHash:publicStatementSourceHash(source),presentation:published?shape(published):null}};
 }
 if(body.reviewed!==true)fail(400,'REVIEW_REQUIRED','请确认已核对英文题面与原题等价，且不含答案、隐藏测试或教师私有批注');
 const language=enumValue(body.language,['en'],'公开题面语言');
 const statement=field(body.statement,'公开题面',{max:262144,trim:false});
 if(!statement.trim())fail(400,'VALIDATION','公开题面不能为空');
 const metadata=inputMetadata(body.metadata);
 if(typeof body.sourceHash!=='string'||!/^[0-9a-f]{64}$/.test(body.sourceHash))fail(400,'VALIDATION','原题快照无效，请重新读取版本');
 return transaction(pool,async db=>{
  await resolveAssistanceTarget(db,user,{problemId,versionId},{manage:true,helpers});
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('problem-public-statement:'||$1,0))",[versionId]);
  const source=one(await db.query('SELECT id,statement,metadata,published_at FROM problem_versions WHERE id=$1 AND problem_id=$2 FOR SHARE',[versionId,problemId]));
  if(!source.published_at)fail(409,'VERSION_NOT_PUBLISHED','请先发布题目版本，再审核发布其公开英文题面');
  if(publicStatementSourceHash(source)!==body.sourceHash)fail(409,'SOURCE_CHANGED','原题内容已修改，请重新核对后发布');
  const contentHash=canonicalHash({versionId,language,statement,metadata,sourceHash:body.sourceHash});
  const old=(await db.query('SELECT * FROM problem_public_statements WHERE version_id=$1',[versionId])).rows[0];
  if(old){
   if(old.content_hash!==contentHash)fail(409,'PUBLISHED_STATEMENT_IMMUTABLE','此版本的公开题面已经发布，不能覆盖；请创建新的题目版本');
   return {status:200,body:shape(old)};
  }
  const saved=one(await db.query(`INSERT INTO problem_public_statements
   (version_id,language,statement,metadata,source_hash,content_hash,author_account_id,reviewer_account_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,[versionId,language,statement,metadata,body.sourceHash,contentHash,user.id]));
  await db.query(`INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata)
   VALUES($1,'problem.public_statement_publish','problem_version',$2,$3)`,
  [user.id,versionId,{problemId,versionId,language,sourceHash:body.sourceHash,contentHash}]);
  return {status:201,body:shape(saved)};
 });
}
