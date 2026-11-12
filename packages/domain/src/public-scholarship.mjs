import {transaction} from './db.mjs';
import {fail,integer,uuid} from './security.mjs';
import {activeAccount,LEGACY_SCHOOL_ID} from './schools.mjs';
import {scholarshipLedgerShape} from './scholarship-ledger.mjs';
import {hasLegacyPracticeAc,hasPublicPracticeAc,lockScholarshipAssistance} from './scholarship-access.mjs';
import {studentAssistanceOperation} from './scholarship-assistance.mjs';
import {publicSchoolAssistanceRestriction} from './school-scholarship.mjs';
import {schoolActivityProblemAccess} from './school-activities.mjs';

export async function recordPublicPracticeStaffExposure(db,accountId,problemId){
 await db.query(`INSERT INTO public_practice_staff_exposure(account_id,problem_id)
  VALUES($1,$2) ON CONFLICT DO NOTHING`,[accountId,problemId]);
}

async function publicPracticePreferences(db,user,changes){
 await activeAccount(db,user.id);
 if(changes){
  const {scholarshipEnabled,rankingEnabled}=changes;
  if((scholarshipEnabled===undefined&&rankingEnabled===undefined)||
     (scholarshipEnabled!==undefined&&typeof scholarshipEnabled!=='boolean')||
     (rankingEnabled!==undefined&&typeof rankingEnabled!=='boolean')){
   fail(400,'VALIDATION','Choose whether to enable scholarship or public ranking.');
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('public-practice:'||$1::uuid::text,0))",[user.id]);
  await db.query(`INSERT INTO public_practice_preferences(account_id,scholarship_enabled,ranking_enabled)
   VALUES($1,COALESCE($2,false),COALESCE($3,false))
   ON CONFLICT(account_id) DO UPDATE SET
    scholarship_enabled=COALESCE($2,public_practice_preferences.scholarship_enabled),
    ranking_enabled=COALESCE($3,public_practice_preferences.ranking_enabled)`,
  [user.id,scholarshipEnabled,rankingEnabled]);
  if(rankingEnabled===true){
   await db.query('SELECT include_public_practice_rank_history($1)',[user.id]);
   await db.query('UPDATE public_practice_preferences SET rank_history_included=true WHERE account_id=$1',[user.id]);
  }
  if(scholarshipEnabled===true)await db.query('SELECT luq_grant_initial($1)',[user.identityId]);
 }
 const {rows:[preferences]}=await db.query(`SELECT
  scholarship_enabled AS "scholarshipEnabled",ranking_enabled AS "rankingEnabled"
  FROM public_practice_preferences WHERE account_id=$1`,[user.id]);
 return {status:200,body:preferences??{scholarshipEnabled:false,rankingEnabled:false}};
}
export async function publicScholarshipOperation(ctx,loadPublicProblem){
 const {pool,user,route,method,url,body={}}=ctx;
 if(route==='/practice/preferences'&&(method==='GET'||method==='PATCH')){
  return transaction(pool,db=>publicPracticePreferences(db,user,method==='PATCH'?body:null));
 }
 if(route==='/practice/scholarship/me'&&method==='GET')return transaction(pool,async db=>{
  await activeAccount(db,user.id);
  const page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page'),pageSize=50;
  const balance=(await db.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[user.identityId])).rows[0]?.balance??0;
  const total=Number((await db.query('SELECT count(*) FROM luq_ledger WHERE identity_id=$1',[user.identityId])).rows[0].count);
  const items=(await db.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[user.identityId,pageSize,(page-1)*pageSize])).rows.map(scholarshipLedgerShape);
  return {status:200,body:{balance,items,total,page,pageSize}};
 });
 const action=route.match(/^\/practice\/scholarship\/assistance\/(quote|unlock|provide)$/);
 if(!action||method!=='POST')return null;
 return transaction(pool,async db=>{
  // Resolve live publication and assessment rules inside the same transaction
  // as the charge/delivery, never by a client supplied school or role.
  const p=await loadPublicProblem(db,user,uuid(body.problemId));
  if(uuid(body.versionId).toLowerCase()!==p.published_version_id)fail(404,'NOT_FOUND','This version is no longer available in public practice.');
  if(body.assignmentId||body.timedAttemptId||body.paperId||body.paper4AttemptId)fail(400,'VALIDATION','Public practice does not accept a school activity context.');
  await schoolActivityProblemAccess(db,{schoolId:p.school_id,problemId:p.id,user});
  await lockScholarshipAssistance(db,user.identityId);
  const legacy=p.school_id===LEGACY_SCHOOL_ID;
  const target={subjectKey:legacy?`problem:${p.id}`:`public-school:${p.school_id}:problem:${p.id}`,versionId:p.published_version_id,
   problemId:p.id,title:p.public_metadata?.title??'',baseType:'problem',baseId:p.id,contextType:'public',contextId:null};
  // Only independently reviewed global assistance is sold. New-school private
  // drafts/reference code are deliberately not copied into this public path.
  const result=await studentAssistanceOperation(db,user,action[1],body,{assistanceTarget:async()=>target,
   assistanceRestriction:async(db,u,t,kind)=>publicSchoolAssistanceRestriction(db,p.school_id,u,p.id,kind),
   hasPracticeAc:legacy?hasLegacyPracticeAc:(db,u,t)=>hasPublicPracticeAc(db,u.id,p.school_id,t.problemId)});
  return {status:200,body:result};
 });
}
