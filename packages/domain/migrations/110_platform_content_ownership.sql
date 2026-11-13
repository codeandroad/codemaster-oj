-- Keep source identifiers, versions, references and all learner records intact.
ALTER TABLE problems ADD COLUMN owner_scope text NOT NULL DEFAULT 'school'
 CHECK(owner_scope IN ('school','platform'));
UPDATE problems p SET owner_scope='platform'
 WHERE EXISTS(SELECT 1 FROM chapter_problems cp JOIN learning_chapters c ON c.id=cp.chapter_id
 JOIN learning_paths course ON course.id=c.path_id WHERE cp.problem_id=p.id AND course.owner_scope='platform');

CREATE TABLE platform_content_editors (
 resource_kind text NOT NULL CHECK(resource_kind IN ('course','problem')),
 resource_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id),
 school_id uuid NOT NULL REFERENCES schools(id),
 granted_by uuid NOT NULL REFERENCES accounts(id),
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY(resource_kind,resource_id,account_id,school_id)
);
REVOKE ALL ON platform_content_editors FROM PUBLIC,campus_worker;
GRANT SELECT,INSERT,UPDATE ON platform_content_editors TO campus_app;
INSERT INTO platform_audit_events(action,detail)
 SELECT 'platform.problem.source_migrated',jsonb_build_object('problemId',id,'previousOwnerAccountId',owner_account_id)
 FROM problems WHERE owner_scope='platform';
