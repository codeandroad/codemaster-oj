import { randomUUID } from 'node:crypto';
import { transaction } from './src/db.mjs';
import { createJudgingBudget } from './judge.mjs';

const failure=()=>({status:'System Error',score:0,passed:0,total:0,publicMessage:'The execution service is temporarily unavailable. Please try again.',privateResults:[]});
export async function claimSchoolTask(pool,{leaseSeconds=90,maxAttempts=3,nodeId=null}={}){
 if(!Number.isInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>600||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw new Error('Invalid school judge lease configuration.');
 return transaction(pool,async db=>{
  if(nodeId){
   await db.query('SELECT pg_advisory_xact_lock(798945)');
   const settings=(await db.query('SELECT settings FROM site_settings WHERE id=true')).rows[0]?.settings;
   const active=(await db.query(`SELECT (SELECT count(*) FROM judge_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)+(SELECT count(*) FROM paper4_run_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)+(SELECT count(*) FROM school_judge_jobs WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)
        +(SELECT count(*) FROM school_paper4_jobs WHERE state='leased' AND lease_expires_at>now() AND node_id=$1) AS count`,[nodeId])).rows[0];
   if(Number(active.count)>=(settings?.runtime?.workerConcurrency??2))return null;
  }
  for(const job of(await db.query("SELECT school_id,id,attempts FROM school_judge_jobs WHERE state='leased' AND lease_expires_at<=now() ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 20")).rows){
   const exhausted=job.attempts>=maxAttempts;
   await db.query(`UPDATE school_judge_jobs SET state=$3,lease_id=NULL,lease_expires_at=NULL,available_at=now(),result=$4,completed_at=CASE WHEN $3='failed' THEN now() ELSE NULL END WHERE school_id=$1 AND id=$2`,[job.school_id,job.id,exhausted?'failed':'queued',exhausted?JSON.stringify(failure()):null]);
  }
  const next=(await db.query("SELECT school_id,id FROM school_judge_jobs WHERE state='queued' AND available_at<=now() AND attempts<$1 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[maxAttempts])).rows[0];
  if(!next)return null;
  return(await db.query("UPDATE school_judge_jobs SET state='leased',lease_id=$3,lease_expires_at=now()+($4::integer*interval '1 second'),attempts=attempts+1,node_id=$5 WHERE school_id=$1 AND id=$2 RETURNING *",[next.school_id,next.id,randomUUID(),leaseSeconds,nodeId])).rows[0];
 });
}
export async function finishSchoolTask(pool,job,result){
 return (await pool.query("UPDATE school_judge_jobs SET state='completed',result=$4,completed_at=now(),lease_id=NULL,lease_expires_at=NULL WHERE school_id=$1 AND id=$2 AND lease_id=$3 AND state='leased' AND lease_expires_at>now()",[job.school_id,job.id,job.lease_id,JSON.stringify(result)])).rowCount===1;
}
export async function processSchoolOne({pool,judge,leaseSeconds=90,maxAttempts=3,nodeId=null,signal,logger=console}){
 const job=await claimSchoolTask(pool,{leaseSeconds,maxAttempts,nodeId});if(!job)return false;
 const abort=new AbortController();const cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const timer=setInterval(async()=>{try{const renewed=await pool.query("UPDATE school_judge_jobs SET lease_expires_at=now()+($4::integer*interval '1 second') WHERE school_id=$1 AND id=$2 AND lease_id=$3 AND state='leased' AND lease_expires_at>now()",[job.school_id,job.id,job.lease_id,leaseSeconds]);if(!renewed.rowCount)abort.abort();}catch{abort.abort();}},Math.max(1000,Math.floor(leaseSeconds*1000/3)));timer.unref();
 try{
  const budget=createJudgingBudget();let result=await judge.judge(job.payload,{signal:abort.signal,budget});
  if(job.kind==='validation'&&result.status==='AC'){
   const sampleResult=await judge.judge({...job.payload,kind:'samples',tests:job.payload.version.samples},{signal:abort.signal,budget});
   if(sampleResult.status!=='AC')result={...sampleResult,publicMessage:'The reference did not pass every public sample.'};
  }
  if(!abort.signal.aborted)await finishSchoolTask(pool,job,result);
 }catch{
  const exhausted=job.attempts>=maxAttempts;
  await pool.query(`UPDATE school_judge_jobs SET state=$4,result=$5,completed_at=CASE WHEN $4='failed' THEN now() ELSE NULL END,available_at=now()+interval '5 seconds',lease_id=NULL,lease_expires_at=NULL WHERE school_id=$1 AND id=$2 AND lease_id=$3 AND state='leased' AND lease_expires_at>now()`,[job.school_id,job.id,job.lease_id,exhausted?'failed':'queued',exhausted?JSON.stringify(failure()):null]);
  logger.error?.(JSON.stringify({event:'school_judge_retry',exhausted}));
 }finally{clearInterval(timer);signal?.removeEventListener('abort',cancel);}
 return true;
}
