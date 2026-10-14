CREATE TABLE member_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id),
 class_id uuid NOT NULL REFERENCES classes(id),
 idempotency_key uuid NOT NULL,
 request_hash text NOT NULL,
 nonsecret_result jsonb NOT NULL,
 result_ciphertext text,
 replay_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,idempotency_key)
);
