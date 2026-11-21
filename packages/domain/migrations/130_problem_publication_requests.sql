-- An application for publication refers to a particular teaching edition. An
-- authoring-catalog request can precede the creation of a judge snapshot.
ALTER TABLE problem_versions ADD UNIQUE (problem_id,id);
ALTER TABLE school_problem_publication_requests
 DROP CONSTRAINT school_problem_publication_re_school_id_problem_id_version_fkey,
 ADD COLUMN catalog_version_id uuid,
 ADD COLUMN school_version_id uuid GENERATED ALWAYS AS
   (CASE WHEN catalog_version_id IS NULL THEN version_id END) STORED,
 ADD CHECK (catalog_version_id IS NULL OR catalog_version_id=version_id),
 ADD FOREIGN KEY (school_id) REFERENCES schools(id),
 ADD FOREIGN KEY (school_id,problem_id,school_version_id) REFERENCES school_problem_versions(school_id,problem_id,id),
 ADD FOREIGN KEY (problem_id,catalog_version_id) REFERENCES problem_versions(problem_id,id);

CREATE FUNCTION check_publication_request_school() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.catalog_version_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM problems p JOIN problem_banks b ON b.id=p.bank_id
   WHERE p.id=NEW.problem_id AND b.school_id=NEW.school_id
 ) THEN RAISE EXCEPTION 'Catalog request outside the source school' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_request_school BEFORE INSERT OR UPDATE OF school_id,problem_id,catalog_version_id
 ON school_problem_publication_requests FOR EACH ROW EXECUTE FUNCTION check_publication_request_school();

-- The former source table is protected by a fixed-scope RLS policy. Read it
-- under that scope even when the migration owner lacks BYPASSRLS.
DO $$
DECLARE previous_scope text := current_setting('campus.school_id',true);
BEGIN
 PERFORM set_config('campus.school_id','00000000-0000-4000-8000-000000000052',true);
 INSERT INTO school_problem_publication_requests
   (school_id,problem_id,version_id,catalog_version_id,requested_by,requested_at,status,decided_by,decided_at)
 SELECT b.school_id,r.problem_id,r.version_id,r.version_id,r.requested_by,r.requested_at,r.status,r.decided_by,r.decided_at
 FROM legacy_public_problem_requests r JOIN problems p ON p.id=r.problem_id JOIN problem_banks b ON b.id=p.bank_id;
 IF EXISTS (
   SELECT problem_id,version_id,requested_by,requested_at,status,decided_by,decided_at FROM legacy_public_problem_requests
   EXCEPT
   SELECT problem_id,catalog_version_id,requested_by,requested_at,status,decided_by,decided_at
   FROM school_problem_publication_requests WHERE catalog_version_id IS NOT NULL
 ) THEN RAISE EXCEPTION 'Publication request reconciliation failed'; END IF;
 PERFORM set_config('campus.school_id',coalesce(previous_scope,''),true);
END $$;
DROP TABLE legacy_public_problem_requests;
