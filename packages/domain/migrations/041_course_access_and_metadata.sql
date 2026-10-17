-- Presentation metadata is distinct from immutable ownership and creation time.
ALTER TABLE learning_paths ADD COLUMN author_name text NOT NULL DEFAULT '' CHECK(length(author_name)<=200);
ALTER TABLE learning_paths ADD COLUMN authored_at timestamptz;
UPDATE learning_paths p SET authored_at=p.created_at,author_name=COALESCE((SELECT i.name FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.id=p.owner_account_id),'');
ALTER TABLE learning_paths ALTER COLUMN authored_at SET NOT NULL;
ALTER TABLE learning_paths ALTER COLUMN authored_at SET DEFAULT now();
ALTER TABLE learning_paths ADD COLUMN cover_image text CHECK(cover_image IS NULL OR octet_length(cover_image)<=700000);
ALTER TABLE learning_paths ADD COLUMN access_scope text NOT NULL DEFAULT 'school' CHECK(access_scope IN ('school','classes'));
ALTER TABLE learning_paths ADD COLUMN listed boolean NOT NULL DEFAULT true;
ALTER TABLE learning_paths ADD COLUMN available_from timestamptz;
ALTER TABLE learning_paths ADD COLUMN available_until timestamptz;
ALTER TABLE learning_paths ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE learning_paths ADD CONSTRAINT learning_paths_availability_order CHECK(available_from IS NULL OR available_until IS NULL OR available_until>available_from);
CREATE TABLE learning_path_classes(path_id uuid NOT NULL REFERENCES learning_paths(id),class_id uuid NOT NULL REFERENCES classes(id),PRIMARY KEY(path_id,class_id));
CREATE INDEX learning_path_classes_class_idx ON learning_path_classes(class_id,path_id);
CREATE FUNCTION protect_learning_path_ownership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'Course creation time is immutable';
 END IF;
 -- Reclaiming a released identity changes credentials, not course ownership.
 -- Preserve that existing recovery flow while forbidding identity transfers.
 IF NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id AND NOT EXISTS(
  SELECT 1 FROM accounts previous JOIN accounts replacement ON replacement.identity_id=previous.identity_id
  WHERE previous.id=OLD.owner_account_id AND previous.binding_released_at IS NOT NULL
   AND replacement.id=NEW.owner_account_id AND replacement.binding_released_at IS NULL AND replacement.disabled_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Course ownership is immutable outside identity credential recovery';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER learning_path_ownership_immutable BEFORE UPDATE ON learning_paths FOR EACH ROW EXECUTE FUNCTION protect_learning_path_ownership();
