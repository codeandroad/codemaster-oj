// Platform-authored teaching content includes its own self-checks. School
// publication snapshots deliberately retain their separate prose-only policy.
async function platformCourseChapters(db,courseId) {
 return (await db.query(`SELECT c.id,c.title,c.content body,c.objective,c.checkpoint,
  c.checkpoint_answer AS "checkpointAnswer",c.section_key AS "sectionKey",c.localizations,c.acsl_links AS "acslLinks",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('problemId',cp.problem_id,'versionId',cp.version_id)
   ORDER BY cp.position,cp.problem_id) FROM chapter_problems cp WHERE cp.chapter_id=c.id),'[]'::jsonb) problems
  FROM learning_chapters c WHERE c.path_id=$1 AND c.archived_at IS NULL ORDER BY c.position,c.created_at,c.id`,[courseId])).rows;
}

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
 if(p&&detail)p.chapters=await platformCourseChapters(db,p.id);
 return p;
}
export async function platformReadProgress(db,listing,accountId) {
 return (await db.query(`SELECT c.id chapter_id,pr.completed read FROM learning_chapters c
  JOIN learning_progress pr ON pr.chapter_id=c.id JOIN accounts a ON a.identity_id=pr.identity_id
  WHERE c.path_id=$1 AND a.id=$2`,[listing.course_id,accountId])).rows;
}
