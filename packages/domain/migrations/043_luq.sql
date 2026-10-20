-- Luq is an independent consumable learning balance. No old points are converted.
CREATE TABLE luq_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 first_ac_reward integer NOT NULL DEFAULT 4 CHECK(first_ac_reward BETWEEN 0 AND 100),
 translation_price integer NOT NULL DEFAULT 3 CHECK(translation_price BETWEEN 0 AND 1000),
 solution_price integer NOT NULL DEFAULT 8 CHECK(solution_price BETWEEN 0 AND 1000),
 activity_reward_cap integer NOT NULL DEFAULT 40 CHECK(activity_reward_cap BETWEEN 0 AND 1000),
 enabled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 rule_version integer NOT NULL DEFAULT 1 CHECK(rule_version>0), updated_by uuid REFERENCES accounts(id), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO luq_settings(singleton) VALUES(true);
CREATE TABLE luq_accounts (
 identity_id uuid PRIMARY KEY REFERENCES identities(id), balance integer NOT NULL DEFAULT 0 CHECK(balance>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE luq_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, identity_id uuid NOT NULL REFERENCES identities(id),
 delta integer NOT NULL CHECK(delta<>0), balance_after integer NOT NULL CHECK(balance_after>=0),
 kind text NOT NULL CHECK(kind IN ('admin_grant','admin_adjustment','purchase','refund','first_ac','activity')),
 source_key text NOT NULL UNIQUE, request_hash text, request_key text UNIQUE,
 actor_account_id uuid REFERENCES accounts(id), reason text NOT NULL CHECK(length(btrim(reason))>0),
 metadata jsonb NOT NULL DEFAULT '{}', refund_of bigint UNIQUE REFERENCES luq_ledger(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='refund')=(refund_of IS NOT NULL)),
 CHECK(kind NOT IN ('first_ac','activity','admin_grant','refund') OR delta>0), CHECK(kind<>'purchase' OR delta<0)
);
CREATE INDEX luq_ledger_identity_idx ON luq_ledger(identity_id,id DESC);
CREATE TABLE luq_admin_batches (
 request_id uuid PRIMARY KEY, request_hash text NOT NULL, actor_account_id uuid NOT NULL REFERENCES accounts(id),
 identity_ids uuid[] NOT NULL, amount integer NOT NULL, kind text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE luq_activity_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_type text NOT NULL CHECK(activity_type IN ('assignment','timed','paper4_activity')),
 activity_id uuid NOT NULL, rule_version integer NOT NULL CHECK(rule_version>0),
 amount integer NOT NULL DEFAULT 0 CHECK(amount BETWEEN 0 AND 1000),
 minimum_ac integer NOT NULL DEFAULT 1 CHECK(minimum_ac BETWEEN 0 AND 100),
 minimum_score numeric NOT NULL DEFAULT 0 CHECK(minimum_score BETWEEN 0 AND 100),
 task_kind text NOT NULL DEFAULT 'challenge' CHECK(task_kind IN ('challenge','learning','correction')),
 allow_solution_assisted boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(activity_type,activity_id,rule_version),
 CHECK(task_kind<>'challenge' OR NOT allow_solution_assisted)
);
CREATE TABLE luq_assistance_contents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_key text NOT NULL, version_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')), language text NOT NULL DEFAULT '',
 body text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')),
 author_account_id uuid NOT NULL REFERENCES accounts(id), reviewer_account_id uuid REFERENCES accounts(id),
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(subject_key,version_id,kind,language)
);
CREATE TABLE luq_assistance_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identity_id uuid NOT NULL REFERENCES identities(id),subject_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')),language text NOT NULL DEFAULT '',
 ledger_id bigint REFERENCES luq_ledger(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(identity_id,subject_key,kind,language)
);
CREATE TABLE luq_assistance_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identity_id uuid NOT NULL REFERENCES identities(id),subject_key text NOT NULL,
 version_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')),language text NOT NULL DEFAULT '',
 content_id uuid NOT NULL REFERENCES luq_assistance_contents(id),entitlement_id uuid REFERENCES luq_assistance_entitlements(id),
 context_type text NOT NULL,context_id uuid,provided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX luq_deliveries_snapshot_idx ON luq_assistance_deliveries(identity_id,subject_key,kind,provided_at);
CREATE TABLE luq_assistance_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),target_type text NOT NULL,target_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('FULL_TRANSLATION','FULL_SOLUTION')),mode text NOT NULL CHECK(mode IN ('disabled','paid','free')),
 opens_at timestamptz,rule_version integer NOT NULL CHECK(rule_version>0),created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(target_type,target_id,kind,rule_version)
);
CREATE TABLE luq_first_ac_claims (
 identity_id uuid NOT NULL REFERENCES identities(id),subject_key text NOT NULL,source_key text NOT NULL,
 eligible boolean NOT NULL,reason text NOT NULL,ledger_id bigint REFERENCES luq_ledger(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(identity_id,subject_key)
);
CREATE TABLE luq_activity_awards (
 identity_id uuid NOT NULL REFERENCES identities(id),activity_type text NOT NULL,activity_id uuid NOT NULL,
 rule_id uuid NOT NULL REFERENCES luq_activity_rules(id),ledger_id bigint NOT NULL REFERENCES luq_ledger(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(identity_id,activity_type,activity_id)
);
CREATE TABLE luq_submission_results (
 submission_id bigint PRIMARY KEY REFERENCES submissions(id),status text NOT NULL,score numeric,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE luq_paper4_results (
 snapshot_id uuid PRIMARY KEY REFERENCES paper4_snapshots(id),run_id uuid NOT NULL UNIQUE REFERENCES paper4_runs(id),
 status text NOT NULL,rank_ac_valid boolean NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE luq_review_cases (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,source_key text NOT NULL UNIQUE,identity_id uuid NOT NULL REFERENCES identities(id),
 subject_key text NOT NULL,reason text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- All money writes pass through one atomic, idempotent routine. Runtime app
-- roles cannot write balances/ledgers directly; worker needs no Luq grants.
CREATE FUNCTION luq_post_entry(p_identity uuid,p_delta integer,p_kind text,p_source text,p_actor uuid,p_reason text,
 p_metadata jsonb DEFAULT '{}',p_refund bigint DEFAULT NULL,p_hash text DEFAULT NULL,p_request text DEFAULT NULL) RETURNS luq_ledger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing luq_ledger; original luq_ledger; current_balance integer; result luq_ledger;
BEGIN
 IF p_request IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('luq-request:'||p_request,0)); END IF;
 IF p_delta=0 OR p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'LUQ_INVALID_ENTRY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM identities WHERE id=p_identity AND kind='student') THEN RAISE EXCEPTION 'LUQ_STUDENT_REQUIRED'; END IF;
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
CREATE FUNCTION protect_luq_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Luq records are append-only'; END $$;
CREATE TRIGGER luq_ledger_immutable BEFORE UPDATE OR DELETE ON luq_ledger FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_batches_immutable BEFORE UPDATE OR DELETE ON luq_admin_batches FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_claims_immutable BEFORE UPDATE OR DELETE ON luq_first_ac_claims FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_awards_immutable BEFORE UPDATE OR DELETE ON luq_activity_awards FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_results_immutable BEFORE UPDATE OR DELETE ON luq_submission_results FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_rules_immutable BEFORE UPDATE OR DELETE ON luq_activity_rules FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_policies_immutable BEFORE UPDATE OR DELETE ON luq_assistance_policies FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_entitlements_immutable BEFORE UPDATE OR DELETE ON luq_assistance_entitlements FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_deliveries_immutable BEFORE UPDATE OR DELETE ON luq_assistance_deliveries FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_paper4_results_immutable BEFORE UPDATE OR DELETE ON luq_paper4_results FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE TRIGGER luq_review_immutable BEFORE UPDATE OR DELETE ON luq_review_cases FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();

-- A consumed first AC is remembered without minting money. This also includes
-- old results subsequently rejudged and the old independent points events.
INSERT INTO luq_first_ac_claims(identity_id,subject_key,source_key,eligible,reason)
 SELECT DISTINCT identity_id,'problem:'||problem_id,'historical',false,'historical_ac'
 FROM (SELECT identity_id,problem_id FROM submissions WHERE kind IN ('submit','correction') AND status='AC'
  UNION SELECT identity_id,problem_id FROM point_ledger WHERE reason='first_ac'
  UNION SELECT s.identity_id,s.problem_id FROM judge_runs r JOIN submissions s ON s.id=r.submission_id
   WHERE r.status='AC' AND s.kind IN ('submit','correction')) history ON CONFLICT DO NOTHING;
INSERT INTO luq_first_ac_claims(identity_id,subject_key,source_key,eligible,reason)
 SELECT l.identity_id,'paper4:'||COALESCE(p.source_paper_id,p.id)||':'||l.question_key,'historical',false,'historical_ac'
 FROM paper4_rank_ledger l JOIN paper4_papers p ON p.id=l.paper_id ON CONFLICT DO NOTHING;
INSERT INTO luq_first_ac_claims(identity_id,subject_key,source_key,eligible,reason)
 SELECT DISTINCT a.identity_id,'paper4:'||COALESCE(p.source_paper_id,p.id)||':'||snap.question_key,'historical',false,'historical_ac'
 FROM paper4_runs r JOIN paper4_snapshots snap ON snap.id=r.snapshot_id JOIN paper4_attempts a ON a.id=snap.attempt_id
 JOIN paper4_papers p ON p.id=a.paper_id WHERE r.rank_ac_valid AND snap.origin='formal' ON CONFLICT DO NOTHING;
INSERT INTO luq_paper4_results(snapshot_id,run_id,status,rank_ac_valid)
 SELECT DISTINCT ON(r.snapshot_id) r.snapshot_id,r.id,r.status,r.rank_ac_valid FROM paper4_runs r JOIN paper4_snapshots snap ON snap.id=r.snapshot_id
 WHERE snap.origin='formal' AND r.status<>'System Error' ORDER BY r.snapshot_id,r.created_at,r.id;
INSERT INTO luq_submission_results(submission_id,status,score)
 SELECT id,status,score FROM submissions WHERE status NOT IN ('Waiting','Judging','System Error');

ALTER TABLE submissions ADD COLUMN luq_solution_assisted boolean NOT NULL DEFAULT false,
 ADD COLUMN luq_first_ac_eligible boolean NOT NULL DEFAULT false,ADD COLUMN luq_first_ac_amount integer NOT NULL DEFAULT 0,
 ADD COLUMN luq_activity_deadline timestamptz, ADD COLUMN luq_reward_rule_version integer NOT NULL DEFAULT 0;
ALTER TABLE paper4_snapshots ADD COLUMN luq_solution_assisted boolean NOT NULL DEFAULT false,
 ADD COLUMN luq_first_ac_amount integer NOT NULL DEFAULT 0, ADD COLUMN luq_reward_rule_version integer NOT NULL DEFAULT 0;
CREATE FUNCTION luq_snapshot_submission() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.luq_solution_assisted,NEW.luq_first_ac_eligible,NEW.luq_first_ac_amount,NEW.luq_activity_deadline,NEW.luq_reward_rule_version)
   IS DISTINCT FROM ROW(OLD.luq_solution_assisted,OLD.luq_first_ac_eligible,OLD.luq_first_ac_amount,OLD.luq_activity_deadline,OLD.luq_reward_rule_version)
   THEN RAISE EXCEPTION 'Luq submission snapshots are immutable'; END IF;
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-assistance:'||NEW.identity_id::text,0));
 NEW.luq_solution_assisted := EXISTS(SELECT 1 FROM luq_assistance_deliveries
  WHERE identity_id=NEW.identity_id AND subject_key='problem:'||NEW.problem_id AND kind='FULL_SOLUTION' AND provided_at<=NEW.created_at);
 NEW.luq_first_ac_eligible := EXISTS(SELECT 1 FROM problem_versions v WHERE v.id=NEW.version_id
  AND v.published_at IS NOT NULL AND v.rank_review_status='approved' AND v.rank_approved_at IS NOT NULL AND v.school_visible_at IS NOT NULL);
 SELECT first_ac_reward,rule_version INTO NEW.luq_first_ac_amount,NEW.luq_reward_rule_version FROM luq_settings WHERE singleton;
 IF NEW.assignment_id IS NOT NULL THEN SELECT due_at INTO NEW.luq_activity_deadline FROM assignments WHERE id=NEW.assignment_id; END IF;
 IF NEW.timed_attempt_id IS NOT NULL THEN SELECT LEAST(a.deadline_at,p.ends_at,p.forced_ended_at)
  INTO NEW.luq_activity_deadline FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id WHERE a.id=NEW.timed_attempt_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER luq_snapshot_submission BEFORE INSERT OR UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION luq_snapshot_submission();
CREATE FUNCTION luq_snapshot_paper4() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE student uuid; subject text; accepted_at timestamptz;
BEGIN
 SELECT a.identity_id,'paper4:'||COALESCE(p.source_paper_id,p.id)||':'||NEW.question_key,COALESCE(a.submitted_at,NEW.created_at) INTO student,subject,accepted_at
  FROM paper4_attempts a JOIN paper4_papers p ON p.id=a.paper_id WHERE a.id=NEW.attempt_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-assistance:'||student::text,0));
 NEW.luq_solution_assisted := EXISTS(SELECT 1 FROM luq_assistance_deliveries WHERE identity_id=student AND subject_key=subject AND kind='FULL_SOLUTION' AND provided_at<=accepted_at);
 SELECT first_ac_reward,rule_version INTO NEW.luq_first_ac_amount,NEW.luq_reward_rule_version FROM luq_settings WHERE singleton;
 RETURN NEW;
END $$;
CREATE TRIGGER luq_snapshot_paper4 BEFORE INSERT ON paper4_snapshots FOR EACH ROW EXECUTE FUNCTION luq_snapshot_paper4();

CREATE FUNCTION luq_claim_first_ac(student uuid,subject text,source text,eligible boolean,amount integer,why text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE entry luq_ledger;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 IF EXISTS(SELECT 1 FROM luq_first_ac_claims WHERE identity_id=student AND subject_key=subject) THEN RETURN; END IF;
 IF eligible AND amount>0 THEN entry:=luq_post_entry(student,amount,'first_ac','first-ac:'||student||':'||subject,NULL,
  'First formal AC',jsonb_build_object('subjectKey',subject,'sourceKey',source)); END IF;
 INSERT INTO luq_first_ac_claims(identity_id,subject_key,source_key,eligible,reason,ledger_id)
 VALUES(student,subject,source,eligible,why,entry.id);
END $$;
REVOKE ALL ON FUNCTION luq_claim_first_ac(uuid,text,text,boolean,integer,text) FROM PUBLIC;

CREATE FUNCTION luq_settle_activity(student uuid,activity_type_value text,activity uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rule luq_activity_rules; ac_count integer; achieved numeric; possible numeric; entry luq_ledger;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 IF EXISTS(SELECT 1 FROM luq_activity_awards WHERE identity_id=student AND activity_type=activity_type_value AND activity_id=activity) THEN RETURN; END IF;
 SELECT * INTO rule FROM luq_activity_rules WHERE activity_type=activity_type_value AND activity_id=activity ORDER BY rule_version DESC LIMIT 1;
 IF NOT FOUND OR rule.amount=0 THEN RETURN; END IF;
 IF activity_type_value='assignment' THEN
  IF NOT EXISTS(SELECT 1 FROM assignment_participants WHERE assignment_id=activity AND identity_id=student AND NOT exempt) THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE best.accepted),COALESCE(sum(COALESCE(best.score,0)*ap.points/100),0),sum(ap.points)
  INTO ac_count,achieved,possible FROM assignment_problems ap LEFT JOIN LATERAL (
   SELECT max(r.score) score,bool_or(r.status='AC') accepted FROM submissions s JOIN luq_submission_results r ON r.submission_id=s.id
   WHERE s.assignment_id=activity AND s.identity_id=student AND s.problem_id=ap.problem_id AND s.kind='submit'
    AND s.created_at<=s.luq_activity_deadline AND s.created_at>=rule.created_at AND (rule.allow_solution_assisted OR NOT s.luq_solution_assisted)
  ) best ON true WHERE ap.assignment_id=activity;
 ELSIF activity_type_value='timed' THEN
  IF NOT EXISTS(SELECT 1 FROM timed_practices WHERE id=activity AND results_published_at IS NOT NULL) THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE r.status='AC' AND (rule.allow_solution_assisted OR NOT r.assisted)),COALESCE(sum(CASE WHEN rule.allow_solution_assisted OR NOT r.assisted THEN COALESCE(r.score,0)*tp.points/100 ELSE 0 END),0),sum(tp.points)
  INTO ac_count,achieved,possible FROM timed_practice_problems tp LEFT JOIN LATERAL (
   SELECT observed.status,observed.score,s.luq_solution_assisted assisted FROM submissions s JOIN timed_attempts a ON a.id=s.timed_attempt_id
   JOIN luq_submission_results observed ON observed.submission_id=s.id
   WHERE a.practice_id=activity AND s.identity_id=student AND s.problem_id=tp.problem_id AND s.kind='submit'
    AND s.created_at<=LEAST(s.luq_activity_deadline,a.deadline_at,(SELECT forced_ended_at FROM timed_practices WHERE id=activity))
    AND s.created_at>=rule.created_at
   ORDER BY s.created_at DESC,s.id DESC LIMIT 1
  ) r ON true WHERE tp.practice_id=activity;
 ELSIF activity_type_value='paper4_activity' THEN
  IF NOT EXISTS(SELECT 1 FROM paper4_activity_participants WHERE paper_id=activity AND identity_id=student) THEN RETURN; END IF;
  SELECT count(*) FILTER(WHERE accepted),count(*) FILTER(WHERE accepted),count(*) INTO ac_count,achieved,possible FROM (
   SELECT q.value->>'key' question_key,EXISTS(SELECT 1 FROM paper4_attempts a JOIN paper4_snapshots snap ON snap.attempt_id=a.id
    JOIN paper4_runs r ON r.snapshot_id=snap.id JOIN luq_paper4_results observed ON observed.run_id=r.id WHERE a.paper_id=activity AND a.identity_id=student AND snap.question_key=q.value->>'key'
     AND snap.origin='formal' AND r.rank_ac_valid AND a.submitted_at>=rule.created_at
     AND (p.ends_at IS NULL OR a.submitted_at<=p.ends_at) AND (p.starts_at IS NULL OR a.submitted_at>=p.starts_at) AND (p.activity_kind<>'exam' OR a.released_at IS NOT NULL)
     AND (rule.allow_solution_assisted OR NOT snap.luq_solution_assisted)) accepted
   FROM paper4_papers p JOIN paper4_versions v ON v.id=p.current_version_id CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE p.id=activity
  ) questions;
 ELSE RETURN;
 END IF;
 IF ac_count<rule.minimum_ac OR possible IS NULL OR possible<=0 OR achieved*100/possible<rule.minimum_score THEN RETURN; END IF;
 entry:=luq_post_entry(student,rule.amount,'activity','activity:'||student||':'||activity_type_value||':'||activity,NULL,
  'Activity target achieved',jsonb_build_object('ruleId',rule.id,'activityType',activity_type_value,'activityId',activity));
 INSERT INTO luq_activity_awards(identity_id,activity_type,activity_id,rule_id,ledger_id) VALUES(student,activity_type_value,activity,rule.id,entry.id);
END $$;
REVOKE ALL ON FUNCTION luq_settle_activity(uuid,text,uuid) FROM PUBLIC;

CREATE FUNCTION luq_award_submission(s submissions) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF s.kind NOT IN ('submit','correction') OR s.status<>'AC' OR NOT EXISTS(SELECT 1 FROM identities WHERE id=s.identity_id AND kind='student') THEN RETURN; END IF;
 IF s.created_at<(SELECT enabled_at FROM luq_settings WHERE singleton) THEN
  PERFORM luq_claim_first_ac(s.identity_id,'problem:'||s.problem_id,'submission:'||s.id,false,0,'historical_submission'); RETURN;
 END IF;
 -- Assisted submissions never consume the reward slot: an earlier clean
 -- submission can still be awaiting its judge result. Later submissions keep
 -- their immutable assisted flag, so viewing an answer cannot regain eligibility.
 IF s.luq_solution_assisted THEN RETURN; END IF;
 IF s.timed_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM timed_attempts a JOIN timed_practices p ON p.id=a.practice_id
  JOIN timed_first_ac_candidates c ON c.practice_id=p.id AND c.submission_id=s.id
  WHERE a.id=s.timed_attempt_id AND p.results_published_at IS NOT NULL AND s.created_at<=LEAST(s.luq_activity_deadline,a.deadline_at,p.ends_at,p.forced_ended_at)) THEN RETURN; END IF;
 PERFORM luq_claim_first_ac(s.identity_id,'problem:'||s.problem_id,'submission:'||s.id,s.luq_first_ac_eligible AND NOT s.luq_solution_assisted,s.luq_first_ac_amount,
  CASE WHEN s.luq_solution_assisted THEN 'solution_provided' WHEN NOT s.luq_first_ac_eligible THEN 'problem_ineligible' ELSE 'eligible' END);
END $$;
REVOKE ALL ON FUNCTION luq_award_submission(submissions) FROM PUBLIC;
CREATE FUNCTION luq_on_submission_result() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior luq_submission_results; inserted integer;
BEGIN
 IF NEW.kind NOT IN ('submit','correction') OR NEW.status IN ('Waiting','Judging','System Error') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||NEW.identity_id::text,0));
 SELECT * INTO prior FROM luq_submission_results WHERE submission_id=NEW.id;
 IF FOUND THEN
  IF prior.status<>NEW.status OR prior.score IS DISTINCT FROM NEW.score THEN INSERT INTO luq_review_cases(source_key,identity_id,subject_key,reason,metadata)
   VALUES('rejudge:'||NEW.id||':'||NEW.status,NEW.identity_id,'problem:'||NEW.problem_id,'Rejudge changed the frozen reward verdict',
    jsonb_build_object('originalStatus',prior.status,'newStatus',NEW.status)) ON CONFLICT DO NOTHING; END IF;
  RETURN NEW;
 END IF;
 INSERT INTO luq_submission_results(submission_id,status,score) VALUES(NEW.id,NEW.status,NEW.score) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=0 THEN RETURN NEW; END IF;
 PERFORM luq_award_submission(NEW);
 IF NEW.assignment_id IS NOT NULL THEN PERFORM luq_settle_activity(NEW.identity_id,'assignment',NEW.assignment_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER luq_submission_result AFTER INSERT OR UPDATE OF status ON submissions FOR EACH ROW EXECUTE FUNCTION luq_on_submission_result();
CREATE FUNCTION luq_on_timed_publish() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s submissions; participant uuid;
BEGIN
 IF OLD.results_published_at IS NULL AND NEW.results_published_at IS NOT NULL THEN
  FOR s IN SELECT sub.* FROM timed_first_ac_candidates c JOIN submissions sub ON sub.id=c.submission_id
   JOIN luq_submission_results r ON r.submission_id=sub.id AND r.status='AC' WHERE c.practice_id=NEW.id ORDER BY sub.created_at,sub.id
  LOOP PERFORM luq_award_submission(s); END LOOP;
  FOR participant IN SELECT identity_id FROM timed_practice_participants WHERE practice_id=NEW.id AND NOT exempt ORDER BY identity_id
  LOOP PERFORM luq_settle_activity(participant,'timed',NEW.id); END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER luq_timed_publish AFTER UPDATE OF results_published_at ON timed_practices FOR EACH ROW EXECUTE FUNCTION luq_on_timed_publish();

CREATE FUNCTION luq_award_paper4(r paper4_runs) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE snap paper4_snapshots; attempt paper4_attempts; paper paper4_papers;
BEGIN
 IF NOT r.rank_ac_valid OR NOT EXISTS(SELECT 1 FROM luq_paper4_results WHERE run_id=r.id AND rank_ac_valid) THEN RETURN; END IF;
 SELECT * INTO snap FROM paper4_snapshots WHERE id=r.snapshot_id;
 SELECT * INTO attempt FROM paper4_attempts WHERE id=snap.attempt_id;
 SELECT * INTO paper FROM paper4_papers WHERE id=attempt.paper_id;
 IF paper.activity_kind='exam' AND attempt.released_at IS NULL THEN RETURN; END IF;
 IF paper.ends_at IS NOT NULL AND attempt.submitted_at>paper.ends_at THEN RETURN; END IF;
 IF paper.starts_at IS NOT NULL AND attempt.submitted_at<paper.starts_at THEN RETURN; END IF;
 IF snap.luq_solution_assisted AND snap.created_at>=(SELECT enabled_at FROM luq_settings WHERE singleton) THEN RETURN; END IF;
 PERFORM luq_claim_first_ac(attempt.identity_id,'paper4:'||COALESCE(paper.source_paper_id,paper.id)||':'||snap.question_key,'paper4-run:'||r.id,
  NOT snap.luq_solution_assisted AND snap.created_at>=(SELECT enabled_at FROM luq_settings WHERE singleton),snap.luq_first_ac_amount,
  CASE WHEN snap.luq_solution_assisted THEN 'solution_provided' ELSE 'eligible' END);
END $$;
REVOKE ALL ON FUNCTION luq_award_paper4(paper4_runs) FROM PUBLIC;
CREATE FUNCTION luq_on_paper4_run() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE student uuid; activity uuid; subject text; origin_value text; previous luq_paper4_results;
BEGIN
 SELECT a.identity_id,a.paper_id,'paper4:'||COALESCE(p.source_paper_id,p.id)||':'||s.question_key,s.origin INTO student,activity,subject,origin_value
 FROM paper4_snapshots s JOIN paper4_attempts a ON a.id=s.attempt_id JOIN paper4_papers p ON p.id=a.paper_id WHERE s.id=NEW.snapshot_id;
 IF student IS NULL OR origin_value<>'formal' OR NEW.status='System Error' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 SELECT * INTO previous FROM luq_paper4_results WHERE snapshot_id=NEW.snapshot_id;
 IF FOUND THEN
  IF previous.status<>NEW.status OR previous.rank_ac_valid<>NEW.rank_ac_valid THEN
   INSERT INTO luq_review_cases(source_key,identity_id,subject_key,reason,metadata)
   VALUES('paper4-rejudge:'||NEW.id,student,subject,'Paper 4 rejudge changed the frozen reward verdict',
    jsonb_build_object('originalRunId',previous.run_id,'newRunId',NEW.id,'originalStatus',previous.status,'newStatus',NEW.status)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
 END IF;
 INSERT INTO luq_paper4_results(snapshot_id,run_id,status,rank_ac_valid) VALUES(NEW.snapshot_id,NEW.id,NEW.status,NEW.rank_ac_valid);
 PERFORM luq_award_paper4(NEW);
 PERFORM luq_settle_activity(student,'paper4_activity',activity);
 RETURN NEW;
END $$;
CREATE TRIGGER luq_paper4_run AFTER INSERT ON paper4_runs FOR EACH ROW EXECUTE FUNCTION luq_on_paper4_run();
CREATE FUNCTION luq_on_paper4_release() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r paper4_runs;
BEGIN
 IF OLD.released_at IS NULL AND NEW.released_at IS NOT NULL THEN
  FOR r IN SELECT run.* FROM paper4_runs run JOIN paper4_snapshots snap ON snap.id=run.snapshot_id
   WHERE snap.attempt_id=NEW.id AND snap.origin='formal' ORDER BY run.created_at,run.id
  LOOP PERFORM luq_award_paper4(r); END LOOP;
  PERFORM luq_settle_activity(NEW.identity_id,'paper4_activity',NEW.paper_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER luq_paper4_release AFTER UPDATE OF released_at ON paper4_attempts FOR EACH ROW EXECUTE FUNCTION luq_on_paper4_release();

-- Enforce publication freeze/caps in the database as well as the transport.
CREATE FUNCTION luq_validate_rule() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE state_value text; starts timestamptz; current_version integer; amount_cap integer;
BEGIN
 IF NEW.activity_type='assignment' THEN
  SELECT state INTO state_value FROM assignments WHERE id=NEW.activity_id FOR UPDATE;
  IF state_value IS NULL OR state_value<>'Draft' THEN RAISE EXCEPTION 'LUQ_RULE_FROZEN'; END IF;
 ELSIF NEW.activity_type='timed' THEN
  SELECT state INTO state_value FROM timed_practices WHERE id=NEW.activity_id FOR UPDATE;
  IF state_value IS NULL OR state_value<>'Draft' THEN RAISE EXCEPTION 'LUQ_RULE_FROZEN'; END IF;
 ELSE
  SELECT status,starts_at INTO state_value,starts FROM paper4_papers WHERE id=NEW.activity_id AND delivery_kind='activity' FOR UPDATE;
  IF state_value IS NULL OR starts IS NULL OR starts<=clock_timestamp() OR EXISTS(SELECT 1 FROM paper4_attempts WHERE paper_id=NEW.activity_id)
   THEN RAISE EXCEPTION 'LUQ_RULE_FROZEN'; END IF;
 END IF;
 SELECT activity_reward_cap INTO amount_cap FROM luq_settings WHERE singleton FOR SHARE;
 IF NEW.amount>amount_cap THEN RAISE EXCEPTION 'LUQ_REWARD_CAP'; END IF;
 SELECT COALESCE(max(rule_version),0) INTO current_version FROM luq_activity_rules WHERE activity_type=NEW.activity_type AND activity_id=NEW.activity_id;
 IF NEW.rule_version<>current_version+1 THEN RAISE EXCEPTION 'LUQ_RULE_VERSION'; END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER luq_rule_validate BEFORE INSERT ON luq_activity_rules FOR EACH ROW EXECUTE FUNCTION luq_validate_rule();
CREATE FUNCTION luq_protect_enabled_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.enabled_at IS DISTINCT FROM OLD.enabled_at THEN RAISE EXCEPTION 'Luq activation date is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER luq_settings_enabled BEFORE UPDATE ON luq_settings FOR EACH ROW EXECUTE FUNCTION luq_protect_enabled_at();

CREATE FUNCTION luq_validate_policy() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE state_value text; starts timestamptz; current_version integer;
BEGIN
 IF NEW.target_type='assignment' THEN
  SELECT state INTO state_value FROM assignments WHERE id=NEW.target_id FOR UPDATE;
  IF state_value IS NULL OR state_value<>'Draft' THEN RAISE EXCEPTION 'LUQ_POLICY_FROZEN'; END IF;
 ELSIF NEW.target_type='timed' THEN
  SELECT state INTO state_value FROM timed_practices WHERE id=NEW.target_id FOR UPDATE;
  IF state_value IS NULL OR state_value<>'Draft' THEN RAISE EXCEPTION 'LUQ_POLICY_FROZEN'; END IF;
 ELSIF NEW.target_type='paper4_activity' THEN
  SELECT status,starts_at INTO state_value,starts FROM paper4_papers WHERE id=NEW.target_id AND delivery_kind='activity' FOR UPDATE;
  IF state_value IS NULL OR starts IS NULL OR starts<=clock_timestamp() OR EXISTS(SELECT 1 FROM paper4_attempts WHERE paper_id=NEW.target_id)
   THEN RAISE EXCEPTION 'LUQ_POLICY_FROZEN'; END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('luq-policy:'||NEW.target_type||':'||NEW.target_id,0));
 END IF;
 SELECT COALESCE(max(rule_version),0) INTO current_version FROM luq_assistance_policies
  WHERE target_type=NEW.target_type AND target_id=NEW.target_id AND kind=NEW.kind;
 IF NEW.rule_version<>current_version+1 THEN RAISE EXCEPTION 'LUQ_POLICY_VERSION'; END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER luq_policy_validate BEFORE INSERT ON luq_assistance_policies FOR EACH ROW EXECUTE FUNCTION luq_validate_policy();
CREATE TABLE luq_setting_versions (
 rule_version integer PRIMARY KEY,settings jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO luq_setting_versions(rule_version,settings) SELECT rule_version,to_jsonb(s) FROM luq_settings s;
CREATE TRIGGER luq_setting_versions_immutable BEFORE UPDATE OR DELETE ON luq_setting_versions FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
CREATE FUNCTION luq_record_settings() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.rule_version<>OLD.rule_version+1 THEN RAISE EXCEPTION 'LUQ_SETTINGS_VERSION'; END IF;
 INSERT INTO luq_setting_versions(rule_version,settings) VALUES(NEW.rule_version,to_jsonb(NEW)); RETURN NEW;
END $$;
CREATE TRIGGER luq_settings_version AFTER UPDATE ON luq_settings FOR EACH ROW EXECUTE FUNCTION luq_record_settings();
