CREATE UNIQUE INDEX classes_active_owner_name_idx
 ON classes(owner_account_id,lower(btrim(name)))
 WHERE archived_at IS NULL;
