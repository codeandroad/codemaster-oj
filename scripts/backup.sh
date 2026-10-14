#!/bin/sh
# Database contains all first-release private test data and source snapshots.
# Run from a scheduler on the school host, with access to deploy/.env.
set -eu
umask 077
campus_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
campus_backup_dir=${1:-"$campus_root/backups"}
mkdir -p "$campus_backup_dir"
campus_backup_temp=$(mktemp "$campus_backup_dir/.campus-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
campus_backup_name=${campus_backup_temp##*/}
campus_backup_file="$campus_backup_dir/${campus_backup_name#.}.dump"
trap 'rm -f "$campus_backup_temp"' EXIT HUP INT TERM
docker compose --env-file "$campus_root/deploy/.env" -f "$campus_root/deploy/compose.yaml" \
  exec -T db pg_dump -U campus_migrator -d campus --format=custom > "$campus_backup_temp"
test -s "$campus_backup_temp"
# Atomic publication in the same directory; never replace an earlier backup,
# including when two scheduled/manual runs start in the same second.
ln "$campus_backup_temp" "$campus_backup_file"
docker compose --env-file "$campus_root/deploy/.env" -f "$campus_root/deploy/compose.yaml" \
  run --rm --no-deps -T --user 0 --entrypoint node \
  --env "BACKUP_HOST_KIND=${BACKUP_HOST_KIND:-unknown}" \
  --volume "$campus_backup_file:/backup/${campus_backup_file##*/}:ro" \
  migrate record-backup.mjs --created "/backup/${campus_backup_file##*/}"
printf '%s\n' "$campus_backup_file"
