import { transaction } from './db.mjs';
import { problemListColumns, problemListSummary } from './problem-list-summary.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { requirePlatformContentEditor, platformContentEditorSql } from './platform-content-access.mjs';
import { handlePlatformProblemLibrary, platformStorageBank, platformCategory } from './platform-problem-library.mjs';
import { tutorialSettings, saveTutorial } from './problem-tutorials.mjs';
import { handleScholarshipAssistance } from './scholarship-assistance.mjs';
import { handleProblemPublicStatements } from './problem-public-statements.mjs';
import { assertJudgeAdmission } from './system.mjs';
import { fail, uuid } from './security.mjs';
import { publishProblemDraft, requireDraftRevision, saveProblemDraft, validateProblemDraft } from './problem-editor-drafts.mjs';

const reply=(body,status=200)=>({status,body});

export async function handlePlatformProblems(ctx) {
 const library=await handlePlatformProblemLibrary(ctx);if(library)return library;
 const {pool,user,route,method,body={},helpers,url}=ctx;
 const match=route.match(/^\/platform\/source-problems(?:\/([^/]+)(?:\/(versions|publish|validate|tutorial|contents|public-statement)(?:\/([^/]+)\/(publish))?)?)?$/);
 if(!match)return null;
 return transaction(pool,async db=>{
  await lockSchoolTeaching(db,LEGACY_SCHOOL_ID,{shared:method==='GET'});
  await activeAccount(db,user.id);
  const admin=await isPlatformAdministrator(db,user.id);
  const audit=(action,id,detail={})=>db.query('INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,$2,$3)',
   [user.id,action,{problemId:id,...detail}]);
  const detail=async(id,versionId)=>{
   const result=await helpers.problemResult(db,user,id,versionId,{editing:true});
   const category=(await db.query('SELECT p.platform_bank_id,b.name FROM problems p LEFT JOIN platform_problem_banks b ON b.id=p.platform_bank_id WHERE p.id=$1',[id])).rows[0];
   return {...result,sourceBankId:result.bankId,bankId:category?.platform_bank_id??null,ownerScope:'platform',schoolId:LEGACY_SCHOOL_ID,bankName:category?.name??'',canPublish:admin&&result.canPublish,canManage:admin};
  };
  if(!match[1]&&method==='GET'){
   const summary=url.searchParams.get('view')==='summary';
   const schoolId=url.searchParams.get('schoolId')?uuid(url.searchParams.get('schoolId')):null;
   const bankId=url.searchParams.get('bankId')?uuid(url.searchParams.get('bankId')):null;
   const rows=(await db.query(`SELECT ${summary?problemListColumns('v'):'v.*'},p.bank_id,p.platform_bank_id,category.name category_name,p.archived_at,p.current_version_id AS published_version_id,
    (SELECT count(*) FROM test_cases tc WHERE tc.version_id=v.id AND tc.enabled) formal_test_count,
    p.created_at AS problem_created_at,
    COALESCE((SELECT jsonb_agg(course ORDER BY course.title) FROM (SELECT DISTINCT lp.id,lp.title FROM chapter_problems cp
     JOIN learning_chapters c ON c.id=cp.chapter_id JOIN learning_paths lp ON lp.id=c.path_id
     WHERE cp.problem_id=p.id AND c.archived_at IS NULL AND lp.archived_at IS NULL AND lp.owner_scope='platform') course),'[]'::jsonb) courses
    FROM problems p LEFT JOIN platform_problem_banks category ON category.id=p.platform_bank_id JOIN LATERAL
    (SELECT * FROM problem_versions WHERE problem_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
    WHERE p.owner_scope='platform' AND (p.archived_at IS NULL OR $4) AND ($5::uuid IS NULL OR p.platform_bank_id=$5) AND ($2 OR
     ${platformContentEditorSql('problem','p.id','$1::uuid','$3::uuid')}) ORDER BY v.title,p.id`,[user.id,admin,schoolId,admin&&url.searchParams.get('includeArchived')==='1',bankId])).rows;
   return reply({items:rows.map(row=>({...(summary?problemListSummary(row):helpers.problemShape(row)),ownerScope:'platform',schoolId:LEGACY_SCHOOL_ID,bankName:row.category_name??'',
    bankId:row.platform_bank_id,sourceBankId:row.bank_id,courses:row.courses,archivedAt:row.archived_at,canEdit:!row.archived_at,canManageTutorial:!row.archived_at,canPublish:admin&&!row.archived_at&&row.validation_status==='AC'&&!row.published_at,
    updatedAt:row.created_at,createdAt:row.problem_created_at})),canManage:admin});
  }
  if(!match[1]&&method==='POST'){
   if(!admin)fail(403,'PLATFORM_ADMIN_REQUIRED','仅平台管理员可创建平台题目');
   const categoryId=await platformCategory(db,body.bankId),bankId=await platformStorageBank(db,user.id);
   const input=helpers.problemInput({...body,bankId});
   const p=(await db.query("INSERT INTO problems(bank_id,platform_bank_id,owner_account_id,owner_scope) VALUES($1,$2,$3,'platform') RETURNING id",[bankId,categoryId,user.id])).rows[0];
   const v=await helpers.insertVersion(db,user,p.id,input);
   await audit('platform.problem.create',p.id);
   return reply(await detail(p.id,v.id),201);
  }
  const id=uuid(match[1]);
  const p=(await db.query(`SELECT * FROM problems WHERE id=$1 AND owner_scope='platform' AND archived_at IS NULL ${method==='GET'?'FOR SHARE':'FOR UPDATE'}`,[id])).rows[0];
  if(!p)fail(404,'NOT_FOUND','平台题目不存在');
  await requirePlatformContentEditor(db,user,'problem',id);
  if(method==='GET'&&!match[2])return reply(await detail(id,url.searchParams.get('versionId')));
  if(match[2]==='public-statement'&&!match[3]&&['GET','POST'].includes(method)){
   if(method==='POST'&&body.expectedRevision==null)fail(409,'REVISION_CONFLICT','请核对待发布草稿');
   const targetUrl=new URL(url);
   targetUrl.searchParams.set('problemId',id);
   targetUrl.searchParams.set('view','draft');
   return handleProblemPublicStatements({...ctx,pool:db,authoringDb:db,route:'/scholarship/public-statements',url:targetUrl,body:{...body,problemId:id}});
  }
  if(match[2]==='tutorial'&&!match[3]){
   if(method==='GET')return reply(tutorialSettings(p));
   if(method==='PATCH')return reply(await saveTutorial(db,p,body,metadata=>audit('platform.problem.tutorial_update',id,metadata)));
   return null;
  }
  if(match[2]==='contents'){
   if(!['GET','POST'].includes(method))return null;
   // Never let the URL-scoped editor switch to another problem/paper through its payload.
   const input=method==='GET'?Object.fromEntries(url.searchParams):body;
   if(input.problemId&&uuid(input.problemId)!==id||input.paperId||input.paper4AttemptId||input.questionKey)
    fail(400,'TARGET_MISMATCH','辅助内容必须属于当前题目');
   if(match[3]){
    if(method!=='POST'||!admin)fail(403,'PLATFORM_ADMIN_REQUIRED','仅平台管理员可发布辅助内容');
    if(!(await db.query('SELECT 1 FROM luq_assistance_contents WHERE id=$1 AND subject_key=$2',[uuid(match[3]),`problem:${id}`])).rowCount)
     fail(404,'NOT_FOUND','辅助内容不存在');
   }
   const targetUrl=new URL(url);targetUrl.searchParams.set('problemId',id);
   const result=await handleScholarshipAssistance({...ctx,pool:db,authoringDb:db,url:targetUrl,
    route:match[3]?`/scholarship/contents/${match[3]}/publish`:'/scholarship/contents',body:{...body,problemId:id}});
   return method==='GET'?{...result,body:{...result.body,canPublish:admin}}:result;
  }
  if(method!=='POST'||!['versions','publish','validate'].includes(match[2]))return null;
  // Serialize authoring against the parent row before inspecting the latest version.
  await db.query('SELECT id FROM problems WHERE id=$1 FOR UPDATE',[id]);
  const v=(await db.query('SELECT * FROM problem_versions WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id])).rows[0];
  if(match[2]==='validate'){
   const versionId=uuid(body.versionId),version=(await db.query('SELECT * FROM problem_versions WHERE problem_id=$1 AND id=$2 FOR UPDATE',[id,versionId])).rows[0];
   if(!version)fail(404,'NOT_FOUND','题目版本不存在');
   if(version.edit_draft)return reply(await validateProblemDraft(db,version,body.expectedRevision));
   if(version.published_at)fail(409,'IMMUTABLE','已发布版本不能重新验证，请创建新版本');
   if(version.validation_status==='Incomplete')fail(409,'INCOMPLETE','请补齐题面、参考解答、样例与正式测试并保存新版本后验证');
   if(!['Waiting','Judging'].includes(version.validation_status)){
    await assertJudgeAdmission(db);
    await db.query("UPDATE problem_versions SET validation_status='Waiting',validation_message=NULL WHERE id=$1",[versionId]);
    await db.query("INSERT INTO judge_tasks(version_id,purpose) VALUES($1,'validation')",[versionId]);
   }
   await audit('platform.problem.validate',id,{versionId});
   return reply({versionId,validationStatus:'Waiting'});
  }
  if(body.expectedVersionId!==v.id)fail(409,'REVISION_CONFLICT','题目已更新，请重新载入');
  if(match[2]==='versions'){
   await saveProblemDraft(db,user,v,helpers.problemInput({...body,bankId:p.bank_id}),body.expectedRevision,
    (_db,_actor,action,_type,_version,metadata)=>audit(`platform.${action}`,id,{versionId:v.id,...metadata}));
  }else{
   if(!admin)fail(403,'PLATFORM_ADMIN_REQUIRED','仅平台管理员可发布题目');
   if(v.edit_draft){
    requireDraftRevision(v,body.expectedRevision);
    await publishProblemDraft(db,user,v,{schoolApproval:true});
    await audit('platform.problem.publish',id,{versionId:v.id,revision:v.edit_revision});
    return reply(await detail(id));
   }
   if(v.published_at)fail(409,'ALREADY_PUBLISHED','当前版本已发布');
   if(v.validation_status!=='AC')fail(409,'NOT_VALIDATED','参考解答须通过全部测试后才能发布');
   await db.query(`UPDATE problem_versions SET published_at=clock_timestamp(),school_visible_at=clock_timestamp(),
    rank_review_status='approved',rank_approved_at=clock_timestamp(),rank_reviewed_at=clock_timestamp(),rank_reviewed_by=$2 WHERE id=$1`,[v.id,user.id]);
   await db.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[id,v.id]);
  }
  await audit(`platform.problem.${match[2]}`,id,{previousVersionId:v.id});
  return reply(await detail(id),match[2]==='versions'?201:200);
 });
}
