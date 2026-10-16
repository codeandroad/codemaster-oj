-- A final, formally submitted Paper 4 program is judged separately from
-- practice runs. Existing snapshots predate this distinction and stay practice.
ALTER TABLE paper4_snapshots ADD COLUMN origin text NOT NULL DEFAULT 'practice'
 CHECK(origin IN ('practice','formal'));
CREATE UNIQUE INDEX paper4_one_formal_snapshot_per_question
 ON paper4_snapshots(attempt_id,question_key) WHERE origin='formal';
CREATE INDEX paper4_run_tasks_snapshot_idx ON paper4_run_tasks(snapshot_id)
 WHERE snapshot_id IS NOT NULL;

-- Paper 4 questions do not have ordinary OJ problem/submission IDs. Keep
-- their fixed school-rank awards in an independent, immutable ledger.
CREATE TABLE paper4_rank_ledger (
 identity_id uuid NOT NULL REFERENCES identities(id),
 paper_id uuid NOT NULL REFERENCES paper4_papers(id),
 version_id uuid NOT NULL REFERENCES paper4_versions(id),
 attempt_id uuid NOT NULL REFERENCES paper4_attempts(id),
 question_key text NOT NULL,
 run_id uuid NOT NULL UNIQUE REFERENCES paper4_runs(id),
 points integer NOT NULL DEFAULT 10 CHECK(points=10),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(identity_id,paper_id,question_key)
);
CREATE INDEX paper4_rank_ledger_period_idx ON paper4_rank_ledger(created_at,identity_id);

-- Freeze whether a result is a complete, eligible AC at insertion time.
-- Existing runs predate formal snapshots and intentionally remain false.
-- The worker cannot set this flag by supplying a value: the BEFORE trigger
-- always overwrites it using the leased task and frozen version/cases.
ALTER TABLE paper4_runs ADD COLUMN rank_ac_valid boolean NOT NULL DEFAULT false;
CREATE FUNCTION validate_paper4_rank_ac(r paper4_runs) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 snap paper4_snapshots;
 attempt paper4_attempts;
 version paper4_versions;
 question jsonb;
 stage jsonb;
 test_case jsonb;
 expected_count integer := 0;
 matched_count integer;
BEGIN
 IF r.snapshot_id IS NULL OR r.status <> 'AC'
    OR jsonb_typeof(r.private_results) <> 'array' THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM paper4_run_tasks t
   WHERE t.id=r.task_id AND t.snapshot_id=r.snapshot_id
    AND t.reference_snapshot_id IS NULL AND t.state='leased'
    AND t.lease_id=r.lease_id AND t.lease_expires_at>now()) THEN RETURN false; END IF;
 SELECT * INTO snap FROM paper4_snapshots WHERE id=r.snapshot_id;
 IF NOT FOUND OR snap.origin <> 'formal' OR snap.stage_key IS NOT NULL THEN RETURN false; END IF;
 SELECT * INTO attempt FROM paper4_attempts WHERE id=snap.attempt_id;
 IF NOT FOUND OR attempt.state <> 'submitted' OR attempt.submitted_at IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM identities i WHERE i.id=attempt.identity_id AND i.kind='student') THEN RETURN false; END IF;
 SELECT * INTO version FROM paper4_versions WHERE id=attempt.version_id;
 IF NOT FOUND OR version.published_at IS NULL OR version.paper_id <> attempt.paper_id THEN RETURN false; END IF;
 SELECT value INTO question FROM jsonb_array_elements(version.definition->'questions')
  WHERE value->>'key'=snap.question_key;
 IF question IS NULL THEN RETURN false; END IF;
 FOR stage IN SELECT value FROM jsonb_array_elements(question->'stages') LOOP
  IF stage->>'judgeMode' <> 'auto' THEN CONTINUE; END IF;
  IF jsonb_typeof(version.runner_cases->(stage->>'id')) <> 'array'
     OR jsonb_array_length(version.runner_cases->(stage->>'id'))=0 THEN RETURN false; END IF;
  FOR test_case IN SELECT value FROM jsonb_array_elements(version.runner_cases->(stage->>'id')) LOOP
   expected_count := expected_count+1;
   SELECT count(*) INTO matched_count FROM jsonb_array_elements(r.private_results) verdict
    WHERE verdict->>'stageId'=stage->>'id'
      AND verdict->>'caseId'=test_case->>'id' AND verdict->>'status'='AC';
   IF matched_count <> 1 THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 IF expected_count=0 OR jsonb_array_length(r.private_results)<>expected_count THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION validate_paper4_rank_ac(paper4_runs) FROM PUBLIC;

CREATE FUNCTION paper4_rank_validate_run() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN NEW.rank_ac_valid := validate_paper4_rank_ac(NEW); RETURN NEW; END $$;
CREATE TRIGGER paper4_rank_validate_run
 BEFORE INSERT ON paper4_runs FOR EACH ROW EXECUTE FUNCTION paper4_rank_validate_run();

-- A teacher's manual/evidence marks have no bearing on the automatic AC
-- reward. The accepted verdict also drives the leaderboard's AC rate.
CREATE FUNCTION award_paper4_rank_points(r paper4_runs) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 snap paper4_snapshots;
 attempt paper4_attempts;
BEGIN
 IF NOT r.rank_ac_valid THEN RETURN; END IF;
 SELECT * INTO snap FROM paper4_snapshots WHERE id=r.snapshot_id;
 SELECT * INTO attempt FROM paper4_attempts WHERE id=snap.attempt_id;
 INSERT INTO paper4_rank_ledger(identity_id,paper_id,version_id,attempt_id,question_key,run_id,points)
 VALUES(attempt.identity_id,attempt.paper_id,attempt.version_id,attempt.id,snap.question_key,r.id,10)
 ON CONFLICT(identity_id,paper_id,question_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION award_paper4_rank_points(paper4_runs) FROM PUBLIC;

CREATE FUNCTION paper4_rank_on_run() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM award_paper4_rank_points(NEW); RETURN NEW; END $$;
CREATE TRIGGER paper4_rank_run
 AFTER INSERT ON paper4_runs FOR EACH ROW EXECUTE FUNCTION paper4_rank_on_run();

CREATE TRIGGER paper4_rank_ledger_immutable
 BEFORE UPDATE OR DELETE ON paper4_rank_ledger
 FOR EACH ROW EXECUTE FUNCTION protect_school_rank_ledger();
