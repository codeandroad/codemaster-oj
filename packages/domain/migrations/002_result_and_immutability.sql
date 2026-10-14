ALTER TABLE submissions DROP CONSTRAINT submissions_check;
ALTER TABLE submissions ADD CONSTRAINT submission_ac_full_score CHECK(status<>'AC' OR (score IS NOT NULL AND score=100));
CREATE OR REPLACE FUNCTION protect_published_tests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND EXISTS(SELECT 1 FROM problem_versions WHERE id=OLD.version_id AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'published tests are immutable'; END IF;
 IF TG_OP <> 'DELETE' AND EXISTS(SELECT 1 FROM problem_versions WHERE id=NEW.version_id AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'published tests are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
