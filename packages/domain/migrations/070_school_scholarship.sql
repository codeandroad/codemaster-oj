-- Independent school wallets. No legacy balances, points or history are rewritten.
CREATE TABLE school_scholarship_settings (
 school_id uuid PRIMARY KEY REFERENCES schools(id), initial_grant integer NOT NULL DEFAULT 100 CHECK(initial_grant BETWEEN 0 AND 100000),
 first_ac_reward integer NOT NULL DEFAULT 4 CHECK(first_ac_reward BETWEEN 0 AND 100), translation_price integer NOT NULL DEFAULT 3 CHECK(translation_price BETWEEN 0 AND 1000),
 solution_price integer NOT NULL DEFAULT 8 CHECK(solution_price BETWEEN 0 AND 1000), activity_reward_cap integer NOT NULL DEFAULT 40 CHECK(activity_reward_cap BETWEEN 0 AND 1000),
 first_ac_points integer NOT NULL DEFAULT 10 CHECK(first_ac_points BETWEEN 0 AND 1000), revision integer NOT NULL DEFAULT 1,
 enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(), display_fields jsonb NOT NULL DEFAULT '{"solved":true,"attempts":true,"acRate":true,"scholarship":true}'
);
INSERT INTO school_scholarship_settings(school_id,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap)
 SELECT s.id,l.initial_grant,l.first_ac_reward,l.translation_price,l.solution_price,l.activity_reward_cap FROM schools s CROSS JOIN luq_settings l WHERE s.id<>'00000000-0000-4000-8000-000000000052';
CREATE TABLE school_scholarship_accounts (
 school_id uuid NOT NULL, identity_id uuid NOT NULL, balance integer NOT NULL DEFAULT 0 CHECK(balance>=0), initial_granted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(school_id,identity_id), FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE TABLE school_scholarship_ledger (
 school_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), identity_id uuid NOT NULL, delta integer NOT NULL CHECK(delta<>0), balance_after integer NOT NULL CHECK(balance_after>=0),
 kind text NOT NULL CHECK(kind IN ('initial_grant','admin_grant','admin_adjustment','first_ac','activity','purchase','refund')), source_key text NOT NULL,request_hash text,
 actor_account_id uuid REFERENCES accounts(id),reason text NOT NULL CHECK(length(btrim(reason))>0),metadata jsonb NOT NULL DEFAULT '{}',refund_of uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id),UNIQUE(school_id,source_key),UNIQUE(school_id,refund_of),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id),FOREIGN KEY(school_id,refund_of) REFERENCES school_scholarship_ledger(school_id,id),
 CHECK((kind='refund')=(refund_of IS NOT NULL)),CHECK(kind NOT IN ('initial_grant','admin_grant','first_ac','activity','refund') OR delta>0),CHECK(kind<>'purchase' OR delta<0)
);
CREATE INDEX school_scholarship_ledger_identity ON school_scholarship_ledger(school_id,identity_id,created_at DESC,id);
CREATE TABLE school_scholarship_requests(school_id uuid NOT NULL REFERENCES schools(id),actor_account_id uuid NOT NULL REFERENCES accounts(id),request_id uuid NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(school_id,actor_account_id,request_id));
CREATE TABLE school_scholarship_contents (
 school_id uuid NOT NULL REFERENCES schools(id),id uuid NOT NULL DEFAULT gen_random_uuid(),subject_key text NOT NULL,version_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')),language text NOT NULL DEFAULT '',
 body text NOT NULL,revision integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')),
 author_account_id uuid NOT NULL REFERENCES accounts(id),reviewer_account_id uuid REFERENCES accounts(id),published_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id),UNIQUE(school_id,subject_key,version_id,kind,language)
);
CREATE TABLE school_scholarship_policies (
 school_id uuid NOT NULL REFERENCES schools(id),target_type text NOT NULL CHECK(target_type IN ('subject','activity','paper4_activity')),target_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')),
 mode text NOT NULL DEFAULT 'paid' CHECK(mode IN ('disabled','paid','free')),price integer CHECK(price BETWEEN 0 AND 1000),opens_at timestamptz,revision integer NOT NULL DEFAULT 1,
 PRIMARY KEY(school_id,target_type,target_key,kind)
);
CREATE TABLE school_scholarship_entitlements (
 school_id uuid NOT NULL,identity_id uuid NOT NULL,subject_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')),language text NOT NULL DEFAULT '',ledger_id uuid,credit_ledger_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,identity_id,subject_key,kind,language),UNIQUE(school_id,credit_ledger_id),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id),FOREIGN KEY(school_id,ledger_id) REFERENCES school_scholarship_ledger(school_id,id),FOREIGN KEY(school_id,credit_ledger_id) REFERENCES school_scholarship_ledger(school_id,id)
);
CREATE TABLE school_scholarship_deliveries (
 school_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),identity_id uuid NOT NULL,subject_key text NOT NULL,version_id uuid NOT NULL,kind text NOT NULL,content_id uuid NOT NULL,context_type text NOT NULL,context_id uuid,provided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id),FOREIGN KEY(school_id,content_id) REFERENCES school_scholarship_contents(school_id,id)
);
CREATE INDEX school_scholarship_delivery_lookup ON school_scholarship_deliveries(school_id,identity_id,subject_key,kind,provided_at);
CREATE TABLE school_scholarship_receipts (
 school_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN ('problem','paper4')),job_id uuid NOT NULL,subject_key text NOT NULL,identity_id uuid NOT NULL,version_id uuid NOT NULL,
 assisted boolean NOT NULL,amount integer NOT NULL,points integer NOT NULL,rule_version integer NOT NULL,received_at timestamptz NOT NULL,activity_id uuid,deadline_at timestamptz,
 PRIMARY KEY(school_id,source_kind,job_id,subject_key),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
CREATE TABLE school_scholarship_results (
 school_id uuid NOT NULL,source_kind text NOT NULL,job_id uuid NOT NULL,subject_key text NOT NULL,status text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,source_kind,job_id,subject_key),FOREIGN KEY(school_id,source_kind,job_id,subject_key) REFERENCES school_scholarship_receipts(school_id,source_kind,job_id,subject_key)
);
CREATE TABLE school_scholarship_claims (
 school_id uuid NOT NULL,identity_id uuid NOT NULL,subject_key text NOT NULL,eligible boolean NOT NULL,reason text NOT NULL,ledger_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,identity_id,subject_key),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id),FOREIGN KEY(school_id,ledger_id) REFERENCES school_scholarship_ledger(school_id,id)
);
CREATE TABLE school_rank_awards(school_id uuid NOT NULL,identity_id uuid NOT NULL,subject_key text NOT NULL,points integer NOT NULL CHECK(points>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(school_id,identity_id,subject_key),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id));
CREATE TABLE school_scholarship_review_cases(school_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),source_key text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(school_id,id),UNIQUE(school_id,source_key));
CREATE TABLE school_scholarship_activity_rules (
 school_id uuid NOT NULL REFERENCES schools(id),activity_type text NOT NULL CHECK(activity_type IN ('activity','paper4_activity')),activity_id uuid NOT NULL,revision integer NOT NULL,
 amount integer NOT NULL DEFAULT 0 CHECK(amount BETWEEN 0 AND 1000),minimum_ac integer NOT NULL DEFAULT 1 CHECK(minimum_ac BETWEEN 1 AND 100),minimum_score integer NOT NULL DEFAULT 0 CHECK(minimum_score BETWEEN 0 AND 100),
 task_kind text NOT NULL DEFAULT 'challenge' CHECK(task_kind IN ('challenge','learning','correction')),allow_solution_assisted boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,activity_type,activity_id,revision),CHECK(task_kind<>'challenge' OR NOT allow_solution_assisted)
);
CREATE TABLE school_scholarship_activity_awards(school_id uuid NOT NULL,activity_type text NOT NULL,activity_id uuid NOT NULL,identity_id uuid NOT NULL,rule_revision integer NOT NULL,ledger_id uuid NOT NULL,PRIMARY KEY(school_id,activity_type,activity_id,identity_id),FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id),FOREIGN KEY(school_id,ledger_id) REFERENCES school_scholarship_ledger(school_id,id));

CREATE FUNCTION school_scholarship_entry(s uuid,i uuid,d integer,k text,source text,actor uuid,why text,meta jsonb DEFAULT '{}',refund uuid DEFAULT NULL,hash text DEFAULT NULL) RETURNS school_scholarship_ledger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old school_scholarship_ledger; original school_scholarship_ledger; result school_scholarship_ledger; balance_now integer;
BEGIN
 IF s IS DISTINCT FROM NULLIF(current_setting('campus.school_id',true),'')::uuid THEN RAISE EXCEPTION 'SCHOLARSHIP_SCOPE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM school_identities WHERE school_id=s AND id=i AND kind='student') THEN RAISE EXCEPTION 'SCHOLARSHIP_STUDENT_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||i,0));
 SELECT * INTO old FROM school_scholarship_ledger WHERE school_id=s AND source_key=source;
 IF FOUND THEN
  IF ROW(old.identity_id,old.delta,old.kind,old.request_hash,old.refund_of) IS DISTINCT FROM ROW(i,d,k,hash,refund) THEN RAISE EXCEPTION 'SCHOLARSHIP_REQUEST_CONFLICT'; END IF;
  RETURN old;
 END IF;
 IF k='refund' THEN
  SELECT * INTO original FROM school_scholarship_ledger WHERE school_id=s AND id=refund;
  IF NOT FOUND OR original.identity_id<>i OR original.kind<>'purchase' OR d<>-original.delta THEN RAISE EXCEPTION 'SCHOLARSHIP_INVALID_REFUND'; END IF;
  SELECT * INTO old FROM school_scholarship_ledger WHERE school_id=s AND refund_of=refund; IF FOUND THEN RETURN old; END IF;
  IF EXISTS(SELECT 1 FROM school_scholarship_entitlements WHERE school_id=s AND credit_ledger_id=refund) THEN RAISE EXCEPTION 'SCHOLARSHIP_CREDIT_USED'; END IF;
 END IF;
 INSERT INTO school_scholarship_accounts(school_id,identity_id) VALUES(s,i) ON CONFLICT DO NOTHING;
 SELECT balance INTO balance_now FROM school_scholarship_accounts WHERE school_id=s AND identity_id=i FOR UPDATE;
 IF balance_now::bigint+d<0 THEN RAISE EXCEPTION 'SCHOLARSHIP_INSUFFICIENT'; END IF;
 IF balance_now::bigint+d>2147483647 THEN RAISE EXCEPTION 'SCHOLARSHIP_BALANCE_LIMIT'; END IF;
 UPDATE school_scholarship_accounts SET balance=balance+d WHERE school_id=s AND identity_id=i RETURNING balance INTO balance_now;
 INSERT INTO school_scholarship_ledger(school_id,identity_id,delta,balance_after,kind,source_key,actor_account_id,reason,metadata,refund_of,request_hash)
 VALUES(s,i,d,balance_now,k,source,actor,why,meta,refund,hash) RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION school_scholarship_entry(uuid,uuid,integer,text,text,uuid,text,jsonb,uuid,text) FROM PUBLIC;
CREATE FUNCTION school_scholarship_initial(s uuid,i uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg school_scholarship_settings; previous_scope text;
BEGIN
 previous_scope:=current_setting('campus.school_id',true); PERFORM set_config('campus.school_id',s::text,true);
 IF NOT EXISTS(SELECT 1 FROM school_identities WHERE school_id=s AND id=i AND kind='student') THEN PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true); RETURN; END IF;
 INSERT INTO school_scholarship_settings(school_id,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap)
 SELECT s,initial_grant,first_ac_reward,translation_price,solution_price,activity_reward_cap FROM luq_settings WHERE singleton ON CONFLICT DO NOTHING;
 PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||i,0));
 INSERT INTO school_scholarship_accounts(school_id,identity_id) VALUES(s,i) ON CONFLICT DO NOTHING;
 IF NOT (SELECT initial_granted FROM school_scholarship_accounts WHERE school_id=s AND identity_id=i) THEN
  SELECT * INTO cfg FROM school_scholarship_settings WHERE school_id=s;
  IF cfg.initial_grant>0 THEN PERFORM school_scholarship_entry(s,i,cfg.initial_grant,'initial_grant','initial:'||i,NULL,'Initial student scholarship allowance',jsonb_build_object('ruleVersion',cfg.revision)); END IF;
  UPDATE school_scholarship_accounts SET initial_granted=true WHERE school_id=s AND identity_id=i;
 END IF;
 PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true);
END $$;
REVOKE ALL ON FUNCTION school_scholarship_initial(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION school_scholarship_identity_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM school_scholarship_initial(NEW.school_id,NEW.id); RETURN NEW; END $$;
CREATE TRIGGER school_scholarship_identity_insert AFTER INSERT ON school_identities FOR EACH ROW EXECUTE FUNCTION school_scholarship_identity_insert();

CREATE FUNCTION school_scholarship_record_receipt(s uuid,source text,job uuid,subject text,i uuid,v uuid,received timestamptz,activity uuid,deadline timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg school_scholarship_settings;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM school_identities WHERE school_id=s AND id=i AND kind='student') THEN RETURN; END IF;
 PERFORM school_scholarship_initial(s,i);
 PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||i,0));
 SELECT * INTO cfg FROM school_scholarship_settings WHERE school_id=s;
 INSERT INTO school_scholarship_receipts(school_id,source_kind,job_id,subject_key,identity_id,version_id,assisted,amount,points,rule_version,received_at,activity_id,deadline_at)
 VALUES(s,source,job,subject,i,v,EXISTS(SELECT 1 FROM school_scholarship_deliveries WHERE school_id=s AND identity_id=i AND subject_key=subject AND kind='FULL_SOLUTION' AND provided_at<=received),cfg.first_ac_reward,cfg.first_ac_points,cfg.revision,received,activity,deadline);
END $$;
CREATE FUNCTION school_scholarship_settle_result(s uuid,source text,job uuid,subject text,verdict text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r school_scholarship_receipts; old_status text; awarded school_scholarship_ledger; inserted integer;
BEGIN
 SELECT * INTO r FROM school_scholarship_receipts WHERE school_id=s AND source_kind=source AND job_id=job AND subject_key=subject;
 IF NOT FOUND OR verdict IN ('System Error','Waiting','Judging') THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||r.identity_id,0));
 SELECT status INTO old_status FROM school_scholarship_results WHERE school_id=s AND source_kind=source AND job_id=job AND subject_key=subject;
 IF FOUND THEN
  IF old_status<>verdict THEN INSERT INTO school_scholarship_review_cases(school_id,source_key,reason) VALUES(s,source||':'||job||':'||subject,'Judgement changed after settlement; manual review required') ON CONFLICT DO NOTHING; END IF;
  RETURN;
 END IF;
 INSERT INTO school_scholarship_results(school_id,source_kind,job_id,subject_key,status) VALUES(s,source,job,subject,verdict);
 IF verdict<>'AC' THEN RETURN; END IF;
 INSERT INTO school_rank_awards(school_id,identity_id,subject_key,points) VALUES(s,r.identity_id,subject,r.points) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM school_scholarship_claims WHERE school_id=s AND identity_id=r.identity_id AND subject_key=subject) THEN
  IF NOT r.assisted AND r.amount>0 THEN awarded:=school_scholarship_entry(s,r.identity_id,r.amount,'first_ac','first-ac:'||r.identity_id||':'||subject,NULL,'First formal accepted solution',jsonb_build_object('subjectKey',subject,'ruleVersion',r.rule_version)); END IF;
  INSERT INTO school_scholarship_claims(school_id,identity_id,subject_key,eligible,reason,ledger_id)
  VALUES(s,r.identity_id,subject,NOT r.assisted,CASE WHEN r.assisted THEN 'solution_provided_before_submission' ELSE 'first_formal_ac' END,awarded.id);
 END IF;
END $$;
CREATE FUNCTION school_scholarship_problem_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text;
BEGIN
 IF NEW.kind<>'submit' OR NEW.access_context<>'school' OR NEW.identity_id IS NULL THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true); PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 IF TG_OP='INSERT' THEN
  PERFORM school_scholarship_record_receipt(NEW.school_id,'problem',NEW.id,'problem:'||NEW.problem_id,NEW.identity_id,NEW.version_id,NEW.created_at,NEW.activity_id,NEW.activity_deadline_at);
 ELSIF NEW.state='completed' THEN
  PERFORM school_scholarship_settle_result(NEW.school_id,'problem',NEW.id,'problem:'||NEW.problem_id,COALESCE(NEW.result->>'status','System Error'));
 END IF;
 PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true); RETURN NEW;
END $$;
CREATE TRIGGER school_scholarship_problem_receipt AFTER INSERT ON school_judge_jobs FOR EACH ROW EXECUTE FUNCTION school_scholarship_problem_job();
CREATE TRIGGER school_scholarship_problem_result AFTER UPDATE OF state,result ON school_judge_jobs FOR EACH ROW EXECUTE FUNCTION school_scholarship_problem_job();
CREATE FUNCTION school_scholarship_paper4_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; a school_paper4_attempts; q jsonb; deadline timestamptz;
BEGIN
 IF NEW.kind<>'submit' OR NEW.identity_id IS NULL THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true); PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT * INTO a FROM school_paper4_attempts WHERE school_id=NEW.school_id AND id=NEW.attempt_id;
 SELECT ends_at INTO deadline FROM school_paper4_activities WHERE school_id=NEW.school_id AND id=a.activity_id;
 IF TG_OP='INSERT' THEN
  FOR q IN SELECT value FROM jsonb_array_elements(NEW.payload->'questions') LOOP
   PERFORM school_scholarship_record_receipt(NEW.school_id,'paper4',NEW.id,'paper4:'||a.paper_id||':'||(q->>'key'),NEW.identity_id,NEW.version_id,NEW.created_at,a.activity_id,deadline);
  END LOOP;
 ELSIF NEW.state='completed' THEN
  FOR q IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.result->'questions','[]')) LOOP
   PERFORM school_scholarship_settle_result(NEW.school_id,'paper4',NEW.id,'paper4:'||a.paper_id||':'||(q->>'key'),COALESCE(q->>'status','System Error'));
  END LOOP;
 END IF;
 PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true); RETURN NEW;
END $$;
CREATE TRIGGER school_scholarship_paper4_receipt AFTER INSERT ON school_paper4_jobs FOR EACH ROW EXECUTE FUNCTION school_scholarship_paper4_job();
CREATE TRIGGER school_scholarship_paper4_result AFTER UPDATE OF state,result ON school_paper4_jobs FOR EACH ROW EXECUTE FUNCTION school_scholarship_paper4_job();
-- Remember historical success, including former versions, without retroactive rewards.
INSERT INTO school_scholarship_claims(school_id,identity_id,subject_key,eligible,reason)
 SELECT DISTINCT school_id,identity_id,'problem:'||problem_id,false,'historical_ac' FROM school_judge_jobs WHERE kind='submit' AND access_context='school' AND identity_id IS NOT NULL AND state='completed' AND result->>'status'='AC' ON CONFLICT DO NOTHING;
INSERT INTO school_scholarship_claims(school_id,identity_id,subject_key,eligible,reason)
 SELECT DISTINCT j.school_id,j.identity_id,'paper4:'||a.paper_id||':'||(q->>'key'),false,'historical_ac' FROM school_paper4_jobs j JOIN school_paper4_attempts a ON a.school_id=j.school_id AND a.id=j.attempt_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(j.result->'questions','[]')) q WHERE j.kind='submit' AND j.state='completed' AND q->>'status'='AC' ON CONFLICT DO NOTHING;
DO $$ DECLARE i record; BEGIN FOR i IN SELECT school_id,id FROM school_identities WHERE kind='student' ORDER BY school_id,id LOOP PERFORM school_scholarship_initial(i.school_id,i.id); END LOOP; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['school_scholarship_settings','school_scholarship_accounts','school_scholarship_ledger','school_scholarship_requests','school_scholarship_contents','school_scholarship_policies','school_scholarship_entitlements','school_scholarship_deliveries','school_scholarship_receipts','school_scholarship_results','school_scholarship_claims','school_rank_awards','school_scholarship_review_cases','school_scholarship_activity_rules','school_scholarship_activity_awards'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY school_scope ON %I USING(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid) WITH CHECK(school_id=NULLIF(current_setting(''campus.school_id'',true),'''')::uuid)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['school_scholarship_ledger','school_scholarship_requests','school_scholarship_entitlements','school_scholarship_deliveries','school_scholarship_receipts','school_scholarship_results','school_scholarship_claims','school_rank_awards','school_scholarship_review_cases','school_scholarship_activity_rules','school_scholarship_activity_awards'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION school_scholarship_identity_insert(),school_scholarship_record_receipt(uuid,text,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz),school_scholarship_settle_result(uuid,text,uuid,text,text),school_scholarship_problem_job(),school_scholarship_paper4_job() FROM PUBLIC;
-- Acquire every affected wallet in one global order before an activity settlement.
-- Parallel activity completions, grants and result publication must not invert wallet locks.
CREATE FUNCTION school_scholarship_activity_wallet_locks(s uuid,typ text,aid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;
BEGIN
 IF s IS DISTINCT FROM NULLIF(current_setting('campus.school_id',true),'')::uuid THEN RAISE EXCEPTION 'SCHOLARSHIP_SCOPE'; END IF;
 FOR i IN SELECT identity_id FROM (SELECT identity_id FROM school_activity_participants WHERE school_id=s AND activity_id=aid AND typ='activity' UNION SELECT identity_id FROM school_paper4_participants WHERE school_id=s AND activity_id=aid AND typ='paper4_activity') participants ORDER BY identity_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||i,0));
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION school_scholarship_activity_wallet_locks(uuid,text,uuid) FROM PUBLIC;
-- Settlement uses frozen server receipts, never grades supplied by the caller.
CREATE FUNCTION school_scholarship_settle_activity(s uuid,typ text,aid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rule school_scholarship_activity_rules; a school_activities; pa school_paper4_activities; participant record; row_job record; reward school_scholarship_ledger; stats record; total numeric; previous_scope text; cutoff timestamptz;
BEGIN
 IF s IS DISTINCT FROM NULLIF(current_setting('campus.school_id',true),'')::uuid THEN RAISE EXCEPTION 'SCHOLARSHIP_SCOPE'; END IF;
 PERFORM school_scholarship_activity_wallet_locks(s,typ,aid);
 SELECT * INTO rule FROM school_scholarship_activity_rules WHERE school_id=s AND activity_type=typ AND activity_id=aid ORDER BY revision DESC LIMIT 1;
 IF typ='activity' THEN
  SELECT * INTO a FROM school_activities WHERE school_id=s AND id=aid;
  IF NOT FOUND OR a.state='Draft' OR a.kind='timed' AND a.results_published_at IS NULL THEN RETURN; END IF;
  cutoff:=least(a.ends_at,a.forced_ended_at);
  -- A published timed result opens deferred first-AC and rank awards together.
  IF a.kind='timed' THEN
   FOR row_job IN SELECT j.* FROM school_judge_jobs j WHERE j.school_id=s AND j.activity_id=aid AND j.kind='submit' AND j.state='completed' AND j.created_at<=j.activity_deadline_at AND (cutoff IS NULL OR j.created_at<=cutoff) ORDER BY j.created_at,j.id LOOP
    PERFORM school_scholarship_settle_result(s,'problem',row_job.id,'problem:'||row_job.problem_id,COALESCE(row_job.result->>'status','System Error'));
   END LOOP;
  END IF;
  IF rule.amount IS NULL OR rule.amount=0 THEN RETURN; END IF;
  SELECT sum(points) INTO total FROM school_activity_problems WHERE school_id=s AND activity_id=aid;
  FOR participant IN SELECT identity_id FROM school_activity_participants WHERE school_id=s AND activity_id=aid ORDER BY identity_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||participant.identity_id,0));
   IF EXISTS(SELECT 1 FROM school_scholarship_activity_awards WHERE school_id=s AND activity_type=typ AND activity_id=aid AND identity_id=participant.identity_id) THEN CONTINUE; END IF;
   SELECT count(*) FILTER(WHERE accepted)::integer AS ac,coalesce(sum(score*points/100.0),0) AS score INTO stats FROM (
    SELECT p.problem_id,p.points,bool_or(r.status='AC') AS accepted,max(CASE WHEN r.status='AC' THEN 100 ELSE least(100,greatest(0,coalesce((j.result->>'score')::numeric,0))) END) AS score
    FROM school_activity_problems p JOIN school_judge_jobs j ON j.school_id=p.school_id AND j.activity_id=p.activity_id AND j.problem_id=p.problem_id AND j.version_id=p.version_id
    JOIN school_scholarship_receipts receipt ON receipt.school_id=j.school_id AND receipt.source_kind='problem' AND receipt.job_id=j.id
    JOIN school_scholarship_results r ON r.school_id=receipt.school_id AND r.source_kind=receipt.source_kind AND r.job_id=receipt.job_id AND r.subject_key=receipt.subject_key
    WHERE p.school_id=s AND p.activity_id=aid AND j.identity_id=participant.identity_id AND j.kind='submit' AND j.state='completed'
     AND (j.activity_deadline_at IS NULL OR j.created_at<=j.activity_deadline_at) AND (cutoff IS NULL OR j.created_at<=cutoff)
     AND (a.kind<>'timed' OR j.completed_at<=a.results_published_at) AND (rule.allow_solution_assisted OR NOT receipt.assisted)
    GROUP BY p.problem_id,p.points
   ) valid;
   IF stats.ac>=rule.minimum_ac AND total>0 AND stats.score*100/total>=rule.minimum_score THEN
    reward:=school_scholarship_entry(s,participant.identity_id,rule.amount,'activity','activity:'||typ||':'||aid||':'||participant.identity_id,NULL,'Activity achievement reward',jsonb_build_object('activityId',aid,'ruleVersion',rule.revision));
    INSERT INTO school_scholarship_activity_awards(school_id,activity_type,activity_id,identity_id,rule_revision,ledger_id) VALUES(s,typ,aid,participant.identity_id,rule.revision,reward.id);
   END IF;
  END LOOP;
 ELSIF typ='paper4_activity' THEN
  SELECT * INTO pa FROM school_paper4_activities WHERE school_id=s AND id=aid;
  IF NOT FOUND OR pa.kind='exam' AND pa.results_published_at IS NULL THEN RETURN; END IF;
  FOR row_job IN SELECT j.*,at.paper_id FROM school_paper4_jobs j JOIN school_paper4_attempts at ON at.school_id=j.school_id AND at.id=j.attempt_id WHERE j.school_id=s AND at.activity_id=aid AND j.kind='submit' AND j.state='completed' AND (pa.ends_at IS NULL OR j.created_at<=pa.ends_at) ORDER BY j.created_at,j.id LOOP
   FOR stats IN SELECT value q FROM jsonb_array_elements(COALESCE(row_job.result->'questions','[]')) LOOP PERFORM school_scholarship_settle_result(s,'paper4',row_job.id,'paper4:'||row_job.paper_id||':'||(stats.q->>'key'),COALESCE(stats.q->>'status','System Error')); END LOOP;
  END LOOP;
  IF rule.amount IS NULL OR rule.amount=0 THEN RETURN; END IF;
  SELECT sum((st->>'maxMarks')::numeric) INTO total FROM school_paper4_versions v CROSS JOIN LATERAL jsonb_array_elements(v.content->'definition'->'questions') q CROSS JOIN LATERAL jsonb_array_elements(q->'stages') st WHERE v.school_id=s AND v.id=pa.version_id;
  FOR participant IN SELECT identity_id FROM school_paper4_participants WHERE school_id=s AND activity_id=aid ORDER BY identity_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('school-scholarship:'||s||':'||participant.identity_id,0));
   IF EXISTS(SELECT 1 FROM school_scholarship_activity_awards WHERE school_id=s AND activity_type=typ AND activity_id=aid AND identity_id=participant.identity_id) THEN CONTINUE; END IF;
   SELECT count(DISTINCT receipt.subject_key) FILTER(WHERE r.status='AC')::integer AS ac,
    coalesce(sum(CASE WHEN stage->>'judgeMode'='auto' THEN least((stage->>'maxMarks')::numeric,greatest(0,coalesce((automatic->>'marks')::numeric,0)))
     WHEN pa.results_published_at IS NOT NULL THEN least((stage->>'maxMarks')::numeric,coalesce(review.marks,0)) ELSE 0 END),0) AS score INTO stats
   FROM school_scholarship_receipts receipt JOIN school_scholarship_results r USING(school_id,source_kind,job_id,subject_key)
   JOIN school_paper4_jobs j ON j.school_id=receipt.school_id AND j.id=receipt.job_id
   JOIN school_paper4_versions v ON v.school_id=j.school_id AND v.id=j.version_id
   CROSS JOIN LATERAL jsonb_array_elements(v.content->'definition'->'questions') question
   CROSS JOIN LATERAL jsonb_array_elements(question->'stages') stage
   LEFT JOIN LATERAL (SELECT st FROM jsonb_array_elements(j.result->'questions') qr CROSS JOIN LATERAL jsonb_array_elements(qr->'stages') st WHERE qr->>'key'=question->>'key' AND st->>'stageKey'=stage->>'id' LIMIT 1) auto_result ON true
   LEFT JOIN LATERAL (SELECT auto_result.st AS automatic) extracted ON true
   LEFT JOIN school_paper4_reviews review ON review.school_id=j.school_id AND review.attempt_id=j.attempt_id AND review.stage_key=stage->>'id'
   WHERE receipt.school_id=s AND receipt.source_kind='paper4' AND receipt.activity_id=aid AND receipt.identity_id=participant.identity_id
    AND receipt.subject_key='paper4:'||pa.paper_id||':'||(question->>'key')
    AND (receipt.deadline_at IS NULL OR receipt.received_at<=receipt.deadline_at) AND (rule.allow_solution_assisted OR NOT receipt.assisted)
    AND (pa.kind<>'exam' OR j.completed_at<=pa.results_published_at);
   IF stats.ac>=rule.minimum_ac AND total>0 AND stats.score*100.0/total>=rule.minimum_score THEN
    reward:=school_scholarship_entry(s,participant.identity_id,rule.amount,'activity','activity:'||typ||':'||aid||':'||participant.identity_id,NULL,'Activity achievement reward',jsonb_build_object('activityId',aid,'ruleVersion',rule.revision));
    INSERT INTO school_scholarship_activity_awards(school_id,activity_type,activity_id,identity_id,rule_revision,ledger_id) VALUES(s,typ,aid,participant.identity_id,rule.revision,reward.id);
   END IF;
  END LOOP;
 END IF;
END $$;
REVOKE ALL ON FUNCTION school_scholarship_settle_activity(uuid,text,uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION school_scholarship_problem_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; a school_activities;
BEGIN
 IF NEW.kind<>'submit' OR NEW.access_context<>'school' OR NEW.identity_id IS NULL THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true); PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 IF TG_OP='INSERT' THEN PERFORM school_scholarship_record_receipt(NEW.school_id,'problem',NEW.id,'problem:'||NEW.problem_id,NEW.identity_id,NEW.version_id,NEW.created_at,NEW.activity_id,NEW.activity_deadline_at);
 ELSIF NEW.state='completed' THEN
  SELECT * INTO a FROM school_activities WHERE school_id=NEW.school_id AND id=NEW.activity_id;
  IF a.id IS NULL OR a.kind<>'timed' OR a.results_published_at IS NOT NULL THEN
   IF a.id IS NOT NULL THEN PERFORM school_scholarship_activity_wallet_locks(NEW.school_id,'activity',a.id); END IF;
   PERFORM school_scholarship_settle_result(NEW.school_id,'problem',NEW.id,'problem:'||NEW.problem_id,COALESCE(NEW.result->>'status','System Error'));
   IF a.id IS NOT NULL THEN PERFORM school_scholarship_settle_activity(NEW.school_id,'activity',a.id); END IF;
  END IF;
 END IF;
 PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION school_scholarship_paper4_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text; a school_paper4_attempts; pa school_paper4_activities; q jsonb;
BEGIN
 IF NEW.kind<>'submit' OR NEW.identity_id IS NULL THEN RETURN NEW; END IF;
 previous_scope:=current_setting('campus.school_id',true); PERFORM set_config('campus.school_id',NEW.school_id::text,true);
 SELECT * INTO a FROM school_paper4_attempts WHERE school_id=NEW.school_id AND id=NEW.attempt_id;
 SELECT * INTO pa FROM school_paper4_activities WHERE school_id=NEW.school_id AND id=a.activity_id;
 IF TG_OP='INSERT' THEN
  FOR q IN SELECT value FROM jsonb_array_elements(NEW.payload->'questions') LOOP PERFORM school_scholarship_record_receipt(NEW.school_id,'paper4',NEW.id,'paper4:'||a.paper_id||':'||(q->>'key'),NEW.identity_id,NEW.version_id,NEW.created_at,a.activity_id,pa.ends_at); END LOOP;
 ELSIF NEW.state='completed' AND (pa.id IS NULL OR pa.kind<>'exam' OR pa.results_published_at IS NOT NULL) THEN
  IF pa.id IS NOT NULL THEN PERFORM school_scholarship_activity_wallet_locks(NEW.school_id,'paper4_activity',pa.id); END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.result->'questions','[]')) LOOP PERFORM school_scholarship_settle_result(NEW.school_id,'paper4',NEW.id,'paper4:'||a.paper_id||':'||(q->>'key'),COALESCE(q->>'status','System Error')); END LOOP;
  IF pa.id IS NOT NULL THEN PERFORM school_scholarship_settle_activity(NEW.school_id,'paper4_activity',pa.id); END IF;
 END IF;
 PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true); RETURN NEW;
END $$;
CREATE FUNCTION school_scholarship_publish_results() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous_scope text;
BEGIN
 IF OLD.results_published_at IS NULL AND NEW.results_published_at IS NOT NULL THEN
  previous_scope:=current_setting('campus.school_id',true);PERFORM set_config('campus.school_id',NEW.school_id::text,true);
  PERFORM school_scholarship_settle_activity(NEW.school_id,CASE WHEN TG_TABLE_NAME='school_activities' THEN 'activity' ELSE 'paper4_activity' END,NEW.id);
  PERFORM set_config('campus.school_id',COALESCE(previous_scope,''),true);
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER school_scholarship_activity_publish AFTER UPDATE OF results_published_at ON school_activities FOR EACH ROW EXECUTE FUNCTION school_scholarship_publish_results();
CREATE TRIGGER school_scholarship_paper4_publish AFTER UPDATE OF results_published_at ON school_paper4_activities FOR EACH ROW EXECUTE FUNCTION school_scholarship_publish_results();
REVOKE ALL ON FUNCTION school_scholarship_publish_results() FROM PUBLIC;
