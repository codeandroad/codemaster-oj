-- Trial school directories and rosters are additive. Legacy identities and
-- teaching data keep their current IDs and grants throughout the rollout.
ALTER TABLE school_memberships
  ADD CONSTRAINT school_memberships_school_account_role_key UNIQUE (school_id, account_id, role);

CREATE TABLE school_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  kind text NOT NULL CHECK (kind IN ('student','teacher')),
  number text NOT NULL CHECK (number = btrim(number) AND char_length(number) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, kind, number),
  UNIQUE (school_id, account_id),
  FOREIGN KEY (school_id, account_id, kind) REFERENCES school_memberships(school_id, account_id, role),
  CHECK (school_id <> '00000000-0000-4000-8000-000000000052')
);
CREATE INDEX school_identities_directory_idx ON school_identities(school_id, name, id);

CREATE TABLE school_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  type text NOT NULL DEFAULT 'training' CHECK (type IN ('administrative','training')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, name),
  CHECK (school_id <> '00000000-0000-4000-8000-000000000052')
);

CREATE TABLE school_class_roster (
  school_id uuid NOT NULL,
  class_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, class_id, identity_id),
  FOREIGN KEY (school_id, class_id) REFERENCES school_classes(school_id, id),
  FOREIGN KEY (school_id, identity_id) REFERENCES school_identities(school_id, id)
);
CREATE INDEX school_class_roster_identity_idx ON school_class_roster(school_id, identity_id, class_id);
