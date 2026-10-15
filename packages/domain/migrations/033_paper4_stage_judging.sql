-- Keep every published Paper 4 version (including its schedule and class)
-- immutable while allowing a teacher to prepare a replacement draft.
ALTER TABLE paper4_versions
 ADD COLUMN version_number integer NOT NULL DEFAULT 1,
 ADD COLUMN draft_revision integer NOT NULL DEFAULT 0,
 ADD COLUMN title text,
 ADD COLUMN description text,
 ADD COLUMN class_id uuid REFERENCES classes(id),
 ADD COLUMN starts_at timestamptz,
 ADD COLUMN ends_at timestamptz,
 ADD COLUMN reference_solutions jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD CONSTRAINT paper4_versions_reference_object CHECK(jsonb_typeof(reference_solutions)='object'),
 ADD CONSTRAINT paper4_versions_dates CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at),
 ADD CONSTRAINT paper4_versions_revision CHECK(draft_revision>=0),
 ADD CONSTRAINT paper4_versions_number CHECK(version_number>=1);

-- The existing immutable trigger predates the versioned metadata columns.
-- Temporarily disable it only for this transactional backfill.
ALTER TABLE paper4_versions DISABLE TRIGGER paper4_version_immutable;
UPDATE paper4_versions v SET title=p.title,description=p.description,class_id=p.class_id,
 starts_at=p.starts_at,ends_at=p.ends_at
 FROM paper4_papers p WHERE p.id=v.paper_id;
ALTER TABLE paper4_versions ENABLE TRIGGER paper4_version_immutable;
ALTER TABLE paper4_versions ALTER COLUMN title SET NOT NULL;
ALTER TABLE paper4_versions ALTER COLUMN description SET NOT NULL;
CREATE UNIQUE INDEX paper4_versions_number_idx ON paper4_versions(paper_id,version_number);

ALTER TABLE paper4_papers ADD COLUMN draft_version_id uuid REFERENCES paper4_versions(id);
UPDATE paper4_papers SET draft_version_id=current_version_id WHERE status='draft';

-- A learner may attempt a newly published revision without replacing or
-- altering the record of an earlier revision.
ALTER TABLE paper4_attempts DROP CONSTRAINT paper4_attempts_paper_id_identity_id_key;
ALTER TABLE paper4_attempts ADD CONSTRAINT paper4_attempts_paper_version_identity_key
 UNIQUE(paper_id,version_id,identity_id);

-- A reference program is never attached to a student attempt. It is frozen
-- together with one stage's tests before the isolated worker runs it.
CREATE TABLE paper4_reference_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version_id uuid NOT NULL REFERENCES paper4_versions(id),
 question_key text NOT NULL,
 stage_key text NOT NULL,
 source_code text NOT NULL,
 question jsonb NOT NULL,
 runner_cases jsonb NOT NULL,
 draft_revision integer NOT NULL CHECK(draft_revision>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(jsonb_typeof(question)='object'),
 CHECK(jsonb_typeof(runner_cases)='array')
);
CREATE INDEX paper4_reference_snapshots_version_idx ON paper4_reference_snapshots(version_id,draft_revision,stage_key,created_at DESC);
CREATE TRIGGER paper4_reference_snapshot_immutable BEFORE UPDATE OR DELETE ON paper4_reference_snapshots
 FOR EACH ROW EXECUTE FUNCTION protect_paper4_snapshot();

ALTER TABLE paper4_run_tasks ALTER COLUMN snapshot_id DROP NOT NULL;
ALTER TABLE paper4_run_tasks ADD COLUMN reference_snapshot_id uuid REFERENCES paper4_reference_snapshots(id);
ALTER TABLE paper4_run_tasks ADD CONSTRAINT paper4_run_task_source CHECK((snapshot_id IS NOT NULL) <> (reference_snapshot_id IS NOT NULL));
ALTER TABLE paper4_runs ALTER COLUMN snapshot_id DROP NOT NULL;
ALTER TABLE paper4_runs ADD COLUMN reference_snapshot_id uuid REFERENCES paper4_reference_snapshots(id);
ALTER TABLE paper4_runs ADD CONSTRAINT paper4_run_source CHECK((snapshot_id IS NOT NULL) <> (reference_snapshot_id IS NOT NULL));
CREATE UNIQUE INDEX paper4_runs_one_result_per_task_idx ON paper4_runs(task_id);
