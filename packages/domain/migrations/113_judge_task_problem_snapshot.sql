-- Keep the judging inputs attached to the admitted job so that a later
-- problem edit cannot change its tests, feedback or infrastructure retries.
ALTER TABLE judge_tasks ADD COLUMN problem_snapshot jsonb;
ALTER TABLE submissions ADD COLUMN original_problem_version_id uuid;
ALTER TABLE assignment_problems ADD COLUMN original_problem_version_id uuid,
 ADD COLUMN original_prior_problem_version_id uuid;

CREATE FUNCTION judge_task_problem_snapshot(source_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'version', jsonb_build_object(
   'mode', v.mode, 'function_name', v.function_name, 'comparator', v.comparator,
   'samples', v.samples, 'time_limit_ms', v.time_limit_ms, 'memory_limit_mb', v.memory_limit_mb,
   'reference_code', v.reference_code, 'reference_language', v.reference_language
  ),
  'tests', COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
    'id', c.id, 'input', c.input, 'expected', c.expected,
    'weight', c.weight, 'position', c.position
   ) ORDER BY c.position)
   FROM test_cases c WHERE c.version_id=v.id AND c.enabled
  ), '[]'::jsonb)
 )
 FROM problem_versions v WHERE v.id=source_id
$$;
REVOKE ALL ON FUNCTION judge_task_problem_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION judge_task_problem_snapshot(uuid) TO campus_app;

UPDATE judge_tasks SET problem_snapshot=judge_task_problem_snapshot(version_id);
ALTER TABLE judge_tasks ALTER COLUMN problem_snapshot SET NOT NULL;

CREATE FUNCTION capture_judge_task_problem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_submission bigint;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.problem_snapshot IS DISTINCT FROM OLD.problem_snapshot THEN
   RAISE EXCEPTION 'Judge task inputs are immutable';
  END IF;
  RETURN NEW;
 END IF;

 -- Rejudges and corrections use the inputs of the submission they revisit.
 IF NEW.rejudge THEN
  original_submission:=NEW.submission_id;
 ELSE
  SELECT s.original_submission_id INTO original_submission FROM submissions s WHERE s.id=NEW.submission_id;
 END IF;
 NEW.problem_snapshot:=NULL;
 IF original_submission IS NOT NULL THEN
  SELECT initial.problem_snapshot INTO NEW.problem_snapshot FROM judge_tasks initial
   WHERE initial.submission_id=original_submission AND initial.purpose='submission' AND NOT initial.rejudge
   ORDER BY initial.created_at,initial.id LIMIT 1;
 END IF;
 NEW.problem_snapshot:=COALESCE(NEW.problem_snapshot,judge_task_problem_snapshot(NEW.version_id));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION capture_judge_task_problem() FROM PUBLIC;
CREATE TRIGGER judge_task_problem_inputs BEFORE INSERT OR UPDATE OF problem_snapshot ON judge_tasks
 FOR EACH ROW EXECUTE FUNCTION capture_judge_task_problem();
