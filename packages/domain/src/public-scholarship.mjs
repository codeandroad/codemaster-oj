import {transaction} from './db.mjs';
import {fail,integer,uuid} from './security.mjs';
import {activeAccount,LEGACY_SCHOOL_ID} from './schools.mjs';
import {luqLedgerShape} from './luq-ledger.mjs';
import {lockLuqAssistance} from './luq-access.mjs';
import {studentAssistanceOperation} from './luq-assistance.mjs';
import {publicSchoolAssistanceRestriction} from './school-scholarship.mjs';
import {schoolActivityProblemAccess} from './school-activities.mjs';

// Personal identity is stable across school memberships. Legacy public mirrors
// retain their original problem/version IDs and therefore their paid rights.
async function publicWallet(db,user){
 await activeAccount(db,user.id);
 const identity=(await db.query(`SELECT i.id FROM accounts a JOIN identities i ON i.id=a.identity_id
  WHERE a.id=$1 AND i.id=$2 AND i.kind IN ('student','personal') AND i.archived_at IS NULL`,[user.id,user.identityId])).rows[0];
 if(!identity)fail(403,'STUDENT_IDENTITY_REQUIRED','A learner account is required.');
 await db.query('SELECT luq_grant_initial($1)',[identity.id]);
}
export async function publicScholarshipOperation(ctx,loadPublicProblem){
 const {pool,user,route,method,url,body={}}=ctx;
 if(route==='/practice/luq/me'&&method==='GET')return transaction(pool,async db=>{
  await publicWallet(db,user);
  const page=integer(Number(url.searchParams.get('page')??1),1,100000,'Page'),pageSize=50;
  const balance=(await db.query('SELECT balance FROM luq_accounts WHERE identity_id=$1',[user.identityId])).rows[0]?.balance??0;
  const total=Number((await db.query('SELECT count(*) FROM luq_ledger WHERE identity_id=$1',[user.identityId])).rows[0].count);
  const items=(await db.query('SELECT * FROM luq_ledger WHERE identity_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[user.identityId,pageSize,(page-1)*pageSize])).rows.map(luqLedgerShape);
  return {status:200,body:{balance,items,total,page,pageSize}};
 });
 const action=route.match(/^\/practice\/luq\/assistance\/(quote|unlock|provide)$/);
 if(!action||method!=='POST')return null;
 return transaction(pool,async db=>{
  // Resolve live publication and assessment rules inside the same transaction
  // as the charge/delivery, never by a client supplied school or role.
  const p=await loadPublicProblem(db,user,uuid(body.problemId));
  if(uuid(body.versionId).toLowerCase()!==p.published_version_id)fail(404,'NOT_FOUND','This version is no longer available in public practice.');
  if(body.assignmentId||body.timedAttemptId||body.paperId||body.paper4AttemptId)fail(400,'VALIDATION','Public practice does not accept a school activity context.');
  await schoolActivityProblemAccess(db,{schoolId:p.school_id,problemId:p.id,user});
  await lockLuqAssistance(db,user.identityId);
  await publicWallet(db,user);
  const legacy=p.school_id===LEGACY_SCHOOL_ID;
  const target={subjectKey:legacy?`problem:${p.id}`:`public-school:${p.school_id}:problem:${p.id}`,versionId:p.published_version_id,
   problemId:p.id,title:p.public_metadata?.title??'',baseType:'problem',baseId:p.id,contextType:'public',contextId:null};
  // Only independently reviewed global assistance is sold. New-school private
  // drafts/reference code are deliberately not copied into this public path.
  const result=await studentAssistanceOperation(db,user,action[1],body,{assistanceTarget:async()=>target,
   assistanceRestriction:async(db,u,t,kind)=>publicSchoolAssistanceRestriction(db,p.school_id,u,p.id,kind)});
  return {status:200,body:result};
 });
}
