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
  `);
  console.log('Runtime role grants applied.');
} finally { await pool.end(); }
