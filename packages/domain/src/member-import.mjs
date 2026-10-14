import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { transaction } from './db.mjs';
import { HttpError, fail, field, uuid, canonicalHash } from './security.mjs';

// Batch retries must recover the same newly issued activation codes. Store the
// response encrypted rather than adding plaintext credentials to the database.
export function cacheResult(value, secret, context) {
 const key=createHmac('sha256',secret).update('campus-member-import:v1').digest();
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from(context));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function restoreResult(value, secret, context, fallback) {
 const key=createHmac('sha256',secret).update('campus-member-import:v1').digest();
 const data=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
 decipher.setAAD(Buffer.from(context));decipher.setAuthTag(data.subarray(12,28));
 try{return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));}
 catch{return fallback;}
}

export const cleanupExpiredMemberImports=pool=>pool.query('UPDATE member_import_batches SET result_ciphertext=NULL WHERE replay_expires_at<=clock_timestamp() AND result_ciphertext IS NOT NULL');

export async function handleMemberImport({pool,user,route,method,body,config,helpers}) {
 const match=route.match(/^\/classes\/([^/]+)\/import-members$/);
 if(!match||method!=='POST')return null;
 const isAdmin=user.roles.includes('admin');
 if(!isAdmin&&!user.roles.includes('teacher'))fail(403,'FORBIDDEN','需要教师权限');
 const classId=uuid(match[1],'班级 ID'),key=uuid(body.idempotencyKey,'导入请求去重键');
 if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>500)fail(400,'VALIDATION','学生导入须包含 1–500 行');
 const requestHash=canonicalHash({classId,rows:body.rows}),cacheContext=`${user.id}:${classId}:${key}`;
 const result=await transaction(pool,async db=>{
  await helpers.classAccess(db,user,classId);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`member-import:${user.id}:${key}`]);
  const previous=(await db.query('SELECT *,replay_expires_at>clock_timestamp() replay_available FROM member_import_batches WHERE account_id=$1 AND idempotency_key=$2',[user.id,key])).rows[0];
  if(previous){if(previous.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','相同导入请求键对应不同班级或内容');if(!previous.replay_available){await db.query('UPDATE member_import_batches SET result_ciphertext=NULL WHERE id=$1',[previous.id]);return previous.nonsecret_result;}return previous.result_ciphertext?restoreResult(previous.result_ciphertext,config.secret,cacheContext,previous.nonsecret_result):previous.nonsecret_result;}
  const items=[],summary={created:0,added:0,skipped:0,failed:0,total:body.rows.length};
  for(let index=0;index<body.rows.length;index++){
   await db.query('SAVEPOINT member_import_row');
   try{
    const entry=body.rows[index],number=field(entry?.number,'学号'),name=field(entry?.name,'姓名');
    const created=(await db.query("INSERT INTO identities(kind,number,name) VALUES('student',$1,$2) ON CONFLICT(kind,number) DO NOTHING RETURNING *",[number,name])).rows[0];
    let person=created,issued;
    if(!person){
     person=(await db.query("SELECT i.*,EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL) activated FROM identities i WHERE i.kind='student' AND i.number=$1 FOR UPDATE",[number])).rows[0];
     const inScope=isAdmin||!!(await db.query('SELECT 1 FROM class_members cm JOIN teacher_classes tc ON tc.class_id=cm.class_id JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=$1 AND tc.account_id=$2 AND c.archived_at IS NULL',[person?.id,user.id])).rowCount;
     if(!person||!inScope||person.archived_at||person.name!==name)fail(400,'IMPORT_CONFLICT','该学号无法自动加入，请联系管理员核对身份与班级授权');
    }
    const added=(await db.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING identity_id',[classId,person.id])).rowCount;
    const status=created?'created':added?'added':'skipped';
    if(created)issued=await helpers.issueActivation(db,user,person.id);
    const classes=(await db.query('SELECT c.id,c.name FROM class_members cm JOIN classes c ON c.id=cm.class_id WHERE cm.identity_id=$1 AND c.archived_at IS NULL ORDER BY c.name',[person.id])).rows;
    items.push({line:index+1,status,person:helpers.personShape({...person,classes}),...(issued?{activationCode:issued.activationCode}:{})});summary[status]++;
    await db.query('RELEASE SAVEPOINT member_import_row');
   }catch(error){
    await db.query('ROLLBACK TO SAVEPOINT member_import_row');await db.query('RELEASE SAVEPOINT member_import_row');
    items.push({line:index+1,status:'failed',message:error instanceof HttpError?error.message:'该行数据无效'});summary.failed++;
   }
  }
  const output={items,summary},nonsecret={items:items.map(({activationCode,...item})=>({...item,...(activationCode?{activationUnavailable:true}:{})})),summary};
  await db.query("INSERT INTO member_import_batches(account_id,class_id,idempotency_key,request_hash,nonsecret_result,result_ciphertext,replay_expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '15 minutes')",[user.id,classId,key,requestHash,JSON.stringify(nonsecret),cacheResult(output,config.secret,cacheContext)]);
  await helpers.audit(db,user.id,'class.members_import','class',classId,summary);
  return output;
 });
 return {status:200,body:result};
}
