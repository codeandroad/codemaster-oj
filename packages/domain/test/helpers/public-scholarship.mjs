import {randomUUID} from 'node:crypto';
import {transaction} from '../../src/db.mjs';
import {LEGACY_SCHOOL_ID} from '../../src/schools.mjs';
import {decideLegacyPublicProblem} from '../../src/legacy-public-problems.mjs';

/** Test-only published legacy source + exact public snapshot; never uses live data. */
export async function seedPublicScholarshipProblem(owner,{authorId,title='Reviewed public aid',publishContent=true}={}) {
 if(!authorId) {
  const identity=(await owner.query("INSERT INTO identities(kind,number,name) VALUES('teacher',$1,'Test author') RETURNING id",[randomUUID()])).rows[0];
  authorId=(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,randomUUID(),'unusable-test-hash'])).rows[0].id;
 }
 const bankId=(await owner.query("INSERT INTO problem_banks(name,visibility,owner_account_id) VALUES('Public fixture','school',$1) RETURNING id",[authorId])).rows[0].id;
 const problemId=(await owner.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',[authorId,bankId])).rows[0].id;
 const versionId=(await owner.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,time_limit_ms,memory_limit_mb,reference_code,samples,metadata,validation_status)
 VALUES($1,$2,'stdio','Print five.',1000,128,'PRIVATE_REFERENCE','[{"input":"","expected":"5","enabled":true}]','{"teacherNote":"PRIVATE_TEACHER_NOTE"}','AC') RETURNING id`,[problemId,title])).rows[0].id;
 await owner.query("INSERT INTO test_cases(version_id,position,input,expected,weight) VALUES($1,1,'PRIVATE_HIDDEN_INPUT','5',100)",[versionId]);
 await owner.query("UPDATE problem_versions SET published_at=now(),rank_review_status='approved',rank_approved_at=now(),school_visible_at=now() WHERE id=$1",[versionId]);
 await owner.query('UPDATE problems SET current_version_id=$2 WHERE id=$1',[problemId,versionId]);
 await transaction(owner,async db=>{
  await db.query("SELECT set_config('campus.school_id',$1,true)",[LEGACY_SCHOOL_ID]);
  await decideLegacyPublicProblem(db,{problemId,versionId,decision:'approve',actorId:authorId});
 });
 const contentIds={};
 for(const [kind,language,body]of [['FULL_TRANSLATION','zh-CN','输出数字五。'],['FULL_SOLUTION','','Return the required constant.\n```python\nprint(5)\n```']]) {
  const row=(await owner.query(`INSERT INTO luq_assistance_contents(subject_key,version_id,kind,language,body,author_account_id,status,reviewer_account_id,published_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$6,CASE WHEN $7='published' THEN clock_timestamp() ELSE NULL END) RETURNING id`,['problem:'+problemId,versionId,kind,language,body,authorId,publishContent?'published':'draft'])).rows[0];
  contentIds[kind]=row.id;
 }
 return {problemId,versionId,authorId,bankId,contentIds};
}

export async function seedPublicScholarshipLearner(owner,{kind='personal'}={}) {
 const key=randomUUID();
 const identityId=(await owner.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$2) RETURNING id',[kind,key])).rows[0].id;
 const id=(await owner.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,key,'unusable-test-hash'])).rows[0].id;
 if(kind==='student')await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'student')",[id]);
 return {id,identityId,roles:kind==='student'?['student']:[]};
}
