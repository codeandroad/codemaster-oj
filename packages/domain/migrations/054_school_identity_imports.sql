-- Durable idempotency receipts contain only request/token digests and aggregate
-- counts. Names, numbers, uploaded files, and preview rows are never stored here.
CREATE TABLE school_identity_imports (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  actor_account_id uuid NOT NULL,
  class_id uuid,
  preview_nonce uuid NOT NULL UNIQUE,
  preview_token_hash text NOT NULL CHECK (preview_token_hash ~ '^[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  aggregate_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, actor_account_id) REFERENCES school_memberships(school_id, account_id),
  FOREIGN KEY (school_id, class_id) REFERENCES school_classes(school_id, id),
  CHECK (school_id <> '00000000-0000-4000-8000-000000000052'),
  CHECK (
    jsonb_typeof(aggregate_result) = 'object'
    AND aggregate_result ?& ARRAY['batchId', 'summary']
    AND aggregate_result - ARRAY['batchId', 'summary'] = '{}'::jsonb
    AND jsonb_typeof(aggregate_result->'batchId') = 'string'
    AND aggregate_result->>'batchId' = id::text
    AND jsonb_typeof(aggregate_result->'summary') = 'object'
    AND aggregate_result->'summary' ?& ARRAY['total', 'created', 'existing', 'duplicates', 'rosterAdded']
    AND (aggregate_result->'summary') - ARRAY['total', 'created', 'existing', 'duplicates', 'rosterAdded'] = '{}'::jsonb
    AND jsonb_typeof(aggregate_result->'summary'->'total') = 'number'
    AND jsonb_typeof(aggregate_result->'summary'->'created') = 'number'
    AND jsonb_typeof(aggregate_result->'summary'->'existing') = 'number'
    AND jsonb_typeof(aggregate_result->'summary'->'duplicates') = 'number'
    AND jsonb_typeof(aggregate_result->'summary'->'rosterAdded') = 'number'
    AND (aggregate_result->'summary'->>'total')::integer BETWEEN 1 AND 500
    AND (aggregate_result->'summary'->>'created')::integer BETWEEN 0 AND 500
    AND (aggregate_result->'summary'->>'existing')::integer BETWEEN 0 AND 500
    AND (aggregate_result->'summary'->>'duplicates')::integer BETWEEN 0 AND 500
    AND (aggregate_result->'summary'->>'rosterAdded')::integer BETWEEN 0 AND 500
    AND (aggregate_result->'summary'->>'created')::integer
      + (aggregate_result->'summary'->>'existing')::integer
      + (aggregate_result->'summary'->>'duplicates')::integer = (aggregate_result->'summary'->>'total')::integer
    AND (aggregate_result->'summary'->>'rosterAdded')::integer
      <= (aggregate_result->'summary'->>'created')::integer + (aggregate_result->'summary'->>'existing')::integer
  )
);
CREATE INDEX school_identity_imports_actor_idx ON school_identity_imports(school_id, actor_account_id, created_at);
