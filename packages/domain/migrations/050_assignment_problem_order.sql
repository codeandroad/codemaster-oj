-- Presentation order is independent of the immutable scored problem snapshot.
-- Existing saved positions remain available when teachers select custom order.
ALTER TABLE assignments ADD COLUMN problem_order text NOT NULL DEFAULT 'course'
 CHECK (problem_order IN ('course','custom'));
