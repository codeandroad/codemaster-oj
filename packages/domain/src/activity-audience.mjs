import {readableCourseIds} from './course-access.mjs';
import {fail,uuid,field} from './security.mjs';
import {avatarForIdentity} from './avatars.mjs';
import {PRESENCE_TTL_SECONDS} from './presence.mjs';
import {LEGACY_SCHOOL_ID} from './legacy-school.mjs';
import {assignmentProgressById} from './assignment-grades.mjs';
const admin=user=>user.roles.includes('admin');
const staff=user=>user.roles.some(role=>['teacher','admin'].includes(role));
export async function audienceClasses(db,user,body,old=null,kind='assignment'){
 const table=kind==='paper4'?'paper4_activity_classes':kind==='assignment'?'assignment_classes':'timed_practice_classes',column=kind==='paper4'?'paper_id':kind==='assignment'?'assignment_id':'practice_id';
 const previous=old?(await db.query(`SELECT class_id FROM ${table} WHERE ${column}=$1 ORDER BY class_id`,[old.id])).rows.map(row=>row.class_id):[];
 if(old?.class_id&&!previous.length)previous.push(old.class_id);
 let ids;
 if(body.classIds!==undefined){
  if(!Array.isArray(body.classIds)||body.classIds.length>50)fail(400,'VALIDATION','关联班级最多 50 个');
  ids=[...new Set(body.classIds.map(id=>uuid(id,'班级 ID')))];
 }else if(body.classId!==undefined)ids=body.classId===null||body.classId===''?[]:[uuid(body.classId,'班级 ID')];
 else if(old)ids=previous;
 else ids=[];
 // Existing source tags survive historical class archival; new associations
 // require a live class managed by this teacher (or an administrator).
 const unchanged=old&&body.classIds===undefined&&body.classId===undefined;
 if(!unchanged)for(const id of ids){
  if(previous.includes(id))continue;
  const cls=(await db.query('SELECT id FROM classes WHERE id=$1 AND archived_at IS NULL',[id])).rows[0];
  if(!cls)fail(404,'NOT_FOUND','关联班级不存在');
  if(!admin(user)&&!(await db.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[id,user.id])).rowCount)
   fail(403,'FORBIDDEN','只能关联本人负责的班级；学生名单可跨班级选择');
 }
 return ids;
}
export async function replaceAudienceClasses(db,id,ids,kind='assignment'){
 const table=kind==='paper4'?'paper4_activity_classes':kind==='assignment'?'assignment_classes':'timed_practice_classes',column=kind==='paper4'?'paper_id':kind==='assignment'?'assignment_id':'practice_id';
 await db.query(`DELETE FROM ${table} WHERE ${column}=$1`,[id]);
 for(const classId of ids)await db.query(`INSERT INTO ${table}(${column},class_id) VALUES($1,$2)`,[id,classId]);
}
export async function activityClasses(db,id,kind='assignment'){
 const table=kind==='paper4'?'paper4_activity_classes':kind==='assignment'?'assignment_classes':'timed_practice_classes',column=kind==='paper4'?'paper_id':kind==='assignment'?'assignment_id':'practice_id';
 return (await db.query(`SELECT c.id,c.name,(c.archived_at IS NOT NULL) archived FROM ${table} ac JOIN classes c ON c.id=ac.class_id WHERE ac.${column}=$1 ORDER BY c.name,c.id`,[id])).rows;
}
export async function audienceStudents(db,value,{allowEmpty=true}={}){
 if(!Array.isArray(value)||value.length>500||(!allowEmpty&&!value.length))fail(400,'VALIDATION','请选择 1–500 名适用学生');
 const ids=[...new Set(value.map(id=>uuid(id,'学生身份 ID')))];
 if(ids.length){const valid=(await db.query(`SELECT i.id FROM identities i WHERE i.id=ANY($1::uuid[]) AND i.kind='student' AND i.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL AND a.disabled_at IS NOT NULL)`,[ids])).rows;
  if(valid.length!==ids.length)fail(400,'VALIDATION','适用名单须为有效学生身份，可跨班级或尚未分班');}
 return ids;
}
export async function defaultClassStudents(db,classIds){
 if(!classIds.length)return [];
 return (await db.query(`SELECT DISTINCT i.id FROM class_members cm JOIN identities i ON i.id=cm.identity_id
  WHERE cm.class_id=ANY($1::uuid[]) AND i.kind='student' AND i.archived_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL AND a.disabled_at IS NOT NULL) ORDER BY i.id`,[classIds])).rows.map(row=>row.id);
}
export async function linkedCourse(db,value){
 if(value===null||value===''||value===undefined)return null;
 const id=uuid(value,'关联课程 ID');
 const course=(await db.query('SELECT id FROM learning_paths WHERE id=$1 AND published_at IS NOT NULL AND archived_at IS NULL FOR SHARE',[id])).rows[0];
 if(!course)fail(409,'COURSE_UNAVAILABLE','只能关联已发布且未归档的课程');return id;
}
export async function handleTeachingAudience(ctx){
 const {route,method,user,pool,url}=ctx;
 if(route!=='/teaching/audience'||method!=='GET')return null;
 if(!staff(user))fail(403,'FORBIDDEN','需要教师权限');
 const search=field(url.searchParams.get('search')??'','搜索',{min:0,max:100});
 const raw=url.searchParams.get('classIds');const classIds=raw?raw.split(',').map(id=>uuid(id,'班级筛选 ID')):[];
 if(classIds.length>50)fail(400,'VALIDATION','筛选班级过多');
 const unassigned=url.searchParams.get('unassigned')==='true';
 const classes=(await pool.query(`SELECT c.id,c.name,($1::boolean OR EXISTS(SELECT 1 FROM teacher_classes tc WHERE tc.class_id=c.id AND tc.account_id=$2)) "canAssociate"
  FROM classes c WHERE c.archived_at IS NULL ORDER BY c.name,c.id`,[admin(user),user.id])).rows;
 if(classIds.some(id=>!classes.some(c=>c.id===id)))fail(404,'NOT_FOUND','筛选班级不存在');
 const rows=(await pool.query(`SELECT i.id,i.name,i.number,(a.id IS NOT NULL) activated,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name,c.id) FROM class_members cm JOIN classes c ON c.id=cm.class_id AND c.archived_at IS NULL WHERE cm.identity_id=i.id),'[]'::jsonb) classes
  FROM identities i LEFT JOIN accounts a ON a.identity_id=i.id AND a.binding_released_at IS NULL
  WHERE i.kind='student' AND i.archived_at IS NULL AND (a.id IS NULL OR a.disabled_at IS NULL)
   AND ($1='' OR strpos(lower(i.name),lower($1))>0 OR strpos(lower(i.number),lower($1))>0)
  ORDER BY i.number,i.id LIMIT 5000`,[search])).rows;
 const items=rows.filter(row=>!classIds.length&&!unassigned||row.classes.some(c=>classIds.includes(c.id))||unassigned&&!row.classes.length)
  .map(row=>({id:row.id,identityId:row.id,name:row.name,number:row.number,studentNumber:row.number,classIds:row.classes.map(c=>c.id),classNames:row.classes.map(c=>c.name),activated:row.activated}));
 return {status:200,body:{items,classes,total:items.length,counts:{all:rows.length,unassigned:rows.filter(row=>!row.classes.length).length}}};
}

async function classMembers(pool,id){
 // Only public, active student identities; never expose session or last-seen data.
 return (await pool.query(`SELECT i.id,
  CASE WHEN a.leaderboard_use_nickname THEN COALESCE(NULLIF(btrim(a.nickname),''),i.name) ELSE i.name END "displayName",a.avatar,
  EXISTS(SELECT 1 FROM sessions s WHERE s.account_id=a.id AND s.expires_at>statement_timestamp()
   AND s.presence_seen_at>statement_timestamp()-($2::int * interval '1 second')) "isOnline"
  FROM class_members cm JOIN identities i ON i.id=cm.identity_id AND i.kind='student' AND i.archived_at IS NULL
  JOIN accounts a ON a.identity_id=i.id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
  JOIN legacy_school_identity_ownership io ON io.identity_id=i.id AND io.school_id=$3
  JOIN legacy_school_account_ownership ao ON ao.account_id=a.id AND ao.school_id=io.school_id
  WHERE cm.class_id=$1 AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')
  ORDER BY lower(CASE WHEN a.leaderboard_use_nickname THEN COALESCE(NULLIF(btrim(a.nickname),''),i.name) ELSE i.name END),i.id`,[id,PRESENCE_TTL_SECONDS,LEGACY_SCHOOL_ID])).rows
  .map(row=>({id:row.id,displayName:row.displayName,avatar:avatarForIdentity(row.avatar,row.id),isOnline:row.isOnline}));
}

export async function handleClassHub(ctx){
 const {route,method,user,pool}=ctx;const match=route.match(/^\/classes\/([^/]+)(\/members)?$/);
 if(!match||method!=='GET')return null;
 const id=uuid(match[1],'班级 ID');
 const cls=(await pool.query('SELECT id,name,type,description FROM classes WHERE id=$1 AND archived_at IS NULL',[id])).rows[0];
 if(!cls)fail(404,'NOT_FOUND','班级不存在');
 const manager=admin(user)||staff(user)&&!!(await pool.query('SELECT 1 FROM teacher_classes WHERE class_id=$1 AND account_id=$2',[id,user.id])).rowCount;
 const member=user.roles.includes('student')&&!!(await pool.query(`SELECT 1 FROM class_members cm
  JOIN identities i ON i.id=cm.identity_id AND i.kind='student' AND i.archived_at IS NULL
  JOIN accounts a ON a.identity_id=i.id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
  WHERE cm.class_id=$1 AND cm.identity_id=$2 AND a.id=$3
   AND EXISTS(SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='student')`,[id,user.identityId,user.id])).rowCount;
 if(!manager&&!member)fail(403,'FORBIDDEN','仅班级成员可查看班级内容');
 if(match[2])return {status:200,body:{items:await classMembers(pool,id)}};
 const assignments=(await pool.query(`SELECT a.id,a.title,a.due_at "dueAt",a.course_path_id "coursePathId",p.title "courseTitle"
  FROM assignments a LEFT JOIN learning_paths p ON p.id=a.course_path_id AND p.published_at IS NOT NULL AND p.archived_at IS NULL
  WHERE a.state='Published' AND a.archived_at IS NULL
   AND (a.class_id=$1 OR EXISTS(SELECT 1 FROM assignment_classes ac WHERE ac.assignment_id=a.id AND ac.class_id=$1))
   AND ($3::boolean AND (a.owner_account_id=$4 OR $5::boolean) OR EXISTS(SELECT 1 FROM assignment_participants part WHERE part.assignment_id=a.id AND part.identity_id=$2 AND NOT part.exempt))
  ORDER BY a.created_at DESC,a.id`,[id,user.identityId,manager,user.id,admin(user)])).rows;
 if(member){
  const progress=await assignmentProgressById(pool,assignments.map(a=>a.id),user.identityId);
  for(const assignment of assignments){
   const summary=progress.get(assignment.id);
   if(summary?.totalProblems)Object.assign(assignment,summary);
  }
 }
 const timedPractices=(await pool.query(`SELECT t.id,t.title,t.starts_at "startsAt",t.ends_at "endsAt",t.duration_minutes "durationMinutes",t.course_path_id "coursePathId",p.title "courseTitle",
  CASE WHEN NOT $6::boolean OR part.identity_id IS NULL THEN NULL
   WHEN attempt.id IS NULL THEN 'not_started'
   WHEN attempt.state='Finished' OR attempt.deadline_at<=statement_timestamp()
    OR t.forced_ended_at IS NOT NULL OR t.results_published_at IS NOT NULL THEN 'completed'
   ELSE 'in_progress' END "completionStatus"
  FROM timed_practices t LEFT JOIN learning_paths p ON p.id=t.course_path_id AND p.published_at IS NOT NULL AND p.archived_at IS NULL
  LEFT JOIN timed_practice_participants part ON part.practice_id=t.id AND part.identity_id=$2 AND NOT part.exempt
  LEFT JOIN timed_attempts attempt ON attempt.practice_id=t.id AND attempt.identity_id=part.identity_id AND $6::boolean
  WHERE t.state<>'Draft' AND t.archived_at IS NULL
   AND (t.class_id=$1 OR EXISTS(SELECT 1 FROM timed_practice_classes ac WHERE ac.practice_id=t.id AND ac.class_id=$1))
   AND ($3::boolean AND (t.owner_account_id=$4 OR $5::boolean) OR part.identity_id IS NOT NULL)
  ORDER BY t.created_at DESC,t.id`,[id,user.identityId,manager,user.id,admin(user),member])).rows;
 const paper4Activities=(await pool.query(`SELECT p.id,p.title,p.activity_kind "activityKind",p.starts_at "startsAt",p.ends_at "endsAt",
  CASE WHEN part.identity_id IS NULL THEN NULL
   WHEN attempt.state IS NULL THEN 'not_started'
   WHEN attempt.state='submitted' THEN 'submitted'
   WHEN version.ends_at<=statement_timestamp() THEN 'ended'
   ELSE 'in_progress' END "completionStatus"
  FROM paper4_papers p
  LEFT JOIN paper4_versions version ON version.id=p.current_version_id AND version.paper_id=p.id
  LEFT JOIN paper4_activity_participants part ON part.paper_id=p.id AND part.identity_id=$5 AND $2::boolean
  LEFT JOIN LATERAL (
   SELECT a.state FROM paper4_attempts a
   WHERE a.paper_id=p.id AND a.version_id=version.id AND a.identity_id=part.identity_id
   ORDER BY a.attempt_number DESC LIMIT 1
  ) attempt ON true
  WHERE (p.class_id=$1 OR EXISTS(SELECT 1 FROM paper4_activity_classes ac WHERE ac.paper_id=p.id AND ac.class_id=$1)) AND p.delivery_kind='activity' AND p.status='published' AND p.archived_at IS NULL
   AND (p.owner_account_id=$3 OR $4::boolean OR part.identity_id IS NOT NULL)
  ORDER BY p.created_at DESC,p.id`,[id,member,user.id,admin(user),user.identityId])).rows;
 const linkedIds=[...new Set([...assignments,...timedPractices].map(item=>item.coursePathId).filter(Boolean))];
 const linkedReadable=await readableCourseIds(pool,user,linkedIds);
 for(const item of [...assignments,...timedPractices])if(!linkedReadable.has(item.coursePathId)){item.coursePathId=null;item.courseTitle=null;}
 // Course discovery respects its own audience even when class work links it.
 const associated=(await pool.query('SELECT path_id FROM learning_path_classes WHERE class_id=$1',[id])).rows.map(row=>row.path_id);
 const associatedReadable=await readableCourseIds(pool,user,associated,{listed:true});
 const courseIds=[...new Set([...linkedReadable,...associatedReadable])];
 const courses=courseIds.length?(await pool.query('SELECT id,title,description FROM learning_paths WHERE id=ANY($1::uuid[]) ORDER BY title,id',[courseIds])).rows:[];
 const resources=courses.length?(await pool.query(`SELECT r.id,r.title,r.type,r.content,r.path_id "pathId",r.chapter_id "chapterId",r.scope,r.updated_at "updatedAt"
  FROM learning_resources r WHERE r.path_id=ANY($1::uuid[]) AND r.scope='school' AND r.archived_at IS NULL ORDER BY r.updated_at DESC,r.id`,[courses.map(c=>c.id)])).rows:[];
 const teachers=(await pool.query(`SELECT DISTINCT i.name FROM teacher_classes tc JOIN accounts a ON a.id=tc.account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
  JOIN identities i ON i.id=a.identity_id AND i.archived_at IS NULL WHERE tc.class_id=$1 ORDER BY i.name`,[id])).rows;
 // Classmates get the same small public identity projection as the school
 // leaderboard. Only accounts with a live public student profile are linked;
 // pending activation, released bindings and disabled identities stay private.
 const members=await classMembers(pool,id);
 const memberCount=(await pool.query(`SELECT count(*)::int n FROM class_members cm
  JOIN identities i ON i.id=cm.identity_id AND i.kind='student' AND i.archived_at IS NULL
  WHERE cm.class_id=$1 AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL AND a.disabled_at IS NOT NULL)`,[id])).rows[0].n;
 return {status:200,body:{...cls,className:cls.name,memberCount,members,teachers,assignments,timedPractices,paper4Activities,courses,resources}};
}
