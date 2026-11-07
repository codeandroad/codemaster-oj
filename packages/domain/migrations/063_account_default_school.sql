-- A navigation preference only: school memberships and legacy ownership remain
-- the authority for access. Existing accounts keep automatic workspace choice.
ALTER TABLE accounts ADD COLUMN default_school_id uuid
 REFERENCES schools(id) ON DELETE SET NULL;
