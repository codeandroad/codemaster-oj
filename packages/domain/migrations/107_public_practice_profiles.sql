ALTER TABLE public_practice_preferences ADD COLUMN profile_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public_practice_preferences ADD COLUMN rank_history_included boolean NOT NULL DEFAULT false;

ALTER TABLE student_guestbook_messages ADD COLUMN practice_profile_account_id uuid REFERENCES accounts(id);
CREATE INDEX student_guestbook_practice_profile_idx
 ON student_guestbook_messages(practice_profile_account_id,created_at DESC,id DESC)
 WHERE deleted_at IS NULL AND practice_profile_account_id IS NOT NULL;
CREATE OR REPLACE FUNCTION protect_guestbook_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.profile_identity_id,NEW.author_account_id,NEW.body,NEW.created_at,NEW.practice_profile_account_id)
  IS DISTINCT FROM
  (OLD.id,OLD.profile_identity_id,OLD.author_account_id,OLD.body,OLD.created_at,OLD.practice_profile_account_id) THEN
  RAISE EXCEPTION 'guestbook message content is immutable';
 END IF;
 RETURN NEW;
END $$;

-- Called only for the account that explicitly enables ranking. Preserve
-- admission-time decisions for jobs already included in the leaderboard.
CREATE POLICY school_judge_jobs_public_rank_history_pending ON school_judge_jobs FOR SELECT TO CURRENT_USER
 USING (access_context='public' AND kind='submit' AND activity_id IS NULL AND state IN ('queued','leased')
  AND account_id=NULLIF(current_setting('campus.public_rank_history_account_id',true),'')::uuid);

CREATE FUNCTION include_public_practice_rank_history(target_account uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_school uuid;
 previous_school text:=current_setting('campus.school_id',true);
 previous_account text:=current_setting('campus.public_rank_history_account_id',true);
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public_practice_preferences
   WHERE account_id=target_account AND ranking_enabled) THEN RETURN; END IF;
 PERFORM set_config('campus.public_rank_history_account_id',target_account::text,true);
 FOR source_school IN SELECT DISTINCT j.school_id FROM school_judge_jobs j
  WHERE j.account_id=target_account AND j.access_context='public' AND j.kind='submit'
   AND j.activity_id IS NULL AND j.state IN ('queued','leased','completed')
 LOOP
  PERFORM set_config('campus.school_id',source_school::text,true);
  INSERT INTO public_practice_ranked_jobs(school_id,job_id)
   SELECT j.school_id,j.id FROM school_judge_jobs j
   WHERE j.school_id=source_school AND j.account_id=target_account
    AND j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL
    AND (j.state IN ('queued','leased') OR (j.state='completed' AND j.result->>'status' IN ('AC','WA','CE','RE','TLE','MLE','OLE')))
    AND NOT public_practice_staff_access(j.school_id,j.problem_id,j.account_id)
   ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('campus.school_id',coalesce(previous_school,''),true);
 PERFORM set_config('campus.public_rank_history_account_id',coalesce(previous_account,''),true);
END $$;
REVOKE ALL ON FUNCTION include_public_practice_rank_history(uuid) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION include_public_practice_rank_history(uuid) TO campus_app;
