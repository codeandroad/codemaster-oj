-- Keep the fact of a past binding after unlinking, without granting the
-- application role read access to the school's write-only audit log.
ALTER TABLE school_identities ADD COLUMN has_account_history boolean NOT NULL DEFAULT false;
UPDATE school_identities i SET has_account_history=true WHERE i.account_id IS NOT NULL
 OR EXISTS (SELECT 1 FROM accounts a WHERE a.identity_id=i.id)
 OR EXISTS (SELECT 1 FROM school_audit_events e WHERE e.school_id=i.school_id AND e.target_id=i.id
   AND e.action IN ('school.identity.link','school.identity.unlink','school.identity.claim'))
 OR EXISTS (SELECT 1 FROM school_activation_tokens t WHERE t.school_id=i.school_id AND t.identity_id=i.id AND t.consumed_at IS NOT NULL)
 OR EXISTS (SELECT 1 FROM school_exit_requests e WHERE e.school_id=i.school_id AND e.identity_id=i.id AND e.status='approved');

CREATE FUNCTION remember_school_identity_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.account_id IS NOT NULL THEN NEW.has_account_history := true; END IF;
 IF TG_OP='UPDATE' THEN NEW.has_account_history := NEW.has_account_history OR OLD.has_account_history OR OLD.account_id IS NOT NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER school_identity_binding_history BEFORE INSERT OR UPDATE OF account_id,has_account_history ON school_identities
 FOR EACH ROW EXECUTE FUNCTION remember_school_identity_binding();
