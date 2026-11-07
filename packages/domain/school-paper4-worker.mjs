import { randomUUID } from 'node:crypto';
import { transaction } from './src/db.mjs';
import { runPaper4Snapshot } from './paper4-runner.mjs';

const failure=()=>({status:'System Error',publicMessage:'The execution service is temporarily unavailable. Please try again.',questions:[]});
export async function claimSchoolPaper4Task(pool,{leaseSeconds=90,maxAttempts=3,nodeId=null}={}){
 if(!Number.isInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>600||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw new Error('Invalid school Paper 4 lease configuration.');
 return transaction(pool,async db=>{
  if(nodeId){await db.query('SELECT pg_advisory_xact_lock(798945)');const settings=(await db.query('SELECT settings FROM site_settings WHERE id=true')).rows[0]?.settings;
   const count=(await db.query(`SELECT
    (SELECT count(*) FROM judge_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)+
    (SELECT count(*) FROM paper4_run_tasks WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)+
    (SELECT count(*) FROM school_judge_jobs WHERE state='leased' AND lease_expires_at>now() AND node_id=$1)+
    (SELECT count(*) FROM school_paper4_jobs WHERE state='leased' AND lease_expires_at>now() AND node_id=$1) n`,[nodeId])).rows[0].n;
   if(Number(count)>=(settings?.runtime?.workerConcurrency??2))return null;
  }
  for(const old of(await db.query("SELECT school_id,id,attempts FROM school_paper4_jobs WHERE state='leased' AND lease_expires_at<=now() ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 20")).rows){const exhausted=old.attempts>=maxAttempts;await db.query("UPDATE school_paper4_jobs SET state=$3,lease_id=NULL,lease_expires_at=NULL,available_at=now(),result=$4,completed_at=CASE WHEN $3='failed' THEN now() ELSE NULL END WHERE school_id=$1 AND id=$2",[old.school_id,old.id,exhausted?'failed':'queued',exhausted?JSON.stringify(failure()):null]);}
  const next=(await db.query("SELECT school_id,id FROM school_paper4_jobs WHERE state='queued' AND available_at<=now() AND attempts<$1 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[maxAttempts])).rows[0];if(!next)return null;
  return(await db.query("UPDATE school_paper4_jobs SET state='leased',lease_id=$3,lease_expires_at=now()+($4::integer*interval '1 second'),attempts=attempts+1,node_id=$5 WHERE school_id=$1 AND id=$2 RETURNING *",[next.school_id,next.id,randomUUID(),leaseSeconds,nodeId])).rows[0];
 });
}
export async function finishSchoolPaper4Task(pool,job,result){return(await pool.query("UPDATE school_paper4_jobs SET state='completed',result=$4,completed_at=now(),lease_id=NULL,lease_expires_at=NULL WHERE school_id=$1 AND id=$2 AND state='leased' AND lease_id=$3 AND lease_expires_at>now()",[job.school_id,job.id,job.lease_id,JSON.stringify(result)])).rowCount===1;}
export async function processSchoolPaper4One({pool,judge,leaseSeconds=90,maxAttempts=3,nodeId=null,signal,logger=console}){
 const job=await claimSchoolPaper4Task(pool,{leaseSeconds,maxAttempts,nodeId});if(!job)return false;
 const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const timer=setInterval(async()=>{try{const updated=await pool.query("UPDATE school_paper4_jobs SET lease_expires_at=now()+($4::integer*interval '1 second') WHERE school_id=$1 AND id=$2 AND state='leased' AND lease_id=$3 AND lease_expires_at>now()",[job.school_id,job.id,job.lease_id,leaseSeconds]);if(!updated.rowCount)cancel();}catch{cancel();}},Math.max(1000,Math.floor(leaseSeconds*1000/3)));timer.unref();
 try{
  if(!Array.isArray(job.payload.questions)||job.payload.questions.length<1||job.payload.questions.length>3)throw new Error('Invalid school Paper 4 snapshot.');
  const questions=[];
  for(const item of job.payload.questions){
   const run=await runPaper4Snapshot(item,judge,{signal:abort.signal});
   const selected=new Set(item.runnerCases.map(c=>c.stageId));
   const stages=item.question.stages.filter(s=>s.judgeMode==='auto'&&selected.has(s.id)).map(s=>{const cases=run.privateResults.filter(c=>c.stageId===s.id);const passed=cases.length===item.runnerCases.filter(c=>c.stageId===s.id).length&&cases.length>0&&cases.every(c=>c.status==='AC');return {stageKey:s.id,status:passed?'AC':run.status==='AC'?'WA':run.status,marks:passed?s.maxMarks:0,maxMarks:s.maxMarks};});
   questions.push({key:item.key,status:run.status,publicOutput:run.publicOutput,publicMessage:run.publicMessage,stages,privateResults:run.privateResults});
  }
  const status=questions.find(q=>q.status!=='AC')?.status??'AC';
  if(!abort.signal.aborted)await finishSchoolPaper4Task(pool,job,{status,publicMessage:status==='AC'?'All automatic checks passed.':'Check your code and the available test feedback.',questions});
 }catch{
  const exhausted=job.attempts>=maxAttempts;
  await pool.query("UPDATE school_paper4_jobs SET state=$4,result=$5,completed_at=CASE WHEN $4='failed' THEN now() ELSE NULL END,available_at=now()+interval '5 seconds',lease_id=NULL,lease_expires_at=NULL WHERE school_id=$1 AND id=$2 AND lease_id=$3 AND state='leased' AND lease_expires_at>now()",[job.school_id,job.id,job.lease_id,exhausted?'failed':'queued',exhausted?JSON.stringify(failure()):null]);
  logger.error?.(JSON.stringify({event:'school_paper4_judge_retry',exhausted}));
 }finally{clearInterval(timer);signal?.removeEventListener('abort',cancel);}
 return true;
}
