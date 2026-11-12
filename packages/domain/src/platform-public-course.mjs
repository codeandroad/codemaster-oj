import { legacyCandidateChapters } from './legacy-public-course.mjs';

// Keep existing catalogue URLs when a school source moves to platform ownership.
// New platform courses use their own stable ID and do not impersonate a school
// publication or create a school approval record.
export async function platformCourseListings(db,id=null) {
 return (await db.query(`SELECT COALESCE(l.id,p.id) id,p.id course_id,p.school_id,
  p.platform_revision revision,'direct'::text access_mode,true platform_owned
  FROM learning_paths p LEFT JOIN public_course_listings l ON l.course_id=p.id AND l.school_id=p.school_id
  WHERE p.owner_scope='platform' AND ($1::uuid IS NULL OR p.id=$1 OR l.id=$1)
  ORDER BY p.updated_at DESC,p.id`,[id])).rows;
}
export async function platformCourseEdition(db,listing,{detail=false,lock=false}={}) {
 const p=(await db.query(`SELECT p.*,p.platform_revision revision,'平台管理员'::text school_name,
  (SELECT count(*)::int FROM learning_chapters c WHERE c.path_id=p.id AND c.archived_at IS NULL) chapter_count
  FROM learning_paths p WHERE p.id=$1 AND p.owner_scope='platform' AND p.published_at IS NOT NULL
  AND p.archived_at IS NULL AND p.withdrawn_at IS NULL AND p.listed
  AND (p.available_from IS NULL OR p.available_from<=now()) AND (p.available_until IS NULL OR p.available_until>now())
  ${lock?'FOR SHARE OF p':''}`,[listing.course_id])).rows[0];
 if(p&&detail)p.chapters=await legacyCandidateChapters(db,p.id);
 return p;
}
export async function platformReadProgress(db,listing,accountId) {
 return (await db.query(`SELECT c.id chapter_id,pr.completed read FROM learning_chapters c
  JOIN learning_progress pr ON pr.chapter_id=c.id JOIN accounts a ON a.identity_id=pr.identity_id
  WHERE c.path_id=$1 AND a.id=$2`,[listing.course_id,accountId])).rows;
}
