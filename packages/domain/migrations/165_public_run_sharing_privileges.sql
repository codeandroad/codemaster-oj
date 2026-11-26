-- Some installations apply migrations without rerunning the bootstrap grants.
REVOKE ALL ON school_public_run_shares FROM campus_app,campus_worker,PUBLIC;
GRANT SELECT,INSERT,DELETE,UPDATE(visibility) ON school_public_run_shares TO campus_app;
