-- Migration 035 already granted Paper 4 awards on complete formal AC. Freeze
-- that same eligibility on each run so leaderboard AC rate cannot treat a
-- claimed AC with missing/duplicate verdicts as a genuine accepted attempt.
-- IF NOT EXISTS also supports fresh installs whose 035 already has the flag.
ALTER TABLE paper4_runs ADD COLUMN IF NOT EXISTS rank_ac_valid boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION validate_paper4_rank_ac(r paper4_runs) RETURNS boolean
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
 -- A new run must be for the currently leased task and its frozen snapshot.
 -- The completed branch is only reachable when rechecking an existing run
 -- during this migration: a BEFORE INSERT row is not yet in paper4_runs.
 IF NOT EXISTS (SELECT 1 FROM paper4_run_tasks t
   WHERE t.id=r.task_id AND t.snapshot_id=r.snapshot_id
    AND t.reference_snapshot_id IS NULL AND t.lease_id=r.lease_id
    AND ((t.state='leased' AND t.lease_expires_at>now())
      OR (t.state='completed' AND EXISTS (
       SELECT 1 FROM paper4_runs prior WHERE prior.id=r.id
        AND prior.task_id=t.id AND prior.snapshot_id=r.snapshot_id
        AND prior.lease_id=r.lease_id)))) THEN RETURN false; END IF;
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

CREATE OR REPLACE FUNCTION paper4_rank_validate_run() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN NEW.rank_ac_valid := validate_paper4_rank_ac(NEW); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS paper4_rank_validate_run ON paper4_runs;
CREATE TRIGGER paper4_rank_validate_run
 BEFORE INSERT ON paper4_runs FOR EACH ROW EXECUTE FUNCTION paper4_rank_validate_run();

-- Preserve already-earned immutable awards even if an old worker task no
-- longer has a checkable lease; otherwise revalidate completed frozen runs.
UPDATE paper4_runs r SET rank_ac_valid=(validate_paper4_rank_ac(r)
 OR EXISTS (SELECT 1 FROM paper4_rank_ledger l WHERE l.run_id=r.id))
 WHERE r.status='AC' AND r.snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION award_paper4_rank_points(r paper4_runs) RETURNS void
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
