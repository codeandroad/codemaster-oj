-- A published access policy may override the school-wide price for its stable
-- problem/paper. Purchase entitlements and activity restrictions still prevail.
ALTER TABLE luq_assistance_policies ADD COLUMN price integer
 CHECK(price IS NULL OR (target_type IN ('problem','paper4') AND price BETWEEN 0 AND 1000));

CREATE TABLE luq_price_batches (
 request_id uuid PRIMARY KEY, actor_account_id uuid NOT NULL REFERENCES accounts(id),
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER luq_price_batches_immutable BEFORE UPDATE OR DELETE ON luq_price_batches
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
