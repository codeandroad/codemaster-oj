CREATE TABLE account_profile_covers (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  image text NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 700000)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON account_profile_covers TO campus_app;
