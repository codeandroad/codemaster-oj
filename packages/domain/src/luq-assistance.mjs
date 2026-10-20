import {transaction} from './db.mjs';
import {fail,field,uuid,enumValue,canonicalHash,integer} from './security.mjs';
import {postLuqEntry,getLuqSettings} from './luq-ledger.mjs';
import {luqActivityAccess} from './luq-rules.mjs';
import {assistanceKind,assistanceLanguage,resolveAssistanceTarget,resolveAssistancePolicy,assistancePolicyTarget,lockLuqAssistance,isLuqStaff} from './luq-access.mjs';

const response=(body,status=200)=>({status,body});
const one=result=>{if(!result.rowCount)fail(404,'NOT_FOUND','辅助内容不存在');return result.rows[0];};
const contentHash=r=>canonicalHash({id:r.id,subjectKey:r.subject_key,versionId:r.version_id,kind:r.kind,language:r.language,body:r.body});
const contentShape=r=>({id:r.id,subjectKey:r.subject_key,versionId:r.version_id,kind:r.kind,language:r.language,body:r.body,status:r.status,authorAccountId:r.author_account_id,reviewerAccountId:r.reviewer_account_id,publishedAt:r.published_at,contentHash:contentHash(r)});
const policyShape=r=>({id:r.id,targetType:r.target_type,targetId:r.target_id,kind:r.kind,mode:r.mode,opensAt:r.opens_at,price:r.price??null,ruleVersion:r.rule_version});
const inputFromUrl=url=>Object.fromEntries(url.searchParams.entries());
async function audit(db,user,action,type,id,metadata={}){
 await db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[user.id,action,type,String(id),metadata]);
}
async function balance(db,identityId){return Number((await db.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[identityId])).rows[0]?.balance??0);}
async function aidState(db,user,input,helpers){
 const kind=assistanceKind(input.kind),language=assistanceLanguage(kind,input.language);
 const target=await resolveAssistanceTarget(db,user,input,{helpers});
 const policy=await resolveAssistancePolicy(db,user,target,kind);
 const content=(await db.query(`SELECT id FROM luq_assistance_contents WHERE subject_key=$1 AND version_id=$2
  AND kind=$3 AND language=$4 AND status='published' AND published_at IS NOT NULL`,[target.subjectKey,target.versionId,kind,language])).rows[0];
 const entitlement=(await db.query(`SELECT id,ledger_id FROM luq_assistance_entitlements
  WHERE identity_id=$1 AND subject_key=$2 AND kind=$3 AND language=$4`,[user.identityId,target.subjectKey,kind,language])).rows[0];
 const settings=await getLuqSettings(db),cost=policy.price??(kind==='FULL_TRANSLATION'?settings.translationPrice:settings.solutionPrice);
 if(policy.mode==='paid'&&cost===0)policy.mode='free';
 const currentBalance=await balance(db,user.identityId);
 const price=policy.mode==='free'||entitlement?0:cost;
 const available=!!content&&policy.mode!=='disabled';
 return {target,kind,language,policy,content,entitlement,quote:{available,mode:policy.mode,unlocked:!!entitlement,
  price,balance:currentBalance,balanceAfter:currentBalance-price,contentId:available?content.id:null,
  requiresConfirmation:available&&price>0,affectsFirstAcLuq:kind==='FULL_SOLUTION',
  reason:!content?'此版本尚无已审核发布的辅助内容':policy.reason??null}};
}
function assertAvailable(state){
 if(state.policy.mode==='disabled')fail(403,'ASSISTANCE_LOCKED',state.quote.reason);
 if(!state.content)fail(404,'ASSISTANCE_UNAVAILABLE','此版本尚无已审核发布的辅助内容');
}
async function contentTarget(db,user,row,helpers){
 const bits=row.subject_key.split(':');
 const paper=bits[0]==='paper4'?one(await db.query('SELECT paper_id FROM paper4_versions WHERE id=$1',[row.version_id])):null;
 return resolveAssistanceTarget(db,user,bits[0]==='problem'?{problemId:bits[1],versionId:row.version_id}:{paperId:paper.paper_id,versionId:row.version_id,questionKey:bits[2]}, {manage:true,helpers});
}

export async function handleLuqAssistance(ctx){
 const {pool,user,route,method,body={},url,helpers={}}=ctx;
 if(route==='/luq/assistance/quote'&&method==='POST'){
  return response((await aidState(pool,user,body,helpers)).quote);
 }
 if(route==='/luq/assistance/unlock'&&method==='POST'){
  const requestKey=uuid(body.requestKey,'请求键');
  return response(await transaction(pool,async db=>{
   await lockLuqAssistance(db,user.identityId);
   const state=await aidState(db,user,body,helpers);assertAvailable(state);
   const requestHash=canonicalHash({subjectKey:state.target.subjectKey,kind:state.kind,language:state.language});
   const old=(await db.query('SELECT request_hash,metadata FROM luq_ledger WHERE request_key=$1',[`${user.identityId}:${requestKey}`])).rows[0];
   if(old&&old.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','同一请求键不能用于不同辅助内容');
   if(state.entitlement||state.policy.mode==='free')return {unlocked:!!state.entitlement,balance:state.quote.balance,charged:0,entitlementId:state.entitlement?.id??null};
   if(body.confirmedContentId!==state.content.id||body.confirmedPrice!==state.quote.price)fail(409,'QUOTE_CHANGED','内容或价格已更新，请重新确认');
   if(state.quote.balance<state.quote.price)fail(409,'INSUFFICIENT_LUQ','Luq 余额不足');
   const entry=await postLuqEntry(db,{identityId:user.identityId,delta:-state.quote.price,kind:'purchase',
    sourceKey:`purchase:${user.identityId}:${state.target.subjectKey}:${state.kind}:${state.language}`,
    requestKey:`${user.identityId}:${requestKey}`,requestHash,actorAccountId:user.id,reason:`解锁 ${state.kind}`,
    metadata:{subjectKey:state.target.subjectKey,kind:state.kind,language:state.language,contentId:state.content.id}});
   const entitlement=one(await db.query(`INSERT INTO luq_assistance_entitlements(identity_id,subject_key,kind,language,ledger_id)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[user.identityId,state.target.subjectKey,state.kind,state.language,entry.id]));
   await audit(db,user,'luq.assistance_unlock','luq_entitlement',entitlement.id,{ledgerId:entry.id});
   return {unlocked:true,balance:entry.balanceAfter,charged:state.quote.price,entitlementId:entitlement.id};
  }));
 }
 if(route==='/luq/assistance/provide'&&method==='POST'){
  return response(await transaction(pool,async db=>{
   await lockLuqAssistance(db,user.identityId);
   const state=await aidState(db,user,body,helpers);assertAvailable(state);
   if(state.policy.mode!=='free'&&!state.entitlement)fail(403,'UNLOCK_REQUIRED','请先确认并解锁辅助内容');
   // Body is fetched only after both current permission and entitlement have passed.
   const content=one(await db.query(`SELECT body FROM luq_assistance_contents WHERE id=$1 AND status='published' FOR SHARE`,[state.content.id]));
   const delivery=one(await db.query(`INSERT INTO luq_assistance_deliveries
    (identity_id,subject_key,version_id,kind,language,content_id,entitlement_id,context_type,context_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,provided_at`,[user.identityId,state.target.subjectKey,state.target.versionId,state.kind,state.language,state.content.id,state.entitlement?.id??null,state.target.contextType,state.target.contextId]));
   return {body:content.body,kind:state.kind,language:state.language,providedAt:delivery.provided_at,contentId:state.content.id,deliveryId:delivery.id};
  }));
 }
 if(route==='/luq/contents/review'&&method==='GET'){
  if(!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
  const targetType=enumValue(url.searchParams.get('targetType'),['problem','paper4'],'内容目标');
  // Match the existing authoring permissions, including editable shared banks.
  // Only reviewed-content bodies are read internally to identify the exact
  // preview snapshot; reference solutions, tests and private notes are not read.
  const subjects=targetType==='problem'?`
   SELECT p.id target_id,v.title,v.id version_id,'problem:'||p.id subject_key,
    NULL::text question_key,NULL::text question_title,0::bigint position
   FROM problems p JOIN problem_banks b ON b.id=p.bank_id
   JOIN LATERAL (
    SELECT id,title FROM problem_versions WHERE problem_id=p.id
    ORDER BY (id=p.current_version_id) DESC,created_at DESC,id DESC LIMIT 1
   ) v ON true
   WHERE p.archived_at IS NULL AND b.archived_at IS NULL AND
    ($2::boolean OR p.owner_account_id=$1 OR b.owner_account_id=$1 OR EXISTS(
      SELECT 1 FROM bank_permissions bp WHERE bp.bank_id=b.id AND bp.account_id=$1 AND bp.permission='edit'))`:
   `SELECT p.id target_id,p.title,v.id version_id,'paper4:'||p.id||':'||(q.question->>'key') subject_key,
     q.question->>'key' question_key,q.question->>'title' question_title,q.position
    FROM paper4_papers p JOIN paper4_versions v ON v.id=p.current_version_id AND v.paper_id=p.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.definition->'questions','[]'::jsonb)) WITH ORDINALITY q(question,position)
    WHERE p.delivery_kind='catalog' AND p.archived_at IS NULL AND ($2::boolean OR p.owner_account_id=$1)`;
  const rows=(await pool.query(`WITH subjects AS (${subjects})
   SELECT s.*,c.id,c.kind,c.language,c.body,c.status,c.published_at
   FROM subjects s LEFT JOIN luq_assistance_contents c ON c.subject_key=s.subject_key AND c.version_id=s.version_id
    AND c.kind='FULL_SOLUTION' AND c.language=''
   ORDER BY s.title,s.target_id,s.position`,[user.id,user.roles.includes('admin')])).rows;
  const counts={published:0,draft:0,missing:0,withdrawn:0};
  const items=rows.map(row=>{
   const status=row.id?row.status:'missing';counts[status]++;
   return {targetType,targetId:row.target_id,title:row.title,
    ...(row.question_key?{questionKey:row.question_key,questionTitle:row.question_title}:{}),
    versionId:row.version_id,contentId:row.id??null,status,
    contentHash:row.id?contentHash(row):null,publishedAt:row.published_at??null};
  });
  return response({items,counts,total:items.length});
 }
 if(route==='/luq/contents/batch-publish'&&method==='POST'){
  if(!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
  if(body.reviewed!==true)fail(400,'REVIEW_REQUIRED','请确认已审核所选正文，且不含教师私有批注或隐藏测试');
  const requestId=uuid(body.requestId,'请求编号').toLowerCase();
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>500)fail(400,'VALIDATION','每批请选择 1–500 项参考答案');
  const items=body.items.map(item=>{
   const contentId=uuid(item?.contentId,'辅助内容编号').toLowerCase();
   if(typeof item?.expectedHash!=='string'||!/^[0-9a-f]{64}$/.test(item.expectedHash))fail(400,'VALIDATION','审核内容快照无效，请刷新后重新预览');
   return {contentId,expectedHash:item.expectedHash};
  }).sort((a,b)=>a.contentId.localeCompare(b.contentId));
  if(new Set(items.map(item=>item.contentId)).size!==items.length)fail(400,'VALIDATION','同一参考答案不能重复选择');
  const requestHash=canonicalHash({actor:user.id,items});
  return response(await transaction(pool,async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-content-batch:'||$1,0))",[requestId]);
   const previous=(await db.query('SELECT actor_account_id,request_hash,result FROM luq_content_batches WHERE request_id=$1',[requestId])).rows[0];
   if(previous){
    if(previous.actor_account_id!==user.id||previous.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','此请求编号已用于其他审核内容');
    return previous.result;
   }
   const checked=[];
   // Lock in a stable order, using the same content-row lock as single publish
   // and draft edits. Validate every permission and preview before any update.
   for(const item of items){
    const row=one(await db.query('SELECT * FROM luq_assistance_contents WHERE id=$1 FOR UPDATE',[item.contentId]));
    await contentTarget(db,user,row,helpers);
    if(row.kind!=='FULL_SOLUTION'||row.language!=='')fail(400,'CONTENT_KIND','批量审核入口仅支持完整题解与参考代码');
    if(contentHash(row)!==item.expectedHash)fail(409,'CONTENT_CHANGED','所选参考答案已修改，请刷新并重新审核；本批次未发布');
    if(row.status==='withdrawn')fail(409,'CONTENT_WITHDRAWN','所选参考答案已撤回，请先修订为草稿后重新审核；本批次未发布');
    if(!row.body.trim())fail(409,'CONTENT_EMPTY','所选参考答案缺少正文；本批次未发布');
    checked.push(row);
   }
   const published=[];
   let publishedCount=0,alreadyPublishedCount=0;
   for(const row of checked){
    if(row.status==='published'){
     alreadyPublishedCount++;published.push({contentId:row.id,status:row.status,publishedAt:row.published_at?.toISOString()??null});continue;
    }
    const saved=one(await db.query(`UPDATE luq_assistance_contents SET status='published',reviewer_account_id=$2,
     published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING id,status,published_at`,[row.id,user.id]));
    publishedCount++;published.push({contentId:saved.id,status:saved.status,publishedAt:saved.published_at.toISOString()});
    await audit(db,user,'luq.content_publish','luq_content',row.id,{requestId,kind:row.kind,language:row.language,
     subjectKey:row.subject_key,versionId:row.version_id,contentHash:contentHash(row)});
   }
   const result={requestId,publishedCount,alreadyPublishedCount,items:published};
   await db.query('INSERT INTO luq_content_batches(request_id,actor_account_id,request_hash,result) VALUES($1,$2,$3,$4)',[requestId,user.id,requestHash,result]);
   await audit(db,user,'luq.content_batch_publish','luq_content_batch',requestId,{publishedCount,alreadyPublishedCount,items});
   return result;
  }));
 }
 if(route==='/luq/contents'&&method==='GET'){
  const target=await resolveAssistanceTarget(pool,user,inputFromUrl(url),{manage:true,helpers});
  const items=(await pool.query('SELECT * FROM luq_assistance_contents WHERE subject_key=$1 AND version_id=$2 ORDER BY kind,language',[target.subjectKey,target.versionId])).rows;
  return response({items:items.map(contentShape)});
 }
 if(route==='/luq/contents'&&method==='POST'){
  const kind=assistanceKind(body.kind),language=assistanceLanguage(kind,body.language),content=field(body.body,'辅助正文',{max:200000,trim:false});
  if(!content.trim())fail(400,'VALIDATION','辅助正文不能为空');
  return response(await transaction(pool,async db=>{
   const target=await resolveAssistanceTarget(db,user,body,{manage:true,helpers});
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-content:'||$1,0))",[`${target.subjectKey}:${target.versionId}:${kind}:${language}`]);
   const old=(await db.query('SELECT id,status FROM luq_assistance_contents WHERE subject_key=$1 AND version_id=$2 AND kind=$3 AND language=$4 FOR UPDATE',[target.subjectKey,target.versionId,kind,language])).rows[0];
   if(old?.status==='published')fail(409,'PUBLISHED_CONTENT_IMMUTABLE','已发布辅助内容不可覆盖，请在新的题目版本中修订');
   const saved=old?one(await db.query("UPDATE luq_assistance_contents SET body=$2,status='draft',updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[old.id,content])):
    one(await db.query(`INSERT INTO luq_assistance_contents(subject_key,version_id,kind,language,body,status,author_account_id)
     VALUES($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,[target.subjectKey,target.versionId,kind,language,content,user.id]));
   await audit(db,user,'luq.content_draft','luq_content',saved.id,{subjectKey:target.subjectKey,versionId:target.versionId,kind,language});
   return contentShape(saved);
  }),201);
 }
 const publish=route.match(/^\/luq\/contents\/([^/]+)\/publish$/);
 if(publish&&method==='POST'){
  if(body.reviewed!==true)fail(400,'REVIEW_REQUIRED','请确认已审核正文，且不含教师私有批注或隐藏测试');
  return response(await transaction(pool,async db=>{
   const row=one(await db.query('SELECT * FROM luq_assistance_contents WHERE id=$1 FOR UPDATE',[uuid(publish[1])]));
   await contentTarget(db,user,row,helpers);
   if(row.status==='published')return contentShape(row);
   const saved=one(await db.query("UPDATE luq_assistance_contents SET status='published',reviewer_account_id=$2,published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[row.id,user.id]));
   await audit(db,user,'luq.content_publish','luq_content',row.id,{kind:row.kind,language:row.language});
   return contentShape(saved);
  }));
 }
 if(route==='/luq/policies'&&method==='GET'){
  const {targetType,targetId}=inputFromUrl(url);
  let target,canManage=true,frozen=false;
  if(['assignment','timed','paper4_activity'].includes(targetType)){
   const access=await luqActivityAccess(pool,user,targetType,targetId);
   target=access.activity;canManage=access.canManage;frozen=access.frozen;
  }else target=await assistancePolicyTarget(pool,user,targetType,targetId);
  const rows=(await pool.query(`SELECT DISTINCT ON(kind) * FROM luq_assistance_policies WHERE target_type=$1 AND target_id=$2 ORDER BY kind,rule_version DESC`,[targetType,targetId])).rows;
  const mode=targetType==='timed'||targetType==='paper4_activity'&&target.activity_kind==='exam'?'disabled':'paid';
  return response({items:['FULL_TRANSLATION','FULL_SOLUTION'].map(kind=>{
   const found=rows.find(row=>row.kind===kind);
   return found?policyShape(found):{id:null,targetType,targetId,kind,mode,opensAt:null,price:null,ruleVersion:0};
  }),canManage,frozen});
 }

 if(route==='/luq/policies'&&method==='POST'){
  const {targetType,targetId}=body,kind=assistanceKind(body.kind),mode=enumValue(body.mode,['disabled','paid','free'],'辅助模式');
  if(body.price!==undefined&&body.price!==null&&!['problem','paper4'].includes(targetType))fail(400,'VALIDATION','活动价格沿用题目的解锁价格');
  const requestedPrice=body.price===undefined?undefined:body.price===null?null:integer(body.price,0,1000,'解锁价格');
  let opensAt=null;
  if(body.opensAt){opensAt=new Date(body.opensAt);if(!Number.isFinite(opensAt.getTime()))fail(400,'VALIDATION','开放时间无效');}
  return response(await transaction(pool,async db=>{
   await assistancePolicyTarget(db,user,targetType,targetId,{write:true});
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-policy:'||$1,0))",[`${targetType}:${targetId}:${kind}`]);
   const previous=(await db.query('SELECT price FROM luq_assistance_policies WHERE target_type=$1 AND target_id=$2 AND kind=$3 ORDER BY rule_version DESC LIMIT 1',[targetType,targetId,kind])).rows[0];
   const price=requestedPrice===undefined?previous?.price??null:requestedPrice;
   const row=one(await db.query(`INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,opens_at,price,rule_version,created_by)
    SELECT $1,$2,$3,$4,$5,$7,COALESCE(MAX(rule_version),0)+1,$6 FROM luq_assistance_policies WHERE target_type=$1 AND target_id=$2 AND kind=$3 RETURNING *`,[targetType,targetId,kind,mode,opensAt,user.id,price]));
   await audit(db,user,'luq.policy_version','luq_policy',row.id,{targetType,targetId,kind,ruleVersion:row.rule_version});return policyShape(row);
  }),201);
 }
 if(route==='/luq/policies/batch-prices'&&method==='POST'){
  if(!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
  const requestId=uuid(body.requestId,'请求编号'),targetType=enumValue(body.targetType,['problem','paper4'],'规则目标');
  if(!Array.isArray(body.targetIds)||!body.targetIds.length||body.targetIds.length>500)fail(400,'VALIDATION','每批请选择 1–500 个题目或试卷');
  const targetIds=[...new Set(body.targetIds.map(id=>uuid(id,'题目或试卷')))].sort();
  if(!body.prices||typeof body.prices!=='object'||Array.isArray(body.prices))fail(400,'VALIDATION','请选择要配置的辅助类型');
  const prices=Object.fromEntries(Object.keys(body.prices).sort().map(key=>[assistanceKind(key),body.prices[key]===null?null:integer(body.prices[key],0,1000,'解锁价格')]));
  if(!Object.keys(prices).length)fail(400,'VALIDATION','请选择要配置的辅助类型');
  const requestHash=canonicalHash({actor:user.id,targetType,targetIds,prices});
  return response(await transaction(pool,async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-price-batch:'||$1,0))",[requestId]);
   const old=(await db.query('SELECT * FROM luq_price_batches WHERE request_id=$1',[requestId])).rows[0];
   if(old){if(old.actor_account_id!==user.id||old.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','此请求编号已用于其他配置');return old.result;}
   // Authorize and lock every target before writing any policy. Sorted lock order
   // also protects overlapping concurrent batches from partial application.
   for(const id of targetIds)await assistancePolicyTarget(db,user,targetType,id,{write:true});
   const items=[];
   for(const targetId of targetIds)for(const [kind,price]of Object.entries(prices)){
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-policy:'||$1,0))",[`${targetType}:${targetId}:${kind}`]);
    const previous=(await db.query('SELECT * FROM luq_assistance_policies WHERE target_type=$1 AND target_id=$2 AND kind=$3 ORDER BY rule_version DESC LIMIT 1',[targetType,targetId,kind])).rows[0];
    const row=one(await db.query(`INSERT INTO luq_assistance_policies(target_type,target_id,kind,mode,opens_at,price,rule_version,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[targetType,targetId,kind,previous?.mode??'paid',previous?.opens_at??null,price,(previous?.rule_version??0)+1,user.id]));
    items.push(policyShape(row));
   }
   // Publication is an independent, version-specific action. Read only safe
   // status metadata after every target has passed authorization; pricing must
   // never copy reference code, inspect tests, or publish an existing draft.
   const kinds=Object.keys(prices);
   const subjects=targetType==='problem'?`
    SELECT p.id target_id,'problem:'||p.id subject_key,v.id version_id,NULL::text question_key,0::bigint question_position
    FROM problems p LEFT JOIN LATERAL (
     SELECT id FROM problem_versions WHERE problem_id=p.id
     ORDER BY (id=p.current_version_id) DESC,created_at DESC,id DESC LIMIT 1
    ) v ON true WHERE p.id=ANY($1::uuid[])`:
    `SELECT p.id target_id,'paper4:'||p.id||':'||(q.question->>'key') subject_key,v.id version_id,
      q.question->>'key' question_key,q.position question_position
     FROM paper4_papers p LEFT JOIN paper4_versions v ON v.id=p.current_version_id
     LEFT JOIN LATERAL jsonb_array_elements(COALESCE(v.definition->'questions','[]'::jsonb)) WITH ORDINALITY q(question,position) ON true
     WHERE p.id=ANY($1::uuid[])`;
   const statuses=(await db.query(`WITH subjects AS (${subjects})
    SELECT s.target_id,s.question_key,k.kind,c.status,c.published_at IS NOT NULL has_publication
    FROM subjects s CROSS JOIN unnest($2::text[]) k(kind)
    LEFT JOIN luq_assistance_contents c ON c.subject_key=s.subject_key AND c.version_id=s.version_id
     AND c.kind=k.kind AND c.language=CASE WHEN k.kind='FULL_TRANSLATION' THEN 'zh-CN' ELSE '' END
    ORDER BY s.target_id,s.question_position,k.kind`,[targetIds,kinds])).rows;
   const publication=kinds.map(kind=>{
    const rows=statuses.filter(row=>row.kind===kind);
    const state=row=>row.status==='published'&&row.has_publication?'published':row.status==='withdrawn'?'withdrawn':row.status?'draft':'missing';
    const first=rows.find(row=>state(row)!=='published');
    return {kind,total:rows.length,published:rows.filter(row=>state(row)==='published').length,
     draft:rows.filter(row=>state(row)==='draft').length,withdrawn:rows.filter(row=>state(row)==='withdrawn').length,
     missing:rows.filter(row=>state(row)==='missing').length,
     firstUnpublished:first?{targetId:first.target_id,...(first.question_key?{questionKey:first.question_key}:{})}:null};
   });
   // Persist the publication snapshot with the price result so retries retain
   // the original response. Older stored results may omit this additive field.
   const result={requestId,count:targetIds.length,items,publication};
   await db.query('INSERT INTO luq_price_batches(request_id,actor_account_id,request_hash,result) VALUES($1,$2,$3,$4)',[requestId,user.id,requestHash,result]);
   await audit(db,user,'luq.price_batch','luq_price_batch',requestId,{targetType,targetIds,prices,count:targetIds.length});
   return result;
  }));
 }
 if(route==='/luq/usage'&&method==='GET'){
  if(!isLuqStaff(user))fail(403,'FORBIDDEN','需要教师权限');
  const {targetType,targetId}=inputFromUrl(url);await assistancePolicyTarget(pool,user,targetType,targetId);
  const subject=targetType==='problem'?`problem:${targetId}`:targetType==='paper4'?`paper4:${targetId}:`:null;
  const result=await pool.query(`SELECT d.*,i.name student_name FROM luq_assistance_deliveries d JOIN identities i ON i.id=d.identity_id
   WHERE ($1::text IS NOT NULL AND (d.subject_key=$1 OR left(d.subject_key,length($1))=$1))
    OR ($1::text IS NULL AND d.context_type=$2 AND d.context_id=$3) ORDER BY d.provided_at DESC,d.id DESC LIMIT 500`,[subject,targetType,targetId]);
  return response({items:result.rows.map(r=>({id:r.id,identityId:r.identity_id,studentName:r.student_name,subjectKey:r.subject_key,versionId:r.version_id,kind:r.kind,language:r.language,contextType:r.context_type,contextId:r.context_id,providedAt:r.provided_at}))});
 }
 return null;
}
