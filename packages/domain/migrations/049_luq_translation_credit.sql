-- Link each credited solution unlock to the actual paid translation. A fully
-- covered solution has an entitlement and replay key without a money entry.
ALTER TABLE luq_assistance_entitlements
 ADD COLUMN translation_credit_ledger_id bigint UNIQUE REFERENCES luq_ledger(id),
 ADD COLUMN request_key text UNIQUE,
 ADD COLUMN request_hash text,
 ADD CONSTRAINT luq_entitlement_credit_kind CHECK (
  translation_credit_ledger_id IS NULL OR kind='FULL_SOLUTION'
 ),
 ADD CONSTRAINT luq_entitlement_zero_charge_request CHECK (
  (request_key IS NULL AND request_hash IS NULL) OR
  (request_key IS NOT NULL AND request_hash IS NOT NULL AND ledger_id IS NULL AND translation_credit_ledger_id IS NOT NULL)
 );

CREATE FUNCTION luq_guard_credited_translation_refund() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM luq_assistance_entitlements WHERE translation_credit_ledger_id=NEW.refund_of) THEN
  RAISE EXCEPTION 'LUQ_TRANSLATION_CREDIT_USED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION luq_guard_credited_translation_refund() FROM PUBLIC;
CREATE TRIGGER luq_guard_credited_translation_refund BEFORE INSERT ON luq_ledger
 FOR EACH ROW WHEN (NEW.kind='refund') EXECUTE FUNCTION luq_guard_credited_translation_refund();
