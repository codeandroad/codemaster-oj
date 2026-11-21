import { transaction } from './db.mjs';
import { lockSchoolTeaching, schoolRole } from './schools.mjs';
import { canonicalHash, fail, field, integer, uuid } from './security.mjs';
import { answerFields, automaticSuggestions, pngBytes, publicDefinition, sha256, validateAnswers, validateMarks, validateWrittenPackage } from './written-paper-model.mjs';

const reply=(body,status=200)=>({body,status});
const missing=()=>fail(404,'NOT_FOUND','Written practice is unavailable.');
async function scope(db,school,user){
 await lockSchoolTeaching(db,school,{shared:true});
 const roles=[await schoolRole(db,school,user.id)];
 await db.query("SELECT set_config('campus.school_id',$1,true)",[school]);
 return {staff:roles.some(r=>['teacher','admin','school_admin'].includes(r)),student:roles.includes('student')};
}
const requireStaff=access=>{if(!access.staff)fail(403,'FORBIDDEN','Teacher access is required.');};
const requireStudent=access=>{if(!access.student)fail(403,'FORBIDDEN','Student access is required.');};
async function event(db,school,user,action,target,detail={}){
 await db.query('INSERT INTO written_events(school_id,actor_id,action,target_id,detail) VALUES($1,$2,$3,$4,$5)',[school,user.id,action,target,JSON.stringify(detail)]);
}
async function paper(db,school,id,lock=false){
 const row=(await db.query(`SELECT * FROM written_papers WHERE school_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[school,uuid(id)])).rows[0];if(!row)missing();return row;
}
async function version(db,school,paperId,id){
 const row=(await db.query('SELECT * FROM written_paper_versions WHERE school_id=$1 AND paper_id=$2 AND id=$3',[school,paperId,uuid(id)])).rows[0];if(!row)missing();return row;
}
async function attempt(db,school,id,user,access){
 const a=(await db.query(`SELECT a.*,v.definition,i.name AS student_name FROM written_attempts a
 JOIN written_paper_versions v ON v.school_id=a.school_id AND v.id=a.version_id
 JOIN accounts u ON u.id=a.account_id JOIN identities i ON i.id=u.identity_id
 WHERE a.school_id=$1 AND a.id=$2 FOR UPDATE OF a`,[school,uuid(id)])).rows[0];
 if(!a||a.account_id!==user.id&&(!access.staff||a.state==='draft'))missing();return a;
}
function attemptView(a,user,access){
 const marking=access.staff||a.state==='released';
 return {id:a.id,paperId:a.paper_id,versionId:a.version_id,state:a.state,revision:a.revision,gradingRevision:a.grading_revision,
  createdAt:a.created_at,submittedAt:a.submitted_at,releasedAt:a.released_at,definition:publicDefinition(a.definition,marking),answers:a.answers,
  canEdit:a.account_id===user.id&&a.state==='draft',canReview:access.staff&&a.state==='submitted',studentName:access.staff?a.student_name:undefined,
  marks:marking?a.marks:{},score:a.state==='released'?a.score:null,
  suggestions:access.staff?automaticSuggestions(a.definition,a.answers):undefined,
  selfMarks:a.account_id===user.id?a.self_marks:undefined,notes:a.account_id===user.id?a.notes:undefined};
}
export async function handleWrittenPapers({pool,user,route,url,method,body}){
 const match=route.match(/^\/schools\/([^/]+)\/written-papers(?:\/(.*))?$/);if(!match)return null;
 const school=uuid(match[1]),path=match[2]??'';
 return transaction(pool,async db=>{
  const access=await scope(db,school,user);
  if(path==='import-preview'||path==='import'){
   requireStaff(access);if(method!=='POST')missing();
   const prepared=validateWrittenPackage(body.package),{definition,contentHash,assets}=prepared;
   if(path==='import-preview')return reply({contentHash,definition:publicDefinition(definition,true),assetBytes:assets.reduce((s,a)=>s+a.content.length,0)});
   if(body.contentHash!==contentHash)fail(409,'IMPORT_CHANGED','Preview the current package before importing.');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`written-import:${school}:${definition.paper.slug}`]);
   let p=(await db.query('SELECT * FROM written_papers WHERE school_id=$1 AND slug=$2',[school,definition.paper.slug])).rows[0];
   if(!p)p=(await db.query('INSERT INTO written_papers(school_id,slug,created_by) VALUES($1,$2,$3) RETURNING *',[school,definition.paper.slug,user.id])).rows[0];
   const prior=(await db.query('SELECT id FROM written_paper_versions WHERE school_id=$1 AND paper_id=$2 AND content_hash=$3',[school,p.id,contentHash])).rows[0];
   if(prior)return reply({paperId:p.id,versionId:prior.id,imported:false});
   const v=(await db.query('INSERT INTO written_paper_versions(school_id,paper_id,content_hash,definition,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[school,p.id,contentHash,JSON.stringify(definition),user.id])).rows[0];
   for(const a of assets)await db.query('INSERT INTO written_assets(school_id,version_id,id,purpose,mime_type,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)',[school,v.id,a.id,a.purpose,a.mimeType,a.sha256,a.content]);
   await db.query('UPDATE written_papers SET draft_version_id=$3 WHERE school_id=$1 AND id=$2',[school,p.id,v.id]);
   await event(db,school,user,'written.import',p.id,{versionId:v.id,contentHash});
   return reply({paperId:p.id,versionId:v.id,imported:true},201);
  }
  if(path===''&&method==='GET'){
   const manage=url.searchParams.get('manage')==='1';if(manage)requireStaff(access);
   const {rows}=await db.query(`SELECT p.*,v.definition FROM written_papers p JOIN written_paper_versions v
    ON v.school_id=p.school_id AND v.id=CASE WHEN $2 THEN p.draft_version_id ELSE p.published_version_id END
    WHERE p.school_id=$1 ORDER BY v.definition->'paper'->>'year' DESC,p.created_at DESC`,[school,manage]);
   const items=[];for(const p of rows){
    const attempts=(await db.query(`SELECT id,state,version_id AS "versionId",revision,created_at AS "createdAt",submitted_at AS "submittedAt",released_at AS "releasedAt",score
     FROM written_attempts WHERE school_id=$1 AND paper_id=$2 AND account_id=$3 ORDER BY created_at DESC`,[school,p.id,user.id])).rows;
    items.push({id:p.id,versionId:manage?p.draft_version_id:p.published_version_id,publishedVersionId:p.published_version_id,...p.definition.paper,questionCount:p.definition.questions.length,attempts});
   }
   return reply({items});
  }
  let m=path.match(/^attempts\/([^/]+)(?:\/(.*))?$/);
  if(m){
   const a=await attempt(db,school,m[1],user,access),action=m[2]??'';
   if(method==='GET'&&action==='')return reply(attemptView(a,user,access));
   if(action==='answers'&&method==='PATCH'){
    if(a.account_id!==user.id)fail(403,'FORBIDDEN','Only the author can save answers.');
    const requestId=uuid(body.requestId),hash=canonicalHash(body);
    if(a.save_request_id===requestId){if(a.save_hash!==hash)fail(409,'REQUEST_CONFLICT','Request already used.');return reply({revision:a.revision});}
    if(a.state!=='draft')fail(409,'ANSWERS_FROZEN','This paper has been submitted.');
    if(body.expectedRevision!==a.revision)fail(409,'REVISION_CONFLICT','Answers changed on another page. Load saved answers before continuing.');
    const answers=validateAnswers(a.definition,body.answers);
    for(const [qid,answer] of Object.entries(answers))for(const attachment of answer.attachments){
     if(!(await db.query('SELECT 1 FROM written_attachments WHERE school_id=$1 AND attempt_id=$2 AND question_id=$3 AND id=$4',[school,a.id,qid,uuid(attachment)])).rowCount)fail(400,'INVALID_ATTACHMENT','Attachment does not belong to this answer.');
    }
    await db.query('UPDATE written_attempts SET answers=$3,revision=revision+1,save_request_id=$4,save_hash=$5,updated_at=now() WHERE school_id=$1 AND id=$2',[school,a.id,JSON.stringify(answers),requestId,hash]);
    return reply({revision:a.revision+1});
   }
   if(action==='attachments'&&method==='POST'){
    if(a.account_id!==user.id||a.state!=='draft')fail(403,'FORBIDDEN','Only editable answers accept attachments.');
    if(!a.definition.questions.some(q=>q.id===body.questionId))fail(400,'INVALID_QUESTION','Unknown question.');
    const requestId=uuid(body.requestId),data=pngBytes(body.contentBase64),hash=sha256(data);
    const old=(await db.query('SELECT id,sha256,question_id FROM written_attachments WHERE school_id=$1 AND attempt_id=$2 AND request_id=$3',[school,a.id,requestId])).rows[0];
    if(old){if(old.sha256!==hash||old.question_id!==body.questionId)fail(409,'REQUEST_CONFLICT','Request already used.');return reply({id:old.id});}
    const counts=(await db.query('SELECT count(*)::int count,coalesce(sum(octet_length(content)),0)::int bytes FROM written_attachments WHERE school_id=$1 AND attempt_id=$2',[school,a.id])).rows[0];
    if(counts.count>=90||counts.bytes+data.length>20*1024*1024)fail(413,'ATTACHMENT_LIMIT','Answer attachments exceed 20 MiB or 90 images.');
    const saved=(await db.query('INSERT INTO written_attachments(school_id,attempt_id,question_id,request_id,sha256,content) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[school,a.id,body.questionId,requestId,hash,data])).rows[0];return reply(saved,201);
   }
   if(action.startsWith('attachments/')&&method==='GET'){
    const row=(await db.query('SELECT content FROM written_attachments WHERE school_id=$1 AND attempt_id=$2 AND id=$3',[school,a.id,uuid(action.slice(12))])).rows[0];if(!row)missing();return reply({content:row.content,mimeType:'image/png',filename:'answer.png'});
   }
   if(action==='submit'&&method==='POST'){
    if(a.account_id!==user.id)fail(403,'FORBIDDEN','Only the author can submit.');
    if(a.state!=='draft')return reply(attemptView(a,user,access));
    if(body.expectedRevision!==a.revision||body.versionId!==a.version_id)fail(409,'REVISION_CONFLICT','Save and check the current answers before submitting.');
    const answers=validateAnswers(a.definition,a.answers);
    const empty=a.definition.questions.filter(q=>!answerFields(q).some(f=>answers[q.id].values[f].trim())&&!answers[q.id].working.trim()&&!answers[q.id].attachments.length);
    if(empty.length&&body.confirmIncomplete!==true)fail(400,'INCOMPLETE_PAPER','Some questions are unanswered. Confirm before submitting.');
    await db.query("UPDATE written_attempts SET state='submitted',submitted_at=now(),updated_at=now() WHERE school_id=$1 AND id=$2",[school,a.id]);
    await event(db,school,user,'written.submit',a.id,{revision:a.revision,versionId:a.version_id});
    return reply(attemptView(await attempt(db,school,a.id,user,access),user,access));
   }
   if(action==='marks'&&method==='PATCH'){
    requireStaff(access);if(a.state!=='submitted')fail(409,'GRADES_FROZEN','Only submitted, unreleased attempts can be reviewed.');
    const requestId=uuid(body.requestId),hash=canonicalHash(body);
    if(a.review_request_id===requestId){if(a.review_hash!==hash)fail(409,'REQUEST_CONFLICT','Request already used.');return reply(attemptView(a,user,access));}
    if(body.expectedRevision!==a.grading_revision)fail(409,'REVISION_CONFLICT','Another reviewer updated these marks. Reload before saving.');
    const {marks}=validateMarks(a.definition,body.marks);
    await db.query('UPDATE written_attempts SET marks=$3,grading_revision=grading_revision+1,review_request_id=$4,review_hash=$5 WHERE school_id=$1 AND id=$2',[school,a.id,JSON.stringify(marks),requestId,hash]);
    await event(db,school,user,'written.mark',a.id,{revision:a.grading_revision+1,marks});
    return reply(attemptView(await attempt(db,school,a.id,user,access),user,access));
   }
   if(action==='release'&&method==='POST'){
    requireStaff(access);if(a.state==='released')return reply(attemptView(a,user,access));
    if(a.state!=='submitted'||body.expectedRevision!==a.grading_revision)fail(409,'REVISION_CONFLICT','Review the current submitted attempt before publishing.');
    const {score}=validateMarks(a.definition,a.marks,true);
    await db.query("UPDATE written_attempts SET state='released',score=$3,released_at=now() WHERE school_id=$1 AND id=$2",[school,a.id,score]);
    await event(db,school,user,'written.release',a.id,{score,gradingRevision:a.grading_revision});
    return reply(attemptView(await attempt(db,school,a.id,user,access),user,access));
   }
   if(action==='reflection'&&method==='PATCH'){
    if(a.account_id!==user.id||a.state!=='released')fail(403,'FORBIDDEN','Review is available after results are published.');
    const selfMarks={},notes={};
    for(const q of a.definition.questions){if(body.selfMarks?.[q.id]!==undefined&&body.selfMarks[q.id]!==null)selfMarks[q.id]=integer(body.selfMarks[q.id],0,q.maxMarks,'Self assessment');notes[q.id]=field(body.notes?.[q.id]??'','Review note',{min:0,max:4000});}
    await db.query('UPDATE written_attempts SET self_marks=$3,notes=$4 WHERE school_id=$1 AND id=$2',[school,a.id,JSON.stringify(selfMarks),JSON.stringify(notes)]);return reply({selfMarks,notes});
   }
   missing();
  }
  m=path.match(/^([^/]+)(?:\/(.*))?$/);if(!m)missing();
  const p=await paper(db,school,m[1],method!=='GET'),action=m[2]??'';
  if(action==='publish'&&method==='POST'){
   requireStaff(access);const v=await version(db,school,p.id,body.versionId);
   if(p.draft_version_id!==v.id)fail(409,'REVISION_CONFLICT','A newer draft is available.');
   if(p.published_version_id!==v.id){await db.query('UPDATE written_papers SET published_version_id=$3 WHERE school_id=$1 AND id=$2',[school,p.id,v.id]);await event(db,school,user,'written.publish',p.id,{versionId:v.id});}
   return reply({published:true,versionId:v.id});
  }
  if(action==='attempts'&&method==='POST'){
   requireStudent(access);if(!p.published_version_id)missing();const requestId=uuid(body.requestId);
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`written-attempt:${school}:${p.id}:${user.id}`]);
   const prior=(await db.query('SELECT id,paper_id FROM written_attempts WHERE school_id=$1 AND account_id=$2 AND request_id=$3',[school,user.id,requestId])).rows[0];
   if(prior){if(prior.paper_id!==p.id)fail(409,'REQUEST_CONFLICT','Request already used.');return reply({id:prior.id});}
   const draft=(await db.query("SELECT id FROM written_attempts WHERE school_id=$1 AND paper_id=$2 AND account_id=$3 AND state='draft'",[school,p.id,user.id])).rows[0];if(draft)return reply(draft);
   if(body.versionId!==p.published_version_id)fail(409,'VERSION_CONFLICT','Reload the current published paper.');
   const a=(await db.query('INSERT INTO written_attempts(school_id,paper_id,version_id,account_id,request_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[school,p.id,p.published_version_id,user.id,requestId])).rows[0];return reply(a,201);
  }
  if(action==='attempts'&&method==='GET'){
   requireStaff(access);return reply({items:(await db.query(`SELECT a.id,a.state,a.version_id AS "versionId",a.submitted_at AS "submittedAt",a.released_at AS "releasedAt",a.score,i.name AS "studentName"
    FROM written_attempts a JOIN accounts u ON u.id=a.account_id JOIN identities i ON i.id=u.identity_id WHERE a.school_id=$1 AND a.paper_id=$2 AND a.state<>'draft' ORDER BY a.submitted_at DESC`,[school,p.id])).rows});
  }
  const versionId=url.searchParams.get('versionId')??(access.staff?p.draft_version_id:p.published_version_id);
  if(!versionId)missing();
  const own=(await db.query("SELECT 1 FROM written_attempts WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND account_id=$4 AND state='released'",[school,p.id,uuid(versionId),user.id])).rowCount>0;
  if(!access.staff&&versionId!==p.published_version_id&&!(await db.query('SELECT 1 FROM written_attempts WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND account_id=$4',[school,p.id,versionId,user.id])).rowCount)missing();
  const v=await version(db,school,p.id,versionId);
  if(action.startsWith('assets/')&&method==='GET'){
   const asset=(await db.query('SELECT * FROM written_assets WHERE school_id=$1 AND version_id=$2 AND id=$3',[school,v.id,action.slice(7)])).rows[0];
   if(!asset||asset.purpose==='marking'&&!access.staff&&!own)missing();
   return reply({content:asset.content,mimeType:asset.mime_type,filename:asset.mime_type==='application/pdf'?`${asset.id}.pdf`:`${asset.id}.png`});
  }
  if(action===''&&method==='GET')return reply({id:p.id,versionId:v.id,publishedVersionId:p.published_version_id,definition:publicDefinition(v.definition,access.staff||own)});
  missing();
 });
}
