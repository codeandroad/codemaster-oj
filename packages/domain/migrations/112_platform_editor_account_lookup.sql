CREATE INDEX platform_content_editors_active_account_lookup
 ON platform_content_editors(account_id,resource_kind,resource_id,school_id)
 WHERE revoked_at IS NULL;
