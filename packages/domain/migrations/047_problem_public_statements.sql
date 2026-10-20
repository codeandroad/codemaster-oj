-- An explicitly reviewed public-language presentation for an exact immutable
-- question version. Existing questions, student work and judge inputs stay intact.
-- No language inference and no automatic content backfill are performed.
CREATE TABLE problem_public_statements (
 version_id uuid PRIMARY KEY REFERENCES problem_versions(id),
 language text NOT NULL CHECK(language='en'),
 statement text NOT NULL CHECK(length(btrim(statement))>0),
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 author_account_id uuid NOT NULL REFERENCES accounts(id),
 reviewer_account_id uuid NOT NULL REFERENCES accounts(id),
 published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER problem_public_statements_immutable BEFORE UPDATE OR DELETE ON problem_public_statements
 FOR EACH ROW EXECUTE FUNCTION protect_luq_append_only();
