-- A one-time starting allowance belongs to the stable student identity.
-- Existing balances are preserved: the allowance is a new append-only entry.
ALTER TABLE luq_settings ADD COLUMN initial_grant integer NOT NULL DEFAULT 100
 CHECK(initial_grant BETWEEN 0 AND 100000);
-- Retain a complete settings snapshot for the allowance rule used by backfill.
UPDATE luq_settings SET rule_version=rule_version+1,updated_at=clock_timestamp() WHERE singleton;

ALTER TABLE luq_ledger DROP CONSTRAINT luq_ledger_kind_check;
ALTER TABLE luq_ledger ADD CONSTRAINT luq_ledger_kind_check
 CHECK(kind IN ('admin_grant','admin_adjustment','purchase','refund','first_ac','activity','initial_grant'));
ALTER TABLE luq_ledger ADD CONSTRAINT luq_initial_grant_positive CHECK(kind<>'initial_grant' OR delta>0);
CREATE UNIQUE INDEX luq_ledger_initial_grant_once ON luq_ledger(identity_id) WHERE kind='initial_grant';

CREATE TABLE luq_initial_grants (
 identity_id uuid PRIMARY KEY REFERENCES identities(id),
 amount integer NOT NULL CHECK(amount BETWEEN 0 AND 100000),
 rule_version integer NOT NULL CHECK(rule_version>0),
 ledger_id bigint UNIQUE REFERENCES luq_ledger(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((amount=0)=(ledger_id IS NULL))
);
CREATE TRIGGER luq_initial_grants_immutable BEFORE UPDATE OR DELETE ON luq_initial_grants
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();

CREATE FUNCTION luq_grant_initial(student uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowance integer; version integer; entry luq_ledger;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM identities WHERE id=student AND kind='student' AND archived_at IS NULL) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||student::text,0));
 IF EXISTS(SELECT 1 FROM luq_initial_grants WHERE identity_id=student) THEN RETURN; END IF;
 SELECT initial_grant,rule_version INTO allowance,version FROM luq_settings WHERE singleton;
 IF allowance>0 THEN
  entry:=luq_post_entry(student,allowance,'initial_grant','initial-grant:'||student::text,NULL,
   'Initial student Luq allowance',jsonb_build_object('ruleVersion',version,'initialGrant',allowance));
 END IF;
 -- Zero disables the allowance for this identity permanently; increasing the
 -- setting later does not retroactively mint it or turn login into a reward.
 INSERT INTO luq_initial_grants(identity_id,amount,rule_version,ledger_id)
 VALUES(student,allowance,version,entry.id);
END $$;
REVOKE ALL ON FUNCTION luq_grant_initial(uuid) FROM PUBLIC;

CREATE FUNCTION luq_initial_grant_on_identity() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.kind='student' AND NEW.archived_at IS NULL THEN PERFORM luq_grant_initial(NEW.id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION luq_initial_grant_on_identity() FROM PUBLIC;
CREATE TRIGGER luq_initial_grant_on_identity AFTER INSERT OR UPDATE OF kind,archived_at ON identities
 FOR EACH ROW EXECUTE FUNCTION luq_initial_grant_on_identity();

-- Include enrolled and unassigned active identities, even before account
-- activation. Archived identities receive their first allowance on restore.
DO $$ DECLARE student uuid;
BEGIN
 FOR student IN SELECT id FROM identities WHERE kind='student' AND archived_at IS NULL ORDER BY id LOOP
  PERFORM luq_grant_initial(student);
 END LOOP;
END $$;
