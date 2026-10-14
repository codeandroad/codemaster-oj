-- Preserve the named descriptions and course fields from production authoring forms.
ALTER TABLE classes ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE timed_practices ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE assignments ADD COLUMN course text NOT NULL DEFAULT 'Python';
