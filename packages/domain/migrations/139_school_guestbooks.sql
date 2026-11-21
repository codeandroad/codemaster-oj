ALTER TABLE student_guestbook_messages ADD COLUMN school_id uuid REFERENCES schools(id);
UPDATE student_guestbook_messages m SET school_id=i.school_id FROM school_identities i
 WHERE m.practice_profile_account_id IS NULL AND m.profile_identity_id=i.id;
ALTER TABLE student_guestbook_messages DROP CONSTRAINT student_guestbook_messages_profile_identity_id_fkey,
 ADD FOREIGN KEY(school_id,profile_identity_id) REFERENCES school_identities(school_id,id),
 ADD CHECK(num_nonnulls(school_id,practice_profile_account_id)=1);
ALTER TABLE student_guestbook_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guestbook_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_workspace ON student_guestbook_messages USING(
 school_id IS NULL OR school_id=NULLIF(current_setting('campus.school_id',true),'')::uuid);
