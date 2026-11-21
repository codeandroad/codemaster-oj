import { avatarForIdentity } from './avatars.mjs';
import { fail } from './security.mjs';
import { readableClassCourse } from './school-courses.mjs';
import { calculateSchoolActivityGrade } from './school-activities.mjs';

export async function studentClassroom(db, schoolId, classId, user, membersOnly) {
  const params = [schoolId, classId, user.id];
  const { rows: [group] } = await db.query(`SELECT c.id,c.name,c.description,i.id AS student
    FROM school_classes c JOIN school_class_roster r ON (r.school_id,r.class_id)=(c.school_id,c.id)
    JOIN school_identities i ON (i.school_id,i.id)=(r.school_id,r.identity_id)
    WHERE c.school_id=$1 AND c.id=$2 AND c.archived_at IS NULL AND i.account_id=$3
      AND i.kind='student' AND i.archived_at IS NULL`, params);
  if (!group) fail(404, 'NOT_FOUND', '班级不存在或不可访问');
  const { rows } = await db.query(`SELECT i.id,i.kind,i.name,coalesce(nullif(trim(a.nickname),''),i.name) AS nickname,a.avatar,
    a.id IS NOT NULL AND m.account_id IS NOT NULL AS activated
    FROM school_class_roster r JOIN school_identities i ON (i.school_id,i.id)=(r.school_id,r.identity_id)
    LEFT JOIN accounts a ON a.id=i.account_id AND a.disabled_at IS NULL AND a.binding_released_at IS NULL
    LEFT JOIN school_memberships m ON (m.school_id,m.account_id)=(i.school_id,a.id) AND m.role=i.kind AND m.revoked_at IS NULL
    WHERE r.school_id=$1 AND r.class_id=$2 AND i.archived_at IS NULL ORDER BY i.name,i.id`, [schoolId,classId]);
  const students = rows.filter(r => r.kind === 'student');
  const members = students.filter(r => r.activated).map(r => ({ id:r.id, displayName:r.nickname, avatar:avatarForIdentity(r.avatar,r.id) }));
  if (membersOnly) return { items:members };
  const { rows: tasks } = await db.query(`SELECT a.*,greatest(a.ends_at,p.extended_due_at) AS due
    FROM school_activity_classes ac JOIN school_activities a ON (a.school_id,a.id)=(ac.school_id,ac.activity_id)
    JOIN school_activity_participants p ON (p.school_id,p.activity_id)=(a.school_id,a.id)
    WHERE ac.school_id=$1 AND ac.class_id=$2 AND p.identity_id=$3 AND NOT p.exempt
      AND a.kind='assignment' AND a.state='Published' AND a.cancelled_at IS NULL ORDER BY due DESC,a.id`, [schoolId,classId,group.student]);
  const { rows: assigned } = await db.query(`SELECT p.course_id FROM school_course_publication_classes p
    JOIN school_courses c ON (c.school_id,c.id,c.published_revision)=(p.school_id,p.course_id,p.revision)
    WHERE p.school_id=$1 AND p.class_id=$2`, [schoolId,classId]);
  const candidates = new Map(assigned.map(r => [r.course_id,'school']));
  for (const a of tasks) {
    if (a.school_course_id) candidates.set(a.school_course_id,'school');
    if (a.platform_course_id) candidates.set(a.platform_course_id,'platform');
  }
  const courses = new Map();
  for (const [id, kind] of candidates) {
    const course = await readableClassCourse(db,schoolId,user,id,kind,true);
    if (course) courses.set(id,course);
  }
  const assignments = [];
  for (const a of tasks) {
    const course = courses.get(a.school_course_id ?? a.platform_course_id);
    const grade = await calculateSchoolActivityGrade(db,a,group.student,{includeLate:true});
    assignments.push({id:a.id,title:a.title,dueAt:a.due,coursePathId:course?.id,courseScope:course?.scope,
      courseTitle:course?.title,completedProblems:grade.solved,totalProblems:grade.items.length,
      completed:grade.items.length>0 && grade.solved===grade.items.length});
  }
  const { rows: resources } = await db.query(`SELECT id,title,type,content,coalesce(course_id,platform_course_id) AS "pathId",
    chapter_id AS "chapterId",updated_at AS "updatedAt" FROM school_learning_resources
    WHERE school_id=$1 AND scope='school' AND deleted_at IS NULL AND coalesce(course_id,platform_course_id)=ANY($2::uuid[])
    ORDER BY updated_at DESC,id`, [schoolId,[...courses.keys()]]);
  return {id:group.id,name:group.name,description:group.description,memberCount:students.length,members,
    teachers:rows.filter(r=>r.kind==='teacher').map(r=>({name:r.name})),assignments,paper4Activities:[],
    courses:[...courses.values()].map(({id,title,description,scope})=>({id,title,description,scope})),
    resources:resources.filter(r=>!r.chapterId || courses.get(r.pathId).chapters.some(ch=>ch.id===r.chapterId))};
}
