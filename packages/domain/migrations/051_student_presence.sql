-- Ephemeral online status belongs to an authenticated session. Existing sessions
-- remain offline until a new heartbeat; no historical activity is backfilled.
ALTER TABLE sessions ADD COLUMN presence_seen_at timestamptz;
CREATE INDEX sessions_presence_seen_idx ON sessions(presence_seen_at)
 WHERE presence_seen_at IS NOT NULL;
