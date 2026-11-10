-- Elementary editions contain only written questions. Existing coding editions retain their links.
ALTER TABLE acsl_papers ALTER COLUMN programming_problem_id DROP NOT NULL;
ALTER TABLE acsl_papers ALTER COLUMN programming_version_id DROP NOT NULL;
ALTER TABLE acsl_papers ADD CONSTRAINT acsl_programming_pair
 CHECK ((programming_problem_id IS NULL) = (programming_version_id IS NULL));

-- Original-page crops are private, immutable edition resources, never public web assets.
CREATE TABLE acsl_assets (
 school_id uuid NOT NULL, paper_id uuid NOT NULL, version_id uuid NOT NULL,
 asset_id text NOT NULL CHECK (asset_id ~ '^[a-zA-Z0-9-]{1,100}$'),
 purpose text NOT NULL CHECK (purpose IN ('statement','explanation')),
 mime_type text NOT NULL CHECK (mime_type='image/png'),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 width integer NOT NULL CHECK (width BETWEEN 1 AND 12000),
 height integer NOT NULL CHECK (height BETWEEN 1 AND 12000),
 content bytea NOT NULL CHECK (octet_length(content) BETWEEN 24 AND 8388608),
 PRIMARY KEY(school_id,paper_id,version_id,asset_id),
 FOREIGN KEY(school_id,paper_id,version_id) REFERENCES acsl_papers(school_id,id,version_id)
);
ALTER TABLE acsl_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE acsl_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY school_scope ON acsl_assets
 USING (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid)
 WITH CHECK (school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
REVOKE ALL ON acsl_assets FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_assets TO campus_app;
