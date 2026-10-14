-- A later message deletion supersedes a prior dismissal for display. The
-- dismissal itself remains in audit_events, while the report's final status
-- and resolved time describe the current removal accurately.
UPDATE student_guestbook_reports r
 SET resolution='delete',
     resolved_at=m.deleted_at,
     resolved_by_account_id=m.deleted_by_account_id
 FROM student_guestbook_messages m
 WHERE m.id=r.message_id AND m.deleted_at IS NOT NULL
  AND (r.resolution IS DISTINCT FROM 'delete'
   OR r.resolved_at IS DISTINCT FROM m.deleted_at
   OR r.resolved_by_account_id IS DISTINCT FROM m.deleted_by_account_id);
