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

## Publishing a release

Use `/usr/local/sbin/ali99-release` on ali99 as the release entry point.
For each release, prepare a new private directory under
`/srv/codemaster-oj-backups/<release-id>/` with two executable files:

- `activate` runs the release's existing activation script. It can take
  `ali99-release.lock` itself, as older activation scripts do.
- `verify` performs the release-specific acceptance checks against the live
  site and exits with a nonzero status on any failure. The entry point runs it
  with the release lock held. It must not acquire the lock again.

Put disposable files and unpacked build contexts under `staging/`. Put
release archives (such as `images.tar.gz`, `web.tar.gz` and
`source-updates.tar.gz`) at the release root or in its `ali99/` subdirectory.
Keep database backups and rollback materials outside `staging/`.

```sh
sudo /usr/local/sbin/ali99-release run <release-id>
sudo /usr/local/sbin/ali99-release status
```

The entry point saves the prior Compose configuration and image IDs in the
release's private `rollback/` directory before activation. Cleanup runs after
`verify`, the database checks for learner problem projection permissions, and
the HTTPS checks for the database, login page and Web assets pass.
It retains archives for the current and preceding verified releases, plus any
older verified release that supplied an image still used by either release.
It removes inspected application archives from other verified releases and
disposable staging files. Database backups, unrecognized archives and files
from unverified or unregistered releases are outside automatic cleanup.
Review the reported skipped files if the entry point finds suspicious contents
or incomplete archives. The report includes free space before and after cleanup.

If activation succeeds and verification fails, fix the verification issue and
run `sudo /usr/local/sbin/ali99-release resume <release-id>`. It verifies the
same activated images before running cleanup. Use the release's rollback
procedure if activation or the application itself needs to be reverted.

For first-time installation, install `ali99-release.py` as
`/usr/local/sbin/ali99-release` and the existing ali99 public CA certificate
as `/srv/codemaster-oj/deploy/ali99-root-ca.crt`. Run
`ali99-release bootstrap <current-release-id> <previous-release-id>` once.
It reads the current release directory's `prior-compose.private.yaml` to
identify the rollback images. Bootstrap verifies and records the two releases
without running cleanup. Use a copy of the current Compose base and the
appropriate prior override if bootstrapping from an older release layout.
