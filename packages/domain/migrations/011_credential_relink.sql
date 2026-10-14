-- A login credential may be moved by creating a new account row. Historical
-- submissions, review authors and audit actors keep their original account.
ALTER TABLE accounts ADD COLUMN original_username text;
ALTER TABLE accounts ADD COLUMN credentials_moved_to_account_id uuid REFERENCES accounts(id);

CREATE FUNCTION protect_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.identity_id IS DISTINCT FROM OLD.identity_id THEN
  RAISE EXCEPTION 'historical account identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_identity_snapshot BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION protect_account_identity();
