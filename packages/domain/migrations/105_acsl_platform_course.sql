-- Move the reviewed unified ACSL source, never a same-title copy. The source
-- school remains its storage namespace; all chapter and student identities stay.
DO $$
DECLARE
 course learning_paths%ROWTYPE;
 chapter_count integer;
 reference_count integer;
 unpinned_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('school-teaching:00000000-0000-4000-8000-000000000052',0));
 SELECT * INTO course FROM learning_paths
  WHERE id='ff018311-56ec-4aa2-ba66-04e7925c18a8' FOR UPDATE;
 IF NOT FOUND OR course.owner_scope='platform' THEN RETURN; END IF;
 IF course.school_id<>'00000000-0000-4000-8000-000000000052'
   OR course.published_at IS NOT NULL OR course.archived_at IS NOT NULL
   OR course.merged_into_id IS NOT NULL THEN
  RAISE EXCEPTION 'ACSL ownership migration requires the existing unpublished unified source';
 END IF;
 PERFORM 1 FROM learning_chapters WHERE path_id=course.id FOR UPDATE;
 SELECT count(*) INTO chapter_count FROM learning_chapters WHERE path_id=course.id AND archived_at IS NULL;
 SELECT count(*),count(*) FILTER (WHERE NOT (link ? 'versionId') OR nullif(link->>'versionId','') IS NULL)
  INTO reference_count,unpinned_count FROM learning_chapters c
  CROSS JOIN LATERAL jsonb_array_elements(c.acsl_links) AS link
  WHERE c.path_id=course.id AND c.archived_at IS NULL;
 IF chapter_count<>39 OR reference_count<>128 OR unpinned_count<>0 THEN
  RAISE EXCEPTION 'ACSL ownership migration expected 39 chapters and 128 pinned references, found % / % (% unpinned)',chapter_count,reference_count,unpinned_count;
 END IF;
 UPDATE learning_paths SET owner_scope='platform',platform_access_scope='schools',
  platform_school_ids=ARRAY['00000000-0000-4000-8000-000000000052'::uuid],platform_student_ids='{}',
  platform_revision=platform_revision+1,updated_at=clock_timestamp()
  WHERE id=course.id;
 INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail)
  VALUES(NULL,'platform.course.source_migrated',course.school_id,jsonb_build_object(
   'courseId',course.id,'title',course.title,'previousOwnerAccountId',course.owner_account_id,
   'previousOwnerScope',course.owner_scope,'ownerScope','platform','chapterCount',chapter_count,
   'acslReferenceCount',reference_count,'migration','105_acsl_platform_course.sql'));
END $$;
