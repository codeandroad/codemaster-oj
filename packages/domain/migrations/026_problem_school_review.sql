-- School-wide publication and ranked scoring are approved per immutable
-- published version. Existing public versions retain their current audience;
-- historical points are deliberately not approved for the new ranking.
ALTER TABLE problem_versions
 ADD COLUMN school_visible_at timestamptz,
 ADD COLUMN rank_review_status text NOT NULL DEFAULT 'pending'
  CHECK (rank_review_status IN ('pending','approved','rejected','revoked')),
 ADD COLUMN rank_approved_at timestamptz,
 ADD COLUMN rank_reviewed_at timestamptz,
 ADD COLUMN rank_reviewed_by uuid REFERENCES accounts(id),
 ADD COLUMN rank_review_reason text;

-- Approval metadata may change after publication; the tested problem content
-- and all other published version fields remain immutable.
CREATE OR REPLACE FUNCTION protect_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published_at IS NOT NULL AND
   (to_jsonb(NEW)-'validation_status'-'validation_message'-'school_visible_at'
    -'rank_review_status'-'rank_approved_at'-'rank_reviewed_at'-'rank_reviewed_by'-'rank_review_reason')
   IS DISTINCT FROM
   (to_jsonb(OLD)-'validation_status'-'validation_message'-'school_visible_at'
    -'rank_review_status'-'rank_approved_at'-'rank_reviewed_at'-'rank_reviewed_by'-'rank_review_reason')
 THEN RAISE EXCEPTION 'published problem versions are immutable'; END IF;
 RETURN NEW;
END $$;

UPDATE problem_versions v
SET school_visible_at = v.published_at
FROM problems p JOIN problem_banks b ON b.id = p.bank_id
WHERE v.problem_id = p.id AND v.published_at IS NOT NULL
 AND b.visibility = 'school' AND b.archived_at IS NULL;

CREATE INDEX problem_versions_school_review_idx
 ON problem_versions(rank_review_status, published_at DESC)
 WHERE published_at IS NOT NULL;

ALTER TABLE problem_versions ADD CONSTRAINT problem_versions_rank_review_consistency
 CHECK ((rank_review_status = 'approved' AND rank_approved_at IS NOT NULL AND school_visible_at IS NOT NULL)
  OR (rank_review_status = 'revoked' AND school_visible_at IS NULL)
  OR (rank_review_status IN ('pending','rejected') AND rank_approved_at IS NULL));
