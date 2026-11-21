-- The original receipts remain immutable proof for entitlements and rewards.
-- Only their owning wallet includes them in its statement.
CREATE TABLE scholarship_receipt_ownership (
 platform_entry bigint PRIMARY KEY REFERENCES luq_ledger(id),
 school_id uuid NOT NULL, school_entry uuid NOT NULL, refunded boolean NOT NULL DEFAULT false,
 FOREIGN KEY(school_id,school_entry) REFERENCES school_scholarship_ledger(school_id,id),
 UNIQUE(school_id,school_entry)
);
ALTER TABLE luq_ledger DROP CONSTRAINT luq_ledger_kind_check,
 ADD CHECK(kind IN ('initial_grant','admin_grant','admin_adjustment','first_ac','activity','purchase','refund','exchange','wallet_relocation'));
ALTER TABLE school_scholarship_ledger DROP CONSTRAINT school_scholarship_ledger_kind_check,
 ADD CHECK(kind IN ('initial_grant','admin_grant','admin_adjustment','first_ac','activity','purchase','refund','exchange'));

LOCK TABLE luq_accounts,luq_ledger,school_scholarship_accounts,school_scholarship_ledger IN SHARE ROW EXCLUSIVE MODE;
-- 134 recorded the identity affiliations used by 133. A later enrolment
-- cannot acquire someone else's public history, even at the same school.
SELECT set_config('campus.school_id','00000000-0000-4000-8000-000000000052',true);
CREATE TEMP TABLE wallet_receipts ON COMMIT DROP AS
 SELECT l.*,a.school_id,gen_random_uuid() school_entry FROM school_audit_events a
 JOIN school_identities i ON (i.school_id,i.id)=(a.school_id,a.target_id) AND i.kind='student'
 JOIN luq_ledger l ON l.identity_id=i.id
 JOIN school_scholarship_settings cutover ON cutover.school_id=i.school_id
 WHERE a.school_id=current_setting('campus.school_id')::uuid
 AND a.action='school.identity.affiliation_recorded' AND l.created_at<=cutover.enabled_at;
-- enabled_at was stamped with clock_timestamp() when 133 created the school
-- wallet settings, including installations applying many migrations in one transaction.
CREATE TEMP TABLE wallet_openings ON COMMIT DROP AS
 SELECT r.school_id,r.identity_id,sum(r.delta)::integer amount,
  p.balance AS platform_before,s.balance AS school_before
 FROM wallet_receipts r LEFT JOIN luq_accounts p USING(identity_id)
 LEFT JOIN school_scholarship_accounts s USING(school_id,identity_id)
 GROUP BY r.school_id,r.identity_id,p.balance,s.balance;

ALTER TABLE school_scholarship_ledger DISABLE TRIGGER immutable;
UPDATE school_scholarship_ledger l SET balance_after=l.balance_after+w.amount
 FROM wallet_openings w WHERE (l.school_id,l.identity_id)=(w.school_id,w.identity_id);
ALTER TABLE school_scholarship_ledger ENABLE TRIGGER immutable;
ALTER TABLE school_scholarship_ledger DISABLE TRIGGER school_scholarship_ledger_student_award_notice;
INSERT INTO school_scholarship_ledger(school_id,id,identity_id,delta,balance_after,kind,source_key,request_hash,actor_account_id,reason,metadata,refund_of,created_at)
 SELECT r.school_id,r.school_entry,r.identity_id,r.delta,r.balance_after,r.kind,'opening:'||r.id,r.request_hash,r.actor_account_id,r.reason,r.metadata,f.school_entry,r.created_at
 FROM wallet_receipts r LEFT JOIN wallet_receipts f ON f.id=r.refund_of;
ALTER TABLE school_scholarship_ledger ENABLE TRIGGER school_scholarship_ledger_student_award_notice;
INSERT INTO scholarship_receipt_ownership(platform_entry,school_id,school_entry,refunded)
 SELECT r.id,r.school_id,r.school_entry,EXISTS(SELECT 1 FROM luq_ledger f WHERE f.refund_of=r.id) FROM wallet_receipts r;
UPDATE school_scholarship_accounts a SET balance=a.balance+w.amount FROM wallet_openings w
 WHERE (a.school_id,a.identity_id)=(w.school_id,w.identity_id);
SELECT luq_post_entry(identity_id,-amount,'wallet_relocation','school-opening:'||school_id||':'||identity_id,NULL,
 '历史奖学金归入校内钱包',jsonb_build_object('schoolId',school_id)) FROM wallet_openings WHERE amount<>0;

CREATE VIEW platform_scholarship_statement AS
 SELECT l.id,l.identity_id,l.delta,(sum(l.delta) OVER(PARTITION BY l.identity_id ORDER BY l.id))::integer balance_after,
 l.kind,l.actor_account_id,l.reason,l.metadata,l.refund_of,l.created_at FROM luq_ledger l
 WHERE l.kind<>'wallet_relocation' AND NOT EXISTS(SELECT 1 FROM scholarship_receipt_ownership r WHERE r.platform_entry=l.id);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wallet_openings w LEFT JOIN luq_accounts p USING(identity_id)
  LEFT JOIN school_scholarship_accounts s USING(school_id,identity_id)
  WHERE w.platform_before IS NULL OR w.school_before IS NULL
  OR p.balance IS DISTINCT FROM w.platform_before-w.amount OR s.balance IS DISTINCT FROM w.school_before+w.amount
  OR p.balance<>(SELECT coalesce(sum(delta),0) FROM platform_scholarship_statement WHERE identity_id=w.identity_id)
  OR s.balance<>(SELECT sum(delta) FROM school_scholarship_ledger WHERE (school_id,identity_id)=(w.school_id,w.identity_id)))
 THEN RAISE EXCEPTION 'Scholarship wallet reconciliation failed'; END IF;
END $$;

-- Both workspaces can still honour the original translation payment. Once
-- refunded in school, it must cease to be a discount in either workspace.
CREATE FUNCTION mark_school_payment_refund() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt bigint;
BEGIN
 SELECT platform_entry INTO receipt FROM scholarship_receipt_ownership WHERE school_id=NEW.school_id AND school_entry=NEW.refund_of;
 IF FOUND THEN
  IF EXISTS(SELECT 1 FROM luq_assistance_entitlements WHERE translation_credit_ledger_id=receipt)
   OR EXISTS(SELECT 1 FROM transferred_translation_credits WHERE ledger_id=receipt)
  THEN RAISE EXCEPTION 'SCHOLARSHIP_CREDIT_USED'; END IF;
  UPDATE scholarship_receipt_ownership SET refunded=true WHERE platform_entry=receipt AND NOT refunded;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHOLARSHIP_ALREADY_REFUNDED'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mark_school_payment_refund() FROM PUBLIC;
CREATE TRIGGER mark_school_payment_refund BEFORE INSERT ON school_scholarship_ledger
 FOR EACH ROW WHEN(NEW.kind='refund') EXECUTE FUNCTION mark_school_payment_refund();

CREATE FUNCTION reject_relocated_platform_refund() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM scholarship_receipt_ownership WHERE platform_entry=NEW.refund_of)
 THEN RAISE EXCEPTION 'LUQ_INVALID_REFUND'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION reject_relocated_platform_refund() FROM PUBLIC;
CREATE TRIGGER reject_relocated_platform_refund BEFORE INSERT ON luq_ledger
 FOR EACH ROW WHEN(NEW.kind='refund') EXECUTE FUNCTION reject_relocated_platform_refund();
