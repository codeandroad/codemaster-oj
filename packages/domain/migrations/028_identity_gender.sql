-- Existing identities remain unfilled until their owner or an authorized staff member supplies a value.
ALTER TABLE identities ADD COLUMN gender text
  CHECK (gender IN ('male', 'female', 'other', 'undisclosed'));
