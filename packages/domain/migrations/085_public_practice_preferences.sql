-- Public practice benefits are independent account choices. Existing wallet
-- entries, purchases, formal submissions, and school memberships stay intact.
CREATE TABLE public_practice_preferences (
 account_id uuid PRIMARY KEY REFERENCES accounts(id),
 scholarship_enabled boolean NOT NULL DEFAULT false,
 ranking_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE public_practice_ranked_jobs (
 school_id uuid NOT NULL, job_id uuid NOT NULL,
 PRIMARY KEY(school_id,job_id),
 FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id)
);
CREATE TABLE public_practice_staff_exposure (
 account_id uuid NOT NULL REFERENCES accounts(id),
 problem_id uuid NOT NULL,
 PRIMARY KEY(account_id,problem_id)
);
REVOKE ALL ON public_practice_preferences,public_practice_ranked_jobs,public_practice_staff_exposure FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT,UPDATE ON public_practice_preferences TO campus_app;
GRANT INSERT ON public_practice_staff_exposure TO campus_app;

-- Capture recorded authoring/review, known access and previously served
-- authoring answers. Membership in an unrelated school is immaterial.
CREATE FUNCTION public_practice_staff_access(s uuid,p uuid,a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public_practice_staff_exposure e WHERE e.problem_id=p AND e.account_id=a)
 OR EXISTS (SELECT 1 FROM school_problems sp WHERE sp.school_id=s AND sp.id=p AND sp.owner_account_id=a)
 OR EXISTS (SELECT 1 FROM school_problem_publications pub WHERE pub.school_id=s AND pub.problem_id=p AND pub.approved_by=a)
 OR EXISTS (SELECT 1 FROM school_problem_publication_requests req WHERE req.school_id=s AND req.problem_id=p
            AND a IN (req.requested_by,req.decided_by))
 OR EXISTS (SELECT 1 FROM school_scholarship_contents c WHERE c.school_id=s AND c.subject_key='problem:'||p
            AND c.kind='FULL_SOLUTION' AND a IN (c.author_account_id,c.reviewer_account_id))
 OR EXISTS (SELECT 1 FROM luq_assistance_contents c WHERE c.kind='FULL_SOLUTION'
            AND c.subject_key=CASE WHEN s='00000000-0000-4000-8000-000000000052' THEN 'problem:'||p
                 ELSE 'public-school:'||s||':problem:'||p END
            AND a IN (c.author_account_id,c.reviewer_account_id))
 OR EXISTS (SELECT 1 FROM school_judge_jobs j WHERE j.school_id=s AND j.problem_id=p
            AND j.account_id=a AND j.kind='validation')
 OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.school_id=s AND m.account_id=a AND m.revoked_at IS NULL
            AND (m.role='school_admin' OR EXISTS (
             SELECT 1 FROM school_administrators g WHERE g.school_id=s AND g.account_id=a AND g.revoked_at IS NULL)))
 OR (s='00000000-0000-4000-8000-000000000052' AND EXISTS (
  SELECT 1 FROM problems lp JOIN problem_banks b ON b.id=lp.bank_id WHERE lp.id=p AND (
   lp.owner_account_id=a OR EXISTS (
    SELECT 1 FROM account_roles r WHERE r.account_id=a AND (
     r.role='admin' OR (r.role='teacher' AND (b.owner_account_id=a OR EXISTS (
      SELECT 1 FROM bank_permissions bp WHERE bp.bank_id=b.id AND bp.account_id=a AND bp.permission='edit'
     )))
    )
   )
  )
 ));
$$;
REVOKE ALL ON FUNCTION public_practice_staff_access(uuid,uuid,uuid) FROM PUBLIC,campus_app,campus_worker;

CREATE OR REPLACE FUNCTION luq_post_entry(p_identity uuid,p_delta integer,p_kind text,p_source text,p_actor uuid,p_reason text,
 p_metadata jsonb DEFAULT '{}',p_refund bigint DEFAULT NULL,p_hash text DEFAULT NULL,p_request text DEFAULT NULL) RETURNS luq_ledger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing luq_ledger; original luq_ledger; current_balance integer; result luq_ledger;
BEGIN
 IF p_request IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('luq-request:'||p_request,0)); END IF;
 IF p_delta=0 OR p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'LUQ_INVALID_ENTRY'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM identities i WHERE i.id=p_identity AND (
   i.kind IN ('student','personal') OR
   (p_kind IN ('initial_grant','first_ac','purchase','refund') AND (
    EXISTS (SELECT 1 FROM luq_initial_grants g WHERE g.identity_id=i.id) OR
    EXISTS (SELECT 1 FROM accounts a JOIN public_practice_preferences pref ON pref.account_id=a.id
            WHERE a.identity_id=i.id AND pref.scholarship_enabled)
   ))
  )
 ) THEN RAISE EXCEPTION 'LUQ_STUDENT_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||p_identity::text,0));
 SELECT * INTO existing FROM luq_ledger WHERE source_key=p_source OR (p_request IS NOT NULL AND request_key=p_request);
 IF FOUND THEN
  IF existing.source_key<>p_source OR existing.identity_id<>p_identity OR existing.delta<>p_delta OR existing.kind<>p_kind OR existing.request_hash IS DISTINCT FROM p_hash
   OR existing.refund_of IS DISTINCT FROM p_refund THEN RAISE EXCEPTION 'LUQ_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN existing;
 END IF;
 IF p_kind='refund' THEN
  SELECT * INTO original FROM luq_ledger WHERE id=p_refund;
  IF NOT FOUND OR original.identity_id<>p_identity OR original.kind<>'purchase' OR p_delta<>-original.delta THEN RAISE EXCEPTION 'LUQ_INVALID_REFUND'; END IF;
  SELECT * INTO existing FROM luq_ledger WHERE refund_of=p_refund;
  IF FOUND THEN RETURN existing; END IF;
 END IF;
 INSERT INTO luq_accounts(identity_id) VALUES(p_identity) ON CONFLICT DO NOTHING;
 SELECT balance INTO current_balance FROM luq_accounts WHERE identity_id=p_identity FOR UPDATE;
 IF current_balance::bigint+p_delta<0 THEN RAISE EXCEPTION 'LUQ_INSUFFICIENT_BALANCE'; END IF;
 IF current_balance::bigint+p_delta>2147483647 THEN RAISE EXCEPTION 'LUQ_BALANCE_LIMIT'; END IF;
 UPDATE luq_accounts SET balance=balance+p_delta,updated_at=clock_timestamp() WHERE identity_id=p_identity RETURNING balance INTO current_balance;
 INSERT INTO luq_ledger(identity_id,delta,balance_after,kind,source_key,actor_account_id,reason,metadata,refund_of,request_hash,request_key)
 VALUES(p_identity,p_delta,current_balance,p_kind,p_source,p_actor,p_reason,COALESCE(p_metadata,'{}'),p_refund,p_hash,p_request) RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION luq_post_entry(uuid,integer,text,text,uuid,text,jsonb,bigint,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION luq_grant_initial(student uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowance integer; version integer; entry luq_ledger;
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM identities i WHERE i.id=student AND i.archived_at IS NULL AND (
   i.kind IN ('student','personal') OR EXISTS (
    SELECT 1 FROM accounts a JOIN public_practice_preferences pref ON pref.account_id=a.id
    WHERE a.identity_id=i.id AND pref.scholarship_enabled
   )
  )
 ) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 IF EXISTS(SELECT 1 FROM luq_initial_grants WHERE identity_id=student) THEN RETURN; END IF;
 SELECT initial_grant,rule_version INTO allowance,version FROM luq_settings WHERE singleton;
 IF allowance>0 THEN
  entry:=luq_post_entry(student,allowance,'initial_grant','initial-grant:'||student::text,NULL,
   'Initial student Luq allowance',jsonb_build_object('ruleVersion',version,'initialGrant',allowance));
 END IF;
 -- A zero allowance also records the one-time decision.
 INSERT INTO luq_initial_grants(identity_id,amount,rule_version,ledger_id)
 VALUES(student,allowance,version,entry.id);
END $$;
REVOKE ALL ON FUNCTION luq_grant_initial(uuid) FROM PUBLIC;


GRANT EXECUTE ON FUNCTION luq_grant_initial(uuid) TO campus_app;
REVOKE ALL ON FUNCTION luq_grant_initial(uuid) FROM campus_worker;

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
 subject:=CASE WHEN NEW.school_id='00000000-0000-4000-8000-000000000052' THEN 'problem:'||NEW.problem_id
 ELSE 'public-school:'||NEW.school_id||':problem:'||NEW.problem_id END;
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
REVOKE ALL ON FUNCTION public_luq_job() FROM PUBLIC,campus_app,campus_worker;

CREATE OR REPLACE FUNCTION public_practice_leaderboard(viewer_id uuid, page_number integer, page_size integer)
RETURNS TABLE (
 rank integer, display_name text, avatar_key text, is_own boolean, solved integer,
 attempts integer, ac_rate numeric, in_page boolean, total integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH formal AS (
   SELECT j.account_id,j.problem_id,j.id,j.created_at,j.result->>'status' AS verdict
   FROM public_practice_ranked_jobs ranked_job
   JOIN school_judge_jobs j ON j.school_id=ranked_job.school_id AND j.id=ranked_job.job_id
   JOIN public_practice_preferences pref ON pref.account_id=j.account_id AND pref.ranking_enabled
   WHERE j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL
     AND j.state='completed' AND (j.result->>'status') IN ('AC','WA','CE','RE','TLE','MLE','OLE')
 ), first_pass AS (
   SELECT DISTINCT ON (f.account_id,f.problem_id) f.account_id,f.problem_id,f.created_at,f.id
   FROM formal f WHERE f.verdict='AC'
   ORDER BY f.account_id,f.problem_id,f.created_at,f.id
 ), metrics AS (
   SELECT f.account_id,count(*)::integer AS attempts,
     count(*) FILTER (WHERE f.verdict='AC')::integer AS solved
   FROM formal f LEFT JOIN first_pass p USING(account_id,problem_id)
   WHERE p.id IS NULL OR (f.created_at,f.id)<=(p.created_at,p.id)
   GROUP BY f.account_id
 ), scored AS (
   SELECT a.id AS account_id, 'Learner-'||upper(left(md5('public-practice:'||a.id::text),8)) AS alias,
     CASE WHEN a.leaderboard_use_nickname THEN NULLIF(btrim(a.nickname),'') END AS nickname,
     COALESCE(m.solved,0) AS solved,COALESCE(m.attempts,0) AS attempts,
     m.solved::numeric/NULLIF(m.attempts,0) AS ac_rate
   FROM accounts a JOIN identities i ON i.id=a.identity_id
   LEFT JOIN metrics m ON m.account_id=a.id
   WHERE a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL
     AND (m.solved>0 OR a.id=viewer_id)
 ), ranked AS (
   SELECT s.*,CASE WHEN s.solved>0 THEN rank() OVER (
      ORDER BY s.solved DESC,s.ac_rate DESC NULLS LAST)::integer END AS rank,
     row_number() OVER (ORDER BY s.solved DESC,s.ac_rate DESC NULLS LAST,s.account_id) AS position,
     count(*) FILTER (WHERE s.solved>0) OVER ()::integer AS total
   FROM scored s
 ), bounds AS (
   SELECT greatest(1,least(100000,page_number)) AS page,
     greatest(1,least(50,page_size)) AS size
 ), selected AS (
   SELECT r.*, r.solved>0 AND r.position>(b.page-1)*b.size AND r.position<=b.page*b.size AS in_page
   FROM ranked r CROSS JOIN bounds b
 )
 SELECT s.rank,COALESCE(s.nickname,s.alias),s.alias,s.account_id=viewer_id,
   s.solved,s.attempts,s.ac_rate,s.in_page,s.total
 FROM selected s WHERE s.in_page OR s.account_id=viewer_id ORDER BY s.position;
$$;
REVOKE ALL ON FUNCTION public_practice_leaderboard(uuid,integer,integer) FROM PUBLIC,campus_worker;
GRANT EXECUTE ON FUNCTION public_practice_leaderboard(uuid,integer,integer) TO campus_app;
