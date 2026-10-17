-- The school-wide practice catalogue is independent from class delivery.
-- Preserve every existing scheduled/class-bound paper and its attempts as an
-- activity; imported, unassigned drafts remain catalogue drafts.
ALTER TABLE paper4_papers
 ADD COLUMN delivery_kind text NOT NULL DEFAULT 'catalog' CHECK(delivery_kind IN ('catalog','activity')),
 ADD COLUMN activity_kind text CHECK(activity_kind IN ('practice','exam')),
 ADD COLUMN source_paper_id uuid REFERENCES paper4_papers(id),
 ADD COLUMN source_version_id uuid REFERENCES paper4_versions(id);
UPDATE paper4_papers SET delivery_kind='activity',
 activity_kind=CASE WHEN starts_at IS NOT NULL AND ends_at IS NOT NULL THEN 'exam' ELSE 'practice' END
 WHERE class_id IS NOT NULL OR starts_at IS NOT NULL OR ends_at IS NOT NULL;
ALTER TABLE paper4_versions ADD CONSTRAINT paper4_versions_id_paper_unique UNIQUE(id,paper_id);
ALTER TABLE paper4_papers
 ADD CONSTRAINT paper4_source_version_matches FOREIGN KEY(source_version_id,source_paper_id) REFERENCES paper4_versions(id,paper_id),
 ADD CONSTRAINT paper4_source_pair CHECK((source_paper_id IS NULL)=(source_version_id IS NULL)),
 ADD CONSTRAINT paper4_delivery_metadata CHECK(
  (delivery_kind='catalog' AND activity_kind IS NULL AND source_paper_id IS NULL AND class_id IS NULL AND starts_at IS NULL AND ends_at IS NULL)
  OR (delivery_kind='activity' AND activity_kind IS NOT NULL));
CREATE INDEX paper4_source_activities_idx ON paper4_papers(source_paper_id,owner_account_id,created_at DESC)
 WHERE delivery_kind='activity';

-- Source-backed class activities are immutable delivery copies. An answer or
-- test edit must be made on the catalogue source and assigned as a new copy.
CREATE FUNCTION protect_paper4_activity_content() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source paper4_versions;
BEGIN
 SELECT v.* INTO source FROM paper4_papers p JOIN paper4_versions v ON v.id=p.source_version_id
  WHERE p.id=NEW.paper_id AND p.source_version_id IS NOT NULL;
 IF FOUND AND (source.published_at IS NULL OR NEW.definition IS DISTINCT FROM source.definition
  OR NEW.runner_cases IS DISTINCT FROM source.runner_cases OR NEW.reference_solutions IS DISTINCT FROM source.reference_solutions) THEN
  RAISE EXCEPTION 'source-backed paper4 activity content is immutable';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_paper4_activity_content() FROM PUBLIC;
CREATE TRIGGER paper4_activity_content_immutable BEFORE INSERT OR UPDATE ON paper4_versions
 FOR EACH ROW EXECUTE FUNCTION protect_paper4_activity_content();

-- Retrying free practice freezes a new attempt rather than rewriting an old
-- submission. Class activities retain their one-attempt transport policy.
ALTER TABLE paper4_attempts ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number>=1);
ALTER TABLE paper4_attempts DROP CONSTRAINT paper4_attempts_paper_version_identity_key;
ALTER TABLE paper4_attempts ADD CONSTRAINT paper4_attempts_number_unique UNIQUE(paper_id,version_id,identity_id,attempt_number);
CREATE UNIQUE INDEX paper4_one_active_attempt ON paper4_attempts(paper_id,version_id,identity_id) WHERE state='active';

-- A classroom copy and its source are one reward-bearing question. Existing
-- ledger rows remain immutable; actual version/attempt provenance is retained.
CREATE OR REPLACE FUNCTION award_paper4_rank_points(r paper4_runs) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE snap paper4_snapshots; attempt paper4_attempts; canonical_paper uuid;
BEGIN
 IF NOT r.rank_ac_valid THEN RETURN; END IF;
 SELECT * INTO snap FROM paper4_snapshots WHERE id=r.snapshot_id;
 SELECT * INTO attempt FROM paper4_attempts WHERE id=snap.attempt_id;
 -- Defence in depth: never credit a weakened class copy as its original.
 SELECT COALESCE(p.source_paper_id,p.id) INTO canonical_paper FROM paper4_papers p
  JOIN paper4_versions actual ON actual.id=attempt.version_id AND actual.paper_id=p.id
  LEFT JOIN paper4_versions source ON source.id=p.source_version_id AND source.paper_id=p.source_paper_id
  WHERE p.id=attempt.paper_id AND (p.source_paper_id IS NULL OR (
   source.published_at IS NOT NULL AND actual.definition=source.definition
   AND actual.runner_cases=source.runner_cases AND actual.reference_solutions=source.reference_solutions));
 IF canonical_paper IS NULL THEN RETURN; END IF;
 INSERT INTO paper4_rank_ledger(identity_id,paper_id,version_id,attempt_id,question_key,run_id,points)
 VALUES(attempt.identity_id,canonical_paper,attempt.version_id,attempt.id,snap.question_key,r.id,10)
 ON CONFLICT(identity_id,paper_id,question_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION award_paper4_rank_points(paper4_runs) FROM PUBLIC;
