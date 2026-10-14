import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPool} from '../src/db.mjs';
import {migrate} from '../src/migrate.mjs';
import {handleCommunity} from '../src/community.mjs';

test('community validates identity, text, and student-only posting before database writes',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const ctx={route:`/profiles/${id}/messages`,method:'POST',body:{body:'Hi'},
  user:{id,identityId:randomUUID(),roles:['teacher']}};
 await assert.rejects(handleCommunity(ctx),e=>e.status===403);
 await assert.rejects(handleCommunity({...ctx,user:{...ctx.user,roles:['student']},
  body:{body:'https://example.com'}}),e=>e.status===400);
 await assert.rejects(handleCommunity({...ctx,route:'/profiles/invalid-id',method:'GET'}),
  e=>e.status===400);
});

test('report resolution migration preserves and classifies preexisting deleted reports',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`community_upgrade_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(url.href);
  try{
   await pool.query(`CREATE TABLE schema_migrations (
    name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`);
   await pool.query(`INSERT INTO schema_migrations(name) VALUES
    ('023_guestbook_report_resolution.sql'),
    ('024_guestbook_deleted_report_consistency.sql')`);
   await migrate(pool);
   const identityId=(await pool.query(`INSERT INTO identities(kind,number,name)
    VALUES('student',$1,'Student') RETURNING id`,[randomUUID()])).rows[0].id;
   const accountId=(await pool.query(`INSERT INTO accounts(identity_id,username,password_hash)
    VALUES($1,$2,'test-hash') RETURNING id`,[identityId,randomUUID()])).rows[0].id;
   const messageId=(await pool.query(`INSERT INTO student_guestbook_messages(
    profile_identity_id,author_account_id,body) VALUES($1,$2,'old report') RETURNING id`,
    [identityId,accountId])).rows[0].id;
   const reportId=(await pool.query(`INSERT INTO student_guestbook_reports(
    message_id,reporter_account_id,reason) VALUES($1,$2,'spam') RETURNING id`,
    [messageId,accountId])).rows[0].id;
   await pool.query(`UPDATE student_guestbook_messages
    SET deleted_at=now(),deleted_by_account_id=$1 WHERE id=$2`,[accountId,messageId]);
   await pool.query(`DELETE FROM schema_migrations WHERE name IN
    ('023_guestbook_report_resolution.sql','024_guestbook_deleted_report_consistency.sql')`);
   await migrate(pool);
   const report=(await pool.query(`SELECT resolution,resolved_at,resolved_by_account_id
    FROM student_guestbook_reports WHERE id=$1`,[reportId])).rows[0];
   assert.equal(report.resolution,'delete');
   assert.ok(report.resolved_at);
   assert.equal(report.resolved_by_account_id,accountId);
  }finally{
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });

test('later deletion migration corrects previously dismissed report timestamps',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`community_delete_upgrade_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(url.href);
  try{
   await migrate(pool);
   const identityId=(await pool.query(`INSERT INTO identities(kind,number,name)
    VALUES('student',$1,'Student') RETURNING id`,[randomUUID()])).rows[0].id;
   const accountId=(await pool.query(`INSERT INTO accounts(identity_id,username,password_hash)
    VALUES($1,$2,'test-hash') RETURNING id`,[identityId,randomUUID()])).rows[0].id;
   const messageId=(await pool.query(`INSERT INTO student_guestbook_messages(
    profile_identity_id,author_account_id,body) VALUES($1,$2,'old dismissed report') RETURNING id`,
    [identityId,accountId])).rows[0].id;
   const reportId=(await pool.query(`INSERT INTO student_guestbook_reports(
    message_id,reporter_account_id,reason,resolution,resolved_at,resolved_by_account_id)
    VALUES($1,$2,'spam','dismiss',now()-interval '1 day',$2) RETURNING id`,
    [messageId,accountId])).rows[0].id;
   const deletedAt=(await pool.query(`UPDATE student_guestbook_messages
    SET deleted_at=clock_timestamp(),deleted_by_account_id=$1
    WHERE id=$2 RETURNING deleted_at`,[accountId,messageId])).rows[0].deleted_at;
   await pool.query("DELETE FROM schema_migrations WHERE name='024_guestbook_deleted_report_consistency.sql'");
   await migrate(pool);
   const report=(await pool.query(`SELECT resolution,resolved_at,resolved_by_account_id
    FROM student_guestbook_reports WHERE id=$1`,[reportId])).rows[0];
   assert.equal(report.resolution,'delete');
   assert.equal(report.resolved_at.getTime(),deletedAt.getTime());
   assert.equal(report.resolved_by_account_id,accountId);
  }finally{
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });

test('school-wide profiles, first-AC activity and guestbook keep class-scoped moderation',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL);
  const schema=`community_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(url.href);
  const audit=async(db,actor,action,type,id,metadata={})=>db.query(
   'INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)',
   [actor,action,type,String(id),metadata]);
  const call=(user,route,method='GET',body={},query='')=>handleCommunity({pool,user,route,method,body,
   url:new URL(`http://localhost/api/v1${route}${query}`),helpers:{audit}});
  try {
   await migrate(pool);
   async function account(kind,legalName,nickname='') {
    const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',
     [kind,randomUUID(),legalName])).rows[0].id;
    const id=(await pool.query(`INSERT INTO accounts(identity_id,username,password_hash,nickname)
     VALUES($1,$2,'test-hash',$3) RETURNING id`,[identityId,randomUUID(),nickname])).rows[0].id;
    await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[id,kind]);
    return {id,identityId,roles:[kind],nickname,avatar:''};
   }
   const teacher=await account('teacher','TEACHER-SECRET');
   const otherTeacher=await account('teacher','OTHER-TEACHER');
   const admin=await account('admin','ADMIN-SECRET');
   const alpha=await account('student','ALPHA-LEGAL-NAME','Alpha');
   const beta=await account('student','BETA-LEGAL-NAME','Beta');
   const gamma=await account('student','GAMMA-LEGAL-NAME','Gamma');
   const outsider=await account('student','OUTSIDER-LEGAL-NAME','Outside');
   const firstClass=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('A',$1) RETURNING id",[teacher.id])).rows[0].id;
   const secondClass=(await pool.query("INSERT INTO classes(name,owner_account_id) VALUES('B',$1) RETURNING id",[otherTeacher.id])).rows[0].id;
   await pool.query('INSERT INTO teacher_classes(class_id,account_id) VALUES($1,$2),($3,$4)',
    [firstClass,teacher.id,secondClass,otherTeacher.id]);
   for(const [classId,person] of [[firstClass,alpha],[firstClass,beta],[firstClass,gamma],[secondClass,outsider]])
    await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',[classId,person.identityId]);

   const read=(viewer,target)=>call(viewer,`/profiles/${target.identityId}`);
   const publicProfile=(await read(beta,alpha)).body.profile;
   assert.deepEqual(Object.keys(publicProfile).sort(),
    ['avatar','bio','id','isSelf','nickname','points','rankPoints','solvedProblems'].sort());
   assert.equal(publicProfile.nickname,'Alpha');
   assert.equal(publicProfile.isSelf,false);
   assert.equal((await read(alpha,alpha)).body.profile.isSelf,true);
   assert.equal((await read(teacher,alpha)).body.profile.id,alpha.identityId);
   assert.equal((await read(admin,alpha)).body.profile.id,alpha.identityId);
   assert.equal((await read(outsider,alpha)).body.profile.id,alpha.identityId);
   assert.equal((await read(otherTeacher,alpha)).body.profile.id,alpha.identityId);
   assert.ok(!JSON.stringify(publicProfile).includes('ALPHA-LEGAL-NAME'));

   async function problem(visibility,title) {
    const bankId=(await pool.query(`INSERT INTO problem_banks(name,visibility,owner_account_id)
     VALUES($1,$2,$3) RETURNING id`,[title,visibility,teacher.id])).rows[0].id;
    const id=(await pool.query('INSERT INTO problems(owner_account_id,bank_id) VALUES($1,$2) RETURNING id',
     [teacher.id,bankId])).rows[0].id;
    const versionId=(await pool.query(`INSERT INTO problem_versions(problem_id,title,mode,statement,
     time_limit_ms,memory_limit_mb,reference_code,validation_status,published_at)
     VALUES($1,$2,'stdio','Task',500,64,'print(1)','AC',now()) RETURNING id`,
     [id,title])).rows[0].id;
    if(visibility==='school')
     await pool.query('UPDATE problem_versions SET school_visible_at=now() WHERE id=$1',[versionId]);
    await pool.query('UPDATE problems SET current_version_id=$1 WHERE id=$2',[versionId,id]);
    return {id,versionId};
   }
   const publicProblem=await problem('school','Visible problem');
   const privateProblem=await problem('private','PRIVATE-PROBLEM-SECRET');
   for(const item of [publicProblem,privateProblem])
    await pool.query(`INSERT INTO submissions(account_id,identity_id,problem_id,version_id,kind,
     code,idempotency_key,request_hash,status,score)
     VALUES($1,$2,$3,$4,'submit','print(1)',$5,'community-test','AC',100)`,
     [alpha.id,alpha.identityId,item.id,item.versionId,randomUUID()]);
   const otherActivity=(await call(beta,`/profiles/${alpha.identityId}/activity`)).body;
   assert.equal(otherActivity.total,1);
   assert.equal(otherActivity.items[0].problemTitle,'Visible problem');
   assert.ok(!JSON.stringify(otherActivity).includes('PRIVATE-PROBLEM-SECRET'));
   const ownActivity=(await call(alpha,`/profiles/${alpha.identityId}/activity`)).body;
   assert.equal(ownActivity.total,2);
   assert.equal((await read(beta,alpha)).body.profile.solvedProblems,2);
   assert.equal((await call(outsider,`/profiles/${alpha.identityId}/activity`)).body.total,1);

   const messageRoute=`/profiles/${alpha.identityId}/messages`;
   const posted=(await call(beta,messageRoute,'POST',{body:'做得好！'})).body;
   assert.equal(posted.body,'做得好！');
   assert.deepEqual(posted.author,{id:beta.identityId,nickname:'Beta',avatar:''});
   assert.equal(posted.canDelete,true);
   assert.equal(posted.canReport,false);
   await assert.rejects(pool.query('UPDATE student_guestbook_messages SET body=$1 WHERE id=$2',
    ['changed after publication',posted.id]),/guestbook message content is immutable/);
   const ownPost=(await call(alpha,`/profiles/${beta.identityId}/messages`,'POST',
    {body:'谢谢！'})).body;
   assert.deepEqual((await call(alpha,`/profiles/${beta.identityId}/messages/${ownPost.id}`,'DELETE')).body,
    {ok:true},'authors can remove their own message');
   await assert.rejects(call(beta,messageRoute,'POST',{body:'Second'}),e=>e.status===429);
   await assert.rejects(call(alpha,messageRoute,'POST',{body:'Own'}),e=>e.status===400);
   await assert.rejects(call(teacher,messageRoute,'POST',{body:'Teacher'}),e=>e.status===403);
   const list=(await call(alpha,messageRoute)).body;
   assert.equal(list.total,1);
   assert.equal(list.items[0].canDelete,true,'profile owner can remove a visitor message');
   assert.equal((await call(outsider,messageRoute)).body.total,1);

   const reportRoute=`${messageRoute}/${posted.id}/report`;
   await assert.rejects(call(beta,reportRoute,'POST',{reason:'abuse'}),e=>e.status===400);
   assert.deepEqual((await call(alpha,reportRoute,'POST',{reason:'abuse'})).body,{ok:true});
   await assert.rejects(call(alpha,reportRoute,'POST',{reason:'abuse'}),e=>e.status===409);
   const reportedOwnerView=(await call(alpha,messageRoute)).body;
   assert.equal(reportedOwnerView.total,1,'profile owner retains removal access after reporting');
   assert.equal(reportedOwnerView.items[0].reportedByMe,true);
   assert.equal(reportedOwnerView.items[0].canDelete,true);
   assert.equal(reportedOwnerView.items[0].canReport,false);
   assert.equal((await call(beta,messageRoute)).body.total,1,'other users still see it pending moderation');
   const reportList=(await call(teacher,`/profiles/${alpha.identityId}/message-reports`)).body;
   assert.equal(reportList.total,1);
   assert.equal(reportList.items[0].reason,'abuse');
   await assert.rejects(call(otherTeacher,`/profiles/${alpha.identityId}/message-reports`),e=>e.status===403);
   await assert.rejects(call(teacher,'/profile-message-reports'),e=>e.status===403);
   await assert.rejects(call(alpha,'/profile-message-reports'),e=>e.status===403);
   const allReports=(await call(admin,'/profile-message-reports')).body;
   assert.equal(allReports.total,1);
   assert.equal(allReports.items[0].profileIdentityId,alpha.identityId);
   assert.equal(allReports.items[0].profileNickname,'Alpha');
   assert.equal(allReports.items[0].profileAvailable,true);
   assert.equal(allReports.items[0].authorNickname,'Beta');
   assert.equal(allReports.items[0].reason,'abuse');
   assert.equal(allReports.items[0].deleted,false);
   assert.equal(allReports.items[0].status,'pending');
   assert.deepEqual(allReports.counts,{pending:1,deleted:0,dismissed:0});
   assert.ok(!JSON.stringify(allReports).includes('LEGAL-NAME'));
   await assert.rejects(call(admin,'/profile-message-reports','GET',{},'?pageSize=51'),e=>e.status===400);
   await assert.rejects(call(outsider,`${messageRoute}/${posted.id}`,'DELETE'),e=>e.status===403);
   assert.deepEqual((await call(alpha,`${messageRoute}/${posted.id}`,'DELETE')).body,{ok:true});
   assert.equal((await call(beta,messageRoute)).body.total,0);
   assert.equal((await call(admin,'/profile-message-reports')).body.total,0);
   const deletedReports=(await call(admin,'/profile-message-reports','GET',{},'?status=deleted')).body;
   assert.equal(deletedReports.total,1);
   assert.equal(deletedReports.items[0].deleted,true);
   assert.equal(deletedReports.items[0].status,'deleted');
   assert.equal((await pool.query('SELECT resolution FROM student_guestbook_reports WHERE id=$1',
    [allReports.items[0].id])).rows[0].resolution,'delete');

   const second=(await call(gamma,messageRoute,'POST',{body:'继续加油'})).body;
   assert.deepEqual((await call(alpha,`${messageRoute}/${second.id}/report`,'POST',
    {reason:'other'})).body,{ok:true});
   const secondReport=(await call(admin,'/profile-message-reports')).body.items[0];
   assert.equal(secondReport.status,'pending');
   await assert.rejects(call(teacher,`/profile-message-reports/${secondReport.id}/dismiss`,'POST'),
    e=>e.status===403);
   assert.deepEqual((await call(admin,`/profile-message-reports/${secondReport.id}/dismiss`,'POST')).body,
    {ok:true,status:'dismissed'});
   await assert.rejects(call(admin,`/profile-message-reports/${secondReport.id}/dismiss`,'POST'),
    e=>e.status===409);
   assert.equal((await call(admin,'/profile-message-reports')).body.total,0);
   const dismissed=(await call(admin,'/profile-message-reports','GET',{},'?status=dismissed')).body;
   assert.equal(dismissed.total,1);
   assert.equal(dismissed.items[0].status,'dismissed');
   assert.ok(dismissed.items[0].resolvedAt);
   const ownerAfterDismiss=(await call(alpha,messageRoute)).body.items[0];
   assert.equal(ownerAfterDismiss.reportedByMe,true);
   assert.equal(ownerAfterDismiss.canDelete,true);
   assert.equal(ownerAfterDismiss.canReport,false);
   assert.deepEqual((await call(teacher,`${messageRoute}/${second.id}`,'DELETE')).body,{ok:true});
   assert.equal((await call(admin,'/profile-message-reports','GET',{},'?status=deleted')).body.total,2);
   const finalDecision=(await pool.query(`SELECT r.resolution,r.resolved_at,
    r.resolved_by_account_id,m.deleted_at FROM student_guestbook_reports r
    JOIN student_guestbook_messages m ON m.id=r.message_id WHERE r.id=$1`,
    [secondReport.id])).rows[0];
   assert.equal(finalDecision.resolution,'delete');
   assert.equal(finalDecision.resolved_at.getTime(),finalDecision.deleted_at.getTime());
   assert.equal(finalDecision.resolved_by_account_id,teacher.id);
   assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events
    WHERE action='profile.message_report_dismiss' AND resource_id=$1`,
    [secondReport.id])).rows[0].n,1,'earlier dismissal remains in the audit trail');
   assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events
    WHERE action IN ('profile.message_create','profile.message_report','profile.message_delete',
     'profile.message_report_dismiss')`)).rows[0].n,9);

   const schoolwideNote=(await call(outsider,`/profiles/${beta.identityId}/messages`,'POST',
    {body:'跨班也能互相鼓励'})).body;
   assert.equal(schoolwideNote.author.id,outsider.identityId);
   assert.equal((await call(beta,`/profiles/${beta.identityId}/messages`)).body.total,1);
   await assert.rejects(call(otherTeacher,`/profiles/${beta.identityId}/messages/${schoolwideNote.id}`,'DELETE'),
    e=>e.status===403,'unrelated teachers cannot moderate a class member');
   assert.deepEqual((await call(beta,`/profiles/${beta.identityId}/messages/${schoolwideNote.id}`,'DELETE')).body,
    {ok:true},'profile owner can remove a schoolwide visitor message');

   for(const [kind,column,table] of [
    ['disabled','disabled_at','accounts'],
    ['unbound','binding_released_at','accounts'],
    ['archived','archived_at','identities'],
   ]) {
    const target=await account('student',`TARGET-${kind}`,`Target ${kind}`);
    const writer=await account('student',`WRITER-${kind}`,`Writer ${kind}`);
    for(const person of [target,writer])
     await pool.query('INSERT INTO class_members(class_id,identity_id) VALUES($1,$2)',
      [firstClass,person.identityId]);
    const targetMessages=`/profiles/${target.identityId}/messages`;
    const note=(await call(writer,targetMessages,'POST',{body:`Report on ${kind} profile`})).body;
    await call(target,`${targetMessages}/${note.id}/report`,'POST',{reason:'privacy'});
    const pending=(await call(admin,'/profile-message-reports')).body.items
     .find(item=>item.messageId===note.id);
    assert.ok(pending,'admin queue retains the reported message');
    assert.equal(pending.profileAvailable,true);
    await pool.query(`UPDATE ${table} SET ${column}=now() WHERE id=$1`,
     [table==='accounts'?target.id:target.identityId]);
    await assert.rejects(call(writer,`${targetMessages}/${note.id}`,'DELETE'),
     e=>e.status===404,`${kind} target must remain private to students`);
    await assert.rejects(call(teacher,`${targetMessages}/${note.id}`,'DELETE'),
     e=>e.status===404,`${kind} target must remain private to teachers`);
    assert.deepEqual((await call(admin,`${targetMessages}/${note.id}`,'DELETE')).body,
     {ok:true},`admin can clear a report after ${kind} target removal`);
    const settled=(await call(admin,'/profile-message-reports','GET',{},'?status=deleted')).body.items
     .find(item=>item.id===pending.id);
    assert.ok(settled);
    assert.equal(settled.status,'deleted');
    assert.equal(settled.profileAvailable,false);
   }
  } finally {
   await pool.end();
   await manager.query(`DROP SCHEMA ${schema} CASCADE`);
   await manager.end();
  }
 });
