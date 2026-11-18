ALTER TABLE student_guestbook_mentions ADD COLUMN text_ranges jsonb;
ALTER TABLE student_guestbook_mentions ADD CHECK (text_ranges IS NULL OR jsonb_typeof(text_ranges)='array');
