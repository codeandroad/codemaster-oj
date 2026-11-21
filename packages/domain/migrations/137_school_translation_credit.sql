-- A school solution may consume the amount originally paid for its translation
-- on the platform. The payment itself stays on the original ledger.
CREATE TABLE transferred_translation_credits (
 ledger_id bigint PRIMARY KEY REFERENCES luq_ledger(id),
 school_id uuid NOT NULL REFERENCES schools(id),
 identity_id uuid NOT NULL, subject_key text NOT NULL,
 FOREIGN KEY(school_id,identity_id) REFERENCES school_identities(school_id,id)
);
ALTER TABLE school_scholarship_entitlements ADD COLUMN platform_credit_ledger_id bigint REFERENCES luq_ledger(id),
 ADD CHECK(platform_credit_ledger_id IS NULL OR (kind='FULL_SOLUTION' AND credit_ledger_id IS NULL));
CREATE FUNCTION consume_transferred_translation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||NEW.identity_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM school_scholarship_entitlements imported
  JOIN luq_assistance_entitlements original ON original.id=imported.platform_entitlement_id
  JOIN luq_ledger paid ON paid.id=original.ledger_id AND paid.identity_id=original.identity_id AND paid.kind='purchase' AND paid.delta<0
  WHERE (imported.school_id,imported.identity_id,imported.subject_key)=(NEW.school_id,NEW.identity_id,NEW.subject_key)
   AND (original.identity_id,original.subject_key)=(NEW.identity_id,NEW.subject_key)
   AND original.kind='FULL_TRANSLATION' AND original.language='zh-CN' AND paid.id=NEW.platform_credit_ledger_id
   AND NOT EXISTS(SELECT 1 FROM luq_ledger refund WHERE refund.refund_of=paid.id)
   AND NOT EXISTS(SELECT 1 FROM luq_assistance_entitlements used WHERE used.translation_credit_ledger_id=paid.id))
 THEN RAISE EXCEPTION 'Invalid transferred translation credit'; END IF;
 INSERT INTO transferred_translation_credits VALUES(NEW.platform_credit_ledger_id,NEW.school_id,NEW.identity_id,NEW.subject_key);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION consume_transferred_translation() FROM PUBLIC;
CREATE TRIGGER consume_transferred_translation BEFORE INSERT ON school_scholarship_entitlements
 FOR EACH ROW WHEN (NEW.platform_credit_ledger_id IS NOT NULL) EXECUTE FUNCTION consume_transferred_translation();
CREATE OR REPLACE FUNCTION luq_guard_credited_translation_refund() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM luq_assistance_entitlements WHERE translation_credit_ledger_id=NEW.refund_of)
 OR EXISTS(SELECT 1 FROM transferred_translation_credits WHERE ledger_id=NEW.refund_of)
 THEN RAISE EXCEPTION 'LUQ_TRANSLATION_CREDIT_USED'; END IF;
 RETURN NEW;
END $$;
