// Run only as the migration owner, after schema migrations. Runtime services
// never receive this account's credentials. These roles are created by init-db.
import { createPool } from './src/db.mjs';
const pool = createPool();
try {
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO campus_app, campus_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO campus_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO campus_app;
    REVOKE INSERT, UPDATE, DELETE ON school_rank_ledger FROM campus_app, campus_worker;
    REVOKE INSERT, UPDATE, DELETE ON paper4_rank_ledger FROM campus_app, campus_worker;
    REVOKE INSERT, UPDATE, DELETE ON luq_accounts, luq_ledger, luq_first_ac_claims,
      luq_activity_awards, luq_submission_results, luq_paper4_results, luq_review_cases, luq_setting_versions,
      luq_initial_grants FROM campus_app, campus_worker;
    REVOKE UPDATE, DELETE ON luq_admin_batches, luq_price_batches, luq_content_batches, problem_public_statements, luq_activity_rules,
      luq_assistance_entitlements, luq_assistance_deliveries, luq_assistance_policies FROM campus_app;
    GRANT EXECUTE ON FUNCTION luq_post_entry(uuid,integer,text,text,uuid,text,jsonb,bigint,text,text) TO campus_app;
    REVOKE INSERT, UPDATE, DELETE ON paper4_runs FROM campus_app;
    REVOKE ALL ON schema_migrations FROM campus_app;
    GRANT SELECT ON schema_migrations TO campus_app;
    GRANT SELECT, UPDATE ON judge_tasks TO campus_worker;
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
  `);
  console.log('Runtime role grants applied.');
} finally { await pool.end(); }
