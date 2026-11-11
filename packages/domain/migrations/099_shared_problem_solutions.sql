CREATE TABLE luq_problem_solutions (
 problem_id uuid PRIMARY KEY REFERENCES problems(id),
 content_id uuid NOT NULL UNIQUE REFERENCES luq_assistance_contents(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Keep every historical body, pending edit and delivery unchanged. Select the
-- existing reviewed answer for the currently published teaching problem first.
INSERT INTO luq_problem_solutions(problem_id,content_id)
SELECT p.id, chosen.id FROM problems p
JOIN LATERAL (
 SELECT v.id FROM problem_versions v JOIN problem_banks b ON b.id=p.bank_id
 WHERE v.problem_id=p.id AND v.published_at IS NOT NULL
 ORDER BY (b.visibility='school' AND v.school_visible_at IS NOT NULL AND v.rank_review_status='approved') DESC,
  (b.visibility<>'school' AND v.id=p.current_version_id) DESC,
  v.published_at DESC,v.created_at DESC,v.id DESC LIMIT 1
) live ON true
JOIN LATERAL (
 SELECT c.id FROM luq_assistance_contents c JOIN problem_versions source ON source.id=c.version_id AND source.problem_id=p.id
 WHERE c.subject_key='problem:'||p.id::text AND c.kind='FULL_SOLUTION' AND c.language=''
 ORDER BY (c.status='published' AND c.published_at IS NOT NULL) DESC,
  (c.version_id=live.id) DESC,c.published_at DESC NULLS LAST,c.updated_at DESC,c.id DESC LIMIT 1
) chosen ON true;

CREATE FUNCTION validate_problem_solution_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM luq_assistance_contents c WHERE c.id=NEW.content_id
   AND c.subject_key='problem:'||NEW.problem_id::text AND c.kind='FULL_SOLUTION' AND c.language=''
   AND EXISTS(SELECT 1 FROM problem_versions v WHERE v.id=c.version_id AND v.problem_id=NEW.problem_id)) THEN
  RAISE EXCEPTION 'Shared solution must belong to the same problem' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER problem_solution_owner BEFORE INSERT OR UPDATE ON luq_problem_solutions
 FOR EACH ROW EXECUTE FUNCTION validate_problem_solution_owner();
REVOKE ALL ON luq_problem_solutions FROM PUBLIC,campus_worker,campus_app;
GRANT SELECT,INSERT ON luq_problem_solutions TO campus_app;
