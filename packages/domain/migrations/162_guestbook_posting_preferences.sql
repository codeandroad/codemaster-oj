-- An absent row keeps existing guestbooks open to their existing audience.
CREATE TABLE closed_guestbooks (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('school', 'practice')),
  PRIMARY KEY (account_id, scope)
);
GRANT SELECT, INSERT, DELETE ON closed_guestbooks TO campus_app;
