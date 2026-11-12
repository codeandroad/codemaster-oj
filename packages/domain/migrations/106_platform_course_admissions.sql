-- Additive platform admission rules. Content, publication, identities and all
-- existing learning records remain unchanged; legacy audiences become direct.
ALTER TABLE learning_paths ADD COLUMN platform_audience_scope text NOT NULL DEFAULT 'all'
 CHECK(platform_audience_scope IN ('all','custom'));
UPDATE learning_paths SET platform_audience_scope=CASE WHEN platform_access_scope='all' THEN 'all' ELSE 'custom' END
 WHERE owner_scope='platform';

CREATE TABLE platform_course_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid NOT NULL REFERENCES learning_paths(id),
 rule_key text NOT NULL,target_kind text NOT NULL CHECK(target_kind IN ('all','independent','school','account')),
 school_id uuid REFERENCES schools(id),identity_id uuid REFERENCES identities(id),
 admission_mode text NOT NULL DEFAULT 'direct' CHECK(admission_mode IN ('direct','application','invite')),
 prerequisite_course_ids uuid[] NOT NULL DEFAULT '{}',minimum_points integer NOT NULL DEFAULT 0 CHECK(minimum_points BETWEEN 0 AND 1000000000),
 generation uuid NOT NULL DEFAULT gen_random_uuid(),active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(course_id,rule_key),UNIQUE(course_id,id),CHECK(cardinality(prerequisite_course_ids)<=20),
 CHECK((target_kind IN ('all','independent') AND school_id IS NULL AND identity_id IS NULL)
  OR (target_kind='school' AND school_id IS NOT NULL AND identity_id IS NULL)
  OR (target_kind='account' AND identity_id IS NOT NULL AND school_id IS NULL))
);
INSERT INTO platform_course_rules(course_id,rule_key,target_kind)
 SELECT id,'all','all' FROM learning_paths WHERE owner_scope='platform' AND platform_access_scope='all';
INSERT INTO platform_course_rules(course_id,rule_key,target_kind,school_id)
 SELECT p.id,'school:'||audience.school_id,'school',audience.school_id FROM learning_paths p CROSS JOIN LATERAL unnest(p.platform_school_ids) AS audience(school_id)
 WHERE p.owner_scope='platform' AND p.platform_access_scope='schools';
INSERT INTO platform_course_rules(course_id,rule_key,target_kind,identity_id)
 SELECT p.id,'account:'||audience.identity_id,'account',audience.identity_id FROM learning_paths p CROSS JOIN LATERAL unnest(p.platform_student_ids) AS audience(identity_id)
 WHERE p.owner_scope='platform' AND p.platform_access_scope='students';

CREATE TABLE platform_course_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid NOT NULL,rule_id uuid NOT NULL,
 generation uuid NOT NULL,account_id uuid NOT NULL REFERENCES accounts(id),
 origin text NOT NULL CHECK(origin IN ('application','invite')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,decided_by uuid REFERENCES accounts(id),
 FOREIGN KEY(course_id,rule_id) REFERENCES platform_course_rules(course_id,id),
 UNIQUE(rule_id,generation,account_id)
);
CREATE INDEX platform_course_admissions_queue ON platform_course_admissions(course_id,status,created_at,id);
CREATE TABLE platform_course_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid NOT NULL,rule_id uuid NOT NULL,generation uuid NOT NULL,
 code_hash text NOT NULL,issued_by uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,
 FOREIGN KEY(course_id,rule_id) REFERENCES platform_course_rules(course_id,id),CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX platform_course_invitations_current ON platform_course_invitations(rule_id,generation) WHERE revoked_at IS NULL;
CREATE TABLE platform_course_invitation_attempts (
 bucket_key text PRIMARY KEY,window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),attempts integer NOT NULL CHECK(attempts>0)
);

-- Account-scoped applications are separate from school publication admissions.
-- The API sets this principal only after checking the authenticated account.
ALTER TABLE platform_course_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_course_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_course_admissions_read ON platform_course_admissions FOR SELECT USING(
 account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid OR EXISTS(
  SELECT 1 FROM platform_admins WHERE account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid AND revoked_at IS NULL));
CREATE POLICY platform_course_admissions_create ON platform_course_admissions FOR INSERT WITH CHECK(
 account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid AND (
  (origin='application' AND status='pending') OR (origin='invite' AND status='approved'
   AND rule_id=NULLIF(current_setting('campus.redeemed_course_rule_id',true),'')::uuid)));
CREATE POLICY platform_course_admissions_review ON platform_course_admissions FOR UPDATE USING(EXISTS(
 SELECT 1 FROM platform_admins WHERE account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid AND revoked_at IS NULL)) WITH CHECK(EXISTS(
 SELECT 1 FROM platform_admins WHERE account_id=NULLIF(current_setting('campus.account_id',true),'')::uuid AND revoked_at IS NULL));
