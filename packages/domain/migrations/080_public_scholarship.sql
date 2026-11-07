-- Public learners use the existing stable global-identity wallet. School-local
-- wallets stay separate. No grant on registration/login and no historical AC
-- backpay: the personal allowance is initialized only by explicit wallet use.
CREATE OR REPLACE FUNCTION luq_post_entry(p_identity uuid,p_delta integer,p_kind text,p_source text,p_actor uuid,p_reason text,
 p_metadata jsonb DEFAULT '{}',p_refund bigint DEFAULT NULL,p_hash text DEFAULT NULL,p_request text DEFAULT NULL) RETURNS luq_ledger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing luq_ledger; original luq_ledger; current_balance integer; result luq_ledger;
BEGIN
 IF p_request IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('luq-request:'||p_request,0)); END IF;
 IF p_delta=0 OR p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'LUQ_INVALID_ENTRY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM identities WHERE id=p_identity AND kind IN ('student','personal')) THEN RAISE EXCEPTION 'LUQ_STUDENT_REQUIRED'; END IF;
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
 IF NOT EXISTS(SELECT 1 FROM identities WHERE id=student AND kind IN ('student','personal') AND archived_at IS NULL) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 IF EXISTS(SELECT 1 FROM luq_initial_grants WHERE identity_id=student) THEN RETURN; END IF;
 SELECT initial_grant,rule_version INTO allowance,version FROM luq_settings WHERE singleton;
 IF allowance>0 THEN
  entry:=luq_post_entry(student,allowance,'initial_grant','initial-grant:'||student::text,NULL,
   'Initial student Luq allowance',jsonb_build_object('ruleVersion',version,'initialGrant',allowance));
 END IF;
 -- Zero disables the allowance for this identity permanently; increasing the
 -- setting later does not retroactively mint it or turn login into a reward.
 INSERT INTO luq_initial_grants(identity_id,amount,rule_version,ledger_id)
 VALUES(student,allowance,version,entry.id);
END $$;
REVOKE ALL ON FUNCTION luq_grant_initial(uuid) FROM PUBLIC;


GRANT EXECUTE ON FUNCTION luq_grant_initial(uuid) TO campus_app;
REVOKE ALL ON FUNCTION luq_grant_initial(uuid) FROM campus_worker;

CREATE TABLE public_luq_receipts (
 school_id uuid NOT NULL, job_id uuid NOT NULL, identity_id uuid NOT NULL REFERENCES identities(id),
 subject_key text NOT NULL, version_id uuid NOT NULL, received_at timestamptz NOT NULL,
 solution_assisted boolean NOT NULL, amount integer NOT NULL CHECK(amount>=0), rule_version integer NOT NULL,
 PRIMARY KEY(school_id,job_id), FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id)
);
CREATE TABLE public_luq_results (
 school_id uuid NOT NULL, job_id uuid NOT NULL, status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,job_id), FOREIGN KEY(school_id,job_id) REFERENCES school_judge_jobs(school_id,id)
);
CREATE TRIGGER public_luq_receipts_immutable BEFORE UPDATE OR DELETE ON public_luq_receipts
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER public_luq_results_immutable BEFORE UPDATE OR DELETE ON public_luq_results
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
REVOKE ALL ON public_luq_receipts,public_luq_results FROM PUBLIC,campus_app,campus_worker;

-- This owner-only SELECT policy already limits cross-school reads to completed
-- public jobs. Preserve every historical success as consumed, without reward.
INSERT INTO luq_first_ac_claims(identity_id,subject_key,source_key,eligible,reason)
 SELECT DISTINCT a.identity_id,
 CASE WHEN j.school_id='00000000-0000-4000-8000-000000000052' THEN 'problem:'||j.problem_id
 ELSE 'public-school:'||j.school_id||':problem:'||j.problem_id END,
 'historical-public',false,'historical_public_ac'
 FROM school_judge_jobs j JOIN accounts a ON a.id=j.account_id
 WHERE j.access_context='public' AND j.kind='submit' AND j.activity_id IS NULL
 AND j.state='completed' AND j.result->>'status'='AC' ON CONFLICT DO NOTHING;
INSERT INTO public_luq_results(school_id,job_id,status)
 SELECT school_id,id,result->>'status' FROM school_judge_jobs
 WHERE access_context='public' AND kind='submit' AND activity_id IS NULL AND state='completed'
 AND result->>'status' IN ('AC','WA','CE','RE','TLE','MLE','OLE');

CREATE FUNCTION public_luq_job() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE student uuid; subject text; used boolean; cfg luq_settings;
 receipt public_luq_receipts; prior public_luq_results; verdict text;
 old_scope text:=current_setting('campus.school_id',true);
BEGIN
 IF NEW.access_context<>'public' OR NEW.kind<>'submit' OR NEW.activity_id IS NOT NULL THEN RETURN NEW; END IF;
 PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT a.identity_id INTO student FROM accounts a JOIN identities i ON i.id=a.identity_id
 WHERE a.id=NEW.account_id AND i.kind IN ('student','personal');
 IF student IS NULL THEN PERFORM set_config('campus.school_id',coalesce(old_scope,''),true); RETURN NEW; END IF;
 subject:=CASE WHEN NEW.school_id='00000000-0000-4000-8000-000000000052' THEN 'problem:'||NEW.problem_id
 ELSE 'public-school:'||NEW.school_id||':problem:'||NEW.problem_id END;
 IF TG_OP='INSERT' THEN
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
  VALUES(NEW.school_id,NEW.id,student,subject,NEW.version_id,NEW.created_at,used,cfg.first_ac_reward,cfg.rule_version);
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
   INSERT INTO public_luq_results(school_id,job_id,status) VALUES(NEW.school_id,NEW.id,verdict);
   SELECT * INTO receipt FROM public_luq_receipts WHERE school_id=NEW.school_id AND job_id=NEW.id;
   IF verdict='AC' THEN
    PERFORM luq_claim_first_ac(student,subject,'public-job:'||NEW.id,
     receipt.job_id IS NOT NULL AND NOT receipt.solution_assisted,coalesce(receipt.amount,0),
     CASE WHEN receipt.job_id IS NULL THEN 'historical_public_submission' WHEN receipt.solution_assisted THEN 'solution_assisted' ELSE 'public_first_ac' END);
   END IF;
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',coalesce(old_scope,''),true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public_luq_job() FROM PUBLIC,campus_app,campus_worker;
CREATE TRIGGER public_luq_job AFTER INSERT OR UPDATE ON school_judge_jobs
 FOR EACH ROW EXECUTE FUNCTION public_luq_job();

-- Keep answer-use snapshots symmetric across the public and school entry points.
-- Only the stable account identity links usage; balances and purchases remain
-- in their respective ledgers. No prior receipt, claim or balance is changed.
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
  public_subject:=CASE WHEN s='00000000-0000-4000-8000-000000000052' THEN subject ELSE 'public-school:'||s||':'||subject END;
  used:=used OR EXISTS(SELECT 1 FROM luq_assistance_deliveries WHERE identity_id=learner AND subject_key=public_subject AND kind='FULL_SOLUTION' AND provided_at<=received);
 END IF;
 INSERT INTO school_scholarship_receipts(school_id,source_kind,job_id,subject_key,identity_id,version_id,assisted,amount,points,rule_version,received_at,activity_id,deadline_at)
 VALUES(s,source,job,subject,i,v,used,cfg.first_ac_reward,cfg.first_ac_points,cfg.revision,received,activity,deadline);
END $$;
REVOKE ALL ON FUNCTION school_scholarship_record_receipt(uuid,text,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz) FROM PUBLIC,campus_app,campus_worker;
