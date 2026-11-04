# Independent ali99 deployment

Current topology: tx99 and ali99 each own a writable database. There is no live
replication, shared writer, database tunnel or automatic failback. See the
[2026-10-28 implementation record](../../docs/ali99-independent-2026-10-28.md).

`compose.ali99.example.yaml` is the credential-free, host-specific configuration
used after the return to independent operation. Apply alongside `compose.yaml`
from the deploy directory, using the ignored private `.env`. All database URLs
are inherited from the base Compose file and use the local `db` service, with
separate `campus_app` and `campus_worker` roles. No database port is published.

The dated volume name intentionally keeps the previous independent database
volume intact. Before first use, verify that this target volume does not exist;
restore an approved consistent snapshot into the new empty database, apply
maintained grants, and verify table fingerprints before opening the gateway.
This template alone is not a safe data migration procedure. Do not run seeding,
reset student credentials or replace existing volumes during routine upgrades.

The retired SSH tunnel, firewall/proxy services and login roles must stay
disabled. `deploy/shared-primary/` is historical configuration, not the current
startup procedure. Secrets, source snapshots and reconciliation scripts remain
in protected private backups and must never enter Git.
