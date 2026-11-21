-- Preserve established catalog subject keys across school and platform practice.
-- Problems authored directly in a school's bank retain school-qualified keys.
CREATE FUNCTION public_problem_subject(s uuid,p uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN EXISTS (SELECT 1 FROM problems source JOIN problem_banks b ON b.id=source.bank_id
   WHERE source.id=p AND b.school_id=s) THEN 'problem:'||p
   ELSE 'public-school:'||s||':problem:'||p END;
$$;
REVOKE ALL ON FUNCTION public_problem_subject(uuid,uuid) FROM PUBLIC,campus_app,campus_worker;

CREATE OR REPLACE FUNCTION public_practice_staff_access(s uuid,p uuid,a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public_practice_staff_exposure e WHERE e.problem_id=p AND e.account_id=a)
 OR EXISTS (SELECT 1 FROM school_problems sp WHERE sp.school_id=s AND sp.id=p AND sp.owner_account_id=a)
 OR EXISTS (SELECT 1 FROM school_problem_publications pub WHERE pub.school_id=s AND pub.problem_id=p AND pub.approved_by=a)
 OR EXISTS (SELECT 1 FROM school_problem_publication_requests req WHERE req.school_id=s AND req.problem_id=p
            AND a IN (req.requested_by,req.decided_by))
 OR EXISTS (SELECT 1 FROM school_scholarship_contents c WHERE c.school_id=s AND c.subject_key='problem:'||p
            AND c.kind='FULL_SOLUTION' AND a IN (c.author_account_id,c.reviewer_account_id))
 OR EXISTS (SELECT 1 FROM luq_assistance_contents c WHERE c.kind='FULL_SOLUTION'
            AND c.subject_key=public_problem_subject(s,p)
            AND a IN (c.author_account_id,c.reviewer_account_id))
 OR EXISTS (SELECT 1 FROM school_judge_jobs j WHERE j.school_id=s AND j.problem_id=p
            AND j.account_id=a AND j.kind='validation')
 OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.school_id=s AND m.account_id=a AND m.revoked_at IS NULL
            AND (m.role='school_admin' OR EXISTS (
             SELECT 1 FROM school_administrators g WHERE g.school_id=s AND g.account_id=a AND g.revoked_at IS NULL)))
 OR EXISTS (
  SELECT 1 FROM problems lp JOIN problem_banks b ON b.id=lp.bank_id WHERE lp.id=p AND b.school_id=s AND (
   lp.owner_account_id=a OR EXISTS (
    SELECT 1 FROM school_workspace_roles r WHERE r.school_id=s AND r.account_id=a AND (
     r.role='school_admin' OR (r.role='teacher' AND (b.owner_account_id=a OR EXISTS (
      SELECT 1 FROM bank_permissions bp WHERE bp.bank_id=b.id AND bp.account_id=a AND bp.permission='edit'
     )))
    )
   )
  )
 );
$$;

CREATE OR REPLACE FUNCTION public_luq_job() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE student uuid; subject text; used boolean; cfg luq_settings;
 pref public_practice_preferences; staff_access boolean;
 receipt public_luq_receipts; prior public_luq_results; verdict text;
 old_scope text:=current_setting('campus.school_id',true);
BEGIN
 IF NEW.access_context<>'public' OR NEW.kind<>'submit' OR NEW.activity_id IS NOT NULL THEN RETURN NEW; END IF;
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT a.identity_id INTO student FROM accounts a JOIN identities i ON i.id=a.identity_id
 WHERE a.id=NEW.account_id;
 IF student IS NULL THEN PERFORM set_config('campus.school_id',coalesce(old_scope,''),true); RETURN NEW; END IF;
 subject:=public_problem_subject(NEW.school_id,NEW.problem_id);
 IF TG_OP='INSERT' THEN
  -- Serialize preference changes with submission admission. Workers settle the
  -- admitted reward even if the account switches preferences before judging.
  PERFORM pg_advisory_xact_lock(hashtextextended('public-practice:'||NEW.account_id::text,0));
  SELECT * INTO pref FROM public_practice_preferences WHERE account_id=NEW.account_id;
  staff_access:=public_practice_staff_access(NEW.school_id,NEW.problem_id,NEW.account_id);
  IF pref.ranking_enabled AND NOT staff_access THEN
   INSERT INTO public_practice_ranked_jobs(school_id,job_id) VALUES(NEW.school_id,NEW.id);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('luq-assistance:'||student::text,0));
  used:=EXISTS(SELECT 1 FROM luq_assistance_deliveries WHERE identity_id=student AND subject_key=subject
   AND kind='FULL_SOLUTION' AND provided_at<=NEW.created_at);
  -- A solution already supplied in the source school's workspace is still
  -- supplied by this site, even though that school's wallet is independent.
  used:=used OR EXISTS(SELECT 1 FROM school_scholarship_deliveries d JOIN school_identities i
    ON i.school_id=d.school_id AND i.id=d.identity_id WHERE d.school_id=NEW.school_id
    AND i.account_id=NEW.account_id AND d.subject_key='problem:'||NEW.problem_id
    AND d.kind='FULL_SOLUTION' AND d.provided_at<=NEW.created_at);
  SELECT * INTO cfg FROM luq_settings WHERE singleton;
  INSERT INTO public_luq_receipts(school_id,job_id,identity_id,subject_key,version_id,received_at,solution_assisted,amount,rule_version)
  VALUES(NEW.school_id,NEW.id,student,subject,NEW.version_id,NEW.created_at,used,
   CASE WHEN pref.scholarship_enabled AND NOT staff_access THEN cfg.first_ac_reward ELSE 0 END,cfg.rule_version);
 END IF;
 verdict:=NEW.result->>'status';
 IF NEW.state='completed' AND verdict IN ('AC','WA','CE','RE','TLE','MLE','OLE') THEN
  SELECT * INTO prior FROM public_luq_results WHERE school_id=NEW.school_id AND job_id=NEW.id;
  IF FOUND THEN
   IF prior.status IS DISTINCT FROM verdict THEN
    INSERT INTO luq_review_cases(source_key,identity_id,subject_key,reason,metadata)
     VALUES('public-job:'||NEW.id,student,subject,'public_result_changed',jsonb_build_object('jobId',NEW.id,'before',prior.status,'after',verdict)) ON CONFLICT DO NOTHING;
   END IF;
  ELSE
   IF verdict='AC' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('public-first-ac:'||student::text||':'||subject,0));
    SELECT * INTO receipt FROM public_luq_receipts WHERE school_id=NEW.school_id AND job_id=NEW.id;
    IF receipt.job_id IS NULL THEN
     PERFORM luq_claim_first_ac(student,subject,'public-job:'||NEW.id,false,0,'historical_public_submission');
    ELSIF receipt.amount>0 AND NOT receipt.solution_assisted AND NOT EXISTS (
     SELECT 1 FROM school_judge_jobs j JOIN public_luq_results r ON r.school_id=j.school_id AND r.job_id=j.id
     WHERE j.school_id=NEW.school_id AND j.problem_id=NEW.problem_id AND j.account_id=NEW.account_id
      AND j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL AND r.status='AC'
    ) THEN
     PERFORM luq_claim_first_ac(student,subject,'public-job:'||NEW.id,true,receipt.amount,'public_first_ac');
    END IF;
   END IF;
   INSERT INTO public_luq_results(school_id,job_id,status) VALUES(NEW.school_id,NEW.id,verdict);
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',coalesce(old_scope,''),true);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION school_scholarship_record_receipt(s uuid,source text,job uuid,subject text,i uuid,v uuid,received timestamptz,activity uuid,deadline timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg school_scholarship_settings; learner uuid; used boolean; public_subject text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM school_identities WHERE school_id=s AND id=i AND kind='student') THEN RETURN; END IF;
 SELECT a.identity_id INTO learner FROM school_identities si JOIN accounts a ON a.id=si.account_id WHERE si.school_id=s AND si.id=i;
 IF learner IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('luq-assistance:'||learner::text,0)); END IF;
 PERFORM school_scholarship_initial(s,i);
 PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||i,0));
 SELECT * INTO cfg FROM school_scholarship_settings WHERE school_id=s;
 used:=EXISTS(SELECT 1 FROM school_scholarship_deliveries WHERE school_id=s AND identity_id=i AND subject_key=subject AND kind='FULL_SOLUTION' AND provided_at<=received);
 IF source='problem' AND learner IS NOT NULL THEN
  public_subject:=public_problem_subject(s,substring(subject from 9)::uuid);
  used:=used OR EXISTS(SELECT 1 FROM luq_assistance_deliveries WHERE identity_id=learner AND subject_key=public_subject AND kind='FULL_SOLUTION' AND provided_at<=received);
 END IF;
 INSERT INTO school_scholarship_receipts(school_id,source_kind,job_id,subject_key,identity_id,version_id,assisted,amount,points,rule_version,received_at,activity_id,deadline_at)
 VALUES(s,source,job,subject,i,v,used,cfg.first_ac_reward,cfg.first_ac_points,cfg.revision,received,activity,deadline);
END $$;
