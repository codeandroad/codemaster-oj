# Shared primary deployment assets

The deployed topology and validation are recorded in
[the implementation record](../../docs/shared-primary-2026-10-27.md).
These files contain no keys, database passwords or student records. Treat them as
host-specific templates: inspect the actual Docker business bridge, addresses,
container names and service paths before installing them.

- tx99 owns the only writable production PostgreSQL database. The database stays
  on its internal Docker network, with no published database port.
- `campus-primary-db.socket` binds only host loopback `127.0.0.1:15432`.
  Its socket proxy resolves the current database container address. The watcher
  restarts the proxy after container address changes. Enable the socket and timer.
  Install `campus-primary-db.service.d/recovery.conf` alongside the service;
  it sets StartLimitIntervalSec=0, Restart=on-failure and RestartSec=2.
- The dedicated SSH account has a key restricted by source IP, `restrict`,
  `port-forwarding`, `permitopen="127.0.0.1:15432"` and `command="/bin/false"`.
  `60-campus-db-tunnel.conf` further denies shell sessions, remote forwarding,
  agents, PTYs and all other forward destinations. Never use an administrator key.
- ali99 pins tx99's SSH host key and runs `campus-db-tunnel.service` with a separate
  key. Its local listener binds only the business bridge, not a public interface.
  Install and enable the firewall unit before the tunnel, including
  `campus-db-tunnel.service.d/firewall.conf` to require and order the firewall.
  Web and executor bridges are rejected.
- Store `CAMPUS_PRIMARY_APP_DATABASE_URL` and
  `CAMPUS_PRIMARY_WORKER_DATABASE_URL` in the ignored private environment file.
  The deployed LOGIN roles inherit respectively `campus_app` and `campus_worker`;
  neither role is superuser, database creator or role creator. Never give the
  executor any database URL or a Docker socket.
- The example Compose drop-in removes local database dependencies from API and
  worker. The local database is an explicitly stopped archive; default startup
  must not start it or run migrations against it. Run migrations only on tx99.
- After a tunnel failure, ali99 must fail closed, reconnect automatically and
  never fall back to the archived database. Docker networks, keys, credentials,
  firewall rules and service enablement are part of deployment verification.
- Application rollback must keep using the shared primary. Re-enabling the old
  independent database would lose visibility of records received after cutover.
- Do not rerun the one-time reconciliation SQL. It is guarded, contains private
  data, and lives only in protected deployment backups. Existing ledgers and
  submissions must never be replayed through normal reward-producing endpoints.
