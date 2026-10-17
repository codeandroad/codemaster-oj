-- Freeze the named audience of classroom Paper 4 deliveries. Class membership
-- is a creation-time source, never a continuing visibility grant.
CREATE TABLE paper4_activity_participants (
 paper_id uuid NOT NULL REFERENCES paper4_papers(id),
 identity_id uuid NOT NULL REFERENCES identities(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(paper_id,identity_id)
);
CREATE INDEX paper4_activity_participants_identity_idx ON paper4_activity_participants(identity_id,paper_id);
CREATE TABLE paper4_activity_classes (
 paper_id uuid NOT NULL REFERENCES paper4_papers(id),
 class_id uuid NOT NULL REFERENCES classes(id),
 PRIMARY KEY(paper_id,class_id)
);
CREATE INDEX paper4_activity_classes_class_idx ON paper4_activity_classes(class_id,paper_id);
INSERT INTO paper4_activity_classes(paper_id,class_id)
 SELECT id,class_id FROM paper4_papers WHERE delivery_kind='activity' AND class_id IS NOT NULL;
INSERT INTO paper4_activity_participants(paper_id,identity_id)
 SELECT p.id,i.id FROM paper4_papers p JOIN class_members cm ON cm.class_id=p.class_id
 JOIN identities i ON i.id=cm.identity_id AND i.kind='student'
 WHERE p.delivery_kind='activity'
 ON CONFLICT DO NOTHING;
-- Historically classless published deliveries were school-wide. Preserve
-- exactly the currently valid identities, without enrolling future students.
INSERT INTO paper4_activity_participants(paper_id,identity_id)
 SELECT p.id,i.id FROM paper4_papers p CROSS JOIN identities i
 WHERE p.delivery_kind='activity' AND p.class_id IS NULL AND p.status='published'
  AND i.kind='student' AND i.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.identity_id=i.id AND a.binding_released_at IS NULL AND a.disabled_at IS NOT NULL)
 ON CONFLICT DO NOTHING;
-- Moving out of a class must never strand a previously saved answer or grade.
INSERT INTO paper4_activity_participants(paper_id,identity_id)
 SELECT DISTINCT a.paper_id,a.identity_id FROM paper4_attempts a
 JOIN paper4_papers p ON p.id=a.paper_id AND p.delivery_kind='activity'
 ON CONFLICT DO NOTHING;
