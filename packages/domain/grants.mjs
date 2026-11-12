// Run only as the migration owner, after schema migrations. Runtime services
// never receive this account's credentials. These roles are created by init-db.
import { createPool } from './src/db.mjs';
const pool = createPool();
try {
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO campus_app, campus_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO campus_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO campus_app;
    REVOKE ALL ON luq_problem_solutions FROM PUBLIC,campus_worker,campus_app;
    GRANT SELECT,INSERT ON luq_problem_solutions TO campus_app;
    REVOKE INSERT, UPDATE, DELETE ON school_rank_ledger FROM campus_app, campus_worker;
    REVOKE INSERT, UPDATE, DELETE ON paper4_rank_ledger FROM campus_app, campus_worker;
    REVOKE INSERT, UPDATE, DELETE ON luq_accounts, luq_ledger, luq_first_ac_claims,
      luq_activity_awards, luq_submission_results, luq_paper4_results, luq_review_cases, luq_setting_versions,
      luq_initial_grants FROM campus_app, campus_worker;
    REVOKE UPDATE, DELETE ON luq_admin_batches, luq_price_batches, luq_content_batches, problem_public_statements, luq_activity_rules,
      luq_assistance_entitlements, luq_assistance_deliveries, luq_assistance_policies FROM campus_app;
    REVOKE ALL ON public_luq_receipts,public_luq_results FROM PUBLIC,campus_app,campus_worker;
    REVOKE ALL ON public_practice_preferences,public_practice_ranked_jobs,public_practice_staff_exposure FROM PUBLIC,campus_app,campus_worker;
    GRANT SELECT,INSERT,UPDATE ON public_practice_preferences TO campus_app;
    GRANT INSERT ON public_practice_staff_exposure TO campus_app;
    GRANT EXECUTE ON FUNCTION luq_grant_initial(uuid) TO campus_app;
    REVOKE ALL ON FUNCTION luq_grant_initial(uuid) FROM campus_worker;
    GRANT EXECUTE ON FUNCTION luq_post_entry(uuid,integer,text,text,uuid,text,jsonb,bigint,text,text) TO campus_app;
    REVOKE INSERT, UPDATE, DELETE ON paper4_runs FROM campus_app;
    REVOKE ALL ON student_system_notifications FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT, INSERT ON student_system_notifications TO campus_app;
    GRANT UPDATE(read_at) ON student_system_notifications TO campus_app;
    REVOKE ALL ON learning_course_merges FROM PUBLIC,campus_worker;
    REVOKE UPDATE,DELETE ON learning_course_merges FROM campus_app;
    REVOKE ALL ON schema_migrations FROM campus_app;
    GRANT SELECT ON schema_migrations TO campus_app;
    REVOKE ALL ON schools, school_memberships, school_invitations, school_audit_events
      FROM campus_app, campus_worker;
    GRANT SELECT, INSERT ON schools TO campus_app;
    GRANT UPDATE(name,name_zh,name_en) ON schools TO campus_app;
    REVOKE ALL ON platform_admins, school_administrators, platform_audit_events,
      legacy_school_identity_ownership, legacy_school_account_ownership FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT ON platform_admins, legacy_school_identity_ownership, legacy_school_account_ownership TO campus_app;
    GRANT SELECT, INSERT, UPDATE ON school_administrators TO campus_app;
    GRANT SELECT, INSERT ON platform_audit_events TO campus_app;
    GRANT SELECT, INSERT, UPDATE ON school_memberships, school_invitations TO campus_app;
    GRANT INSERT ON school_audit_events TO campus_app;
    REVOKE ALL ON school_identities, school_classes, school_class_roster
      FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT, INSERT ON school_identities, school_classes TO campus_app;
    GRANT UPDATE(account_id,archived_at) ON school_identities TO campus_app;
    GRANT UPDATE(name,type,archived_at,revision) ON school_classes TO campus_app;
    GRANT SELECT, INSERT, DELETE ON school_class_roster TO campus_app;
    REVOKE ALL ON school_identity_imports FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT, INSERT ON school_identity_imports TO campus_app;
    REVOKE ALL ON school_activation_tokens FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT, INSERT, UPDATE ON school_activation_tokens TO campus_app;
    REVOKE ALL ON school_courses, school_course_classes, school_course_publications,
      school_course_publication_classes, school_course_progress, school_learning_resources FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT, INSERT, UPDATE ON school_courses, school_course_progress, school_learning_resources TO campus_app;
    GRANT SELECT, INSERT, DELETE ON school_course_classes TO campus_app;
    GRANT SELECT, INSERT ON school_course_publications, school_course_publication_classes TO campus_app;
    GRANT SELECT, UPDATE ON judge_tasks TO campus_worker;
    REVOKE ALL ON legacy_assignment_preview_submissions FROM PUBLIC, campus_app, campus_worker;
    GRANT SELECT,INSERT ON legacy_assignment_preview_submissions TO campus_app;
    GRANT SELECT(id,version_id,kind,code,language,custom_input) ON legacy_assignment_preview_submissions TO campus_worker;
    GRANT SELECT ON site_settings TO campus_worker;
    GRANT SELECT,INSERT,UPDATE ON judge_nodes TO campus_worker;
    GRANT SELECT ON submissions, problem_versions, test_cases TO campus_worker;
    GRANT INSERT ON judge_runs TO campus_worker;
    GRANT SELECT(id,lease_id) ON judge_runs TO campus_worker;
    GRANT UPDATE(status,score,passed,total,public_output,public_message,pending_judge_run_id) ON submissions TO campus_worker;
    GRANT UPDATE(validation_status,validation_message) ON problem_versions TO campus_worker;
    GRANT SELECT, UPDATE ON paper4_run_tasks TO campus_worker;
    GRANT SELECT ON paper4_snapshots, paper4_reference_snapshots, paper4_attempts, paper4_versions TO campus_worker;
    REVOKE INSERT ON paper4_runs FROM campus_worker;
    GRANT INSERT(task_id,lease_id,snapshot_id,reference_snapshot_id,status,public_output,public_message,private_results,environment_version)
      ON paper4_runs TO campus_worker;
    GRANT SELECT(id,lease_id) ON paper4_runs TO campus_worker;

REVOKE ALL ON public_course_listings, public_course_progress FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT,INSERT,UPDATE ON public_course_listings, public_course_progress TO campus_app;
REVOKE ALL ON public_course_applications, legacy_course_publication_versions, school_exit_requests, school_problem_publication_requests, legacy_public_problem_requests, public_practice_notes
 FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT, INSERT ON public_course_applications, legacy_course_publication_versions, school_exit_requests, school_problem_publication_requests, legacy_public_problem_requests, public_practice_notes TO campus_app;
GRANT UPDATE(status,decided_by,decided_at) ON public_course_applications TO campus_app;
REVOKE ALL ON platform_course_rules,platform_course_admissions,platform_course_invitations,platform_course_invitation_attempts FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT,UPDATE ON platform_course_rules,platform_course_invitations,platform_course_invitation_attempts TO campus_app;
GRANT SELECT,INSERT ON platform_course_admissions TO campus_app;
GRANT UPDATE(status,decided_by,decided_at) ON platform_course_admissions TO campus_app;
REVOKE ALL ON staff_course_notification_reads FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT, INSERT(school_id,account_id,application_id) ON staff_course_notification_reads TO campus_app;
REVOKE ALL ON course_admission_notifications FROM PUBLIC, campus_app, campus_worker;
GRANT SELECT, INSERT(application_id,recipient_account_id,listing_id,outcome,course_title,created_at) ON course_admission_notifications TO campus_app;
GRANT UPDATE(read_at) ON course_admission_notifications TO campus_app;
GRANT UPDATE(status,reviewed_at,reviewed_by,review_note) ON school_exit_requests TO campus_app;
GRANT UPDATE(status,requested_by,requested_at,decided_by,decided_at) ON school_problem_publication_requests, legacy_public_problem_requests TO campus_app;
GRANT UPDATE(note,updated_at) ON public_practice_notes TO campus_app;

REVOKE ALL ON school_problem_banks,school_problems,school_problem_versions,school_problem_publications,school_judge_jobs FROM PUBLIC,campus_app,campus_worker;
REVOKE ALL ON school_paper4_papers,school_paper4_versions,school_paper4_activities,school_paper4_participants,school_paper4_attempts,school_paper4_files,school_paper4_jobs,school_paper4_reviews,school_paper4_requests FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT ON school_paper4_papers,school_paper4_versions,school_paper4_activities,school_paper4_participants,school_paper4_attempts,school_paper4_files,school_paper4_jobs,school_paper4_reviews,school_paper4_requests TO campus_app;
GRANT UPDATE ON school_paper4_papers,school_paper4_activities,school_paper4_attempts,school_paper4_files,school_paper4_reviews TO campus_app;
GRANT SELECT ON school_paper4_jobs TO campus_worker;
GRANT UPDATE(state,result,completed_at,lease_id,lease_expires_at,available_at,attempts,node_id) ON school_paper4_jobs TO campus_worker;
REVOKE ALL ON school_scholarship_settings,school_scholarship_accounts,school_scholarship_ledger,school_scholarship_requests,school_scholarship_contents,school_scholarship_policies,school_scholarship_entitlements,school_scholarship_deliveries,school_scholarship_receipts,school_scholarship_results,school_scholarship_claims,school_rank_awards,school_scholarship_review_cases,school_scholarship_activity_rules,school_scholarship_activity_awards FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON school_scholarship_settings,school_scholarship_accounts,school_scholarship_ledger,school_scholarship_requests,school_scholarship_contents,school_scholarship_policies,school_scholarship_entitlements,school_scholarship_deliveries,school_scholarship_receipts,school_scholarship_results,school_scholarship_claims,school_rank_awards,school_scholarship_review_cases,school_scholarship_activity_rules,school_scholarship_activity_awards TO campus_app;
GRANT INSERT,UPDATE ON school_scholarship_settings,school_scholarship_contents,school_scholarship_policies TO campus_app;
GRANT INSERT ON school_scholarship_requests,school_scholarship_entitlements,school_scholarship_deliveries,school_scholarship_activity_rules TO campus_app;
GRANT EXECUTE ON FUNCTION school_scholarship_entry(uuid,uuid,integer,text,text,uuid,text,jsonb,uuid,text),school_scholarship_settle_activity(uuid,text,uuid) TO campus_app;
REVOKE ALL ON school_activities,school_activity_problems,school_activity_participants,school_activity_classes,school_activity_attempts,school_activity_results FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT,UPDATE ON school_activities,school_activity_attempts TO campus_app;
GRANT SELECT,INSERT,DELETE ON school_activity_problems,school_activity_participants,school_activity_classes TO campus_app;
GRANT SELECT,INSERT ON school_activity_results TO campus_app;
GRANT SELECT,INSERT,UPDATE ON school_problem_banks,school_problems,school_problem_publications TO campus_app;
GRANT SELECT,INSERT ON school_problem_versions,school_judge_jobs TO campus_app;
REVOKE ALL ON acsl_papers,acsl_drafts,acsl_submissions FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_papers TO campus_app;
GRANT SELECT,INSERT,UPDATE ON acsl_drafts TO campus_app;
GRANT SELECT ON acsl_submissions TO campus_app;
REVOKE ALL ON acsl_paper_grades FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT,INSERT ON acsl_paper_grades TO campus_app;
REVOKE ALL ON acsl_point_rules,acsl_point_awards,acsl_programming_point_receipts FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_point_rules,acsl_point_awards TO campus_app;
REVOKE ALL ON acsl_assets FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_assets TO campus_app;
REVOKE ALL ON acsl_presentation_updates FROM PUBLIC,campus_app,campus_worker;
REVOKE ALL ON acsl_grade_question_snapshots,acsl_submission_question_snapshots FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT ON acsl_grade_question_snapshots TO campus_app;
REVOKE ALL ON acsl_management_updates FROM PUBLIC,campus_app,campus_worker;
REVOKE ALL ON acsl_programming_revisions FROM PUBLIC,campus_app,campus_worker;
REVOKE ALL ON FUNCTION protect_acsl_programming_version() FROM PUBLIC,campus_app,campus_worker;
GRANT SELECT(school_id,paper_id,problem_id,before_programming_version_id,after_programming_version_id) ON acsl_programming_revisions TO campus_app;
REVOKE ALL ON FUNCTION acsl_edit_paper(uuid,uuid,uuid,text,text) FROM PUBLIC,campus_app,campus_worker;
GRANT EXECUTE ON FUNCTION acsl_edit_paper(uuid,uuid,uuid,text,text) TO campus_app;
GRANT SELECT ON school_judge_jobs TO campus_worker;
GRANT UPDATE(state,attempts,lease_id,lease_expires_at,node_id,available_at,result,completed_at) ON school_judge_jobs TO campus_worker;
`);
  console.log('Runtime role grants applied.');
} finally { await pool.end(); }
