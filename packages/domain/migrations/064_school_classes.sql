-- Archive classes without removing roster, course, or student records.
ALTER TABLE school_classes
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE INDEX school_classes_active_idx ON school_classes(school_id, name, id) WHERE archived_at IS NULL;
