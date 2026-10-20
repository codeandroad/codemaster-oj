-- Preserve exact reviewed publication results for safe retries. This is
-- independent from access pricing, student unlocks and answer delivery records.
CREATE TABLE luq_content_batches (
 request_id uuid PRIMARY KEY,
 actor_account_id uuid NOT NULL REFERENCES accounts(id),
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER luq_content_batches_immutable BEFORE UPDATE OR DELETE ON luq_content_batches
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
