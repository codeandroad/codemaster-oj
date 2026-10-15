-- Keep rosters, participation, submissions and grades when teachers retire
-- classroom records. Archived rows remain addressable for historical reports.
ALTER TABLE assignments ADD COLUMN archived_at timestamptz;
CREATE INDEX assignments_active_class_idx ON assignments(class_id,created_at DESC) WHERE archived_at IS NULL;
