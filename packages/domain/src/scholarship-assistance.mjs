import {transaction} from './db.mjs';
import {fail,uuid,enumValue,canonicalHash,integer} from './security.mjs';
import {postScholarshipEntry,getScholarshipSettings} from './scholarship-ledger.mjs';
import {scholarshipActivityAccess} from './scholarship-rules.mjs';
import {assistanceKind,assistanceLanguage,resolveAssistanceTarget,resolveAssistancePolicy,assistancePolicyTarget,hasLegacyPracticeAc,lockScholarshipAssistance,isScholarshipStaff} from './scholarship-access.mjs';
import {approvedAssistanceContent,editableAssistanceContent,originalProblemSolution,pendingSolution,readAssistanceDraft} from './problem-solution-bundles.mjs';
import {sharedSolutionIdSql,sharedProblemSolution,retainSharedSolution,assertSharedSolution} from './shared-problem-solutions.mjs';
import {withProblemSolutionUsage} from './problem-solution-usage.mjs';

const response=(body,status=200)=>({status,body});
const one=result=>{if(!result.rowCount)fail(404,'NOT_FOUND','辅助内容不存在');return result.rows[0];};
const contentHash=r=>{
 const {body,solutions}=editableAssistanceContent(r);
 return canonicalHash({id:r.id,subjectKey:r.subject_key,versionId:r.version_id,kind:r.kind,language:r.language,body,solutions});
};
const contentShape=r=>({id:r.id,subjectKey:r.subject_key,versionId:r.version_id,kind:r.kind,language:r.language,...editableAssistanceContent(r),status:r.status,authorAccountId:r.author_account_id,reviewerAccountId:r.reviewer_account_id,publishedAt:r.published_at,contentHash:contentHash(r)});
const policyShape=r=>({id:r.id,targetType:r.target_type,targetId:r.target_id,kind:r.kind,mode:r.mode,opensAt:r.opens_at,price:r.price??null,ruleVersion:r.rule_version});
const inputFromUrl=url=>Object.fromEntries(url.searchParams.entries());
async function audit(db,user,action,type,id,metadata={}){
 await db.query('INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',[user.id,action,type,String(id),metadata]);
}
async function publishAssistanceContent(db,user,row,requestId){
 const saved=one(await db.query(`UPDATE luq_assistance_contents SET
  status='published',reviewer_account_id=$2,published_at=clock_timestamp(),updated_at=clock_timestamp(),
  body=COALESCE(pending_solution->>'body',body),solution_details=COALESCE(pending_solution->'details',solution_details),pending_solution=NULL
  WHERE id=$1 RETURNING *`,[row.id,user.id]));
 await audit(db,user,'luq.content_publish','luq_content',row.id,{requestId,kind:row.kind,language:row.language,
  subjectKey:row.subject_key,versionId:row.version_id,contentHash:contentHash(row)});
 return saved;
}
async function balance(db,identityId){return Number((await db.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[identityId])).rows[0]?.balance??0);}
async function aidState(db,user,input,helpers){
 const kind=assistanceKind(input.kind),language=assistanceLanguage(kind,input.language);
 const target=helpers.assistanceTarget?await helpers.assistanceTarget(db,user,input):await resolveAssistanceTarget(db,user,input,{helpers});
 const policy=await resolveAssistancePolicy(db,user,target,kind);
 const restriction=helpers.assistanceRestriction?await helpers.assistanceRestriction(db,user,target,kind):null;
 if(restriction?.mode==='disabled')Object.assign(policy,restriction);
 const shared=kind==='FULL_SOLUTION'&&target.subjectKey===`problem:${target.problemId}`;
 const foundContent=shared ? await sharedProblemSolution(db,target.problemId,target.versionId) : (await db.query(`SELECT id,status,published_at FROM luq_assistance_contents WHERE subject_key=$1 AND version_id=$2
  AND kind=$3 AND language=$4`,[target.subjectKey,target.versionId,kind,language])).rows[0];
 const content=foundContent?.status==='published'&&foundContent.published_at?foundContent:null;
 const entitlement=(await db.query(`SELECT id,ledger_id FROM luq_assistance_entitlements
  WHERE identity_id=$1 AND subject_key=$2 AND kind=$3 AND language=$4`,[user.identityId,target.subjectKey,kind,language])).rows[0];
 const settings=await getScholarshipSettings(db);
 const basePrice=policy.price??(kind==='FULL_TRANSLATION'?settings.translationPrice:settings.solutionPrice);
 const freeAfterAc=!!content&&kind==='FULL_SOLUTION'&&policy.mode==='paid'&&basePrice>0&&!!target.problemId
  &&!target.contextId&&!policy.activityPaid&&!restriction?.activityPaid
  &&await (helpers.hasPracticeAc??hasLegacyPracticeAc)(db,user,target);
 if(freeAfterAc)policy.mode='free';
 if(policy.mode==='paid'&&basePrice===0)policy.mode='free';
 let translationPurchase=null;
 if(content&&kind==='FULL_SOLUTION'&&policy.mode==='paid'&&!entitlement){
  translationPurchase=(await db.query(`SELECT l.id,-l.delta paid FROM luq_assistance_entitlements e
   JOIN luq_ledger l ON l.id=e.ledger_id AND l.identity_id=e.identity_id AND l.kind='purchase'
   WHERE e.identity_id=$1 AND e.subject_key=$2 AND e.kind='FULL_TRANSLATION' AND e.language='zh-CN'
     AND NOT EXISTS (SELECT 1 FROM luq_ledger refund WHERE refund.refund_of=l.id)`,
  [user.identityId,target.subjectKey])).rows[0]??null;
 }
 const translationCredit=Math.min(basePrice,translationPurchase?.paid??0);
 const currentBalance=await balance(db,user.identityId);
 const price=policy.mode==='free'||entitlement?0:basePrice-translationCredit;
 const available=!!content&&policy.mode!=='disabled';
 const affectsFirstAcScholarship=kind==='FULL_SOLUTION';
 return {target,kind,language,policy,content,entitlement,translationPurchase,quote:{available,mode:policy.mode,unlocked:!!entitlement,
  price,basePrice,translationCredit,balance:currentBalance,balanceAfter:currentBalance-price,contentId:available?content.id:null,
  requiresConfirmation:available&&policy.mode==='paid'&&!entitlement,affectsFirstAcScholarship,affectsFirstAcLuq:affectsFirstAcScholarship,
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

export async function studentAssistanceOperation(db,user,action,body={},helpers={}){
 if(action==='quote'){
  return (await aidState(db,user,body,helpers)).quote;
 }
 if(action==='unlock'){
  const requestKey=uuid(body.requestKey,'请求键');
   await lockScholarshipAssistance(db,user.identityId);
   // Refunds take this wallet lock in luq_post_entry. Keep the credit lookup
   // and entitlement insert in the same wallet transaction as the charge.
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-account:'||$1::text,0))",[user.identityId]);
   const state=await aidState(db,user,body,helpers);assertAvailable(state);
   const requestHash=canonicalHash({subjectKey:state.target.subjectKey,kind:state.kind,language:state.language});
   const scopedRequestKey=`${user.identityId}:${requestKey}`;
   const old=(await db.query(`SELECT request_hash FROM luq_ledger WHERE request_key=$1
    UNION ALL SELECT request_hash FROM luq_assistance_entitlements WHERE request_key=$1`,[scopedRequestKey])).rows[0];
   if(old&&old.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','同一请求键不能用于不同辅助内容');
   if(state.entitlement||state.policy.mode==='free')return {unlocked:!!state.entitlement,balance:state.quote.balance,charged:0,entitlementId:state.entitlement?.id??null};
   if(body.confirmedContentId!==state.content.id||body.confirmedPrice!==state.quote.price)fail(409,'QUOTE_CHANGED','内容或价格已更新，请重新确认');
   if(state.quote.balance<state.quote.price)fail(409,'INSUFFICIENT_LUQ','奖学金余额不足');
   const {price,basePrice,translationCredit}=state.quote;
   const translationCreditLedgerId=state.translationPurchase?.id??null;
   const priceDetails={basePrice,translationCredit,translationCreditLedgerId};
   const entry=price>0?await postScholarshipEntry(db,{identityId:user.identityId,delta:-price,kind:'purchase',
    sourceKey:`purchase:${user.identityId}:${state.target.subjectKey}:${state.kind}:${state.language}`,
    requestKey:scopedRequestKey,requestHash,actorAccountId:user.id,reason:`解锁 ${state.kind}`,
    metadata:{subjectKey:state.target.subjectKey,kind:state.kind,language:state.language,contentId:state.content.id,...priceDetails}}):null;
   const entitlement=one(await db.query(`INSERT INTO luq_assistance_entitlements
    (identity_id,subject_key,kind,language,ledger_id,translation_credit_ledger_id,request_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[user.identityId,state.target.subjectKey,state.kind,state.language,
    entry?.id??null,translationCreditLedgerId,entry?null:scopedRequestKey,entry?null:requestHash]));
   await audit(db,user,'luq.assistance_unlock','luq_entitlement',entitlement.id,{ledgerId:entry?.id??null,...priceDetails});
   return {unlocked:true,balance:entry?.balanceAfter??state.quote.balance,charged:price,entitlementId:entitlement.id};
 }
 if(action==='provide'){
   await lockScholarshipAssistance(db,user.identityId);
   const state=await aidState(db,user,body,helpers);assertAvailable(state);
   if(state.policy.mode!=='free'&&!state.entitlement)fail(403,'UNLOCK_REQUIRED','请先确认并解锁辅助内容');
   // Body is fetched only after both current permission and entitlement have passed.
   const content=one(await db.query(`SELECT id,body,solution_details FROM luq_assistance_contents WHERE id=$1 AND status='published' FOR SHARE`,[state.content.id]));
   const delivery=one(await db.query(`INSERT INTO luq_assistance_deliveries
    (identity_id,subject_key,version_id,kind,language,content_id,entitlement_id,context_type,context_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,provided_at`,[user.identityId,state.target.subjectKey,state.target.versionId,state.kind,state.language,state.content.id,state.entitlement?.id??null,state.target.contextType,state.target.contextId]));
   return {...approvedAssistanceContent(content),kind:state.kind,language:state.language,providedAt:delivery.provided_at,contentId:state.content.id,deliveryId:delivery.id};
 }
 return null;
}

export async function handleScholarshipAssistance(ctx){
 const {pool,user,route,method,body={},url,helpers={}}=ctx;
 const studentAction=route.match(/^\/scholarship\/assistance\/(quote|unlock|provide)$/);
 if(studentAction&&method==='POST')return response(await transaction(pool,db=>studentAssistanceOperation(db,user,studentAction[1],body,helpers)));
 if(route==='/scholarship/contents/review'&&method==='GET'){
  if(!isScholarshipStaff(user))fail(403,'FORBIDDEN','需要教师权限');
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
   SELECT s.*,c.id,c.kind,c.language,c.body,c.status,c.published_at,c.solution_details,c.pending_solution,c.version_id content_version_id
   FROM subjects s LEFT JOIN luq_assistance_contents c ON c.subject_key=s.subject_key AND ${targetType==='problem'?`c.id=${sharedSolutionIdSql('s.target_id','s.version_id')}`:'c.version_id=s.version_id'}
    AND c.kind='FULL_SOLUTION' AND c.language=''
   ORDER BY s.title,s.target_id,s.position`,[user.id,user.roles.includes('admin')])).rows;
  const counts={published:0,draft:0,missing:0,withdrawn:0};
  const items=rows.map(row=>{
   const status=row.pending_solution?'draft':row.status??'missing';counts[status]++;
   return {targetType,targetId:row.target_id,title:row.title,
    ...(row.question_key?{questionKey:row.question_key,questionTitle:row.question_title}:{}),
    versionId:row.version_id,contentId:row.id??null,status,
    contentHash:row.id?contentHash({...row,version_id:row.content_version_id}):null,publishedAt:row.published_at??null,
    ...(row.pending_solution?{hasPendingSolutions:true}:{})};
  });
  return response({items,counts,total:items.length});
 }
 if(route==='/scholarship/contents/batch-publish'&&method==='POST'){
  if(!isScholarshipStaff(user))fail(403,'FORBIDDEN','需要教师权限');
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
    await assertSharedSolution(db,row);
    if(row.kind!=='FULL_SOLUTION'||row.language!=='')fail(400,'CONTENT_KIND','批量审核入口仅支持完整题解与参考代码');
    if(contentHash(row)!==item.expectedHash)fail(409,'CONTENT_CHANGED','所选参考答案已修改，请刷新并重新审核；本批次未发布');
    if(row.status==='withdrawn')fail(409,'CONTENT_WITHDRAWN','所选参考答案已撤回，请先修订为草稿后重新审核；本批次未发布');
    if(!editableAssistanceContent(row).body.trim())fail(409,'CONTENT_EMPTY','所选参考答案缺少正文；本批次未发布');
    checked.push(row);
   }
   const published=[];
   let publishedCount=0,alreadyPublishedCount=0;
   for(const row of checked){
    if(row.status==='published'&&!row.pending_solution){
     alreadyPublishedCount++;published.push({contentId:row.id,status:row.status,publishedAt:row.published_at?.toISOString()??null});continue;
    }
    const saved=await publishAssistanceContent(db,user,row,requestId);
    publishedCount++;published.push({contentId:saved.id,status:saved.status,publishedAt:saved.published_at.toISOString()});
   }
   const result={requestId,publishedCount,alreadyPublishedCount,items:published};
   await db.query('INSERT INTO luq_content_batches(request_id,actor_account_id,request_hash,result) VALUES($1,$2,$3,$4)',[requestId,user.id,requestHash,result]);
   await audit(db,user,'luq.content_batch_publish','luq_content_batch',requestId,{publishedCount,alreadyPublishedCount,items});
   return result;
  }));
 }
 if(route==='/scholarship/contents'&&method==='GET'){
  const target=await resolveAssistanceTarget(pool,user,inputFromUrl(url),{manage:true,helpers});
  let items=(await pool.query('SELECT * FROM luq_assistance_contents WHERE subject_key=$1 AND version_id=$2 ORDER BY kind,language',[target.subjectKey,target.versionId])).rows;
  let sharedSolution;
  if(target.problemId){
   const canonical=await sharedProblemSolution(pool,target.problemId,target.versionId);
   items=items.filter(item=>item.kind!=='FULL_SOLUTION');
   if(canonical)items.push(canonical);
   const history=(await pool.query(`SELECT c.*,v.created_at version_created_at FROM luq_assistance_contents c
    JOIN problem_versions v ON v.id=c.version_id AND v.problem_id=$1
    WHERE c.subject_key=$2 AND c.kind='FULL_SOLUTION' AND c.language='' AND ($3::uuid IS NULL OR c.id<>$3)
    ORDER BY c.updated_at DESC,c.id`,[target.problemId,target.subjectKey,canonical?.id??null])).rows;
   sharedSolution={shared:true,contentId:canonical?.id??null,legacySources:history.map(row=>({contentId:row.id,createdAt:row.version_created_at,status:row.status,
    ...approvedAssistanceContent(row),...(row.pending_solution?{pending:editableAssistanceContent(row)}:{})}))};
  }
  let originalSolution,inheritedSolution,versions,selection;
  if(target.problemId){
   const version=(await pool.query('SELECT metadata,reference_code,reference_language FROM problem_versions WHERE id=$1 AND problem_id=$2',[target.versionId,target.problemId])).rows[0];
   originalSolution=originalProblemSolution({editorial:version?.metadata?.editorial,referenceCode:version?.reference_code,referenceLanguage:version?.reference_language});
   if(!items.some(item=>item.kind==='FULL_SOLUTION'&&item.language==='')){
    const previous=(await pool.query(`SELECT c.id,c.body,c.solution_details,c.version_id FROM problem_versions v
     JOIN luq_assistance_contents c ON c.version_id=v.id AND c.subject_key=$2 AND c.kind='FULL_SOLUTION' AND c.language='' AND c.status='published' AND c.published_at IS NOT NULL
     WHERE v.problem_id=$1 AND v.id<>$3 AND v.created_at<=(SELECT created_at FROM problem_versions WHERE id=$3 AND problem_id=$1)
     ORDER BY v.created_at DESC,v.id DESC LIMIT 1`,[target.problemId,target.subjectKey,target.versionId])).rows[0];
    if(previous)inheritedSolution={versionId:previous.version_id,...approvedAssistanceContent(previous)};
   }
   const rows=(await pool.query(`SELECT v.id,v.title,v.created_at,v.published_at,v.id=p.current_version_id AS current,
    c.status,c.pending_solution IS NOT NULL AS has_pending,
    (SELECT count(DISTINCT ch.path_id)::integer FROM chapter_problems cp JOIN learning_chapters ch ON ch.id=cp.chapter_id
     JOIN learning_paths course ON course.id=ch.path_id
     WHERE cp.problem_id=p.id AND cp.version_id=v.id AND ch.archived_at IS NULL AND course.archived_at IS NULL) AS course_count
    FROM problem_versions v JOIN problems p ON p.id=v.problem_id
    LEFT JOIN luq_assistance_contents c ON c.subject_key=$2 AND c.version_id=v.id AND c.kind='FULL_SOLUTION' AND c.language=''
    WHERE v.problem_id=$1 ORDER BY v.created_at DESC,v.id DESC`,[target.problemId,target.subjectKey])).rows;
   versions=rows.map((row,index)=>({versionId:row.id,title:row.title,createdAt:row.created_at,current:row.current===true,latest:index===0,published:!!row.published_at,
    solutionStatus:row.has_pending?'draft':row.status??'missing',courseCount:row.course_count,...(row.has_pending?{hasPendingSolutions:true}:{})}));
   ({versions,...selection}=await withProblemSolutionUsage(pool,user,target.problemId,versions));
  }
  return response({items:items.map(contentShape),...(sharedSolution?{sharedSolution}:{}),...(originalSolution?{originalSolution}:{}),...(inheritedSolution?{inheritedSolution}:{}),...(versions?{versions,...selection}:{})});
 }
 if(route==='/scholarship/contents'&&method==='POST'){
  const kind=assistanceKind(body.kind),language=assistanceLanguage(kind,body.language);
  return response(await transaction(pool,async db=>{
   const target=await resolveAssistanceTarget(db,user,body,{manage:true,helpers});
   const shared=kind==='FULL_SOLUTION'&&!!target.problemId;
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('luq-content:'||$1,0))",[`${target.subjectKey}:${shared?'shared':target.versionId}:${kind}:${language}`]);
   const old=shared?await sharedProblemSolution(db,target.problemId,target.versionId,{lock:true}):(await db.query('SELECT * FROM luq_assistance_contents WHERE subject_key=$1 AND version_id=$2 AND kind=$3 AND language=$4 FOR UPDATE',[target.subjectKey,target.versionId,kind,language])).rows[0];
   if(old?.status==='published'&&body.solutions===undefined)fail(409,'PUBLISHED_CONTENT_IMMUTABLE',kind==='FULL_SOLUTION'?'已发布题解不可直接覆盖，请在题解编辑器中保存待审核修改':'已发布译文不可直接覆盖，请通过内容编辑器提交修改');
   const draft=readAssistanceDraft(body,{subjectKey:target.subjectKey,kind,previous:old,requireNonBlank:true});
   if(old&&(body.solutions!==undefined||editableAssistanceContent(old).solutions||body.expectedHash!==undefined)&&body.expectedHash!==contentHash(old)){
    fail(409,'CONTENT_CHANGED','辅助内容已修改，请重新载入后再保存');
   }
   let saved;
   if(old?.status==='published'){
    const pending=pendingSolution(old,draft);
    saved=one(await db.query('UPDATE luq_assistance_contents SET pending_solution=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[old.id,pending]));
   }else if(old){
    saved=one(await db.query("UPDATE luq_assistance_contents SET body=$2,solution_details=$3,status='draft',updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[old.id,draft.body,draft.details]));
   }else{
    saved=one(await db.query(`INSERT INTO luq_assistance_contents(subject_key,version_id,kind,language,body,status,author_account_id,solution_details)
     VALUES($1,$2,$3,$4,$5,'draft',$6,$7) RETURNING *`,[target.subjectKey,target.versionId,kind,language,draft.body,user.id,draft.details]));
   }
   if(shared)await retainSharedSolution(db,target.problemId,saved.id);
   await audit(db,user,'luq.content_draft','luq_content',saved.id,{subjectKey:target.subjectKey,versionId:target.versionId,kind,language});
   return contentShape(saved);
  }),201);
 }
 const publish=route.match(/^\/scholarship\/contents\/([^/]+)\/publish$/);
 if(publish&&method==='POST'){
  if(body.reviewed!==true)fail(400,'REVIEW_REQUIRED','请确认已审核正文，且不含教师私有批注或隐藏测试');
  return response(await transaction(pool,async db=>{
   const row=one(await db.query('SELECT * FROM luq_assistance_contents WHERE id=$1 FOR UPDATE',[uuid(publish[1])]));
   await contentTarget(db,user,row,helpers);
   await assertSharedSolution(db,row);
   const needsReview=row.status!=='published'||row.pending_solution!==null;
   if((body.expectedHash!==undefined||needsReview&&editableAssistanceContent(row).solutions)&&body.expectedHash!==contentHash(row)){
    fail(409,'CONTENT_CHANGED','辅助内容已修改，请重新载入后再审核');
   }
   return contentShape(needsReview?await publishAssistanceContent(db,user,row):row);
  }));
 }
 if(route==='/scholarship/policies'&&method==='GET'){
  const {targetType,targetId}=inputFromUrl(url);
  let target,canManage=true,frozen=false;
  if(['assignment','timed','paper4_activity'].includes(targetType)){
   const access=await scholarshipActivityAccess(pool,user,targetType,targetId);
   target=access.activity;canManage=access.canManage;frozen=access.frozen;
  }else target=await assistancePolicyTarget(pool,user,targetType,targetId);
  const rows=(await pool.query(`SELECT DISTINCT ON(kind) * FROM luq_assistance_policies WHERE target_type=$1 AND target_id=$2 ORDER BY kind,rule_version DESC`,[targetType,targetId])).rows;
  const settings=await getScholarshipSettings(pool);
  const mode=targetType==='timed'||targetType==='paper4_activity'&&target.activity_kind==='exam'?'disabled':'paid';
  return response({items:['FULL_TRANSLATION','FULL_SOLUTION'].map(kind=>{
   const found=rows.find(row=>row.kind===kind);
   const policy=found?policyShape(found):{id:null,targetType,targetId,kind,mode,opensAt:null,price:null,ruleVersion:0};
   const defaultPrice=kind==='FULL_TRANSLATION'?settings.translationPrice:settings.solutionPrice;
   // Configuration only; free access and student-specific discounts belong to quotes.
   return {...policy,defaultPrice,effectivePrice:policy.price??defaultPrice};
  }),canManage,frozen});
 }

 if(route==='/scholarship/policies'&&method==='POST'){
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
 if(route==='/scholarship/policies/batch-prices'&&method==='POST'){
  if(!isScholarshipStaff(user))fail(403,'FORBIDDEN','需要教师权限');
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
    LEFT JOIN luq_assistance_contents c ON c.subject_key=s.subject_key AND ${targetType==='problem'?`(k.kind='FULL_SOLUTION' AND c.id=${sharedSolutionIdSql('s.target_id','s.version_id')} OR k.kind<>'FULL_SOLUTION' AND c.version_id=s.version_id)`:'c.version_id=s.version_id'}
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
 if(route==='/scholarship/usage'&&method==='GET'){
  if(!isScholarshipStaff(user))fail(403,'FORBIDDEN','需要教师权限');
  const {targetType,targetId}=inputFromUrl(url);await assistancePolicyTarget(pool,user,targetType,targetId);
  const subject=targetType==='problem'?`problem:${targetId}`:targetType==='paper4'?`paper4:${targetId}:`:null;
  const result=await pool.query(`SELECT d.*,i.name student_name FROM luq_assistance_deliveries d JOIN identities i ON i.id=d.identity_id
   WHERE ($1::text IS NOT NULL AND (d.subject_key=$1 OR left(d.subject_key,length($1))=$1))
    OR ($1::text IS NULL AND d.context_type=$2 AND d.context_id=$3) ORDER BY d.provided_at DESC,d.id DESC LIMIT 500`,[subject,targetType,targetId]);
  return response({items:result.rows.map(r=>({id:r.id,identityId:r.identity_id,studentName:r.student_name,subjectKey:r.subject_key,versionId:r.version_id,kind:r.kind,language:r.language,contextType:r.context_type,contextId:r.context_id,providedAt:r.provided_at}))});
 }
 return null;
}
